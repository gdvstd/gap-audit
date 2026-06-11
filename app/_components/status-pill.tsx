type StatusPillVariant = "enabled" | "disabled" | "missing_config" | "confirmed" | "dismissed" | "pending" | "converted";

const VARIANT_CLASSES: Record<StatusPillVariant, string> = {
  enabled: "bg-green-100 text-green-800 border border-green-300",
  disabled: "bg-zinc-100 text-zinc-500 border border-zinc-300",
  missing_config: "bg-amber-100 text-amber-700 border border-amber-300",
  confirmed: "bg-green-100 text-green-800 border border-green-300",
  dismissed: "bg-zinc-100 text-zinc-500 border border-zinc-300",
  pending: "bg-yellow-100 text-yellow-700 border border-yellow-300",
  converted: "bg-blue-100 text-blue-700 border border-blue-300",
};

export function StatusPill({ status, label }: { status: StatusPillVariant; label?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${VARIANT_CLASSES[status]}`}>
      {label ?? status}
    </span>
  );
}
