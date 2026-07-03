"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// Chiamata diretta al backend (stesso pattern di register/page.tsx)
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

type StoredUser = { wallet?: string };

type RichiestaStato = {
  status?: string;
  nome?: string | null;
  created_at?: string;
} | null;

type EthereumProvider = {
  request: (args: { method: string }) => Promise<string[]>;
};

function getStoredWallet(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("uranus_user");
    if (!raw) return "";
    const data = JSON.parse(raw) as StoredUser;
    return data.wallet ?? "";
  } catch {
    return "";
  }
}

function statoLabel(s?: string): string {
  switch (s) {
    case "IN_REVISIONE": return "In revisione dallo staff";
    case "IN_ATTESA": return "In coda FIFO (approvata dallo staff)";
    case "ASSEGNATA": return "Posizione assegnata!";
    case "RIFIUTATA": return "Richiesta non accolta";
    default: return s || "—";
  }
}

export default function PosizioneAlVoloPage() {
  const [wallet, setWallet] = useState<string>(() => getStoredWallet());
  const [nome, setNome] = useState("");
  const [coda, setCoda] = useState<number | null>(null);
  const [stato, setStato] = useState<RichiestaStato>(null);
  const [loading, setLoading] = useState(false);
  const [messaggio, setMessaggio] = useState("");
  const [errore, setErrore] = useState("");

  const caricaStato = useCallback(async (w: string) => {
    try {
      const codaRes = await fetch(`${API_URL}/api/posizione-al-volo/coda`);
      const codaData = (await codaRes.json()) as { richieste_in_attesa?: number };
      if (typeof codaData.richieste_in_attesa === "number") setCoda(codaData.richieste_in_attesa);
    } catch {
      /* backend non raggiungibile — la pagina resta usabile */
    }

    if (w && WALLET_RE.test(w)) {
      try {
        const res = await fetch(`${API_URL}/api/posizione-al-volo/stato/${w.toLowerCase()}`);
        const data = (await res.json()) as { stato?: RichiestaStato };
        setStato(data.stato ?? null);
      } catch {
        /* ignora */
      }
    }
  }, []);

  // Caricamento iniziale: fetch dei dati con setState DOPO await (pattern React
  // consigliato per data-fetching in effect), con guardia di smontaggio.
  useEffect(() => {
    let attivo = true;
    (async () => {
      try {
        const codaRes = await fetch(`${API_URL}/api/posizione-al-volo/coda`);
        const codaData = (await codaRes.json()) as { richieste_in_attesa?: number };
        if (attivo && typeof codaData.richieste_in_attesa === "number") setCoda(codaData.richieste_in_attesa);
      } catch {
        /* backend non raggiungibile */
      }
      const w = getStoredWallet();
      if (w && WALLET_RE.test(w)) {
        try {
          const res = await fetch(`${API_URL}/api/posizione-al-volo/stato/${w.toLowerCase()}`);
          const data = (await res.json()) as { stato?: RichiestaStato };
          if (attivo) setStato(data.stato ?? null);
        } catch {
          /* ignora */
        }
      }
    })();
    return () => { attivo = false; };
  }, []);

  const connectMetaMask = async () => {
    setErrore("");
    const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
    if (!eth) {
      setErrore("MetaMask non rilevato. Inserisci il wallet manualmente.");
      return;
    }
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (accounts && accounts[0]) {
        setWallet(accounts[0]);
        void caricaStato(accounts[0]);
      }
    } catch {
      setErrore("Connessione a MetaMask annullata.");
    }
  };

  const invia = async () => {
    setErrore("");
    setMessaggio("");
    const w = wallet.trim().toLowerCase();
    if (!WALLET_RE.test(w)) {
      setErrore("Inserisci un wallet valido (0x… 40 caratteri esadecimali).");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/posizione-al-volo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: w, nome: nome.trim() || undefined }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        messaggio?: string;
        error?: string;
        posizione_in_coda?: number;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Errore durante l'invio della richiesta");
      }
      setMessaggio(data.messaggio || "Richiesta inviata allo staff.");
      if (typeof data.posizione_in_coda === "number") setCoda(data.posizione_in_coda);
      void caricaStato(w);
    } catch (e) {
      setErrore((e as Error).message || "Errore durante l'invio.");
    } finally {
      setLoading(false);
    }
  };

  const gia = stato && (stato.status === "IN_REVISIONE" || stato.status === "IN_ATTESA");

  return (
    <section className="relative min-h-screen overflow-hidden bg-[#020711] p-1 sm:p-2">
      <div
        className="relative min-h-[calc(100vh-0.5rem)] sm:min-h-[calc(100vh-1rem)] overflow-hidden rounded-[34px] border border-amber-400/40 bg-[#04101f]"
        style={{ boxShadow: "inset 0 0 60px rgba(251,191,36,0.10), 0 0 30px rgba(251,191,36,0.15)" }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/30" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-0.5rem)] w-full max-w-xl flex-col items-center justify-center px-6 py-12">
          {/* Icona stella */}
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/10"
            style={{ boxShadow: "0 0 26px rgba(251,191,36,0.35)" }}>
            <svg className="h-8 w-8 text-amber-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.5a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </div>

          <h1 className="text-center text-2xl font-bold uppercase tracking-[4px] text-amber-400 sm:text-3xl"
            style={{ textShadow: "0 0 22px rgba(251,191,36,0.5)" }}>
            Posizione al volo
          </h1>
          <p className="mt-2 text-center text-xs font-bold uppercase tracking-[3px] text-amber-300/80">
            ◇ Richiedi ingresso gratuito ◇
          </p>

          <p className="mt-5 max-w-md text-center text-sm leading-relaxed text-white/60">
            Entra nella <span className="font-bold text-amber-300">lista d&apos;attesa FIFO</span> per ricevere una
            posizione gratuita a Sole (L0). Le posizioni al volo vengono create automaticamente dai doni degli
            altri utenti alle uscite Giove (L4) e Saturno (L5). La richiesta viene revisionata dallo staff.
          </p>

          {/* Contatore coda */}
          <div className="mt-6 flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/5 px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-amber-400" style={{ boxShadow: "0 0 10px rgba(251,191,36,0.9)" }} />
            <span className="text-[11px] font-bold uppercase tracking-[2px] text-white/70">
              In coda ora: <span className="text-amber-300">{coda ?? "—"}</span>
            </span>
          </div>

          {/* Stato richiesta esistente */}
          {stato?.status && (
            <div className="mt-5 w-full rounded-2xl border border-amber-400/25 bg-white/[0.04] p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-white/45">Stato della tua richiesta</p>
              <p className="mt-1 text-sm font-bold text-amber-300">{statoLabel(stato.status)}</p>
            </div>
          )}

          {/* Form */}
          {!gia && (
            <div className="mt-6 w-full space-y-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[2px] text-white/45">Wallet</label>
                <div className="flex gap-2">
                  <input
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    placeholder="0x…"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-xl border border-white/15 bg-[#020a16] px-4 py-3 text-sm text-white outline-none focus:border-amber-400/60"
                  />
                  <button
                    onClick={connectMetaMask}
                    type="button"
                    className="shrink-0 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 text-[11px] font-bold uppercase tracking-[2px] text-amber-300 transition-colors hover:bg-amber-400/20"
                  >
                    MetaMask
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[2px] text-white/45">Nome (opzionale)</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Come vuoi essere chiamato"
                  className="w-full rounded-xl border border-white/15 bg-[#020a16] px-4 py-3 text-sm text-white outline-none focus:border-amber-400/60"
                />
              </div>

              <button
                onClick={invia}
                disabled={loading}
                className="w-full rounded-2xl py-4 text-sm font-bold uppercase tracking-[3px] text-[#1a1204] transition-all duration-300 hover:scale-[1.02] disabled:opacity-60"
                style={{
                  background: "linear-gradient(135deg, #fcd34d, #fbbf24, #f59e0b)",
                  boxShadow: "0 0 30px rgba(251,191,36,0.35), 0 8px 30px rgba(0,0,0,0.3)",
                }}
              >
                {loading ? "Invio in corso…" : "Richiedi ingresso gratuito"}
              </button>
            </div>
          )}

          {messaggio && (
            <div className="mt-5 w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3">
              <p className="text-center text-xs text-emerald-200">{messaggio}</p>
            </div>
          )}
          {errore && (
            <div className="mt-5 w-full rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
              <p className="text-center text-xs text-red-300">{errore}</p>
            </div>
          )}

          <Link
            href="/"
            className="mt-8 flex items-center gap-2 rounded-full px-5 py-2.5 text-[10px] font-bold uppercase tracking-[2px] text-white/60 transition-all hover:text-white sm:text-sm"
            style={{ background: "rgba(10, 22, 40, 0.4)", border: "1px solid rgba(251,191,36,0.2)" }}
          >
            <span className="text-lg">←</span> Torna alla home
          </Link>
        </div>
      </div>
    </section>
  );
}
