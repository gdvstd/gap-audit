import { describe, it, expect } from "vitest";
import {
  validateAuditArtifact,
  validateAgentProfile,
} from "../../contracts/index.js";
import {
  agentProfiles,
  auditArtifacts,
  allSeedArtifacts,
} from "../index.js";
import { evidenceOutputContradictionArtifact } from "../evidence-output-contradiction.js";
import { privacyRetentionArtifact } from "../privacy-retention.js";
import { guardrailFrictionArtifacts } from "../guardrail-friction.js";
import { falseResolutionDriftArtifacts } from "../false-resolution-drift.js";
import { controlArtifacts } from "../control-artifacts.js";

// PII regex patterns
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/;
const PHONE_DIGITS_REGEX = /\d{10,}/;
const CREDIT_CARD_REGEX = /\d{16,}/;

function hasPII(text: string): boolean {
  return (
    EMAIL_REGEX.test(text) ||
    PHONE_DIGITS_REGEX.test(text) ||
    CREDIT_CARD_REGEX.test(text)
  );
}

describe("seed agent profiles", () => {
  it("every agent profile validates cleanly", () => {
    for (const profile of agentProfiles) {
      const result = validateAgentProfile(profile);
      expect(result.ok, `profile ${profile.agent_id} failed: ${!result.ok ? result.errors.join(", ") : ""}`).toBe(true);
    }
  });

  it("includes customer-support, recruiting, and devops profiles", () => {
    const ids = agentProfiles.map((p) => p.agent_id);
    expect(ids).toContain("agent-support-01");
    expect(ids).toContain("agent-recruiting-01");
    expect(ids).toContain("agent-devops-01");
  });
});

describe("seed audit artifacts — schema validation", () => {
  it("every artifact in allSeedArtifacts validates cleanly", () => {
    for (const artifact of allSeedArtifacts) {
      const result = validateAuditArtifact(artifact);
      expect(
        result.ok,
        `task ${artifact.task_id} failed: ${!result.ok ? result.errors.join(", ") : ""}`
      ).toBe(true);
    }
  });

  it("every artifact's agent_id has a matching AgentProfile", () => {
    const profileIds = new Set(agentProfiles.map((p) => p.agent_id));
    for (const artifact of allSeedArtifacts) {
      expect(
        profileIds.has(artifact.agent_id),
        `artifact ${artifact.task_id} references unknown agent_id "${artifact.agent_id}"`
      ).toBe(true);
    }
  });
});

describe("case 1 — evidence-output contradiction", () => {
  it("has a successful tool fact retrieving the enterprise refund exception", () => {
    const successFact = evidenceOutputContradictionArtifact.tool_facts.find(
      (tf) => tf.status === "success"
    );
    expect(successFact).toBeDefined();
    // The fact text should indicate the enterprise refund exception
    expect(successFact!.fact.toLowerCase()).toMatch(
      /enterprise|exception|refund|incomplete.onboarding/i
    );
  });

  it("has a final_output_summary that signals denial/rejection", () => {
    const summary = evidenceOutputContradictionArtifact.final_output_summary.toLowerCase();
    expect(summary).toMatch(/denied|rejected|not eligible|cannot process|refund denied/i);
  });

  it("has agent_status resolved with high confidence", () => {
    expect(evidenceOutputContradictionArtifact.agent_status).toBe("resolved");
    expect(evidenceOutputContradictionArtifact.agent_confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("has an external irreversible action", () => {
    const externalAction = evidenceOutputContradictionArtifact.actions_taken.find(
      (a) => a.visibility === "external" && a.reversible === false
    );
    expect(externalAction).toBeDefined();
  });
});

describe("case 2 — privacy retention", () => {
  it("has sensitive_entity_types including phone_number and salary_expectation", () => {
    expect(privacyRetentionArtifact.sensitive_entity_types).toContain("phone_number");
    expect(privacyRetentionArtifact.sensitive_entity_types).toContain("salary_expectation");
  });

  it("has at least one memory_write whose sensitive_entity_types overlaps with the artifact's", () => {
    const artifactTypes = new Set(privacyRetentionArtifact.sensitive_entity_types);
    const overlappingWrite = privacyRetentionArtifact.memory_writes.find((mw) =>
      mw.sensitive_entity_types.some((t) => artifactTypes.has(t))
    );
    expect(overlappingWrite).toBeDefined();
  });

  it("has at least one memory_write with retention_risk high or critical in long-term/eval store", () => {
    const riskyWrite = privacyRetentionArtifact.memory_writes.find(
      (mw) =>
        (mw.retention_risk === "high" || mw.retention_risk === "critical") &&
        /long.term|eval|dataset|log/i.test(mw.store)
    );
    expect(riskyWrite).toBeDefined();
  });
});

describe("case 3 — guardrail friction", () => {
  it("contains at least 5 artifacts", () => {
    expect(guardrailFrictionArtifacts.length).toBeGreaterThanOrEqual(5);
  });

  it("all artifacts share the same agent_id", () => {
    const ids = guardrailFrictionArtifacts.map((a) => a.agent_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(1);
  });

  it("every artifact has at least one guardrail_events entry with privacy-boundary type and customer-identifier reason", () => {
    for (const artifact of guardrailFrictionArtifacts) {
      const privacyBlock = artifact.guardrail_events.find(
        (e) =>
          e.type === "privacy-boundary" &&
          e.reason === "customer-identifier-in-external-reply"
      );
      expect(
        privacyBlock,
        `artifact ${artifact.task_id} missing expected guardrail event`
      ).toBeDefined();
    }
  });

  it("at least one artifact has count:23 and time_window:P7D guardrail event", () => {
    const highFrequencyArtifact = guardrailFrictionArtifacts.find((a) =>
      a.guardrail_events.some(
        (e) => e.count === 23 && e.time_window === "P7D"
      )
    );
    expect(highFrequencyArtifact).toBeDefined();
  });
});

describe("case 4 — false resolution drift", () => {
  it("contains at least 9 artifacts", () => {
    expect(falseResolutionDriftArtifacts.length).toBeGreaterThanOrEqual(9);
  });

  it("all artifacts share the same agent_id", () => {
    const ids = falseResolutionDriftArtifacts.map((a) => a.agent_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(1);
  });

  it("all artifacts have agent_status resolved", () => {
    for (const artifact of falseResolutionDriftArtifacts) {
      expect(artifact.agent_status).toBe("resolved");
    }
  });

  it("all artifacts have task_type incident-response", () => {
    for (const artifact of falseResolutionDriftArtifacts) {
      expect(artifact.task_type).toBe("incident-response");
    }
  });

  it("all artifacts have a service-restart tool fact with status success", () => {
    for (const artifact of falseResolutionDriftArtifacts) {
      const restartFact = artifact.tool_facts.find(
        (tf) => tf.tool === "service-restart" && tf.status === "success"
      );
      expect(
        restartFact,
        `artifact ${artifact.task_id} missing service-restart success fact`
      ).toBeDefined();
    }
  });

  it("no artifact has a verification_artifact of type metric-recovery with status passed", () => {
    for (const artifact of falseResolutionDriftArtifacts) {
      if (!artifact.verification_artifacts) continue;
      const passedMetricRecovery = artifact.verification_artifacts.find(
        (va) => va.type === "metric-recovery" && va.status === "passed"
      );
      expect(
        passedMetricRecovery,
        `artifact ${artifact.task_id} unexpectedly has passed metric-recovery`
      ).toBeUndefined();
    }
  });
});

describe("control artifacts", () => {
  it("all control artifacts validate cleanly", () => {
    for (const artifact of controlArtifacts) {
      const result = validateAuditArtifact(artifact);
      expect(result.ok, `control ${artifact.task_id} failed: ${!result.ok ? result.errors.join(", ") : ""}`).toBe(true);
    }
  });

  it("all control artifacts have agent_status resolved", () => {
    for (const artifact of controlArtifacts) {
      expect(artifact.agent_status).toBe("resolved");
    }
  });

  it("at least one control artifact has a verification artifact with status passed", () => {
    const withPassed = controlArtifacts.find((a) =>
      a.verification_artifacts?.some((va) => va.status === "passed")
    );
    expect(withPassed).toBeDefined();
  });
});

describe("allSeedArtifacts combined count", () => {
  it("equals the sum of individual case exports plus controls", () => {
    const expected =
      1 + // case 1: single artifact
      1 + // case 2: single artifact
      guardrailFrictionArtifacts.length +
      falseResolutionDriftArtifacts.length +
      controlArtifacts.length;
    expect(allSeedArtifacts.length).toBe(expected);
    expect(auditArtifacts.length).toBe(expected);
  });
});

describe("PII safety — no raw PII in seed strings", () => {
  it("no artifact contains email-like patterns in key text fields", () => {
    for (const artifact of allSeedArtifacts) {
      const texts = [
        artifact.final_output_summary,
        artifact.user_input_summary,
        ...artifact.memory_writes.map((mw) => mw.content_summary),
      ];
      for (const text of texts) {
        expect(
          EMAIL_REGEX.test(text),
          `artifact ${artifact.task_id} contains email-like pattern: "${text}"`
        ).toBe(false);
      }
    }
  });

  it("no artifact contains 10+ consecutive digit sequences in key text fields", () => {
    for (const artifact of allSeedArtifacts) {
      const texts = [
        artifact.final_output_summary,
        artifact.user_input_summary,
        ...artifact.memory_writes.map((mw) => mw.content_summary),
      ];
      for (const text of texts) {
        expect(
          PHONE_DIGITS_REGEX.test(text),
          `artifact ${artifact.task_id} contains phone-like digit sequence: "${text}"`
        ).toBe(false);
      }
    }
  });

  it("no artifact contains 16+ consecutive digit sequences in key text fields", () => {
    for (const artifact of allSeedArtifacts) {
      const texts = [
        artifact.final_output_summary,
        artifact.user_input_summary,
        ...artifact.memory_writes.map((mw) => mw.content_summary),
      ];
      for (const text of texts) {
        expect(
          CREDIT_CARD_REGEX.test(text),
          `artifact ${artifact.task_id} contains credit-card-like digit sequence: "${text}"`
        ).toBe(false);
      }
    }
  });
});
