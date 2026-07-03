"use client";
import Image from "next/image";

interface Props {
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
}

export default function PopupNeedRogSmall({ loading, onClose, onRetry }: Props) {

  return (
    <>
      <style>{`
        @keyframes rsStarBlink {
          0%,100%{opacity:.1}
          50%{opacity:.85}
        }
        @keyframes rsFadeIn {
          from{opacity:0;transform:scale(.94) translateY(16px)}
          to{opacity:1;transform:scale(1) translateY(0)}
        }
        @keyframes rsBreathe {
          0%,100%{box-shadow:0 0 24px rgba(217,148,0,.35),0 0 55px rgba(255,171,0,.18),0 0 100px rgba(217,148,0,.1),inset 0 1px 0 rgba(255,255,255,.08),0 40px 80px rgba(0,0,0,.7)}
          50%{box-shadow:0 0 40px rgba(217,148,0,.58),0 0 90px rgba(255,171,0,.32),0 0 160px rgba(217,148,0,.18),inset 0 1px 0 rgba(255,255,255,.12),0 40px 80px rgba(0,0,0,.7)}
        }
        @keyframes rsOrbit1 {
          from{transform:rotate(0deg) translateX(64px) rotate(0deg)}
          to{transform:rotate(360deg) translateX(64px) rotate(-360deg)}
        }
        @keyframes rsOrbit2 {
          from{transform:rotate(120deg) translateX(52px) rotate(-120deg)}
          to{transform:rotate(480deg) translateX(52px) rotate(-480deg)}
        }
        @keyframes rsOrbit3 {
          from{transform:rotate(240deg) translateX(58px) rotate(-240deg)}
          to{transform:rotate(600deg) translateX(58px) rotate(-600deg)}
        }
        @keyframes rsHudLine {
          0%,100%{opacity:.22}
          50%{opacity:.55}
        }
        @keyframes rsBtnPulse {
          0%,100%{box-shadow:0 0 22px rgba(255,171,0,.45),0 0 55px rgba(219,124,0,.22),inset 0 1px 0 rgba(255,255,255,.18)}
          50%{box-shadow:0 0 38px rgba(255,171,0,.7),0 0 90px rgba(219,124,0,.38),inset 0 1px 0 rgba(255,255,255,.24)}
        }
        @keyframes rsWarnGlow {
          0%,100%{box-shadow:0 0 16px rgba(255,171,0,.55),0 0 36px rgba(217,148,0,.25)}
          50%{box-shadow:0 0 28px rgba(255,171,0,.85),0 0 60px rgba(217,148,0,.45)}
        }
        .rs-btn-primary:hover{
          transform:scale(1.02) !important;
          box-shadow:0 0 50px rgba(255,171,0,.8),0 0 110px rgba(219,124,0,.42),inset 0 1px 0 rgba(255,255,255,.28) !important;
        }
        .rs-btn-retry:hover{
          transform:scale(1.02) !important;
          box-shadow:0 0 30px rgba(0,216,255,.55),0 0 70px rgba(0,216,255,.22),inset 0 1px 0 rgba(255,255,255,.08) !important;
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

        {/* ══ CARD ══ */}
        <div
          className="relative w-[min(650px,96vw)]"
          style={{
            animation: "rsFadeIn .42s cubic-bezier(.22,1,.36,1) forwards, rsBreathe 4s ease-in-out .42s infinite",
            background: "rgba(3,8,28,.80)",
            backdropFilter: "blur(32px) saturate(200%)",
            WebkitBackdropFilter: "blur(32px) saturate(200%)",
            borderRadius: "36px",
            border: "1px solid rgba(217,148,0,.5)",
            scrollbarWidth: "none",
          }}
        >
          {/* Corner HUD — top-left */}
          <div className="absolute top-0 left-0 pointer-events-none" style={{ opacity: .55 }}>
            <div style={{ position:"absolute", top:12, left:12, width:26, height:2, background:"linear-gradient(90deg,#d99400,transparent)" }} />
            <div style={{ position:"absolute", top:12, left:12, width:2, height:26, background:"linear-gradient(180deg,#d99400,transparent)" }} />
          </div>
          {/* Corner HUD — top-right */}
          <div className="absolute top-0 right-0 pointer-events-none" style={{ opacity: .55 }}>
            <div style={{ position:"absolute", top:12, right:12, width:26, height:2, background:"linear-gradient(270deg,#d99400,transparent)" }} />
            <div style={{ position:"absolute", top:12, right:12, width:2, height:26, background:"linear-gradient(180deg,#d99400,transparent)" }} />
          </div>
          {/* Corner HUD — bottom-left */}
          <div className="absolute bottom-0 left-0 pointer-events-none" style={{ opacity: .55 }}>
            <div style={{ position:"absolute", bottom:12, left:12, width:26, height:2, background:"linear-gradient(90deg,#d99400,transparent)" }} />
            <div style={{ position:"absolute", bottom:12, left:12, width:2, height:26, background:"linear-gradient(0deg,#d99400,transparent)" }} />
          </div>
          {/* Corner HUD — bottom-right */}
          <div className="absolute bottom-0 right-0 pointer-events-none" style={{ opacity: .55 }}>
            <div style={{ position:"absolute", bottom:12, right:12, width:26, height:2, background:"linear-gradient(270deg,#d99400,transparent)" }} />
            <div style={{ position:"absolute", bottom:12, right:12, width:2, height:26, background:"linear-gradient(0deg,#d99400,transparent)" }} />
          </div>

          {/* ── CONTENT ── */}
          <div className="flex flex-col items-center px-8 sm:px-12 py-10 gap-6">

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 flex items-center justify-center transition-all duration-200 hover:scale-110 hover:brightness-130"
              style={{
                width:48, height:48, borderRadius:"50%",
                border:"1.5px solid rgba(217,148,0,.6)",
                background:"rgba(30,14,0,.55)",
                backdropFilter:"blur(10px)",
                boxShadow:"0 0 12px rgba(217,148,0,.28)",
                color:"rgba(255,200,100,.75)", fontSize:16, fontWeight:700,
              }}
            >
              ✕
            </button>

            {/* Logo + orbit particles */}
            <div className="relative flex items-center justify-center" style={{ width:130, height:130 }}>
              {/* Outer orbit ring */}
              <div className="absolute" style={{ width:128, height:128, borderRadius:"50%", border:"1px dashed rgba(217,148,0,.2)" }} />
              {/* Inner orbit ring */}
              <div className="absolute" style={{ width:100, height:100, borderRadius:"50%", border:"1px solid rgba(255,171,0,.12)" }} />
              {/* Orbit particle 1 — amber */}
              <div className="absolute" style={{ width:10, height:10, animation:"rsOrbit1 7s linear infinite" }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:"#ffab00", boxShadow:"0 0 10px #ffab00,0 0 20px rgba(255,171,0,.55)", marginLeft:-4, marginTop:-4 }} />
              </div>
              {/* Orbit particle 2 — cyan */}
              <div className="absolute" style={{ width:8, height:8, animation:"rsOrbit2 10s linear infinite" }}>
                <div style={{ width:7, height:7, borderRadius:"50%", background:"#22d3ee", boxShadow:"0 0 8px #22d3ee,0 0 16px rgba(34,211,238,.5)", marginLeft:-3.5, marginTop:-3.5 }} />
              </div>
              {/* Orbit particle 3 — orange */}
              <div className="absolute" style={{ width:6, height:6, animation:"rsOrbit3 5.5s linear infinite" }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:"#fb923c", boxShadow:"0 0 7px #fb923c,0 0 14px rgba(251,146,60,.5)", marginLeft:-2.5, marginTop:-2.5 }} />
              </div>
              {/* Static glow dots */}
              <div className="absolute" style={{ width:4, height:4, borderRadius:"50%", background:"rgba(255,171,0,.7)", top:6, left:30, boxShadow:"0 0 6px rgba(255,171,0,.9)" }} />
              <div className="absolute" style={{ width:3, height:3, borderRadius:"50%", background:"rgba(34,211,238,.7)", bottom:8, right:24, boxShadow:"0 0 5px rgba(34,211,238,.9)" }} />
              <Image
                src="/logo-uranus.png"
                alt="ROG-URANUS"
                width={110}
                height={110}
                className="relative z-10"
                style={{ filter:"drop-shadow(0 0 14px rgba(34,211,238,.95)) drop-shadow(0 0 32px rgba(34,211,238,.5))" }}
              />
            </div>

            {/* Warning circle — partially overlapping logo area */}
            <div
              className="flex items-center justify-center"
              style={{
                width:80, height:80, borderRadius:"50%",
                border:"1.5px solid rgba(255,171,0,.7)",
                background:"rgba(30,12,0,.55)",
                backdropFilter:"blur(12px)",
                animation:"rsWarnGlow 2.8s ease-in-out infinite",
                marginTop:-20,
              }}
            >
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                <path d="M12 3L22.5 21H1.5L12 3Z" fill="rgba(255,171,0,.12)" stroke="#ffcb05" strokeWidth="2" strokeLinejoin="round" />
                <path d="M12 10v5" stroke="#ffcb05" strokeWidth="2.2" strokeLinecap="round" />
                <circle cx="12" cy="18" r="1.1" fill="#ffcb05" />
              </svg>
            </div>

            {/* HUD line */}
            <div style={{ width:"100%", height:1, background:"linear-gradient(90deg,transparent,rgba(217,148,0,.22),rgba(217,148,0,.48),rgba(217,148,0,.22),transparent)", animation:"rsHudLine 3s ease-in-out infinite", marginTop:-8 }} />

            {/* TITLE */}
            <h2 className="text-center" style={{
              fontFamily:"var(--font-orbitron),'Orbitron',sans-serif",
              fontWeight:900,
              fontSize:"clamp(16px, 3.2vw, 24px)",
              letterSpacing:"8px",
              color:"#ffcc00",
              textShadow:"0 0 16px rgba(255,204,0,.9),0 0 40px rgba(255,171,0,.5)",
              textTransform:"uppercase",
              lineHeight:1.2,
            }}>
              DONAZIONE ROG SMALL<br />RICHIESTA
            </h2>

            {/* HUD separator */}
            <div style={{ width:"80%", height:1, background:"rgba(255,255,255,.06)" }} />

            {/* DESCRIPTION */}
            <p className="text-center" style={{
              fontFamily:"Inter,sans-serif",
              fontWeight:600,
              fontSize:"clamp(13px, 1.8vw, 18px)",
              lineHeight:1.7,
              color:"rgba(255,255,255,.88)",
              maxWidth:"82%",
            }}>
              PER POTER ENTRARE E DONARE IN URANUS PER LA PRIMA VOLTA
              EFFETTUA ALMENO UNA DONAZIONE DA 2 USDC IN ROG SMALL
            </p>

            {/* PRIMARY BUTTON */}
            <a
              href="https://revolutionofgiving.eth.limo/donation.html"
              target="_blank"
              rel="noopener noreferrer"
              className="rs-btn-primary w-full flex items-center justify-center gap-3"
              style={{
                height:"clamp(60px,8vw,72px)",
                borderRadius:40,
                background:"linear-gradient(135deg,#db7c00,#ffab00)",
                boxShadow:"0 0 22px rgba(255,171,0,.45),0 0 55px rgba(219,124,0,.22),inset 0 1px 0 rgba(255,255,255,.18)",
                animation:"rsBtnPulse 3s ease-in-out infinite",
                textDecoration:"none",
                transition:"all .25s ease",
                cursor:"pointer",
              }}
            >
              <svg className="shrink-0" width="22" height="22" fill="none" stroke="white" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              <span style={{
                fontFamily:"var(--font-orbitron),'Orbitron',sans-serif",
                fontWeight:600,
                fontSize:"clamp(12px,2vw,20px)",
                letterSpacing:"5px",
                color:"white",
                textTransform:"uppercase",
              }}>
                DONA IN ROG SMALL ADESSO
              </span>
            </a>

            {/* INFO TEXT */}
            <p className="text-center" style={{
              fontFamily:"Inter,sans-serif",
              fontWeight:500,
              fontSize:"clamp(11px,1.3vw,14px)",
              color:"rgba(255,255,255,.35)",
              lineHeight:1.6,
              maxWidth:"85%",
              marginTop:-8,
            }}>
              Questo è richiesto solo per la <span style={{ color:"rgba(255,204,0,.55)", fontWeight:600 }}>prima donazione in URANUS</span>.<br />
              Dalla seconda in poi non sarà più necessario.
            </p>

            {/* HUD separator */}
            <div style={{ width:"100%", height:1, background:"linear-gradient(90deg,transparent,rgba(217,148,0,.16),rgba(217,148,0,.3),rgba(217,148,0,.16),transparent)" }} />

            {/* RETRY BUTTON */}
            <button
              onClick={onRetry}
              disabled={loading}
              className="rs-btn-retry w-full flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                height:"clamp(52px,7vw,64px)",
                borderRadius:35,
                border:"1.5px solid rgba(0,216,255,.5)",
                background:"rgba(0,12,30,.4)",
                backdropFilter:"blur(14px)",
                boxShadow:"0 0 16px rgba(0,216,255,.18),0 0 40px rgba(0,216,255,.08),inset 0 1px 0 rgba(255,255,255,.05)",
                transition:"all .25s ease",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              <svg width="20" height="20" fill="none" stroke="#00d8ff" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span style={{
                fontFamily:"var(--font-orbitron),'Orbitron',sans-serif",
                fontWeight:600,
                fontSize:"clamp(10px,1.4vw,18px)",
                letterSpacing:"4px",
                color:"#00d8ff",
                textTransform:"uppercase",
              }}>
                {loading ? "VERIFICA IN CORSO..." : "✓ HO DONATO — RIPROVA VERIFICA"}
              </span>
            </button>

          </div>{/* /content */}
        </div>{/* /card */}

        {/* Torna indietro — fuori dal modal */}
        <button
          onClick={onClose}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-5 py-2.5 transition-all hover:text-white"
          style={{
            background:"rgba(10,22,40,.5)",
            border:"1px solid rgba(217,148,0,.22)",
            backdropFilter:"blur(12px)",
            color:"rgba(255,200,100,.5)",
            boxShadow:"0 0 12px rgba(217,148,0,.1)",
          }}
        >
          <span style={{ fontSize:16 }}>←</span>
          <span style={{
            fontFamily:"var(--font-orbitron),'Orbitron',sans-serif",
            fontSize:"clamp(9px,1.1vw,11px)",
            fontWeight:700,
            letterSpacing:"2px",
            textTransform:"uppercase",
          }}>TORNA INDIETRO</span>
        </button>
      </div>{/* /overlay */}
    </>
  );
}
