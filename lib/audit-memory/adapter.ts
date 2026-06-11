import type { AgentProfile } from "../contracts/agent-profile.js";
import type { AuditArtifact } from "../contracts/audit-artifact.js";
import type { AuditFinding } from "../contracts/audit-finding.js";
import type { PatternCluster } from "../contracts/pattern-cluster.js";
import type { ReviewDecision } from "../contracts/review-decision.js";
import type { RegressionEvalCase } from "../contracts/regression-eval-case.js";

export type AuditMemoryAdapter = {
  name: string;
  enabled(): boolean;
  saveAgentProfiles(profiles: AgentProfile[]): Promise<void>;
  getAgentProfile(agent_id: string): Promise<AgentProfile | null>;
  saveArtifacts(artifacts: AuditArtifact[]): Promise<void>;
  getArtifact(task_id: string): Promise<AuditArtifact | null>;
  listArtifacts(input?: { agent_id?: string }): Promise<AuditArtifact[]>;
  saveFindings(findings: AuditFinding[]): Promise<void>;
  listFindings(input?: { agent_id?: string; severity?: AuditFinding["severity"] }): Promise<AuditFinding[]>;
  saveReviewDecision(decision: ReviewDecision): Promise<void>;
  listReviewDecisions(input?: { finding_id?: string }): Promise<ReviewDecision[]>;
  saveEvalCase(evalCase: RegressionEvalCase): Promise<void>;
  listEvalCases(input?: { agent_id?: string; source_finding_id?: string }): Promise<RegressionEvalCase[]>;
  listClusters(): Promise<PatternCluster[]>;
  saveClusters(clusters: PatternCluster[]): Promise<void>;
  updateFinding(
    finding_id: string,
    partial: Partial<Pick<AuditFinding, "cluster_id" | "converted_to_eval" | "updated_at" | "task_type">>
  ): Promise<AuditFinding>;
  /** Record that these task_ids have been swept (idempotent upsert). */
  markAudited(task_ids: string[]): Promise<void>;
  /** Return all task_ids that have been marked swept. */
  listAuditedTaskIds(): Promise<string[]>;
};
