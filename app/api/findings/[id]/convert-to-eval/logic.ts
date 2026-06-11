import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter";
import type { RegressionEvalCase } from "@/lib/contracts/regression-eval-case";
import type { AuditArtifact } from "@/lib/contracts/audit-artifact";
import { convertFindingToEval } from "@/lib/review/convert";
import { allSeedArtifacts } from "@/lib/seeds/index";

export async function postConvertToEval(
  memory: AuditMemoryAdapter,
  finding_id: string
): Promise<{ ok: true; value: RegressionEvalCase } | { ok: false; status: number; error: string }> {
  const allFindings = await memory.listFindings();
  const finding = allFindings.find((f) => f.finding_id === finding_id);

  if (finding === undefined) {
    return { ok: false, status: 404, error: `finding '${finding_id}' not found` };
  }

  const decisions = await memory.listReviewDecisions({ finding_id });
  const hasConfirmed = decisions.some((d) => d.decision === "confirmed");

  if (!hasConfirmed) {
    return { ok: false, status: 400, error: "finding must be confirmed before converting to eval" };
  }

  const artifactsById = new Map<string, AuditArtifact>(
    allSeedArtifacts.map((a) => [a.task_id, a])
  );

  try {
    const evalCase = await convertFindingToEval({ finding_id, memory, artifactsById });
    return { ok: true, value: evalCase };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "conversion failed";
    return { ok: false, status: 400, error: message };
  }
}
