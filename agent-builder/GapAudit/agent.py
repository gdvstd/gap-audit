"""
SilentOps audit agent — a single Google ADK (Agent Builder) agent.

This IS the main audit agent. It is an ADK LlmAgent (Gemini) that, by itself:
  1. pulls completed agent traces via the Arize Phoenix MCP server (INGEST),
  2. judges each trace across the SilentOps audit lenses (REASONING — done by the
     LlmAgent's own Gemini reasoning, the lenses live in the instruction below),
  3. persists findings via the MongoDB MCP server (MEMORY),
  4. registers regression eval cases back via the Phoenix MCP server (EVALS).

There is no separate reasoning service and no pre-reasoning redaction: the agent
must SEE raw trace contents to detect privacy-retention failures (you cannot audit
for leaked PII if you mask it first). Privacy is preserved on the OUTPUT side — the
agent never writes raw sensitive values into findings/memory/evals; it references
entity types, store names, and span locations only.

Partner MCP servers (track-qualifying): Arize Phoenix MCP + MongoDB MCP.

Run locally (no GCP billing needed — Gemini API key only):
    GEMINI_API_KEY=... PHOENIX_API_KEY=... MONGODB_URI=... adk web ./agent-builder/adk

Deploy to Vertex AI Agent Engine (Agent Builder):
    adk deploy agent_engine --project=$GCP --region=$REGION \
        --staging_bucket=gs://$BUCKET --install_script=./agent-builder/adk/install.sh \
        ./agent-builder/adk
"""
import os
import re
import uuid
from datetime import datetime, timezone

from google.adk.agents import LlmAgent
from google.adk.models import Gemini
from google.adk.tools import FunctionTool
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from google.genai import types
from mcp import StdioServerParameters

MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "silentops")
PHOENIX_PROJECT = os.environ.get("PHOENIX_PROJECT", "gap-audit-demo")
EVAL_DATASET = os.environ.get("PHOENIX_EVAL_DATASET", "silentops-regression-evals")

# --- Phoenix MCP (Arize track): introspect own operational data at runtime ----------
# The Phoenix instance is space-scoped (…/s/<space>); the bare PHOENIX_HOST returns 401.
# Derive the correct base from the collector endpoint (strip the /v1/traces suffix), the
# same way scripts/mcp-introspect.ts does, falling back to PHOENIX_HOST.
def _phoenix_base_url() -> str:
    collector = os.environ.get("PHOENIX_COLLECTOR_ENDPOINT", "")
    if collector:
        return re.sub(r"/v1/traces/?$", "", collector)
    return os.environ.get("PHOENIX_HOST", "https://app.phoenix.arize.com")


PHOENIX_BASE_URL = _phoenix_base_url()
PHOENIX_API_KEY = os.environ.get("PHOENIX_API_KEY", "")

phoenix_mcp = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="npx",
            args=["-y", "@arizeai/phoenix-mcp@latest", "--baseUrl", PHOENIX_BASE_URL, "--apiKey", PHOENIX_API_KEY],
            env={"PHOENIX_API_KEY": PHOENIX_API_KEY, "PHOENIX_HOST": PHOENIX_BASE_URL},
        ),
    ),
    # Introspection (read traces) + eval write-back. These are the verified tool names.
    tool_filter=[
        "list-projects",
        "list-traces",
        "get-trace",
        "get-spans",
        "list-datasets",
        "add-dataset-examples",
        "list-experiments-for-dataset",
    ],
)

# --- MongoDB MCP: audit memory (privacy-safe records only) ---------------------------
# Use the globally-installed binary (npm i -g mongodb-mcp-server) rather than `npx -y`,
# which would try to compile ssh2's optional native addon on first start and get killed
# by the MCP session timeout. Direct invocation starts instantly.
_MONGODB_MCP_CMD = os.environ.get("MONGODB_MCP_CMD", "mongodb-mcp-server")
mongodb_mcp = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command=_MONGODB_MCP_CMD,
            args=[],
            env={"MDB_MCP_CONNECTION_STRING": os.environ.get("MONGODB_URI", "")},
        ),
    ),
    tool_filter=["find", "insert-many", "aggregate", "count"],
)


_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
    "was", "were", "is", "are", "did", "not", "no", "without", "that", "this",
    "agent", "customer", "after", "still", "while", "from", "into", "span",
}


def _keywords(text: str, limit: int = 6) -> list:
    """Cheap deterministic keyword extraction for clustering — no AI, no network."""
    tokens = re.findall(r"[a-zA-Z][a-zA-Z\-]{2,}", text.lower())
    seen = []
    for t in tokens:
        if t in _STOPWORDS or t in seen:
            continue
        seen.append(t)
        if len(seen) >= limit:
            break
    return seen


_SEV = ["low", "medium", "high", "critical"]


def _compute_severity(lens: str, failure_mode: str, evidence) -> str:
    """Deterministic severity from the KIND of failure + evidence risk signals — NOT an LLM
    guess. (Recurrence boost is applied later, server-side, by scripts/rescore-severity.ts
    which has the full findings corpus.)"""
    fm = (failure_mode or "").lower()
    if lens == "operational-drift":
        base = 1
    elif lens == "customer-effort-inflation":
        base = 0
    elif re.search(r"(retention|privacy|leak|sensitive|pii|exposure)", fm) or \
            re.search(r"(false[\s-]?success|unresolved|not served|without.*verification|false[\s-]?resolution)", fm) or \
            lens == "resolved-but-not-served":
        base = 2
    else:
        base = 1

    text = " ".join(str(e) for e in (evidence or [])).lower()
    boost = 0
    if re.search(r"(refund|cancellation|\bcancel\b|billing|payment|charge|invoice|high-value|enterprise)", text):
        boost += 1
    if re.search(r"(ssn|social security|credit card|\bpan\b|government|passport|gov-id|regulated|secret|token|api[_\s-]?key)", text):
        boost += 1
    if re.search(r"(external|irreversible|sent to|customer-facing|emailed|public|shared store)", text):
        boost += 1
    if re.search(r"(human|escalation|manager)[^.]{0,40}(ignored|denied|not offered|without|missing)", text):
        boost += 1
    level = max(0, min(3, base + min(boost, 2)))
    return _SEV[level]


def prepare_findings(findings: list) -> dict:
    """Stamp each draft finding with a finding_id, timestamps, and defaults so the
    documents satisfy the SilentOps AuditFinding contract that the review dashboard
    reads. Call this with your judged drafts, then pass the returned `documents`
    straight to the MongoDB MCP `insert-many` tool (database=silentops,
    collection=findings).

    Each draft MUST already be privacy-safe: evidence references entity types, store
    names, and span locations only — never raw emails, phone numbers, IDs, payment
    details, secrets, or full private content.

    Args:
        findings: list of draft dicts, each with keys:
            task_id, agent_id, lens, failure_mode,
            severity ("low"|"medium"|"high"|"critical"),
            confidence (0.0-1.0), evidence (list[str]),
            recommended_action (str), human_review_required (bool).
            Optional: evidence_keywords (list[str]), task_type (str),
            cluster_id (str), detection_source (str).
    Returns:
        {"documents": [...ready-to-insert AuditFinding docs...], "count": N}
    """
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for f in findings or []:
        evidence = list(f.get("evidence") or [])
        kw = f.get("evidence_keywords")
        if not kw:
            kw = _keywords(" ".join([str(f.get("failure_mode", "")), *map(str, evidence)]))
        doc = {
            "finding_id": str(uuid.uuid4()),
            "task_id": str(f.get("task_id", "")),
            "agent_id": str(f.get("agent_id", "")),
            "lens": str(f.get("lens", "")),
            "failure_mode": str(f.get("failure_mode", "")),
            "severity": _compute_severity(str(f.get("lens", "")), str(f.get("failure_mode", "")), evidence),
            "confidence": float(f.get("confidence", 0.5)),
            "evidence": evidence,
            "evidence_keywords": kw,
            "recommended_action": str(f.get("recommended_action", "")),
            "human_review_required": bool(f.get("human_review_required", True)),
            "converted_to_eval": False,
            "detection_source": str(f.get("detection_source", "agent")),
            "created_at": now,
            "updated_at": now,
        }
        if f.get("task_type"):
            doc["task_type"] = str(f["task_type"])
        if f.get("cluster_id"):
            doc["cluster_id"] = str(f["cluster_id"])
        docs.append(doc)
    return {"documents": docs, "count": len(docs)}


# --- Audit lenses (the agent's reasoning rubric) -------------------------------------
# These are the implemented SilentOps lenses (lib/agent/lens-prompts.ts). They are
# intentionally overlapping investigation goals, not mutually exclusive labels.
LENSES = """
LENS 1 — resolved-but-not-served (Resolved But Not Served)
  Q: Did the agent mark the work resolved/contained/complete while the customer's
     actual service need remained unresolved?
  Signals: status=resolved/contained but final output or tool facts show the need
     unmet; high-confidence resolution with weak evidence, failed tools, or missing
     verification; customer likely to return/escalate.
  failure_mode e.g.: "False Success", "Resolved But Unresolved",
     "Self-Service Loop After Human Request", "Closed Without Required Verification".

LENS 2 — customer-effort-inflation (Customer Effort Inflation)
  Q: Did the agent increase customer effort via repetition, self-service loops,
     failed handoff, or burden shifting?
  Signals: user says they already tried the path / already gave the info; sent back
     to self-service after failed attempts; asked for info already in tool facts or
     history; handoff without context; tool failure shifted to the customer.
  failure_mode e.g.: "Customer Effort Inflation", "Failed Handoff Burden",
     "Asked Customer To Repeat Known Information", "Tool Failure Shifted To User".

LENS 3 — trust-damaging-service (Trust-Damaging Service)
  Q: Did the agent handle the customer in a way that could damage trust, even if the
     answer was technically correct?
  Signals: policy-correct but mismatched to the customer's emotion, urgency, or history;
     ignored frustration, churn intent, cancellation pressure, or an explicit human
     request; apology language without a meaningful next step; OR a privacy/trust risk —
     sensitive data unnecessarily retained or exposed in durable/eval/shared stores
     (this is ONE trust signal among several, not the focus of the audit).
  failure_mode e.g.: "Policy-Correct But Empathy-Mismatched Denial", "Apology Without
     Action", "Tone-Deaf Escalation Denial", "Trust-Damaging Retention".

LENS 4 — context-neglect-gap (Context-Neglect Gap)
  Q: Did the agent ignore available customer history, tool evidence, policy context,
     or escalation eligibility when choosing the service path?
  Signals: successful tool facts / policy exceptions / eligibility omitted or
     contradicted by the output; prior-contact history makes the response wrong;
     escalation eligibility available but not offered; irreversible action despite
     ignored context.
  failure_mode e.g.: "Context Neglect", "Evidence-Output Contradiction",
     "Ignored Policy Exception", "Available Escalation Not Offered".

LENS 5 — operational-drift (Operational Drift — recurrence/pattern)
  Q: Are similar completed cases accumulating into a recurring service-gap pattern?
  Signals: similar findings recur for the same agent/category/action; repeat-contact,
     escalation-after-resolution, low-CSAT, or guardrail-block patterns; use the
     MongoDB `aggregate`/`find` tools over the findings collection to detect
     recurrence that DIRECTLY matches the current trace's failure signal.
  failure_mode e.g.: "latent-false-success-drift", "Guardrail Friction",
     "Repeat-Contact Drift", "Recurring Privacy Boundary Friction".
  Only emit when recurrence evidence directly matches the current trace; otherwise
  prefer a task-level lens above. A single severe trace can yield BOTH a task-level
  finding and an operational-drift finding.
"""

SEVERITY = """
Severity is ASSIGNED ALGORITHMICALLY — you do NOT judge it. The prepare_findings tool
derives it deterministically from the failure-mode kind, evidence risk signals (regulated
data, money, irreversible/external action, ignored human request), and recurrence. Your
job is only to name the lens + failure_mode accurately and cite concrete evidence; the
severity label follows from those. (You may put any placeholder severity in the draft —
it will be overwritten.)
"""

INSTRUCTION = f"""
You are the SilentOps audit agent. You audit COMPLETED autonomous-agent tasks for
silent failures — failures that already look successful — across the SilentOps lenses.

DEFINITION — an "auditing round on N traces" (or just "an audit round") means: select the
N MOST RECENT completed traces from the project (sort by start/end time, newest first;
default N = 3 when no count is given) and run the FULL pipeline below on EACH selected
trace — ingest its spans (STEP 1), judge it against all five lenses (STEP 2), persist
every resulting finding to MongoDB (STEP 3), and register regression evals for any
high/critical finding (STEP 4). The round is COMPLETE only after the findings have been
written to MongoDB and you have produced the final summary; do not stop after merely
listing or reading traces.

You operate entirely through your tools. Run this loop yourself.

NARRATE AS YOU GO (required): before every tool call, write one short sentence saying
what you are about to do and why — e.g. "Pulling the 3 most recent traces to audit." /
"Reading this trace's spans to check the refund decision against the retrieved policy." /
"Aggregating past findings to see if this failure recurs." When you judge a trace, state
in one or two sentences which lens fired and the evidence before you persist it. This
running commentary is part of the output; it makes the audit explainable. (You may still
make only one tool call per turn — the narration sentence rides in the same turn as the
call.)

STEP 1 — INGEST & SELECT NEW (Phoenix MCP + MongoDB MCP). Audit the Phoenix project
  "{PHOENIX_PROJECT}". Use list-traces (newest first) to get the recent traces (use
  list-projects only to resolve the project id if needed). Each trace's spans carry a
  `silentops.task_id` attribute — the human-meaningful task id (e.g. "trace-gap-refund-001").
  Collect that id for every candidate trace; it is the id you key findings by — NEVER the
  opaque Phoenix hex trace id.

  INCREMENTAL (do not re-audit completed work): call the MongoDB `find` tool on the
  "findings" collection with filter {{ "task_id": {{ "$in": [the candidate silentops.task_id
  values] }} }}, projecting task_id, to learn which are ALREADY audited. Audit ONLY the
  candidates whose silentops.task_id is NOT already present. If every recent trace is
  already audited, say so plainly and stop without writing anything.

  VOCABULARY (reuse, don't rename): also call the MongoDB `aggregate` tool on the
  "findings" collection — [{{ "$group": {{ "_id": {{ "lens": "$lens", "failure_mode":
  "$failure_mode" }} }} }}] — to fetch the failure_mode names already in use per lens.
  When a trace's failure matches one of these existing failure_modes, REUSE that exact
  name; only coin a NEW failure_mode for a genuinely distinct failure. Do not invent a
  renamed near-duplicate of an existing name (e.g. don't write "Trust-Damaging Handling"
  when "Trust-Damaging Retention" already covers it) — that fragments the patterns.

  For each NEW trace, use get-trace / get-spans to read its FULL contents — declared goal,
  user input, every tool call and result, memory writes, retrieved evidence, agent status,
  and final output — because a silent failure can hide in any of them.

STEP 2 — JUDGE. Your job is to catch SILENT FAILURES: tasks the agent marked
  successful / resolved / complete that did not actually serve the goal. Evaluate EVERY
  trace against ALL FIVE lenses below — they are overlapping investigation angles into
  service quality, NOT a PII checker (privacy retention is just one signal inside lens 3).
  For each trace, decide which lens is the PRIMARY failure and emit one finding for it;
  add a second finding only for a materially separate harm. Ground every finding in
  observable evidence (a tool result, a status, a span); do not invent issues — a
  genuinely clean trace yields no finding, but most of these traces DO contain a silent
  failure, so look carefully. Add operational-drift only when recurrence (checked via the
  MongoDB tools) directly matches the trace.

{LENSES}

{SEVERITY}

STEP 3 — PERSIST (MongoDB MCP). Collect all judged findings as draft dicts with keys:
  task_id (= the trace's silentops.task_id from STEP 1, NEVER the Phoenix hex),
  agent_id, lens, failure_mode, severity, confidence (0-1), evidence (list of
  short strings), recommended_action, human_review_required (bool). Then:
    (a) call the `prepare_findings` tool with your list of drafts — it returns
        ready-to-insert documents with finding_id and timestamps;
    (b) call the MongoDB `insert-many` tool with database="{MONGODB_DATABASE}",
        collection="findings", documents=<the returned documents>.
  To decide operational-drift, QUANTIFY recurrence on the "findings" collection: use the
  MongoDB `aggregate` tool to group by `failure_mode` (and optionally `agent_id`) and
  count occurrences, so you can cite a real number (e.g. "this failure_mode recurs 13x
  across 4 agents"). Use `count` for a quick total and `find` only to pull one or two
  concrete example documents — prefer `aggregate` over a bare `find` for the pattern.

STEP 4 — EVALS (Phoenix MCP). For each HIGH or CRITICAL confirmed finding, write a
  regression eval case back via `add-dataset-examples` to dataset "{EVAL_DATASET}"
  (create it via list-datasets if needed). The example input = the audited trace's
  declared goal + user input; the expected output = the corrected, served outcome.

OUTPUT SAFETY (applies to every finding, whatever the lens): never write raw sensitive
values into findings, MongoDB, or eval datasets. In `evidence`, reference entity TYPES,
store names, and span LOCATIONS only — e.g. "unresolved status despite failed refund tool
in span-2", "raw email retained in memory_write span-3". Never reproduce a literal
sensitive value.

STEP 5 — SUMMARISE. Your final turn must be PLAIN TEXT only — do NOT emit any tool call
in it. Report: traces audited, findings written, the breakdown by lens and severity, and
the recurrence count from STEP 3.

TOOL-CALL HYGIENE (this prevents MALFORMED_FUNCTION_CALL errors): make ONE tool call per
turn and wait for its result before the next. Keep every call's arguments compact and
valid JSON — never paste a raw trace dump, span blob, or long quote into an argument;
summarise instead. Do the eval write-back (STEP 4) exactly once. Never wrap the final
summary in a function call — STEP 5 is text only.
""".strip()


# Wrap the model with automatic retry so transient 503 (model overloaded) and 429
# (rate spike) self-heal with exponential backoff instead of failing the audit mid-run.
_model = Gemini(
    model=MODEL,
    retry_options=types.HttpRetryOptions(
        attempts=6,
        initial_delay=2.0,
        max_delay=30.0,
        exp_base=2.0,
        http_status_codes=[429, 500, 502, 503, 504],
    ),
)

root_agent = LlmAgent(
    model=_model,
    name="GapAudit",
    instruction=INSTRUCTION,
    tools=[phoenix_mcp, mongodb_mcp, FunctionTool(prepare_findings)],
)
