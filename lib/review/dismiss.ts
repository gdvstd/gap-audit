import type { AuditMemoryAdapter } from "../audit-memory/adapter.js";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { ReviewDecision } from "../contracts/review-decision.js";
import { validateReviewDecision } from "../contracts/review-decision.js";

export async function dismissFinding(input: {
  finding_id: string;
  memory: AuditMemoryAdapter;
  reviewer_id?: string;
  reason?: string;
  now?: () => Date;
}): Promise<{ decision: ReviewDecision; finding: AuditFinding }> {
  const { finding_id, memory, reviewer_id, reason, now } = input;
  const makeDate = now ?? (() => new Date());
  const nowIso = makeDate().toISOString();

  const decision: ReviewDecision = {
    finding_id,
    decision: "dismissed",
    decided_at: nowIso,
  };

  if (reviewer_id !== undefined) decision.reviewer_id = reviewer_id;
  if (reason !== undefined) decision.reason = reason;

  const validation = validateReviewDecision(decision);
  if (!validation.ok) {
    throw new Error(`dismissFinding produced invalid decision: ${validation.errors.join("; ")}`);
  }

  await memory.saveReviewDecision(decision);
  const finding = await memory.updateFinding(finding_id, { updated_at: nowIso });

  return { decision, finding };
}
