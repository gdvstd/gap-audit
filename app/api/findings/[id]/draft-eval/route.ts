import { getMemory } from "@/lib/runtime/container";
import { traceScenario, draftCriteria } from "@/lib/eval-generator/draft";
import { listRegressionSuites } from "@/lib/review/regression-suites";

// Prepare the convert-to-regression panel: the FIXED test input (the original trace
// scenario) + the existing suites a reviewer can target. Gemini grading criteria are only
// drafted when `?criteria=1` — i.e. when the reviewer is creating a NEW suite (an existing
// suite already owns its judge).
export async function POST(
  request: Request,
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
  const input = traceScenario(finding, artifact);
  const suites = await listRegressionSuites();
  const suggested = suites.find((s) => s.failure_mode === finding.failure_mode || s.lens === finding.lens);

  const wantCriteria = new URL(request.url).searchParams.get("criteria") === "1";
  let criteria: { expected_output: string; judge_prompt: string } | undefined;
  let source: "gemini" | "template" | undefined;
  if (wantCriteria) {
    const res = await draftCriteria(finding, artifact);
    criteria = res.criteria;
    source = res.source;
  }

  return Response.json({
    input,
    suites: suites.map((s) => ({ dataset_name: s.dataset_name, failure_mode: s.failure_mode, judge_prompt: s.judge_prompt })),
    suggested_dataset: suggested?.dataset_name ?? null,
    failure_mode: finding.failure_mode,
    ...(criteria ? { criteria, source } : {}),
  });
}
