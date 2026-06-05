"use client";

import Link from "next/link";

interface MissionProps {
  px?: number;
  py?: number;
  titleMb?: number;
}

export default function MissionPanel({ px = 20, py = 20, titleMb = 12 }: MissionProps) {
  return (
    <div
      className="rounded-2xl relative overflow-hidden border border-uranus-cyan/10"
      style={{
        padding: `${py}px ${px}px`,
        background:
          "linear-gradient(135deg, rgba(15, 31, 61, 0.9), rgba(8, 16, 40, 0.95))",
      }}
    >
      {/* Background glow */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse at 30% 50%, rgba(124, 58, 237, 0.3), transparent 70%), radial-gradient(ellipse at 70% 80%, rgba(34, 211, 238, 0.2), transparent 60%)",
        }}
      />

      <div className="relative z-10">
        <h3
          className="text-sm font-bold tracking-[2px] text-white uppercase"
          style={{ marginBottom: `${titleMb}px` }}
        >
          Missione Uranus
        </h3>
        <p className="text-xs text-white/50 leading-relaxed mb-1">
          Ogni dono è energia.
        </p>
        <p className="text-xs text-white/50 leading-relaxed mb-1">
          Ogni ciclo è vita.
        </p>
        <p className="text-xs text-white/40 leading-relaxed mb-4">
          Insieme creiamo un sistema che gira per sempre.
        </p>

        <Link
          href="/dashboard/invia-dono"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm tracking-[2px] uppercase text-white transition-all"
          style={{
            background: "linear-gradient(135deg, #dc2626, #ef4444, #f97316)",
            boxShadow:
              "0 0 25px rgba(239, 68, 68, 0.3), 0 4px 15px rgba(0,0,0,0.3)",
          }}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
            />
          </svg>
          Invia un Dono
        </Link>
      </div>
    </div>
  );
}
