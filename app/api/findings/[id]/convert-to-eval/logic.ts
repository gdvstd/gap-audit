import { randomUUID } from "node:crypto";
import type { AuditMemoryAdapter } from "@/lib/audit-memory/adapter";
import type { RegressionEvalCase, RegressionSuite } from "@/lib/contracts/regression-eval-case";
import { pushDatasetExample } from "@/lib/integrations/phoenix-datasets";
import { getRegressionSuite, upsertRegressionSuite, bumpSuiteExampleCount } from "@/lib/review/regression-suites";

type Body = {
  input?: unknown;
  expected_output?: unknown;
  target?: unknown; // "existing" | "new"
  dataset_name?: unknown;
  judge_prompt?: unknown;
};

export type ConvertResult =
  | { ok: true; value: { eval_case: RegressionEvalCase; dataset_name: string; phoenix_dataset_id: string; action: "create" | "append" } }
  | { ok: false; status: number; error: string };

export async function postConvertToEval(
  memory: AuditMemoryAdapter,
  finding_id: string,
  body: Body
): Promise<ConvertResult> {
  const findings = await memory.listFindings();
  const finding = findings.find((f) => f.finding_id === finding_id);
  if (finding === undefined) return { ok: false, status: 404, error: `finding '${finding_id}' not found` };

  const decisions = await memory.listReviewDecisions({ finding_id });
  if (!decisions.some((d) => d.decision === "confirmed")) {
    return { ok: false, status: 400, error: "finding must be confirmed before converting to a regression test" };
  }

  const input = typeof body.input === "string" ? body.input.trim() : "";
  const datasetName = typeof body.dataset_name === "string" ? body.dataset_name.trim() : "";
  const target = body.target === "new" ? "new" : "existing";
  if (input === "") return { ok: false, status: 400, error: "input (test scenario) is required" };
  if (datasetName === "") return { ok: false, status: 400, error: "dataset_name is required" };

  const expectedOutput = typeof body.expected_output === "string" ? body.expected_output.trim() : "";

  // Resolve the suite + its judge prompt. Existing suites OWN the judge (read-only on the
  // case); a new suite takes the judge prompt from the (edited) body.
  let action: "create" | "append";
  let judgePrompt: string;
  const nowIso = new Date().toISOString();

  if (target === "existing") {
    const suite = await getRegressionSuite(datasetName);
    if (suite === null) return { ok: false, status: 400, error: `regression suite '${datasetName}' not found` };
    action = "append";
    judgePrompt = suite.judge_prompt;
  } else {
    judgePrompt = typeof body.judge_prompt === "string" ? body.judge_prompt.trim() : "";
    if (judgePrompt === "") return { ok: false, status: 400, error: "judge_prompt is required for a new suite" };
    action = "create";
    const suite: RegressionSuite = {
      dataset_name: datasetName,
      failure_mode: finding.failure_mode,
      lens: finding.lens,
      judge_prompt: judgePrompt,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await upsertRegressionSuite(suite);
  }

  // Push the example to the Phoenix dataset.
  let phoenixDatasetId = "";
  try {
    const res = await pushDatasetExample(datasetName, action, {
      input: { scenario: input },
      output: { expected_output: expectedOutput },
      metadata: {
        failure_mode_guarded: finding.failure_mode,
        lens: finding.lens,
        source_finding_id: finding_id,
        agent_id: finding.agent_id,
        judge_prompt: judgePrompt,
      },
    });
    phoenixDatasetId = res.dataset_id;
  } catch (err: unknown) {
    return { ok: false, status: 502, error: `Phoenix push failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  await bumpSuiteExampleCount(datasetName, phoenixDatasetId);

  // Persist the regression eval case.
  const evalCase: RegressionEvalCase = {
    eval_id: randomUUID(),
    source_finding_id: finding_id,
    agent_id: finding.agent_id,
    input,
    expected_behavior: expectedOutput !== "" ? [expectedOutput] : [],
    failure_mode_guarded: finding.failure_mode,
    dataset_name: datasetName,
    judge_prompt: judgePrompt,
    created_at: nowIso,
  };
  await memory.saveEvalCase(evalCase);
  await memory.updateFinding(finding_id, { converted_to_eval: true, updated_at: nowIso });

  return { ok: true, value: { eval_case: evalCase, dataset_name: datasetName, phoenix_dataset_id: phoenixDatasetId, action } };
}
