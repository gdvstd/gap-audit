import { randomUUID } from "node:crypto";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AuditFinding, LensFindingDraft, LensNoFindingDraft } from "../contracts/audit-finding.js";
import { validateAuditFinding } from "../contracts/audit-finding.js";
import type { AgentProfile } from "../contracts/agent-profile.js";
import type { AuditMemoryAdapter } from "../audit-memory/adapter.js";
import type { ReasoningAdapter } from "./reasoning-adapter.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createToolRegistry } from "../tools/registry.js";
import { buildLensPrompt } from "./build-lens-prompt.js";
import { allLensDefinitions, type LensDefinition } from "./lens-prompts.js";
import { selectLensesForArtifact } from "./triage.js";
import { extractEvidenceKeywords } from "../clusterer/evidence-keywords.js";
import { runClusterer } from "../clusterer/clusterer.js";
import type { ReasoningMessage } from "./reasoning-adapter.js";

const DEFAULT_MAX_STEPS = 8;

export type AuditArtifactResult = {
  findings: LensFindingDraft[];
  no_findings: LensNoFindingDraft[];
};

export type LensSelectionMode = "all" | "adapter";

function sortedLensPool(lenses: LensDefinition[]): LensDefinition[] {
  return [...lenses].sort((a, b) => a.priority - b.priority);
}

function syntheticNoFinding(input: {
  artifact: AuditArtifact;
  lens: LensDefinition;
  reason: string;
  checkedTools: string[];
}): LensNoFindingDraft {
  return {
    task_id: input.artifact.task_id,
    agent_id: input.artifact.agent_id,
    lens: input.lens.id,
    reason: input.reason,
    checked_tools: [...new Set(input.checkedTools)].sort(),
    confidence: 0.7,
  };
}

/**
 * Audit a single artifact across a lens pool.
 *
 * By default, GapAudit runs every configured lens as a bounded agentic
 * investigation. Adapter-based triage is still available as an explicit mode,
 * but the normal path lets each lens decide finding vs no_finding from tools.
 */
export async function auditArtifact(input: {
  artifact: AuditArtifact;
  adapter: ReasoningAdapter;
  registry: ToolRegistry;
  lenses?: LensDefinition[];
  profile?: AgentProfile | null;
  maxStepsPerLens?: number;
  lensSelection?: LensSelectionMode;
}): Promise<AuditArtifactResult> {
  const {
    artifact,
    adapter,
    registry,
    profile = null,
    maxStepsPerLens = DEFAULT_MAX_STEPS,
  } = input;

  const lensPool = sortedLensPool(input.lenses ?? allLensDefinitions);
  const lensSelection = input.lensSelection ?? "all";

  const selectedLenses = lensSelection === "adapter"
    ? await selectLensesForArtifact({ artifact, profile, adapter, lenses: lensPool })
    : lensPool;

  const allSurvivingDrafts: LensFindingDraft[] = [];
  const allNoFindings: LensNoFindingDraft[] = [];

  for (const lens of selectedLenses) {
    const messages: ReasoningMessage[] = [
      { role: "system", content: buildLensPrompt(lens, artifact) },
    ];

    let successfulToolCalls = 0;
    let attemptedToolCalls = 0;
    const attemptedToolNames: string[] = [];
    const successfulToolNames: string[] = [];
    let lensDrafts: LensFindingDraft[] = [];
    let lensNoFindings: LensNoFindingDraft[] = [];
    let reachedFinal = false;

    for (let step = 0; step < maxStepsPerLens; step++) {
      const result = await adapter.step({ lens, messages, tools: registry.schemas });

      if (result.kind === "tool_calls") {
        for (const call of result.calls) {
          attemptedToolCalls++;
          attemptedToolNames.push(call.tool);
          const toolResult = await registry.dispatch({ tool: call.tool, input: call.input });
          messages.push({ role: "tool_result", tool: call.tool, result: toolResult });
          if (toolResult.ok) {
            successfulToolCalls++;
            successfulToolNames.push(call.tool);
          }
        }
        continue;
      }

      // kind === "final"
      lensDrafts = result.findings;
      lensNoFindings = result.no_findings ?? [];
      reachedFinal = true;
      break;
    }

    // Evidence-traceability gate:
    // - If no tools were attempted, drop both findings and no_findings.
    // - If tools were attempted but none succeeded, findings cannot survive,
    //   but the lens should still report unavailable evidence as no_finding.
    // - If no "final" was reached within cap, return a bounded no_finding only
    //   when at least one tool result succeeded.
    if (attemptedToolCalls === 0) {
      continue;
    }

    if (successfulToolCalls === 0) {
      // Adapter-provided findings/no_findings are not evidence-backed when every
      // attempted tool failed; normalize this as unavailable evidence.
      allNoFindings.push(syntheticNoFinding({
        artifact,
        lens,
        reason: "tool_evidence_unavailable",
        checkedTools: attemptedToolNames,
      }));
      continue;
    }

    if (!reachedFinal) {
      allNoFindings.push(syntheticNoFinding({
        artifact,
        lens,
        reason: "max_steps_reached_without_final",
        checkedTools: successfulToolNames,
      }));
      continue;
    }

    if (lensDrafts.length > 0) {
      for (const draft of lensDrafts) {
        allSurvivingDrafts.push(draft);
      }
      continue;
    }

    if (lensNoFindings.length > 0) {
      for (const draft of lensNoFindings) {
        allNoFindings.push(draft);
      }
    } else {
      allNoFindings.push(syntheticNoFinding({
        artifact,
        lens,
        reason: "insufficient_evidence",
        checkedTools: successfulToolNames,
      }));
    }
  }

  return { findings: allSurvivingDrafts, no_findings: allNoFindings };
}

export type AuditRunResult = {
  run_id: string;
  finding_count: number;
  finding_ids: string[];
  no_finding_count: number;
  no_findings: LensNoFindingDraft[];
};

/**
 * Run the full audit over a list of artifacts, sequentially so that
 * history-aware lenses can see prior findings from earlier artifacts.
 *
 * Mirrors the old runner's enrichment + sequencing exactly.
 */
export async function runAudit(input: {
  artifacts: AuditArtifact[];
  adapter: ReasoningAdapter;
  memory: AuditMemoryAdapter;
  lenses?: LensDefinition[];
  now?: () => Date;
  idFactory?: () => string;
  lensSelection?: LensSelectionMode;
}): Promise<AuditRunResult> {
  const { artifacts, adapter, memory, lenses } = input;

  const makeId = input.idFactory ?? (() => randomUUID());
  const makeDate = input.now ?? (() => new Date());

  const run_id = makeId();
  const registry = createToolRegistry({ memory });

  const allFindingIds: string[] = [];
  const allNoFindings: LensNoFindingDraft[] = [];
  let totalFindingCount = 0;

  for (const artifact of artifacts) {
    const auditInput: Parameters<typeof auditArtifact>[0] = {
      artifact,
      adapter,
      registry,
    };
    if (lenses !== undefined) {
      auditInput.lenses = lenses;
    }
    if (input.lensSelection !== undefined) {
      auditInput.lensSelection = input.lensSelection;
    }
    const artifactResult = await auditArtifact(auditInput);
    const drafts = artifactResult.findings;
    allNoFindings.push(...artifactResult.no_findings);

    if (drafts.length === 0) {
      continue;
    }

    const nowDate = makeDate();
    const isoDate = nowDate.toISOString();

    const artifactFindings: AuditFinding[] = [];

    for (const draft of drafts) {
      const finding_id = makeId();

      // Mirror the old runner's enrichment exactly.
      // Use Omit trick to build base without optional fields, then conditionally add them.
      const findingBase: Omit<AuditFinding, "task_type" | "detection_source"> = {
        finding_id,
        task_id: draft.task_id,
        agent_id: draft.agent_id,
        lens: draft.lens,
        failure_mode: draft.failure_mode,
        severity: draft.severity,
        confidence: draft.confidence,
        evidence: [...draft.evidence],
        evidence_keywords: extractEvidenceKeywords(draft.evidence),
        recommended_action: draft.recommended_action,
        human_review_required: draft.human_review_required,
        converted_to_eval: false,
        created_at: isoDate,
        updated_at: isoDate,
      };

      // Respect exactOptionalPropertyTypes: only include optional fields when defined
      const finding: AuditFinding = {
        ...findingBase,
        ...(artifact.task_type !== undefined ? { task_type: artifact.task_type } : {}),
        ...(draft.detection_source !== undefined ? { detection_source: draft.detection_source } : {}),
      };

      const validated = validateAuditFinding(finding);
      if (!validated.ok) {
        throw new Error(
          `Lens '${draft.lens}' produced an invalid finding: ${validated.errors.join("; ")}`
        );
      }

      artifactFindings.push(finding);
    }

    // Persist after each artifact so history-aware lenses see prior findings
    await memory.saveFindings(artifactFindings);
    for (const f of artifactFindings) {
      allFindingIds.push(f.finding_id);
    }
    totalFindingCount += artifactFindings.length;
  }

  await runClusterer({ memory, now: makeDate, idFactory: makeId });

  return {
    run_id,
    finding_count: totalFindingCount,
    finding_ids: allFindingIds,
    no_finding_count: allNoFindings.length,
    no_findings: allNoFindings,
  };
}
