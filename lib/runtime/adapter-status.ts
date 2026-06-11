export type AdapterStatus = {
  app_version: string;
  demo_seed_mode: boolean;
  storage_mode: "memory" | "mongodb";
  arize: "enabled" | "disabled" | "missing_config";
  mongodb: "enabled" | "disabled" | "missing_config";
  gemini: "enabled" | "disabled" | "missing_config";
  agent_builder: "enabled" | "disabled" | "missing_config";
};

type AdapterName = "arize" | "mongodb" | "gemini" | "agent_builder";

function resolveAdapterStatus(
  enabledKey: string,
  requiredKeys: string[]
): "enabled" | "disabled" | "missing_config" {
  if (process.env[enabledKey] !== "true") return "disabled";
  const allPresent = requiredKeys.every(
    (k) => process.env[k] !== undefined && process.env[k] !== ""
  );
  return allPresent ? "enabled" : "missing_config";
}

function isSet(key: string): boolean {
  return process.env[key] !== undefined && process.env[key] !== "";
}

/**
 * Mirrors `isGeminiEnabled()` in lib/agent/gemini-adapter.ts: the Gemini adapter
 * needs GEMINI_MODEL plus credentials for EITHER Vertex mode (GOOGLE_CLOUD_PROJECT)
 * OR API-key mode (GEMINI_API_KEY). Keep this aligned with that adapter.
 */
function resolveGeminiStatus(): "enabled" | "disabled" | "missing_config" {
  if (process.env["GEMINI_ENABLED"] !== "true") return "disabled";
  const hasModel = isSet("GEMINI_MODEL");
  const hasCreds = isSet("GOOGLE_CLOUD_PROJECT") || isSet("GEMINI_API_KEY");
  return hasModel && hasCreds ? "enabled" : "missing_config";
}

export function getAdapterStatus(): AdapterStatus {
  const forcedInMemory = process.env["GAPAUDIT_MEMORY"] === "in-memory";
  const statuses: Record<AdapterName, "enabled" | "disabled" | "missing_config"> = {
    arize: resolveAdapterStatus("ARIZE_ENABLED", ["ARIZE_PROJECT_ID", "ARIZE_API_KEY"]),
    mongodb: forcedInMemory ? "disabled" : resolveAdapterStatus("MONGODB_ENABLED", ["MONGODB_URI"]),
    gemini: forcedInMemory ? "disabled" : resolveGeminiStatus(),
    agent_builder: resolveAdapterStatus("AGENT_BUILDER_ENABLED", ["AGENT_BUILDER_APP_ID"]),
  };

  return {
    app_version: process.env["npm_package_version"] ?? "0.1.0",
    demo_seed_mode: process.env["DEMO_SEED_MODE"] !== "false",
    storage_mode: !forcedInMemory && process.env["MONGODB_ENABLED"] === "true" ? "mongodb" : "memory",
    ...statuses,
  };
}
