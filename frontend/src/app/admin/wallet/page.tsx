"use client";

import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";

interface Posizione {
  tavola_numero: number;
  casella: string;
  livello: number;
  tipo: string;
  dono_importo: number;
}

interface WalletData {
  account: {
    nome?: string;
    ticket_number?: number;
    tipo: string;
  };
  posizioni: Posizione[];
  uscite: unknown[];
  rientri: unknown[];
}

export default function AdminWalletPage() {
  const { log } = useLog();
  const [wallet, setWallet] = useState("");
  const [data, setData] = useState<WalletData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const cerca = async () => {
    if (!wallet.trim()) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await adminApi<WalletData>(`/api/posizione/${wallet.trim()}`);
      setData(res);
      log(`Wallet trovato: ${res.account.nome || wallet.substring(0, 12)}`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      log(`Errore ricerca: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider mb-4">
          Cerca Posizione Wallet
        </h3>
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && cerca()}
            placeholder="0x1234...abcd"
            className="admin-input flex-1"
          />
          <button
            onClick={cerca}
            disabled={loading}
            className="admin-btn admin-btn-primary disabled:opacity-40"
          >
            {loading ? "..." : "Cerca"}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            ❌ {error}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Account Info */}
            <div className="space-y-1">
              <StatRow label="Nome" value={data.account.nome || "—"} />
              <StatRow label="Ticket" value={`#${data.account.ticket_number || "—"}`} />
              <StatRow label="Tipo" value={data.account.tipo} />
              <StatRow label="Posizioni" value={String(data.posizioni.length)} />
              <StatRow label="Uscite" value={String(data.uscite.length)} />
              <StatRow label="Rientri" value={String(data.rientri.length)} />
            </div>

            {/* Posizioni Table */}
            {data.posizioni.length > 0 && (
              <div>
                <h4 className="text-sm font-bold text-uranus-violet/70 mb-3">Posizioni</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Tavola</th>
                        <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Casella</th>
                        <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Livello</th>
                        <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Tipo</th>
                        <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Dono</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.posizioni.map((p, i) => (
                        <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                          <td className="py-2 px-3 text-white">#{p.tavola_numero}</td>
                          <td className="py-2 px-3 text-white">{p.casella}</td>
                          <td className="py-2 px-3 text-white">L{p.livello}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                                p.tipo === "HUMAN"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : p.tipo === "CASSA_ROG"
                                  ? "bg-purple-500/15 text-purple-400"
                                  : "bg-white/10 text-white/60"
                              }`}
                            >
                              {p.tipo}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-white">{p.dono_importo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-white/40">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}
