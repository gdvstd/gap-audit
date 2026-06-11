import {
  type ValidationResult,
  ok,
  fail,
  isObject,
  isString,
  isStringArray,
  requireString,
  requireStringArray,
} from "./result.js";

export type RegressionEvalCase = {
  eval_id: string;
  source_finding_id: string;
  agent_id: string;
  input: string;
  expected_behavior: string[];
  failure_mode_guarded: string;
  required_evidence_usage?: string[];
  prohibited_patterns?: string[];
  privacy_constraints?: string[];
  // Which regression suite (Phoenix dataset) this test case belongs to.
  dataset_name?: string;
  // Snapshot of the suite's judge prompt at conversion time (authoritative copy lives on
  // the RegressionSuite). The judge prompt is per-suite, not per-case.
  judge_prompt?: string;
  // Id of the example created in the Phoenix dataset, when pushed.
  phoenix_example_id?: string;
  created_at: string;
};

/**
 * A regression suite = a Phoenix dataset (accumulating test examples) + ONE judge prompt
 * that evaluates every example in it. Grouped by the failure mode it guards against.
 */
export type RegressionSuite = {
  dataset_name: string;
  failure_mode: string;
  lens?: string;
  judge_prompt: string;
  phoenix_dataset_id?: string;
  example_count?: number;
  created_at: string;
  updated_at: string;
};

export function validateRegressionSuite(input: unknown): ValidationResult<RegressionSuite> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];
  requireString(input, "dataset_name", errors);
  requireString(input, "failure_mode", errors);
  requireString(input, "judge_prompt", errors);
  requireString(input, "created_at", errors);
  requireString(input, "updated_at", errors);
  if (errors.length > 0) return fail(errors);
  const result: RegressionSuite = {
    dataset_name: input["dataset_name"] as string,
    failure_mode: input["failure_mode"] as string,
    judge_prompt: input["judge_prompt"] as string,
    created_at: input["created_at"] as string,
    updated_at: input["updated_at"] as string,
  };
  if (isString(input["lens"])) result.lens = input["lens"];
  if (isString(input["phoenix_dataset_id"])) result.phoenix_dataset_id = input["phoenix_dataset_id"];
  return ok(result);
}

function optionalStringArray(
  input: Record<string, unknown>,
  field: string,
  errors: string[]
): string[] | undefined {
  if (!(field in input) || input[field] === undefined) return undefined;
  if (!isStringArray(input[field])) {
    errors.push(`${field} must be an array of strings when provided`);
    return undefined;
  }
  return input[field] as string[];
}

export function validateRegressionEvalCase(input: unknown): ValidationResult<RegressionEvalCase> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];

  requireString(input, "eval_id", errors);
  requireString(input, "source_finding_id", errors);
  requireString(input, "agent_id", errors);
  requireString(input, "input", errors);
  requireStringArray(input, "expected_behavior", errors);
  requireString(input, "failure_mode_guarded", errors);
  requireString(input, "created_at", errors);

  const requiredEvidenceUsage = optionalStringArray(input, "required_evidence_usage", errors);
  const prohibitedPatterns = optionalStringArray(input, "prohibited_patterns", errors);
  const privacyConstraints = optionalStringArray(input, "privacy_constraints", errors);

  if (errors.length > 0) return fail(errors);

  const result: RegressionEvalCase = {
    eval_id: input["eval_id"] as string,
    source_finding_id: input["source_finding_id"] as string,
    agent_id: input["agent_id"] as string,
    input: input["input"] as string,
    expected_behavior: input["expected_behavior"] as string[],
    failure_mode_guarded: input["failure_mode_guarded"] as string,
    created_at: input["created_at"] as string,
  };

  if (requiredEvidenceUsage !== undefined) result.required_evidence_usage = requiredEvidenceUsage;
  if (prohibitedPatterns !== undefined) result.prohibited_patterns = prohibitedPatterns;
  if (privacyConstraints !== undefined) result.privacy_constraints = privacyConstraints;
  if (isString(input["dataset_name"])) result.dataset_name = input["dataset_name"];
  if (isString(input["judge_prompt"])) result.judge_prompt = input["judge_prompt"];
  if (isString(input["phoenix_example_id"])) result.phoenix_example_id = input["phoenix_example_id"];

  return ok(result);
}
