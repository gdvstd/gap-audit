// Interfaces
export type {
  ToolCall,
  ReasoningMessage,
  ReasoningStep,
  ReasoningAdapter,
} from "./reasoning-adapter.js";

// Lens definitions
export type { LensDefinition } from "./lens-prompts.js";
export {
  allLensDefinitions,
  mvpLensDefinitions,
  getLensDefinition,
} from "./lens-prompts.js";

// Prompt builder
export { buildLensPrompt } from "./build-lens-prompt.js";

// Scripted adapter (test double)
export type { ScriptedAdapterConfig } from "./scripted-adapter.js";
export { createScriptedAdapter } from "./scripted-adapter.js";

// Triage
export { selectLensesForArtifact } from "./triage.js";

// Auditor
export type { AuditRunResult } from "./auditor.js";
export { auditArtifact, runAudit } from "./auditor.js";

// Demo adapter
export { createDemoAdapter } from "./demo-adapter.js";

// Gemini adapter
export type { GenerateFn, GeminiAdapterDeps, GenerateRequest } from "./gemini-adapter.js";
export { createGeminiAdapter } from "./gemini-adapter.js";

// Adapter selector
export { createAuditAdapter } from "./create-adapter.js";
