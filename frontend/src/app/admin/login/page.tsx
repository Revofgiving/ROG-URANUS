"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import StarField from "@/components/effects/StarField";
import { getAdminSession } from "@/lib/admin-api";
import { useEffect } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getAdminSession()) {
      router.push("/admin");
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem("uranus_admin", JSON.stringify(data.session));
        router.push("/admin");
      } else {
        setError(data.error || "Credenziali non valide");
      }
    } catch {
      setError("Errore di connessione al server");
    }
    setLoading(false);
  };

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0618] via-[#0d0a2e] to-[#050a18]" />
      <StarField count={30} />

      <div className="relative z-10 w-full max-w-md">
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{
            boxShadow:
              "0 0 80px rgba(124, 58, 237, 0.15), 0 0 160px rgba(124, 58, 237, 0.08), 0 20px 60px rgba(0,0,0,0.5)",
            border: "1.5px solid rgba(124, 58, 237, 0.3)",
          }}
        >
          <div className="absolute inset-0 bg-white/5 backdrop-blur-xl" />

          <div className="relative px-10 py-12 flex flex-col items-center">
            {/* Logo */}
            <Image
              src="/logo-uranus.png"
              alt="ROG-URANUS Admin"
              width={80}
              height={80}
              className="mb-6"
            />
            <h1 className="text-xl font-bold tracking-[3px] text-white mb-1">
              PANNELLO{" "}
              <span
                className="text-uranus-violet"
                style={{
                  fontFamily: "var(--font-unciale), fantasy, serif",
                }}
              >
                ADMIN
              </span>
            </h1>
            <p className="text-white/30 text-xs tracking-[2px] mb-8">
              Accesso riservato
            </p>

            {/* Linea viola */}
            <div className="relative w-full h-[2px] mb-8">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#7c3aed] to-transparent" />
              <div className="absolute inset-[-4px] bg-gradient-to-r from-transparent via-[#7c3aed]/40 to-transparent blur-md" />
            </div>

            {/* Error */}
            {error && (
              <div className="w-full mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="w-full space-y-4">
              <div>
                <label className="block text-xs text-white/40 mb-1.5 tracking-wider">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-uranus-violet/50 transition-colors"
                  placeholder="superadmin"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5 tracking-wider">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-uranus-violet/50 transition-colors"
                  placeholder="••••••••"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 mt-2 rounded-xl font-bold text-sm tracking-wider text-white disabled:opacity-50 transition-all"
                style={{
                  background:
                    "linear-gradient(135deg, #5b21b6, #7c3aed, #a855f7)",
                  border: "1.5px solid rgba(124, 58, 237, 0.5)",
                  boxShadow:
                    "0 0 25px rgba(124, 58, 237, 0.3), 0 8px 25px rgba(0,0,0,0.3)",
                }}
              >
                {loading ? "Accesso..." : "🔐 Accedi"}
              </button>
            </form>

            {/* Back link */}
            <Link
              href="/"
              className="mt-6 text-xs text-white/20 hover:text-white/40 transition-colors"
            >
              ← Torna al sito
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
