import { getMemory } from "@/lib/runtime/container";
import { postReview } from "./logic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json() as unknown;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const memory = await getMemory();
  const result = await postReview(memory, id, rawBody);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.value);
}
