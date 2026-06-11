import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AgentProfile } from "../contracts/agent-profile.js";
import type { LensFindingDraft, LensNoFindingDraft } from "../contracts/audit-finding.js";
import type { ToolSchema, ToolResult } from "../tools/types.js";
import type { LensDefinition } from "./lens-prompts.js";

export type ToolCall = { tool: string; input: unknown };

export type ReasoningMessage =
  | { role: "system"; content: string }
  | { role: "tool_result"; tool: string; result: ToolResult<unknown> };

export type ReasoningStep =
  | { kind: "tool_calls"; calls: ToolCall[] }
  | { kind: "final"; findings: LensFindingDraft[]; no_findings?: LensNoFindingDraft[] };

export type ReasoningAdapter = {
  name: string;
  enabled(): boolean;
  selectLenses(input: {
    artifact: AuditArtifact;
    profile: AgentProfile | null;
    lenses: LensDefinition[];
  }): Promise<{ lens_ids: string[] }>;
  step(input: {
    lens: LensDefinition;
    messages: ReasoningMessage[];
    tools: ToolSchema[];
  }): Promise<ReasoningStep>;
};
