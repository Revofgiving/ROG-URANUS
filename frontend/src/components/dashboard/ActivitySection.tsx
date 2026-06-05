"use client";

const activities = [
  { icon: "🛰️", text: "Ingresso come SATELLITE", sub: "+60 USDC nel sistema", time: "2 giorni fa" },
  { icon: "⬆️", text: "Upgrade a NETTUNO", sub: "Hai completato il livello", time: "5 giorni fa" },
  { icon: "🔴", text: "Dono effettuato", sub: "-10,00 USDC", time: "7 giorni fa" },
  { icon: "✅", text: "Iscrizione completata", sub: "Benvenuto in URANUS", time: "10 giorni fa" },
];



interface ActivityProps {
  px?: number;
  py?: number;
  titleMb?: number;
}

export default function ActivitySection({ px = 20, py = 20, titleMb = 16 }: ActivityProps) {
  return (
    <div>
      {/* Ultime Attività */}
      <div className="glass-card" style={{ padding: `${py}px ${px}px` }}>
        <h3
          className="text-xs font-bold tracking-[2px] text-white uppercase"
          style={{ marginBottom: `${titleMb}px` }}
        >
          Ultime Attività
        </h3>
        <div className="space-y-3">
          {activities.map((a, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-lg shrink-0 mt-0.5">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/70 font-medium">{a.text}</p>
                <p className="text-[10px] text-white/30">{a.sub}</p>
              </div>
              <span className="text-[10px] text-white/20 shrink-0">{a.time}</span>
            </div>
          ))}
        </div>
        <button className="mt-4 flex items-center gap-1.5 text-[10px] text-white/30 hover:text-uranus-cyan transition-colors">
          Vedi tutto
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
