import { getMemory } from "@/lib/runtime/container";

export async function GET(): Promise<Response> {
  const memory = await getMemory();
  const artifacts = await memory.listArtifacts();
  return Response.json(artifacts);
}
