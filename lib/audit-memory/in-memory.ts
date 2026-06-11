import type { AgentProfile } from "../contracts/agent-profile.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { PatternCluster } from "../contracts/pattern-cluster.js";
import type { ReviewDecision } from "../contracts/review-decision.js";
import type { RegressionEvalCase } from "../contracts/regression-eval-case.js";
import type { AuditMemoryAdapter } from "./adapter.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryAuditMemory(): AuditMemoryAdapter {
  const agentProfiles = new Map<string, AgentProfile>();
  const artifacts = new Map<string, AuditArtifact>();
  const findings = new Map<string, AuditFinding>();
  const reviewDecisions = new Map<string, ReviewDecision>();
  const evalCases = new Map<string, RegressionEvalCase>();
  const clusters = new Map<string, PatternCluster>();
  const swept = new Set<string>();

  return {
    name: "in-memory",

    enabled(): boolean {
      return true;
    },

    async saveAgentProfiles(input: AgentProfile[]): Promise<void> {
      for (const profile of input) {
        agentProfiles.set(profile.agent_id, clone(profile));
      }
    },

    async getAgentProfile(agent_id: string): Promise<AgentProfile | null> {
      const profile = agentProfiles.get(agent_id);
      return profile !== undefined ? clone(profile) : null;
    },

    async saveArtifacts(input: AuditArtifact[]): Promise<void> {
      for (const artifact of input) {
        artifacts.set(artifact.task_id, clone(artifact));
      }
    },

    async getArtifact(task_id: string): Promise<AuditArtifact | null> {
      const artifact = artifacts.get(task_id);
      return artifact !== undefined ? clone(artifact) : null;
    },

    async listArtifacts(input?: { agent_id?: string }): Promise<AuditArtifact[]> {
      const all = Array.from(artifacts.values());
      return all
        .filter((a) => {
          if (input?.agent_id !== undefined && a.agent_id !== input.agent_id) return false;
          return true;
        })
        .map((a) => clone(a));
    },

    async saveFindings(input: AuditFinding[]): Promise<void> {
      for (const finding of input) {
        findings.set(finding.finding_id, clone(finding));
      }
    },

    async listFindings(input?: { agent_id?: string; severity?: AuditFinding["severity"] }): Promise<AuditFinding[]> {
      const all = Array.from(findings.values());
      return all.filter((f) => {
        if (input?.agent_id !== undefined && f.agent_id !== input.agent_id) return false;
        if (input?.severity !== undefined && f.severity !== input.severity) return false;
        return true;
      }).map((f) => clone(f));
    },

    async saveReviewDecision(decision: ReviewDecision): Promise<void> {
      reviewDecisions.set(decision.finding_id, clone(decision));
    },

    async saveEvalCase(evalCase: RegressionEvalCase): Promise<void> {
      evalCases.set(evalCase.eval_id, clone(evalCase));
    },

    async listEvalCases(input?: { agent_id?: string; source_finding_id?: string }): Promise<RegressionEvalCase[]> {
      const all = Array.from(evalCases.values());
      return all.filter((e) => {
        if (input?.agent_id !== undefined && e.agent_id !== input.agent_id) return false;
        if (input?.source_finding_id !== undefined && e.source_finding_id !== input.source_finding_id) return false;
        return true;
      }).map((e) => clone(e));
    },

    async listClusters(): Promise<PatternCluster[]> {
      return Array.from(clusters.values()).map((c) => clone(c));
    },

    async saveClusters(input: PatternCluster[]): Promise<void> {
      for (const cluster of input) {
        clusters.set(cluster.cluster_id, clone(cluster));
      }
    },

    async listReviewDecisions(input?: { finding_id?: string }): Promise<ReviewDecision[]> {
      const all = Array.from(reviewDecisions.values());
      return all.filter((d) => {
        if (input?.finding_id !== undefined && d.finding_id !== input.finding_id) return false;
        return true;
      }).map((d) => clone(d));
    },

    async updateFinding(
      finding_id: string,
      partial: Partial<Pick<AuditFinding, "cluster_id" | "converted_to_eval" | "updated_at" | "task_type">>
    ): Promise<AuditFinding> {
      const existing = findings.get(finding_id);
      if (existing === undefined) {
        throw new Error(`updateFinding: finding_id '${finding_id}' not found`);
      }
      const merged: AuditFinding = { ...clone(existing), ...clone(partial) };
      findings.set(finding_id, merged);
      return clone(merged);
    },

    async markAudited(task_ids: string[]): Promise<void> {
      for (const id of task_ids) {
        swept.add(id);
      }
    },

    async listAuditedTaskIds(): Promise<string[]> {
      return Array.from(swept);
    },
  };
}
