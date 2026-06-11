# Deploy SilentOps to Google Cloud Agent Builder (Vertex AI Agent Engine)

This is the deployment guide for the **track-qualifying** integration: a Gemini agent,
built with the **Agent Development Kit (ADK)** and deployed to **Vertex AI Agent Engine**
(the managed runtime under Vertex AI Agent Builder), that meaningfully uses two partner
MCP servers — **Arize Phoenix MCP** and **MongoDB MCP**.

Files in `agent-builder/adk/`:
- `agent.py` — the ADK agent (Gemini + Phoenix MCP + MongoDB MCP + a normalize/audit tool)
- `requirements.txt` — Python deps (`google-adk`, `mcp`, `requests`)
- `install.sh` — Agent Engine custom install script (installs Node so the `npx` MCP servers run)

> **Architecture recap.** The agent uses MCP only at the I/O boundaries — Phoenix MCP to
> introspect its own traces, MongoDB MCP for memory — and delegates redaction + lens
> reasoning to the SilentOps app (`/api/artifacts/ingest`, `/api/audit/run`) so the model
> never sees raw sensitive values. Privacy by construction is preserved. See `audit-workflow.json`.

---

## 0. Prerequisites

- A Google Cloud project with billing, and **Vertex AI API** enabled:
  ```bash
  gcloud config set project <YOUR_PROJECT>
  gcloud services enable aiplatform.googleapis.com
  gcloud auth application-default login
  ```
- A GCS staging bucket: `gsutil mb -l <REGION> gs://<YOUR_BUCKET>`
- Python 3.10+ and the ADK CLI:
  ```bash
  pip install google-adk        # or: uv tool install google-adk
  ```
- The SilentOps app deployed and reachable (Cloud Run) so the agent can call it —
  note its URL as `APP_BASE_URL` (see the root `README.md` → Deploy to Cloud Run).
- Credentials: a Phoenix Cloud API key + space (see root `README.md`), and a MongoDB URI.

## 1. Configure secrets / env

The agent reads these at runtime (set them as Agent Engine env vars at deploy, and for
local `adk run` testing, export them):

| Var | Purpose |
|---|---|
| `GEMINI_MODEL` | e.g. `gemini-flash-latest` (ADK supports Gemini 3 Pro/Flash) |
| `APP_BASE_URL` | the deployed SilentOps app URL (for normalize/audit callbacks) |
| `PHOENIX_HOST` | your Phoenix space URL, e.g. `https://app.phoenix.arize.com/s/<space>` |
| `PHOENIX_API_KEY` | Phoenix Cloud API key |
| `MONGODB_URI` | MongoDB connection string (audit memory) |

> Use Secret Manager for `PHOENIX_API_KEY` / `MONGODB_URI` in production rather than plain env.

## 2. Test locally first

```bash
export $(grep -v '^#' .env.local | grep -v '^$' | xargs)   # Phoenix/Mongo/Gemini vars
cd agent-builder
adk run ./adk          # interactive: ask it to "audit recent traces"
# or: adk web ./adk    # local web UI
```
You should see the agent call Phoenix MCP (`list-traces`), then `normalize_and_audit`,
then MongoDB MCP. This is the same flow `pnpm mcp:introspect` proves for the Phoenix side.

## 3. Deploy to Agent Engine

```bash
adk deploy agent_engine \
  --project=<YOUR_PROJECT> \
  --region=<REGION> \
  --staging_bucket="gs://<YOUR_BUCKET>" \
  --display_name="SilentOps Auditor" \
  --install_script=./adk/install.sh \
  ./adk
```
- `--install_script` runs `install.sh` during the build so Node/`npx` is available for the
  stdio MCP servers. (If your ADK version names this flag differently, set the custom
  installation script in the Agent Engine console build settings — see Sources.)
- The command prints a **reasoning engine resource name** like
  `projects/<n>/locations/<region>/reasoningEngines/<id>` — save it.

## 4. Wire the SilentOps app to the deployed agent

Set on the SilentOps Cloud Run service:
```bash
AGENT_BUILDER_ENABLED=true
AGENT_BUILDER_APP_ID=<reasoningEngines/... resource name or id>
```
`POST /api/audit/run` then routes through `WorkflowOrchestratorAdapter`
(`lib/integrations/workflow-orchestrator.ts`), which triggers the Agent Engine workflow
and falls back to in-process execution if it's unreachable (non-fatal). The response
includes `"orchestrator": "agent-builder"` when the remote run is used.

## 5. Verify

- `gcloud ai reasoning-engines list --region=<REGION>` shows the deployed agent.
- Trigger an audit: `curl -X POST https://<app>/api/audit/run -d '{}'` → response shows
  `orchestrator: agent-builder`.
- In Phoenix, the agent's `list-traces` / `add-dataset-examples` calls appear; in MongoDB,
  findings are written. (`pnpm mcp:introspect` independently proves the Phoenix MCP path.)

## Notes & honest caveats

- **Node-in-Agent-Engine**: the stdio MCP servers need Node; that's what `install.sh` is for.
  If custom install scripts aren't available in your Agent Engine tier, alternatives are:
  run the MCP servers as a remote/SSE endpoint and use `SseConnectionParams`, or run them
  as a sidecar the agent connects to.
- **Tool names** in `agent.py`'s `tool_filter` are the verified Phoenix MCP names (confirmed
  via `pnpm mcp:introspect`: 27 tools). Confirm MongoDB MCP tool names against your deployed
  `mongodb-mcp-server` version.
- This guide deploys the *orchestrator*; the substantive auditing (normalize → mask → 7-lens
  Gemini reasoning → cluster → eval) runs in the SilentOps app, which the agent calls.

## Sources
- ADK MCP tools — https://adk.dev/tools-custom/mcp-tools/
- Deploy ADK + MCP to Agent Engine (custom install scripts) — https://discuss.google.dev/t/deploying-adk-agents-with-mcp-on-vertex-ai-agent-engine-using-custom-installation-scripts/250649
- Phoenix MCP server — https://arize.com/docs/phoenix/integrations/phoenix-mcp-server
