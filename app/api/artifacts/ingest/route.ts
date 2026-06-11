import { runIngest } from "./logic.js";
import { createArizeTraceSource } from "@/lib/integrations/arize-adapter.js";
import { getMemory } from "@/lib/runtime/container.js";
import type { IngestInput } from "./logic.js";

export async function POST(request: Request): Promise<Response> {
  let input: IngestInput = {};

  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body["agent_id"] === "string") input = { ...input, agent_id: body["agent_id"] };
    if (typeof body["since"] === "string") input = { ...input, since: body["since"] };
    if (typeof body["limit"] === "number") input = { ...input, limit: body["limit"] };
  } catch {
    // Body parse failure → use empty input (all filters optional)
  }

  const memory = await getMemory();
  const traceSource = createArizeTraceSource();

  const result = await runIngest({ traceSource, memory, input });

  return Response.json(result);
}
