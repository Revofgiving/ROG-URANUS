"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import StarField from "@/components/effects/StarField";
import { signInWithEthereum, saveSession } from "@/lib/auth";
type EthereumRequestParams = {
  method: string;
  params?: unknown[];
};

type EthereumProvider = {
  request: (args: EthereumRequestParams) => Promise<unknown>;
};

type WindowWithEthereum = Window & typeof globalThis & {
  ethereum?: EthereumProvider;
};

type EthereumError = {
  code?: number;
};

const sp = {
  boxPx: 40, boxMinH: 50, logoSize: 144, logoMb: 19,
  headerPt: 2, headerPb: 2, titleSize: 29, titleTrack: 4,
  titleMb: 12, subTrack: 2, lineMb: 12, contentPt: 1,
  h2Size: 24, h2Track: 1, h2Mb: 2, descMt: 12,
  btnMt: 2, btnMx: 12, btnPad: 11, btnRound: 14, btnGap: 16,
  foxSize: 55, foxRound: 11, foxEmoji: 41, arrowSize: 39,
  divMt: 3, divMb: 3, badgeGap: 43, badgeIcon: 25,
  badgeTitleSize: 12, badgeSubSize: 10, polyMt: 16, polyPb: 12,
};

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errore, setErrore] = useState("");
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const loginScale =
    viewportWidth >= 1600
      ? 1
      : viewportWidth >= 1400
      ? 0.92
      : viewportWidth >= 1200
      ? 0.86
      : viewportWidth >= 992
      ? 0.8
      : viewportWidth >= 768
      ? 0.72
      : 0.62;

  const scaled = (value: number, min: number) => Math.max(min, Math.round(value * loginScale));

  const layout = {
    ...sp,
    boxPx: scaled(sp.boxPx, 16),
    logoSize: scaled(sp.logoSize, 88),
    logoMb: scaled(sp.logoMb, 8),
    titleSize: scaled(sp.titleSize, 24),
    titleTrack: scaled(sp.titleTrack, 1),
    titleMb: scaled(sp.titleMb, 8),
    subTrack: scaled(sp.subTrack, 1),
    lineMb: scaled(sp.lineMb, 8),
    h2Size: scaled(sp.h2Size, 20),
    h2Track: scaled(sp.h2Track, 1),
    h2Mb: scaled(sp.h2Mb, 2),
    descMt: scaled(sp.descMt, 8),
    btnMx: scaled(sp.btnMx, 4),
    btnPad: scaled(sp.btnPad, 9),
    btnRound: scaled(sp.btnRound, 10),
    btnGap: scaled(sp.btnGap, 10),
    foxSize: scaled(sp.foxSize, 42),
    foxRound: scaled(sp.foxRound, 8),
    foxEmoji: scaled(sp.foxEmoji, 28),
    arrowSize: scaled(sp.arrowSize, 28),
    divMt: scaled(sp.divMt, 2),
    divMb: scaled(sp.divMb, 2),
    badgeGap: scaled(sp.badgeGap, 14),
    badgeIcon: scaled(sp.badgeIcon, 18),
    badgeTitleSize: scaled(sp.badgeTitleSize, 10),
    badgeSubSize: scaled(sp.badgeSubSize, 9),
    polyMt: scaled(sp.polyMt, 10),
    polyPb: scaled(sp.polyPb, 8),
  };

  const connectWallet = async () => {
    setLoading(true);
    setErrore("");
    try {
      if (typeof window === "undefined" || !(window as WindowWithEthereum).ethereum) {
        setErrore("Installa MetaMask o un wallet compatibile con Polygon.");
        setLoading(false);
        return;
      }
      const ethereum = (window as WindowWithEthereum).ethereum;
      if (!ethereum) {
        setLoading(false);
        return;
      }

      // 1. Connetti wallet
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!accounts || accounts.length === 0) { setLoading(false); return; }
      const wallet = accounts[0];

      // 2. Switch a Polygon
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x89" }],
        });
      } catch (switchError: unknown) {
        if ((switchError as EthereumError).code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x89",
              chainName: "Polygon Mainnet",
              nativeCurrency: { name: "MATIC", symbol: "POL", decimals: 18 },
              rpcUrls: ["https://polygon-rpc.com"],
              blockExplorerUrls: ["https://polygonscan.com"],
            }],
          });
        }
      }

      // 3. Sign-In With Ethereum (SIWE)
      const session = await signInWithEthereum(ethereum, wallet);
      saveSession(session);

      router.push("/dashboard");
    } catch (err: unknown) {
      console.error("Errore connessione wallet:", err);
      if ((err as EthereumError)?.code === 4001) {
        setErrore("Richiesta rifiutata. Accetta la firma in MetaMask.");
      } else {
        setErrore("Errore di connessione. Controlla MetaMask.");
      }
    }
    setLoading(false);
  };

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6">
      {/* Background */}
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/planet.png')" }}
        />
        <div className="absolute inset-0 bg-black/50" />
      </div>
      <StarField count={40} />

      <div className="relative z-10 w-full max-w-lg">
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{
            boxShadow: '0 0 80px rgba(34, 211, 238, 0.15), 0 0 160px rgba(34, 211, 238, 0.08), 0 20px 60px rgba(0,0,0,0.5)',
            border: '1.5px solid rgba(34, 211, 238, 0.3)',
          }}
        >
          <div className="absolute inset-0 bg-white/5 backdrop-blur-xl" />
          <div className="absolute inset-0 rounded-3xl" style={{ boxShadow: 'inset 0 0 50px rgba(34, 211, 238, 0.08)' }} />

          <div className="relative flex flex-col" style={{ paddingLeft: layout.boxPx, paddingRight: layout.boxPx, minHeight: `${sp.boxMinH}vh` }}>
            {/* Logo + Title */}
            <div className="flex flex-col items-center" style={{ paddingTop: `${sp.headerPt}vh`, paddingBottom: `${sp.headerPb}vh` }}>
              <Image
                src="/logo-uranus.png"
                alt="ROG-URANUS"
                width={layout.logoSize}
                height={layout.logoSize}
                style={{ marginBottom: layout.logoMb }}
              />
              <h1 className="text-center font-bold text-white" style={{ fontSize: `clamp(24px, 5vw, ${layout.titleSize}px)`, letterSpacing: layout.titleTrack, marginBottom: layout.titleMb }}>
                BENVENUTO IN <span className="text-uranus-cyan" style={{ fontFamily: 'var(--font-unciale), fantasy, serif' }}>ROG-URANUS</span>
              </h1>
              <p className="text-white/40 text-sm" style={{ letterSpacing: layout.subTrack }}>
                Sistema di Economia del Dono
              </p>
            </div>

            {/* Riga blu brillante */}
            <div className="relative w-full h-[3px]" style={{ marginBottom: layout.lineMb }}>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#22d3ee] to-transparent" />
              <div className="absolute inset-[-4px] bg-gradient-to-r from-transparent via-[#22d3ee]/60 to-transparent blur-md" />
              <div className="absolute inset-[-8px] bg-gradient-to-r from-transparent via-[#22d3ee]/30 to-transparent blur-xl" />
            </div>

            {/* Contenuto */}
            <div className="flex-1 flex flex-col justify-start" style={{ paddingTop: `${sp.contentPt}vh` }}>

            {/* Subtitle */}
            <div className="text-center" style={{ marginBottom: layout.h2Mb }}>
              <h2 className="font-bold text-white" style={{ fontSize: layout.h2Size, letterSpacing: layout.h2Track }}>
                Accedi alla tua Area Personale
              </h2>
              <p className="text-white/40 text-base leading-relaxed" style={{ marginTop: layout.descMt }}>
                Connettiti con il tuo wallet per accedere in modo
                <br />sicuro e gestire il tuo ciclo.
              </p>
            </div>

            {/* MetaMask Button */}
            <div style={{ marginTop: `${sp.btnMt}vh` }} />
            <button
              onClick={connectWallet}
              disabled={loading}
              className="flex items-center transition-all duration-300 disabled:opacity-50 group"
              style={{
                marginLeft: layout.btnMx, marginRight: layout.btnMx,
                padding: layout.btnPad, borderRadius: layout.btnRound, gap: layout.btnGap,
                background: 'linear-gradient(135deg, #0052cc, #0074ff, #00a2ff)',
                border: '2px solid #00b4ff',
                boxShadow: '0 0 25px rgba(0, 116, 255, 0.3), 0 8px 25px rgba(0,0,0,0.3)',
              }}
            >
              {/* MetaMask fox icon */}
              <div className="bg-gradient-to-br from-[#f6851b]/20 to-[#e2761b]/10 border border-[#f6851b]/30 flex items-center justify-center shrink-0" style={{ width: layout.foxSize, height: layout.foxSize, borderRadius: layout.foxRound }}>
                <span style={{ fontSize: layout.foxEmoji }}>🦊</span>
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-bold text-base">
                  {loading ? "Connessione..." : "Accedi con MetaMask"}
                </p>
                <p className="text-white/40 text-xs mt-0.5">
                  Connetti il tuo wallet MetaMask
                </p>
              </div>
              <svg style={{ width: layout.arrowSize, height: layout.arrowSize }} className="text-white/30 group-hover:text-uranus-cyan transition-colors" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>

            {/* Messaggio errore */}
            {errore && (
              <div className="mt-4" style={{ marginLeft: layout.btnMx, marginRight: layout.btnMx }}>
                <div className="px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10">
                  <p className="text-xs text-red-400 text-center">{errore}</p>
                </div>
              </div>
            )}

            {/* Divider with shield */}
            <div className="flex items-center gap-4" style={{ marginTop: `${layout.divMt}vh`, marginBottom: `${layout.divMb}vh` }}>
              <div className="flex-1 h-px bg-white/10" />
              <svg className="w-5 h-5 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap items-center justify-center" style={{ gap: layout.badgeGap }}>
              {[
                { icon: "🛡️", title: "Sicuro e Verificato", sub: "Blockchain Polygon" },
                { icon: "🔒", title: "Non-custodial", sub: "Tu mantieni il controllo" },
                { icon: "✅", title: "Trasparente", sub: "Verificabile on-chain" },
              ].map((badge) => (
                <div key={badge.title} className="w-[120px] text-center">
                  <span style={{ fontSize: layout.badgeIcon }}>{ badge.icon}</span>
                  <p className="font-bold text-white/50 tracking-[1px] mt-1" style={{ fontSize: layout.badgeTitleSize }}>
                    {badge.title}
                  </p>
                  <p className="text-white/25" style={{ fontSize: layout.badgeSubSize }}>{badge.sub}</p>
                </div>
              ))}
            </div>

            {/* Polygon badge */}
            <div className="flex flex-wrap items-center justify-center gap-3" style={{ marginTop: layout.polyMt, paddingBottom: layout.polyPb }}>
              <span className="text-xs text-white/30">Rete:</span>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 38 33" fill="none">
                  <path d="M29.5 10.2c-.7-.4-1.6-.4-2.4 0l-5.6 3.3-3.8 2.1-5.5 3.3c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-5c0-.8.4-1.6 1.2-2.1l4.3-2.5c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v3.3l3.8-2.2V7c0-.8-.4-1.6-1.2-2.1L14.6.5c-.7-.4-1.6-.4-2.4 0L5.8 5C5 5.4 4.6 6.2 4.6 7v9.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l5.5-3.2 3.8-2.2 5.5-3.2c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v5c0 .8-.4 1.6-1.2 2.1l-4.3 2.6c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-3.3l-3.8 2.2v3.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l6.5-3.8c.7-.4 1.2-1.2 1.2-2.1V14c0-.8-.4-1.6-1.2-2.1l-6.6-3.8z" fill="#7c3aed"/>
                </svg>
                <span className="text-sm font-semibold text-white">Polygon</span>
                <div className="w-2.5 h-2.5 rounded-full bg-uranus-teal animate-pulse" />
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
