"use client";

import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";

interface Flusso {
  tipo: string;
  importo: number;
  num_posizioni: number;
  tipo_uscita: string;
  turno_origine: number;
  created_at: string;
}

interface FlussiData {
  totali: {
    rog_small: number;
    rog: number;
    rientriSole: number;
  };
  flussi: Flusso[];
}

export default function AdminFlussiPage() {
  const { log } = useLog();
  const [data, setData] = useState<FlussiData | null>(null);
  const [loading, setLoading] = useState(false);

  const carica = async () => {
    setLoading(true);
    try {
      const res = await adminApi<FlussiData>("/api/flussi-esterni");
      setData(res);
      log("Flussi esterni caricati", "success");
    } catch (err: unknown) {
      log(`Errore: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const tagClass = (tipo: string) => {
    if (tipo === "ROG_SMALL" || tipo === "ROG") return "bg-green-500/15 text-green-400";
    if (tipo === "PHARAON") return "bg-yellow-500/15 text-yellow-400";
    return "bg-white/10 text-white/60";
  };

  return (
    <div className="space-y-6">
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider">
            Registrazioni Contabili Cross-Sistema
          </h3>
          <button
            onClick={carica}
            disabled={loading}
            className="admin-btn admin-btn-secondary text-xs disabled:opacity-40"
          >
            {loading ? "..." : "🔄 Aggiorna"}
          </button>
        </div>

        {!data && !loading && (
          <p className="text-white/30 text-sm">
            Premi &quot;Aggiorna&quot; per caricare i flussi esterni.
          </p>
        )}

        {data && (
          <>
            {/* Totals */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="p-3 rounded-xl bg-white/3 border border-white/5 text-center">
                <div className="text-xs text-white/30 mb-1">ROG SMALL</div>
                <div className="text-lg font-bold text-white">
                  {data.totali.rog_small} <span className="text-xs text-white/30">USDC</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/3 border border-white/5 text-center">
                <div className="text-xs text-white/30 mb-1">ROG</div>
                <div className="text-lg font-bold text-white">
                  {data.totali.rog} <span className="text-xs text-white/30">USDC</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/3 border border-white/5 text-center">
                <div className="text-xs text-white/30 mb-1">RIENTRI SOLE</div>
                <div className="text-lg font-bold text-white">
                  {data.totali.rientriSole} <span className="text-xs text-white/30">USDC</span>
                </div>
              </div>
            </div>

            {/* Table */}
            {data.flussi.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Tipo</th>
                      <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Importo</th>
                      <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Posizioni</th>
                      <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Uscita</th>
                      <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Turno</th>
                      <th className="text-left text-xs text-white/30 uppercase py-2 px-3">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.flussi.map((f, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/3">
                        <td className="py-2 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${tagClass(f.tipo)}`}>
                            {f.tipo}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-white">{f.importo} USDC</td>
                        <td className="py-2 px-3 text-white">{f.num_posizioni}</td>
                        <td className="py-2 px-3 text-white">{f.tipo_uscita}</td>
                        <td className="py-2 px-3 text-white">{f.turno_origine}</td>
                        <td className="py-2 px-3 text-white/40">
                          {new Date(f.created_at).toLocaleString("it-IT")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-white/30 text-sm">Nessun flusso registrato</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
