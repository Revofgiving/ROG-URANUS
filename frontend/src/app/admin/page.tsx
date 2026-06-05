"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";

/* ─── Spacing temporaneo ─── */
const DEF = {
  gap: 32,           // gap tra sezioni
  kpiGap: 20,        // gap tra KPI cards
  kpiPad: 24,        // padding KPI cards
  kpiTitleSize: 12,  // font-size titolo KPI
  kpiTitleMb: 12,    // margine sotto titolo KPI
  kpiValueSize: 30,  // font-size valore KPI
  kpiSubMt: 8,       // margine sopra sub KPI
  kpiSubSize: 12,    // font-size sub KPI
  detailGap: 20,     // gap griglia dettagli
  cardPad: 24,       // padding cards dettagli
  cardTitleSize: 14, // font-size titoli sezione
  cardTitleTrack: 1, // letter-spacing titoli
  cardTitleMb: 16,   // margine sotto titoli
  statPy: 12,        // padding Y righe stat
  statLabelSize: 14, // font-size label stat
  statValueSize: 14, // font-size valore stat
  refreshSize: 12,   // font-size bottone refresh
};

type Sp = typeof DEF;

const LABELS: Record<keyof Sp, string> = {
  gap: "Sezioni — gap",
  kpiGap: "KPI — gap tra cards",
  kpiPad: "KPI — padding cards",
  kpiTitleSize: "KPI — font titolo",
  kpiTitleMb: "KPI — margine sotto titolo",
  kpiValueSize: "KPI — font valore",
  kpiSubMt: "KPI — margine sopra sub",
  kpiSubSize: "KPI — font sub",
  detailGap: "Dettagli — gap griglia",
  cardPad: "Card — padding",
  cardTitleSize: "Card — font titolo",
  cardTitleTrack: "Card — letter spacing titolo",
  cardTitleMb: "Card — margine sotto titolo",
  statPy: "Stat — padding Y righe",
  statLabelSize: "Stat — font label",
  statValueSize: "Stat — font valore",
  refreshSize: "Refresh — font size",
};

const RANGES: Record<keyof Sp, [number, number]> = {
  gap: [8, 64],
  kpiGap: [4, 40],
  kpiPad: [8, 48],
  kpiTitleSize: [8, 20],
  kpiTitleMb: [0, 24],
  kpiValueSize: [16, 48],
  kpiSubMt: [0, 20],
  kpiSubSize: [8, 18],
  detailGap: [4, 40],
  cardPad: [8, 48],
  cardTitleSize: [10, 22],
  cardTitleTrack: [0, 6],
  cardTitleMb: [4, 32],
  statPy: [4, 24],
  statLabelSize: [10, 20],
  statValueSize: [10, 20],
  refreshSize: [10, 18],
};

interface Stats {
  totaleAccount: number;
  usciteHuman: number;
  totaleDistribuito: number;
  usciteCassa: number;
  totaleAccantonato: number;
  fondoCassa: number;
  totaleTavole: number;
  tavoleAperte: number;
  turniAttivi: number;
  totaleUscite: number;
  rientriHuman: number;
  rientriCassa: number;
  rientriInAttesa: number;
  flussiEsterni?: {
    rogSmall: number;
    rog: number;
    rientriSole: number;
  };
}

export default function AdminDashboardPage() {
  const { log } = useLog();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sp, setSp] = useState<Sp>(DEF);
  const [panelOpen, setPanelOpen] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi<{ statistiche: Stats }>("/api/stato");
      setStats(data.statistiche);
      log("Stato aggiornato", "success");
    } catch (err: unknown) {
      log(`Errore caricamento stato: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchStats();
    });
    const interval = setInterval(() => {
      void fetchStats();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const fmt = (n: number | undefined) =>
    (n ?? 0).toLocaleString("it-IT");

  const updateSp = (key: keyof Sp, val: number) => setSp({ ...sp, [key]: val });
  const copySp = () => {
    const code = `const sp = ${JSON.stringify(sp, null, 2)};`;
    navigator.clipboard.writeText(code);
  };

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", gap: sp.gap }}>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: sp.kpiGap }}>
        <KpiCard sp={sp}
          title="Account Totali"
          value={loading ? "—" : fmt(stats?.totaleAccount)}
        />
        <KpiCard sp={sp}
          title="Uscite HUMAN"
          value={loading ? "—" : fmt(stats?.usciteHuman)}
          sub={loading ? "" : `${fmt(stats?.totaleDistribuito)} USDC distribuiti`}
        />
        <KpiCard sp={sp}
          title="Uscite CASSA"
          value={loading ? "—" : fmt(stats?.usciteCassa)}
          sub={loading ? "" : `${fmt(stats?.totaleAccantonato)} USDC accantonati`}
        />
        <KpiCard sp={sp}
          title="Fondo Cassa ROG"
          value={loading ? "—" : fmt(stats?.fondoCassa)}
          sub="USDC"
        />
      </div>

      {/* Detail Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: sp.detailGap }}>
        {/* Stato Sistema */}
        <div className="glass-card" style={{ padding: sp.cardPad }}>
          <h3 className="font-bold text-uranus-violet uppercase" style={{ fontSize: sp.cardTitleSize, letterSpacing: sp.cardTitleTrack, marginBottom: sp.cardTitleMb }}>
            Stato Sistema
          </h3>
          <StatRow sp={sp} label="Tavole totali" value={fmt(stats?.totaleTavole)} />
          <StatRow sp={sp} label="Tavole aperte" value={fmt(stats?.tavoleAperte)} />
          <StatRow sp={sp} label="Turni attivi" value={fmt(stats?.turniAttivi)} />
          <StatRow sp={sp} label="Uscite totali" value={fmt(stats?.totaleUscite)} />
        </div>

        {/* Rientri in Attesa */}
        <div className="glass-card" style={{ padding: sp.cardPad }}>
          <h3 className="font-bold text-uranus-violet uppercase" style={{ fontSize: sp.cardTitleSize, letterSpacing: sp.cardTitleTrack, marginBottom: sp.cardTitleMb }}>
            Rientri in Attesa
          </h3>
          <StatRow sp={sp} label="HUMAN" value={fmt(stats?.rientriHuman)} />
          <StatRow sp={sp} label="CASSA_ROG" value={fmt(stats?.rientriCassa)} />
          <StatRow sp={sp} label="Totale" value={fmt(stats?.rientriInAttesa)} highlight />
        </div>

        {/* Flussi Cross-Sistema */}
        <div className="glass-card" style={{ padding: sp.cardPad }}>
          <h3 className="font-bold text-uranus-violet uppercase" style={{ fontSize: sp.cardTitleSize, letterSpacing: sp.cardTitleTrack, marginBottom: sp.cardTitleMb }}>
            Flussi Cross-Sistema
          </h3>
          <StatRow sp={sp}
            label="→ ROG SMALL"
            value={`${fmt(stats?.flussiEsterni?.rogSmall)} USDC`}
          />
          <StatRow sp={sp}
            label="→ ROG"
            value={`${fmt(stats?.flussiEsterni?.rog)} USDC`}
          />
          <StatRow sp={sp}
            label="→ RIENTRI SOLE"
            value={`${fmt(stats?.flussiEsterni?.rientriSole)} USDC`}
          />
        </div>
      </div>

      {/* Refresh button */}
      <button
        onClick={fetchStats}
        className="text-uranus-violet/60 hover:text-uranus-violet transition-colors"
        style={{ fontSize: sp.refreshSize }}
      >
        🔄 Aggiorna stato
      </button>
    </div>

    {/* ===== PANNELLO SPAZIATURA TEMPORANEO ===== */}
    {!panelOpen ? (
      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-4 left-4 z-[200] w-12 h-12 rounded-full flex items-center justify-center text-white text-lg"
        style={{ background: 'linear-gradient(135deg, #22d3ee, #7c3aed)', boxShadow: '0 0 20px rgba(34, 211, 238, 0.4)' }}
        title="Apri pannello spaziatura dashboard"
      >
        📐
      </button>
    ) : (
      <div
        className="fixed left-4 top-4 bottom-4 z-[200] w-[320px] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'rgba(8, 12, 28, 0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(34, 211, 238, 0.3)', boxShadow: '0 0 40px rgba(0,0,0,0.5), 0 0 20px rgba(34, 211, 238, 0.15)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm font-bold tracking-[2px] text-white">📐 ADMIN DASH</span>
          <div className="flex gap-2">
            <button onClick={copySp} className="text-[10px] px-2.5 py-1 rounded-full bg-uranus-violet/10 border border-uranus-violet/30 text-uranus-violet hover:bg-uranus-violet/20 transition-all">📋 Copia</button>
            <button onClick={() => setPanelOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: 'thin' }}>
          {(Object.keys(LABELS) as (keyof Sp)[]).map((key) => {
            const [min, max] = RANGES[key];
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-white/50 font-medium">{LABELS[key]}</label>
                  <span className="text-[11px] font-bold text-uranus-violet min-w-[36px] text-right">{sp[key]}</span>
                </div>
                <input type="range" min={min} max={max} value={sp[key]} onChange={(e) => updateSp(key, Number(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{ background: `linear-gradient(to right, #7c3aed ${((sp[key] - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((sp[key] - min) / (max - min)) * 100}%)`, accentColor: '#7c3aed' }} />
              </div>
            );
          })}
        </div>
        <div className="px-4 py-2 border-t border-white/10">
          <p className="text-[9px] text-white/25 text-center">Regola i valori → premi &quot;Copia&quot; → dammi i valori</p>
        </div>
      </div>
    )}
    </>
  );
}

function KpiCard({
  sp,
  title,
  value,
  sub,
}: {
  sp: Sp;
  title: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="glass-card" style={{ padding: sp.kpiPad }}>
      <h3 className="font-bold text-uranus-violet/70 uppercase tracking-wider" style={{ fontSize: sp.kpiTitleSize, marginBottom: sp.kpiTitleMb }}>
        {title}
      </h3>
      <div className="font-bold text-white" style={{ fontSize: sp.kpiValueSize }}>{value}</div>
      {sub && <div className="text-white/30" style={{ fontSize: sp.kpiSubSize, marginTop: sp.kpiSubMt }}>{sub}</div>}
    </div>
  );
}

function StatRow({
  sp,
  label,
  value,
  highlight,
}: {
  sp: Sp;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between border-b border-white/5 last:border-0" style={{ paddingTop: sp.statPy, paddingBottom: sp.statPy }}>
      <span className="text-white/40" style={{ fontSize: sp.statLabelSize }}>{label}</span>
      <span
        className={`font-semibold ${
          highlight ? "text-uranus-violet" : "text-white"
        }`}
        style={{ fontSize: sp.statValueSize }}
      >
        {value}
      </span>
    </div>
  );
}
