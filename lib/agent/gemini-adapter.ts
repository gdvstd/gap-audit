/**
 * Gemini reasoning adapter for SilentOps (Milestone 4).
 *
 * Backed by Google Gemini function-calling via @google/genai (v2.8).
 * The @google/genai module is loaded lazily via dynamic import — only on the
 * first actual API call — so demo/test mode pays zero import cost.
 *
 * Dependency injection via `deps.generate` keeps tests network-free.
 */

import type { ReasoningAdapter, ReasoningMessage, ReasoningStep, ToolCall } from "./reasoning-adapter.js";
import type { LensDefinition } from "./lens-prompts.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AgentProfile } from "../contracts/agent-profile.js";
import type { ToolSchema } from "../tools/types.js";
import { validateLensFindingDraft, validateLensNoFindingDraft } from "../contracts/audit-finding.js";
import type { LensFindingDraft, LensNoFindingDraft } from "../contracts/audit-finding.js";

// ─── Minimal SDK shape interfaces ─────────────────────────────────────────────
// We describe only the subset of @google/genai types we actually use.
// Using `unknown` + narrowing instead of importing SDK types keeps the
// adapter decoupled and avoids loading the SDK at module-parse time.

type FunctionCallShape = {
  name?: string;
  args?: Record<string, unknown>;
};

type GenerateContentResponseShape = {
  functionCalls?: FunctionCallShape[] | undefined;
  text?: string | undefined;
};

/**
 * Minimal request shape for models.generateContent.
 * Mirrors @google/genai GenerateContentParameters.
 */
export type GenerateRequest = {
  model: string;
  contents: unknown;
  config?: {
    systemInstruction?: string;
    tools?: Array<{ functionDeclarations: Array<{ name: string; description: string; parametersJsonSchema: unknown }> }>;
  };
};

/**
 * The generate function signature the adapter relies on.
 * In production this is `ai.models.generateContent` from @google/genai.
 * In tests it is injected as a fake.
 */
export type GenerateFn = (req: GenerateRequest) => Promise<unknown>;

/**
 * Optional dependencies for createGeminiAdapter — used for testing.
 */
export type GeminiAdapterDeps = {
  /** Override the generate function (inject a fake for tests). */
  generate?: GenerateFn;
};

// ─── enabled() logic ──────────────────────────────────────────────────────────

function isGeminiEnabled(): boolean {
  if (process.env["GEMINI_ENABLED"] !== "true") return false;
  const model = process.env["GEMINI_MODEL"];
  if (model === undefined || model === "") return false;

  // Vertex mode: GOOGLE_CLOUD_PROJECT required
  const project = process.env["GOOGLE_CLOUD_PROJECT"];
  if (project !== undefined && project !== "") return true;

  // API-key mode: GEMINI_API_KEY required
  const apiKey = process.env["GEMINI_API_KEY"];
  if (apiKey !== undefined && apiKey !== "") return true;

  return false;
}

// ─── Lazy real generate function ──────────────────────────────────────────────

let cachedGenerateFn: GenerateFn | null = null;

async function getRealGenerateFn(): Promise<GenerateFn> {
  if (cachedGenerateFn !== null) return cachedGenerateFn;

  // Dynamic import — only executes when actually needed
  const { GoogleGenAI } = (await import("@google/genai")) as {
    GoogleGenAI: new (opts: Record<string, unknown>) => {
      models: { generateContent: GenerateFn };
    };
  };

  const project = process.env["GOOGLE_CLOUD_PROJECT"];
  const location = process.env["GOOGLE_CLOUD_LOCATION"];
  const apiKey = process.env["GEMINI_API_KEY"];

  const opts: Record<string, unknown> = {};
  if (project !== undefined && project !== "") {
    opts["vertexai"] = true;
    opts["project"] = project;
    if (location !== undefined && location !== "") {
      opts["location"] = location;
    }
  } else if (apiKey !== undefined && apiKey !== "") {
    opts["apiKey"] = apiKey;
  }

  const ai = new GoogleGenAI(opts);
  const fn: GenerateFn = (req) => ai.models.generateContent(req);
  cachedGenerateFn = fn;
  return fn;
}

// ─── Response narrowing helpers ───────────────────────────────────────────────

function isFunctionCallShape(v: unknown): v is FunctionCallShape {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function narrowResponse(raw: unknown): GenerateContentResponseShape {
  if (typeof raw !== "object" || raw === null) {
    return { functionCalls: undefined, text: undefined };
  }
  const obj = raw as Record<string, unknown>;

  let functionCalls: FunctionCallShape[] | undefined;
  const rawCalls = obj["functionCalls"];
  if (Array.isArray(rawCalls) && rawCalls.length > 0) {
    const narrowed: FunctionCallShape[] = [];
    for (const c of rawCalls) {
      if (isFunctionCallShape(c)) {
        narrowed.push(c);
      }
    }
    functionCalls = narrowed.length > 0 ? narrowed : undefined;
  }

  let text: string | undefined;
  if (typeof obj["text"] === "string") {
    text = obj["text"];
  }

  return { functionCalls, text };
}

// ─── Request builder helpers ───────────────────────────────────────────────────

type GeminiContent = {
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } }>;
};

/**
 * Translate ReasoningMessage[] into Gemini contents array.
 * - system messages become the systemInstruction (handled separately)
 * - tool_result messages become function-response user turns
 */
function buildContents(messages: ReasoningMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // System message is handled separately as systemInstruction
      continue;
    }

    if (msg.role === "tool_result") {
      // tool_result → functionResponse part in a user turn
      const responseData: Record<string, unknown> = {
        ok: msg.result.ok,
      };
      if (msg.result.ok && msg.result.data !== undefined) {
        responseData["data"] = msg.result.data;
      }
      if (!msg.result.ok) {
        responseData["error"] = msg.result.error;
      }

      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: msg.tool,
              response: responseData,
            },
          },
        ],
      });
    }
  }

  return contents;
}

function extractSystemInstruction(messages: ReasoningMessage[]): string | undefined {
  const sys = messages.find((m) => m.role === "system");
  if (sys !== undefined && sys.role === "system") {
    return sys.content;
  }
  return undefined;
}

function buildFunctionDeclarations(
  tools: ToolSchema[]
): Array<{ name: string; description: string; parametersJsonSchema: unknown }> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.inputSchema,
  }));
}

// ─── selectLenses helpers ─────────────────────────────────────────────────────

function buildSelectLensesPrompt(
  artifact: AuditArtifact,
  profile: AgentProfile | null,
  lenses: LensDefinition[]
): string {
  const lensDescriptions = lenses
    .map((l) => `- ${l.id}: ${l.core_question}`)
    .join("\n");

  const profileInfo =
    profile !== null
      ? `Agent role: ${profile.role}. Allowed: ${profile.allowed_actions.join(", ") || "none"}. Restricted: ${profile.restricted_actions.join(", ") || "none"}.`
      : "No agent profile available.";

  return `You are a post-hoc audit triage agent. Given an audit artifact and available audit lenses, select only the lenses that are relevant to this artifact.

Artifact summary:
- task_id: ${artifact.task_id}
- agent_id: ${artifact.agent_id}
- agent_status: ${artifact.agent_status}
- input: ${artifact.user_input_summary}
- company_task: ${artifact.company_task ?? artifact.declared_goal}
- final_output: ${artifact.final_output_summary}
- conversation_signals: ${(artifact.conversation_signals ?? []).join(", ") || "none"}
- operational_signals: ${(artifact.operational_signals ?? []).join(", ") || "none"}
- business_signals: ${(artifact.business_signals ?? []).join(", ") || "none"}
- guardrail_events count: ${artifact.guardrail_events.length}
- memory_writes count: ${artifact.memory_writes.length}
- tool_facts count: ${artifact.tool_facts.length}
${profileInfo}

Available lenses:
${lensDescriptions}

Selection policy:
- Choose the smallest useful lens set, not every lens that could be loosely relevant.
- Prefer one primary task-level lens among resolved-but-not-served, customer-effort-inflation, trust-damaging-service, and context-neglect-gap unless the artifact contains materially separate harms.
- Add operational-drift only when the artifact itself has a signal that directly matches recurring aggregate/history evidence, such as repeated guardrail blocks, repeated false resolution after failed verification, repeated handoff burden, or repeated privacy/trust boundary failures.
- Do not select operational-drift for unrelated agent-level history, and return no lenses for a clean artifact with no local service gap.

Return a JSON object with a single "lens_ids" array containing only the ids of lenses that should run on this artifact.
Example: {"lens_ids": ["context-neglect-gap"]}
Example with a recurring pattern: {"lens_ids": ["resolved-but-not-served", "operational-drift"]}
Return only valid JSON, no markdown, no explanation.`;
}

function parseLensIds(text: string | undefined, allLenses: LensDefinition[]): { lens_ids: string[] } | null {
  if (text === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "lens_ids" in parsed &&
      Array.isArray((parsed as Record<string, unknown>)["lens_ids"])
    ) {
      const rawIds = (parsed as Record<string, unknown>)["lens_ids"] as unknown[];
      const validIds = rawIds.filter((id): id is string => typeof id === "string");
      const allowedIds = new Set(allLenses.map((l) => l.id));
      return { lens_ids: validIds.filter((id) => allowedIds.has(id)) };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── step helpers ─────────────────────────────────────────────────────────────

function buildStepSystemInstruction(
  lens: LensDefinition,
  baseInstruction: string | undefined
): string {
  const base = baseInstruction ?? "";
  const guidance = `
IMPORTANT INSTRUCTIONS:
- You are running the "${lens.label}" audit lens (id: ${lens.id}).
- Core question: ${lens.core_question}
- Ground ALL findings exclusively in facts returned by tool calls.
- Do NOT infer, hallucinate, or reconstruct the actor agent's hidden context.
- Evidence strings must be privacy-safe summaries — never include raw sensitive values.
- When you have gathered sufficient evidence, return a JSON object with a "findings" array and optionally a "no_findings" array.
- Emit findings only when this lens has enough grounded evidence. If evidence is insufficient for this lens, emit a no_findings item instead of staying silent.
- Each finding must have: task_id, agent_id, lens, failure_mode, severity, confidence, evidence, recommended_action, human_review_required.
- Each no_findings item must have: task_id, agent_id, lens, reason, checked_tools, confidence.
- lens MUST be exactly "${lens.id}" for this step. Do not use a label, shorthand, legacy id, or neighboring lens id.
- severity MUST be one of: "low", "medium", "high", "critical".
- confidence MUST be a JSON number from 0.0 to 1.0, not a word such as "high".
- evidence MUST be a non-empty string array grounded in tool results.
- no_findings.reason should be concise, for example "insufficient_evidence" or "no_local_service_gap".
- no_findings.checked_tools MUST list the tools whose results were checked.
- If using tool calls, the JSON response will come after you have received all needed tool results.`;
  return base.length > 0 ? `${base}\n${guidance}` : guidance.trim();
}

function parseFinalResponse(text: string | undefined): { findings: LensFindingDraft[]; no_findings: LensNoFindingDraft[] } {
  if (text === undefined) return { findings: [], no_findings: [] };
  try {
    // Try to extract JSON from the text response — model may wrap it
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch !== null ? jsonMatch[0] : text;
    const parsed: unknown = JSON.parse(jsonStr);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { findings: [], no_findings: [] };
    }

    const record = parsed as Record<string, unknown>;
    const validFindings: LensFindingDraft[] = [];
    const validNoFindings: LensNoFindingDraft[] = [];

    if (Array.isArray(record["findings"])) {
      for (const draft of record["findings"]) {
        const result = validateLensFindingDraft(draft);
        if (result.ok) validFindings.push(result.value);
      }
    }

    if (Array.isArray(record["no_findings"])) {
      for (const draft of record["no_findings"]) {
        const result = validateLensNoFindingDraft(draft);
        if (result.ok) validNoFindings.push(result.value);
      }
    }

    return { findings: validFindings, no_findings: validNoFindings };
  } catch {
    return { findings: [], no_findings: [] };
  }
}

function buildUserPromptForStep(lens: LensDefinition): string {
  return `Please run the "${lens.label}" audit lens. Use the available tools to gather evidence, then return JSON with a "findings" array, or a "no_findings" array when evidence is insufficient for this lens.`;
}

// ─── createGeminiAdapter ──────────────────────────────────────────────────────

/**
 * Creates a Gemini-backed ReasoningAdapter.
 *
 * Pass `deps.generate` to override the SDK call for testing.
 * Without deps, the real @google/genai SDK is loaded lazily on first use.
 */
export function createGeminiAdapter(deps?: GeminiAdapterDeps): ReasoningAdapter {
  const injectedGenerate = deps?.generate;

  async function getGenerate(): Promise<GenerateFn> {
    if (injectedGenerate !== undefined) return injectedGenerate;
    return getRealGenerateFn();
  }

  return {
    name: "gemini",

    enabled(): boolean {
      return isGeminiEnabled();
    },

    async selectLenses(input: {
      artifact: AuditArtifact;
      profile: AgentProfile | null;
      lenses: LensDefinition[];
    }): Promise<{ lens_ids: string[] }> {
      const allIds = input.lenses.map((l) => l.id);
      const fallback = { lens_ids: allIds };

      if (input.lenses.length === 0) return { lens_ids: [] };

      const model = process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash";
      const prompt = buildSelectLensesPrompt(input.artifact, input.profile, input.lenses);

      try {
        const generate = await getGenerate();
        const raw = await generate({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            systemInstruction:
              "You are a JSON-only response agent. Always respond with valid JSON and nothing else.",
          },
        });

        const response = narrowResponse(raw);
        const parsed = parseLensIds(response.text, input.lenses);
        if (parsed !== null) return parsed;

        // Fail-open: return all lenses if parse failed
        return fallback;
      } catch {
        return fallback;
      }
    },

    async step(input: {
      lens: LensDefinition;
      messages: ReasoningMessage[];
      tools: ToolSchema[];
    }): Promise<ReasoningStep> {
      const model = process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash";
      const systemInstruction = extractSystemInstruction(input.messages);
      const enhancedSystem = buildStepSystemInstruction(input.lens, systemInstruction);
      const contents = buildContents(input.messages);

      // If there are no user/tool-result contents yet, add the initial user prompt
      const hasUserContent = contents.some((c) => c.role === "user");
      if (!hasUserContent) {
        contents.push({
          role: "user",
          parts: [{ text: buildUserPromptForStep(input.lens) }],
        });
      }

      const functionDeclarations = buildFunctionDeclarations(input.tools);

      const config: GenerateRequest["config"] = {
        systemInstruction: enhancedSystem,
      };
      if (functionDeclarations.length > 0) {
        config["tools"] = [{ functionDeclarations }];
      }

      try {
        const generate = await getGenerate();
        const raw = await generate({ model, contents, config });
        const response = narrowResponse(raw);

        // If the model returned function calls → tool_calls step
        if (
          response.functionCalls !== undefined &&
          response.functionCalls.length > 0
        ) {
          const calls: ToolCall[] = response.functionCalls
            .filter((fc) => typeof fc.name === "string")
            .map((fc) => ({
              tool: fc.name as string,
              input: fc.args ?? {},
            }));

          if (calls.length > 0) {
            return { kind: "tool_calls", calls };
          }
        }

        // Otherwise → final step with parsed findings
        const final = parseFinalResponse(response.text);
        return { kind: "final", findings: final.findings, no_findings: final.no_findings };
      } catch {
        return { kind: "final", findings: [] };
      }
    },
  };
}
