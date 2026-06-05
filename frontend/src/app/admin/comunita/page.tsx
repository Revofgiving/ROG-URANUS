"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";
import PlanetBadge from "@/components/admin/PlanetBadge";
import StatusBadge from "@/components/admin/StatusBadge";

const DIM = { color: "rgba(147,197,253,0.55)" };
const LABEL = { color: "rgba(96,165,250,0.6)", letterSpacing: "0.1em" };

const short = (addr: string) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "--");

interface Member {
  entryNumber: number;
  wallet: string;
  livello: string;
  tipo: string;
  joinedAt: string;
  donations: number;
  totalDonated: number;
  positions: number;
  status: string;
}

interface CommunityData {
  members: Member[];
  total: number;
  totalPages: number;
}

function TipoBadge({ tipo }: { tipo: string }) {
  const isHuman = tipo === "HUMAN";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
      style={{
        background: isHuman ? "rgba(34,211,238,0.1)" : "rgba(167,139,250,0.1)",
        color: isHuman ? "#22d3ee" : "#a78bfa",
        border: `1px solid ${isHuman ? "rgba(34,211,238,0.25)" : "rgba(167,139,250,0.25)"}`,
      }}
    >
      {tipo ?? "--"}
    </span>
  );
}

function WalletCell({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm font-semibold" style={{ color: "#22d3ee" }}>{short(address)}</span>
      <button onClick={copy} className="text-xs transition-colors" style={{ color: copied ? "#34d399" : "rgba(96,165,250,0.35)" }}>
        {copied ? "✓" : "⎘"}
      </button>
    </div>
  );
}

export default function AdminComunitaPage() {
  const { log } = useLog();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CommunityData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      const res = await adminApi<CommunityData>(`/api/comunita?${params}`);
      setData(res);
    } catch (err: unknown) {
      log(`Errore caricamento comunità: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setLoading(false);
    }
  }, [search, status, page, log]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  return (
    <div className="space-y-5">
      {/* Filtri */}
      <div className="glass-card p-4 flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-56">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={DIM}>🔍</span>
          <input
            type="text"
            placeholder="Cerca per wallet..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl focus:outline-none"
            style={{ background: "rgba(14,27,60,0.6)", border: "1px solid rgba(30,58,138,0.4)", color: "rgba(191,219,254,0.9)" }}
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-xl focus:outline-none"
          style={{ background: "rgba(14,27,60,0.6)", border: "1px solid rgba(30,58,138,0.4)", color: "rgba(147,197,253,0.8)" }}
        >
          <option value="">Tutti gli stati</option>
          <option value="active">Attivi</option>
          <option value="inactive">Inattivi</option>
        </select>
      </div>

      {/* Tabella */}
      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(30,58,138,0.25)" }}>
          <p className="text-sm font-semibold text-white">Elenco Membri</p>
          {data && <span className="text-xs" style={DIM}>{data.total} membri registrati</span>}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm" style={DIM}>Caricamento...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "rgba(14,27,60,0.4)" }}>
                    {["#", "Wallet", "Livello", "Tipo", "Ingresso", "Donazioni", "Totale", "Posizioni", "Stato", ""].map((h) => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest" style={LABEL}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data?.members.map((m) => (
                    <tr
                      key={m.entryNumber}
                      onClick={() => router.push(`/admin/comunita/${m.entryNumber}`)}
                      className="cursor-pointer transition-colors"
                      style={{ borderTop: "1px solid rgba(30,58,138,0.15)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(14,27,60,0.4)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td className="px-6 py-4">
                        <span
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold"
                          style={{ background: "rgba(30,58,138,0.3)", color: "#60a5fa" }}
                        >
                          {m.entryNumber}
                        </span>
                      </td>
                      <td className="px-6 py-4"><WalletCell address={m.wallet} /></td>
                      <td className="px-6 py-4"><PlanetBadge livello={m.livello} /></td>
                      <td className="px-6 py-4"><TipoBadge tipo={m.tipo} /></td>
                      <td className="px-6 py-4 text-sm" style={DIM}>{new Date(m.joinedAt).toLocaleDateString("it-IT")}</td>
                      <td className="px-6 py-4 font-medium text-white">{m.donations}</td>
                      <td className="px-6 py-4 font-bold" style={{ color: "#22d3ee" }}>{m.totalDonated} USDC</td>
                      <td className="px-6 py-4 font-medium text-white">{m.positions}</td>
                      <td className="px-6 py-4"><StatusBadge status={m.status} /></td>
                      <td className="px-6 py-4 text-xl" style={DIM}>›</td>
                    </tr>
                  ))}
                  {data?.members.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-sm" style={DIM}>Nessun membro trovato</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data && data.totalPages > 1 && (
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: "1px solid rgba(30,58,138,0.2)" }}>
                <p className="text-xs" style={DIM}>Pagina {page} di {data.totalPages}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="admin-btn admin-btn-secondary text-xs disabled:opacity-40">
                    ← Precedente
                  </button>
                  <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="admin-btn admin-btn-secondary text-xs disabled:opacity-40">
                    Successiva →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
