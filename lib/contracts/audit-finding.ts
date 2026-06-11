import {
  type ValidationResult,
  ok,
  fail,
  isObject,
  isString,
  isNumber,
  requireString,
  requireStringArray,
  requireBoolean,
  checkEnum,
} from "./result.js";
import { SEVERITY_LEVELS, DETECTION_SOURCES, type Severity, type DetectionSource } from "./enums.js";

export type LensFindingDraft = {
  task_id: string;
  agent_id: string;
  lens: string;
  failure_mode: string;
  severity: Severity;
  confidence: number;
  evidence: string[];
  recommended_action: string;
  human_review_required: boolean;
  detection_source?: DetectionSource;
};

export type LensNoFindingDraft = {
  task_id: string;
  agent_id: string;
  lens: string;
  reason: string;
  checked_tools: string[];
  confidence: number;
};

export type AuditFinding = {
  finding_id: string;
  task_id: string;
  agent_id: string;
  lens: string;
  failure_mode: string;
  severity: Severity;
  confidence: number;
  evidence: string[];
  evidence_keywords: string[];
  recommended_action: string;
  human_review_required: boolean;
  converted_to_eval: boolean;
  cluster_id?: string;
  task_type?: string;
  detection_source?: DetectionSource;
  created_at: string;
  updated_at: string;
};

function validateConfidence(
  input: Record<string, unknown>,
  errors: string[]
): boolean {
  if (!isNumber(input["confidence"])) {
    errors.push("confidence must be a number");
    return false;
  }
  if (input["confidence"] < 0 || input["confidence"] > 1) {
    errors.push("confidence must be between 0 and 1 inclusive");
    return false;
  }
  return true;
}

export function validateLensFindingDraft(input: unknown): ValidationResult<LensFindingDraft> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];

  requireString(input, "task_id", errors);
  requireString(input, "agent_id", errors);
  requireString(input, "lens", errors);
  requireString(input, "failure_mode", errors);
  checkEnum(input["severity"], SEVERITY_LEVELS, "severity", errors);
  validateConfidence(input, errors);
  requireStringArray(input, "evidence", errors);
  requireString(input, "recommended_action", errors);
  requireBoolean(input, "human_review_required", errors);

  if ("detection_source" in input && input["detection_source"] !== undefined) {
    checkEnum(input["detection_source"], DETECTION_SOURCES, "detection_source", errors);
  }

  if (errors.length > 0) return fail(errors);

  const draftResult: LensFindingDraft = {
    task_id: input["task_id"] as string,
    agent_id: input["agent_id"] as string,
    lens: input["lens"] as string,
    failure_mode: input["failure_mode"] as string,
    severity: input["severity"] as Severity,
    confidence: input["confidence"] as number,
    evidence: input["evidence"] as string[],
    recommended_action: input["recommended_action"] as string,
    human_review_required: input["human_review_required"] as boolean,
  };

  if (isString(input["detection_source"]) && (DETECTION_SOURCES as readonly string[]).includes(input["detection_source"])) {
    draftResult.detection_source = input["detection_source"] as DetectionSource;
  }

  return ok(draftResult);
}

export function validateLensNoFindingDraft(input: unknown): ValidationResult<LensNoFindingDraft> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];

  requireString(input, "task_id", errors);
  requireString(input, "agent_id", errors);
  requireString(input, "lens", errors);
  requireString(input, "reason", errors);
  requireStringArray(input, "checked_tools", errors);
  validateConfidence(input, errors);

  if (errors.length > 0) return fail(errors);

  return ok({
    task_id: input["task_id"] as string,
    agent_id: input["agent_id"] as string,
    lens: input["lens"] as string,
    reason: input["reason"] as string,
    checked_tools: input["checked_tools"] as string[],
    confidence: input["confidence"] as number,
  });
}

export function validateAuditFinding(input: unknown): ValidationResult<AuditFinding> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];

  requireString(input, "finding_id", errors);
  requireString(input, "task_id", errors);
  requireString(input, "agent_id", errors);
  requireString(input, "lens", errors);
  requireString(input, "failure_mode", errors);
  checkEnum(input["severity"], SEVERITY_LEVELS, "severity", errors);
  validateConfidence(input, errors);
  requireStringArray(input, "evidence", errors);
  requireStringArray(input, "evidence_keywords", errors);
  requireString(input, "recommended_action", errors);
  requireBoolean(input, "human_review_required", errors);
  requireBoolean(input, "converted_to_eval", errors);
  requireString(input, "created_at", errors);
  requireString(input, "updated_at", errors);

  if ("cluster_id" in input && input["cluster_id"] !== undefined && !isString(input["cluster_id"])) {
    errors.push("cluster_id must be a string when provided");
  }

  if ("task_type" in input && input["task_type"] !== undefined && !isString(input["task_type"])) {
    errors.push("task_type must be a string when provided");
  }

  if ("detection_source" in input && input["detection_source"] !== undefined) {
    checkEnum(input["detection_source"], DETECTION_SOURCES, "detection_source", errors);
  }

  if (errors.length > 0) return fail(errors);

  const result: AuditFinding = {
    finding_id: input["finding_id"] as string,
    task_id: input["task_id"] as string,
    agent_id: input["agent_id"] as string,
    lens: input["lens"] as string,
    failure_mode: input["failure_mode"] as string,
    severity: input["severity"] as Severity,
    confidence: input["confidence"] as number,
    evidence: input["evidence"] as string[],
    evidence_keywords: input["evidence_keywords"] as string[],
    recommended_action: input["recommended_action"] as string,
    human_review_required: input["human_review_required"] as boolean,
    converted_to_eval: input["converted_to_eval"] as boolean,
    created_at: input["created_at"] as string,
    updated_at: input["updated_at"] as string,
  };

  if (isString(input["cluster_id"])) result.cluster_id = input["cluster_id"];
  if (isString(input["task_type"])) result.task_type = input["task_type"];
  if (isString(input["detection_source"]) && (DETECTION_SOURCES as readonly string[]).includes(input["detection_source"])) {
    result.detection_source = input["detection_source"] as DetectionSource;
  }

  return ok(result);
}
