import { uranusService } from "@/services/uranus";
import type { StatoSistema } from "@/services/uranus";
export type {
  DonoResponse,
  HealthResponse,
  PosizioneResponse,
  StatoSistema,
} from "@/services/uranus";

export const health = uranusService.health;
export const dona = uranusService.dona;
export const getStato = uranusService.getStato;
export const getPosizione = uranusService.getPosizione;
export const getFlussiEsterni = uranusService.getFlussiEsterni;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = API_URL.replace(/\/$/, "") + path;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

// ── Admin API ─────────────────────────────────────────────────

function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  const config = localStorage.getItem("uranus_admin_config");
  if (config) {
    try {
      return JSON.parse(config).apiKey || "";
    } catch {
      return "";
    }
  }
  return "";
}

export async function adminStato(): Promise<
  StatoSistema & { blocco: Record<string, unknown> }
> {
  return apiFetch("/api/admin/stato", {
    headers: { "X-Admin-Key": getAdminKey() },
  });
}

export async function adminBlocca(motivo: string) {
  return apiFetch("/api/admin/blocca", {
    method: "POST",
    headers: { "X-Admin-Key": getAdminKey() },
    body: JSON.stringify({ motivo }),
  });
}

export async function adminSblocca() {
  return apiFetch("/api/admin/sblocca", {
    method: "POST",
    headers: { "X-Admin-Key": getAdminKey() },
  });
}

export async function adminInizializza() {
  return apiFetch("/api/inizializza", {
    method: "POST",
    headers: { "X-Admin-Key": getAdminKey() },
  });
}
