"use client";

import { useState } from "react";

const DIM = { color: "rgba(147,197,253,0.55)" };
const LABEL = { color: "rgba(96,165,250,0.6)", letterSpacing: "0.1em" };

const CATS = [
  { id: "all",       label: "Tutte",         icon: "📦", color: "#22d3ee" },
  { id: "documenti", label: "Documenti",      icon: "📄", color: "#60a5fa" },
  { id: "marketing", label: "Marketing",      icon: "🖼️", color: "#a78bfa" },
  { id: "media",     label: "Media Center",  icon: "🎬", color: "#f59e0b" },
  { id: "download",  label: "Download",      icon: "📥", color: "#10b981" },
  { id: "faq",       label: "FAQ",           icon: "❓", color: "#38bdf8" },
];

interface Risorsa {
  id: number;
  cat: string;
  name: string;
  type: string;
  size: string;
  date: string;
  typeColor: string;
}

const RESOURCES: Risorsa[] = [
  { id: 1,  cat: "documenti", name: "Regolamento Interno ROG-URANUS",   type: "PDF",  size: "2,4 MB",  date: "01/05/2026", typeColor: "#f87171" },
  { id: 2,  cat: "documenti", name: "Guida Operativa per Nuovi Membri", type: "PDF",  size: "1,8 MB",  date: "15/04/2026", typeColor: "#f87171" },
  { id: 3,  cat: "documenti", name: "Statuto del Movimento",            type: "PDF",  size: "856 KB",  date: "10/01/2026", typeColor: "#f87171" },
  { id: 4,  cat: "documenti", name: "Codice Etico ROG",                 type: "PDF",  size: "620 KB",  date: "10/01/2026", typeColor: "#f87171" },
  { id: 5,  cat: "marketing", name: "Logo Ufficiale ROG-URANUS",        type: "ZIP",  size: "12 MB",   date: "20/05/2026", typeColor: "#a78bfa" },
  { id: 6,  cat: "marketing", name: "Brand Kit Completo",               type: "ZIP",  size: "45 MB",   date: "20/05/2026", typeColor: "#a78bfa" },
  { id: 7,  cat: "marketing", name: "Brochure Movimento 2026",          type: "PDF",  size: "5,2 MB",  date: "01/03/2026", typeColor: "#f87171" },
  { id: 8,  cat: "marketing", name: "Volantino Reclutamento",           type: "PDF",  size: "1,1 MB",  date: "10/04/2026", typeColor: "#f87171" },
  { id: 9,  cat: "marketing", name: "Presentazione Aziendale",          type: "PPT",  size: "8,7 MB",  date: "28/02/2026", typeColor: "#fb923c" },
  { id: 10, cat: "media",     name: "Foto Assemblea Maggio 2026",       type: "ZIP",  size: "82 MB",   date: "17/05/2026", typeColor: "#a78bfa" },
  { id: 11, cat: "media",     name: "Video Presentazione ROG",          type: "MP4",  size: "234 MB",  date: "05/04/2026", typeColor: "#22d3ee" },
  { id: 12, cat: "media",     name: "Podcast Ep.1 — Il Dono",           type: "MP3",  size: "28 MB",   date: "15/03/2026", typeColor: "#f59e0b" },
  { id: 13, cat: "media",     name: "Intervista al Fondatore",          type: "MP4",  size: "145 MB",  date: "10/02/2026", typeColor: "#22d3ee" },
  { id: 14, cat: "media",     name: "Podcast Ep.2 — Community",         type: "MP3",  size: "32 MB",   date: "10/04/2026", typeColor: "#f59e0b" },
  { id: 15, cat: "download",  name: "Modulo Adesione Movimento",        type: "PDF",  size: "320 KB",  date: "01/05/2026", typeColor: "#f87171" },
  { id: 16, cat: "download",  name: "Contratto Standard Donatore",      type: "PDF",  size: "480 KB",  date: "01/04/2026", typeColor: "#f87171" },
  { id: 17, cat: "download",  name: "Template Report Mensile",          type: "DOCX", size: "156 KB",  date: "20/03/2026", typeColor: "#60a5fa" },
  { id: 18, cat: "download",  name: "Template Presentazione Comunità",  type: "PPT",  size: "2,1 MB",  date: "20/03/2026", typeColor: "#fb923c" },
  { id: 19, cat: "download",  name: "Modulo Cambio Wallet",             type: "PDF",  size: "215 KB",  date: "15/02/2026", typeColor: "#f87171" },
];

const FAQS = [
  { q: "Come posso registrarmi al movimento?", a: "Per registrarti al movimento ROG-URANUS, contatta un membro attivo che ti fornirà il tuo wallet di accesso e il numero progressivo di entrata." },
  { q: "Come funziona il sistema di posizioni?", a: "Ogni donazione acquisisce una o più posizioni nel movimento in base all'importo donato. Le posizioni sono visibili nel tuo profilo nella sezione Comunità." },
  { q: "Posso trasferire le mie posizioni?", a: "No. Le posizioni sono personali e legate al tuo wallet. Il numero progressivo di entrata è immutabile e non trasferibile." },
  { q: "Come partecipo agli eventi?", a: "Accedi alla sezione Eventi del pannello admin e clicca su \"Partecipa\" per l'evento di tuo interesse. Per gli eventi in presenza, la prenotazione è obbligatoria." },
  { q: "Come posso scaricare i materiali marketing?", a: "Tutti i materiali ufficiali sono disponibili in questa sezione Risorse nella categoria Marketing. Clicca su \"Scarica\" per effettuare il download." },
  { q: "Dove trovo il mio numero progressivo?", a: "Il tuo numero d'entrata è visibile nella sezione Comunità del pannello admin, nella colonna \"#\" della tabella membri." },
  { q: "Come posso contattare il supporto?", a: "Per assistenza tecnica o amministrativa, utilizza la sezione Comunicazioni del pannello oppure invia un messaggio al tuo referente di comunità." },
];

const FILE_ICONS: Record<string, string> = { PDF: "📄", ZIP: "🗜️", PPT: "📊", DOCX: "📝", MP4: "🎬", MP3: "🎙️", PNG: "🖼️", SVG: "🎨" };

function ResourceCard({ res }: { res: Risorsa }) {
  return (
    <div
      className="glass-card p-4 flex items-center gap-3 transition-all"
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(6,182,212,0.3)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
        style={{ background: `${res.typeColor}15`, border: `1px solid ${res.typeColor}30` }}>
        {FILE_ICONS[res.type] ?? "📁"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-snug truncate">{res.name}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: `${res.typeColor}18`, color: res.typeColor }}>{res.type}</span>
          <span className="text-xs" style={DIM}>{res.size}</span>
          <span className="text-xs" style={DIM}>{res.date}</span>
        </div>
      </div>
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl flex-shrink-0 transition-all"
        style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", color: "#22d3ee" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(6,182,212,0.18)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(6,182,212,0.08)")}
      >
        📥 Scarica
      </button>
    </div>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{ background: "rgba(14,27,60,0.4)", border: `1px solid ${open ? "rgba(6,182,212,0.3)" : "rgba(30,58,138,0.2)"}` }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors">
        <span className="text-sm font-semibold text-white pr-4">{q}</span>
        <span style={{ color: "#22d3ee" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-4" style={{ borderTop: "1px solid rgba(30,58,138,0.2)" }}>
          <p className="text-sm pt-3 leading-relaxed" style={DIM}>{a}</p>
        </div>
      )}
    </div>
  );
}

export default function AdminRisorsePage() {
  const [activeCat, setActiveCat] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = RESOURCES.filter((r) => {
    const matchCat = activeCat === "all" || r.cat === activeCat;
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const countByCat = (cat: string) => RESOURCES.filter((r) => r.cat === cat).length;

  return (
    <div className="space-y-5">
      {/* Header + Ricerca */}
      <div className="glass-card p-4 flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-56">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={DIM}>🔍</span>
          <input
            type="text"
            placeholder="Cerca una risorsa..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setActiveCat("all"); }}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl focus:outline-none"
            style={{ background: "rgba(14,27,60,0.6)", border: "1px solid rgba(30,58,138,0.4)", color: "rgba(191,219,254,0.9)" }}
          />
        </div>
        <p className="text-xs" style={DIM}>{filtered.length} risorse disponibili</p>
      </div>

      {/* Tabs categoria */}
      <div className="flex gap-2 flex-wrap">
        {CATS.map((c) => (
          <button key={c.id} onClick={() => { setActiveCat(c.id); setSearch(""); }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-all"
            style={{
              background: activeCat === c.id ? `${c.color}15` : "transparent",
              border: `1px solid ${activeCat === c.id ? c.color : "rgba(30,58,138,0.3)"}`,
              color: activeCat === c.id ? c.color : "rgba(147,197,253,0.6)",
            }}>
            {c.icon} {c.label}
            {c.id !== "all" && c.id !== "faq" && (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${c.color}20`, color: c.color }}>
                {countByCat(c.id)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* FAQ */}
      {activeCat === "faq" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: "#38bdf8" }}>❓</span>
            <p className="text-sm font-semibold text-white">Domande Frequenti & Supporto</p>
          </div>
          {FAQS.map((f, i) => <FAQItem key={i} q={f.q} a={f.a} />)}
        </div>
      ) : (
        <>
          {filtered.length > 0 ? (
            activeCat === "all" && !search ? (
              CATS.filter((c) => c.id !== "all" && c.id !== "faq").map((c) => {
                const items = RESOURCES.filter((r) => r.cat === c.id);
                if (!items.length) return null;
                return (
                  <div key={c.id} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 rounded-full" style={{ background: c.color }} />
                      <span>{c.icon}</span>
                      <p className="text-sm font-semibold text-white">{c.label}</p>
                      <span className="text-xs" style={DIM}>({items.length})</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {items.map((r) => <ResourceCard key={r.id} res={r} />)}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="grid grid-cols-1 gap-2.5">
                {filtered.map((r) => <ResourceCard key={r.id} res={r} />)}
              </div>
            )
          ) : (
            <div className="glass-card py-16 text-center">
              <p className="text-sm" style={DIM}>Nessuna risorsa trovata.</p>
            </div>
          )}

          {/* FAQ mini preview quando "all" */}
          {activeCat === "all" && !search && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full" style={{ background: "#38bdf8" }} />
                <span>❓</span>
                <p className="text-sm font-semibold text-white">FAQ</p>
                <span className="text-xs" style={DIM}>({FAQS.length})</span>
              </div>
              {FAQS.slice(0, 3).map((f, i) => <FAQItem key={i} q={f.q} a={f.a} />)}
              {FAQS.length > 3 && (
                <button onClick={() => setActiveCat("faq")} className="text-xs transition-colors" style={{ color: "#22d3ee" }}>
                  Vedi tutte le {FAQS.length} FAQ →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
