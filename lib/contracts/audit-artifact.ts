import {
  type ValidationResult,
  ok,
  fail,
  isObject,
  isString,
  isNumber,
  isBoolean,
  isArray,
  isStringArray,
  requireString,
  requireBoolean,
  requireArray,
  checkEnum,
} from "./result.js";
import {
  AGENT_STATUSES,
  TOOL_STATUSES,
  VISIBILITY_VALUES,
  RETENTION_RISKS,
  VERIFICATION_STATUSES,
  SOURCE_ORIGINS,
  type AgentStatus,
  type ToolStatus,
  type Visibility,
  type RetentionRisk,
  type VerificationStatus,
  type SourceOrigin,
} from "./enums.js";

export type ToolFact = {
  tool: string;
  status: ToolStatus;
  fact: string;
};

export type ActionTaken = {
  type: string;
  target?: string;
  visibility: Visibility;
  reversible: boolean;
};

export type MemoryWrite = {
  store: string;
  content_summary: string;
  sensitive_entity_types: string[];
  retention_risk?: RetentionRisk;
};

export type GuardrailEvent = {
  type: string;
  reason: string;
  count?: number;
  time_window?: string;
};

export type VerificationArtifact = {
  type: string;
  status: VerificationStatus;
  summary: string;
};

export type SourceRef = {
  source: SourceOrigin;
  external_id?: string;
  label?: string;
};

export type SupportContext = {
  case_id?: string;
  issue_category?: string;
  channel?: string;
  customer_segment?: string;
  prior_contact_count?: number;
  follow_up_minutes?: number;
  csat?: number;
  thumbs_down?: boolean;
  escalation_requested?: boolean;
  escalation_offered?: boolean;
  escalation_after_resolution?: boolean;
  repeat_contact?: boolean;
};

export type AuditArtifact = {
  task_id: string;
  agent_id: string;
  timestamp: string;
  task_type?: string;
  customer_input_summary?: string;
  company_task?: string;
  customer_goal?: string;
  final_response_summary?: string;
  user_input_summary: string;
  declared_goal: string;
  final_output_summary: string;
  conversation_signals?: string[];
  operational_signals?: string[];
  business_signals?: string[];
  support_context?: SupportContext;
  tool_facts: ToolFact[];
  agent_status: AgentStatus;
  agent_confidence?: number;
  actions_taken: ActionTaken[];
  sensitive_entity_types: string[];
  requires_secure_handling?: boolean;
  memory_writes: MemoryWrite[];
  guardrail_events: GuardrailEvent[];
  verification_artifacts?: VerificationArtifact[];
  source_refs?: SourceRef[];
  // Hex trace id of this artifact's trace in Arize Phoenix, for deep-linking to the source.
  phoenix_trace_id?: string;
};

export function validateToolFact(input: unknown): ValidationResult<ToolFact> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];
  requireString(input, "tool", errors);
  checkEnum(input["status"], TOOL_STATUSES, "status", errors);
  requireString(input, "fact", errors);
  if (errors.length > 0) return fail(errors);
  return ok({
    tool: input["tool"] as string,
    status: input["status"] as ToolStatus,
    fact: input["fact"] as string,
  });
}

export function validateActionTaken(input: unknown): ValidationResult<ActionTaken> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];
  requireString(input, "type", errors);
  checkEnum(input["visibility"], VISIBILITY_VALUES, "visibility", errors);
  requireBoolean(input, "reversible", errors);
  if ("target" in input && input["target"] !== undefined && !isString(input["target"])) {
    errors.push("target must be a string when provided");
  }
  if (errors.length > 0) return fail(errors);
  const result: ActionTaken = {
    type: input["type"] as string,
    visibility: input["visibility"] as Visibility,
    reversible: input["reversible"] as boolean,
  };
  if (isString(input["target"])) result.target = input["target"];
  return ok(result);
}

export function validateMemoryWrite(input: unknown): ValidationResult<MemoryWrite> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];
  requireString(input, "store", errors);
  requireString(input, "content_summary", errors);
  const sensitiveEntityTypes = optionalStringArray(input, "sensitive_entity_types", errors) ?? [];
  if ("retention_risk" in input && input["retention_risk"] !== undefined) {
    checkEnum(input["retention_risk"], RETENTION_RISKS, "retention_risk", errors);
  }
  if (errors.length > 0) return fail(errors);
  const result: MemoryWrite = {
    store: input["store"] as string,
    content_summary: input["content_summary"] as string,
    sensitive_entity_types: sensitiveEntityTypes,
  };
  if (isString(input["retention_risk"])) {
    result.retention_risk = input["retention_risk"] as RetentionRisk;
  }
  return ok(result);
}

export function validateGuardrailEvent(input: unknown): ValidationResult<GuardrailEvent> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];
  requireString(input, "type", errors);
  requireString(input, "reason", errors);
  if ("count" in input && input["count"] !== undefined && !isNumber(input["count"])) {
    errors.push("count must be a number when provided");
  }
  if ("time_window" in input && input["time_window"] !== undefined && !isString(input["time_window"])) {
    errors.push("time_window must be a string when provided");
  }
  if (errors.length > 0) return fail(errors);
  const result: GuardrailEvent = {
    type: input["type"] as string,
    reason: input["reason"] as string,
  };
  if (isNumber(input["count"])) result.count = input["count"];
  if (isString(input["time_window"])) result.time_window = input["time_window"];
  return ok(result);
}

export function validateVerificationArtifact(input: unknown): ValidationResult<VerificationArtifact> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];
  requireString(input, "type", errors);
  checkEnum(input["status"], VERIFICATION_STATUSES, "status", errors);
  requireString(input, "summary", errors);
  if (errors.length > 0) return fail(errors);
  return ok({
    type: input["type"] as string,
    status: input["status"] as VerificationStatus,
    summary: input["summary"] as string,
  });
}

export function validateSourceRef(input: unknown): ValidationResult<SourceRef> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];
  checkEnum(input["source"], SOURCE_ORIGINS, "source", errors);
  if ("external_id" in input && input["external_id"] !== undefined && !isString(input["external_id"])) {
    errors.push("external_id must be a string when provided");
  }
  if ("label" in input && input["label"] !== undefined && !isString(input["label"])) {
    errors.push("label must be a string when provided");
  }
  if (errors.length > 0) return fail(errors);
  const result: SourceRef = { source: input["source"] as SourceOrigin };
  if (isString(input["external_id"])) result.external_id = input["external_id"];
  if (isString(input["label"])) result.label = input["label"];
  return ok(result);
}

function collectArrayErrors<T>(
  arr: unknown[],
  validator: (item: unknown) => ValidationResult<T>,
  fieldName: string,
  errors: string[]
): T[] | null {
  const results: T[] = [];
  let hasError = false;
  for (let i = 0; i < arr.length; i++) {
    const r = validator(arr[i]);
    if (!r.ok) {
      r.errors.forEach((e) => errors.push(`${fieldName}[${i}]: ${e}`));
      hasError = true;
    } else {
      results.push(r.value);
    }
  }
  return hasError ? null : results;
}

function selectString(
  input: Record<string, unknown>,
  fields: string[],
  errors: string[],
  fallback = ""
): string {
  for (const field of fields) {
    const value = input[field];
    if (isString(value)) return value;
  }
  errors.push(`${fields.join(" or ")} must be a string`);
  return fallback;
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
  return input[field];
}

function optionalArray(
  input: Record<string, unknown>,
  field: string,
  errors: string[]
): unknown[] | undefined {
  if (!(field in input) || input[field] === undefined) return undefined;
  if (!isArray(input[field])) {
    errors.push(`${field} must be an array when provided`);
    return undefined;
  }
  return input[field];
}

function validateSupportContext(input: unknown): ValidationResult<SupportContext> {
  if (!isObject(input)) return fail(["support_context must be a non-null object"]);
  const errors: string[] = [];
  const stringFields = ["case_id", "issue_category", "channel", "customer_segment"];
  const numberFields = ["prior_contact_count", "follow_up_minutes", "csat"];
  const booleanFields = [
    "thumbs_down",
    "escalation_requested",
    "escalation_offered",
    "escalation_after_resolution",
    "repeat_contact",
  ];

  for (const field of stringFields) {
    if (field in input && input[field] !== undefined && !isString(input[field])) {
      errors.push(`support_context.${field} must be a string when provided`);
    }
  }
  for (const field of numberFields) {
    if (field in input && input[field] !== undefined && !isNumber(input[field])) {
      errors.push(`support_context.${field} must be a number when provided`);
    }
  }
  for (const field of booleanFields) {
    if (field in input && input[field] !== undefined && !isBoolean(input[field])) {
      errors.push(`support_context.${field} must be a boolean when provided`);
    }
  }

  if (errors.length > 0) return fail(errors);

  const result: SupportContext = {};
  for (const field of stringFields) {
    if (isString(input[field])) {
      (result as Record<string, unknown>)[field] = input[field];
    }
  }
  for (const field of numberFields) {
    if (isNumber(input[field])) {
      (result as Record<string, unknown>)[field] = input[field];
    }
  }
  for (const field of booleanFields) {
    if (isBoolean(input[field])) {
      (result as Record<string, unknown>)[field] = input[field];
    }
  }
  return ok(result);
}

export function validateAuditArtifact(input: unknown): ValidationResult<AuditArtifact> {
  if (!isObject(input)) return fail(["input must be a non-null object"]);
  const errors: string[] = [];

  requireString(input, "task_id", errors);
  requireString(input, "agent_id", errors);
  requireString(input, "timestamp", errors);
  const customerInputSummary = selectString(input, ["customer_input_summary", "user_input_summary"], errors);
  const companyTask = selectString(input, ["company_task", "declared_goal"], errors);
  const finalResponseSummary = selectString(input, ["final_response_summary", "final_output_summary"], errors);
  const customerGoal = isString(input["customer_goal"]) ? input["customer_goal"] : customerInputSummary;

  checkEnum(input["agent_status"], AGENT_STATUSES, "agent_status", errors);

  const sensitiveEntityTypes = optionalStringArray(input, "sensitive_entity_types", errors) ?? [];
  const conversationSignals = optionalStringArray(input, "conversation_signals", errors) ?? [];
  const operationalSignals = optionalStringArray(input, "operational_signals", errors) ?? [];
  const businessSignals = optionalStringArray(input, "business_signals", errors) ?? [];

  if ("task_type" in input && input["task_type"] !== undefined && !isString(input["task_type"])) {
    errors.push("task_type must be a string when provided");
  }
  if ("customer_goal" in input && input["customer_goal"] !== undefined && !isString(input["customer_goal"])) {
    errors.push("customer_goal must be a string when provided");
  }
  if ("agent_confidence" in input && input["agent_confidence"] !== undefined && !isNumber(input["agent_confidence"])) {
    errors.push("agent_confidence must be a number when provided");
  }
  if ("requires_secure_handling" in input && input["requires_secure_handling"] !== undefined && !isBoolean(input["requires_secure_handling"])) {
    errors.push("requires_secure_handling must be a boolean when provided");
  }

  requireArray(input, "tool_facts", errors);
  requireArray(input, "actions_taken", errors);
  const memoryWritesInput = optionalArray(input, "memory_writes", errors) ?? [];
  const guardrailEventsInput = optionalArray(input, "guardrail_events", errors) ?? [];

  if (errors.length > 0) return fail(errors);

  const toolFacts = collectArrayErrors(input["tool_facts"] as unknown[], validateToolFact, "tool_facts", errors);
  const actionsTaken = collectArrayErrors(input["actions_taken"] as unknown[], validateActionTaken, "actions_taken", errors);
  const memoryWrites = collectArrayErrors(memoryWritesInput, validateMemoryWrite, "memory_writes", errors);
  const guardrailEvents = collectArrayErrors(guardrailEventsInput, validateGuardrailEvent, "guardrail_events", errors);

  let verificationArtifacts: VerificationArtifact[] | undefined;
  if ("verification_artifacts" in input && input["verification_artifacts"] !== undefined) {
    if (!isArray(input["verification_artifacts"])) {
      errors.push("verification_artifacts must be an array when provided");
    } else {
      const va = collectArrayErrors(input["verification_artifacts"], validateVerificationArtifact, "verification_artifacts", errors);
      if (va !== null) verificationArtifacts = va;
    }
  }

  let sourceRefs: SourceRef[] | undefined;
  if ("source_refs" in input && input["source_refs"] !== undefined) {
    if (!isArray(input["source_refs"])) {
      errors.push("source_refs must be an array when provided");
    } else {
      const sr = collectArrayErrors(input["source_refs"], validateSourceRef, "source_refs", errors);
      if (sr !== null) sourceRefs = sr;
    }
  }

  let supportContext: SupportContext | undefined;
  if ("support_context" in input && input["support_context"] !== undefined) {
    const supportResult = validateSupportContext(input["support_context"]);
    if (!supportResult.ok) {
      supportResult.errors.forEach((e) => errors.push(e));
    } else {
      supportContext = supportResult.value;
    }
  }

  if (errors.length > 0) return fail(errors);

  const result: AuditArtifact = {
    task_id: input["task_id"] as string,
    agent_id: input["agent_id"] as string,
    timestamp: input["timestamp"] as string,
    customer_input_summary: customerInputSummary,
    company_task: companyTask,
    customer_goal: customerGoal,
    final_response_summary: finalResponseSummary,
    user_input_summary: customerInputSummary,
    declared_goal: companyTask,
    final_output_summary: finalResponseSummary,
    conversation_signals: conversationSignals,
    operational_signals: operationalSignals,
    business_signals: businessSignals,
    tool_facts: toolFacts as ToolFact[],
    agent_status: input["agent_status"] as AgentStatus,
    actions_taken: actionsTaken as ActionTaken[],
    sensitive_entity_types: sensitiveEntityTypes,
    memory_writes: memoryWrites as MemoryWrite[],
    guardrail_events: guardrailEvents as GuardrailEvent[],
  };

  if (isString(input["task_type"])) result.task_type = input["task_type"];
  if (isNumber(input["agent_confidence"])) result.agent_confidence = input["agent_confidence"];
  if (isBoolean(input["requires_secure_handling"])) result.requires_secure_handling = input["requires_secure_handling"];
  if (verificationArtifacts !== undefined) result.verification_artifacts = verificationArtifacts;
  if (sourceRefs !== undefined) result.source_refs = sourceRefs;
  if (supportContext !== undefined) result.support_context = supportContext;
  if (isString(input["phoenix_trace_id"])) result.phoenix_trace_id = input["phoenix_trace_id"];

  return ok(result);
}
