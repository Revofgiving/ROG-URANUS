"use client";

interface ProgressProps {
  px?: number;
  py?: number;
  titleMb?: number;
}

export default function ProgressSection({ px = 20, py = 20, titleMb = 12 }: ProgressProps) {
  return (
    <div>
      {/* Prossimo Traguardo */}
      <div className="glass-card" style={{ padding: `${py}px ${px}px` }}>
        <h3
          className="text-xs font-bold tracking-[2px] text-white uppercase"
          style={{ marginBottom: `${titleMb}px` }}
        >
          Prossimo Traguardo
        </h3>
        <p className="text-sm text-white/50 mb-3">
          Hai <span className="text-white font-semibold">4 satelliti</span> su{" "}
          <span className="text-white font-semibold">6</span> per raggiungere{" "}
          <span className="text-uranus-cyan font-bold">PLUTONE</span>
        </p>
        <div className="relative h-3 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full progress-gradient"
            style={{ width: "67%" }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-lg font-bold text-uranus-cyan">67%</span>
          <span className="text-[10px] text-white/30">Mancano 2 satelliti</span>
        </div>
      </div>
    </div>
  );
}
