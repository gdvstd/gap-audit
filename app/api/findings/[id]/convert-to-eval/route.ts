import { getMemory } from "@/lib/runtime/container";
import { postConvertToEval } from "./logic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const memory = await getMemory();
  const result = await postConvertToEval(memory, id);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.value);
}
