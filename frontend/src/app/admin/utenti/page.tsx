"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";
import StatusBadge from "@/components/admin/StatusBadge";

const DIM = { color: "rgba(147,197,253,0.55)" };
const LABEL = { color: "rgba(96,165,250,0.6)", letterSpacing: "0.1em" };

interface User {
  id: number;
  name: string;
  email: string;
  registeredAt: string;
  positionsCount: number;
  totalDonated: number;
  status: string;
}

interface UsersData {
  users: User[];
  total: number;
  totalPages: number;
}

export default function AdminUtentiPage() {
  const { log } = useLog();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      const res = await adminApi<UsersData>(`/api/utenti?${params}`);
      setData(res);
    } catch (err: unknown) {
      log(`Errore caricamento utenti: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setLoading(false);
    }
  }, [search, status, page, log]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return (
    <div className="space-y-5">
      {/* Filtri */}
      <div className="glass-card p-4 flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-56">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={DIM}>🔍</span>
          <input
            type="text"
            placeholder="Cerca per nome o email..."
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
          <p className="text-sm font-semibold text-white">Elenco Utenti</p>
          {data && <span className="text-xs" style={DIM}>{data.total} risultati</span>}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm" style={DIM}>Caricamento...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "rgba(14,27,60,0.4)" }}>
                    {["Nome", "Email", "Registrazione", "Posizioni", "Totale Donato", "Stato", ""].map((h) => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest" style={LABEL}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data?.users.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => router.push(`/admin/utenti/${user.id}`)}
                      className="cursor-pointer transition-colors"
                      style={{ borderTop: "1px solid rgba(30,58,138,0.15)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(14,27,60,0.4)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td className="px-6 py-3.5 font-medium text-white">{user.name}</td>
                      <td className="px-6 py-3.5 text-sm" style={DIM}>{user.email}</td>
                      <td className="px-6 py-3.5 text-sm" style={DIM}>{new Date(user.registeredAt).toLocaleDateString("it-IT")}</td>
                      <td className="px-6 py-3.5 font-medium text-white">{user.positionsCount}</td>
                      <td className="px-6 py-3.5 font-bold" style={{ color: "#22d3ee" }}>{user.totalDonated} USDC</td>
                      <td className="px-6 py-3.5"><StatusBadge status={user.status} /></td>
                      <td className="px-6 py-3.5 text-xl" style={DIM}>›</td>
                    </tr>
                  ))}
                  {data?.users.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-sm" style={DIM}>Nessun utente trovato</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data && data.totalPages > 1 && (
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: "1px solid rgba(30,58,138,0.2)" }}>
                <p className="text-xs" style={DIM}>Pagina {page} di {data.totalPages}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="admin-btn admin-btn-secondary text-xs disabled:opacity-40"
                  >
                    ← Precedente
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                    disabled={page === data.totalPages}
                    className="admin-btn admin-btn-secondary text-xs disabled:opacity-40"
                  >
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
