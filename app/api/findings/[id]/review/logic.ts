import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter";
import type { ReviewDecision } from "@/lib/contracts/review-decision";
import type { AuditFinding } from "@/lib/contracts/audit-finding";
import { confirmFinding } from "@/lib/review/confirm";
import { dismissFinding } from "@/lib/review/dismiss";

export type ReviewRequest = {
  decision: "confirmed" | "dismissed";
  reason?: string;
};

export type ReviewResponse = {
  decision: ReviewDecision;
  finding: AuditFinding;
};

function parseReviewBody(raw: unknown): { ok: true; value: ReviewRequest } | { ok: false; error: string } {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;

  if (obj["decision"] !== "confirmed" && obj["decision"] !== "dismissed") {
    return { ok: false, error: "decision must be 'confirmed' or 'dismissed'" };
  }

  if ("reason" in obj && obj["reason"] !== undefined && typeof obj["reason"] !== "string") {
    return { ok: false, error: "reason must be a string when provided" };
  }

  const result: ReviewRequest = { decision: obj["decision"] as "confirmed" | "dismissed" };
  if (typeof obj["reason"] === "string") result.reason = obj["reason"];

  return { ok: true, value: result };
}

export async function postReview(
  memory: AuditMemoryAdapter,
  finding_id: string,
  rawBody: unknown
): Promise<{ ok: true; value: ReviewResponse } | { ok: false; status: number; error: string }> {
  const parsed = parseReviewBody(rawBody);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const allFindings = await memory.listFindings();
  const finding = allFindings.find((f) => f.finding_id === finding_id);
  if (finding === undefined) {
    return { ok: false, status: 404, error: `finding '${finding_id}' not found` };
  }

  const { decision, reason } = parsed.value;

  if (decision === "confirmed") {
    const result = await confirmFinding({
      finding_id,
      memory,
      ...(reason !== undefined ? { reason } : {}),
    });
    return { ok: true, value: result };
  } else {
    const result = await dismissFinding({
      finding_id,
      memory,
      ...(reason !== undefined ? { reason } : {}),
    });
    return { ok: true, value: result };
  }
}
