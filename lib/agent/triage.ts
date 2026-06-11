import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AgentProfile } from "../contracts/agent-profile.js";
import type { ReasoningAdapter } from "./reasoning-adapter.js";
import { allLensDefinitions, type LensDefinition } from "./lens-prompts.js";

/**
 * Ask the adapter which lenses apply to this artifact, then resolve the
 * ids back to LensDefinition objects (dropping unknown ids) and sort by priority.
 */
export async function selectLensesForArtifact(input: {
  artifact: AuditArtifact;
  profile: AgentProfile | null;
  adapter: ReasoningAdapter;
  lenses?: LensDefinition[];
}): Promise<LensDefinition[]> {
  const { artifact, profile, adapter } = input;
  const pool = input.lenses ?? allLensDefinitions;

  const poolById = new Map<string, LensDefinition>(pool.map((l) => [l.id, l]));

  const { lens_ids } = await adapter.selectLenses({ artifact, profile, lenses: pool });

  const resolved: LensDefinition[] = [];
  for (const id of lens_ids) {
    const lens = poolById.get(id);
    if (lens !== undefined) {
      resolved.push(lens);
    }
  }

  return resolved.sort((a, b) => a.priority - b.priority);
}
