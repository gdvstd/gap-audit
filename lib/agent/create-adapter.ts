import type { ReasoningAdapter } from "./reasoning-adapter.js";
import { createDemoAdapter } from "./demo-adapter.js";
import { createGeminiAdapter } from "./gemini-adapter.js";

/**
 * Returns the active ReasoningAdapter for the current environment.
 *
 * Returns the Gemini adapter when GEMINI_ENABLED === "true",
 * otherwise returns the demo adapter (offline seed mode).
 */
export function createAuditAdapter(): ReasoningAdapter {
  if (process.env["GAPAUDIT_MEMORY"] === "in-memory") return createDemoAdapter();
  if (process.env["GEMINI_ENABLED"] === "true") return createGeminiAdapter();
  return createDemoAdapter();
}
