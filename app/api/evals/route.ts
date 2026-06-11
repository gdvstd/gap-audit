import { getMemory } from "@/lib/runtime/container";

export async function GET(): Promise<Response> {
  const memory = await getMemory();
  const evalCases = await memory.listEvalCases();
  const sorted = [...evalCases].sort(
    (a, b) => b.created_at.localeCompare(a.created_at)
  );
  return Response.json(sorted);
}
