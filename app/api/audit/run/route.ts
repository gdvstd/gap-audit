import { getMemory } from "@/lib/runtime/container";
import { runAuditRequest } from "./logic";

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown = undefined;
  const text = await request.text();
  if (text.trim().length > 0) {
    try {
      rawBody = JSON.parse(text) as unknown;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  const memory = await getMemory();
  const result = await runAuditRequest(memory, rawBody);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.value);
}
