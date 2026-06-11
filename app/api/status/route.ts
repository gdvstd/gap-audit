import { getAdapterStatus } from "@/lib/runtime/adapter-status";

export function GET(): Response {
  return Response.json(getAdapterStatus());
}
