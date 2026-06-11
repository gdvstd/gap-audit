import { getMemory } from "@/lib/runtime/container";
import type { PatternCluster } from "@/lib/contracts/pattern-cluster";

const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function sortClusters(clusters: PatternCluster[]): PatternCluster[] {
  return [...clusters].sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.finding_count - a.finding_count;
  });
}

export async function GET(): Promise<Response> {
  const memory = await getMemory();
  const clusters = await memory.listClusters();
  return Response.json(sortClusters(clusters));
}
