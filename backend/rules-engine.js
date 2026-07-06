/**
 * 📜 URANO — Rules Engine
 *
 * Implementazione delle 14 regole PHARAON adattate al sistema URANO.
 * Tutti gli importi = PHARAON ÷ 10 (uno zero in meno).
 *
 * Differenza chiave URANO: ogni utente crea 2 posizioni (HUMAN + CASSA),
 * entrambe percorrono lo STESSO identico percorso.
 * L'accantonamento del livello entrata (10 USDC) viene restituito
 * al lordo di Venere (L3).
 *
 * LIVELLI:
 *   L0  Sole                  — 6 caselle
 *   L1  Luna                  — 2 caselle
 *   L2  Mercurio              — 3 caselle
 *   L3  Venere                — 3 caselle
 *   L4  Giove                 — 3 caselle  [Blocco 2]
 *   L5  Saturno               — 3 caselle  [Blocco 2]
 *
 * REGOLE:
 *  1. Account Fondo (A) inizia sempre il 1° turno in ogni livello
 *  2. Sdoppiamento: ogni donatore genera una tavola con sé al centro
 *  3. Rilascio Funzioni all'uscita di Venere (L3)
 *  4. Entrata Faraone dal 2° turno: segue numerazione tavole
 *  5. Numerazione sequenziale tavole
 *  6. Entrata Funzioni dal 2° turno in poi
 *  7. Simbionti NON duplicabili
 *  8. Identificazione e numerazione Perpetuo (A.1, A.2 ...)
 *  9. Identificazione e numerazione Gemello (1-A, 2-A ...)
 * 10. Prenotazione ticket Gemelli (da 26, +14)
 * 11. Perpetuo non rilascia Gemello, solo Perpetuo successivo
 * 12. Solo Account Secondari passano da L3 a L4
 * 13. Funzioni uscita L4 (1.000 trattenuti per L5 + 100 per 10 crediti)
 * 14. Funzioni uscita L5 (100 trattenuti per 10 crediti — scelta URANUS: netto 2.900)
 */
'use strict';

// ========================================
// COSTANTI FINANZIARIE (PHARAON ÷ 10)
// ========================================

const IMPORTI = {
  // Entrata
  DONO_ENTRATA: 10,
  DONO_URANO: 50,                  // ciò che il sacerdote porta al Blocco 1
  TRATTENUTA_FONDO_ENTRATA: 10,
  USCITA_ENTRATA_NETTO: 50,        // 60 - 10
  COSTO_PER_PERSONA: 20,           // 10 HUMAN + 10 CASSA
  ACCOUNT_PER_PERSONA: 2,

  // Accantonamento restituito a Venere
  ACCANTONAMENTO_RESTITUITO: 10,   // i 10 trattenuti all'entrata tornano al lordo L3

  // Uscita L3 (Venere):
  //   900 + 10 restituiti = 910 lordo effettivo
  //   300 in cassa (Funzioni + struttura)
  //   610 netto Primario | 110 netto Secondario (+ 500 per L4)
  DONO_TOTALE_L3: 900,
  DONO_TOTALE_L3_EFFETTIVO: 910,
  TRATTENUTA_CASSA_L3: 300,
  USCITA_L3_PRIMARIO: 610,
  TRATTENUTA_L4_INGRESSO: 500,
  USCITA_L3_SECONDARIO: 110,

  // Funzioni (dalla riserva cassa 300)
  COSTO_SIMBIONTI: 150,            // 3 × 50
  COSTO_PERPETUO: 50,
  COSTO_GEMELLO: 50,
  COSTO_CREDITI_L3: 50,            // 5 × 10

  // L4 Giove
  DONO_TOTALE_L4: 1500,
  TRATTENUTA_L5_INGRESSO: 1000,
  TRATTENUTA_CREDITI_L4: 100,      // 10 × 10
  USCITA_L4_NETTO: 400,

  // L5 Saturno
  DONO_TOTALE_L5: 3000,
  TRATTENUTA_CREDITI_L5: 100,      // 10 × 10 (rivisto §10: crediti 110 → 10)
  USCITA_L5_NETTO: 2900,           // 3000 − 100 crediti

  // Sacerdoti
  SACERDOTI_PRIMO_TURNO: 18,
  SACERDOTI_DAL_SECONDO: 13
};

// ========================================
// REGOLA 1: Account Fondo sempre primo
// ========================================

function regolaFondoPrimo(turno, livello) {
  if (turno === 1) {
    return {
      faraoneWallet: 'FONDO',
      faraoneTipo: 'FONDO',
      regola: 1,
      descrizione: `Account Fondo (A) inizia il 1° turno al livello ${livello}`
    };
  }
  return null;
}

// ========================================
// REGOLA 4: Entrata Faraone dal 2° turno
// ========================================

function regolaEntrateFaraoneTurno(turnoCorrente, tavoleSdoppiate) {
  if (turnoCorrente <= 1 || !tavoleSdoppiate || tavoleSdoppiate.length === 0) {
    return null;
  }
  const tavolaFaraone = tavoleSdoppiate[0];
  return {
    faraoneWallet: tavolaFaraone.faraone_wallet,
    tavolaNumero: tavolaFaraone.numero,
    regola: 4,
    descrizione: `Faraone ${tavolaFaraone.faraone_wallet} entra con tavola #${tavolaFaraone.numero}`
  };
}

// ========================================
// REGOLA 5: Numerazione tavole
// ========================================

function regolaNumerazioneTavole(ultimaTavolaTurnoPrecedente) {
  return (ultimaTavolaTurnoPrecedente || 0) + 1;
}

// ========================================
// REGOLA 7: Simbionti non duplicabili
// ========================================

function regolaSimbionteDuplicabile(tipo) {
  return tipo !== 'SIMBIONTE';
}

// ========================================
// REGOLA 10: Prenotazione ticket Gemelli
// ========================================

function regolaTicketGemello(gemelloOrdine) {
  return 26 + (gemelloOrdine - 1) * 14;
}

// ========================================
// REGOLA 11: Perpetuo senza Gemello
// ========================================

function regolaRilasciFunzioni(tipoAccount) {
  switch (tipoAccount) {
    case 'PRIMARIO':
    case 'CASSA':
    case 'FONDO':
      return { rilasciaPerpetuo: true, rilasciaGemello: true, rilasciaSimbionti: true, rilasciaCrediti: true };
    case 'PERPETUO':
      return { rilasciaPerpetuo: true, rilasciaGemello: false, rilasciaSimbionti: true, rilasciaCrediti: true };
    case 'GEMELLO':
      return { rilasciaPerpetuo: true, rilasciaGemello: true, rilasciaSimbionti: true, rilasciaCrediti: true };
    default:
      return { rilasciaPerpetuo: false, rilasciaGemello: false, rilasciaSimbionti: false, rilasciaCrediti: false };
  }
}

// ========================================
// REGOLA 12: Solo secondari al L4
// ========================================

function regolaPuoPassareAlL4(tipoAccount) {
  return tipoAccount === 'PERPETUO' || tipoAccount === 'GEMELLO';
}

// ========================================
// REGOLE 3, 13, 14: Calcolo uscita livello
// ========================================

function calcolaUscitaLivello(livello, tipoAccount, doniRicevuti) {
  switch (livello) {
    case 3: { // Venere
      const lordoEffettivo = doniRicevuti + IMPORTI.ACCANTONAMENTO_RESTITUITO;
      const riservaCassa = IMPORTI.TRATTENUTA_CASSA_L3;
      const rilasci = regolaRilasciFunzioni(tipoAccount);
      const puoPassareL4 = regolaPuoPassareAlL4(tipoAccount);

      let netto;
      let ingressoL4 = 0;

      if (puoPassareL4) {
        ingressoL4 = IMPORTI.TRATTENUTA_L4_INGRESSO;
        netto = lordoEffettivo - riservaCassa - ingressoL4;
      } else {
        netto = lordoEffettivo - riservaCassa;
      }

      return {
        livello: 3, tipoAccount, doniRicevuti, lordoEffettivo,
        accantonamentoRestituito: IMPORTI.ACCANTONAMENTO_RESTITUITO,
        trattenutaCassa: riservaCassa, trattenutaIngressoL4: ingressoL4,
        netto, passaAlL4: puoPassareL4, rilasci,
        dettaglioFunzioni: {
          simbionti: rilasci.rilasciaSimbionti ? { numero: 3, importo: IMPORTI.COSTO_SIMBIONTI } : null,
          perpetuo: rilasci.rilasciaPerpetuo ? { importo: IMPORTI.COSTO_PERPETUO } : null,
          gemello: rilasci.rilasciaGemello ? { importo: IMPORTI.COSTO_GEMELLO } : null,
          crediti: rilasci.rilasciaCrediti ? { numero: 5, importo: IMPORTI.COSTO_CREDITI_L3 } : null
        }
      };
    }

    case 4: { // Giove
      const ingressoL5 = IMPORTI.TRATTENUTA_L5_INGRESSO;
      const crediti = IMPORTI.TRATTENUTA_CREDITI_L4;
      const netto = doniRicevuti - ingressoL5 - crediti;
      return {
        livello: 4, tipoAccount, doniRicevuti,
        trattenutaIngressoL5: ingressoL5, trattenutaCrediti: crediti,
        numCrediti: 10, netto, passaAlL5: true
      };
    }

    case 5: { // Saturno
      const crediti = IMPORTI.TRATTENUTA_CREDITI_L5;
      const netto = doniRicevuti - crediti;
      return {
        livello: 5, tipoAccount, doniRicevuti,
        trattenutaCrediti: crediti, numCrediti: 10,
        netto, uscitaDefinitiva: true
      };
    }

    default:
      throw new Error(`Livello ${livello} non prevede uscita con trattenute`);
  }
}

// ========================================
// REGOLA 6: Posizionamento Funzioni
// ========================================

function regolaPosizionamentoFunzioni(turno) {
  return {
    simbionti: {
      livello: 2,
      tavole: [
        { tavolaRelativa: 1, caselle: [1, 2] },
        { tavolaRelativa: 2, caselle: [1] }
      ]
    },
    perpetuo: { livello: 2, tavolaRelativa: 2, casella: 2 },
    gemello: { livello: 3, tavolaRelativa: 7, casella: 2 },
    turnoInserimento: turno
  };
}

// ========================================
// CALCOLO SACERDOTI NECESSARI
// ========================================

function calcolaSacerdotiNecessari(turno) {
  return turno === 1 ? IMPORTI.SACERDOTI_PRIMO_TURNO : IMPORTI.SACERDOTI_DAL_SECONDO;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  regolaFondoPrimo,
  regolaEntrateFaraoneTurno,
  regolaNumerazioneTavole,
  regolaSimbionteDuplicabile,
  regolaTicketGemello,
  regolaRilasciFunzioni,
  regolaPuoPassareAlL4,
  calcolaUscitaLivello,
  regolaPosizionamentoFunzioni,
  calcolaSacerdotiNecessari,
  IMPORTI
};
