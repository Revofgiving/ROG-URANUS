"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";

// ============================================================
// SPAZIATURA HOME — regola da pannello 📐 poi incolla qui
// ============================================================
const DEFAULT_HOME = {
  logoSize:    197,
  logoMb:      8,
  benvenutoMb: 14,
  titleSize:   108,
  titleTrack:  5,
  titleMb:     12,
  subTrack:    9,
  subMb:       34,
  btnToData:   50,
  dataToBox:   58,
  boxToPilastri: 40,
  btnGap:      33,
  btnLeft:     10,
  btnWidth:    374,
};
const ENABLE_HOME_SPACING_PANEL = false;
// ============================================================

interface HomeSpacing {
  logoSize: number;
  logoMb: number;
  benvenutoMb: number;
  titleSize: number;
  titleTrack: number;
  titleMb: number;
  subTrack: number;
  subMb: number;
  btnToData: number;
  dataToBox: number;
  boxToPilastri: number;
  btnGap: number;
  btnLeft: number;
  btnWidth: number;
}

const homeLabels: Record<keyof HomeSpacing, string> = {
  logoSize:    "Logo — dimensione",
  logoMb:      "Logo — spazio sotto",
  benvenutoMb: "\"Benvenuto in\" — spazio sotto",
  titleSize:   "ROG-URANUS — font size",
  titleTrack:  "ROG-URANUS — letter spacing",
  titleMb:     "ROG-URANUS — spazio sotto",
  subTrack:    "Sottotitolo — letter spacing",
  subMb:       "Sottotitolo — spazio sotto",
  btnToData:   "ENTRA → Dati — spazio",
  dataToBox:   "Dati → Box — spazio",
  boxToPilastri: "Box → Fondamenta — spazio",
  btnGap:      "Bottoni — gap tra loro",
  btnLeft:     "Bottoni — posizione da sx (%)",
  btnWidth:    "Bottoni — larghezza",
};

const homeRanges: Record<keyof HomeSpacing, [number, number]> = {
  logoSize:    [40, 200],
  logoMb:      [0, 60],
  benvenutoMb: [0, 60],
  titleSize:   [48, 200],
  titleTrack:  [0, 24],
  titleMb:     [0, 60],
  subTrack:    [0, 12],
  subMb:       [0, 80],
  btnToData:   [10, 120],
  dataToBox:   [10, 120],
  boxToPilastri: [40, 200],
  btnGap:      [8, 40],
  btnLeft:     [2, 30],
  btnWidth:    [200, 400],
};

const fondamentaData = [
  {
    icon: (
      <svg className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20.5c0-3.5 3.2-6 7.5-6s7.5 2.5 7.5 6" />
        <circle cx="5" cy="10" r="2" />
        <circle cx="19" cy="10" r="2" />
        <path strokeLinecap="round" d="M2 18c0-2 1.5-3.5 3-3.5M22 18c0-2-1.5-3.5-3-3.5" />
      </svg>
    ),
    title: "COMUNITÀ",
    desc: "Costruiamo insieme un\u2019ecos\u00ednostra partecipativa basata sulla fiducia, la collaborazione e il dono.",
  },
  {
    icon: (
      <svg className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
        <path strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
        <path strokeLinejoin="round" d="M12 6l1.76 3.57 3.94.57-2.85 2.78.67 3.93L12 14.77l-3.52 2.08.67-3.93-2.85-2.78 3.94-.57L12 6z" />
      </svg>
    ),
    title: "VALORE",
    desc: "Creiamo e distribuiamo valore reale in modo equo, trasparente e sostenibile.",
  },
  {
    icon: (
      <svg className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
        <path strokeLinejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    ),
    title: "TECNOLOGIA",
    desc: "Sfruttiamo la tecnologia blockchain per garantire sicurezza, libert\u00e0 e innovazione continua.",
  },
];

const heroData = [
  {
    icon: (
      <svg className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75l7.5 3.75v5.25c0 4.7-3.05 7.85-7.5 9-4.45-1.15-7.5-4.3-7.5-9V7.5L12 3.75z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 12.75l1.5 1.5 3.75-4.5" />
      </svg>
    ),
    title: "DAO",
    subtitle: "DECENTRALIZZATA",
  },
  {
    icon: (
      <svg className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7.5 4.25v8.5L12 20 4.5 15.75v-8.5L12 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 7.25L12 11.5l7.5-4.25M12 11.5V20" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 5.25l7.5 4.25" />
      </svg>
    ),
    title: "SMART CONTRACT BLINDATO",
    subtitle: "SU POLYGON",
  },
  {
    icon: (
      <svg className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75a4.5 4.5 0 00-9 0M12 12.75a3 3 0 100-6 3 3 0 000 6z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 18.75a3.4 3.4 0 00-2.25-3.2M5.25 18.75a3.4 3.4 0 012.25-3.2M17.25 9.75a2.25 2.25 0 10-1.55-3.88M6.75 9.75A2.25 2.25 0 108.3 5.87" />
      </svg>
    ),
    title: "GOVERNANCE",
    subtitle: "PARTECIPATIVA",
  },
  {
    icon: (
      <svg className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 10.5V7.75a3.75 3.75 0 117.5 0v2.75" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 10.5h10.5a1.5 1.5 0 011.5 1.5v6.75a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5V12a1.5 1.5 0 011.5-1.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 14.25v2.25" />
      </svg>
    ),
    title: "TRASPARENZA",
    subtitle: "E SICUREZZA",
  },
];

function HomeSpacingPanel({ values, onChange }: { values: HomeSpacing; onChange: (v: HomeSpacing) => void }) {
  const [panelOpen, setPanelOpen] = useState(false);

  const update = (key: keyof HomeSpacing, val: number) => {
    const next = { ...values, [key]: val };
    onChange(next);
    if (key === 'boxToPilastri') {
      document.documentElement.style.setProperty('--box-to-pilastri', `${val}px`);
    }
  };

  const copyToClipboard = () => {
    const code = `const DEFAULT_HOME = ${JSON.stringify(values, null, 2)};`;
    navigator.clipboard.writeText(code);
  };

  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-4 right-4 z-[100] w-12 h-12 rounded-full flex items-center justify-center text-white text-lg"
        style={{
          background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
          boxShadow: "0 0 20px rgba(124, 58, 237, 0.4)",
        }}
        title="Apri pannello spaziatura"
      >
        📐
      </button>
    );
  }

  return (
    <div
      className="fixed right-4 top-4 bottom-4 z-[100] w-[320px] rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "rgba(8, 12, 28, 0.95)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(34, 211, 238, 0.2)",
        boxShadow: "0 0 40px rgba(0,0,0,0.5), 0 0 20px rgba(34, 211, 238, 0.1)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-bold tracking-[2px] text-white">📐 HOME</span>
        <div className="flex gap-2">
          <button
            onClick={copyToClipboard}
            className="text-[10px] px-2.5 py-1 rounded-full bg-uranus-cyan/10 border border-uranus-cyan/30 text-uranus-cyan hover:bg-uranus-cyan/20 transition-all"
          >
            📋 Copia
          </button>
          <button
            onClick={() => setPanelOpen(false)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: "thin" }}>
        {(Object.keys(homeLabels) as (keyof HomeSpacing)[]).map((key) => {
          const [min, max] = homeRanges[key];
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-white/50 font-medium">{homeLabels[key]}</label>
                <span className="text-[11px] font-bold text-uranus-cyan min-w-[36px] text-right">
                  {values[key]}{key === "btnLeft" ? "%" : "px"}
                </span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                value={values[key]}
                onChange={(e) => update(key, Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #22d3ee ${((values[key] - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((values[key] - min) / (max - min)) * 100}%)`,
                  accentColor: "#22d3ee",
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2 border-t border-white/10">
        <p className="text-[9px] text-white/25 text-center">
          Regola → premi &quot;📋 Copia&quot; → incolla in HeroButtons.tsx
        </p>
      </div>
    </div>
  );
}

export default function HeroButtons() {
  const [open, setOpen] = useState(false);
  const [sp, setSp] = useState<HomeSpacing>(DEFAULT_HOME);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const homeScale =
    viewportWidth >= 1600
      ? 1
      : viewportWidth >= 1400
      ? 0.9
      : viewportWidth >= 1200
      ? 0.82
      : viewportWidth >= 992
      ? 0.72
      : viewportWidth >= 768
      ? 0.64
      : 0.56;

  const layoutSp = {
    ...sp,
    logoSize: Math.round(sp.logoSize * homeScale),
    benvenutoMb: Math.round(sp.benvenutoMb * homeScale),
    titleSize: Math.round(sp.titleSize * homeScale),
    titleTrack: Math.max(1, Math.round(sp.titleTrack * homeScale)),
    titleMb: Math.round(sp.titleMb * homeScale),
    subTrack: Math.max(1, Math.round(sp.subTrack * homeScale)),
    subMb: Math.round(sp.subMb * homeScale),
    btnToData: Math.round(sp.btnToData * homeScale),
    dataToBox: Math.round(sp.dataToBox * homeScale),
    boxToPilastri: Math.round(sp.boxToPilastri * homeScale),
  };

  return (
    <>
      {/* 📐 Pannello spaziatura */}
      {ENABLE_HOME_SPACING_PANEL ? <HomeSpacingPanel values={sp} onChange={setSp} /> : null}

      {/* Sfondo pianeta per schermata iscrizione */}
      {open && (
        <div className="fixed inset-0 z-0 transition-opacity duration-700">
          <div
            className="signup-hero-bg absolute inset-0 bg-no-repeat"
            style={{ backgroundImage: "url('/HOMEISCRIZIONEROG-URANUS.png')" }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/35 to-black/70" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,7,17,0.22)_45%,rgba(2,7,17,0.8)_100%)]" />
        </div>
      )}

      {/* Schermata 1: testo + Esplora */}
      {!open && (
        <div className="relative z-10 flex flex-col items-center">
          <div className="animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
            <Image
              src="/logo-uranus.png"
              alt="ROG-URANUS"
              width={layoutSp.logoSize}
              height={layoutSp.logoSize}
              style={{ marginBottom: `${layoutSp.logoMb}px` }}
            />
          </div>
          <div className="text-center">
            <p
              className="animate-fadeInUp text-sm md:text-lg font-semibold uppercase text-uranus-cyan"
              style={{ letterSpacing: "0.62em", marginBottom: `${layoutSp.benvenutoMb}px`, animationDelay: '0.3s' }}
            >
              BENVENUTO IN
            </p>
            <h1
              className="animate-fadeInUp whitespace-nowrap font-bold text-white text-glow-cyan"
              style={{
                fontFamily: 'var(--font-orbitron), sans-serif',
                fontSize: `clamp(40px, 8vw, ${layoutSp.titleSize}px)`,
                letterSpacing: `${layoutSp.titleTrack}px`,
                marginBottom: `${layoutSp.titleMb}px`,
                lineHeight: 1,
                animationDelay: '0.5s',
              }}
            >
              ROG-URANUS
            </h1>
            <div
              className="animate-fadeInUp flex items-center justify-center gap-5"
              style={{ marginBottom: "24px", animationDelay: '0.7s' }}
            >
              <span className="h-px w-28 bg-gradient-to-r from-transparent to-uranus-cyan/70 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
              <p
                className="text-xl md:text-3xl font-bold uppercase text-uranus-cyan text-glow-cyan"
                style={{ letterSpacing: `${layoutSp.subTrack}px` }}
              >
                ECOSÌNOSTRA
              </p>
              <span className="h-px w-28 bg-gradient-to-l from-transparent to-uranus-cyan/70 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
            </div>
            <p
              className="animate-fadeInUp text-base md:text-xl leading-snug text-white/90"
              style={{ marginBottom: `${layoutSp.subMb}px`, animationDelay: '0.9s' }}
            >
              Una nuova <span className="font-bold text-uranus-cyan">rivoluzione del dare!</span>
              <br />
              Un ecosistema decentralizzato dove <span className="font-bold text-uranus-cyan">valore, comunità e tecnologia</span> lavorano insieme.
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="group animate-fadeInUp relative inline-flex w-[min(92vw,560px)] items-center justify-between overflow-hidden rounded-full border-2 border-uranus-cyan bg-[#021426]/55 px-9 py-5 text-white transition-all duration-300 hover:scale-[1.025]"
            style={{
              animationDelay: '1.1s',
              boxShadow:
                '0 0 22px rgba(34, 211, 238, 0.95), 0 0 54px rgba(34, 211, 238, 0.42), inset 0 0 28px rgba(34, 211, 238, 0.28)',
              textShadow: '0 0 12px rgba(255,255,255,0.8), 0 0 24px rgba(34,211,238,0.8)',
            }}
          >
            <span className="absolute inset-0 rounded-full bg-gradient-to-r from-uranus-cyan/25 via-white/10 to-uranus-cyan/25 opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
            <span className="absolute inset-x-10 top-0 h-px bg-white/80 blur-[1px]" />
            <span className="absolute inset-x-12 bottom-0 h-px bg-uranus-cyan blur-[1px]" />
            <svg
              className="relative z-10 h-9 w-9 shrink-0 text-uranus-cyan transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <circle cx="12" cy="12" r="8" />
              <ellipse cx="12" cy="12" rx="12" ry="4" transform="rotate(-30 12 12)" />
            </svg>
            <span className="relative z-10 flex-1 text-center text-lg font-black uppercase tracking-[2.5px] md:text-xl md:tracking-[3.5px]">
              ENTRA NELL&rsquo;ECOSÌNOSTRA
            </span>
            <svg className="relative z-10 h-8 w-8 shrink-0 text-uranus-cyan transition-transform duration-300 group-hover:translate-x-2" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>

          <div className="animate-fadeInUp grid w-[min(94vw,900px)] grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4 md:gap-x-0" style={{ marginTop: `${layoutSp.btnToData}px`, animationDelay: '1.25s' }}>
            {heroData.map((item, index) => (
              <div
                key={item.title}
                className={`flex items-center justify-center gap-3 px-3 text-left ${
                  index > 0 ? "md:border-l md:border-uranus-cyan/25" : ""
                }`}
              >
                <div className="shrink-0 text-uranus-cyan drop-shadow-[0_0_12px_rgba(34,211,238,0.95)]">
                  {item.icon}
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[1.4px] text-white md:text-xs">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[1px] text-white/75 md:text-[10px]">
                    {item.subtitle}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Stats box premium */}
          <div className="animate-fadeInUp stats-premium" style={{ marginTop: `${layoutSp.dataToBox}px`, animationDelay: '1.4s' }}>
            {/* 1 — DAO */}
            <div className="stat-col">
              <svg className="stat-icon h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.3} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8" />
                <ellipse cx="12" cy="12" rx="12" ry="4" transform="rotate(-30 12 12)" />
              </svg>
              <span className="stat-number">1</span>
              <span className="stat-label">DAO</span>
              <span className="stat-sublabel">DECENTRALIZZATA</span>
            </div>
            {/* 2 — 3 Pilastri */}
            <div className="stat-col">
              <svg className="stat-icon h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
              <span className="stat-number">3</span>
              <span className="stat-label">PILASTRI</span>
              <span className="stat-sublabel">ECONOMICI</span>
            </div>
            {/* 3 — 100% Trasparenza */}
            <div className="stat-col">
              <svg className="stat-icon h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <span className="stat-number">100%</span>
              <span className="stat-label">TRASPARENZA</span>
              <span className="stat-sublabel">E SICUREZZA</span>
            </div>
            {/* 4 — Polygon */}
            <div className="stat-col">
              <svg className="stat-icon h-11 w-11" fill="none" stroke="currentColor" strokeWidth={1.3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.81 15.312a4.5 4.5 0 01-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
              </svg>
              <span className="stat-number">POLYGON</span>
              <span className="stat-label">NETWORK</span>
            </div>
          </div>

          {/* ====== LE FONDAMENTA DELL'ECOSÌNOSTRA — box 3 colonne ====== */}
          <div className="animate-fadeInUp w-[min(94vw,900px)]" style={{ marginTop: `${layoutSp.boxToPilastri}px`, animationDelay: '1.55s' }}>
            <div className="flex items-center justify-center gap-4 mb-6">
              <span className="h-px flex-1 max-w-[100px] bg-gradient-to-r from-transparent to-uranus-cyan/60 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
              <h2 className="text-xs md:text-sm font-extrabold uppercase tracking-[6px] text-uranus-cyan text-glow-cyan whitespace-nowrap">
                LE FONDAMENTA DELL&rsquo;ECOSÌNOSTRA
              </h2>
              <span className="h-px flex-1 max-w-[100px] bg-gradient-to-l from-transparent to-uranus-cyan/60 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
            </div>
            <div
              className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-0 rounded-2xl px-4 py-6 md:px-2 md:py-5"
              style={{
                background: 'rgba(10, 20, 40, 0.35)',
                border: '1px solid rgba(0, 255, 255, 0.12)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {fondamentaData.map((item, index) => (
                <div
                  key={item.title}
                  className={`flex flex-col items-center text-center gap-2.5 px-4 py-2 ${
                    index > 0 ? "md:border-l md:border-uranus-cyan/20" : ""
                  }`}
                >
                  <div className="text-uranus-cyan drop-shadow-[0_0_14px_rgba(34,211,238,0.95)]">
                    {item.icon}
                  </div>
                  <p className="text-sm font-bold uppercase tracking-[2px] text-white md:text-[15px]">
                    {item.title}
                  </p>
                  <p className="text-[11px] leading-relaxed text-white/70 md:text-xs">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Spazio respiro finale */}
          <div style={{ height: '60px' }} />

        </div>
      )}

      {/* Schermata 2: piattaforma orbitale HUD */}
      {open && (
        <div className="fixed inset-0 z-10 flex items-center justify-center px-5 py-8 animate-[fadeIn_0.5s_ease-out]">
          {/* Rete neurale cosmica di sfondo */}
          <div className="hud-energy-grid" />

          {/* Navbar in alto: logo + nome */}
          <div className="absolute top-4 left-0 right-0 z-20 px-5">
            <div
              className="mx-auto w-full rounded-full px-3 py-2 sm:px-5 sm:py-3"
              style={{
                background: "rgba(2,20,38,0.55)",
                border: "1px solid rgba(34,211,238,0.24)",
                backdropFilter: "blur(10px)",
                boxShadow: "0 0 22px rgba(34,211,238,0.18)",
              }}
            >
              <div className="flex min-w-0 items-center justify-center gap-2 sm:gap-3">
                <Image
                  src="/logo-uranus.png"
                  alt="ROG-URANUS"
                  width={34}
                  height={34}
                  className="shrink-0 drop-shadow-[0_0_16px_rgba(34,211,238,0.7)]"
                />
                <span
                  className="whitespace-nowrap text-sm font-bold leading-none tracking-[2px] text-white sm:text-base sm:tracking-[4px] md:text-lg"
                  style={{ fontFamily: "var(--font-orbitron), sans-serif" }}
                >
                  ROG-URANUS
                </span>
              </div>
            </div>
          </div>

          <div className="relative flex w-[min(90vw,400px)] flex-col items-center gap-3">
            {/* Logo sospeso — pianeta orbitale */}
            <div className="relative mb-2 flex items-center justify-center">
              {/* Anello orbitale esterno */}
              <span
                className="absolute h-48 w-48 rounded-full"
                style={{
                  border: '1px solid rgba(0, 216, 255, 0.2)',
                  boxShadow: '0 0 30px rgba(0, 216, 255, 0.15), inset 0 0 20px rgba(0, 216, 255, 0.05)',
                  animation: 'planetFloat 16s ease-in-out infinite',
                }}
              />
              {/* Anello inclinato */}
              <span
                className="absolute h-40 w-40 rotate-[18deg] rounded-full"
                style={{
                  border: '1px dashed rgba(0, 216, 255, 0.15)',
                  animation: 'planetFloat 22s ease-in-out infinite reverse',
                }}
              />
              <Image
                src="/logo-uranus.png"
                alt="ROG-URANUS"
                width={160}
                height={160}
                className="relative z-10 drop-shadow-[0_0_36px_rgba(0,216,255,0.9)]"
              />
              {/* Particelle orbitali */}
              <span className="absolute -right-1 top-6 h-2.5 w-2.5 rounded-full bg-uranus-cyan shadow-[0_0_16px_rgba(0,216,255,1)]" style={{ animation: 'hudStatusBlink 2s ease-in-out infinite' }} />
              <span className="absolute bottom-8 -left-1 h-1.5 w-1.5 rounded-full bg-uranus-violet shadow-[0_0_14px_rgba(124,58,237,1)]" style={{ animation: 'hudStatusBlink 3s ease-in-out infinite 0.5s' }} />
              <span className="absolute top-2 left-8 h-1 w-1 rounded-full bg-white/60 shadow-[0_0_8px_rgba(255,255,255,0.8)]" style={{ animation: 'hudStatusBlink 2.5s ease-in-out infinite 1s' }} />
            </div>

            {/* Etichetta sistema */}
            <p className="text-[9px] font-bold uppercase tracking-[5px] text-uranus-cyan/50 mb-1" style={{ animation: 'hudStatusBlink 4s ease-in-out infinite' }}>
              ▸ SISTEMA OPERATIVO ▸
            </p>

            {/* Pannelli HUD comando */}
            <div className="flex w-full flex-col gap-4">

              {/* ISCRIZIONE */}
              <div>
                <Link href="/register" className="rog-hud-btn">
                  <span className="hud-status"><span /><span /><span /></span>
                  <svg className="hud-icon h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span className="hud-label">ISCRIZIONE</span>
                  <span className="hud-arrow">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                </Link>
                <p className="hud-micro-label">◇ REGISTRA IDENTITÀ ◇</p>
              </div>

              {/* AREA PERSONALE */}
              <div>
                <Link href="/dashboard" className="rog-hud-btn">
                  <span className="hud-status"><span /><span /><span /></span>
                  <svg className="hud-icon h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <span className="hud-label">AREA PERSONALE</span>
                  <span className="hud-arrow">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                </Link>
                <p className="hud-micro-label">◇ PANNELLO COMANDO ◇</p>
              </div>


            </div>

            {/* Piattaforma energetica inferiore */}
            <div className="relative w-full mt-4 flex flex-col items-center gap-2">
              <span
                className="block w-4/5 h-px"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(0,216,255,0.5), rgba(124,58,237,0.3), rgba(0,216,255,0.5), transparent)',
                  boxShadow: '0 0 12px rgba(0,216,255,0.4)',
                  animation: 'separatorGlow 3s ease-in-out infinite',
                }}
              />
              <span
                className="block w-3/5 h-px"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(0,216,255,0.25), transparent)',
                  boxShadow: '0 0 8px rgba(0,216,255,0.2)',
                  animation: 'separatorGlow 3s ease-in-out infinite 0.5s',
                }}
              />
              <p className="text-[8px] font-bold uppercase tracking-[4px] text-white/20 mt-1">
                ROG-URANUS · ORBITAL PLATFORM · v1.0
              </p>
            </div>

            {/* Tasto ritorno */}
            <button
              onClick={() => setOpen(false)}
              className="mt-3 text-base md:text-lg font-extrabold uppercase tracking-[5px] text-uranus-cyan/75 hover:text-uranus-cyan transition-all duration-300 hover:scale-[1.03]"
              style={{ textShadow: '0 0 14px rgba(0,216,255,0.55)' }}
            >
              ← TORNA ALLA HOME
            </button>
          </div>
        </div>
      )}
    </>
  );
}
