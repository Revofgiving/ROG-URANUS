"use client";

interface AutoReentryProps {
  px?: number;
  py?: number;
  titleMb?: number;
}

export default function AutoReentry({ px = 20, py = 20, titleMb = 16 }: AutoReentryProps) {
  const total = 6;
  const active = 6;
  const r = 50;
  const circ = 2 * Math.PI * r;
  const offset = circ - (active / total) * circ;

  return (
    <div className="glass-card" style={{ padding: `${py}px ${px}px` }}>
      <h3
        className="text-sm font-bold tracking-[2px] text-white uppercase"
        style={{ marginBottom: `${titleMb}px` }}
      >
        Rientri Automatici
      </h3>

      <div className="flex flex-col items-center">
        {/* Circular Progress */}
        <div className="circular-progress w-28 h-28 mb-3">
          <svg width="112" height="112" viewBox="0 0 112 112">
            <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
            <circle
              cx="56"
              cy="56"
              r={r}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="6"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ filter: "drop-shadow(0 0 6px rgba(34, 211, 238, 0.4))" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-uranus-cyan">
              {active}/{total}
            </span>
            <span className="text-[9px] text-white/30 tracking-[1px] uppercase">
              Rientri Attivi
            </span>
          </div>
        </div>

        <p className="text-xs text-white/40 text-center mb-1">
          <span className="text-white font-semibold">60 USDC</span> reinvestiti
          automaticamente
        </p>
        <p className="text-[10px] text-white/25 text-center mb-3">
          in nuove entrate (1 tavola completa)
        </p>

        <button className="flex items-center gap-1.5 text-xs text-uranus-cyan/70 hover:text-uranus-cyan transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          Scopri di più
        </button>
      </div>
    </div>
  );
}
