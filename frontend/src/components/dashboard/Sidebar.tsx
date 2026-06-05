"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "home" },
  { href: "/dashboard/orbita", label: "La Mia Orbita", icon: "orbit" },
  { href: "/dashboard/invia-dono", label: "Invia Dono", icon: "send" },
  { href: "/dashboard/doni", label: "I Miei Doni", icon: "gift" },
  { href: "/dashboard/wallet", label: "Wallet", icon: "wallet" },
  { href: "/dashboard/storico", label: "Storico", icon: "history" },
  { href: "/dashboard/community", label: "Community", icon: "community" },
  { href: "/dashboard/sicurezza", label: "Sicurezza", icon: "shield" },
  { href: "/dashboard/impostazioni", label: "Impostazioni", icon: "settings" },
  { href: "/dashboard/supporto", label: "Supporto", icon: "support" },
];

function NavIcon({ name, className }: { name: string; className?: string }) {
  const cn = className || "w-5 h-5";
  switch (name) {
    case "home":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      );
    case "orbit":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9 9 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
      );
    case "send":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
      );
    case "gift":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      );
    case "wallet":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 110-6h.75A2.25 2.25 0 0118 6v0a2.25 2.25 0 01-2.25 2.25H15M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
        </svg>
      );
    case "history":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "community":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-2.956 9 9 0 10-17.482 0A9.094 9.094 0 008 18.72m0 0a9.066 9.066 0 004-.5 9.066 9.066 0 004 .5m-8 0V18a4 4 0 018 0v.72" />
        </svg>
      );
    case "shield":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      );
    case "settings":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "support":
      return (
        <svg className={cn} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[220px] glass-sidebar z-40 flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 flex items-center gap-3">
        <Image src="/logo-uranus.png" alt="ROG-URANUS" width={32} height={32} />
        <div>
          <span className="text-lg font-bold tracking-[3px] text-white">ROG-URANUS</span>
          <p className="text-[8px] text-white/30 tracking-[1.5px] uppercase leading-tight">
            Sistema di Economia<br />del Dono Circolare
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 dashboard-scroll">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg mb-0.5 transition-all duration-200 group ${
                isActive
                  ? "nav-item-active"
                  : "hover:bg-white/[0.04]"
              }`}
            >
              <span className={`nav-icon ${isActive ? "text-uranus-cyan" : "text-white/40 group-hover:text-white/60"} transition-colors`}>
                <NavIcon name={item.icon} />
              </span>
              <span className={`nav-label text-sm font-medium ${isActive ? "text-uranus-cyan" : "text-white/50 group-hover:text-white/70"} transition-colors`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* System Status */}
      <div className="px-4 pb-4">
        <div className="rounded-xl p-3 bg-white/[0.03] border border-white/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-uranus-teal animate-pulse" />
            <span className="text-xs font-bold tracking-[1px] text-white/70">SISTEMA ATTIVO</span>
          </div>
          <p className="text-[10px] text-white/30 mb-3">
            Kill Switch: <span className="text-uranus-teal font-bold">PRONTO</span>
          </p>
          {/* Astronaut placeholder */}
          <div className="w-full h-16 rounded-lg bg-gradient-to-br from-uranus-violet/10 to-uranus-cyan/5 border border-white/[0.04] flex items-center justify-center mb-2">
            <span className="text-2xl">🧑‍🚀</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-uranus-violet" viewBox="0 0 38 33" fill="none">
              <path d="M29.5 10.2c-.7-.4-1.6-.4-2.4 0l-5.6 3.3-3.8 2.1-5.5 3.3c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-5c0-.8.4-1.6 1.2-2.1l4.3-2.5c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v3.3l3.8-2.2V7c0-.8-.4-1.6-1.2-2.1L14.6.5c-.7-.4-1.6-.4-2.4 0L5.8 5C5 5.4 4.6 6.2 4.6 7v9.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l5.5-3.2 3.8-2.2 5.5-3.2c.7-.4 1.6-.4 2.4 0l4.3 2.5c.7.4 1.2 1.2 1.2 2.1v5c0 .8-.4 1.6-1.2 2.1l-4.3 2.6c-.7.4-1.6.4-2.4 0l-4.3-2.5c-.7-.4-1.2-1.2-1.2-2.1v-3.3l-3.8 2.2v3.4c0 .8.4 1.6 1.2 2.1l6.5 3.8c.7.4 1.6.4 2.4 0l6.5-3.8c.7-.4 1.2-1.2 1.2-2.1V14c0-.8-.4-1.6-1.2-2.1l-6.6-3.8z" fill="#7c3aed"/>
            </svg>
            <div>
              <p className="text-[9px] text-white/40 font-bold">Blockchain verificata</p>
              <p className="text-[9px] text-uranus-violet font-semibold">Polygon Network</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
