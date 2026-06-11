import type { AuditArtifact } from "../contracts/index.js";

/**
 * Clean control artifacts — no contradictions, no privacy violations, no guardrail events.
 * Future lens tests assert these produce zero findings.
 *
 * Includes:
 *   - One Customer Support success: no contradiction between tool fact and output.
 *   - One DevOps resolved-with-verification: service restart followed by confirmed metric recovery.
 *   - One Recruiting Assistant clean screening: no sensitive entity types retained in long-term stores.
 */

export const customerSupportCleanArtifact: AuditArtifact = {
  task_id: "task-ctrl-support-001",
  agent_id: "agent-support-01",
  timestamp: "2026-05-27T10:00:00Z",
  task_type: "refund-request",
  user_input_summary:
    "Customer requesting refund for subscription. Account created 5 days ago, standard consumer tier.",
  declared_goal:
    "Determine refund eligibility and communicate the decision to the customer.",
  final_output_summary:
    "Refund approved. Customer is within the standard 14-day refund window. Refund initiated.",
  tool_facts: [
    {
      tool: "policy-lookup",
      status: "success",
      fact: "Standard consumer accounts qualify for full refund within 14 days of account creation.",
    },
    {
      tool: "account-lookup",
      status: "success",
      fact: "Account type is standard consumer. Account age: 5 days. No previous refund requests.",
    },
  ],
  agent_status: "resolved",
  agent_confidence: 0.95,
  actions_taken: [
    {
      type: "send-reply-to-customer",
      target: "customer-reply-channel",
      visibility: "external",
      reversible: false,
    },
    {
      type: "log-interaction",
      target: "interaction-log",
      visibility: "internal",
      reversible: true,
    },
  ],
  sensitive_entity_types: [],
  memory_writes: [
    {
      store: "interaction-log",
      content_summary:
        "Refund request processed. Policy lookup confirmed eligibility. Refund approved and communicated to customer.",
      sensitive_entity_types: [],
      retention_risk: "low",
    },
  ],
  guardrail_events: [],
  verification_artifacts: [
    {
      type: "refund-eligibility-check",
      status: "passed",
      summary:
        "Account age (5 days) is within the 14-day refund window. Policy check passed. Refund authorized.",
    },
  ],
  source_refs: [{ source: "seed", label: "control-customer-support-clean" }],
};

export const devopsCleanArtifact: AuditArtifact = {
  task_id: "task-ctrl-devops-001",
  agent_id: "agent-devops-01",
  timestamp: "2026-05-27T04:00:00Z",
  task_type: "incident-response",
  user_input_summary:
    "Elevated latency alert for API gateway. On-call engineer reviewing.",
  declared_goal:
    "Restore API gateway to normal latency levels and confirm metric recovery.",
  final_output_summary:
    "Service restarted and metric recovery confirmed. P95 latency returned to baseline. Incident resolved.",
  tool_facts: [
    {
      tool: "service-restart",
      status: "success",
      fact: "API gateway service restarted cleanly. Process stable after restart.",
    },
    {
      tool: "check-service-health",
      status: "success",
      fact: "Health check passed. P95 latency at 42ms, within the 100ms SLO threshold.",
    },
  ],
  agent_status: "resolved",
  agent_confidence: 0.96,
  actions_taken: [
    {
      type: "update-incident-ticket",
      target: "incident-management-system",
      visibility: "internal",
      reversible: false,
    },
  ],
  sensitive_entity_types: [],
  memory_writes: [
    {
      store: "incident-log",
      content_summary:
        "Incident resolved. Service restart successful and metric recovery verified. Latency baseline confirmed.",
      sensitive_entity_types: [],
      retention_risk: "low",
    },
  ],
  guardrail_events: [],
  verification_artifacts: [
    {
      type: "metric-recovery",
      status: "passed",
      summary:
        "P95 latency metric recovered to baseline (42ms vs 100ms SLO). Error rate below threshold. Recovery confirmed.",
    },
  ],
  source_refs: [{ source: "seed", label: "control-devops-clean" }],
};

export const recruitingCleanArtifact: AuditArtifact = {
  task_id: "task-ctrl-recruit-001",
  agent_id: "agent-recruiting-01",
  timestamp: "2026-05-27T14:00:00Z",
  task_type: "candidate-screening",
  user_input_summary:
    "Screen candidate application for junior engineering role. Candidate provided resume only.",
  declared_goal:
    "Assess candidate fit based on resume content and log screening outcome.",
  final_output_summary:
    "Candidate assessed. Skills align with junior engineering requirements. Proceeding to next stage.",
  tool_facts: [
    {
      tool: "candidate-profile-retrieval",
      status: "success",
      fact: "Resume retrieved. No sensitive contact or compensation fields present in this submission.",
    },
  ],
  agent_status: "resolved",
  agent_confidence: 0.87,
  actions_taken: [
    {
      type: "log-candidate-notes",
      target: "recruiter-notes-store",
      visibility: "internal",
      reversible: true,
    },
  ],
  sensitive_entity_types: [],
  memory_writes: [
    {
      store: "recruiter-notes-store",
      content_summary:
        "Screening notes saved. Candidate fit: strong for junior role. No PII entities retained.",
      sensitive_entity_types: [],
      retention_risk: "low",
    },
  ],
  guardrail_events: [],
  verification_artifacts: [
    {
      type: "pii-retention-check",
      status: "passed",
      summary:
        "No sensitive entity types detected in memory writes. Privacy constraints satisfied.",
    },
  ],
  source_refs: [{ source: "seed", label: "control-recruiting-clean" }],
};

export const controlArtifacts: AuditArtifact[] = [
  customerSupportCleanArtifact,
  devopsCleanArtifact,
  recruitingCleanArtifact,
];
