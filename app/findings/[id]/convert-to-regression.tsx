"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Suite = { dataset_name: string; failure_mode: string; judge_prompt: string };
type Draft = { input: string; expected_behavior: string[]; prohibited_patterns: string[]; judge_prompt: string };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

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
  const [done, setDone] = useState<string | null>(null);

  const [suites, setSuites] = useState<Suite[]>([]);
  const [source, setSource] = useState<string>("");
  const [target, setTarget] = useState<"existing" | "new">("new");
  const [datasetExisting, setDatasetExisting] = useState<string>("");
  const [datasetNew, setDatasetNew] = useState<string>("");
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [prohibited, setProhibited] = useState("");
  const [judge, setJudge] = useState("");

  async function startDraft() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/draft-eval`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "draft failed");
      const d: Draft = data.draft;
      setSource(data.source);
      setSuites(data.suites ?? []);
      setInput(d.input);
      setExpected((d.expected_behavior ?? []).join("\n"));
      setProhibited((d.prohibited_patterns ?? []).join("\n"));
      setJudge(d.judge_prompt ?? "");
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
  const effectiveJudge = target === "existing" ? selectedSuite?.judge_prompt ?? "" : judge;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const dataset_name = target === "existing" ? datasetExisting : datasetNew.trim();
      const res = await fetch(`/api/findings/${findingId}/convert-to-eval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input,
          expected_behavior: expected.split("\n").map((x) => x.trim()).filter(Boolean),
          prohibited_patterns: prohibited.split("\n").map((x) => x.trim()).filter(Boolean),
          target,
          dataset_name,
          judge_prompt: effectiveJudge,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "convert failed");
      setDone(`Added to "${data.dataset_name}" in Phoenix (${data.action}).`);
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
      <button
        type="button"
        onClick={startDraft}
        disabled={!confirmed}
        className="text-sm px-3 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Convert to regression test
      </button>
    );
  }

  return (
    <div className="w-full mt-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-900">Draft regression test {source && <span className="text-xs font-normal text-zinc-500">· drafted by {source === "gemini" ? "Gemini" : "template"}</span>}</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-800">close</button>
      </div>
      {loading && <p className="text-sm text-zinc-500">Working…</p>}

      {done ? (
        <p className="text-sm text-emerald-700">{done}</p>
      ) : (
        <>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Test scenario (input)</span>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} className="mt-1 w-full text-sm border border-zinc-300 rounded p-2" />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Expected behavior (PASS) — one per line</span>
              <textarea value={expected} onChange={(e) => setExpected(e.target.value)} rows={3} className="mt-1 w-full text-sm border border-zinc-300 rounded p-2" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Prohibited patterns (FAIL) — one per line</span>
              <textarea value={prohibited} onChange={(e) => setProhibited(e.target.value)} rows={3} className="mt-1 w-full text-sm border border-zinc-300 rounded p-2" />
            </label>
          </div>

          <div className="rounded border border-zinc-200 bg-white p-3 space-y-2">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Target regression suite (dataset)</span>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={target === "existing"} disabled={suites.length === 0} onChange={() => setTarget("existing")} />
                Add to existing
              </label>
              <select disabled={target !== "existing"} value={datasetExisting} onChange={(e) => setDatasetExisting(e.target.value)} className="text-sm border border-zinc-300 rounded px-2 py-1 bg-white disabled:opacity-40">
                {suites.length === 0 && <option value="">(none yet)</option>}
                {suites.map((s) => <option key={s.dataset_name} value={s.dataset_name}>{s.dataset_name}</option>)}
              </select>
              <label className="flex items-center gap-1">
                <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} />
                New suite
              </label>
              <input disabled={target !== "new"} value={datasetNew} onChange={(e) => setDatasetNew(e.target.value)} placeholder="regression-…" className="text-sm border border-zinc-300 rounded px-2 py-1 disabled:opacity-40" />
            </div>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              Judge prompt {target === "existing" ? "(inherited from suite — read-only)" : "(this new suite's judge)"}
            </span>
            <textarea
              value={effectiveJudge}
              onChange={(e) => setJudge(e.target.value)}
              readOnly={target === "existing"}
              rows={4}
              className={"mt-1 w-full text-sm border rounded p-2 " + (target === "existing" ? "bg-zinc-100 border-zinc-200 text-zinc-600" : "border-zinc-300")}
            />
          </label>

          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={loading} className="text-sm px-3 py-1.5 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40">
              Convert & push to Phoenix
            </button>
          </div>
        </>
      )}
    </div>
  );
}
