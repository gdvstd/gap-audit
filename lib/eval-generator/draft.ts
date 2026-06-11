/**
 * Draft a regression test from a confirmed finding using Gemini (Google AI). The agent
 * surfaces the finding; here Gemini proposes a test case + judge prompt that a human then
 * edits before it is pushed to a Phoenix dataset. Falls back to a deterministic template
 * if Gemini is unavailable, so the convert flow never hard-fails.
 */
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";

export type EvalDraft = {
  input: string;
  expected_behavior: string[];
  prohibited_patterns: string[];
  judge_prompt: string;
  failure_mode_guarded: string;
};

function deterministicDraft(finding: AuditFinding, artifact: AuditArtifact | null): EvalDraft {
  const scenario =
    artifact?.customer_input_summary ??
    artifact?.user_input_summary ??
    artifact?.declared_goal ??
    `Task of type ${finding.task_type ?? "unknown"} that previously failed via ${finding.failure_mode}.`;
  return {
    input: scenario,
    expected_behavior: [finding.recommended_action].filter(Boolean),
    prohibited_patterns: [finding.failure_mode],
    judge_prompt:
      `You are grading an autonomous agent's handling of the task above. PASS only if the ` +
      `agent avoids "${finding.failure_mode}" and ${finding.recommended_action || "serves the customer's actual need"}. ` +
      `FAIL if the agent repeats the failure. Explain which evidence determined the verdict.`,
    failure_mode_guarded: finding.failure_mode,
  };
}

function stripFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim() !== "") return [v];
  return [];
}

function buildPrompt(finding: AuditFinding, artifact: AuditArtifact | null): string {
  const ctx = {
    failure_mode: finding.failure_mode,
    lens: finding.lens,
    severity: finding.severity,
    evidence: finding.evidence,
    recommended_action: finding.recommended_action,
    task_type: finding.task_type,
    declared_goal: artifact?.declared_goal,
    user_input: artifact?.user_input_summary ?? artifact?.customer_input_summary,
    final_output: artifact?.final_output_summary,
  };
  return [
    "You convert a confirmed agent-failure finding into a REGRESSION TEST so the failure",
    "cannot silently recur. Given the finding + trace context below, produce a test that",
    "re-creates the situation and a judge prompt that decides pass/fail.",
    "",
    "Return ONLY JSON with this exact shape:",
    `{ "input": string (the scenario/user request to replay),`,
    `  "expected_behavior": string[] (what a correct agent MUST do — pass criteria),`,
    `  "prohibited_patterns": string[] (what it must NOT do — fail criteria),`,
    `  "judge_prompt": string (an LLM-judge instruction: how to score a future agent run,`,
    `     stating exactly what makes it PASS vs FAIL for THIS failure mode) }`,
    "",
    "Never include raw sensitive values; reference entity types/locations only.",
    "",
    "FINDING + TRACE CONTEXT:",
    JSON.stringify(ctx, null, 2),
  ].join("\n");
}

export async function draftEval(finding: AuditFinding, artifact: AuditArtifact | null): Promise<{ draft: EvalDraft; source: "gemini" | "template" }> {
  const apiKey = process.env["GEMINI_API_KEY"];
  const model = process.env["GEMINI_MODEL"] ?? "gemini-2.5-flash";
  if (apiKey === undefined || apiKey === "") {
    return { draft: deterministicDraft(finding, artifact), source: "template" };
  }
  try {
    const mod = (await import("@google/genai")) as { GoogleGenAI: new (opts: { apiKey: string }) => {
      models: { generateContent: (req: unknown) => Promise<{ text?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }> };
    } };
    const ai = new mod.GoogleGenAI({ apiKey });
    const resp = await ai.models.generateContent({
      model,
      contents: buildPrompt(finding, artifact),
      config: { responseMimeType: "application/json" },
    });
    const text = resp.text ?? resp.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(stripFence(text)) as Record<string, unknown>;
    const draft: EvalDraft = {
      input: typeof parsed["input"] === "string" ? (parsed["input"] as string) : deterministicDraft(finding, artifact).input,
      expected_behavior: asStringArray(parsed["expected_behavior"]),
      prohibited_patterns: asStringArray(parsed["prohibited_patterns"]),
      judge_prompt: typeof parsed["judge_prompt"] === "string" ? (parsed["judge_prompt"] as string) : "",
      failure_mode_guarded: finding.failure_mode,
    };
    if (draft.judge_prompt === "" || draft.expected_behavior.length === 0) {
      const fb = deterministicDraft(finding, artifact);
      if (draft.judge_prompt === "") draft.judge_prompt = fb.judge_prompt;
      if (draft.expected_behavior.length === 0) draft.expected_behavior = fb.expected_behavior;
    }
    return { draft, source: "gemini" };
  } catch {
    return { draft: deterministicDraft(finding, artifact), source: "template" };
  }
}
