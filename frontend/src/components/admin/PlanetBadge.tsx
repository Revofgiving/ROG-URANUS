"use client";

export const PLANETS: Record<string, { simbolo: string; color: string; bg: string; label: string }> = {
  SOLE:     { simbolo: "☉", color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  label: "Sole"     },
  LUNA:     { simbolo: "☾", color: "#e2e8f0", bg: "rgba(226,232,240,0.12)", label: "Luna"     },
  MERCURIO: { simbolo: "☿", color: "#fb923c", bg: "rgba(251,146,60,0.12)",  label: "Mercurio" },
  VENERE:   { simbolo: "♀", color: "#f472b6", bg: "rgba(244,114,182,0.12)", label: "Venere"   },
  GIOVE:    { simbolo: "♃", color: "#c084fc", bg: "rgba(192,132,252,0.12)", label: "Giove"    },
  SATURNO:  { simbolo: "♄", color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  label: "Saturno"  },
  NETTUNO:  { simbolo: "♆", color: "#22d3ee", bg: "rgba(34,211,238,0.12)",  label: "Nettuno"  },
  URANO:    { simbolo: "♅", color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  label: "Urano"    },
};

interface Props {
  livello: string;
  size?: "sm" | "lg";
}

export default function PlanetBadge({ livello, size = "sm" }: Props) {
  const p = PLANETS[livello?.toUpperCase()] ?? PLANETS.SOLE;
  const isLg = size === "lg";
  return (
    <span
      className="inline-flex items-center gap-1 font-semibold rounded-full"
      style={{
        background: p.bg,
        border: `1px solid ${p.color}40`,
        color: p.color,
        fontSize: isLg ? "13px" : "11px",
        padding: isLg ? "4px 10px" : "2px 7px",
      }}
    >
      <span style={{ fontSize: isLg ? "16px" : "13px" }}>{p.simbolo}</span>
      {p.label}
    </span>
  );
}
