"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { adminLogout } from "@/lib/admin-api";
import type { AdminSpacing } from "@/components/admin/AdminSpacingPanel";

const NAV_ITEMS = [
  { href: "/admin",           label: "Dashboard",     icon: "📊" },
  { href: "/admin/dono",      label: "Dono",           icon: "💎" },
  { href: "/admin/wallet",    label: "Cerca Wallet",   icon: "🔍" },
  { href: "/admin/flussi",    label: "Flussi Esterni", icon: "🔄" },
  { href: "/admin/utenti",    label: "Utenti",         icon: "👤" },
  { href: "/admin/comunita",  label: "Comunità",       icon: "🌍" },
  { href: "/admin/eventi",    label: "Eventi",         icon: "📅" },
  { href: "/admin/risorse",   label: "Risorse",        icon: "📦" },
  { href: "/admin/comunicazioni", label: "Comunicazioni", icon: "✉️" },
  { href: "/admin/settings",  label: "Admin",          icon: "⚙️" },
];

interface Props {
  status: "online" | "offline" | "blocked";
  statusText: string;
  spacing: AdminSpacing;
}

export default function AdminSidebar({ status, statusText, spacing: sp }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    adminLogout();
    router.push("/admin/login");
  };

  return (
    <aside className="shrink-0 h-screen flex flex-col glass-sidebar border-r border-uranus-violet/20">
      {/* Header */}
      <div className="border-b border-white/5" style={{ padding: `${sp.sidebarHeaderPy}px ${sp.sidebarHeaderPx}px` }}>
        <div className="flex items-center gap-4 mb-4">
          <Image src="/logo-uranus.png" alt="ROG-URANUS" width={sp.sidebarLogoSize} height={sp.sidebarLogoSize} />
          <div>
            <h1
              className="font-bold tracking-[3px] text-uranus-violet"
              style={{ fontFamily: "var(--font-unciale), fantasy, serif", fontSize: `${sp.sidebarTitleSize}px` }}
            >
              ROG-URANUS
            </h1>
            <span className="text-[10px] text-white/30 uppercase tracking-widest mt-1 block">
              Pannello Admin
            </span>
          </div>
        </div>
        {/* Status */}
        <div className="flex items-center gap-2 mt-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              status === "online"
                ? "bg-green-500 shadow-[0_0_8px_#22c55e]"
                : status === "blocked"
                ? "bg-yellow-500 shadow-[0_0_8px_#f59e0b]"
                : "bg-red-500 shadow-[0_0_8px_#ef4444]"
            }`}
          />
          <span className="text-xs text-white/50">{statusText}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 overflow-y-auto"
        style={{ padding: `${sp.sidebarPy}px ${sp.sidebarPx}px` }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: `${sp.sidebarNavGap}px` }}>
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center rounded-xl text-sm transition-all ${
                  active
                    ? "bg-uranus-violet/15 text-uranus-violet border-l-2 border-uranus-violet"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                }`}
                style={{
                  padding: `${sp.sidebarItemPy}px ${sp.sidebarItemPx}px`,
                  gap: `${sp.sidebarIconGap}px`,
                }}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div
        className="border-t border-white/5 flex flex-col"
        style={{
          padding: `${sp.sidebarFooterPy}px ${sp.sidebarFooterPx}px`,
          gap: `${sp.sidebarFooterGap}px`,
        }}
      >
        <Link
          href="/"
          className="flex items-center gap-3 text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          <span className="text-xl">🏠</span> <span className="font-medium">Torna al sito</span>
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 text-sm text-red-400/60 hover:text-red-400 transition-colors"
        >
          <span className="text-xl">🚪</span> <span className="font-medium">Logout</span>
        </button>
      </div>
    </aside>
  );
}
