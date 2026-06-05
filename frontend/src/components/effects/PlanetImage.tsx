"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";

export default function PlanetImage() {
  const [imgError, setImgError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const x = (e.clientX / window.innerWidth - 0.5) * 20;
      const y = (e.clientY / window.innerHeight - 0.5) * 20;
      containerRef.current.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div
      ref={containerRef}
      className="planet-container absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] md:w-[650px] md:h-[650px] lg:w-[750px] lg:h-[750px] pointer-events-none"
      style={{ transition: 'transform 0.3s ease-out' }}
    >
      {!imgError && (
        <Image
          src="/planet-uranus.png"
          alt="Pianeta Uranus"
          fill
          className="object-contain opacity-80"
          priority
          onError={() => setImgError(true)}
        />
      )}

      {/* Planet body — outer glow */}
      <div className="absolute inset-[8%] rounded-full bg-[#0c3a5a] opacity-30 blur-xl" />

      {/* Planet body — atmosphere */}
      <div className="absolute inset-[10%] rounded-full overflow-hidden">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#0a5e7a] via-[#1db4b8] to-[#084058]" />
        {/* Surface bands */}
        <div className="absolute inset-0 rounded-full opacity-40"
          style={{
            background: `repeating-linear-gradient(
              175deg,
              transparent 0px,
              transparent 18px,
              rgba(255,255,255,0.06) 18px,
              rgba(255,255,255,0.06) 20px,
              transparent 20px,
              transparent 40px,
              rgba(6,214,160,0.08) 40px,
              rgba(6,214,160,0.08) 42px
            )`
          }}
        />
        {/* Highlight */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-tl from-transparent via-transparent to-white/15" />
        {/* Shadow */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-transparent via-transparent to-black/40" />
      </div>

      {/* Ring 1 — main */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[135%] h-[35%] rounded-[50%] -rotate-[25deg]"
        style={{
          border: '2px solid rgba(34, 211, 238, 0.35)',
          boxShadow: '0 0 12px rgba(34, 211, 238, 0.15), inset 0 0 12px rgba(34, 211, 238, 0.08)',
        }}
      />
      {/* Ring 2 — inner */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[125%] h-[30%] rounded-[50%] -rotate-[25deg]"
        style={{
          border: '1.5px solid rgba(34, 211, 238, 0.2)',
          boxShadow: '0 0 8px rgba(34, 211, 238, 0.1)',
        }}
      />
      {/* Ring 3 — outer faint */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[145%] h-[40%] rounded-[50%] -rotate-[25deg]"
        style={{
          border: '1px solid rgba(34, 211, 238, 0.12)',
        }}
      />
    </div>
  );
}
