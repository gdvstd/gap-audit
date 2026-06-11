/**
 * Arize Phoenix dataset integration (REST) — used by the human-reviewed convert-to-eval
 * flow to push regression test examples into Phoenix datasets. A dataset accumulates
 * example rows (input/output/metadata); a regression suite = one such dataset + a judge.
 */

function phoenixBase(): string {
  const collector = process.env["PHOENIX_COLLECTOR_ENDPOINT"] ?? "";
  if (collector !== "") return collector.replace(/\/v1\/traces\/?$/, "");
  return process.env["PHOENIX_HOST"] ?? "https://app.phoenix.arize.com";
}

function authHeaders(): Record<string, string> {
  const key = process.env["PHOENIX_API_KEY"] ?? "";
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

export type PhoenixDataset = { name: string; id: string };

export async function listPhoenixDatasets(): Promise<PhoenixDataset[]> {
  const res = await fetch(`${phoenixBase()}/v1/datasets`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Phoenix list-datasets ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ name: string; id: string }> };
  return (body.data ?? []).map((d) => ({ name: d.name, id: d.id }));
}

export type DatasetExample = {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type PushResult = { dataset_id: string; num_created_examples: number };

/**
 * Add one example to a Phoenix dataset. `action="create"` makes a new dataset (named
 * `datasetName`); `action="append"` adds to the existing one. Returns the dataset id.
 */
export async function pushDatasetExample(
  datasetName: string,
  action: "create" | "append",
  example: DatasetExample
): Promise<PushResult> {
  const res = await fetch(`${phoenixBase()}/v1/datasets/upload?sync=true`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      action,
      name: datasetName,
      inputs: [example.input],
      outputs: [example.output],
      metadata: [example.metadata ?? {}],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Phoenix dataset upload ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { data?: { dataset_id?: string; num_created_examples?: number } };
  return {
    dataset_id: body.data?.dataset_id ?? "",
    num_created_examples: body.data?.num_created_examples ?? 0,
  };
}
