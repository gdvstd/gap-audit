import { getMemory } from "@/lib/runtime/container";
import { parseQuery, listFindingsRequest } from "./logic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams);
  const memory = await getMemory();
  const result = await listFindingsRequest(memory, query);
  return Response.json(result);
}
