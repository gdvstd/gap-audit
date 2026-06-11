import { getMemory } from "@/lib/runtime/container";
import { draftEval } from "@/lib/eval-generator/draft";
import { listRegressionSuites } from "@/lib/review/regression-suites";

// Propose a regression test for a confirmed finding (Gemini draft) + the existing suites
// the user can target. The human edits this draft before converting.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const memory = await getMemory();

  const findings = await memory.listFindings();
  const finding = findings.find((f) => f.finding_id === id);
  if (finding === undefined) {
    return Response.json({ error: `finding '${id}' not found` }, { status: 404 });
  }

  const decisions = await memory.listReviewDecisions({ finding_id: id });
  if (!decisions.some((d) => d.decision === "confirmed")) {
    return Response.json({ error: "confirm the finding before drafting a regression test" }, { status: 400 });
  }

  const artifact = await memory.getArtifact(finding.task_id);
  const [{ draft, source }, suites] = await Promise.all([
    draftEval(finding, artifact),
    listRegressionSuites(),
  ]);

  // Suggest the suite whose failure_mode matches this finding (so similar tests group).
  const suggested = suites.find((s) => s.failure_mode === finding.failure_mode || s.lens === finding.lens);

  return Response.json({
    draft,
    source,
    suites: suites.map((s) => ({ dataset_name: s.dataset_name, failure_mode: s.failure_mode, judge_prompt: s.judge_prompt })),
    suggested_dataset: suggested?.dataset_name ?? null,
    finding: { failure_mode: finding.failure_mode, lens: finding.lens, agent_id: finding.agent_id },
  });
}
