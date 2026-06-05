"use client";

import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { useLog } from "@/components/admin/LogPanel";
type EthereumRequestParams = {
  method: string;
  params?: unknown[];
};

type EthereumProvider = {
  request: (args: EthereumRequestParams) => Promise<unknown>;
  on: (eventName: "accountsChanged", listener: (accounts: string[]) => void) => void;
};

const POLYGON_CHAIN_ID = "0x89";
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

export default function AdminDonoPage() {
  const { log } = useLog();
  const [mmWallet, setMmWallet] = useState<string | null>(null);
  const [mmStatus, setMmStatus] = useState("Non connesso");
  const [mmNetwork, setMmNetwork] = useState("");
  const [nome, setNome] = useState("");
  const [numCoppie, setNumCoppie] = useState(1);
  const [devWallet, setDevWallet] = useState("");
  const [showDev, setShowDev] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const importo = numCoppie * 20;

  // ─── MetaMask connect ───
  const connettiMetaMask = async () => {
    const eth = (window as { ethereum?: EthereumProvider }).ethereum;
    if (!eth) {
      log("MetaMask non trovato", "error");
      return alert("Installa MetaMask o un wallet compatibile con Polygon.");
    }
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const wallet = (accounts[0] as string).toLowerCase();
      setMmWallet(wallet);
      setMmStatus("✅ Connesso");
      log("MetaMask connesso: " + wallet, "success");

      // Check Polygon
      const chainId = (await eth.request({ method: "eth_chainId" })) as string;
      if (chainId !== POLYGON_CHAIN_ID) {
        setMmNetwork("⚠️ Rete non Polygon");
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: POLYGON_CHAIN_ID }],
          });
          setMmNetwork("Rete: Polygon ✅");
        } catch {
          setMmNetwork("Cambia rete a Polygon manualmente");
        }
      } else {
        setMmNetwork("Rete: Polygon ✅");
      }

      // Listener
      eth.on("accountsChanged", (accs: string[]) => {
        const w = accs[0]?.toLowerCase() || null;
        setMmWallet(w);
        if (!w) setMmStatus("Disconnesso");
      });
    } catch (err: unknown) {
      log(`MetaMask: ${err instanceof Error ? err.message : err}`, "error");
    }
  };

  // ─── Dono reale con MetaMask ───
  const donaConMetaMask = async () => {
    if (!mmWallet) return;
    const destinatario = prompt("Indirizzo wallet destinatario USDC (fondo URANUS):");
    if (!destinatario) return;

    setBusy(true);
    try {
      log(`Invio ${importo} USDC via MetaMask...`);
      const importoWei = "0x" + (BigInt(importo) * BigInt(1e6)).toString(16);
      const iface = "0xa9059cbb";
      const toAddr = destinatario.toLowerCase().replace("0x", "").padStart(64, "0");
      const amount = importoWei.replace("0x", "").padStart(64, "0");
      const data = iface + toAddr + amount;

      const eth = (window as { ethereum?: EthereumProvider }).ethereum;
      if (!eth) throw new Error("MetaMask non disponibile");
      const txHash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: mmWallet, to: USDC_POLYGON, data }],
      })) as string;

      log("TX inviata: " + txHash, "success");

      const res = await adminApi<{ numeroCoppie: number; ticket: number }>("/api/dona", {
        method: "POST",
        body: JSON.stringify({ wallet: mmWallet, txHash, nome, numeroPosizioni: numCoppie }),
      });

      log(`Dono registrato: ${res.numeroCoppie} coppie, ticket #${res.ticket}`, "success");
      setResult({
        type: "success",
        msg: `✅ ${res.numeroCoppie} coppie create — Ticket #${res.ticket}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(msg, "error");
      setResult({ type: "error", msg: `❌ ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  // ─── Dono DEV_SKIP ───
  const eseguiDonoDev = async () => {
    if (!devWallet.trim()) return log("Inserisci un wallet per DEV mode", "error");
    setBusy(true);
    try {
      const res = await adminApi<{ numeroCoppie: number; ticket: number }>("/api/dona", {
        method: "POST",
        body: JSON.stringify({
          wallet: devWallet.trim(),
          txHash: "DEV_SKIP",
          nome,
          numeroPosizioni: numCoppie,
        }),
      });
      log(`DEV Dono OK: ${res.numeroCoppie} coppie, ticket #${res.ticket}`, "success");
      setResult({
        type: "success",
        msg: `✅ DEV: ${res.numeroCoppie} coppie (HUMAN + CASSA_ROG) — Ticket #${res.ticket}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(msg, "error");
      setResult({ type: "error", msg: `❌ ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--dono-cards-gap, 40px)" }}>
      {/* MetaMask Connection */}
      <div className="glass-card" style={{ padding: "var(--dono-card-pad, 32px)" }}>
        <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider mb-5">
          🦊 Connessione MetaMask
        </h3>
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={connettiMetaMask}
            className="admin-btn admin-btn-primary"
          >
            🦊 Connetti MetaMask
          </button>
          <span className="text-sm text-white/40">{mmStatus}</span>
        </div>
        {mmWallet && (
          <p className="text-xs text-white/30 mb-1">Wallet: {mmWallet}</p>
        )}
        {mmNetwork && (
          <p className="text-xs text-white/30">{mmNetwork}</p>
        )}
      </div>

      {/* Dono Form */}
      <div className="glass-card" style={{ padding: "var(--dono-card-pad, 32px)" }}>
        <h3 className="text-sm font-bold text-uranus-violet uppercase tracking-wider mb-3">
          Nuovo Dono (20 USDC → 1 HUMAN + 1 CASSA_ROG)
        </h3>
        <p className="text-xs text-green-400/60 mb-6 p-3 rounded-lg bg-green-500/5 border border-green-500/10">
          Ogni persona può entrare infinite volte nel sistema URANUS
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 mb-6" style={{ gap: "var(--dono-input-gap, 20px)" }}>
          <div>
            <label className="block text-xs text-white/40 mb-1">Nome (opzionale)</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome utente"
              className="admin-input"
            />
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">
              Numero coppie (1 coppia = 20 USDC)
            </label>
            <input
              type="number"
              value={numCoppie}
              onChange={(e) => setNumCoppie(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              className="admin-input"
            />
          </div>
        </div>

        <p className="text-uranus-violet font-semibold text-lg mb-5">Totale: {importo} USDC</p>

        <div className="flex flex-wrap" style={{ gap: "var(--dono-btn-gap, 12px)" }}>
          <button
            onClick={donaConMetaMask}
            disabled={!mmWallet || busy}
            className="admin-btn admin-btn-primary disabled:opacity-40"
          >
            💳 Dona con MetaMask (Polygon USDC)
          </button>
          <button
            onClick={() => setShowDev(!showDev)}
            className="admin-btn admin-btn-secondary"
          >
            🛠️ DEV Mode
          </button>
        </div>

        {/* DEV Mode */}
        {showDev && (
          <div className="mt-5 p-5 rounded-xl bg-white/3 border border-white/5">
            <label className="block text-xs text-white/40 mb-1">Wallet (0x...)</label>
            <input
              type="text"
              value={devWallet}
              onChange={(e) => setDevWallet(e.target.value)}
              placeholder="0x1234...abcd"
              className="admin-input mb-3"
            />
            <button
              onClick={eseguiDonoDev}
              disabled={busy}
              className="admin-btn admin-btn-secondary disabled:opacity-40"
            >
              Esegui Dono DEV_SKIP
            </button>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className={`mt-4 p-3 rounded-xl text-sm ${
              result.type === "success"
                ? "bg-green-500/10 border border-green-500/30 text-green-400"
                : "bg-red-500/10 border border-red-500/30 text-red-400"
            }`}
          >
            {result.msg}
          </div>
        )}
      </div>
    </div>
  );
}
