"use client";

import { useEffect, useRef } from "react";

interface StarFieldProps {
  count?: number;
}

export default function StarField({ count = 120 }: StarFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear existing stars
    container.innerHTML = "";

    for (let i = 0; i < count; i++) {
      const star = document.createElement("div");
      star.className = "star";
      const size = Math.random() * 2 + 1;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.setProperty(
        "--twinkle-duration",
        `${Math.random() * 4 + 2}s`
      );
      star.style.animationDelay = `${Math.random() * 5}s`;
      star.style.opacity = `${Math.random() * 0.7 + 0.3}`;
      container.appendChild(star);
    }
  }, [count]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    />
  );
}
