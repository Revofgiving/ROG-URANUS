/**
 * 🌊 ROG CASCATA TRIGGER - Sistema Automatico Distribuzione Massa
 * 
 * Gestisce il trigger automatico della distribuzione a cascata:
 * - Rileva quando una generazione è completata
 * - Avvia distribuzione massa a TUTTI i riceventi della generazione successiva
 * - Integra con distribuzione-doni.js per eseguire distribuzioni
 * 
 * FLUSSO:
 * 1. H10 ultima molecola completata → trigger distribuzione massa H8 (tutti i 37 pendenti)
 * 2. H8 tutti ricevuto → trigger distribuzione massa H6 (tutti i 9 pendenti)
 * 3. H6 tutti ricevuto → trigger distribuzione massa H4 (tutti i 2 pendenti)
 * 4. H4 tutti ricevuto → trigger distribuzione massa H2
 * 5. H2 tutti ricevuto → apertura H11
 * 
 * @author Warp AI Agent
 * @version 1.0.0 - Trigger Automatico
 * @date 17 Novembre 2025
 */

const fs = require('fs').promises;
const path = require('path');
const generazioneManager = require('./generazione-manager');
const doniRicevutiManager = require('./doni-ricevuti-manager');
const pontiManager = require('./ponti-manager');
const zkKYCManager = require('./zkkyc-manager');

// ========================================
// TRIGGER DISTRIBUZIONE MASSA
// ========================================

/**
 * Esegue trigger distribuzione massa quando generazione completa
 * 
 * @param {number} generazioneCompletata - Generazione appena completata (es: 10 per H10)
 * @returns {Promise<Object>} Risultato trigger
 */
async function triggerDistribuzioneMassa(generazioneCompletata) {
  console.log(`\n🌊 TRIGGER DISTRIBUZIONE MASSA`);
  console.log(`   Generazione completata: H${generazioneCompletata}`);
  
  const state = await generazioneManager.readCascataState();
  
  // Mappa generazione completata → generazione target
  const cascataMap = {
    10: 8,  // H10 → H8
    8: 6,   // H8 → H6
    6: 4,   // H6 → H4
    4: 2,   // H4 → H2
    2: 0    // H2 → apertura H11
  };
  
  const generazioneTarget = cascataMap[generazioneCompletata];
  
  if (generazioneTarget === undefined) {
    return {
      success: false,
      error: `Nessuna cascata definita per H${generazioneCompletata}`
    };
  }
  
  if (generazioneTarget === 0) {
    console.log(`   🎯 H2 completata → Pronta apertura H11`);
    return {
      success: true,
      tipo: 'APERTURA_GENERAZIONE',
      generazione: 11,
      messaggio: 'Tutte le distribuzioni H1-H10 complete. Sistema pronto per apertura H11'
    };
  }
  
  const genTarget = state.generazioni[generazioneTarget];
  
  if (!genTarget) {
    return {
      success: false,
      error: `Generazione target H${generazioneTarget} non trovata`
    };
  }
  
  console.log(`   🎯 Target: H${generazioneTarget}`);
  console.log(`   📊 Riceventi pendenti: ${genTarget.riceventiPendenti}`);
  console.log(`   💰 Importo BASE per ricevente: ${await calcolaImportoPerGenerazione(generazioneTarget)}€ (varia con classificazione PONTI)`);
  
  // Ottieni lista riceventi da doni_mancanti.txt
  const riceventiPendenti = await getRiceventiPendenti(generazioneTarget);
  
  if (!riceventiPendenti || riceventiPendenti.length === 0) {
    console.log(`   ℹ️  Nessun ricevente pendente per H${generazioneTarget}`);
    return {
      success: true,
      tipo: 'NESSUN_PENDENTE',
      generazione: generazioneTarget,
      riceventiProcessati: 0
    };
  }
  
  console.log(`\n📋 Lista riceventi da processare: ${riceventiPendenti.length}`);
  
  // Simula distribuzione massa (in produzione chiamerebbe distribuzione-doni.js)
  const risultati = [];
  let distribuzioniOk = 0;
  let distribuzioniFail = 0;
  
  for (const ricevente of riceventiPendenti) {
      try {
      // NOTA: In produzione qui chiameremmo distribuzione-doni.js
      // Per ora registriamo solo nel generazione-manager
      
      // Calcola importo effettivo in base a classificazione ponti
      const importo = await calcolaImportoPerGenerazione(generazioneTarget, ricevente.wallet);

      // Se l'importo supera la soglia ZK-KYC, verifica che l'utente sia verificato
      if (importo > zkKYCManager.ZKKYC_THRESHOLD) {
        const zkCheck = await zkKYCManager.canReceiveDistribution(ricevente.wallet, importo);
        if (!zkCheck.allowed) {
          console.log(`   ⛔ Distribuzione bloccata per ZK-KYC: ${ricevente.posizione} - ${ricevente.nome} (${zkCheck.reason})`);
          risultati.push({
            posizione: ricevente.posizione,
            wallet: ricevente.wallet,
            nome: ricevente.nome,
            importo,
            success: false,
            blocked: true,
            reason: zkCheck.reason,
            zkKYCUrl: zkCheck.zkKYCUrl || zkKYCManager.ZKKYC_VERIFICATION_URL
          });
          distribuzioniFail++;
          continue;
        }
      }
      
      const result = await generazioneManager.registraDistribuzioneRiceventeDelRicevente(
        generazioneTarget,
        ricevente.wallet,
        importo
      );
      
      if (result.success) {
        distribuzioniOk++;
        console.log(`   ✅ ${ricevente.posizione} - ${ricevente.nome}: ${importo}€`);
        
        // 📝 REGISTRA NEL FILE DONI RICEVUTI
        try {
          await doniRicevutiManager.registraNuovoDono({
            recipientWallet: ricevente.wallet,
            donorWallet: `Sistema Cascata H${generazioneCompletata}`,
            amount: importo,
            tipo: `Generazione H${generazioneTarget} (Ciclo ${getCicloPerGenerazione(generazioneTarget)})`,
            timestamp: new Date().toISOString(),
            stato: 'Accreditato'
          });
          console.log(`   📝 Dono registrato in DONI RICEVUTI ROG.txt`);
        } catch (errDoni) {
          console.warn(`   ⚠️  Errore registrazione dono ricevuto:`, errDoni.message);
        }
      } else {
        distribuzioniFail++;
        console.log(`   ❌ ${ricevente.posizione} - ${ricevente.nome}: ERRORE`);
      }
      
      risultati.push({
        posizione: ricevente.posizione,
        wallet: ricevente.wallet,
        nome: ricevente.nome,
        importo,
        success: result.success
      });
      
    } catch (error) {
      distribuzioniFail++;
      console.error(`   ❌ Errore distribuzione ${ricevente.posizione}:`, error.message);
    }
  }
  
  console.log(`\n📊 RIEPILOGO DISTRIBUZIONE MASSA`);
  console.log(`   ✅ Successo: ${distribuzioniOk}/${riceventiPendenti.length}`);
  console.log(`   ❌ Falliti: ${distribuzioniFail}/${riceventiPendenti.length}`);
  
  // Verifica se generazione target ora completa
  const stateAggiornato = await generazioneManager.readCascataState();
  const genTargetAggiornato = stateAggiornato.generazioni[generazioneTarget];
  
  if (genTargetAggiornato && genTargetAggiornato.riceventiPendenti <= 0) {
    console.log(`\n🎉 H${generazioneTarget} COMPLETATA!`);
    console.log(`   → Trigger automatico prossima cascata...`);
    
    // Trigger ricorsivo per prossima generazione
    const prossimoTrigger = await triggerDistribuzioneMassa(generazioneTarget);
    
    return {
      success: true,
      tipo: 'DISTRIBUZIONE_MASSA_COMPLETA',
      generazioneOrigine: generazioneCompletata,
      generazioneTarget: generazioneTarget,
      riceventiProcessati: distribuzioniOk,
      riceventiTotali: riceventiPendenti.length,
      risultati,
      prossimoTrigger
    };
  }
  
  return {
    success: true,
    tipo: 'DISTRIBUZIONE_MASSA',
    generazioneOrigine: generazioneCompletata,
    generazioneTarget: generazioneTarget,
    riceventiProcessati: distribuzioniOk,
    riceventiTotali: riceventiPendenti.length,
    risultati
  };
}

/**
 * Ottiene lista riceventi pendenti per generazione da doni_mancanti.txt
 * 
 * @param {number} generazione - Generazione (es: 8 per H8)
 * @returns {Promise<Array>} Array di {posizione, wallet, nome}
 */
async function getRiceventiPendenti(generazione) {
  try {
    const doniMancantiPath = path.join(__dirname, '..', 'doni_mancanti.txt');
    const content = await fs.readFile(doniMancantiPath, 'utf8');
    const lines = content.split('\n');
    
    const riceventi = [];
    let currentGen = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Rileva sezione generazione
      if (line.includes(`H${generazione}:`)) {
        currentGen = generazione;
        continue;
      }
      
      // Rileva cambio sezione
      if (line.match(/H\d+:/)) {
        currentGen = null;
        continue;
      }
      
      // Parsing riga ricevente
      if (currentGen === generazione && line.match(/^\d+\t/)) {
        const parts = line.split('\t');
        const posizione = parseInt(parts[0]);
        
        // Nome può essere nella stessa riga dopo tab
        let nome = 'UTENTE';
        if (parts.length > 1 && parts[1].trim()) {
          nome = parts[1].trim();
        }
        
        // Wallet è nella riga successiva (se inizia con 0x)
        let wallet = null;
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.startsWith('0x') || nextLine.startsWith('x')) {
            wallet = nextLine.startsWith('x') ? '0' + nextLine : nextLine;
          }
        }
        
        // Aggiungi anche se manca wallet (per count corretto)
        riceventi.push({
          posizione,
          wallet: wallet || '0x0000000000000000000000000000000000000000',
          nome: nome
        });
      }
    }
    
    return riceventi;
    
  } catch (error) {
    console.error('❌ Errore lettura doni_mancanti.txt:', error);
    return [];
  }
}

/**
 * Ottiene ciclo per generazione (per logging)
 * @param {number} generazione
 * @returns {number} Numero ciclo
 */
function getCicloPerGenerazione(generazione) {
  const cicloMap = { 10: 1, 8: 2, 6: 3, 4: 4, 2: 5 };
  return cicloMap[generazione] || 0;
}

/**
 * Calcola importo dono per generazione
 * Basato su cicli LARGE e numero invitati
 * 
 * IMPORTANTE: Gli importi variano in base alla classificazione PONTI:
 * - 2+ invitati (INVITANTE): 100% dell'importo base
 * - 1 invitato (SEMI_INVITANTE): 75% dell'importo base  
 * - 0 invitati (NON_INVITANTE): 50% dell'importo base
 * 
 * @param {number} generazione - Generazione (es: 8 per H8)
 * @param {string|null} wallet - Wallet utente (opzionale, per classificazione)
 * @returns {Promise<number>} Importo in €
 */
async function calcolaImportoPerGenerazione(generazione, wallet = null) {
  // Mappa generazione → ciclo LARGE
  // H10 = 1° ciclo, H8 = 2° ciclo, H6 = 3° ciclo, H4 = 4° ciclo, H2 = 5° ciclo
  const cicloMap = {
    10: 1,
    8: 2,
    6: 3,
    4: 4,
    2: 5
  };
  
  const cycle = cicloMap[generazione];
  
  if (!cycle) return 0;
  
  // Importi BASE per ciclo LARGE (per INVITANTE = 2+ invitati)
  // Ciclo 1: 50€, Ciclo 2: 100€, Ciclo 3: 200€, Ciclo 4: 400€, Ciclo 5: 500€
  const importiBase = {
    1: 50,
    2: 100,
    3: 200,
    4: 400,
    5: 500
  };
  
  const importoBase = importiBase[cycle] || 0;
  
  // Se non c'è wallet, ritorna importo base (assumendo INVITANTE)
  if (!wallet) {
    return importoBase;
  }
  
  // Ottieni classificazione ponti per applicare percentuale corretta
  try {
    const classificazione = await pontiManager.getClassificazione(wallet);
    
    if (!classificazione) {
      // Non ancora classificato - assume INVITANTE (100%)
      return importoBase;
    }
    
    // Applica percentuale in base a classificazione
    if (classificazione.classificazione === 'INVITANTE') {
      return importoBase; // 100%
    } else if (classificazione.classificazione === 'SEMI_INVITANTE') {
      return importoBase * 0.75; // 75%
    } else if (classificazione.classificazione === 'NON_INVITANTE') {
      return importoBase * 0.50; // 50%
    }
    
    return importoBase; // Default 100%
    
  } catch (error) {
    console.warn(`⚠️  Errore recupero classificazione per ${wallet}:`, error.message);
    return importoBase; // Fallback a 100%
  }
}

/**
 * Verifica se una generazione è pronta per trigger cascata
 * 
 * @param {number} generazione - Generazione (es: 10 per H10)
 * @returns {Promise<Object>} { pronta: boolean, motivoSeNo: string }
 */
async function verificaGenerazioneProntaPerCascata(generazione) {
  const state = await generazioneManager.readCascataState();
  const gen = state.generazioni[generazione];
  
  if (!gen) {
    return {
      pronta: false,
      motivoSeNo: `Generazione H${generazione} non trovata`
    };
  }
  
  if (!gen.completata) {
    return {
      pronta: false,
      motivoSeNo: `H${generazione} non completata: ${gen.molecoleCompletate}/${gen.totaleMolecole} molecole`,
      molecoleMancanti: gen.molecoleMancanti,
      percentuale: gen.percentualeCompletamento
    };
  }
  
  return {
    pronta: true,
    generazione: `H${generazione}`,
    molecoleCompletate: gen.molecoleCompletate,
    percentuale: gen.percentualeCompletamento
  };
}

/**
 * Esegue check e trigger automatico se generazione completa
 * Da chiamare dopo ogni molecola completata
 * 
 * @param {number} numeroMolecola - Numero molecola appena completata
 * @returns {Promise<Object>} Risultato check e eventuale trigger
 */
async function checkETriggaAutomatico(numeroMolecola) {
  console.log(`\n🔍 CHECK AUTOMATICO CASCATA - Molecola #${numeroMolecola}`);
  
  // Calcola generazione dalla molecola
  const generazione = generazioneManager.FORMULE.getGenerazioneDaMolecola(numeroMolecola);
  
  console.log(`   Generazione: H${generazione}`);
  
  // Verifica se pronta per cascata
  const verifica = await verificaGenerazioneProntaPerCascata(generazione);
  
  if (!verifica.pronta) {
    console.log(`   ℹ️  ${verifica.motivoSeNo}`);
    return {
      checkEseguito: true,
      triggerEseguito: false,
      motivo: verifica.motivoSeNo
    };
  }
  
  console.log(`   ✅ Generazione H${generazione} COMPLETA - Avvio trigger cascata...`);
  
  // Esegui trigger
  const triggerResult = await triggerDistribuzioneMassa(generazione);
  
  return {
    checkEseguito: true,
    triggerEseguito: true,
    generazioneCompletata: generazione,
    triggerResult
  };
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  // Funzioni principali
  triggerDistribuzioneMassa,
  checkETriggaAutomatico,
  
  // Utility
  verificaGenerazioneProntaPerCascata,
  getRiceventiPendenti,
  calcolaImportoPerGenerazione
};
