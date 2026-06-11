import { getMemory } from "@/lib/runtime/container";
import { runAuditSweepRequest } from "./logic";

export async function POST(_request: Request): Promise<Response> {
  const memory = await getMemory();
  const result = await runAuditSweepRequest(memory);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.value);
}
