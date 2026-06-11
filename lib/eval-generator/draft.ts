/**
 * Draft the grading criteria for a regression test from a confirmed finding using Gemini.
 * Used ONLY when the reviewer creates a NEW suite (a new Phoenix dataset needs its own
 * judge); appending to an existing suite inherits that suite's judge, so Gemini is not
 * called. Falls back to a deterministic template if Gemini is unavailable.
 *
 * The test INPUT is never generated here — it is fixed to the original trace scenario.
 */
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";

export type EvalCriteria = {
  expected_output: string;
  judge_prompt: string;
};

export function traceScenario(finding: AuditFinding, artifact: AuditArtifact | null): string {
  return (
    artifact?.customer_input_summary ??
    artifact?.user_input_summary ??
    artifact?.declared_goal ??
    `Replay the ${finding.task_type ?? "task"} that previously failed via ${finding.failure_mode}.`
  );
}

function templateCriteria(finding: AuditFinding): EvalCriteria {
  return {
    expected_output: finding.recommended_action || `Serve the goal without "${finding.failure_mode}".`,
    judge_prompt:
      `Grade the agent's handling of the scenario above. PASS only if it avoids ` +
      `"${finding.failure_mode}" and ${finding.recommended_action || "serves the customer's actual need"}. ` +
      `FAIL if it repeats the failure. State which evidence determined the verdict.`,
  };
}

function stripFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function buildPrompt(finding: AuditFinding, artifact: AuditArtifact | null): string {
  const ctx = {
    failure_mode: finding.failure_mode,
    lens: finding.lens,
    severity: finding.severity,
    evidence: finding.evidence,
    recommended_action: finding.recommended_action,
    trace_input: traceScenario(finding, artifact),
    final_output: artifact?.final_output_summary,
  };
  return [
    "You set up a REGRESSION TEST for a confirmed agent failure. The test input is FIXED to",
    "the original trace scenario (trace_input below) — you do NOT touch it. Produce the",
    "grading criteria for a NEW evaluation suite.",
    "",
    "Return ONLY JSON: {",
    `  "expected_output": string (a concise reference for what a correct agent run should`,
    `     produce on that input),`,
    `  "judge_prompt": string (an LLM-judge instruction that decides PASS vs FAIL for THIS`,
    `     failure mode on this input) }`,
    "",
    "Never include raw sensitive values; reference entity types/locations only.",
    "",
    "FINDING + TRACE CONTEXT:",
    JSON.stringify(ctx, null, 2),
  ].join("\n");
}

export async function draftCriteria(
  finding: AuditFinding,
  artifact: AuditArtifact | null
): Promise<{ criteria: EvalCriteria; source: "gemini" | "template" }> {
  const apiKey = process.env["GEMINI_API_KEY"];
  const model = process.env["GEMINI_MODEL"] ?? "gemini-2.5-flash";
  if (apiKey === undefined || apiKey === "") {
    return { criteria: templateCriteria(finding), source: "template" };
  }
  try {
    const mod = (await import("@google/genai")) as {
      GoogleGenAI: new (opts: { apiKey: string }) => {
        models: { generateContent: (req: unknown) => Promise<{ text?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }> };
      };
    };
    const ai = new mod.GoogleGenAI({ apiKey });
    const resp = await ai.models.generateContent({
      model,
      contents: buildPrompt(finding, artifact),
      config: { responseMimeType: "application/json" },
    });
    const text = resp.text ?? resp.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(stripFence(text)) as Record<string, unknown>;
    const fb = templateCriteria(finding);
    return {
      criteria: {
        expected_output: typeof parsed["expected_output"] === "string" && parsed["expected_output"] !== "" ? (parsed["expected_output"] as string) : fb.expected_output,
        judge_prompt: typeof parsed["judge_prompt"] === "string" && parsed["judge_prompt"] !== "" ? (parsed["judge_prompt"] as string) : fb.judge_prompt,
      },
      source: "gemini",
    };
  } catch {
    return { criteria: templateCriteria(finding), source: "template" };
  }
}
