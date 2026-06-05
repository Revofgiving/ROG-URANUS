"use client";

import { usePathname } from "next/navigation";
import Navbar from "./Navbar";
import BackgroundMusic from "@/components/effects/BackgroundMusic";

export default function ConditionalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isDashboard = pathname.startsWith("/dashboard");
  const isAdmin = pathname.startsWith("/admin");
  const isRegister = pathname.startsWith("/register");

  return (
    <>
      {!isHome && !isDashboard && !isAdmin && !isRegister && <Navbar />}
      <main className="flex-1">{children}</main>
      <BackgroundMusic />
    </>
  );
}
