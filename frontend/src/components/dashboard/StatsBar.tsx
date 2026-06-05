"use client";

const stats = [
  {
    label: "Payout Massimo",
    value: "2.040",
    unit: "USDC",
    sub: "Netti",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "text-uranus-teal",
  },
  {
    label: "ROI Totale",
    value: "102x",
    unit: "",
    sub: "10.200%",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
    color: "text-uranus-cyan",
  },
  {
    label: "Totale Donato",
    value: "20,00",
    unit: "USDC",
    sub: "2 account",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    ),
    color: "text-rose-400",
  },
  {
    label: "Totale Ricevuto",
    value: "0,00",
    unit: "USDC",
    sub: "In attesa",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    ),
    color: "text-uranus-cyan",
  },
  {
    label: "Stato Account",
    value: "Attivo",
    unit: "",
    sub: "Sistema operativo",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "text-uranus-teal",
  },
];

interface StatsBarProps {
  gap?: number;
  px?: number;
  py?: number;
}

export default function StatsBar({ gap = 12, px = 16, py = 14 }: StatsBarProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: `${gap}px` }}>
      {stats.map((stat) => (
        <div key={stat.label} className="glass-stat" style={{ padding: `${py}px ${px}px` }}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`${stat.color} opacity-60`}>{stat.icon}</div>
            <span className="text-[10px] text-white/40 font-bold tracking-[0.5px] uppercase">
              {stat.label}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-xl font-bold ${stat.color}`}>{stat.value}</span>
            {stat.unit && (
              <span className="text-xs text-white/40 font-semibold">{stat.unit}</span>
            )}
          </div>
          <p className="text-[10px] text-white/30 mt-1">{stat.sub}</p>
        </div>
      ))}
    </div>
  );
}
