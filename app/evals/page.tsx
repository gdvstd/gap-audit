import Link from "next/link";
import { getMemory } from "@/lib/runtime/container";

export default async function EvalsPage() {
  const memory = await getMemory();
  const evalCases = await memory.listEvalCases();

  const sorted = [...evalCases].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Regression candidates</p>
        <h1 className="text-2xl font-semibold text-zinc-950 mt-1">Confirmed service gaps that should not recur</h1>
        <p className="text-sm text-zinc-600 mt-2 max-w-3xl">
          Review-approved findings can become regression cases for prompts, policies, and workflow changes.
        </p>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase tracking-wide">
              <th className="py-3 px-3">Eval ID</th>
              <th className="py-3 px-3">Source Gap</th>
              <th className="py-3 px-3">Agent</th>
              <th className="py-3 px-3">Guarded Failure</th>
              <th className="py-3 px-3">Expected Behavior</th>
              <th className="py-3 px-3">Prohibited</th>
              <th className="py-3 px-3">Privacy</th>
              <th className="py-3 px-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((evalCase) => {
              const shortEvalId = evalCase.eval_id.slice(0, 8) + "...";
              const shortFindingId = evalCase.source_finding_id.slice(0, 8) + "...";
              const firstBehavior = evalCase.expected_behavior[0] ?? "-";
              const behaviorLabel =
                evalCase.expected_behavior.length > 1
                  ? firstBehavior + " (+" + (evalCase.expected_behavior.length - 1) + " more)"
                  : firstBehavior;

              return (
                <tr key={evalCase.eval_id} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="py-3 px-3 font-mono text-xs text-zinc-600">{shortEvalId}</td>
                  <td className="py-3 px-3">
                    <Link href={"/findings/" + evalCase.source_finding_id} className="font-mono text-xs text-blue-700 hover:underline">
                      {shortFindingId}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-zinc-500 text-xs">{evalCase.agent_id}</td>
                  <td className="py-3 px-3 text-zinc-700">{evalCase.failure_mode_guarded}</td>
                  <td className="py-3 px-3 text-zinc-600 max-w-xs truncate">{behaviorLabel}</td>
                  <td className="py-3 px-3 text-zinc-500">{evalCase.prohibited_patterns?.length ?? 0}</td>
                  <td className="py-3 px-3 text-zinc-500">{evalCase.privacy_constraints?.length ?? 0}</td>
                  <td className="py-3 px-3 text-zinc-400 text-xs">{new Date(evalCase.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-zinc-400 text-sm">
                  No regression candidates yet. Confirm a service gap first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
