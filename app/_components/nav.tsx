import Link from "next/link";
import { getAdapterStatus } from "@/lib/runtime/adapter-status";

const navItems = [
  { href: "/", label: "Service Map" },
  { href: "/activity", label: "Activity" },
  { href: "/findings", label: "Gaps" },
  { href: "/clusters", label: "Patterns" },
  { href: "/evals", label: "Regression" },
];

export function Nav() {
  const status = getAdapterStatus();

  return (
    <nav className="bg-zinc-950 text-zinc-100 border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-semibold text-base tracking-tight">GapAudit</span>
            <span className="text-xs text-zinc-400">service gap console</span>
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className={status.storage_mode === "mongodb" ? "text-emerald-300" : "text-amber-300"}>
            {status.storage_mode}
          </span>
          <span>source</span>
          <span className="text-zinc-600">/</span>
          <span className={status.arize === "enabled" ? "text-emerald-300" : "text-zinc-500"}>Phoenix</span>
          <span className="text-zinc-600">/</span>
          <span className={status.gemini === "enabled" ? "text-emerald-300" : "text-zinc-500"}>Gemini</span>
        </div>
      </div>
    </nav>
  );
}
