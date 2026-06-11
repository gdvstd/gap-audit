export function MetricCard({
  title,
  count,
  subline,
}: {
  title: string;
  count: number;
  subline?: string;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{title}</p>
      <p className="text-3xl font-semibold text-zinc-900 mt-1">{count}</p>
      {subline !== undefined && (
        <p className="text-xs text-zinc-400 mt-1">{subline}</p>
      )}
    </div>
  );
}
