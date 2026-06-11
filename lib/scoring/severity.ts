/**
 * Deterministic, algorithmic severity scoring — NOT an LLM judgment.
 *
 * severity = clamp( base(failure_mode/lens) + riskBoost(evidence) + recurrenceBoost(n) )
 *
 * The LLM only names the lens/failure_mode and cites evidence; the severity LABEL is then
 * derived here from observable features, so it is consistent and reproducible across runs.
 */
import type { Severity } from "../contracts/enums.js";

const LADDER: Severity[] = ["low", "medium", "high", "critical"];

export type SeverityInput = {
  lens: string;
  failure_mode: string;
  evidence: string[];
};

/** Base level by the KIND of failure (0=low .. 3=critical). */
function baseLevel(input: SeverityInput): number {
  const fm = input.failure_mode.toLowerCase();
  const lens = input.lens;

  // Lens decides first for the recurrence-lens (drift escalates via recurrence, not base)
  // and the low-stakes lens — regardless of how the failure_mode is worded.
  if (lens === "operational-drift") return 1;
  if (lens === "customer-effort-inflation") return 0;

  // Privacy retention / sensitive-data exposure — high base.
  if (/(retention|privacy|leak|sensitive|pii|exposure)/.test(fm)) return 2;
  // False success / unresolved-but-closed / failed verification — high base.
  if (/(false[\s-]?success|unresolved|not served|without.*verification|false[\s-]?resolution)/.test(fm)) return 2;
  if (lens === "resolved-but-not-served") return 2;

  // Context-neglect / trust handling — medium base.
  return 1;
}

/** Boost from risk signals in the evidence — at most +1 (any strong stakes signal). */
function riskBoost(evidence: string[]): number {
  const text = evidence.join(" ").toLowerCase();
  const regulated = /(ssn|social security|credit card|\bpan\b|government|passport|gov-id|regulated|secret|token|api[_\s-]?key)/.test(text);
  const irreversibleExternal = /(irreversible|sent to (the )?customer|customer-facing|emailed|public|shared store|external denial)/.test(text);
  const ignoredHuman = /(human|escalation|manager)[^.]{0,40}(ignored|denied|not offered|without|missing)/.test(text);
  return regulated || irreversibleExternal || ignoredHuman ? 1 : 0;
}

/** Boost from recurrence — only heavy recurrence (a real systemic pattern) lifts severity. */
function recurrenceBoost(recurrence: number): number {
  return recurrence >= 10 ? 1 : 0;
}

export function computeSeverity(input: SeverityInput, recurrence: number): Severity {
  const level = baseLevel(input) + riskBoost(input.evidence) + recurrenceBoost(recurrence);
  const clamped = Math.max(0, Math.min(LADDER.length - 1, level));
  return LADDER[clamped]!;
}
