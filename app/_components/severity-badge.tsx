import type { Severity } from "@/lib/contracts/enums";

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 border border-red-300",
  high: "bg-amber-100 text-amber-800 border border-amber-300",
  medium: "bg-yellow-100 text-yellow-700 border border-yellow-300",
  low: "bg-zinc-100 text-zinc-500 border border-zinc-300",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_CLASSES[severity]}`}>
      {severity}
    </span>
  );
}
