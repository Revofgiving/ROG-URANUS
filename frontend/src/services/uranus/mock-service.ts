import type {
  DonoResponse,
  FlussiEsterniResponse,
  HealthResponse,
  PercorsoResponse,
  PosizioneResponse,
  StatoSistema,
  UranusService,
} from "./types";

function wait(ms = 350) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomTicket() {
  return Math.floor(1000 + Math.random() * 9000);
}

export const mockUranusService: UranusService = {
  async health(): Promise<HealthResponse> {
    await wait();
    return {
      status: "ok",
      sistema: "URANUS",
      versione: "mock",
      timestamp: new Date().toISOString(),
    };
  },

  async dona(params): Promise<DonoResponse> {
    await wait(500);
    const numeroCoppie = params.numeroPosizioni ?? 1;
    const ticket = randomTicket();
    return {
      success: true,
      wallet: params.wallet,
      ticket,
      numeroCoppie,
      importoTotale: numeroCoppie * 20,
      posizioni: [
        {
          tipo: "HUMAN",
          tavolaNumero: 1,
          casella: 1,
          turno: 1,
        },
        {
          tipo: "CASSA_ROG",
          tavolaNumero: 1,
          casella: 2,
          turno: 1,
        },
      ],
    };
  },

  async getStato(): Promise<StatoSistema> {
    await wait();
    return {
      sistema: { nome: "URANUS", mode: "mock" },
      blocco: { bloccato: false },
      fondoCassa: 0,
      statistiche: {
        totaleAccount: 0,
        totaleTavole: 0,
        tavoleAperte: 0,
        turniAttivi: 0,
        rientriInAttesa: 0,
        rientriHuman: 0,
        rientriCassa: 0,
        totaleUscite: 0,
        usciteHuman: 0,
        usciteCassa: 0,
        totaleDistribuito: 0,
        totaleAccantonato: 0,
        fondoCassa: 0,
        flussiEsterni: {
          rogSmall: 0,
          rog: 0,
          rientriSole: 0,
        },
      },
    };
  },

  async getPosizione(wallet: string): Promise<PosizioneResponse> {
    await wait();
    return {
      account: {
        wallet,
        nome: "Mock User",
        ticket_number: randomTicket(),
        tipo: "HUMAN",
        status: "attivo",
      },
      posizioni: [],
      uscite: [],
      rientri: [],
    };
  },

  async getFlussiEsterni(): Promise<FlussiEsterniResponse> {
    await wait();
    return {
      flussi: [],
      totali: { rog_small: 0, rog: 0, rientriSole: 0 },
    };
  },

  async getPercorso(wallet: string): Promise<{ success: boolean; percorso: PercorsoResponse }> {
    await wait();
    return {
      success: true,
      percorso: {
        wallet,
        aggiornato: new Date().toISOString(),
        sole: {
          tavole: [{
            tavolaNumero: 1, status: 'APERTA', miaCasella: 1, mioTipo: 'DONATORE',
            posizioniOccupate: 3, capacita: 6, posizioniMancanti: 3,
            percCompletamento: 50, isErede: true,
            alCompletamento: 'Entri nel Blocco 1 (50 USDC) + 1 pos. HUMAN in Nettuno',
            messaggio: 'Mancano 3 persone su 6 per completare la tavola',
          }],
          messaggio: 'Sei presente in 1 tavola Sole',
        },
        blocco1: {
          turnoPrevisto: 3, posizioneCoda: 2, sacerdotiNecessari: 13,
          personeNuoveNecessarie: 39, haFunzioni: true,
          messaggio: 'Diventerai Faraone al turno #3 (sei 2° in coda Blocco 1)',
        },
        nettuno: {
          inCoda: [{
            posizione: 42, tipo: 'HUMAN', isRientro: false, generazione: 0,
            donatoriDopo: 60, rientri_pool: 12, disponibili: 72,
            posizioniMancanti: 36, percCompletamento: 67, puoUscire: false,
            messaggio: 'Mancano 36 posizioni su 108 per uscire',
            payoutAtteso: { wallet: 800, pharaoh: 100, rogSmall: 60, soleL0: 40 },
          }],
          uscite: [],
          riepilogo: {
            totalePosizioni: 1, totaleHuman: 1, totaleCassa: 0, rientri_pool: 12,
            primaPosizioneUtile: { posizione: 42, mancanti: 36, perc: 67 },
          },
        },
        riepilogoPayout: { prossimoPayout: '800 USDC quando 36 posizioni si aggiungono' },
      },
    };
  },
};
