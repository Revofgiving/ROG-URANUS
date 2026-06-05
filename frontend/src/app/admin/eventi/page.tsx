"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";
import StatusBadge from "@/components/admin/StatusBadge";

const DIM = { color: "rgba(147,197,253,0.55)" };
const LABEL = { color: "rgba(96,165,250,0.6)", letterSpacing: "0.1em" };
const CS = { background: "#0a1628", borderColor: "rgba(30,58,138,0.3)" };

interface Evento {
  id: number;
  name: string;
  date: string;
  time?: string;
  type: "online" | "presence";
  description?: string;
  link?: string;
  location?: string;
  maxParticipants: number;
  participantsCount: number;
  status: "upcoming" | "past" | "cancelled";
}

interface EventiData {
  events: Evento[];
}

const EMPTY_FORM = { name: "", date: "", time: "", type: "online" as const, description: "", link: "", location: "", maxParticipants: 100 };

// ── Mini Calendar ──────────────────────────────────────────────────────────
function MiniCalendar({ eventDates }: { eventDates: string[] }) {
  const [cur, setCur] = useState(new Date());
  const y = cur.getFullYear(), m = cur.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstDay = new Date(y, m, 1).getDay();
  const pad = firstDay === 0 ? 6 : firstDay - 1;
  const evSet = new Set(
    eventDates
      .filter((d) => { const dt = new Date(d); return dt.getFullYear() === y && dt.getMonth() === m; })
      .map((d) => new Date(d).getDate())
  );
  const today = new Date();
  const isToday = (d: number) => today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
  const cells = [...Array(pad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setCur(new Date(y, m - 1, 1))} className="p-1 rounded-lg" style={DIM}>‹</button>
        <p className="text-sm font-semibold text-white capitalize">
          {cur.toLocaleDateString("it-IT", { month: "long", year: "numeric" })}
        </p>
        <button onClick={() => setCur(new Date(y, m + 1, 1))} className="p-1 rounded-lg" style={DIM}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {["L", "M", "M", "G", "V", "S", "D"].map((d, i) => (
          <div key={i} className="text-center text-xs py-1 font-medium" style={LABEL}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => (
          <div
            key={i}
            className="aspect-square flex flex-col items-center justify-center rounded-lg text-xs relative"
            style={d ? {
              background: isToday(d) ? "rgba(6,182,212,0.25)" : evSet.has(d) ? "rgba(30,58,138,0.35)" : "transparent",
              color: isToday(d) ? "#22d3ee" : "rgba(191,219,254,0.8)",
              border: isToday(d) ? "1px solid rgba(6,182,212,0.5)" : "1px solid transparent",
              fontWeight: isToday(d) ? "bold" : "normal",
            } : {}}
          >
            {d}
            {d && evSet.has(d) && <div className="absolute bottom-0.5 w-1 h-1 rounded-full" style={{ background: "#22d3ee" }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Modal Crea Evento ──────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { log } = useLog();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errore, setErrore] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form, v: string | number) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrore("");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErrore("⚠️ Il nome è obbligatorio");
    if (!form.date) return setErrore("⚠️ La data è obbligatoria");
    setLoading(true);
    try {
      await adminApi("/api/eventi", { method: "POST", body: JSON.stringify(form) });
      log("Evento creato con successo", "success");
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrore(msg);
      log(`Errore creazione evento: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const inp = "w-full px-3 py-2 text-sm rounded-xl focus:outline-none";
  const inpStyle = { background: "rgba(14,27,60,0.7)", border: "1px solid rgba(30,58,138,0.4)", color: "rgba(191,219,254,0.9)" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="rounded-2xl border w-full max-w-lg p-6" style={CS}>
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-bold text-white">Crea Nuovo Evento</p>
          <button onClick={onClose} style={DIM} className="text-xl">✕</button>
        </div>
        <form onSubmit={(e) => { void save(e); }} className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Nome evento *</label>
            <input className={inp} style={inpStyle} placeholder="Es. Assemblea Mensile" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Data *</label>
              <input type="date" className={inp} style={inpStyle} value={form.date} onChange={(e) => set("date", e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Ora</label>
              <input type="time" className={inp} style={inpStyle} value={form.time} onChange={(e) => set("time", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Tipo *</label>
            <div className="flex gap-3">
              {(["online", "presence"] as const).map((val) => (
                <button key={val} type="button" onClick={() => set("type", val)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: form.type === val ? (val === "online" ? "rgba(34,211,238,0.12)" : "rgba(167,139,250,0.12)") : "rgba(14,27,60,0.4)",
                    border: `1px solid ${form.type === val ? (val === "online" ? "#22d3ee" : "#a78bfa") : "rgba(30,58,138,0.3)"}`,
                    color: form.type === val ? (val === "online" ? "#22d3ee" : "#a78bfa") : "rgba(147,197,253,0.6)",
                  }}>
                  {val === "online" ? "Online" : "In presenza"}
                </button>
              ))}
            </div>
          </div>
          {form.type === "online" ? (
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Link riunione</label>
              <input className={inp} style={inpStyle} placeholder="https://meet.google.com/..." value={form.link} onChange={(e) => set("link", e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Luogo</label>
              <input className={inp} style={inpStyle} placeholder="Es. Hotel Excelsior, Milano" value={form.location} onChange={(e) => set("location", e.target.value)} />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Descrizione</label>
            <textarea className={`${inp} resize-none`} style={inpStyle} rows={3} placeholder="Breve descrizione..." value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-1.5 block" style={LABEL}>Max partecipanti</label>
            <input type="number" min={1} className={inp} style={inpStyle} value={form.maxParticipants} onChange={(e) => set("maxParticipants", e.target.value)} />
          </div>
          {errore && <div className="p-3 rounded-xl text-xs font-medium" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>{errore}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all" style={{ border: "1px solid rgba(30,58,138,0.4)", color: "rgba(147,197,253,0.7)", background: "transparent" }}>Annulla</button>
            <button type="submit" disabled={loading || !form.name || !form.date} className="flex-1 py-2.5 text-sm font-bold rounded-xl transition-all disabled:opacity-50" style={{ background: "#1e40af", color: "white" }}>
              {loading ? "Salvataggio..." : "Crea Evento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Pagina principale ─────────────────────────────────────────────────────
export default function AdminEventiPage() {
  const { log } = useLog();
  const router = useRouter();
  const [data, setData] = useState<EventiData | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetch = useCallback(async () => {
    try {
      const res = await adminApi<EventiData>("/api/eventi");
      setData(res);
    } catch (err: unknown) {
      log(`Errore caricamento eventi: ${err instanceof Error ? err.message : err}`, "error");
    }
  }, [log]);

  useEffect(() => { void fetch(); }, [fetch]);

  const allEvents = data?.events ?? [];
  const upcoming = allEvents.filter((e) => e.status === "upcoming");
  const past = allEvents.filter((e) => e.status === "past");
  const nextEvent = upcoming[0] ?? null;
  const totalIscritti = upcoming.reduce((s, e) => s + (e.participantsCount ?? 0), 0);
  const eventDates = allEvents.map((e) => e.date);

  const kpis = [
    { label: "Eventi Programmati", value: upcoming.length, icon: "📅", color: "#22d3ee" },
    { label: "Partecipanti Iscritti", value: totalIscritti, icon: "👥", color: "#60a5fa" },
    { label: "Eventi Conclusi", value: past.length, icon: "📊", color: "#10b981" },
    { label: "Ore Volontariato", value: 342, icon: "⏱️", color: "#a78bfa" },
  ];

  return (
    <div className="space-y-4">
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { void fetch(); }} />}

      {/* KPI */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="glass-card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-widest" style={LABEL}>{k.label}</p>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base" style={{ background: `${k.color}18` }}>{k.icon}</div>
            </div>
            <p className="text-2xl font-bold text-white">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Row 2: Calendario + Prossimo Evento */}
      <div className="grid grid-cols-12 gap-4">
        <div className="glass-card col-span-5 p-5">
          <p className="text-sm font-semibold text-white mb-4">📅 Calendario Eventi</p>
          <MiniCalendar eventDates={eventDates} />
          <div className="flex items-center gap-3 mt-4 pt-3" style={{ borderTop: "1px solid rgba(30,58,138,0.2)" }}>
            <div className="flex items-center gap-1.5 text-xs" style={DIM}><div className="w-2 h-2 rounded-full" style={{ background: "#22d3ee" }} /> Evento</div>
            <div className="flex items-center gap-1.5 text-xs" style={DIM}><div className="w-2 h-2 rounded-full" style={{ background: "rgba(6,182,212,0.4)", border: "1px solid #22d3ee" }} /> Oggi</div>
          </div>
        </div>

        <div className="glass-card col-span-4 p-5 flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "rgba(34,211,238,0.6)" }}>Prossimo Evento</p>
          {nextEvent ? (
            <>
              <div className="flex-1">
                <p className="text-sm font-bold text-white leading-snug mb-1">{nextEvent.name}</p>
                <div className="space-y-1.5 mt-2">
                  <p className="flex items-center gap-1.5 text-xs" style={DIM}>📅 {nextEvent.date}{nextEvent.time && ` — ${nextEvent.time}`}</p>
                  <p className="flex items-center gap-1.5 text-xs" style={DIM}>
                    {nextEvent.type === "online" ? "🌐 Online" : `📍 ${nextEvent.location}`}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs" style={DIM}>👥 {nextEvent.participantsCount} / {nextEvent.maxParticipants} iscritti</p>
                </div>
              </div>
              <button onClick={() => router.push(`/admin/eventi/${nextEvent.id}`)}
                className="w-full mt-4 py-2 text-xs font-bold text-white rounded-xl transition-all"
                style={{ background: "linear-gradient(135deg,#1e40af,#0e7490)" }}>
                Partecipa →
              </button>
            </>
          ) : <p className="text-xs" style={DIM}>Nessun evento in programma</p>}
        </div>

        <div className="glass-card col-span-3 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "rgba(34,211,238,0.6)" }}>Accesso Rapido</p>
          <div className="space-y-2">
            <button onClick={() => setShowCreate(true)} className="w-full py-2.5 text-sm font-bold rounded-xl transition-all" style={{ background: "linear-gradient(135deg,#1e40af,#06b6d4)", color: "white" }}>
              ➕ Crea Evento
            </button>
            <button className="w-full py-2.5 text-sm font-semibold rounded-xl transition-all" style={{ border: "1px solid rgba(30,58,138,0.4)", color: "rgba(147,197,253,0.7)", background: "transparent" }}>
              👥 Gestisci Iscrizioni
            </button>
            <button className="w-full py-2.5 text-sm font-semibold rounded-xl transition-all" style={{ border: "1px solid rgba(30,58,138,0.4)", color: "rgba(147,197,253,0.7)", background: "transparent" }}>
              📊 Visualizza Report
            </button>
          </div>
        </div>
      </div>

      {/* Lista eventi upcoming */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-white">📋 Eventi della Comunità</p>
          <button onClick={() => setShowCreate(true)} className="admin-btn admin-btn-primary text-xs">➕ Nuovo</button>
        </div>
        <div className="space-y-3">
          {upcoming.map((ev) => (
            <div
              key={ev.id}
              onClick={() => router.push(`/admin/eventi/${ev.id}`)}
              className="flex items-center gap-3 cursor-pointer p-3 rounded-xl transition-all"
              style={{ background: "rgba(14,27,60,0.4)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(14,27,60,0.7)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(14,27,60,0.4)")}
            >
              <div className="w-10 h-10 rounded-lg flex flex-col items-center justify-center flex-shrink-0" style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)" }}>
                <span className="text-xs font-bold text-white">{new Date(ev.date).getDate()}</span>
                <span className="text-xs uppercase" style={DIM}>{new Date(ev.date).toLocaleDateString("it-IT", { month: "short" })}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{ev.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs" style={{ color: ev.type === "online" ? "#22d3ee" : "#a78bfa" }}>
                    {ev.type === "online" ? "🌐 Online" : "📍 In presenza"}
                  </span>
                  <span className="text-xs" style={DIM}>{ev.participantsCount}/{ev.maxParticipants} posti</span>
                </div>
              </div>
              <StatusBadge status={ev.status} />
              <span className="text-xl" style={DIM}>›</span>
            </div>
          ))}
          {upcoming.length === 0 && <p className="text-xs text-center py-4" style={DIM}>Nessun evento in programma</p>}
        </div>
      </div>

      {/* Statistiche */}
      <div className="glass-card p-5">
        <p className="text-sm font-semibold text-white mb-4">📊 Statistiche</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Partecipanti Totali", value: "450", color: "#22d3ee" },
            { label: "Donazioni Generate", value: "15.600 USDC", color: "#10b981" },
            { label: "Nuovi Membri", value: "38", color: "#a78bfa" },
            { label: "Impatto Sociale", value: "1.247 persone", color: "#f59e0b" },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl" style={{ background: "rgba(14,27,60,0.5)" }}>
              <p className="text-xs" style={LABEL}>{s.label}</p>
              <p className="text-xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
