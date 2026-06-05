"use client";
import Link from "next/link";

interface HeaderProps {
  wallet: string;
  userId: string;
}

export default function Header({ wallet, userId }: HeaderProps) {
  const shortWallet = wallet
    ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
    : "Non connesso";

  return (
    <header className="glass-header px-8 py-5 pl-16">
      {/* Riga 1: Titolo + Wallet */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold tracking-[4px] text-white uppercase">
          Area Personale
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/[0.03]">
            <span className="text-sm font-mono text-white/70">{shortWallet}</span>
            <div className="w-2.5 h-2.5 rounded-full bg-uranus-teal animate-pulse" />
            <span className="text-xs text-uranus-teal font-semibold">Connesso</span>
          </div>
        </div>
      </div>

      {/* Riga 2: Info + Controlli */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/40">
          Benvenuto, <span className="text-uranus-cyan font-semibold">Explorer</span>
          <span className="ml-4 px-3 py-1 rounded-lg bg-white/[0.06] text-[11px] text-white/30 font-mono">
            ID: {userId}
          </span>
        </p>

        <div className="flex items-center gap-5">
          {/* Network Badge */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/[0.03]">
            <span className="text-xs text-white/50">Rete</span>
            <span className="text-xs font-bold text-white">Polygon</span>
            <svg className="w-4 h-4 text-uranus-violet" viewBox="0 0 38 33" fill="none">
              <path d="M29.5 10.2c-.7-.4-1.6-.4-2.4 0l-5.6 3.3-3.8 2.1-5.5 3.3c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-5c0-.8.4-1.6 1.2-2.1l4.3-2.5c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v3.3l3.8-2.2V7c0-.8-.4-1.6-1.2-2.1L14.6.5c-.7-.4-1.6-.4-2.4 0L5.8 5C5 5.4 4.6 6.2 4.6 7v9.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l5.5-3.2 3.8-2.2 5.5-3.2c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v5c0 .8-.4 1.6-1.2 2.1l-4.3 2.6c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-3.3l-3.8 2.2v3.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l6.5-3.8c.7-.4 1.2-1.2 1.2-2.1V14c0-.8-.4-1.6-1.2-2.1l-6.6-3.8z" fill="#7c3aed"/>
            </svg>
          </div>

          {/* Settings */}
          <button className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/20 transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Notifications */}
          <button className="relative w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/20 transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-uranus-cyan text-[9px] font-bold text-uranus-deep flex items-center justify-center">
              3
            </span>
          </button>

          {/* Home */}
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded-full text-white/50 hover:text-white transition-all"
            style={{ background: 'rgba(10, 22, 40, 0.4)', border: '1px solid rgba(34, 211, 238, 0.15)' }}
          >
            <span className="text-base">🏠</span>
            <span className="text-xs font-bold tracking-[2px] uppercase">Home</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
