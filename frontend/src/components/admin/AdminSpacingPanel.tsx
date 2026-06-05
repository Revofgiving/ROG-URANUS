"use client";

import { useState } from "react";

export interface AdminSpacing {
  sidebarW: number;
  sidebarPx: number;
  sidebarPy: number;
  sidebarNavGap: number;
  sidebarItemPx: number;
  sidebarItemPy: number;
  sidebarIconGap: number;
  contentPx: number;
  contentPy: number;
  sectionGap: number;
  cardPx: number;
  cardPy: number;
  gridGap: number;
  headerPx: number;
  headerPy: number;
  titleMb: number;
  kpiPx: number;
  kpiPy: number;
  statRowPy: number;
  logMaxH: number;
  footerPt: number;
  footerPb: number;
  footerMt: number;
  sidebarFooterPx: number;
  sidebarFooterPy: number;
  sidebarFooterGap: number;
  dashGap: number;
  kpiGridGap: number;
  detailGridGap: number;
  dashCardPad: number;
  dashStatPy: number;
  donoCardsGap: number;
  donoCardPad: number;
  donoInputGap: number;
  donoBtnGap: number;
  sidebarHeaderPx: number;
  sidebarHeaderPy: number;
  sidebarLogoSize: number;
  sidebarTitleSize: number;
  topBarLogoSize: number;
  topBarFontSize: number;
}

export const DEFAULT_ADMIN_SP: AdminSpacing = {
  sidebarW: 232,
  sidebarPx: 15,
  sidebarPy: 40,
  sidebarNavGap: 12,
  sidebarItemPx: 16,
  sidebarItemPy: 11,
  sidebarIconGap: 12,
  contentPx: 24,
  contentPy: 28,
  sectionGap: 48,
  cardPx: 23,
  cardPy: 22,
  gridGap: 15,
  headerPx: 24,
  headerPy: 24,
  titleMb: 18,
  kpiPx: 19,
  kpiPy: 25,
  statRowPy: 10,
  logMaxH: 372,
  footerPt: 16,
  footerPb: 8,
  footerMt: 21,
  sidebarFooterPx: 31,
  sidebarFooterPy: 24,
  sidebarFooterGap: 31,
  dashGap: 32,
  kpiGridGap: 20,
  detailGridGap: 20,
  dashCardPad: 24,
  dashStatPy: 12,
  donoCardsGap: 37,
  donoCardPad: 35,
  donoInputGap: 29,
  donoBtnGap: 21,
  sidebarHeaderPx: 24,
  sidebarHeaderPy: 24,
  sidebarLogoSize: 36,
  sidebarTitleSize: 18,
  topBarLogoSize: 28,
  topBarFontSize: 14,
};

const labels: Record<keyof AdminSpacing, string> = {
  sidebarW:       "Sidebar — larghezza",
  sidebarPx:      "Sidebar — padding X",
  sidebarPy:      "Sidebar — padding Y nav",
  sidebarNavGap:  "Sidebar — gap tra voci",
  sidebarItemPx:  "Sidebar — voce padding X",
  sidebarItemPy:  "Sidebar — voce padding Y",
  sidebarIconGap: "Sidebar — icona ↔ testo",
  contentPx:      "Contenuto — padding X",
  contentPy:      "Contenuto — padding Y",
  sectionGap:     "Gap tra sezioni",
  cardPx:         "Card — padding X",
  cardPy:         "Card — padding Y",
  gridGap:        "Griglia — gap",
  headerPx:       "Header — padding X",
  headerPy:       "Header — padding Y",
  titleMb:        "Titoli — margin bottom",
  kpiPx:          "KPI — padding X",
  kpiPy:          "KPI — padding Y",
  statRowPy:      "Stat righe — padding Y",
  logMaxH:        "Log — altezza max",
  footerPt:           "Footer — padding top",
  footerPb:           "Footer — padding bottom",
  footerMt:           "Footer — margine sopra",
  sidebarFooterPx:    "Sidebar footer — padding X",
  sidebarFooterPy:    "Sidebar footer — padding Y",
  sidebarFooterGap:   "Sidebar footer — gap voci",
  dashGap:            "Dashboard — gap sezioni",
  kpiGridGap:         "Dashboard — gap KPI cards",
  detailGridGap:      "Dashboard — gap dettagli",
  dashCardPad:        "Dashboard — padding cards",
  dashStatPy:         "Dashboard — righe stat PY",
  donoCardsGap:       "Dono — gap tra cards",
  donoCardPad:        "Dono — padding cards",
  donoInputGap:       "Dono — gap tra input",
  donoBtnGap:         "Dono — gap bottoni",
  sidebarHeaderPx:    "Sidebar header — padding X",
  sidebarHeaderPy:    "Sidebar header — padding Y",
  sidebarLogoSize:    "Sidebar — logo dimensione",
  sidebarTitleSize:   "Sidebar — titolo dimensione",
  topBarLogoSize:     "Top bar — logo dimensione",
  topBarFontSize:     "Top bar — testo dimensione",
};

const ranges: Record<keyof AdminSpacing, [number, number]> = {
  sidebarW:       [180, 320],
  sidebarPx:      [4, 32],
  sidebarPy:      [8, 40],
  sidebarNavGap:  [2, 24],
  sidebarItemPx:  [8, 32],
  sidebarItemPy:  [6, 24],
  sidebarIconGap: [4, 24],
  contentPx:      [8, 48],
  contentPy:      [8, 48],
  sectionGap:     [8, 48],
  cardPx:         [8, 40],
  cardPy:         [8, 40],
  gridGap:        [4, 32],
  headerPx:       [8, 40],
  headerPy:       [4, 24],
  titleMb:        [4, 32],
  kpiPx:          [8, 32],
  kpiPy:          [8, 32],
  statRowPy:      [2, 16],
  logMaxH:        [100, 400],
  footerPt:           [4, 32],
  footerPb:           [2, 24],
  footerMt:           [4, 48],
  sidebarFooterPx:    [8, 32],
  sidebarFooterPy:    [8, 32],
  sidebarFooterGap:   [4, 32],
  dashGap:            [8, 48],
  kpiGridGap:         [4, 32],
  detailGridGap:      [4, 32],
  dashCardPad:        [8, 40],
  dashStatPy:         [4, 20],
  donoCardsGap:       [8, 60],
  donoCardPad:        [12, 48],
  donoInputGap:       [8, 32],
  donoBtnGap:         [4, 24],
  sidebarHeaderPx:    [8, 40],
  sidebarHeaderPy:    [8, 40],
  sidebarLogoSize:    [20, 60],
  sidebarTitleSize:   [12, 28],
  topBarLogoSize:     [16, 48],
  topBarFontSize:     [10, 20],
};

interface Props {
  values: AdminSpacing;
  onChange: (v: AdminSpacing) => void;
}

export default function AdminSpacingPanel({ values, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const update = (key: keyof AdminSpacing, val: number) => {
    onChange({ ...values, [key]: val });
  };

  const copyToClipboard = () => {
    const code = `const DEFAULT_ADMIN_SP: AdminSpacing = ${JSON.stringify(values, null, 2)};`;
    navigator.clipboard.writeText(code);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[100] w-12 h-12 rounded-full flex items-center justify-center text-white text-lg"
        style={{
          background: "linear-gradient(135deg, #7c3aed, #a855f7)",
          boxShadow: "0 0 20px rgba(124, 58, 237, 0.4)",
        }}
        title="Apri pannello spaziatura admin"
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
        border: "1px solid rgba(124, 58, 237, 0.3)",
        boxShadow: "0 0 40px rgba(0,0,0,0.5), 0 0 20px rgba(124, 58, 237, 0.15)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-bold tracking-[2px] text-white">📐 SPAZIATURA ADMIN</span>
        <div className="flex gap-2">
          <button
            onClick={copyToClipboard}
            className="text-[10px] px-2.5 py-1 rounded-full bg-uranus-violet/10 border border-uranus-violet/30 text-uranus-violet hover:bg-uranus-violet/20 transition-all"
            title="Copia valori come codice"
          >
            📋 Copia
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Sliders */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: "thin" }}>
        {(Object.keys(labels) as (keyof AdminSpacing)[]).map((key) => {
          const [min, max] = ranges[key];
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-white/50 font-medium">
                  {labels[key]}
                </label>
                <span className="text-[11px] font-bold text-uranus-violet min-w-[36px] text-right">
                  {values[key]}px
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
                  background: `linear-gradient(to right, #7c3aed ${((values[key] - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((values[key] - min) / (max - min)) * 100}%)`,
                  accentColor: "#7c3aed",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/10">
        <p className="text-[9px] text-white/25 text-center">
          Regola i valori → premi &quot;Copia&quot; → incolla in layout.tsx
        </p>
      </div>
    </div>
  );
}
