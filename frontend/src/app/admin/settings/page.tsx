"use client";

import { useCallback, useState } from "react";
import { adminApi, getAdminConfig, saveAdminConfig } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";

export default function AdminSettingsPage() {
  const { log } = useLog();
  const [apiUrl, setApiUrl] = useState(() => getAdminConfig().apiUrl);
  const [apiKey, setApiKey] = useState(() => getAdminConfig().apiKey);
  const [bloccoMotivo, setBloccoMotivo] = useState("");
  const [bloccoStato, setBloccoStato] = useState<"ok" | "blocked" | "unknown">("unknown");
  const [bloccoMsg, setBloccoMsg] = useState("");

  const checkBlocco = useCallback(async () => {
    try {
      const data = await adminApi<{ blocco?: { bloccato: boolean; motivo?: string } }>("/api/stato");
      if (data.blocco?.bloccato) {
        setBloccoStato("blocked");
        setBloccoMsg(data.blocco.motivo || "—");
      } else {
        setBloccoStato("ok");
        setBloccoMsg("");
      }
    } catch {
      setBloccoStato("unknown");
    }
  }, []);


  // ─── Inizializza Sistema ───
  const inizializza = async () => {
    if (!confirm("Inizializzare il sistema URANUS? (una sola volta)")) return;
    try {
      await adminApi("/api/inizializza", { method: "POST", admin: true });
      log("Sistema inizializzato", "success");
    } catch (err: unknown) {
      log(`Errore: ${err instanceof Error ? err.message : err}`, "error");
    }
  };

  // ─── Kill Switch ───
  const blocca = async () => {
    if (!bloccoMotivo.trim()) return log("Inserisci un motivo", "error");
    if (!confirm("Bloccare il sistema URANUS?")) return;
    try {
      await adminApi("/api/admin/blocca", {
        method: "POST",
        admin: true,
        body: JSON.stringify({ motivo: bloccoMotivo }),
      });
      log("SISTEMA BLOCCATO: " + bloccoMotivo, "error");
      setBloccoStato("blocked");
      setBloccoMsg(bloccoMotivo);
    } catch (err: unknown) {
      log(`Errore: ${err instanceof Error ? err.message : err}`, "error");
    }
  };

  const sblocca = async () => {
    try {
      await adminApi("/api/admin/sblocca", { method: "POST", admin: true });
      log("Sistema sbloccato", "success");
      setBloccoStato("ok");
      setBloccoMsg("");
    } catch (err: unknown) {
      log(`Errore: ${err instanceof Error ? err.message : err}`, "error");
    }
  };

  // ─── Config ───
  const salvaConfig = () => {
    saveAdminConfig({ apiUrl, apiKey });
    log("Configurazione salvata", "success");
  };

  const testConnessione = async () => {
    salvaConfig();
    try {
      await adminApi("/api/stato");
      log("Connessione riuscita!", "success");
    } catch (err: unknown) {
      log(`Connessione fallita: ${err instanceof Error ? err.message : err}`, "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Inizializzazione */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider mb-4">
            Inizializzazione
          </h3>
          <p className="text-xs text-white/30 mb-4">
            Bootstrap del sistema (una sola volta)
          </p>
          <button onClick={inizializza} className="admin-btn admin-btn-primary">
            Inizializza Sistema
          </button>
        </div>

        {/* Kill Switch */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider mb-4">
            Kill Switch
          </h3>
          <button onClick={checkBlocco} className="admin-btn admin-btn-secondary mb-3">
            Aggiorna Stato
          </button>
          {bloccoStato === "blocked" && (
            <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs mb-3">
              ⚠️ Sistema BLOCCATO: {bloccoMsg}
            </div>
          )}
          {bloccoStato === "ok" && (
            <div className="p-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs mb-3">
              ✅ Sistema operativo
            </div>
          )}
          <div className="mb-3">
            <label className="block text-xs text-white/40 mb-1">Motivo blocco</label>
            <input
              type="text"
              value={bloccoMotivo}
              onChange={(e) => setBloccoMotivo(e.target.value)}
              placeholder="Motivo..."
              className="admin-input"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={blocca} className="admin-btn admin-btn-danger">
              🔴 Blocca
            </button>
            <button onClick={sblocca} className="admin-btn admin-btn-success">
              🟢 Sblocca
            </button>
          </div>
        </div>

        {/* Configurazione */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider mb-4">
            Configurazione
          </h3>
          <div className="mb-3">
            <label className="block text-xs text-white/40 mb-1">API URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="admin-input"
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs text-white/40 mb-1">Admin API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="admin-input"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={salvaConfig} className="admin-btn admin-btn-secondary">
              💾 Salva
            </button>
            <button onClick={testConnessione} className="admin-btn admin-btn-primary">
              Test Connessione
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
