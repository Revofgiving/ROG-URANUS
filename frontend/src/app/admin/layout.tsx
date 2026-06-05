"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getAdminSession, adminApi } from "@/lib/admin-api";
import AdminSidebar from "@/components/admin/AdminSidebar";
import LogPanel from "@/components/admin/LogPanel";
import Image from "next/image";
import { LogProvider } from "@/components/admin/LogPanel";
import AdminSpacingPanel, {
  type AdminSpacing,
  DEFAULT_ADMIN_SP,
} from "@/components/admin/AdminSpacingPanel";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"online" | "offline" | "blocked">("offline");
  const [statusText, setStatusText] = useState("Connessione...");
  const [sp, setSp] = useState<AdminSpacing>(DEFAULT_ADMIN_SP);

  const isLoginPage = pathname === "/admin/login";
  const hasSession = Boolean(getAdminSession());
  const ready = isLoginPage || hasSession;

  // Auth check
  useEffect(() => {
    if (!isLoginPage && !hasSession) {
      router.push("/admin/login");
    }
  }, [router, isLoginPage, hasSession]);

  // Status polling
  const checkStatus = useCallback(async () => {
    if (isLoginPage) return;
    try {
      const data = await adminApi<{ blocco?: { bloccato: boolean } }>("/api/stato");
      if (data.blocco?.bloccato) {
        setStatus("blocked");
        setStatusText("BLOCCATO");
      } else {
        setStatus("online");
        setStatusText("Online");
      }
    } catch {
      setStatus("offline");
      setStatusText("Offline");
    }
  }, [isLoginPage]);

  useEffect(() => {
    if (!ready || isLoginPage) return;
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [ready, isLoginPage, checkStatus]);

  // Login page — no sidebar
  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-uranus-violet border-t-transparent animate-spin" />
          <p className="text-white/40 text-sm">Caricamento pannello admin...</p>
        </div>
      </div>
    );
  }

  return (
    <LogProvider>
      {/* 📐 Pannello spaziatura */}
      <AdminSpacingPanel values={sp} onChange={setSp} />

      <div className="flex h-screen overflow-hidden bg-background">
        <div style={{ width: sp.sidebarW, minWidth: sp.sidebarW }}>
          <AdminSidebar status={status} statusText={statusText} spacing={sp} />
        </div>
        <div className="flex-1 flex flex-col h-screen overflow-hidden">
          {/* Top bar */}
          <header
            className="glass-header flex items-center justify-between border-b border-uranus-violet/10"
            style={{ padding: `${sp.headerPy}px ${sp.headerPx}px` }}
          >
            <div className="flex items-center gap-3">
              <Image src="/logo-uranus.png" alt="ROG-URANUS" width={sp.topBarLogoSize} height={sp.topBarLogoSize} />
              <h2 className="font-bold text-white/60 tracking-wider uppercase" style={{ fontSize: `${sp.topBarFontSize}px` }}>
                <span className="text-uranus-violet" style={{ fontFamily: 'var(--font-unciale), fantasy, serif' }}>ROG-URANUS</span> v2 — Pannello di Controllo
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  status === "online"
                    ? "bg-green-500"
                    : status === "blocked"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              <span className="text-xs text-white/40">{statusText}</span>
            </div>
          </header>

          {/* Content */}
          <div
            className="flex-1 overflow-y-auto dashboard-scroll"
            style={{
              padding: `${sp.contentPy}px ${sp.contentPx}px`,
              display: "flex",
              flexDirection: "column",
              gap: `${sp.sectionGap}px`,
              // Dashboard spacing CSS vars
              "--dash-gap": `${sp.dashGap}px`,
              "--kpi-grid-gap": `${sp.kpiGridGap}px`,
              "--detail-grid-gap": `${sp.detailGridGap}px`,
              "--dash-card-pad": `${sp.dashCardPad}px`,
              "--dash-stat-py": `${sp.dashStatPy}px`,
              "--dono-cards-gap": `${sp.donoCardsGap}px`,
              "--dono-card-pad": `${sp.donoCardPad}px`,
              "--dono-input-gap": `${sp.donoInputGap}px`,
              "--dono-btn-gap": `${sp.donoBtnGap}px`,
            } as React.CSSProperties}
          >
            {children}
            <LogPanel />
          </div>
        </div>
      </div>
    </LogProvider>
  );
}
