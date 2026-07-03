"use client";
import Image from "next/image";

interface Props {
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
}

export default function PopupNotCommunity({ loading, onClose, onRetry }: Props) {

  return (
    <>
      <style>{`
        @keyframes ncStarBlink {
          0%,100%{opacity:.12}
          50%{opacity:.88}
        }
        @keyframes ncEntrance {
          from{opacity:0;transform:scale(.93) translateY(14px)}
          to{opacity:1;transform:scale(1) translateY(0)}
        }
        @keyframes ncBreathe {
          0%,100%{box-shadow:0 0 28px rgba(61,143,255,.38),0 0 65px rgba(157,76,255,.22),0 0 110px rgba(61,143,255,.12),inset 0 1px 0 rgba(255,255,255,.09),0 50px 90px rgba(0,0,0,.72)}
          50%{box-shadow:0 0 46px rgba(61,143,255,.6),0 0 100px rgba(157,76,255,.38),0 0 170px rgba(61,143,255,.2),inset 0 1px 0 rgba(255,255,255,.14),0 50px 90px rgba(0,0,0,.72)}
        }
        @keyframes ncOrbit1 {
          from{transform:rotate(0deg) translateX(60px) rotate(0deg)}
          to{transform:rotate(360deg) translateX(60px) rotate(-360deg)}
        }
        @keyframes ncOrbit2 {
          from{transform:rotate(120deg) translateX(48px) rotate(-120deg)}
          to{transform:rotate(480deg) translateX(48px) rotate(-480deg)}
        }
        @keyframes ncOrbit3 {
          from{transform:rotate(240deg) translateX(54px) rotate(-240deg)}
          to{transform:rotate(600deg) translateX(54px) rotate(-600deg)}
        }
        @keyframes ncHudPulse {
          0%,100%{opacity:.28}
          50%{opacity:.65}
        }
        @keyframes ncBtnPulse {
          0%,100%{opacity:1}
          50%{opacity:.93}
        }
        @keyframes ncHexGlow {
          0%,100%{filter:drop-shadow(0 0 8px rgba(255,68,68,.7))}
          50%{filter:drop-shadow(0 0 16px rgba(255,68,68,1))}
        }
        .nc-btn1:hover{
          box-shadow:0 0 38px rgba(157,76,255,.6),0 0 90px rgba(157,76,255,.28),inset 0 1px 0 rgba(255,255,255,.12) !important;
          transform:scale(1.02);
        }
        .nc-btn2:hover{
          box-shadow:0 0 38px rgba(16,185,129,.55),0 0 90px rgba(16,185,129,.22),inset 0 1px 0 rgba(255,255,255,.12) !important;
          transform:scale(1.02);
        }
        .nc-btn3:hover{
          box-shadow:0 0 32px rgba(61,143,255,.56),0 0 80px rgba(61,143,255,.22),inset 0 1px 0 rgba(255,255,255,.1) !important;
          transform:scale(1.02);
        }
      `}</style>

      {/* ══ FULLSCREEN OVERLAY ══ */}
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden"
      >
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat pointer-events-none"
          style={{ backgroundImage: "url('/sfondocommunity1.png')" }}
        />
        {/* Dark overlay for readability */}
        <div className="absolute inset-0 bg-[#020611]/65 pointer-events-none" />

        {/* ══ MODAL ══ */}
        <div
          className="relative w-[min(700px,96vw)] max-h-[96vh] overflow-y-auto"
          style={{
            animation: "ncEntrance .42s cubic-bezier(.22,1,.36,1) forwards, ncBreathe 4.5s ease-in-out .42s infinite",
            background: "rgba(3,7,26,.78)",
            backdropFilter: "blur(34px) saturate(210%)",
            WebkitBackdropFilter: "blur(34px) saturate(210%)",
            borderRadius: "22px",
            border: "1px solid rgba(61,143,255,.45)",
            scrollbarWidth: "none",
          }}
        >
          {/* Corner HUD — top-left */}
          <div className="absolute top-0 left-0 pointer-events-none" style={{ opacity: .65 }}>
            <div style={{ position:"absolute", top:10, left:10, width:30, height:2, background:"linear-gradient(90deg,#3d8fff,transparent)" }} />
            <div style={{ position:"absolute", top:10, left:10, width:2, height:30, background:"linear-gradient(180deg,#3d8fff,transparent)" }} />
          </div>
          {/* Corner HUD — top-right */}
          <div className="absolute top-0 right-16 pointer-events-none" style={{ opacity: .65 }}>
            <div style={{ position:"absolute", top:10, right:0, width:30, height:2, background:"linear-gradient(270deg,#9d4cff,transparent)" }} />
            <div style={{ position:"absolute", top:10, right:0, width:2, height:30, background:"linear-gradient(180deg,#9d4cff,transparent)" }} />
          </div>
          {/* Corner HUD — bottom-left */}
          <div className="absolute bottom-0 left-0 pointer-events-none" style={{ opacity: .65 }}>
            <div style={{ position:"absolute", bottom:10, left:10, width:30, height:2, background:"linear-gradient(90deg,#3d8fff,transparent)" }} />
            <div style={{ position:"absolute", bottom:10, left:10, width:2, height:30, background:"linear-gradient(0deg,#3d8fff,transparent)" }} />
          </div>
          {/* Corner HUD — bottom-right */}
          <div className="absolute bottom-0 right-0 pointer-events-none" style={{ opacity: .65 }}>
            <div style={{ position:"absolute", bottom:10, right:10, width:30, height:2, background:"linear-gradient(270deg,#9d4cff,transparent)" }} />
            <div style={{ position:"absolute", bottom:10, right:10, width:2, height:30, background:"linear-gradient(0deg,#9d4cff,transparent)" }} />
          </div>

          {/* HUD top line */}
          <div className="absolute left-0 right-0 pointer-events-none" style={{ top:72, height:1, background:"linear-gradient(90deg,transparent,rgba(61,143,255,.18),rgba(61,143,255,.42),rgba(61,143,255,.18),transparent)", animation:"ncHudPulse 3.2s ease-in-out infinite" }} />
          {/* HUD bottom line */}
          <div className="absolute left-0 right-0 pointer-events-none" style={{ bottom:72, height:1, background:"linear-gradient(90deg,transparent,rgba(157,76,255,.18),rgba(157,76,255,.35),rgba(157,76,255,.18),transparent)", animation:"ncHudPulse 3.8s ease-in-out .6s infinite" }} />

          {/* ── CONTENT ── */}
          <div className="flex flex-col items-center px-8 sm:px-12 py-10 gap-6">

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 flex items-center justify-center transition-all duration-200 hover:scale-110 hover:brightness-125"
              style={{
                width:54, height:54, borderRadius:"50%",
                border:"2px solid rgba(61,143,255,.72)",
                background:"rgba(8,18,50,.65)",
                backdropFilter:"blur(10px)",
                boxShadow:"0 0 16px rgba(61,143,255,.35)",
                color:"#c8e0ff", fontSize:18, fontWeight:700,
              }}
            >
              ✕
            </button>

            {/* Logo + orbit particles */}
            <div className="relative flex items-center justify-center" style={{ width:120, height:120 }}>
              {/* Outer ring */}
              <div className="absolute" style={{ width:116, height:116, borderRadius:"50%", border:"1px dashed rgba(61,143,255,.22)" }} />
              {/* Inner ring */}
              <div className="absolute" style={{ width:92, height:92, borderRadius:"50%", border:"1px solid rgba(157,76,255,.14)" }} />
              {/* Orbit particle 1 — blue */}
              <div className="absolute" style={{ width:10, height:10, animation:"ncOrbit1 6s linear infinite" }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:"#3d8fff", boxShadow:"0 0 10px #3d8fff,0 0 20px rgba(61,143,255,.55)", marginLeft:-4, marginTop:-4 }} />
              </div>
              {/* Orbit particle 2 — purple */}
              <div className="absolute" style={{ width:8, height:8, animation:"ncOrbit2 9s linear infinite" }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:"#9d4cff", boxShadow:"0 0 9px #9d4cff,0 0 18px rgba(157,76,255,.5)", marginLeft:-3.5, marginTop:-3.5 }} />
              </div>
              {/* Orbit particle 3 — cyan */}
              <div className="absolute" style={{ width:7, height:7, animation:"ncOrbit3 5.5s linear infinite" }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:"#22d3ee", boxShadow:"0 0 7px #22d3ee,0 0 14px rgba(34,211,238,.5)", marginLeft:-2.5, marginTop:-2.5 }} />
              </div>
              {/* Small static glow dots */}
              <div className="absolute" style={{ width:4, height:4, borderRadius:"50%", background:"rgba(61,143,255,.6)", top:4, left:28, boxShadow:"0 0 6px rgba(61,143,255,.8)" }} />
              <div className="absolute" style={{ width:3, height:3, borderRadius:"50%", background:"rgba(157,76,255,.6)", bottom:6, right:22, boxShadow:"0 0 5px rgba(157,76,255,.8)" }} />
              <Image
                src="/logo-uranus.png"
                alt="ROG-URANUS"
                width={90}
                height={90}
                className="relative z-10"
                style={{ filter:"drop-shadow(0 0 14px rgba(34,211,238,.95)) drop-shadow(0 0 32px rgba(34,211,238,.5))" }}
              />
            </div>

            {/* Hexagon warning + energy lines */}
            <div className="relative flex items-center w-full justify-center">
              {/* Left energy line */}
              <div style={{ flex:1, height:2, background:"linear-gradient(90deg,transparent,rgba(255,68,68,.85))", boxShadow:"0 0 8px rgba(255,68,68,.5)" }} />
              {/* Hexagon */}
              <div className="relative mx-5" style={{ animation:"ncHexGlow 2.5s ease-in-out infinite" }}>
                <svg width="82" height="95" viewBox="0 0 82 95">
                  <polygon
                    points="41,4 78,23.5 78,71.5 41,91 4,71.5 4,23.5"
                    fill="rgba(255,40,40,.07)"
                    stroke="#ff4444"
                    strokeWidth="2"
                  />
                  {/* Inner hex decoration */}
                  <polygon
                    points="41,14 68,29 68,66 41,81 14,66 14,29"
                    fill="none"
                    stroke="rgba(255,68,68,.25)"
                    strokeWidth="1"
                  />
                </svg>
                {/* Warning icon inside hex */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3L22 20H2L12 3Z" fill="rgba(255,68,68,.12)" stroke="#ff4444" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M12 9v5" stroke="#ff6060" strokeWidth="2.2" strokeLinecap="round" />
                    <circle cx="12" cy="17.5" r="1.1" fill="#ff6060" />
                  </svg>
                </div>
              </div>
              {/* Right energy line */}
              <div style={{ flex:1, height:2, background:"linear-gradient(270deg,transparent,rgba(255,68,68,.85))", boxShadow:"0 0 8px rgba(255,68,68,.5)" }} />
            </div>

            {/* ACCESSO NEGATO */}
            <h2 className="text-center" style={{
              fontFamily:"var(--font-orbitron), 'Orbitron', sans-serif",
              fontWeight:900,
              fontSize:"clamp(24px, 5.5vw, 52px)",
              letterSpacing:"10px",
              color:"#ff6363",
              textShadow:"0 0 18px rgba(255,99,99,.95),0 0 45px rgba(255,99,99,.55),0 0 90px rgba(255,50,50,.25)",
              textTransform:"uppercase",
              lineHeight:1,
            }}>
              ACCESSO NEGATO
            </h2>

            {/* HUD divider */}
            <div style={{ width:"100%", height:1, background:"linear-gradient(90deg,transparent,rgba(61,143,255,.28),rgba(61,143,255,.52),rgba(61,143,255,.28),transparent)", animation:"ncHudPulse 3s ease-in-out infinite" }} />

            {/* Description */}
            <p className="text-center text-white" style={{
              fontFamily:"Inter, sans-serif",
              fontWeight:600,
              fontSize:"clamp(12px, 2vw, 20px)",
              lineHeight:1.85,
              maxWidth:"82%",
            }}>
              PER POTER EFFETTUARE UNA DONAZIONE DEVI PRIMA ISCRIVERTI ALLA COMMUNITY
              ED EFFETTUARE UNA DONAZIONE IN ROG SMALL DI ALMENO 2 USDC
            </p>

            {/* ── PASSO 1 ── */}
            <div className="w-full flex flex-col gap-2">
              <p style={{
                fontFamily:"var(--font-orbitron), 'Orbitron', sans-serif",
                fontWeight:500,
                fontSize:"clamp(8px, 1.1vw, 12px)",
                letterSpacing:"6px",
                color:"#5f7dff",
                textTransform:"uppercase",
              }}>
                PASSO 1 — ISCRIVITI ALLA COMMUNITY
              </p>
              <a
                href="https://revolutionofgiving.eth.limo"
                target="_blank"
                rel="noopener noreferrer"
                className="nc-btn1 w-full flex items-center gap-4"
                style={{
                  height:"clamp(68px, 9vw, 96px)",
                  padding:"0 clamp(16px, 3vw, 28px)",
                  borderRadius:14,
                  border:"1.5px solid rgba(157,76,255,.6)",
                  background:"rgba(38,8,78,.52)",
                  backdropFilter:"blur(14px)",
                  boxShadow:"0 0 22px rgba(157,76,255,.32),0 0 56px rgba(157,76,255,.12),inset 0 1px 0 rgba(255,255,255,.07)",
                  animation:"ncBtnPulse 3.2s ease-in-out infinite",
                  textDecoration:"none",
                  transition:"all .25s ease",
                }}
              >
                <svg className="shrink-0" width="22" height="22" fill="none" stroke="white" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                <span style={{
                  fontFamily:"var(--font-orbitron), 'Orbitron', sans-serif",
                  fontWeight:600,
                  letterSpacing:"clamp(2px, .4vw, 5px)",
                  fontSize:"clamp(10px, 1.7vw, 20px)",
                  color:"#d2a5ff",
                  textTransform:"uppercase",
                }}>
                  VAI A ROG → REGISTRATI ALLA COMMUNITY
                </span>
              </a>
            </div>

            {/* ── PASSO 2 ── */}
            <div className="w-full flex flex-col gap-2">
              <p style={{
                fontFamily:"var(--font-orbitron), 'Orbitron', sans-serif",
                fontWeight:500,
                fontSize:"clamp(8px, 1.1vw, 12px)",
                letterSpacing:"6px",
                color:"#5f7dff",
                textTransform:"uppercase",
              }}>
                PASSO 2 — DONA IN ROG SMALL (MIN. 2 USDC)
              </p>
              <a
                href="https://revolutionofgiving.eth.limo/donation.html"
                target="_blank"
                rel="noopener noreferrer"
                className="nc-btn2 w-full flex items-center gap-4"
                style={{
                  height:"clamp(68px, 9vw, 96px)",
                  padding:"0 clamp(16px, 3vw, 28px)",
                  borderRadius:14,
                  border:"1.5px solid rgba(16,185,129,.58)",
                  background:"rgba(4,28,18,.55)",
                  backdropFilter:"blur(14px)",
                  boxShadow:"0 0 22px rgba(16,185,129,.28),0 0 56px rgba(16,185,129,.1),inset 0 1px 0 rgba(255,255,255,.07)",
                  animation:"ncBtnPulse 3.7s ease-in-out .5s infinite",
                  textDecoration:"none",
                  transition:"all .25s ease",
                }}
              >
                <svg className="shrink-0" width="22" height="22" fill="none" stroke="#9cffc4" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                <span style={{
                  fontFamily:"var(--font-orbitron), 'Orbitron', sans-serif",
                  fontWeight:600,
                  letterSpacing:"clamp(2px, .4vw, 5px)",
                  fontSize:"clamp(12px, 2vw, 24px)",
                  color:"#9cffc4",
                  textTransform:"uppercase",
                }}>
                  DONA IN ROG SMALL
                </span>
              </a>
            </div>

            {/* HUD divider */}
            <div style={{ width:"100%", height:1, background:"linear-gradient(90deg,transparent,rgba(61,143,255,.22),rgba(61,143,255,.42),rgba(61,143,255,.22),transparent)" }} />

            {/* ── RETRY BUTTON ── */}
            <button
              onClick={onRetry}
              disabled={loading}
              className="nc-btn3 w-full flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                height:"clamp(60px, 8vw, 80px)",
                borderRadius:14,
                border:"1.5px solid rgba(61,143,255,.55)",
                background:"rgba(4,12,38,.52)",
                backdropFilter:"blur(14px)",
                boxShadow:"0 0 18px rgba(61,143,255,.22),0 0 45px rgba(61,143,255,.09),inset 0 1px 0 rgba(255,255,255,.06)",
                cursor: loading ? "not-allowed" : "pointer",
                transition:"all .25s ease",
              }}
            >
              <svg width="22" height="22" fill="none" stroke="#49a6ff" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span style={{
                fontFamily:"var(--font-orbitron), 'Orbitron', sans-serif",
                fontWeight:600,
                letterSpacing:"clamp(2px, .35vw, 4px)",
                fontSize:"clamp(9px, 1.5vw, 18px)",
                color:"#49a6ff",
                textTransform:"uppercase",
              }}>
                {loading ? "VERIFICA IN CORSO..." : "HO COMPLETATO — RIPROVA VERIFICA"}
              </span>
            </button>

          </div>{/* /content */}
        </div>{/* /modal */}

        {/* Torna indietro — fuori dal modal, in basso */}
        <button
          onClick={onClose}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-5 py-2.5 transition-all hover:text-white"
          style={{
            background: "rgba(10,22,40,0.5)",
            border: "1px solid rgba(61,143,255,0.25)",
            backdropFilter: "blur(12px)",
            color: "rgba(200,224,255,0.55)",
            boxShadow: "0 0 14px rgba(61,143,255,0.12)",
          }}
        >
          <span style={{ fontSize: 16 }}>←</span>
          <span style={{
            fontFamily: "var(--font-orbitron), 'Orbitron', sans-serif",
            fontSize: "clamp(9px, 1.1vw, 11px)",
            fontWeight: 700,
            letterSpacing: "2px",
            textTransform: "uppercase",
          }}>TORNA INDIETRO</span>
        </button>
      </div>{/* /overlay */}
    </>
  );
}
