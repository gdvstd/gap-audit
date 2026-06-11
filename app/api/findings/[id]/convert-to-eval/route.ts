import { getMemory } from "@/lib/runtime/container";
import { postConvertToEval } from "./logic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const memory = await getMemory();
  const result = await postConvertToEval(memory, id, body);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result.value);
}
