import {
  type ValidationResult,
  ok,
  fail,
  isObject,
  isString,
  requireString,
  checkEnum,
} from "./result.js";
import { REVIEW_DECISIONS, type ReviewDecisionValue } from "./enums.js";

export type ReviewDecision = {
  finding_id: string;
  decision: ReviewDecisionValue;
  reviewer_id?: string;
  reason?: string;
  decided_at: string;
};

export function validateReviewDecision(input: unknown): ValidationResult<ReviewDecision> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];

  requireString(input, "finding_id", errors);
  checkEnum(input["decision"], REVIEW_DECISIONS, "decision", errors);
  requireString(input, "decided_at", errors);

  if ("reviewer_id" in input && input["reviewer_id"] !== undefined && !isString(input["reviewer_id"])) {
    errors.push("reviewer_id must be a string when provided");
  }
  if ("reason" in input && input["reason"] !== undefined && !isString(input["reason"])) {
    errors.push("reason must be a string when provided");
  }

  if (errors.length > 0) return fail(errors);

  const result: ReviewDecision = {
    finding_id: input["finding_id"] as string,
    decision: input["decision"] as ReviewDecisionValue,
    decided_at: input["decided_at"] as string,
  };

  if (isString(input["reviewer_id"])) result.reviewer_id = input["reviewer_id"];
  if (isString(input["reason"])) result.reason = input["reason"];

  return ok(result);
}
