import type { AuditArtifact } from "../contracts/index.js";
import { evidenceOutputContradictionArtifact } from "./evidence-output-contradiction.js";
import { privacyRetentionArtifact } from "./privacy-retention.js";
import { guardrailFrictionArtifacts } from "./guardrail-friction.js";
import { falseResolutionDriftArtifacts } from "./false-resolution-drift.js";
import { controlArtifacts } from "./control-artifacts.js";

export { agentProfiles } from "./agent-profiles.js";
export {
  customerSupportProfile,
  recruitingProfile,
  devopsProfile,
} from "./agent-profiles.js";

export { evidenceOutputContradictionArtifact } from "./evidence-output-contradiction.js";
export { privacyRetentionArtifact } from "./privacy-retention.js";
export {
  guardrailFrictionArtifacts,
  guardrailFrictionHighFrequencyArtifact,
} from "./guardrail-friction.js";
export { falseResolutionDriftArtifacts } from "./false-resolution-drift.js";
export { controlArtifacts } from "./control-artifacts.js";

export const auditArtifacts: AuditArtifact[] = [
  evidenceOutputContradictionArtifact,
  privacyRetentionArtifact,
  ...guardrailFrictionArtifacts,
  ...falseResolutionDriftArtifacts,
  ...controlArtifacts,
];

export const allSeedArtifacts: AuditArtifact[] = auditArtifacts;
