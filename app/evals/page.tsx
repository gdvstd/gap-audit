import Link from "next/link";
import { getMemory } from "@/lib/runtime/container";
import { listRegressionSuites } from "@/lib/review/regression-suites";
import { listPhoenixDatasets } from "@/lib/integrations/phoenix-datasets";
import type { RegressionEvalCase } from "@/lib/contracts/regression-eval-case";

function phoenixDatasetUrl(datasetId: string | undefined): string | undefined {
  if (datasetId === undefined || datasetId === "") return undefined;
  const collector = process.env["PHOENIX_COLLECTOR_ENDPOINT"] ?? "";
  const base = collector !== "" ? collector.replace(/\/v1\/traces\/?$/, "") : process.env["PHOENIX_HOST"] ?? "";
  if (base === "") return undefined;
  return `${base}/datasets/${datasetId}/examples`;
}

export default async function EvalsPage() {
  const memory = await getMemory();
  const [evalCases, suites] = await Promise.all([memory.listEvalCases(), listRegressionSuites()]);

  // Sync with Phoenix: a suite is only shown if its dataset still exists in Phoenix, so
  // deleting the dataset in Phoenix removes it here too. If Phoenix is unreachable, fall
  // back to showing all (a transient error shouldn't hide every suite).
  let phoenixNames: Set<string> | null = null;
  try {
    phoenixNames = new Set((await listPhoenixDatasets()).map((d) => d.name));
  } catch {
    phoenixNames = null;
  }

  // Group test cases by their regression suite (Phoenix dataset).
  const byDataset = new Map<string, RegressionEvalCase[]>();
  for (const ec of evalCases) {
    const key = ec.dataset_name ?? "(unassigned)";
    const arr = byDataset.get(key) ?? [];
    arr.push(ec);
    byDataset.set(key, arr);
  }
  const suiteByName = new Map(suites.map((s) => [s.dataset_name, s]));

  // One group per dataset that has either a suite or test cases.
  const datasetNames = Array.from(new Set([...suites.map((s) => s.dataset_name), ...byDataset.keys()]));
  const groups = datasetNames
    .map((name) => {
      const suite = suiteByName.get(name);
      const cases = (byDataset.get(name) ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const judge = suite?.judge_prompt ?? cases[0]?.judge_prompt ?? "";
      return { name, suite, cases, judge };
    })
    .filter((g) => phoenixNames === null || phoenixNames.has(g.name))
    .sort((a, b) => b.cases.length - a.cases.length);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Regressions</p>
        <h1 className="text-2xl font-semibold text-zinc-950 mt-1">Confirmed Test Suites</h1>
        <p className="text-sm text-zinc-500 mt-1">Evaluation suite added to Phoenix dataset.</p>
      </div>

      {groups.length === 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg py-10 text-center text-zinc-400 text-sm">
          No regression suites yet. Confirm a finding, then convert it to a regression test.
        </div>
      )}

      {groups.map((g) => {
        const url = phoenixDatasetUrl(g.suite?.phoenix_dataset_id);
        return (
          <section key={g.name} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-zinc-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-zinc-900">{g.name}</span>
                {g.suite?.failure_mode && (
                  <span className="inline-flex px-2 py-0.5 rounded border border-rose-200 bg-rose-50 text-rose-700 text-xs font-medium">guards: {g.suite.failure_mode}</span>
                )}
                <span className="text-xs text-zinc-500">{g.cases.length} test case{g.cases.length === 1 ? "" : "s"}</span>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 hover:border-violet-500">
                    Open dataset in Arize Phoenix ↗
                  </a>
                )}
              </div>
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs uppercase tracking-wide text-amber-700">Judge prompt (grades every case in this suite)</p>
                <p className="mt-1 text-sm leading-5 text-amber-950 whitespace-pre-wrap">{g.judge || "—"}</p>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead className="bg-zinc-50">
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 uppercase tracking-wide">
                  <th className="py-2 px-4">Test input (from trace)</th>
                  <th className="py-2 px-4">Expected output</th>
                  <th className="py-2 px-4">Source gap</th>
                </tr>
              </thead>
              <tbody>
                {g.cases.map((ec) => (
                  <tr key={ec.eval_id} className="border-b border-zinc-100 hover:bg-zinc-50 align-top">
                    <td className="py-3 px-4 text-zinc-800 max-w-sm leading-5">{ec.input}</td>
                    <td className="py-3 px-4 text-zinc-600 max-w-sm leading-5">{ec.expected_behavior.join(" ") || <span className="text-zinc-400">—</span>}</td>
                    <td className="py-3 px-4">
                      <Link href={"/findings/" + ec.source_finding_id} className="font-mono text-xs text-blue-700 hover:underline">{ec.source_finding_id.slice(0, 8)}…</Link>
                      <div className="text-xs text-zinc-400">{ec.agent_id}</div>
                    </td>
                  </tr>
                ))}
                {g.cases.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-zinc-400 text-sm">Suite created — no test cases yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
