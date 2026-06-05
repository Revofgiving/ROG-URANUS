import type { NextConfig } from "next";

const securityHeaders = [
  // Previeni clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Previeni MIME sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // XSS protection (legacy browsers)
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // Referrer policy strict
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // HSTS — forza HTTPS per 2 anni + subdomini + preload
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Disabilita API pericolose nel browser
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  // Content Security Policy — BLINDATA
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js richiede unsafe-eval in dev
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://polygon-mainnet.g.alchemy.com https://polygon-rpc.com https://rpc-amoy.polygon.technology wss:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
  // Previeni DNS prefetch leak
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  // Cross-Origin policies
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  // Static export per Pinata/IPFS + ENS
  output: 'export',
  // Trailing slash per compatibilità IPFS (dashboard/ invece di dashboard)
  trailingSlash: true,
  // Disabilita x-powered-by
  poweredByHeader: false,
  // Immagini: disabilita ottimizzazione server-side (non disponibile in export)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
