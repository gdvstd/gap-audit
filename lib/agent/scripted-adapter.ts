import type { ReasoningAdapter, ReasoningStep, ReasoningMessage, ToolCall } from "./reasoning-adapter.js";
import type { LensDefinition } from "./lens-prompts.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AgentProfile } from "../contracts/agent-profile.js";
import type { ToolSchema } from "../tools/types.js";

export type ScriptedAdapterConfig = {
  name?: string;
  enabled?: boolean;
  selectLenses: { lens_ids: string[] };
  lensScripts: Record<string, ReasoningStep[]>;
};

/**
 * Deterministic test double for ReasoningAdapter.
 *
 * Replays a fixed sequence of ReasoningSteps keyed by lens id.
 * Each call to step() advances a per-lens cursor. When the cursor
 * exceeds the script or no script exists for the lens, returns
 * { kind: "final", findings: [] }.
 */
export function createScriptedAdapter(config: ScriptedAdapterConfig): ReasoningAdapter {
  const cursors = new Map<string, number>();

  return {
    name: config.name ?? "scripted",

    enabled(): boolean {
      return config.enabled ?? true;
    },

    async selectLenses(_input: {
      artifact: AuditArtifact;
      profile: AgentProfile | null;
      lenses: LensDefinition[];
    }): Promise<{ lens_ids: string[] }> {
      return { lens_ids: [...config.selectLenses.lens_ids] };
    },

    async step(input: {
      lens: LensDefinition;
      messages: ReasoningMessage[];
      tools: ToolSchema[];
    }): Promise<ReasoningStep> {
      const lensId = input.lens.id;
      const script = config.lensScripts[lensId];

      if (script === undefined || script.length === 0) {
        return { kind: "final", findings: [] };
      }

      const cursor = cursors.get(lensId) ?? 0;

      if (cursor >= script.length) {
        return { kind: "final", findings: [] };
      }

      cursors.set(lensId, cursor + 1);
      return script[cursor]!;
    },
  };
}
