export const AGENT_STATUSES = [
  "resolved",
  "failed",
  "blocked",
  "needs_review",
  "unknown",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const TOOL_STATUSES = [
  "success",
  "failed",
  "blocked",
  "partial",
  "unknown",
] as const;

export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const VISIBILITY_VALUES = [
  "internal",
  "external",
  "private",
  "public",
  "unknown",
] as const;

export type Visibility = (typeof VISIBILITY_VALUES)[number];

export const RETENTION_RISKS = ["low", "medium", "high", "critical"] as const;

export type RetentionRisk = (typeof RETENTION_RISKS)[number];

export const VERIFICATION_STATUSES = [
  "passed",
  "failed",
  "missing",
  "unknown",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const SOURCE_ORIGINS = ["arize", "seed", "other"] as const;

export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;

export type Severity = (typeof SEVERITY_LEVELS)[number];

export const TREND_VALUES = [
  "new",
  "stable",
  "increasing",
  "decreasing",
  "unknown",
] as const;

export type Trend = (typeof TREND_VALUES)[number];

export const REVIEW_DECISIONS = ["confirmed", "dismissed"] as const;

export type ReviewDecisionValue = (typeof REVIEW_DECISIONS)[number];

export const DETECTION_SOURCES = ["normalizer", "agent"] as const;

export type DetectionSource = (typeof DETECTION_SOURCES)[number];
