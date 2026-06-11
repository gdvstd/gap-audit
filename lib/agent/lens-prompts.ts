export type LensDefinition = {
  id: string;
  label: string;
  priority: number;
  core_question: string;
  objective: string;
  suggested_tools: string[];
  severity_guidance: string;
};

const SHARED_SEVERITY_GUIDANCE = `Severity rubric (assign from customer-experience and service-operation risk):
- low: minor service quality issue, no clear customer harm or operational recurrence
- medium: customer confusion, avoidable extra effort, weak repeat signal, or early trust erosion
- high: resolved/contained status despite unresolved customer need, repeat contact, failed escalation, external customer-facing contradiction, privacy/trust risk, or recurring service friction
- critical: public exposure, severe privacy/trust breach, irreversible customer harm, high-value customer loss risk, or widespread repeated pattern affecting many customers

Minimum severity signals:
- Internal-only, reversible, low-confidence singleton: low
- Extra customer effort, weak frustration signal, or low-impact repeat: medium
- Human request ignored, repeated contact after resolution, failed handoff, policy/context ignored in customer-facing answer, low-CSAT resolved case, or repeated restricted-action/guardrail friction: high
- Public/shared sensitive data, severe trust breach, irreversible harm, or broad pattern across many cases: critical

Calibration examples:
- Use high rather than critical for a single durable/internal trust-risk retention case unless the artifact shows public/shared exposure, regulated disclosure, or irreversible harm.
- Use high rather than critical for a single false-resolution production incident unless the case shows widespread impact, irreversible outage harm, or high-value customer loss risk.
- Use high for repeated guardrail blocks, restricted-action attempts, repeat-contact, or escalation-after-resolution patterns when aggregate tools show recurrence, even if each single case was contained.
- Reserve critical for public exposure, severe privacy/trust breach, irreversible customer harm, high-value customer loss risk, or a broad repeated pattern affecting many customers.

Boost one bucket (capped at critical) when: the customer explicitly asked for a human; the case was marked resolved/contained; the customer returned after resolution; the issue involves cancellation, refund, billing, high-value customers, or regulated/private data; similar findings recur historically.

Lens usage note: these lenses are intentionally overlapping investigation goals, not mutually exclusive labels, but findings should be minimal and non-duplicative. Prefer one primary task-level lens for the artifact unless there are materially separate harms. Add operational-drift only when recurrence evidence directly matches the artifact's failure signal. Prefer compact canonical failure_mode names from the lens objective; place the supporting explanation in evidence and recommended_action.`;

export const allLensDefinitions: LensDefinition[] = [
  {
    id: "resolved-but-not-served",
    label: "Resolved But Not Served",
    priority: 1,
    core_question: "Did the agent mark the work resolved, contained, or complete while the customer's actual service need remained unresolved?",
    objective: `Investigate the gap between system completion and customer outcome. The persona for this lens is a customer-experience auditor who assumes "resolved" is only meaningful if the customer was actually served.

Primary signals to reason about:
- agent_status is resolved/contained/completed while final_output_summary or tool_facts show the customer still lacks the needed outcome.
- The response closes the company task but leaves the customer likely to return, escalate, or lose trust.
- Tool facts, verification artifacts, or action metadata show missing completion evidence despite a successful status.
- The case involves high-confidence resolution with weak evidence, failed tools, or missing verification.

Canonical failure_mode values under this lens include: "False Success", "Resolved But Unresolved", "Containment Masking Unresolved Need", "Self-Service Loop After Human Request", and "Closed Without Required Verification".

Do not treat this as a narrow false-success checker. Ask whether the completed workflow actually served the customer's service goal.`,
    suggested_tools: ["get_artifact", "get_agent_profile", "extract_conversation_signals", "aggregate_service_outcomes"],
    severity_guidance: SHARED_SEVERITY_GUIDANCE,
  },
  {
    id: "customer-effort-inflation",
    label: "Customer Effort Inflation",
    priority: 2,
    core_question: "Did the agent increase customer effort through repetition, self-service loops, failed handoff, or burden shifting?",
    objective: `Investigate whether the AI support interaction made the customer do extra work that the system should have avoided. The persona for this lens is an effort-reduction auditor: the agent should lower customer effort, not move unresolved work back to the customer.

Primary signals to reason about:
- The user says they already tried the suggested path or already provided information.
- The final response sends the customer back to self-service after prior failed attempts.
- The agent asks for information already available in tool_facts, history, or prior messages.
- A human handoff is triggered without preserving context, causing the customer to repeat themselves.
- Tool failures or ambiguity are shifted to the customer instead of being handled by the workflow.

Canonical failure_mode values under this lens include: "Customer Effort Inflation", "Failed Handoff Burden", "Asked Customer To Repeat Known Information", "Self-Service Loop", "Tool Failure Shifted To User", and "Unnecessary Customer Work".

Ground the finding in observable service evidence. Subjective annoyance alone is not enough unless connected to repeated asks, prior contact, failed handoff, or unresolved workflow state.`,
    suggested_tools: ["get_artifact", "extract_conversation_signals", "inspect_handoff_quality", "find_similar_findings"],
    severity_guidance: SHARED_SEVERITY_GUIDANCE,
  },
  {
    id: "trust-damaging-service",
    label: "Trust-Damaging Service",
    priority: 3,
    core_question: "Did the agent handle the customer in a way that could damage trust, even if the answer was technically correct?",
    objective: `Investigate technically plausible interactions that still damage customer trust. The persona for this lens is a trust auditor: correctness is not enough when the response ignores emotion, history, privacy expectations, or the stakes of the issue.

Primary signals to reason about:
- The response is policy-correct but mismatched to customer emotion, urgency, or history.
- The agent ignores frustration, churn intent, cancellation pressure, or explicit human requests.
- The artifact shows privacy/trust risk: unnecessary retention, over-collection, external exposure, or sensitive data in durable/eval/shared stores.
- The agent uses apology language without taking a meaningful next step.
- The interaction may reduce confidence in AI support, especially for billing, cancellation, refund, or high-value customers.

Canonical failure_mode values under this lens include: "Trust-Damaging Retention", "Privacy Trust Risk", "Policy-Correct But Empathy-Mismatched Denial", "Apology Without Action", and "Tone-Deaf Escalation Denial".

For privacy/trust findings, never include raw sensitive values. Reference entity types, store names, destinations, redacted snippets, or hashes only.`,
    suggested_tools: ["get_artifact", "get_agent_profile", "extract_conversation_signals", "aggregate_service_outcomes"],
    severity_guidance: SHARED_SEVERITY_GUIDANCE,
  },
  {
    id: "context-neglect-gap",
    label: "Context-Neglect Gap",
    priority: 4,
    core_question: "Did the agent ignore available customer history, tool evidence, policy context, or escalation eligibility when choosing the service path?",
    objective: `Investigate whether the agent had enough observable context to choose a better service path but failed to use it. The persona for this lens is a context-use auditor: look for missed evidence that would have changed the customer experience.

Primary signals to reason about:
- Successful tool facts, policy exceptions, account history, or eligibility facts are omitted or contradicted by final_output_summary.
- Prior contact history or repeated attempts make the chosen response inappropriate.
- Escalation eligibility is available but not offered.
- The final action is external or irreversible despite ignored context.
- The agent appears to optimize for task closure rather than using the available service evidence.

Canonical failure_mode values under this lens include: "Context Neglect", "Evidence-Output Contradiction", "Ignored Policy Exception", "Available Escalation Not Offered", "Customer History Ignored", and "Wrong Service Path Despite Available Context".

This lens should not re-solve the customer's whole issue. It should identify specific available context that the completed workflow failed to use.`,
    suggested_tools: ["get_artifact", "get_agent_profile", "extract_conversation_signals"],
    severity_guidance: SHARED_SEVERITY_GUIDANCE,
  },
  {
    id: "operational-drift",
    label: "Operational Drift",
    priority: 5,
    core_question: "Are similar completed AI support cases accumulating into a recurring service gap pattern?",
    objective: `Investigate whether individual support cases reveal a recurring operational pattern. The persona for this lens is a service-operations auditor: single cases matter, but patterns decide whether the product workflow needs to change.

Primary signals to reason about:
- Similar findings recur for the same agent, issue category, action, or customer segment.
- Completed/contained cases have repeat-contact, escalation-after-resolution, low-CSAT, thumbs-down, or guardrail-block patterns.
- find_similar_findings shows high overlap in evidence keywords or failure modes.
- search_findings_history shows a trend of repeated resolution gaps, handoff burdens, context neglect, or privacy/trust issues.
- aggregate_service_outcomes shows the same agent accumulating similar service gaps across completed traces.
- aggregate tools return high-frequency events that suggest the agent is not learning from blocked or failed behavior.

Canonical failure_mode values under this lens include: "Guardrail Friction", "latent-false-success-drift", "Repeat-Contact Drift", "Escalation-After-Resolution Pattern", "Recurring Handoff Burden", and "Recurring Privacy Boundary Friction".

Emit operational-drift in parallel with a task-level finding when aggregate_service_outcomes, search_findings_history, find_similar_findings, or aggregate_guardrail_events shows recurrence that directly matches the current artifact. For example, a false-resolution incident can produce both a resolved-but-not-served finding for the artifact and a latent-false-success-drift finding for the recurring operational pattern.

Failure mode calibration: use "latent-false-success-drift" only for repeated False Success / resolved-with-failed-verification evidence; use "Guardrail Friction" only for repeated restricted-action or guardrail-block evidence; use "Repeat-Contact Drift" for repeated repeat-contact or handoff burden; use "Recurring Privacy Boundary Friction" for repeated privacy/trust boundary failures. Do not use latent-false-success-drift as a generic operational label.

Prefer pattern findings when there is recurrence or trend evidence that matches this artifact. Do not emit operational-drift solely because the agent has unrelated historical findings. If only a single case is available, use one of the other lenses unless the single case is severe enough to require operational review.`,
    suggested_tools: ["get_artifact", "aggregate_service_outcomes", "search_findings_history", "find_similar_findings", "aggregate_guardrail_events"],
    severity_guidance: SHARED_SEVERITY_GUIDANCE,
  },
];

export const mvpLensDefinitions: LensDefinition[] = allLensDefinitions.filter((l) =>
  [
    "resolved-but-not-served",
    "customer-effort-inflation",
    "trust-damaging-service",
    "context-neglect-gap",
    "operational-drift",
  ].includes(l.id)
);

export function getLensDefinition(id: string): LensDefinition | undefined {
  return allLensDefinitions.find((l) => l.id === id);
}
