"use client";

interface Position {
  id: number;
  livello: string;
  emoji: string;
  stato: "completata" | "attiva" | "in attesa";
  tavola: string;
  investito: string;
  payout: string;
  data: string;
}

// Mock — in produzione verranno dal backend
const posizioni: Position[] = [
  {
    id: 1,
    livello: "DONATORE",
    emoji: "🌍",
    stato: "completata",
    tavola: "6/6",
    investito: "10 USDC",
    payout: "20 USDC",
    data: "14 Mag 2026",
  },
  {
    id: 2,
    livello: "SATELLITE",
    emoji: "🌕",
    stato: "attiva",
    tavola: "3/6",
    investito: "10 USDC",
    payout: "—",
    data: "20 Mag 2026",
  },
];

const statoColors = {
  completata: { bg: "bg-uranus-teal/10", border: "border-uranus-teal/30", text: "text-uranus-teal" },
  attiva: { bg: "bg-uranus-cyan/10", border: "border-uranus-cyan/30", text: "text-uranus-cyan" },
  "in attesa": { bg: "bg-white/[0.04]", border: "border-white/10", text: "text-white/40" },
};

interface OrbitProps {
  px?: number;
  py?: number;
  titleMb?: number;
  planetSize?: number;
}

export default function OrbitSystem({ px = 24, py = 24, titleMb = 16 }: OrbitProps) {
  return (
    <div className="glass-card" style={{ padding: `${py}px ${px}px` }}>
      <div className="flex items-center justify-between" style={{ marginBottom: `${titleMb}px` }}>
        <h2 className="text-sm font-bold tracking-[2px] text-white uppercase">
          La Tua Orbita
        </h2>
        <span className="text-[10px] text-white/30">
          {posizioni.length} posizion{posizioni.length === 1 ? "e" : "i"} acquistate
        </span>
      </div>

      {/* Intestazione colonne */}
      <div className="grid grid-cols-[40px_1fr_100px_80px_80px_80px_90px] gap-3 px-3 mb-2">
        <span className="text-[9px] text-white/25 font-bold tracking-[1px]">#</span>
        <span className="text-[9px] text-white/25 font-bold tracking-[1px]">LIVELLO</span>
        <span className="text-[9px] text-white/25 font-bold tracking-[1px]">STATO</span>
        <span className="text-[9px] text-white/25 font-bold tracking-[1px]">TAVOLA</span>
        <span className="text-[9px] text-white/25 font-bold tracking-[1px]">INVESTITO</span>
        <span className="text-[9px] text-white/25 font-bold tracking-[1px]">PAYOUT</span>
        <span className="text-[9px] text-white/25 font-bold tracking-[1px]">DATA</span>
      </div>

      {/* Righe posizioni */}
      <div className="space-y-2">
        {posizioni.map((pos) => {
          const colors = statoColors[pos.stato];
          return (
            <div
              key={pos.id}
              className={`grid grid-cols-[40px_1fr_100px_80px_80px_80px_90px] gap-3 items-center px-3 py-3 rounded-xl border transition-all hover:bg-white/[0.02] ${
                pos.stato === "completata"
                  ? "border-uranus-teal/15 bg-uranus-teal/[0.03]"
                  : pos.stato === "attiva"
                  ? "border-uranus-cyan/15 bg-uranus-cyan/[0.03]"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              {/* # */}
              <span className="text-sm font-bold text-white/50">{pos.id}</span>

              {/* Livello */}
              <div className="flex items-center gap-2">
                <span className="text-lg">{pos.emoji}</span>
                <span className="text-xs font-bold text-white tracking-[1px]">{pos.livello}</span>
              </div>

              {/* Stato */}
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border text-center uppercase ${colors.bg} ${colors.border} ${colors.text}`}>
                {pos.stato}
              </span>

              {/* Tavola */}
              <span className="text-xs text-white/60 font-semibold">{pos.tavola}</span>

              {/* Investito */}
              <span className="text-xs text-white/50">{pos.investito}</span>

              {/* Payout */}
              <span className={`text-xs font-bold ${pos.payout === "—" ? "text-white/20" : "text-uranus-teal"}`}>
                {pos.payout}
              </span>

              {/* Data */}
              <span className="text-[10px] text-white/30">{pos.data}</span>
            </div>
          );
        })}
      </div>

      {/* Nessuna posizione? */}
      {posizioni.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-white/30">Nessuna posizione acquistata</p>
          <p className="text-xs text-white/20 mt-1">Invia un dono per entrare nell&apos;orbita</p>
        </div>
      )}
    </div>
  );
}
