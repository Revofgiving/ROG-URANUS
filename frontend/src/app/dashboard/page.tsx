"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { uranusService, type PosizioneResponse, type PercorsoResponse } from "@/services/uranus";
import { apiUranusService, type DonoPendente, type Messaggio } from "@/services/uranus/api-service";

type StoredUser = {
  wallet?: string;
};
type ButtonAdjust = {
  groupX: number;
  groupY: number;
  firstX: number;
  firstY: number;
  secondX: number;
  secondY: number;
};

const ORBITE_BASE = [
  { nome: "SOLE", simbolo: "☉", livello: 0 },
  { nome: "VENERE", simbolo: "♀", livello: 3 },
  { nome: "NETTUNO", simbolo: "♆", livello: 6 },
  { nome: "GIOVE", simbolo: "♃", livello: 4 },
  { nome: "SATURNO", simbolo: "♄", livello: 5 },
  { nome: "URANUS", simbolo: "♅", livello: 7, finale: true },
];

function livelloToOrbita(livello: number) {
  const entry = ORBITE_BASE.find((o) => o.livello === livello);
  return entry ?? ORBITE_BASE[0];
}
const ENABLE_BUTTON_PANEL = false;
const DEFAULT_BUTTON_ADJUST: ButtonAdjust = {
  groupX: 113,
  groupY: -10,
  firstX: 2,
  firstY: -2,
  secondX: 1,
  secondY: -5,
};
const buttonAdjustLabels: Record<keyof ButtonAdjust, string> = {
  groupX: "Gruppo pulsanti — X",
  groupY: "Gruppo pulsanti — Y",
  firstX: "Pulsante 1 — X",
  firstY: "Pulsante 1 — Y",
  secondX: "Pulsante 2 — X",
  secondY: "Pulsante 2 — Y",
};
const buttonAdjustRanges: Record<keyof ButtonAdjust, [number, number]> = {
  groupX: [-280, 280],
  groupY: [-160, 160],
  firstX: [-180, 180],
  firstY: [-120, 120],
  secondX: [-180, 180],
  secondY: [-120, 120],
};

function shortWallet(wallet: string) {
  if (!wallet) return "0x90c1...48d1";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export default function DashboardPage() {
  const [viewportWidth, setViewportWidth] = useState(0);
  const [buttonAdjust, setButtonAdjust] = useState<ButtonAdjust>(DEFAULT_BUTTON_ADJUST);
  const [buttonPanelOpen, setButtonPanelOpen] = useState(false);
  const [posData, setPosData] = useState<PosizioneResponse | null>(null);
  const [percorso, setPercorso] = useState<PercorsoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [doniPendenti, setDoniPendenti] = useState<DonoPendente[]>([]);
  const [messaggi, setMessaggi] = useState<Messaggio[]>([]);
  const [nonLetti, setNonLetti] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null);
  const [wallet] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const stored = localStorage.getItem("uranus_user");
      if (!stored) return "";
      const data = JSON.parse(stored) as StoredUser;
      return data.wallet ?? "";
    } catch {
      return "";
    }
  });

  const fetchPosizione = useCallback(async () => {
    if (!wallet) { setLoading(false); return; }
    try {
      const [posData, percorsoData] = await Promise.allSettled([
        uranusService.getPosizione(wallet),
        uranusService.getPercorso(wallet),
      ]);
      if (posData.status === 'fulfilled') setPosData(posData.value);
      if (percorsoData.status === 'fulfilled' && percorsoData.value?.percorso)
        setPercorso(percorsoData.value.percorso);
    } catch {
      // API not available — dashboard will show empty state
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { fetchPosizione(); }, [fetchPosizione]);

  // Fetch doni pendenti e messaggi
  useEffect(() => {
    if (!wallet) return;
    const fetchGifts = async () => {
      try {
        const [doniRes, msgRes] = await Promise.allSettled([
          apiUranusService.getDoniPendenti(wallet),
          apiUranusService.getMessaggi(wallet),
        ]);
        if (doniRes.status === 'fulfilled') setDoniPendenti(doniRes.value.doni || []);
        if (msgRes.status === 'fulfilled') {
          setMessaggi(msgRes.value.messaggi || []);
          setNonLetti(msgRes.value.nonLetti || 0);
        }
      } catch {}
    };
    fetchGifts();
    const interval = setInterval(fetchGifts, 30000); // Aggiorna ogni 30 sec
    return () => clearInterval(interval);
  }, [wallet]);

  const handleAccettaDono = async (donoId: number) => {
    if (!wallet || accepting) return;
    setAccepting(donoId);
    try {
      await apiUranusService.accettaDono(donoId, wallet);
      setDoniPendenti(prev => prev.filter(d => d.id !== donoId));
      // Refresh messaggi
      const msgRes = await apiUranusService.getMessaggi(wallet);
      setMessaggi(msgRes.messaggi || []);
      setNonLetti(msgRes.nonLetti || 0);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAccepting(null);
    }
  };

  // Derive active orbits and position cards from real data
  const livelloMassimo = posData?.posizioni?.length
    ? Math.max(...posData.posizioni.map((p) => p.livello))
    : -1;
  const orbite = ORBITE_BASE.map((o) => ({
    ...o,
    attiva: o.livello <= livelloMassimo,
  }));
  const prossimaStazione = ORBITE_BASE.find((o) => o.livello === livelloMassimo + 1);
  const posizioniAttive = (posData?.posizioni ?? []).map((p) => ({
    id: p.id,
    numero: p.numero_posizione != null ? `#${p.numero_posizione}` : `#${p.tavola_numero}`,
    luogo: livelloToOrbita(p.livello).nome,
    simbolo: livelloToOrbita(p.livello).simbolo,
  }));
  // Posizioni SECONDARIE (Gemello/Perpetuo dell'utente): etichetta generica, niente termini tecnici.
  const posizioniSecondarie = (posData?.posizioniSecondarie ?? []).map((p) => ({
    id: p.id,
    numero: p.numero_posizione != null ? `#${p.numero_posizione}` : `#${p.tavola_numero}`,
    luogo: livelloToOrbita(p.livello).nome,
    simbolo: livelloToOrbita(p.livello).simbolo,
  }));
  const spacing = {
    navbarTop: 10,
    contentTop: 80,
    titleOffset: 18,
    subtitleTop: 12,
    walletTop: 29,
    timelineTop: 32,
    orbitRowTop: 26,
    positionsTop: 31,
    positionCardsGap: 18,
    continueTop: 35,
    continueSubtitleTop: 16,
    buttonsTop: 32,
    finalTop: 91,
    finalSecondLineTop: 15,
  };
  const cardOffsets = {
    titleX: 184,
    titleY: -30,
    walletX: 155,
    walletY: 0,
    timelineX: 134,
    timelineY: 0,
    positionsX: 133,
    positionsY: 0,
    continueX: 253,
    continueY: 0,
    finalX: 120,
    finalY: 0,
  };
  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const offsetScale =
    viewportWidth >= 1600
      ? 1
      : viewportWidth >= 1440
      ? 0.72
      : viewportWidth >= 1280
      ? 0.55
      : viewportWidth >= 1100
      ? 0.35
      : viewportWidth >= 900
      ? 0.18
      : viewportWidth >= 768
      ? 0.08
      : 0;

  const responsiveOffsets = {
    titleX: Math.round(cardOffsets.titleX * offsetScale),
    titleY: Math.round(cardOffsets.titleY * offsetScale),
    walletX: Math.round(cardOffsets.walletX * offsetScale),
    walletY: Math.round(cardOffsets.walletY * offsetScale),
    timelineX: Math.round(cardOffsets.timelineX * offsetScale),
    timelineY: Math.round(cardOffsets.timelineY * offsetScale),
    positionsX: Math.round(cardOffsets.positionsX * offsetScale),
    positionsY: Math.round(cardOffsets.positionsY * offsetScale),
    continueX: Math.round(cardOffsets.continueX * offsetScale),
    continueY: Math.round(cardOffsets.continueY * offsetScale),
    finalX: Math.round(cardOffsets.finalX * offsetScale),
    finalY: Math.round(cardOffsets.finalY * offsetScale),
  };
  const copyButtonsJson = () => {
    navigator.clipboard.writeText(JSON.stringify(buttonAdjust, null, 2));
  };

  return (
    <section className="relative min-h-screen overflow-hidden bg-[#020711] p-1 sm:p-2">
      <div
        className="relative min-h-[calc(100vh-0.5rem)] sm:min-h-[calc(100vh-1rem)] overflow-hidden rounded-[34px] border border-uranus-cyan/45 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/register-bg.png')",
          boxShadow: "inset 0 0 70px rgba(34, 211, 238, 0.12), 0 0 35px rgba(34, 211, 238, 0.2)",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#030812]/40 via-[#030812]/55 to-[#030812]/85" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#030812]/60 via-transparent to-[#030812]/55" />
        <header
          className="absolute left-0 right-0 z-30"
          style={{ top: `${spacing.navbarTop}px` }}
        >
          <div
            className="flex w-full items-center justify-between gap-2 rounded-none px-3 py-2 sm:px-6 sm:py-3"
            style={{
              background: "rgba(2,20,38,0.55)",
              border: "1px solid rgba(34,211,238,0.24)",
              backdropFilter: "blur(10px)",
              boxShadow: "0 0 22px rgba(34,211,238,0.18)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Image
                src="/favicon.png"
                alt="ROG-URANUS"
                width={34}
                height={34}
                className="shrink-0 drop-shadow-[0_0_14px_rgba(34,211,238,0.7)]"
              />
              <span
                className="whitespace-nowrap text-sm font-bold leading-none tracking-[2px] text-white sm:text-base sm:tracking-[4px] md:text-lg"
                style={{ fontFamily: "var(--font-orbitron), sans-serif" }}
              >
                ROG-URANUS
              </span>
            </div>
            <Link
              href="/"
              className="shrink-0 flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[2px] text-white/75 backdrop-blur-md transition-all hover:border-uranus-cyan/50 hover:text-white sm:gap-3 sm:px-6 sm:py-3 sm:text-xs sm:tracking-[3px]"
            >
              <span className="text-2xl sm:text-3xl">🏠</span>
              <span>HOME</span>
            </Link>
          </div>
        </header>

        <div
          className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-12 sm:px-8"
          style={{ paddingTop: `${spacing.contentTop}px` }}
        >
          <div
            className="text-center"
            style={{
              marginTop: `${spacing.titleOffset}px`,
              transform: `translate(${responsiveOffsets.titleX}px, ${responsiveOffsets.titleY}px)`,
            }}
          >
            <h1 className="text-3xl md:text-5xl font-bold uppercase leading-tight tracking-[6px] text-white" style={{ fontFamily: "var(--font-orbitron), sans-serif" }}>
              BENVENUTO
              <br />
              NELL&apos;<span className="text-uranus-cyan">ECOSÌNOSTRA</span>
              <br />
              ROG-URANUS
            </h1>
            <p className="text-sm text-white/45" style={{ marginTop: `${spacing.subtitleTop}px` }}>
              Ogni dono alimenta il movimento. Ogni membro genera cambiamento.
            </p>
          </div>

          <div
            className="flex w-full justify-center"
            style={{
              marginTop: `${spacing.walletTop}px`,
              transform: `translate(${responsiveOffsets.walletX}px, ${responsiveOffsets.walletY}px)`,
            }}
          >
            <div
              className="w-full max-w-2xl rounded-2xl border px-6 py-4 text-center"
              style={{ background: "rgba(8,18,40,0.45)", borderColor: "rgba(34,211,238,0.18)" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[3px] text-uranus-teal">WALLET CONNESSO</p>
              <div className="mt-2 flex items-center justify-center gap-2">
                <p className="text-xl font-mono text-white">{shortWallet(wallet)}</p>
                <button
                  onClick={() => wallet && navigator.clipboard.writeText(wallet)}
                  className="text-white/35 transition-colors hover:text-uranus-cyan"
                  title="Copia indirizzo"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                </button>
              </div>
              <p className="mt-1 text-[10px] text-white/25">Rete Polygon</p>
            </div>
          </div>
          <div
            className="flex w-full justify-center"
            style={{
              marginTop: `${spacing.timelineTop}px`,
              transform: `translate(${responsiveOffsets.timelineX}px, ${responsiveOffsets.timelineY}px)`,
            }}
          >
            <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-uranus-cyan/15 bg-[#07152b]/55 backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-uranus-cyan/10 px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-[4px] text-white">POSIZIONE ATTUALE</p>
                <p className="text-[10px] font-bold uppercase tracking-[3px] text-white/50">
                  PROSSIMA STAZIONE: <span className="text-uranus-cyan">{prossimaStazione?.nome ?? "URANUS"}</span>
                </p>
              </div>
              <div className="px-3 pb-5 md:px-5" style={{ paddingTop: `${spacing.orbitRowTop}px` }}>
              <div className="grid grid-cols-4 gap-y-4">
                  {orbite.map((orbita, index) => (
                    <div key={orbita.nome} className="relative flex flex-col items-center gap-2">
                      {index > 0 && (
                        <span
                          className="absolute -left-1/2 top-5 hidden h-px w-full md:block"
                          style={{ background: orbita.attiva ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.2)" }}
                        />
                      )}
                      <span
                        className={`z-10 flex h-10 w-10 items-center justify-center rounded-full border text-sm ${
                          orbita.attiva
                            ? "border-uranus-cyan/45 bg-uranus-cyan/10 text-uranus-cyan"
                            : orbita.finale
                            ? "border-white/35 bg-white/10 text-white/80"
                            : "border-white/15 bg-white/5 text-white/35"
                        }`}
                      >
                        {orbita.simbolo}
                      </span>
                      <p className={`text-[10px] font-bold uppercase tracking-[1.6px] ${orbita.attiva ? "text-uranus-cyan" : "text-white/45"}`}>
                        {orbita.nome}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div
            className="flex w-full justify-center"
            style={{
              marginTop: `${spacing.positionsTop}px`,
              transform: `translate(${responsiveOffsets.positionsX}px, ${responsiveOffsets.positionsY}px)`,
            }}
          >
            <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-uranus-cyan/12 bg-[#07152b]/45 backdrop-blur-md">
              <div className="border-b border-uranus-cyan/10 py-5 text-center">
                <p className="text-xl font-bold uppercase tracking-[4px] text-white">LE TUE POSIZIONI</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[3px] text-white/35">
                {loading ? "CARICAMENTO..." : `POSIZIONI ATTIVE · ${posizioniAttive.length}`}
              </p>
              </div>
              <div className="grid grid-cols-1 p-5 md:grid-cols-2 xl:grid-cols-4" style={{ gap: `${spacing.positionCardsGap}px` }}>
                {posizioniAttive.map((posizione) => (
                  <div
                    key={`${posizione.id}-${posizione.luogo}`}
                    className="rounded-xl border border-uranus-cyan/15 bg-[#041129]/55 px-6 py-5 text-center"
                  >
                    <p className="text-4xl font-bold text-uranus-cyan">{posizione.numero}</p>
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[2px] text-white/40">SI TROVA IN</p>
                    <p className="mt-1 text-sm font-bold uppercase tracking-[3px] text-white/80">
                      {posizione.simbolo} {posizione.luogo}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ✨ POSIZIONI SECONDARIE (Gemello/Perpetuo) — etichetta generica per non confondere */}
          {posizioniSecondarie.length > 0 && (
            <div
              className="flex w-full justify-center"
              style={{ marginTop: `${spacing.positionsTop}px`, transform: `translate(${responsiveOffsets.positionsX}px, ${responsiveOffsets.positionsY}px)` }}
            >
              <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-uranus-cyan/12 bg-[#07152b]/45 backdrop-blur-md">
                <div className="border-b border-uranus-cyan/10 py-5 text-center">
                  <p className="text-xl font-bold uppercase tracking-[4px] text-white">POSIZIONI SECONDARIE</p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[3px] text-white/35">
                    ATTIVE · {posizioniSecondarie.length}
                  </p>
                </div>
                <div className="grid grid-cols-1 p-5 md:grid-cols-2 xl:grid-cols-4" style={{ gap: `${spacing.positionCardsGap}px` }}>
                  {posizioniSecondarie.map((posizione) => (
                    <div
                      key={`sec-${posizione.id}`}
                      className="rounded-xl border border-uranus-cyan/15 bg-[#041129]/55 px-6 py-5 text-center"
                    >
                      <p className="text-4xl font-bold text-uranus-cyan">{posizione.numero}</p>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-[2px] text-white/40">POSIZIONE SECONDARIA</p>
                      <p className="mt-1 text-sm font-bold uppercase tracking-[3px] text-white/80">
                        {posizione.simbolo} {posizione.luogo}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 🔭 PANNELLO PREVISIONE PERCORSO */}
          <div
            className="flex w-full justify-center"
            style={{ marginTop: `${spacing.positionsTop}px`, transform: `translate(${responsiveOffsets.positionsX}px, ${responsiveOffsets.positionsY}px)` }}
          >
            <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-uranus-cyan/15 bg-[#07152b]/50 backdrop-blur-md">
              <div className="border-b border-uranus-cyan/10 px-5 py-4 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[4px] text-white">🔭 PREVISIONE PERCORSO</p>
                <p className="text-[10px] text-white/35 uppercase tracking-[2px]">
                  {percorso ? new Date(percorso.aggiornato).toLocaleTimeString('it-IT') : loading ? 'CARICAMENTO...' : ''}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-0 md:grid-cols-3 lg:grid-cols-5">

                {/* SOLE — Entrata */}
                <div className="border-b border-uranus-cyan/8 p-5 md:border-b-0 md:border-r">
                  <p className="text-[10px] font-bold uppercase tracking-[3px] text-yellow-400">☀️ SOLE</p>
                  <p className="mt-1 text-[9px] text-white/30">Entrata</p>
                  {percorso?.sole?.tavole?.length ? percorso.sole.tavole.map((t) => (
                    <div key={t.tavolaNumero} className="mt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white/60">Tavola #{t.tavolaNumero}</span>
                        <span className="text-xs font-bold text-uranus-cyan">{t.percCompletamento}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-yellow-300 transition-all"
                          style={{ width: `${t.percCompletamento}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-white/45">{t.messaggio}</p>
                      {t.isErede && (
                        <p className="mt-1 text-[10px] font-bold text-yellow-400/80">★ Sei l&apos;erede</p>
                      )}
                    </div>
                  )) : (
                    <p className="mt-3 text-[11px] text-white/30">
                      {percorso ? 'Nessuna tavola Sole aperta' : loading ? 'Caricamento...' : 'In attesa'}
                    </p>
                  )}
                </div>

                {/* VENERE */}
                <div className="border-b border-uranus-cyan/8 p-5 md:border-b-0 md:border-r">
                  <p className="text-[10px] font-bold uppercase tracking-[3px] text-green-400">♀ VENERE</p>
                  <p className="mt-1 text-[9px] text-white/30">Dono</p>
                  {percorso?.blocco1?.turnoPrevisto ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between rounded-lg bg-white/4 px-3 py-2">
                        <span className="text-[10px] text-white/50">Turno</span>
                        <span className="text-sm font-bold text-green-400">#{percorso.blocco1.turnoPrevisto}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-green-400/5 px-3 py-2">
                        <span className="text-[10px] text-white/50">Doni che riceverai</span>
                        <span className="text-sm font-bold text-green-400">480 USDC</span>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] text-white/30">
                      {percorso ? percorso.blocco1?.messaggio || 'In attesa' : loading ? 'Caricamento...' : 'In attesa'}
                    </p>
                  )}
                </div>

                {/* NETTUNO */}
                <div className="border-b border-uranus-cyan/8 p-5 md:border-b-0 md:border-r">
                  <p className="text-[10px] font-bold uppercase tracking-[3px] text-blue-400">🌊 NETTUNO</p>
                  <p className="mt-1 text-[9px] text-white/30">In attesa</p>
                  {percorso?.nettuno?.inCoda?.length ? (
                    <div className="mt-3 space-y-3">
                      {percorso.nettuno.inCoda.slice(0, 2).map((slot, i) => (
                        <div key={`${slot.posizione}-${i}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-white/50">Pos. #{slot.posizione}</span>
                            <span className={`text-xs font-bold ${slot.puoUscire ? 'text-green-400' : 'text-blue-300'}`}>
                              {slot.percCompletamento}%
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                            <div
                              className={`h-full rounded-full transition-all ${
                                slot.puoUscire
                                  ? 'bg-gradient-to-r from-green-400 to-emerald-300'
                                  : 'bg-gradient-to-r from-blue-500 to-cyan-400'
                              }`}
                              style={{ width: `${slot.percCompletamento}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] text-white/30">
                      {percorso ? 'In attesa' : loading ? 'Caricamento...' : 'In attesa'}
                    </p>
                  )}
                </div>

                {/* GIOVE */}
                <div className="border-b border-uranus-cyan/8 p-5 md:border-b-0 md:border-r">
                  <p className="text-[10px] font-bold uppercase tracking-[3px] text-orange-400">♃ GIOVE</p>
                  <p className="mt-1 text-[9px] text-white/30">In attesa</p>
                  <p className="mt-3 text-[11px] text-white/30">Prossima tappa dopo Nettuno</p>
                </div>

                {/* SATURNO → URANUS */}
                <div className="p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[3px] text-amber-400">♄ SATURNO → URANUS</p>
                  <p className="mt-1 text-[9px] text-white/30">Uscita definitiva</p>
                  <p className="mt-3 text-[11px] text-white/30">Ultima stazione del percorso</p>
                </div>

              </div>
            </div>
          </div>

          <div
            className="rounded-2xl border border-uranus-cyan/12 bg-[#07152b]/45 px-6 py-8 text-center backdrop-blur-md"
            style={{
              marginTop: `${spacing.continueTop}px`,
              width: "min(92vw, 760px)",
              marginInline: "auto",
            }}
          >
            <h3 className="text-sm font-bold uppercase tracking-[6px] text-white">CONTINUA IL MOVIMENTO</h3>
            <p className="text-sm text-white/45" style={{ marginTop: `${spacing.continueSubtitleTop}px` }}>
              Ogni dono è un passo verso un futuro migliore.
            </p>

            <div
              className="mx-auto flex w-full flex-col items-center gap-4"
              style={{
                marginTop: `${spacing.buttonsTop}px`,
                maxWidth: "560px",
                transform: `translate(${buttonAdjust.groupX}px, ${buttonAdjust.groupY}px)`,
              }}
            >
              <div className="w-full" style={{ transform: `translate(${buttonAdjust.firstX}px, ${buttonAdjust.firstY}px)` }}>
                <Link
                  href="/register"
                  className="relative flex h-14 w-full items-center justify-center rounded-full text-sm font-bold uppercase tracking-[3px] text-white transition-all hover:scale-[1.02]"
                  style={{
                    background: "linear-gradient(135deg, #22d3ee, #06b6d4, #06d6a0)",
                    boxShadow: "0 0 30px rgba(34,211,238,0.35), 0 8px 30px rgba(0,0,0,0.3)",
                  }}
                >
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">RIFAI UN DONO IN ROG-URANUS</span>
                  <span className="pointer-events-none absolute right-6 text-lg">›</span>
                </Link>
              </div>
              <div className="w-full" style={{ transform: `translate(${buttonAdjust.secondX}px, ${buttonAdjust.secondY}px)` }}>
                <Link
                  href="https://revolutionofgiving.eth.limo/donation.html"
                  className="relative flex h-14 w-full items-center justify-center rounded-full text-sm font-bold uppercase tracking-[3px] text-white transition-all hover:scale-[1.02]"
                  style={{
                    background: "linear-gradient(135deg, #ff00aa, #ff3b00)",
                    boxShadow: "0 0 24px rgba(255,0,170,0.25), 0 8px 24px rgba(0,0,0,0.25)",
                  }}
                >
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">RIFAI UN DONO IN ROG</span>
                  <span className="pointer-events-none absolute right-6 text-lg">›</span>
                </Link>
              </div>

              {/* 🎁 ACCETTA DONO — sempre visibile, cliccabile solo se dono pronto */}
              <div className="w-full mt-6">
                {doniPendenti.length > 0 ? (
                  <div className="space-y-3">
                    {doniPendenti.map((dono) => {
                      const giorniRim = Math.max(0, Math.floor(Number(dono.giorni_rimanenti)));
                      const livelloNomi: Record<number, string> = { 3: 'Venere', 4: 'Giove', 5: 'Saturno', 6: 'Nettuno' };
                      return (
                        <button
                          key={dono.id}
                          onClick={() => handleAccettaDono(dono.id)}
                          disabled={accepting === dono.id}
                          className="relative flex h-14 w-full items-center justify-center rounded-full text-sm font-bold uppercase tracking-[3px] text-white transition-all hover:scale-[1.02] disabled:opacity-50"
                          style={{
                            background: 'linear-gradient(135deg, #22d3ee, #06d6a0)',
                            boxShadow: '0 0 30px rgba(34,211,238,0.4), 0 0 60px rgba(6,214,160,0.2)',
                            animation: 'pulseGlow 2s ease-in-out infinite',
                          }}
                        >
                          <span className="pointer-events-none">
                            {accepting === dono.id ? 'ACCETTANDO...' : `🎁 ACCETTA DONO — ${Number(dono.importo).toFixed(0)} USDC da ${livelloNomi[dono.livello] || 'Sistema'}`}
                          </span>
                          <span className="pointer-events-none absolute right-5 text-[10px] text-white/60">{giorniRim}gg</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    disabled
                    className="relative flex h-14 w-full items-center justify-center rounded-full text-sm font-bold uppercase tracking-[3px] transition-all cursor-not-allowed"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.25)',
                    }}
                  >
                    <span className="pointer-events-none">🎁 ACCETTA DONO</span>
                    <span className="pointer-events-none absolute right-5 text-[10px] text-white/15">nessun dono pronto</span>
                  </button>
                )}
              </div>

            </div>
          </div>

          <div
            className="flex w-full justify-center"
            style={{
              marginTop: `${spacing.finalTop}px`,
              transform: `translate(${responsiveOffsets.finalX}px, ${responsiveOffsets.finalY}px)`,
            }}
          >
            <div className="w-full max-w-5xl rounded-2xl border border-uranus-cyan/10 bg-[#07152b]/40 px-6 py-10 text-center backdrop-blur-md">
              <p className="text-4xl font-bold text-white">Ogni dono genera movimento.</p>
              <p className="text-4xl font-bold text-uranus-cyan" style={{ marginTop: `${spacing.finalSecondLineTop}px` }}>
                Ogni movimento genera cambiamento.
              </p>
            </div>
          </div>
        </div>

        {/* 💬 CHAT BOTTONE */}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="absolute bottom-6 left-6 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-uranus-cyan/70 bg-black/30 text-uranus-cyan backdrop-blur-md transition-all hover:scale-110"
          style={{ boxShadow: nonLetti > 0 ? '0 0 20px rgba(34,211,238,0.5)' : 'none' }}
        >
          <span className="text-xl">💬</span>
          {nonLetti > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{nonLetti}</span>
          )}
        </button>

        {/* 💬 CHAT PANNELLO */}
        {chatOpen && (
          <div className="absolute bottom-20 left-6 z-30 w-80 max-h-96 overflow-hidden rounded-2xl border border-uranus-cyan/20 bg-[#07152b]/95 backdrop-blur-md" style={{ boxShadow: '0 0 30px rgba(0,0,0,0.5)' }}>
            <div className="flex items-center justify-between border-b border-uranus-cyan/10 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[3px] text-white">💬 MESSAGGI</p>
              <button onClick={() => setChatOpen(false)} className="text-white/40 hover:text-white text-lg">✕</button>
            </div>
            <div className="max-h-72 overflow-y-auto p-3 space-y-2" style={{ scrollbarWidth: 'thin' }}>
              {messaggi.length === 0 ? (
                <p className="text-center text-[11px] text-white/30 py-4">Nessun messaggio</p>
              ) : messaggi.map((msg) => (
                <div key={msg.id} className={`rounded-lg px-3 py-2 ${msg.read ? 'bg-white/3' : 'bg-uranus-cyan/8 border border-uranus-cyan/15'}`}>
                  <p className="text-[10px] font-bold text-uranus-cyan">{msg.subject}</p>
                  <p className="mt-1 text-[11px] text-white/70">{msg.content}</p>
                  <p className="mt-1 text-[9px] text-white/25">{new Date(msg.created_at).toLocaleString('it-IT')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="absolute bottom-6 right-6 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-uranus-cyan/70 bg-black/30 text-uranus-cyan backdrop-blur-md">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25L12 4.5v15l-5.25-3.75H3.75A1.5 1.5 0 012.25 14.25v-4.5a1.5 1.5 0 011.5-1.5h3z" />
          </svg>
        </div>
        {ENABLE_BUTTON_PANEL ? (
          buttonPanelOpen ? (
          <div
            className="fixed right-4 top-4 bottom-4 z-[120] w-[320px] rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(8,12,28,0.96)",
              backdropFilter: "blur(18px)",
              border: "1px solid rgba(34,211,238,0.2)",
              boxShadow: "0 0 40px rgba(0,0,0,0.55)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <span className="text-sm font-bold tracking-[2px] text-white">🎛️ PULSANTI</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setButtonAdjust(DEFAULT_BUTTON_ADJUST)}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-white/20 text-white/70 hover:text-white hover:border-white/35 transition-all"
                >
                  Reset
                </button>
                <button
                  onClick={copyButtonsJson}
                  className="text-[10px] px-2.5 py-1 rounded-full bg-uranus-cyan/10 border border-uranus-cyan/30 text-uranus-cyan hover:bg-uranus-cyan/20 transition-all"
                >
                  📋 Copia
                </button>
                <button
                  onClick={() => setButtonPanelOpen(false)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: "thin" }}>
              {(Object.keys(buttonAdjustLabels) as (keyof ButtonAdjust)[]).map((key) => {
                const [min, max] = buttonAdjustRanges[key];
                const value = buttonAdjust[key];
                const percent = ((value - min) / (max - min)) * 100;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-white/55 font-medium">{buttonAdjustLabels[key]}</label>
                      <span className="text-[11px] font-bold text-uranus-cyan min-w-[46px] text-right">{value}px</span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={value}
                      onChange={(e) => setButtonAdjust((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #22d3ee ${percent}%, rgba(255,255,255,0.08) ${percent}%)`,
                        accentColor: "#22d3ee",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-2 border-t border-white/10">
              <p className="text-[9px] text-white/30 text-center">Muovi gruppo/pulsanti e copia i valori JSON.</p>
            </div>
          </div>
          ) : (
          <button
            onClick={() => setButtonPanelOpen(true)}
            className="fixed bottom-4 right-4 z-[120] w-12 h-12 rounded-full flex items-center justify-center text-white text-lg"
            style={{
              background: "linear-gradient(135deg, #7c3aed, #22d3ee)",
              boxShadow: "0 0 20px rgba(124,58,237,0.42)",
            }}
            title="Apri pannello pulsanti"
          >
            🎛️
          </button>
          )
        ) : null}

      </div>
    </section>
  );
}
