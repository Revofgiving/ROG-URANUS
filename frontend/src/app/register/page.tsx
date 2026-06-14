"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import StarField from "@/components/effects/StarField";
import { sendUsdc } from "@/lib/usdc";
import { saveSession } from "@/lib/auth";
import { dona } from "@/lib/api";
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type WindowWithEthereum = Window & typeof globalThis & {
  ethereum?: EthereumProvider;
};

type EthereumError = {
  code?: number;
};
function shortTxHash(hash: string) {
  if (!hash) return "In attesa";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

// ============================================================
// SPAZIATURA ISCRIZIONE — regola da pannello 📐 poi incolla qui
// ============================================================
const DEFAULT_REG = {
  logoSize:     169,
  logoMb:       31,
  rivolMb:      10,
  titleSize:    67,
  titleTrack:   7,
  titleMb:      19,
  descMb:       25,
  labelMb:      27,
  btnMaxW:      438,
  btnGap:       18,
  btnH:         60,
};
const ENABLE_REG_SPACING_PANEL = false;
const ENABLE_DONATION_SPACING_PANEL = false;
// ============================================================

interface RegSpacing {
  logoSize: number;
  logoMb: number;
  rivolMb: number;
  titleSize: number;
  titleTrack: number;
  titleMb: number;
  descMb: number;
  labelMb: number;
  btnMaxW: number;
  btnGap: number;
  btnH: number;
}

const regLabels: Record<keyof RegSpacing, string> = {
  logoSize:   "Logo — dimensione",
  logoMb:     "Logo — spazio sotto",
  rivolMb:    "\"Rivoluzione di\" — spazio sotto",
  titleSize:  "ROG-URANUS — font size",
  titleTrack: "ROG-URANUS — letter spacing",
  titleMb:    "ROG-URANUS — spazio sotto",
  descMb:     "Descrizione — spazio sotto",
  labelMb:    "Label piccola — spazio sotto",
  btnMaxW:    "Bottoni — larghezza max",
  btnGap:     "Bottoni — gap tra loro",
  btnH:       "Bottoni — altezza",
};

const regRanges: Record<keyof RegSpacing, [number, number]> = {
  logoSize:   [40, 200],
  logoMb:     [0, 60],
  rivolMb:    [0, 30],
  titleSize:  [30, 100],
  titleTrack: [0, 20],
  titleMb:    [0, 40],
  descMb:     [0, 60],
  labelMb:    [0, 40],
  btnMaxW:    [200, 500],
  btnGap:     [4, 30],
  btnH:       [36, 70],
};

function RegSpacingPanel({ values, onChange }: { values: RegSpacing; onChange: (v: RegSpacing) => void }) {
  const [panelOpen, setPanelOpen] = useState(false);

  const update = (key: keyof RegSpacing, val: number) => onChange({ ...values, [key]: val });

  const copyToClipboard = () => {
    const code = `const DEFAULT_REG = ${JSON.stringify(values, null, 2)};`;
    navigator.clipboard.writeText(code);
  };

  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-4 right-4 z-[100] w-12 h-12 rounded-full flex items-center justify-center text-white text-lg"
        style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)', boxShadow: '0 0 20px rgba(124,58,237,0.4)' }}
        title="Apri pannello spaziatura"
      >
        📐
      </button>
    );
  }

  return (
    <div
      className="fixed right-4 top-4 bottom-4 z-[100] w-[320px] rounded-2xl overflow-hidden flex flex-col"
      style={{ background: 'rgba(8,12,28,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(34,211,238,0.2)', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-bold tracking-[2px] text-white">📐 ISCRIZIONE</span>
        <div className="flex gap-2">
          <button onClick={copyToClipboard} className="text-[10px] px-2.5 py-1 rounded-full bg-uranus-cyan/10 border border-uranus-cyan/30 text-uranus-cyan hover:bg-uranus-cyan/20 transition-all">📋 Copia</button>
          <button onClick={() => setPanelOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all">✕</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: 'thin' }}>
        {(Object.keys(regLabels) as (keyof RegSpacing)[]).map((key) => {
          const [min, max] = regRanges[key];
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-white/50 font-medium">{regLabels[key]}</label>
                <span className="text-[11px] font-bold text-uranus-cyan min-w-[36px] text-right">{values[key]}px</span>
              </div>
              <input
                type="range" min={min} max={max} value={values[key]}
                onChange={(e) => update(key, Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ background: `linear-gradient(to right, #22d3ee ${((values[key] - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((values[key] - min) / (max - min)) * 100}%)`, accentColor: '#22d3ee' }}
              />
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2 border-t border-white/10">
        <p className="text-[9px] text-white/25 text-center">Regola → premi &quot;📋 Copia&quot; → incolla in register/page.tsx</p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState("");
  const [txHash, setTxHash] = useState("");
  const [posizioni, setPosizioni] = useState(1);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"connect" | "form" | "done">("connect");
  const [assignedNumber, setAssignedNumber] = useState(0);
  const [sp, setSp] = useState<RegSpacing>(DEFAULT_REG);
  const [viewportWidth, setViewportWidth] = useState(0);
  // Spacing controls (step 2/3 — donation modal)
  const [d, setD] = useState({ gap: 28, logoMb: 20, titleMb: 12, walletMt: 0, qtyMt: 0, sumMt: 0, btnMt: 0 });
  const [dPanelOpen, setDPanelOpen] = useState(false);
  const dLabels: Record<string, string> = {
    gap: "Gap generale tra sezioni",
    logoMb: "Logo — spazio sotto",
    titleMb: "Titolo — spazio sotto",
    walletMt: "Wallet — spazio extra sopra",
    qtyMt: "Quantità — spazio extra sopra",
    sumMt: "Riepilogo — spazio extra sopra",
    btnMt: "Bottone — spazio extra sopra",
  };
  const dRanges: Record<string, [number, number]> = {
    gap: [8, 60], logoMb: [0, 50], titleMb: [0, 40],
    walletMt: [0, 40], qtyMt: [0, 40], sumMt: [0, 40], btnMt: [0, 40],
  };

  const [errore, setErrore] = useState("");

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const regScale =
    viewportWidth >= 1600
      ? 1
      : viewportWidth >= 1400
      ? 0.92
      : viewportWidth >= 1200
      ? 0.85
      : viewportWidth >= 992
      ? 0.78
      : viewportWidth >= 768
      ? 0.68
      : 0.58;

  const layoutSp = {
    ...sp,
    logoSize: Math.max(84, Math.round(sp.logoSize * regScale)),
    logoMb: Math.max(10, Math.round(sp.logoMb * regScale)),
    rivolMb: Math.max(6, Math.round(sp.rivolMb * regScale)),
    titleSize: Math.max(34, Math.round(sp.titleSize * regScale)),
    titleTrack: Math.max(2, Math.round(sp.titleTrack * regScale)),
    titleMb: Math.max(8, Math.round(sp.titleMb * regScale)),
    descMb: Math.max(12, Math.round(sp.descMb * regScale)),
    labelMb: Math.max(10, Math.round(sp.labelMb * regScale)),
    btnMaxW: Math.max(280, Math.round(sp.btnMaxW * regScale)),
    btnGap: Math.max(10, Math.round(sp.btnGap * regScale)),
    btnH: Math.max(52, Math.round(sp.btnH * regScale)),
  };
  const donationBackground = step === "done" ? "/donation.png" : "/register-bg.png";

  const connectWallet = async () => {
    setLoading(true);
    setErrore("");
    try {
      if (typeof window === "undefined" || !(window as WindowWithEthereum).ethereum) {
        setErrore("MetaMask non trovato. Installa l'estensione MetaMask nel browser.");
        setLoading(false);
        return;
      }
      const ethereum = (window as WindowWithEthereum).ethereum;
      if (!ethereum) {
        setLoading(false);
        return;
      }

      // Richiedi accesso account
      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      }) as string[];

      if (!accounts || accounts.length === 0) {
        setErrore("Nessun account selezionato. Riprova.");
        setLoading(false);
        return;
      }

      setWallet(accounts[0]);

      // Switch a Polygon solo se necessario (evita popup inutile)
      const currentChain = await ethereum.request({ method: "eth_chainId" }) as string;
      if (currentChain !== "0x89") {
        try {
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x89" }],
          });
        } catch (switchError: unknown) {
          if ((switchError as EthereumError).code === 4902) {
            await ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x89",
                  chainName: "Polygon Mainnet",
                  nativeCurrency: { name: "MATIC", symbol: "POL", decimals: 18 },
                  rpcUrls: ["https://polygon-rpc.com"],
                  blockExplorerUrls: ["https://polygonscan.com"],
                },
              ],
            });
          }
        }
      }

      setStep("form");
    } catch (err: unknown) {
      console.error("Errore connessione wallet:", err);
      if ((err as EthereumError).code === 4001) {
        setErrore("Connessione rifiutata. Accetta la richiesta in MetaMask.");
      } else {
        setErrore("Errore di connessione. Controlla che MetaMask sia sbloccato.");
      }
    }
    setLoading(false);
  };

  const inviaDono = async () => {
    if (!wallet) return;
    setLoading(true);
    setErrore("");
    try {
      const ethereum = (window as WindowWithEthereum).ethereum;
      if (!ethereum) { setLoading(false); return; }

      // 1. Trasferimento USDC ERC-20 su Polygon
      const totalUsdc = posizioni * 20;
      const txHash = await sendUsdc(ethereum, wallet, totalUsdc);
      setTxHash(txHash);

      // 2. Registra la donazione nel backend (se disponibile)
      let ticket: number | null = null;
      try {
        const result = await dona({ wallet, txHash, numeroPosizioni: posizioni });
        ticket = result.ticket;
      } catch {
        // Backend non ancora collegato
      }

      // 3. Salva wallet per area personale (senza firma SIWE)
      saveSession({
        wallet,
        name: wallet.slice(0, 6) + "..." + wallet.slice(-4),
        message: "",
        signature: "",
        chainId: 137,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      localStorage.setItem("uranus_user", JSON.stringify({ wallet }));

      setAssignedNumber(ticket ?? 0);
      setStep("done");
    } catch (err: unknown) {
      console.error("Errore invio dono:", err);
      if ((err as EthereumError).code === 4001) {
        setErrore("Transazione rifiutata. Accetta la richiesta in MetaMask.");
      } else {
        setErrore("Errore durante l'invio del dono. Riprova.");
      }
    }
    setLoading(false);
  };

  if (step === "connect") {
    return (
      <section className="relative min-h-screen overflow-hidden bg-[#020711] p-1 sm:p-2">
        <div
          className="relative min-h-[calc(100vh-0.5rem)] sm:min-h-[calc(100vh-1rem)] overflow-hidden rounded-[34px] border border-uranus-cyan/55 bg-cover bg-[center_right] bg-no-repeat"
          style={{
            backgroundImage: "url('/register-bg.png')",
            boxShadow: "inset 0 0 60px rgba(34, 211, 238, 0.12), 0 0 30px rgba(34, 211, 238, 0.18)",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[#030812]/90 via-[#030812]/30 to-[#030812]/5" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
          <StarField count={35} />

          <header className="hidden">
            <div
              className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 rounded-full px-3 py-2 sm:px-5 sm:py-3"
              style={{
                background: "rgba(2,20,38,0.55)",
                border: "1px solid rgba(34,211,238,0.24)",
                backdropFilter: "blur(10px)",
                boxShadow: "0 0 22px rgba(34,211,238,0.18)",
              }}
            >
              <div className="flex min-w-0 flex-nowrap items-center gap-2 sm:gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12"
                  style={{
                    background: "rgba(2,20,38,0.72)",
                    border: "1px solid rgba(34,211,238,0.45)",
                    boxShadow: "0 0 20px rgba(34,211,238,0.35), inset 0 0 14px rgba(34,211,238,0.16)",
                  }}
                >
                  <Image
                    src="/logo-uranus.png"
                    alt="ROG-URANUS"
                    width={38}
                    height={38}
                    unoptimized
                    className="drop-shadow-[0_0_20px_rgba(34,211,238,0.9)]"
                  />
                </span>
                <span
                  className="max-w-[54vw] truncate whitespace-nowrap text-sm font-bold leading-none tracking-[1px] text-white sm:max-w-none sm:text-base sm:tracking-[4px] md:text-lg"
                  style={{ fontFamily: "var(--font-orbitron), sans-serif" }}
                >
                  ROG-URANUS
                </span>
              </div>
              <button
                onClick={() => router.push('/')}
                className="shrink-0 flex items-center gap-1.5 sm:gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[2px] text-white/75 backdrop-blur-md transition-all hover:border-uranus-cyan/50 hover:text-white sm:px-4 sm:py-2 sm:text-[10px] sm:tracking-[3px]"
              >
                <svg className="hidden h-4 w-4 sm:block" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
                </svg>
                HOME
              </button>
            </div>
          </header>

          <div className="relative z-10 flex min-h-[calc(100vh-0.5rem)] sm:min-h-[calc(100vh-1rem)] flex-col items-center justify-center px-8 py-10 sm:px-14">
            {ENABLE_REG_SPACING_PANEL ? <RegSpacingPanel values={sp} onChange={setSp} /> : null}

            <Image
              src="/logo-uranus.png"
              alt="ROG-URANUS"
              width={layoutSp.logoSize}
              height={layoutSp.logoSize}
              unoptimized
              priority
              className="drop-shadow-[0_0_30px_rgba(0,216,255,0.85)]"
              style={{ marginBottom: `${layoutSp.logoMb}px` }}
            />

            <p
              className="text-center text-xs font-bold uppercase text-uranus-cyan/90 sm:text-sm"
              style={{ marginBottom: `${layoutSp.rivolMb}px`, letterSpacing: "0.45em" }}
            >
              Rivoluzione di
            </p>
            <h1
              className="text-center font-bold uppercase leading-none text-uranus-cyan"
              style={{
                fontSize: `clamp(34px, 9vw, ${layoutSp.titleSize}px)`,
                letterSpacing: `${layoutSp.titleTrack}px`,
                marginBottom: `${layoutSp.titleMb}px`,
                textShadow: '0 0 22px rgba(34, 211, 238, 0.9), 0 0 60px rgba(34, 211, 238, 0.35)',
              }}
            >
              ROG-URANUS
            </h1>

            <p
              className="text-center text-sm leading-relaxed text-white/70"
              style={{ marginBottom: `${layoutSp.descMb}px`, maxWidth: `${Math.max(300, Math.round(380 * regScale))}px` }}
            >
              La prima comunità che trasforma
              <br />
              la collaborazione in <span className="font-bold text-uranus-cyan">valore condiviso.</span>
            </p>

            <p
              className="text-center text-[10px] font-bold uppercase text-white/45"
              style={{ marginBottom: `${layoutSp.labelMb}px`, letterSpacing: "0.22em" }}
            >
              Partecipazione · Trasparenza · Crescita collettiva
            </p>
            <div className="flex w-full flex-col" style={{ maxWidth: `${layoutSp.btnMaxW}px`, gap: `${layoutSp.btnGap}px` }}>
              <button
                onClick={connectWallet}
                disabled={loading}
                className="group flex items-center justify-center gap-3 rounded-full border border-uranus-cyan/60 bg-gradient-to-r from-uranus-cyan to-[#0ea5e9] px-7 text-xs font-bold uppercase tracking-[4px] text-white shadow-[0_0_30px_rgba(34,211,238,0.55)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_45px_rgba(34,211,238,0.75)] disabled:opacity-60"
                style={{ height: `${layoutSp.btnH}px` }}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5a6 6 0 00-12 0v2.25A2.25 2.25 0 003.75 12v6A2.25 2.25 0 006 20.25h12A2.25 2.25 0 0020.25 18v-6A2.25 2.25 0 0018 9.75V7.5z" />
                </svg>
                {loading ? "Connessione..." : "Iscriviti ora"}
              </button>

              <div className="flex flex-col items-center gap-3 mt-2">
                <p className="text-center text-[12px] leading-relaxed text-white/55">
                  Per accedere a <span className="font-bold text-uranus-cyan">ROG-URANUS</span> è necessario<br />
                  avere almeno una posizione attiva in <span className="font-bold text-uranus-cyan">Revolution of Giving</span>
                </p>
                <a
                  href="https://revolutionofgiving.eth.limo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-center gap-3 w-full rounded-full border border-uranus-cyan/35 bg-[#030812]/50 px-7 text-xs font-bold uppercase tracking-[4px] text-white/75 backdrop-blur-md transition-all duration-300 hover:border-uranus-cyan/75 hover:bg-uranus-cyan/10 hover:text-white"
                  style={{ height: `${layoutSp.btnH}px` }}
                >
                  <svg className="h-4 w-4 text-uranus-cyan" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A3.75 3.75 0 0012 1.5v0a3.75 3.75 0 00-3.75 3.75V9m-.75 0h9A2.25 2.25 0 0118.75 11.25v7.5A2.25 2.25 0 0116.5 21h-9a2.25 2.25 0 01-2.25-2.25v-7.5A2.25 2.25 0 017.5 9z" />
                  </svg>
                  Accedi a ROG
                </a>
              </div>
            </div>

            {errore && (
              <div className="mt-5 max-w-sm rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 backdrop-blur-md">
                <p className="text-center text-xs text-red-300">{errore}</p>
              </div>
            )}

            <div className="mt-8 w-full px-8 text-center sm:absolute sm:bottom-8 sm:left-1/2 sm:mt-0 sm:-translate-x-1/2">
              <p className="text-[10px] font-bold uppercase tracking-[6px] text-white/55">
                Il cambiamento non si aspetta.
              </p>
              <p className="mt-1 text-sm font-bold uppercase tracking-[6px] text-uranus-cyan text-glow-cyan">
                Entra nella rivoluzione.
              </p>
            </div>
          </div>

          <div className="absolute bottom-6 left-6 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-uranus-cyan/35 bg-black/30 text-xs font-bold text-white/70 backdrop-blur-md">
            N
          </div>
          <div className="absolute bottom-6 right-6 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-uranus-cyan/70 bg-black/30 text-uranus-cyan backdrop-blur-md">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25L12 4.5v15l-5.25-3.75H3.75A1.5 1.5 0 012.25 14.25v-4.5a1.5 1.5 0 011.5-1.5h3z" />
            </svg>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative min-h-screen overflow-hidden bg-[#020711]">
      {/* Deep space background */}
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url('${donationBackground}')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#020711]/30 via-[#020711]/50 to-[#020711]/80" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(2,7,17,0.6)_70%)]" />
      </div>
      <StarField count={50} />

      {/* Header — logo + HOME */}
      <header className="hidden">
        <div
          className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 rounded-full px-3 py-2 sm:px-5 sm:py-3"
          style={{
            background: "rgba(2,20,38,0.55)",
            border: "1px solid rgba(34,211,238,0.24)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 0 22px rgba(34,211,238,0.18)",
          }}
        >
          <div className="flex min-w-0 flex-nowrap items-center gap-2 sm:gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12"
              style={{
                background: "rgba(2,20,38,0.72)",
                border: "1px solid rgba(34,211,238,0.45)",
                boxShadow: "0 0 20px rgba(34,211,238,0.35), inset 0 0 14px rgba(34,211,238,0.16)",
              }}
            >
              <Image
                src="/logo-uranus.png"
                alt="ROG-URANUS"
                width={38}
                height={38}
                unoptimized
                className="drop-shadow-[0_0_20px_rgba(34,211,238,0.9)]"
              />
            </span>
            <span
              className="max-w-[54vw] truncate whitespace-nowrap text-sm font-bold leading-none tracking-[1px] text-white sm:max-w-none sm:text-base sm:tracking-[4px] md:text-lg"
              style={{ fontFamily: "var(--font-orbitron), sans-serif" }}
            >
              ROG-URANUS
            </span>
          </div>
          <button
            onClick={() => router.push('/')}
            className="shrink-0 flex items-center gap-1.5 sm:gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[2px] text-white/75 backdrop-blur-md transition-all hover:border-uranus-cyan/50 hover:text-white sm:px-4 sm:py-2 sm:text-[10px] sm:tracking-[3px]"
          >
            <svg className="hidden h-4 w-4 sm:block" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
            </svg>
            HOME
          </button>
        </div>
      </header>

      {/* Modal centrata */}
      <div className="relative z-10 flex items-center justify-center px-4 pb-6" style={{ minHeight: 'calc(100vh - 80px)' }}>
        <div className="w-full max-w-[480px] relative">
          {/* Glow luminoso dietro la card — luce forte ai bordi */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: '-20px',
              left: '-30px',
              right: '-30px',
              bottom: '-20px',
              borderRadius: '40px',
              background: 'radial-gradient(ellipse at center, rgba(34,211,238,0.18) 0%, rgba(34,211,238,0.08) 35%, rgba(34,211,238,0.03) 55%, transparent 75%)',
              filter: 'blur(25px)',
            }}
          />
          <div
            className="relative overflow-hidden"
            style={{
              borderRadius: '30px',
              border: '1.5px solid rgba(34, 211, 238, 0.4)',
              boxShadow:
                '0 0 40px rgba(34, 211, 238, 0.2), 0 0 80px rgba(34, 211, 238, 0.12), 0 0 140px rgba(34, 211, 238, 0.06), 0 0 220px rgba(34, 211, 238, 0.03), 0 40px 80px rgba(0,0,0,0.6), inset 0 0 60px rgba(34, 211, 238, 0.05)',
              minHeight: '82vh',
            }}
          >
            {/* Glass background — vetro trasparente illuminato */}
            <div className="absolute inset-0 bg-[#050c1a]/55 backdrop-blur-2xl" />
            <div
              className="absolute inset-0"
              style={{
                borderRadius: '30px',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(34,211,238,0.1), inset 0 0 100px rgba(34,211,238,0.05)',
              }}
            />
            {/* Top edge glow */}
            <div className="absolute top-0 left-[3%] right-[3%] h-[2px] bg-gradient-to-r from-transparent via-uranus-cyan/50 to-transparent" style={{ filter: 'blur(1px)' }} />
            {/* Bottom edge glow */}
            <div className="absolute bottom-0 left-[5%] right-[5%] h-[2px] bg-gradient-to-r from-transparent via-uranus-cyan/35 to-transparent" style={{ filter: 'blur(1px)' }} />
            {/* Left edge glow */}
            <div className="absolute left-0 top-[5%] bottom-[5%] w-[2px] bg-gradient-to-b from-transparent via-uranus-cyan/30 to-transparent" style={{ filter: 'blur(1px)' }} />
            {/* Right edge glow */}
            <div className="absolute right-0 top-[5%] bottom-[5%] w-[2px] bg-gradient-to-b from-transparent via-uranus-cyan/30 to-transparent" style={{ filter: 'blur(1px)' }} />

            <div className="relative flex flex-col justify-center px-7 py-10 sm:px-12 sm:py-14" style={{ minHeight: '82vh' }}>

              {/* Pannello spaziatura donazione */}
              {ENABLE_DONATION_SPACING_PANEL && step === "form" && dPanelOpen && (
                <div className="fixed left-4 top-4 bottom-4 z-[100] w-[300px] rounded-2xl overflow-hidden flex flex-col" style={{ background: 'rgba(8,12,28,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(34,211,238,0.2)', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <span className="text-sm font-bold tracking-[2px] text-white">📐 DONO</span>
                    <div className="flex gap-2">
                      <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(d, null, 2)); }} className="text-[10px] px-2.5 py-1 rounded-full bg-uranus-cyan/10 border border-uranus-cyan/30 text-uranus-cyan">📋</button>
                      <button onClick={() => setDPanelOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white">✕</button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: 'thin' }}>
                    {Object.keys(dLabels).map((key) => {
                      const [min, max] = dRanges[key];
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-white/50 font-medium">{dLabels[key]}</label>
                            <span className="text-[11px] font-bold text-uranus-cyan">{d[key as keyof typeof d]}px</span>
                          </div>
                          <input type="range" min={min} max={max} value={d[key as keyof typeof d]}
                            onChange={(e) => setD({ ...d, [key]: Number(e.target.value) })}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                            style={{ background: `linear-gradient(to right, #22d3ee ${((d[key as keyof typeof d] - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((d[key as keyof typeof d] - min) / (max - min)) * 100}%)`, accentColor: '#22d3ee' }}
                          />
                        </div>
                      );
                    })}
                  </div>

                </div>
              )}
              {ENABLE_DONATION_SPACING_PANEL && step === "form" && !dPanelOpen && (
                <button onClick={() => setDPanelOpen(true)} className="fixed bottom-4 left-4 z-[100] w-12 h-12 rounded-full flex items-center justify-center text-white text-lg" style={{ background: 'linear-gradient(135deg, #7c3aed, #22d3ee)', boxShadow: '0 0 20px rgba(124,58,237,0.4)' }}>📐</button>
              )}

              {/* ====== STEP: FORM ====== */}
              {step === "form" && (
                <div className="flex flex-col animate-[fadeIn_0.4s_ease-out]" style={{ gap: `${d.gap}px` }}>
                  {/* Logo + Title */}
                  <div className="text-center flex flex-col items-center">
                    <Image
                      src="/logo-uranus.png"
                      alt="ROG-URANUS"
                      width={72}
                      height={72}
                      unoptimized
                      className="drop-shadow-[0_0_24px_rgba(0,216,255,0.8)]"
                      style={{ marginBottom: `${d.logoMb}px` }}
                    />
                    <h1
                      className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[4px] sm:tracking-[8px] text-white"
                      style={{ fontFamily: 'var(--font-orbitron), sans-serif', textShadow: '0 0 20px rgba(34,211,238,0.3)', marginBottom: `${d.titleMb}px` }}
                    >
                      INVIA IL DONO
                    </h1>
                    <p className="text-white/40 text-sm tracking-[2px]">
Stai per inviare un dono nell&apos;ecosìnostra ROG-URANUS.
                    </p>
                  </div>

                  {/* Wallet connesso */}
                  <div
                    className="flex flex-col items-center p-6 rounded-2xl"
                    style={{ marginTop: `${d.walletMt}px`, background: 'rgba(6, 214, 160, 0.04)', border: '1px solid rgba(6, 214, 160, 0.18)' }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-uranus-teal animate-pulse shadow-[0_0_10px_rgba(6,214,160,0.6)]" />
                      <span className="text-[11px] text-uranus-teal font-bold tracking-[2px]">WALLET CONNESSO</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-white text-lg font-mono tracking-wider">
                        {wallet.slice(0, 6)}...{wallet.slice(-4)}
                      </p>
                      <button
                        onClick={() => navigator.clipboard.writeText(wallet)}
                        className="text-white/30 hover:text-uranus-cyan transition-colors"
                        title="Copia indirizzo"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-[10px] text-white/25 mt-2 tracking-[1px]">Rete Polygon</p>
                  </div>

                  {/* Quantità del dono */}
                  <div
                    className="flex flex-col items-center p-7 rounded-2xl"
                    style={{ marginTop: `${d.qtyMt}px`, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <p className="text-[10px] text-white/40 tracking-[3px] font-bold mb-5">QUANTITÀ DEL DONO</p>
                    <div className="flex items-center gap-6">
                      <button
                        onClick={() => setPosizioni(Math.max(1, posizioni - 1))}
                        className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white/50 text-xl flex items-center justify-center transition-all hover:bg-uranus-cyan/10 hover:border-uranus-cyan/30 hover:text-white hover:shadow-[0_0_20px_rgba(34,211,238,0.2)]"
                      >
                        −
                      </button>
                      <span
                        className="text-5xl font-bold text-white min-w-[80px] text-center"
                        style={{ fontFamily: 'var(--font-orbitron), sans-serif', textShadow: '0 0 16px rgba(34,211,238,0.25)' }}
                      >
                        {posizioni}
                      </span>
                      <button
                        onClick={() => setPosizioni(posizioni + 1)}
                        className="w-12 h-12 rounded-full border border-white/15 bg-white/5 text-white/50 text-xl flex items-center justify-center transition-all hover:bg-uranus-cyan/10 hover:border-uranus-cyan/30 hover:text-white hover:shadow-[0_0_20px_rgba(34,211,238,0.2)]"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Summary — 2 colonne */}
                  <div
                    className="flex overflow-hidden rounded-2xl"
                    style={{ marginTop: `${d.sumMt}px`, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)' }}
                  >
                    <div className="flex flex-col items-center justify-center flex-1 py-7 border-r border-white/8">
                      <p className="text-[10px] text-white/45 tracking-[2px] font-bold mb-2">VALORE DONO</p>
                      <p
                        className="text-3xl font-bold text-uranus-cyan"
                        style={{ fontFamily: 'var(--font-orbitron), sans-serif', textShadow: '0 0 18px rgba(34,211,238,0.35)' }}
                      >
                        20 USDC
                      </p>
                    </div>
                    <div className="flex flex-col items-center justify-center flex-1 py-7">
                      <p className="text-[10px] text-white/45 tracking-[2px] font-bold mb-2">TOTALE DONO</p>
                      <p
                        className="text-3xl font-bold text-uranus-cyan"
                        style={{ fontFamily: 'var(--font-orbitron), sans-serif', textShadow: '0 0 18px rgba(34,211,238,0.35)' }}
                      >
                        {posizioni * 20} USDC
                      </p>
                    </div>
                  </div>

                  {/* CTA Button */}
                  <button
                    onClick={inviaDono}
                    disabled={loading}
                    className="group w-full py-5 rounded-2xl font-bold text-lg tracking-[4px] uppercase transition-all duration-300 disabled:opacity-50 text-white flex items-center justify-center gap-3 hover:scale-[1.02]"
                    style={{
                      marginTop: `${d.btnMt}px`,
                      fontFamily: 'var(--font-orbitron), sans-serif',
                      background: 'linear-gradient(135deg, #06b6d4, #22d3ee, #06d6a0)',
                      boxShadow: '0 0 40px rgba(34, 211, 238, 0.35), 0 0 80px rgba(34, 211, 238, 0.12), 0 12px 40px rgba(0,0,0,0.4)',
                    }}
                  >
                    <svg className="w-6 h-6 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                    {loading ? "Invio in corso..." : "Invia il Dono"}
                  </button>

                  {/* Errore */}
                  {errore && (
                    <div className="w-full px-5 py-3 rounded-xl border border-red-500/25 bg-red-500/8">
                      <p className="text-xs text-red-400 text-center">{errore}</p>
                    </div>
                  )}

                  {/* Security footer */}
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <svg className="w-4 h-4 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <p className="text-[11px] text-white/30">
                      Transazione sicura e verificata sulla rete <span className="font-bold text-uranus-cyan/60">Polygon</span>.
                    </p>
                  </div>
                </div>
              )}

              {/* ====== STEP: DONE ====== */}
              {step === "done" && (
                <div className="flex flex-col items-center gap-8 text-center py-4 animate-[fadeIn_0.4s_ease-out]">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-uranus-teal/20 to-uranus-cyan/10 border-2 border-uranus-teal/50 flex items-center justify-center">
                      <svg className="w-10 h-10 text-uranus-teal" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="absolute -inset-3 rounded-full border border-uranus-teal/20 animate-ping" style={{ animationDuration: '2s' }} />
                  </div>

                  <h2 className="text-2xl md:text-3xl font-bold tracking-[6px] text-white" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>
                    DONO INVIATO
                  </h2>

                  <div
                    className="w-full rounded-2xl border border-uranus-cyan/30 bg-white/[0.06] p-8 backdrop-blur-xl"
                    style={{
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(34,211,238,0.08), 0 0 35px rgba(34,211,238,0.15)",
                    }}
                  >
                    <p className="text-xs text-white/40 tracking-[3px] font-bold mb-3">IL TUO NUMERO ASSEGNATO</p>
                    <p className="text-6xl md:text-7xl font-bold text-uranus-cyan" style={{ fontFamily: 'var(--font-orbitron), sans-serif', textShadow: '0 0 30px rgba(34,211,238,0.4)' }}>
                      {assignedNumber > 0 ? `#${assignedNumber}` : "In attesa"}
                    </p>
                    <p className="text-xs text-white/30 mt-4 tracking-[1px]">
                      {assignedNumber > 0
                        ? "Conserva questo numero. Sarà il tuo identificativo nell\u2019ecosistema ROG-URANUS."
                        : "Il tuo numero verrà assegnato a breve dal sistema."}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-5 sm:gap-8 text-center">
                    <div>
                      <p className="text-[10px] text-white/40 tracking-[2px] font-bold">POSIZIONI</p>
                      <p className="text-xl font-bold text-white">{posizioni}</p>
                    </div>
                    <div className="w-px bg-white/10" />
                    <div>
                      <p className="text-[10px] text-white/40 tracking-[2px] font-bold">TOTALE</p>
                      <p className="text-xl font-bold text-uranus-cyan">{posizioni * 20} USDC</p>
                    </div>
                    <div className="w-px bg-white/10" />
                    <div>
                      <p className="text-[10px] text-white/40 tracking-[2px] font-bold">RETE</p>
                      <p className="text-xl font-bold text-uranus-violet">Polygon</p>
                    </div>
                  </div>

                  <div
                    className="w-full rounded-2xl border border-uranus-cyan/25 bg-white/[0.05] p-5 text-left backdrop-blur-xl"
                    style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 0 22px rgba(34,211,238,0.08)" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[2px] text-white/45">WALLET DONATORE</p>
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <p className="text-xs sm:text-sm text-white break-all">{wallet || "In attesa"}</p>
                      <button
                        onClick={() => wallet && navigator.clipboard.writeText(wallet)}
                        className="shrink-0 text-white/40 hover:text-uranus-cyan transition-colors"
                        title="Copia wallet"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div
                    className="w-full rounded-2xl border border-uranus-cyan/25 bg-white/[0.05] p-5 text-left backdrop-blur-xl"
                    style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 0 22px rgba(34,211,238,0.08)" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[2px] text-white/45">ID TRANSAZIONE</p>
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <p className="text-xs sm:text-sm text-uranus-cyan font-mono break-all">{txHash || "In attesa"}</p>
                      <button
                        onClick={() => txHash && navigator.clipboard.writeText(txHash)}
                        className="shrink-0 text-white/40 hover:text-uranus-cyan transition-colors"
                        title="Copia transazione"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-white/40">ID breve: <span className="text-white/70">{shortTxHash(txHash)}</span></p>
                  </div>

                  <button
                    onClick={() => router.push("/dashboard")}
                    className="w-full rounded-2xl py-4 text-sm sm:text-base font-bold uppercase tracking-[3px] text-white transition-all duration-300 hover:scale-[1.02]"
                    style={{
                      background: "linear-gradient(135deg, #22d3ee, #06b6d4, #06d6a0)",
                      boxShadow: "0 0 30px rgba(34,211,238,0.35), 0 8px 30px rgba(0,0,0,0.3)",
                    }}
                  >
                    VAI ALL&apos;AREA PERSONALE
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
