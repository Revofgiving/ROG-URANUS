import type {
  DonoResponse,
  FlussiEsterniResponse,
  HealthResponse,
  PercorsoResponse,
  PosizioneResponse,
  StatoSistema,
  UranusService,
} from "./types";

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

export const apiUranusService: UranusService = {
  health: () => apiFetch<HealthResponse>("/api/health"),
  dona: (params) =>
    apiFetch<DonoResponse>("/api/dona", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  getStato: () => apiFetch<StatoSistema>("/api/stato"),
  getPosizione: (wallet) =>
    apiFetch<PosizioneResponse>(`/api/posizione/${wallet.toLowerCase()}`),
  getFlussiEsterni: () => apiFetch<FlussiEsterniResponse>("/api/flussi-esterni"),
  getPercorso: (wallet) =>
    apiFetch<{ success: boolean; percorso: PercorsoResponse }>(
      `/api/percorso/${wallet.toLowerCase()}`
    ),
  getDoniPendenti: (wallet: string) =>
    apiFetch<{ success: boolean; doni: DonoPendente[]; count: number }>(
      `/api/doni-pendenti/${wallet.toLowerCase()}`
    ),
  accettaDono: (donoId: number, wallet: string) =>
    apiFetch<{ success: boolean; donoId: number; importo: number }>(
      `/api/dono/accetta/${donoId}`,
      { method: 'POST', body: JSON.stringify({ wallet }) }
    ),
  getMessaggi: (wallet: string) =>
    apiFetch<{ success: boolean; messaggi: Messaggio[]; nonLetti: number }>(
      `/api/messaggi/${wallet.toLowerCase()}`
    ),
  segnaLetti: (wallet: string, messageIds: number[]) =>
    apiFetch<{ success: boolean }>(
      '/api/messaggi/letti',
      { method: 'POST', body: JSON.stringify({ wallet, messageIds }) }
    ),
};

// Tipi aggiuntivi
export type DonoPendente = {
  id: number;
  wallet: string;
  importo: number;
  livello: number;
  tipo_uscita: string;
  status: string;
  created_at: string;
  expires_at: string;
  giorni_rimanenti: number;
};

export type Messaggio = {
  id: number;
  recipient_wallet: string;
  sender: string;
  subject: string;
  content: string;
  type: string;
  gift_id: number | null;
  created_at: string;
  read: boolean;
};
