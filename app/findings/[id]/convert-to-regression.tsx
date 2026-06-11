"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Suite = { dataset_name: string; failure_mode: string; judge_prompt: string };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

const READONLY = "mt-1 w-full text-sm border rounded p-2 bg-zinc-100 border-zinc-200 text-zinc-600";

export function ConvertToRegression({
  findingId,
  confirmed,
  converted,
  failureMode,
}: {
  findingId: string;
  confirmed: boolean;
  converted: boolean;
  failureMode: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ dataset: string; action: string; judge: string } | null>(null);

  const [suites, setSuites] = useState<Suite[]>([]);
  const [target, setTarget] = useState<"existing" | "new">("new");
  const [datasetExisting, setDatasetExisting] = useState("");
  const [datasetNew, setDatasetNew] = useState("");
  const [input, setInput] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");

  async function start() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/draft-eval`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "could not prepare test");
      setInput(data.input ?? "");
      setSuites(data.suites ?? []);
      if (data.suggested_dataset) {
        setTarget("existing");
        setDatasetExisting(data.suggested_dataset);
      } else if ((data.suites ?? []).length > 0) {
        setTarget("existing");
        setDatasetExisting(data.suites[0].dataset_name);
      } else {
        setTarget("new");
        setDatasetNew("regression-" + slug(failureMode));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const selectedSuite = suites.find((s) => s.dataset_name === datasetExisting);
  const inheritedJudge = selectedSuite?.judge_prompt ?? "";

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const dataset_name = target === "existing" ? datasetExisting : (datasetNew.trim() || "regression-" + slug(failureMode));
      const res = await fetch(`/api/findings/${findingId}/convert-to-eval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // For a NEW dataset the server generates the judge + reference output with Gemini.
        body: JSON.stringify({ input, expected_output: expectedOutput, target, dataset_name, judge_prompt: target === "existing" ? inheritedJudge : "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "convert failed");
      setDone({ dataset: data.dataset_name, action: data.action, judge: data.eval_case?.judge_prompt ?? "" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (converted) {
    return <span className="text-sm px-3 py-1.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Converted to regression ✓</span>;
  }
  if (!open) {
    return (
      <button type="button" onClick={start} disabled={!confirmed}
        className="text-sm px-3 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed">
        Convert to regression test
      </button>
    );
  }

  return (
    <div className="w-full mt-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-900">Add to a Phoenix regression dataset</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-800">close</button>
      </div>

      {done ? (
        <div className="text-sm text-emerald-700 space-y-2">
          <p>Added to &ldquo;{done.dataset}&rdquo; in Phoenix ({done.action}). <a href="/evals" className="underline">View in Regressions →</a></p>
          {done.action === "create" && done.judge && (
            <div className="rounded border border-zinc-200 bg-white p-2 text-zinc-600">
              <p className="text-[11px] uppercase tracking-wide text-zinc-400">Generated judge prompt</p>
              <p className="mt-0.5 leading-5 whitespace-pre-wrap">{done.judge}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Task input — from the original trace (read-only)</span>
            <textarea value={input} readOnly rows={2} className={READONLY} />
          </label>

          <div className="rounded border border-zinc-200 bg-white p-3 space-y-2">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Target dataset</span>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={target === "existing"} disabled={suites.length === 0} onChange={() => setTarget("existing")} /> Add to existing
              </label>
              <select disabled={target !== "existing"} value={datasetExisting} onChange={(e) => setDatasetExisting(e.target.value)}
                className="text-sm border border-zinc-300 rounded px-2 py-1 bg-white disabled:opacity-40">
                {suites.length === 0 && <option value="">(none yet)</option>}
                {suites.map((s) => <option key={s.dataset_name} value={s.dataset_name}>{s.dataset_name}</option>)}
              </select>
              <label className="flex items-center gap-1">
                <input type="radio" checked={target === "new"} onChange={() => { setTarget("new"); if (datasetNew.trim() === "") setDatasetNew("regression-" + slug(failureMode)); }} /> New dataset
              </label>
              <input disabled={target !== "new"} value={datasetNew} onChange={(e) => setDatasetNew(e.target.value)}
                placeholder="regression-…" className="text-sm border border-zinc-300 rounded px-2 py-1 disabled:opacity-40" />
            </div>
          </div>

          {target === "existing" ? (
            <>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-zinc-500">Judge prompt — inherited from suite (read-only)</span>
                <textarea value={inheritedJudge} readOnly rows={4} className={READONLY} />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-zinc-500">Expected output — optional, logged with the example (not used for grading)</span>
                <textarea value={expectedOutput} onChange={(e) => setExpectedOutput(e.target.value)} rows={2}
                  placeholder="Optional reference output…" className="mt-1 w-full text-sm border border-zinc-300 rounded p-2" />
              </label>
              {error && <p className="text-sm text-rose-700">{error}</p>}
              <button type="button" onClick={submit} disabled={loading}
                className="text-sm px-3 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40">
                {loading ? "Adding…" : "Add to dataset"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-zinc-500 leading-5">
                A new dataset needs its own judge. Gemini will generate the judge prompt + reference output from this finding.
              </p>
              {error && <p className="text-sm text-rose-700">{error}</p>}
              <button type="button" onClick={submit} disabled={loading}
                className="text-sm px-3 py-1.5 rounded bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-40">
                {loading ? "Generating evaluation dataset…" : "Generate evaluation dataset"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
