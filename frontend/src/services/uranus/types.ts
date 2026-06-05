export interface DonoResponse {
  success: boolean;
  wallet: string;
  ticket: number;
  numeroCoppie: number;
  importoTotale: number;
  posizioni: Array<{
    tipo: string;
    tavolaNumero: number;
    casella: number;
    turno: number;
  }>;
}

export interface StatoSistema {
  sistema: Record<string, unknown>;
  blocco: { bloccato: boolean; motivo?: string };
  fondoCassa: number;
  statistiche: {
    totaleAccount: number;
    totaleTavole: number;
    tavoleAperte: number;
    turniAttivi: number;
    rientriInAttesa: number;
    rientriHuman: number;
    rientriCassa: number;
    totaleUscite: number;
    usciteHuman: number;
    usciteCassa: number;
    totaleDistribuito: number;
    totaleAccantonato: number;
    fondoCassa: number;
    flussiEsterni: {
      rogSmall: number;
      rog: number;
      rientriSole: number;
    };
  };
}

export interface PosizioneResponse {
  account: {
    wallet: string;
    nome: string;
    ticket_number: number;
    tipo: string;
    status: string;
  };
  posizioni: Array<{
    id: number;
    tavola_id: number;
    casella: number;
    tipo: string;
    dono_importo: number;
    tavola_numero: number;
    livello: number;
    tavola_status: string;
  }>;
  uscite: Array<Record<string, unknown>>;
  rientri: Array<Record<string, unknown>>;
}

export interface HealthResponse {
  status: string;
  sistema: string;
  versione: string;
  timestamp: string;
}

export interface FlussiEsterniResponse {
  flussi: Array<Record<string, unknown>>;
  totali: { rog_small: number; rog: number; rientriSole: number };
}

// ── Percorso completo (Sole + Blocco1 + Nettuno) ──
export interface PercorsoSoleTavola {
  tavolaNumero: number;
  status: string;
  miaCasella: number;
  mioTipo: string;
  posizioniOccupate: number;
  capacita: number;
  posizioniMancanti: number;
  percCompletamento: number;
  isErede: boolean;
  alCompletamento: string;
  messaggio: string;
}
export interface PercorsoNettunoSlot {
  posizione: number;
  tipo: string;
  isRientro: boolean;
  generazione: number;
  donatoriDopo: number;
  rientri_pool: number;
  disponibili: number;
  posizioniMancanti: number;
  percCompletamento: number;
  puoUscire: boolean;
  messaggio: string;
  payoutAtteso: Record<string, number>;
}
export interface PercorsoResponse {
  wallet: string;
  aggiornato: string;
  sole: { tavole: PercorsoSoleTavola[]; messaggio: string };
  blocco1: {
    turnoPrevisto?: number;
    posizioneCoda?: number;
    sacerdotiNecessari?: number;
    personeNuoveNecessarie?: number;
    haFunzioni?: boolean;
    messaggio: string;
  };
  nettuno: {
    inCoda: PercorsoNettunoSlot[];
    uscite: Array<Record<string, unknown>>;
    riepilogo: {
      totalePosizioni: number;
      totaleHuman: number;
      totaleCassa: number;
      rientri_pool: number;
      primaPosizioneUtile: { posizione: number; mancanti: number; perc: number } | null;
    } | null;
  };
  riepilogoPayout: { prossimoPayout: string };
}

export interface DonoPendente {
  id: number;
  wallet: string;
  importo: number;
  livello: number;
  tipo_uscita: string;
  status: string;
  created_at: string;
  expires_at: string;
  giorni_rimanenti: number;
}

export interface Messaggio {
  id: number;
  recipient_wallet: string;
  sender: string;
  subject: string;
  content: string;
  type: string;
  gift_id: number | null;
  created_at: string;
  read: boolean;
}

export interface UranusService {
  health: () => Promise<HealthResponse>;
  dona: (params: {
    wallet: string;
    txHash: string;
    numeroPosizioni?: number;
    nome?: string;
  }) => Promise<DonoResponse>;
  getStato: () => Promise<StatoSistema>;
  getPosizione: (wallet: string) => Promise<PosizioneResponse>;
  getFlussiEsterni: () => Promise<FlussiEsterniResponse>;
  getPercorso: (wallet: string) => Promise<{ success: boolean; percorso: PercorsoResponse }>;
  getDoniPendenti: (wallet: string) => Promise<{ success: boolean; doni: DonoPendente[]; count: number }>;
  accettaDono: (donoId: number, wallet: string) => Promise<{ success: boolean; donoId: number; importo: number }>;
  getMessaggi: (wallet: string) => Promise<{ success: boolean; messaggi: Messaggio[]; nonLetti: number }>;
  segnaLetti: (wallet: string, messageIds: number[]) => Promise<{ success: boolean }>;
}
