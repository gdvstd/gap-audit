export type RawSpanKind =
  | "agent"
  | "llm"
  | "tool"
  | "retrieval"
  | "guardrail"
  | "memory"
  | "unknown";

export type RawSpan = {
  span_id: string;
  parent_span_id?: string;
  kind: RawSpanKind;
  name: string;
  start_time: string;
  end_time?: string;
  status?: "ok" | "error" | "blocked" | "partial" | "unknown";
  attributes?: Record<string, unknown>;
  input?: string;
  output?: string;
};

export type RawTraceArtifact = {
  trace_id: string;
  agent_id: string;
  task_type?: string;
  started_at: string;
  ended_at?: string;
  user_input?: string;
  customer_input?: string;
  customer_goal?: string;
  company_task?: string;
  final_output?: string;
  final_response?: string;
  declared_goal?: string;
  agent_status?: string;
  agent_confidence?: number;
  conversation_signals?: string[];
  operational_signals?: string[];
  business_signals?: string[];
  support_context?: Record<string, unknown>;
  spans: RawSpan[];
  source?: { system: "arize" | "seed" | "other"; external_id?: string; label?: string };
};
