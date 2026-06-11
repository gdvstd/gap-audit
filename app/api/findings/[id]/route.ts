import { getMemory } from "@/lib/runtime/container";
import { getFindingDetail } from "./logic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const memory = await getMemory();
  const result = await getFindingDetail(memory, id);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.value);
}
