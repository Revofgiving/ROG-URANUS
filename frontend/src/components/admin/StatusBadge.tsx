"use client";

const CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  active:    { label: "Attivo",      bg: "rgba(16,185,129,0.1)",   color: "#10b981" },
  inactive:  { label: "Inattivo",    bg: "rgba(100,116,139,0.15)", color: "#94a3b8" },
  completed: { label: "Completato",  bg: "rgba(16,185,129,0.1)",   color: "#10b981" },
  pending:   { label: "In Attesa",   bg: "rgba(245,158,11,0.1)",   color: "#f59e0b" },
  upcoming:  { label: "In arrivo",   bg: "rgba(6,182,212,0.1)",    color: "#22d3ee" },
  past:      { label: "Passato",     bg: "rgba(100,116,139,0.15)", color: "#94a3b8" },
  cancelled: { label: "Annullato",   bg: "rgba(239,68,68,0.1)",    color: "#f87171" },
  approved:  { label: "Approvata",   bg: "rgba(16,185,129,0.1)",   color: "#10b981" },
  rejected:  { label: "Rifiutata",   bg: "rgba(239,68,68,0.1)",    color: "#f87171" },
};

interface Props {
  status: string;
}

export default function StatusBadge({ status }: Props) {
  const cfg = CONFIG[status] ?? { label: status, bg: "rgba(100,116,139,0.15)", color: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}
