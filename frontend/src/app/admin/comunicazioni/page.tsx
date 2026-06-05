"use client";

import { useState, useEffect, useCallback } from "react";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";
import { PLANETS } from "@/components/admin/PlanetBadge";

const DIM = { color: "rgba(147,197,253,0.55)" };
const LABEL = { color: "rgba(96,165,250,0.6)", letterSpacing: "0.1em" };

// ── Dati statici ───────────────────────────────────────────────────────────
const ANNUNCI = [
  { tag: "Ufficiale",   tagC: "#22d3ee", title: "Avvio Fase 3 del Progetto ROG",       date: "01/06/2026" },
  { tag: "Informativo", tagC: "#60a5fa", title: "Nuove Linee Guida per i Donatori",    date: "25/05/2026" },
  { tag: "Operativo",   tagC: "#10b981", title: "Aggiornamento Struttura Posizioni",   date: "10/05/2026" },
  { tag: "Urgente",     tagC: "#f87171", title: "Manutenzione programmata 10 Giugno",  date: "05/06/2026" },
];

const NEWSLETTERS = [
  { month: "Giugno 2026", date: "01/06/2026", recipients: 340, openRate: 71 },
  { month: "Maggio 2026", date: "01/05/2026", recipients: 315, openRate: 68 },
  { month: "Aprile 2026", date: "01/04/2026", recipients: 290, openRate: 65 },
];

const NOTIZIE = [
  { emoji: "🌍", title: "Progetto Kenya: 200 famiglie aiutate",    date: "30/05/2026", cat: "Progetti"      },
  { emoji: "🏆", title: "Nuovo record: 50.000 USDC raccolti",       date: "22/05/2026", cat: "Traguardo"    },
  { emoji: "💙", title: "Testimonianza: Marco cambia vita",         date: "15/05/2026", cat: "Testimonianze" },
  { emoji: "🚀", title: "Aperta la comunità ROG di Torino",        date: "08/05/2026", cat: "Comunità"      },
];

const SOCIAL = [
  { platform: "Instagram", color: "#e1306c", posts: 18, followers: "+47", engagement: "14.2%" },
  { platform: "Facebook",  color: "#1877f2", posts: 15, followers: "+38", engagement: "9.8%"  },
  { platform: "TikTok",    color: "#ff0050", posts: 12, followers: "+42", engagement: "18.5%" },
  { platform: "YouTube",   color: "#ff0000", posts: 3,  followers: "+12", engagement: "6.1%"  },
];

const CAMPAGNE = [
  { name: "Estate del Dono 2026",  target: 8000, raised: 5200, color: "#22d3ee" },
  { name: "Solidarietà Africa",    target: 5000, raised: 4400, color: "#10b981" },
  { name: "Borse di Studio ROG",   target: 3000, raised: 1800, color: "#a78bfa" },
];

const BACHECA = [
  { community: "Milano",  msg: "Cerchiamo volontari per evento estivo",     time: "2h fa",       type: "Richiesta"      },
  { community: "Napoli",  msg: "Raggiunti 50 membri! 🎉 Grande traguardo",  time: "1 giorno fa", type: "Annuncio"       },
  { community: "Roma",    msg: "Disponibilità collaborazione evento luglio", time: "2 giorni fa", type: "Collaborazione" },
  { community: "Torino",  msg: "Primo evento locale confermato per il 20/6",time: "3 giorni fa", type: "Evento"         },
];

const MESSAGGI = [
  { from: "Admin",   msg: "Reminder: assemblea 15 Giugno ore 20:00",           time: "1h fa",       type: "reminder" },
  { from: "Sistema", msg: "2 nuovi membri iscritti questa settimana",           time: "3h fa",       type: "sistema"  },
  { from: "Admin",   msg: "Nuova guida disponibile nella sezione Risorse",      time: "1 giorno fa", type: "info"     },
  { from: "Sistema", msg: "Newsletter Giugno aperta dal 71% dei destinatari",   time: "2 giorni fa", type: "sistema"  },
];

const GRATITUDINE = [
  { wallet: "0x3F4A...6F5A", msg: "Grazie alla comunità ROG per l'impatto che state creando!",   amount: "150 USDC", date: "02/06/2026" },
  { wallet: "0xA1B2...EF12", msg: "Ogni donazione è un seme. Grazie per coltivarli insieme.",     amount: "100 USDC", date: "01/06/2026" },
  { wallet: "0x9E8D...1817", msg: "ROG-URANUS ha cambiato il modo in cui vedo il mondo.",         amount: "50 USDC",  date: "31/05/2026" },
  { wallet: "0xFEDC...BA98", msg: "Essere parte di questo movimento è un onore.",                  amount: "200 USDC", date: "30/05/2026" },
  { wallet: "0x2B4D...8F0A", msg: "La forza del dono è reale. L'ho vissuto sulla mia pelle.",     amount: "75 USDC",  date: "29/05/2026" },
];

// ── Tipi testimonianze ─────────────────────────────────────────────────────
interface Testimonianza {
  id: number;
  wallet: string;
  messaggio: string;
  livello: string;
  status: "pending" | "approved" | "rejected";
  data: string;
}

interface TesData {
  testimonianze: Testimonianza[];
  pending: number;
  approved: number;
}

export default function AdminComunicazioniPage() {
  const { log } = useLog();
  const [tesData, setTesData] = useState<TesData | null>(null);
  const [tesFetching, setTesFetching] = useState(false);

  const fetchTes = useCallback(async () => {
    setTesFetching(true);
    try {
      const res = await adminApi<TesData>("/api/testimonianze");
      setTesData(res);
    } catch (err: unknown) {
      log(`Errore testimonianze: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setTesFetching(false);
    }
  }, [log]);

  useEffect(() => { void fetchTes(); }, [fetchTes]);

  const approva = async (id: number) => {
    try {
      await adminApi(`/api/testimonianze/${id}/approva`, { method: "POST" });
      log("Testimonianza approvata", "success");
      void fetchTes();
    } catch (err: unknown) {
      log(`Errore: ${err instanceof Error ? err.message : err}`, "error");
    }
  };

  const rifiuta = async (id: number) => {
    try {
      await adminApi(`/api/testimonianze/${id}/rifiuta`, { method: "POST" });
      log("Testimonianza rifiutata", "success");
      void fetchTes();
    } catch (err: unknown) {
      log(`Errore: ${err instanceof Error ? err.message : err}`, "error");
    }
  };

  const kpis = [
    { label: "Messaggi Inviati",  value: "1.247", growth: "+15%", icon: "📤", color: "#22d3ee" },
    { label: "Membri Raggiunti",  value: "892",   growth: "+8%",  icon: "👥", color: "#60a5fa" },
    { label: "Tasso di Apertura", value: "68%",   growth: "+3%",  icon: "📬", color: "#10b981" },
    { label: "Nuovi Iscritti",    value: "23",    growth: "+12%", icon: "👤", color: "#a78bfa" },
  ];

  const typeC: Record<string, string> = { Richiesta: "#f59e0b", Annuncio: "#22d3ee", Collaborazione: "#a78bfa", Evento: "#10b981" };
  const msgIc: Record<string, string> = { reminder: "⏰", sistema: "🔔", info: "ℹ️" };

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="glass-card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-widest" style={LABEL}>{k.label}</p>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base" style={{ background: `${k.color}18` }}>{k.icon}</div>
            </div>
            <p className="text-2xl font-bold text-white">{k.value}</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-xs font-medium" style={{ color: "#34d399" }}>↑ {k.growth}</span>
              <span className="text-xs ml-1" style={DIM}>vs mese prec.</span>
            </div>
          </div>
        ))}
      </div>

      {/* Row 2: Annunci + Newsletter */}
      <div className="grid grid-cols-12 gap-4">
        <div className="glass-card col-span-6 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span>📣</span>
            <p className="text-sm font-semibold text-white">Annunci Ufficiali</p>
          </div>
          <div className="space-y-2.5">
            {ANNUNCI.map((a, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(14,27,60,0.4)" }}>
                <span className="text-xs px-2 py-0.5 rounded font-semibold flex-shrink-0 mt-0.5" style={{ background: `${a.tagC}18`, color: a.tagC }}>{a.tag}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white leading-snug">{a.title}</p>
                  <p className="text-xs mt-0.5" style={DIM}>{a.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card col-span-6 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span>✉️</span>
              <p className="text-sm font-semibold text-white">Newsletter</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>Prossima: 01/07/2026</span>
          </div>
          <div className="space-y-2.5">
            {NEWSLETTERS.map((n, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(14,27,60,0.4)" }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-white">{n.month}</p>
                    <span className="text-xs" style={DIM}>{n.date}</span>
                  </div>
                  <p className="text-xs mt-0.5" style={DIM}>{n.recipients} destinatari</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold" style={{ color: "#22d3ee" }}>{n.openRate}%</p>
                  <p className="text-xs" style={DIM}>apertura</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Notizie + Social + Campagne */}
      <div className="grid grid-cols-12 gap-4">
        <div className="glass-card col-span-4 p-5">
          <div className="flex items-center gap-2 mb-4"><span>📰</span><p className="text-sm font-semibold text-white">Notizie dal Movimento</p></div>
          <div className="flex items-center gap-3 p-3 rounded-xl mb-4" style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)" }}>
            <div className="text-center flex-shrink-0">
              <p className="text-2xl font-black leading-none" style={{ color: "#22d3ee" }}>#28</p>
              <p className="text-xs font-medium mt-0.5" style={{ color: "rgba(34,211,238,0.6)" }}>MEMBRO</p>
            </div>
            <div style={{ borderLeft: "1px solid rgba(6,182,212,0.2)", paddingLeft: "12px" }}>
              <p className="text-xs font-bold text-white">Siamo al membro numero 28</p>
              <p className="text-xs mt-0.5" style={DIM}>Ultimo ingresso: 10/03/2026</p>
              <p className="text-xs mt-0.5" style={{ color: "#34d399" }}>+3 nuovi questo mese ↑</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {NOTIZIE.map((n, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-base flex-shrink-0">{n.emoji}</span>
                <div>
                  <p className="text-xs font-semibold text-white leading-snug">{n.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>{n.cat}</span>
                    <span className="text-xs" style={DIM}>{n.date}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card col-span-4 p-5">
          <div className="flex items-center gap-2 mb-4"><span>🌐</span><p className="text-sm font-semibold text-white">Social Media</p></div>
          <div className="space-y-2.5">
            {SOCIAL.map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: "rgba(14,27,60,0.4)" }}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-white">{s.platform}</p>
                  <p className="text-xs" style={DIM}>{s.posts} post · {s.engagement} engagement</p>
                </div>
                <span className="text-xs font-bold" style={{ color: "#34d399" }}>{s.followers}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card col-span-4 p-5">
          <div className="flex items-center gap-2 mb-4"><span>🎯</span><p className="text-sm font-semibold text-white">Campagne Attive</p></div>
          <div className="space-y-4">
            {CAMPAGNE.map((c, i) => {
              const pct = Math.round((c.raised / c.target) * 100);
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-white">{c.name}</p>
                    <span className="text-xs font-bold" style={{ color: c.color }}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(30,58,138,0.3)" }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: c.color }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs" style={DIM}>{c.raised.toLocaleString("it-IT")} USDC</span>
                    <span className="text-xs" style={DIM}>/ {c.target.toLocaleString("it-IT")} USDC</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Muro della Gratitudine */}
      <div className="rounded-2xl border p-6 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg,#050d24,#0a1540,#050d24)", borderColor: "rgba(34,211,238,0.3)", boxShadow: "0 0 40px rgba(34,211,238,0.08)" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.25)" }}>🙏</div>
          <div>
            <p className="text-base font-bold text-white">Muro della Gratitudine</p>
            <p className="text-xs" style={DIM}>Ringraziamenti pubblici dalla comunità ROG-URANUS</p>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {GRATITUDINE.map((g, i) => (
            <div key={i} className="rounded-xl p-4 flex flex-col gap-2 transition-all"
              style={{ background: "rgba(14,27,60,0.5)", border: "1px solid rgba(34,211,238,0.15)" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(34,211,238,0.15)")}>
              <span className="text-xl">💙</span>
              <p className="text-xs leading-relaxed italic" style={{ color: "rgba(191,219,254,0.85)" }}>&quot;{g.msg}&quot;</p>
              <div className="mt-auto pt-2" style={{ borderTop: "1px solid rgba(30,58,138,0.25)" }}>
                <p className="font-mono text-xs font-semibold" style={{ color: "#22d3ee" }}>{g.wallet}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs" style={DIM}>{g.date}</span>
                  <span className="text-xs font-bold" style={{ color: "#34d399" }}>{g.amount}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Row 5: Bacheca + Messaggi */}
      <div className="grid grid-cols-12 gap-4">
        <div className="glass-card col-span-6 p-5">
          <div className="flex items-center gap-2 mb-4"><span>💬</span><p className="text-sm font-semibold text-white">Bacheca Comunità</p></div>
          <div className="space-y-2.5">
            {BACHECA.map((b, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(14,27,60,0.4)" }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold" style={{ color: "#60a5fa" }}>{b.community}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${typeC[b.type]}18`, color: typeC[b.type] }}>{b.type}</span>
                  </div>
                  <p className="text-xs text-white">{b.msg}</p>
                  <p className="text-xs mt-0.5" style={DIM}>{b.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card col-span-6 p-5">
          <div className="flex items-center gap-2 mb-4"><span>🔔</span><p className="text-sm font-semibold text-white">Messaggi Interni & Notifiche</p></div>
          <div className="space-y-2.5">
            {MESSAGGI.map((m, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(14,27,60,0.4)" }}>
                <span className="text-base flex-shrink-0">{msgIc[m.type]}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-bold" style={{ color: "#60a5fa" }}>{m.from}</span>
                    <span className="text-xs" style={DIM}>{m.time}</span>
                  </div>
                  <p className="text-xs text-white">{m.msg}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Testimonianze con approvazione */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><span>💬</span><p className="text-sm font-semibold text-white">Testimonianze</p></div>
          <div className="flex items-center gap-2">
            {tesData && tesData.pending > 0 && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
                ⏳ {tesData.pending} in attesa
              </span>
            )}
            {tesData && <span className="text-xs" style={DIM}>{tesData.approved} approvate</span>}
            <button onClick={() => { void fetchTes(); }}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-all"
              style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee" }}>
              {tesFetching ? "⟳ Carico..." : "⟳ Ricarica"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {tesData?.testimonianze?.map((t) => {
            const p = PLANETS[t.livello?.toUpperCase()] ?? PLANETS.SOLE;
            const short = t.wallet ? `${t.wallet.slice(0, 6)}...${t.wallet.slice(-4)}` : "--";
            const isPending = t.status === "pending";
            return (
              <div key={t.id} className="p-3 rounded-xl"
                style={{
                  background: "rgba(14,27,60,0.4)",
                  border: `1px solid ${isPending ? "rgba(245,158,11,0.2)" : t.status === "approved" ? "rgba(167,139,250,0.15)" : "rgba(239,68,68,0.15)"}`,
                }}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs" style={{ color: "#22d3ee" }}>{short}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
                      style={{
                        background: isPending ? "rgba(245,158,11,0.1)" : t.status === "approved" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                        color: isPending ? "#f59e0b" : t.status === "approved" ? "#10b981" : "#f87171",
                      }}>
                      {isPending ? "⏳ In attesa" : t.status === "approved" ? "✓ Approvata" : "✗ Rifiutata"}
                    </span>
                  </div>
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: `${p.color}18`, color: p.color }}>{p.simbolo} {t.livello}</span>
                </div>
                <p className="text-xs leading-relaxed italic" style={{ color: "rgba(191,219,254,0.85)" }}>&quot;{t.messaggio}&quot;</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs" style={DIM}>{t.data}</span>
                  {isPending && (
                    <div className="flex gap-1.5">
                      <button onClick={() => { void approva(t.id); }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                        style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.25)" }}>
                        ✓ Approva
                      </button>
                      <button onClick={() => { void rifiuta(t.id); }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                        style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
                        ✗ Rifiuta
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!tesData?.testimonianze?.length && (
            <div className="col-span-2 text-center py-8">
              <p className="text-xs" style={DIM}>Nessuna testimonianza ricevuta</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
