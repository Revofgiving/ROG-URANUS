"use client";

import { useState } from "react";

export interface SpacingValues {
  pagePx: number;
  pagePy: number;
  secGap: number;
  colGap: number;
  rightW: number;
  innerGap: number;
  cardPx: number;
  cardPy: number;
  titleMb: number;
  statGap: number;
  statPx: number;
  statPy: number;
  orbitPx: number;
  orbitPy: number;
  planetSize: number;
  progGap: number;
  actGap: number;
}

const labels: Record<keyof SpacingValues, string> = {
  pagePx:     "Pagina — padding X",
  pagePy:     "Pagina — padding Y",
  secGap:     "Gap tra sezioni",
  colGap:     "Gap colonne (sx ↔ dx)",
  rightW:     "Larghezza colonna destra",
  innerGap:   "Gap box stessa colonna",
  cardPx:     "Card — padding X",
  cardPy:     "Card — padding Y",
  titleMb:    "Titoli — margin bottom",
  statGap:    "Stats — gap tra card",
  statPx:     "Stats — padding X",
  statPy:     "Stats — padding Y",
  orbitPx:    "Orbita — padding X",
  orbitPy:    "Orbita — padding Y",
  planetSize: "Orbita — dim. pianeti",
  progGap:    "Progresso — gap",
  actGap:     "Attività — gap colonne",
};

const ranges: Record<keyof SpacingValues, [number, number]> = {
  pagePx:     [0, 60],
  pagePy:     [0, 60],
  secGap:     [4, 48],
  colGap:     [4, 48],
  rightW:     [200, 400],
  innerGap:   [4, 32],
  cardPx:     [8, 40],
  cardPy:     [8, 40],
  titleMb:    [4, 32],
  statGap:    [4, 24],
  statPx:     [8, 32],
  statPy:     [8, 32],
  orbitPx:    [8, 48],
  orbitPy:    [8, 48],
  planetSize: [40, 100],
  progGap:    [4, 32],
  actGap:     [4, 32],
};

interface Props {
  values: SpacingValues;
  onChange: (v: SpacingValues) => void;
}

export default function SpacingPanel({ values, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const update = (key: keyof SpacingValues, val: number) => {
    onChange({ ...values, [key]: val });
  };

  const copyToClipboard = () => {
    const code = `const sp = ${JSON.stringify(values, null, 2)};`;
    navigator.clipboard.writeText(code);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-bold tracking-[2px] text-white">📐 SPAZIATURA</span>
        <div className="flex gap-2">
          <button
            onClick={copyToClipboard}
            className="text-[10px] px-2.5 py-1 rounded-full bg-uranus-cyan/10 border border-uranus-cyan/30 text-uranus-cyan hover:bg-uranus-cyan/20 transition-all"
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
        {(Object.keys(labels) as (keyof SpacingValues)[]).map((key) => {
          const [min, max] = ranges[key];
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-white/50 font-medium">
                  {labels[key]}
                </label>
                <span className="text-[11px] font-bold text-uranus-cyan min-w-[36px] text-right">
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
                  background: `linear-gradient(to right, #22d3ee ${((values[key] - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((values[key] - min) / (max - min)) * 100}%)`,
                  accentColor: "#22d3ee",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-white/10">
        <p className="text-[9px] text-white/25 text-center">
          Regola i valori → premi &quot;Copia&quot; → incolla in page.tsx
        </p>
      </div>
    </div>
  );
}
