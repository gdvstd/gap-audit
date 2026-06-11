import {
  type ValidationResult,
  ok,
  fail,
  isObject,
  isNumber,
  requireString,
  requireStringArray,
  checkEnum,
} from "./result.js";
import { SEVERITY_LEVELS, TREND_VALUES, type Severity, type Trend } from "./enums.js";

export type PatternCluster = {
  cluster_id: string;
  agent_id: string;
  pattern_name: string;
  finding_count: number;
  time_window: string;
  dominant_lenses: string[];
  severity: Severity;
  trend: Trend;
  recommended_action: string;
  finding_ids: string[];
};

export function validatePatternCluster(input: unknown): ValidationResult<PatternCluster> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];

  requireString(input, "cluster_id", errors);
  requireString(input, "agent_id", errors);
  requireString(input, "pattern_name", errors);

  if (!isNumber(input["finding_count"])) {
    errors.push("finding_count must be a number");
  } else if (input["finding_count"] < 0) {
    errors.push("finding_count must be >= 0");
  }

  requireString(input, "time_window", errors);
  requireStringArray(input, "dominant_lenses", errors);
  checkEnum(input["severity"], SEVERITY_LEVELS, "severity", errors);
  checkEnum(input["trend"], TREND_VALUES, "trend", errors);
  requireString(input, "recommended_action", errors);
  requireStringArray(input, "finding_ids", errors);

  if (errors.length > 0) return fail(errors);

  return ok({
    cluster_id: input["cluster_id"] as string,
    agent_id: input["agent_id"] as string,
    pattern_name: input["pattern_name"] as string,
    finding_count: input["finding_count"] as number,
    time_window: input["time_window"] as string,
    dominant_lenses: input["dominant_lenses"] as string[],
    severity: input["severity"] as Severity,
    trend: input["trend"] as Trend,
    recommended_action: input["recommended_action"] as string,
    finding_ids: input["finding_ids"] as string[],
  });
}
