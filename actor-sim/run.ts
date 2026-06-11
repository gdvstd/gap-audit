#!/usr/bin/env tsx
/**
 * actor-sim CLI — run GapAudit demo agents and write traces to fixtures/live-traces/raw-traces.json
 *
 * Usage:
 *   pnpm exec tsx actor-sim/run.ts                  # live Gemini run (auto-exports to Phoenix)
 *   pnpm exec tsx actor-sim/run.ts --fake           # deterministic offline run (no export)
 *   pnpm exec tsx actor-sim/run.ts --fake --push    # deterministic mock run, pushed to Phoenix
 *   pnpm exec tsx actor-sim/run.ts agent-support-01 agent-devops-01  # subset by agent_id
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ALL_AGENTS } from "./agents.js";
import type { ActorAgent } from "./agents.js";
import { runActor } from "./runner.js";
import type { GenerateFn, GenerateRequest, GenerateResult, RunResult } from "./runner.js";
import { toRawTraceArtifact, createArizeExporter } from "./tracing.js";
import type { RawTraceArtifact } from "../lib/normalizer/raw-trace.js";

// ─── Fake generate (deterministic offline mode) ───────────────────────────────

/**
 * Builds a scripted fake GenerateFn for a given agent.
 * Calls each agent tool in sequence, then submit_result.
 */
function buildFakeGenerate(agent: ActorAgent): GenerateFn {
  const toolQueue = [...agent.tools.filter((t) => t !== "submit_result")];
  let step = 0;
  return async (_req: GenerateRequest): Promise<GenerateResult> => {
    if (step < toolQueue.length) {
      const toolName = toolQueue[step] ?? "submit_result";
      step++;

      // Build appropriate fake args per tool
      const args = buildFakeArgs(toolName, agent);

      return {
        functionCalls: [{ name: toolName, args }],
      };
    }

    // Final step: submit_result
    return {
      functionCalls: [
        {
          name: "submit_result",
          args: {
            final_output: buildFakeOutput(agent),
            status: buildFakeStatus(agent),
            confidence: agent.fake?.confidence ?? 0.75,
            declared_goal: buildFakeGoal(agent),
          },
        },
      ],
    };
  };
}

function buildFakeArgs(toolName: string, agent: ActorAgent): Record<string, unknown> {
  const configured = agent.fake?.tool_args?.[toolName];
  if (configured !== undefined) return configured;

  switch (toolName) {
    case "lookup_account":
      return { account_name: "Acme Corp" };
    case "policy_search":
      return { query: "enterprise incomplete onboarding refund exception" };
    case "draft_reply":
      return {
        content: agent.service_metadata?.final_response ?? "Task completed.",
        recipient: "customer",
      };
    case "attempt_identifier_reply":
      return { customer_id: "CUST-8842", count: 23, time_window: "P7D" };
    case "issue_refund":
      return { account_name: "Acme Corp", amount: 28800, reason: "Enterprise incomplete-onboarding exception" };
    case "parse_resume":
      return { resume_ids: [agent.trace_id] };
    case "write_memory":
      return {
        store: "long-term-candidate-memory",
        content: "Candidate context retained for future screens.",
        retention_risk: "high",
        sensitive_entity_types: ["phone_number", "salary_expectation", "full_name"],
      };
    case "write_eval_dataset":
      return {
        store: "eval-dataset-candidate-screening",
        content: "Candidate screening example with sensitive context.",
        retention_risk: "critical",
        sensitive_entity_types: ["phone_number", "salary_expectation", "full_name"],
      };
    case "post_to_channel":
      return { channel: "#hiring-panel", message: "Candidate summary" };
    case "restart_service":
      return { service_name: "payment-service" };
    case "query_metrics":
      return { service_name: "payment-service", metric: "error_rate" };
    case "update_status":
      return { status: "resolved", incident_id: "INC-PAY-001" };
    case "page_oncall":
      return { team: "platform-oncall", message: "Recovery unconfirmed" };
    case "lookup_invoice":
      return { invoice_id: "INV-2026-0442" };
    case "duplicate_check":
      return { po_number: "PO-7781", amount: "$48,200" };
    case "approve_payment":
      return { invoice_id: "INV-2026-0442" };
    case "flag_for_review":
      return { invoice_id: "INV-2026-0442", reason: "Possible duplicate" };
    case "lookup_user":
      return { user_name: "Jordan Lee" };
    case "check_policy":
      return { resource: "Revenue Analytics", user_type: "contractor" };
    case "grant_access":
      return { user_name: "Jordan Lee", resource: "Revenue Analytics" };
    case "request_approval":
      return { approver: "Dana Cole", resource: "Revenue Analytics", user_name: "Jordan Lee" };
    case "update_crm":
      return { field: "primary_contact", value: "Beth Ramirez", store: "crm_shared" };
    case "draft_email":
      return {
        to: "beth.ramirez@globex.com",
        subject: "250-seat pricing follow-up",
        body: "Hi Beth, I will send pricing by Friday.",
      };
    case "log_note":
      return { note: "Competitor info withheld; personal cell withheld.", store: "internal_notes" };
    default:
      return {};
  }
}

function buildFakeOutput(agent: ActorAgent): string {
  return agent.fake?.final_output ?? agent.service_metadata?.final_response ?? "Task completed.";
}

function buildFakeStatus(agent: ActorAgent): string {
  return agent.fake?.status ?? "resolved";
}

function buildFakeGoal(agent: ActorAgent): string {
  return agent.fake?.declared_goal ?? agent.service_metadata?.company_task ?? "Complete the task.";
}

// ─── Real Gemini credentials check ──────────────────────────────────────────

async function buildRealGenerate(): Promise<GenerateFn> {
  const project = process.env["GOOGLE_CLOUD_PROJECT"];
  const apiKey = process.env["GEMINI_API_KEY"];

  if (
    (project === undefined || project === "") &&
    (apiKey === undefined || apiKey === "")
  ) {
    throw new Error(
      "No Gemini credentials.\n" +
        "  Vertex AI: set GOOGLE_CLOUD_PROJECT (and optionally GOOGLE_CLOUD_LOCATION).\n" +
        "  API key:   set GEMINI_API_KEY.\n" +
        "  Offline:   run with --fake flag."
    );
  }

  const { getRealGenerateFn } = await import("./runner.js");
  return withRateLimitRetry(await getRealGenerateFn());
}

// Wrap a GenerateFn so 429 / RESOURCE_EXHAUSTED responses are retried after the
// server-suggested delay (free-tier Gemini is 5 requests/minute). Keeps the live
// run working on a free key, just slower.
function withRateLimitRetry(inner: GenerateFn, maxRetries = 5): GenerateFn {
  return async (req) => {
    let attempt = 0;
    for (;;) {
      try {
        return await inner(req);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // 429 = quota/rate limit (server tells us how long to wait);
        // 503 / UNAVAILABLE / overloaded = transient Google-side load (back off + retry).
        const isRateLimit = /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
        const isOverloaded = /503|UNAVAILABLE|overloaded|high demand/i.test(msg);
        if ((!isRateLimit && !isOverloaded) || attempt >= maxRetries) throw err;
        attempt += 1;
        const m = msg.match(/retry(?:Delay)?["\s:]*?(\d+(?:\.\d+)?)s/i);
        // For 503 with no suggested delay, exponential backoff (10s, 20s, 40s...).
        const fallbackSec = isOverloaded && !m ? Math.min(10 * 2 ** (attempt - 1), 90) : 60;
        const waitMs = Math.ceil((m ? parseFloat(m[1]!) : fallbackSec) * 1000) + 1000;
        process.stdout.write(`\n    [rate-limit] waiting ${Math.round(waitMs / 1000)}s (retry ${attempt}/${maxRetries}) ... `);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  };
}

// ─── Summary table ────────────────────────────────────────────────────────────

function printSummary(results: RunResult[]): void {
  process.stdout.write(
    "\n" +
      "agent".padEnd(28) +
      "status".padEnd(16) +
      "#spans".padEnd(10) +
      "output (snippet)\n"
  );
  process.stdout.write("-".repeat(80) + "\n");

  for (const r of results) {
    const snippet =
      r.final_output.length > 50
        ? r.final_output.slice(0, 47) + "..."
        : r.final_output;
    process.stdout.write(
      r.agent_id.padEnd(28) +
        r.agent_status.padEnd(16) +
        String(r.spans.length).padEnd(10) +
        snippet +
        "\n"
    );
  }
  process.stdout.write("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const isFake = argv.includes("--fake");
  // --push forces trace export even in fake mode (deterministic mock traces → Phoenix).
  const pushFlag = argv.includes("--push");
  const agentFilter = argv.filter((a) => !a.startsWith("--"));

  const agents =
    agentFilter.length > 0
      ? ALL_AGENTS.filter((a) => agentFilter.includes(a.agent_id))
      : ALL_AGENTS;

  if (agents.length === 0) {
    process.stderr.write(`No agents matched filter: ${agentFilter.join(", ")}\n`);
    process.exit(1);
  }

  const exporter = createArizeExporter();
  const results: RunResult[] = [];
  const artifacts: RawTraceArtifact[] = [];
  // semantic trace_id -> Phoenix hex trace id (captured at export), so the dashboard can
  // link a trace artifact back to its original trace in Phoenix.
  const phoenixMap: Record<string, string> = {};

  process.stdout.write(
    `[actor-sim] Running ${agents.length} agent(s) in ${isFake ? "FAKE" : "LIVE"} mode...\n`
  );

  for (const agent of agents) {
    process.stdout.write(`  → ${agent.agent_id} ... `);

    try {
      const generate = isFake ? buildFakeGenerate(agent) : await buildRealGenerate();
      const result = await runActor({ agent, generate });

      results.push(result);

      const artifact = toRawTraceArtifact(result, {
        source: "other",
        traceId: agent.trace_id,
      });
      artifacts.push(artifact);

      if (!isFake || pushFlag) {
        const phoenixId = await exporter.exportRun(result, agent.trace_id);
        if (phoenixId !== null) phoenixMap[agent.trace_id] = phoenixId;
      }

      process.stdout.write(`${result.agent_status} (${result.spans.length} spans)\n`);
    } catch (err: unknown) {
      // Record the failure and keep going so partial results are still saved.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n  [SKIP] ${agent.agent_id}: ${message.slice(0, 160)}\n`);
    }
  }

  // Write artifacts to fixtures/live-traces/raw-traces.json
  const outDir = join(
    new URL(".", import.meta.url).pathname,
    "..",
    "fixtures",
    "live-traces"
  );
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, "raw-traces.json");
  writeFileSync(outPath, JSON.stringify(artifacts, null, 2), "utf8");

  process.stdout.write(`\n[actor-sim] Wrote ${artifacts.length} artifact(s) to fixtures/live-traces/raw-traces.json\n`);

  // Persist the semantic task_id -> Phoenix hex trace id mapping (only when traces were
  // actually exported), so artifacts can be linked back to Phoenix in the dashboard.
  if (Object.keys(phoenixMap).length > 0) {
    writeFileSync(join(outDir, "phoenix-map.json"), JSON.stringify(phoenixMap, null, 2), "utf8");
    process.stdout.write(`[actor-sim] Wrote ${Object.keys(phoenixMap).length} Phoenix trace-id mappings to fixtures/live-traces/phoenix-map.json\n`);
  }

  printSummary(results);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[actor-sim] Fatal: ${message}\n`);
  process.exit(1);
});
