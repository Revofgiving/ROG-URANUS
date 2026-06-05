import type { Metadata } from "next";
import { Inter, UnifrakturCook } from "next/font/google";
import "./globals.css";
import ConditionalLayout from "@/components/layout/ConditionalLayout";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const unciale = UnifrakturCook({
  variable: "--font-unciale",
  weight: "700",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ROG-URANUS — Oltre l'economia tradizionale: ECOSÌNOSTRA!",
  description:
    "ROG-URANUS è un movimento figlio di ROG (Revolution of Giving). Piattaforma decentralizzata per una nuova economia.",
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className={`${inter.variable} ${unciale.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  );
}
