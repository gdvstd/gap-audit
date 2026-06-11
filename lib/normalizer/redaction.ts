export const SENSITIVITY_TIERS = ["routine", "sensitive", "critical"] as const;
export type SensitivityTier = (typeof SENSITIVITY_TIERS)[number];

const TIER_ORDER: Record<SensitivityTier, number> = {
  routine: 0,
  sensitive: 1,
  critical: 2,
};

const ENTITY_TIERS: Record<string, SensitivityTier> = {
  email: "routine",
  phone_number: "routine",
  ip_address: "routine",
  government_id: "sensitive",
  payment_card: "sensitive",
  api_key: "critical",
  private_key: "critical",
  password: "critical",
};

export function tierFor(entity_type: string): SensitivityTier {
  return ENTITY_TIERS[entity_type] ?? "routine";
}

export function maxTier(entity_types: string[]): SensitivityTier | null {
  if (entity_types.length === 0) return null;
  let max: SensitivityTier = "routine";
  for (const et of entity_types) {
    const tier = tierFor(et);
    if (TIER_ORDER[tier] > TIER_ORDER[max]) {
      max = tier;
    }
  }
  return max;
}

type Detector = {
  entity_type: string;
  pattern: RegExp;
};

const PLACEHOLDER_PATTERN = /<[a-z_]+>/g;

function stripPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_PATTERN, " ");
}

// Order matters: specific/credential detectors BEFORE greedy phone_number pattern.
// Suggested final order: email, private_key, api_key, password, ip_address, payment_card, government_id, phone_number
const DETECTORS: Detector[] = [
  {
    entity_type: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9._%+-]+\.[A-Za-z]{2,}/g,
  },
  {
    entity_type: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    entity_type: "api_key",
    pattern: /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    entity_type: "password",
    pattern: /(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/gi,
  },
  {
    entity_type: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  },
  {
    entity_type: "payment_card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
  },
  {
    entity_type: "government_id",
    pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
  },
  {
    entity_type: "phone_number",
    pattern: /(\+?\d[\d\s().-]{8,}\d)/g,
  },
];

/**
 * Returns the first raw match per detector, in detector order. This is the single
 * source of truth for callers that need raw matched values for hashing. Matching
 * runs against placeholder-stripped text so already-redacted placeholders are never
 * re-matched. Callers must hash/redact the returned values immediately and must never
 * persist or expose them.
 */
export function detectEntityMatches(text: string): { entity_type: string; value: string }[] {
  if (text.length === 0) return [];
  const stripped = stripPlaceholders(text);
  const results: { entity_type: string; value: string }[] = [];
  for (const detector of DETECTORS) {
    const re = new RegExp(detector.pattern.source, detector.pattern.flags.includes("i") ? "gi" : "g");
    const match = re.exec(stripped);
    if (match !== null) {
      results.push({ entity_type: detector.entity_type, value: match[0] });
    }
  }
  return results;
}

export function detectEntities(text: string): string[] {
  if (text.length === 0) return [];
  const stripped = stripPlaceholders(text);
  const found = new Set<string>();
  for (const detector of DETECTORS) {
    const re = new RegExp(detector.pattern.source, detector.pattern.flags.includes("i") ? "gi" : "g");
    if (re.test(stripped)) {
      found.add(detector.entity_type);
    }
  }
  return [...found].sort();
}

const LEGACY_PLACEHOLDER = /<([a-z_]+)>/g;
const AGENT_LABEL = /\[[a-z_]+ detected[^\]]*\]/g;

/** The agent-facing mask label for an entity type, e.g. "[email detected · routine]". */
export function agentLabel(entity_type: string): string {
  return `[${entity_type} detected · ${tierFor(entity_type)}]`;
}

/**
 * The agent-facing view of a text field. Every sensitive value is masked with a
 * descriptive, typed label that also carries its severity tier, e.g.
 * "[email detected · routine]" / "[payment_card detected · sensitive]" /
 * "[api_key detected · critical]". This is a hard privacy boundary: the auditor agent
 * must never receive raw sensitive values. It both (1) re-runs the detectors so anything
 * raw that slipped into storage is masked, and (2) upgrades any legacy "<entity_type>"
 * placeholder to the descriptive tier-tagged label.
 */
export function maskForAgent(text: string): string {
  if (text.length === 0) return "";
  let result = text;

  // (1) Re-mask any raw structured PII still present. Strip existing placeholder/label
  // forms before checking so we never re-match inside an already-inserted label.
  for (const detector of DETECTORS) {
    const flags = detector.pattern.flags.includes("i") ? "gi" : "g";
    const stripped = result.replace(LEGACY_PLACEHOLDER, " ").replace(AGENT_LABEL, " ");
    const checkRe = new RegExp(detector.pattern.source, flags);
    if (checkRe.test(stripped)) {
      const replaceRe = new RegExp(detector.pattern.source, flags);
      result = result.replace(replaceRe, agentLabel(detector.entity_type));
    }
  }

  // (2) Upgrade any legacy "<type>" placeholders to the descriptive tier-tagged label.
  result = result.replace(LEGACY_PLACEHOLDER, (_match, type: string) => agentLabel(type));

  return result;
}

export function redact(text: string): { redacted: string; entity_types: string[] } {
  if (text.length === 0) return { redacted: "", entity_types: [] };

  const found = new Set<string>();
  let result = text;

  for (const detector of DETECTORS) {
    const flags = detector.pattern.flags.includes("i") ? "gi" : "g";
    const re = new RegExp(detector.pattern.source, flags);
    const stripped = stripPlaceholders(result);
    const checkRe = new RegExp(detector.pattern.source, flags);
    const matches = stripped.match(checkRe);
    if (matches !== null && matches.length > 0) {
      found.add(detector.entity_type);
      const placeholder = `<${detector.entity_type}>`;
      const replaceRe = new RegExp(detector.pattern.source, flags);
      result = result.replace(replaceRe, placeholder);
    }
  }

  return {
    redacted: result,
    entity_types: [...found].sort(),
  };
}
