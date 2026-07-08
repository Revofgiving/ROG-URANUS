/**
 * 📝 DONI RICEVUTI ROG - Gestione File Tracking
 * 
 * Questo modulo gestisce il file "DONI RICEVUTI ROG.txt" che contiene
 * l'elenco di tutti i doni ricevuti dagli utenti ROG fino a questo momento.
 * 
 * Il file viene aggiornato automaticamente ogni volta che:
 * - Un dono viene distribuito
 * - Un accumulo viene completato
 * - Una cascata di generazioni viene attivata
 * 
 * Formato file:
 * ===============================================================================
 * DONI RICEVUTI ROG - Revolution of Giving
 * Aggiornato al: [TIMESTAMP]
 * ===============================================================================
 * 
 * WALLET: 0x123...
 * NOME: Mario Rossi
 * --------------------------------------------------------------------------------
 * [DATA]    | [IMPORTO]  | [TIPO DONO]           | [DA WALLET]    | [STATO]
 * --------------------------------------------------------------------------------
 * 2025-11-16 | 25 USDC    | Donazione SMALL C1D1  | 0xABC...       | ✅ Ricevuto
 * 2025-11-17 | 50 USDC    | Accumulo MEDIUM       | Sistema        | ✅ Accreditato
 * ...
 * 
 * TOTALE RICEVUTO: 75 USDC
 * ===============================================================================
 */

const fs = require('fs').promises;
const path = require('path');

const DONI_RICEVUTI_FILE = path.join(__dirname, '..', 'DONI RICEVUTI ROG.txt');
const ANAGRAFICA_FILE = path.join(__dirname, '..', 'ANAGRAFICA ROG 1 NOVEMBRE.txt');
const DISTRIBUZIONE_LOG = path.join(__dirname, 'data', 'distribuzione-log.json');

class DoniRicevutiManager {
  constructor() {
    this.anagraficaData = new Map(); // wallet -> {nome, email, telefono}
    this.doniPerWallet = new Map();  // wallet -> [{data, importo, tipo, da, stato}]
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    // Carica anagrafica per avere i nomi
    await this.caricaAnagrafica();

    // Carica doni dal log distribuzioni
    await this.caricaDoniDaLog();

    this.initialized = true;
  }

  /**
   * Carica l'anagrafica ROG per mappare wallet → nomi
   */
  async caricaAnagrafica() {
    try {
      const content = await fs.readFile(ANAGRAFICA_FILE, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim() || line.includes('NOME	COGNOME	WALLET')) continue;

        const parts = line.split('\t');
        if (parts.length >= 3) {
          const nome = parts[0].trim();
          const cognome = parts[1].trim();
          const wallet = parts[2].trim().toLowerCase();

          if (wallet && wallet.startsWith('0x')) {
            this.anagraficaData.set(wallet, {
              nome: `${nome} ${cognome}`,
              email: parts[3]?.trim() || '',
              telefono: parts[4]?.trim() || ''
            });
          }
        }
      }

      console.log(`✅ Anagrafica caricata: ${this.anagraficaData.size} utenti`);
    } catch (err) {
      console.warn(`⚠️  Anagrafica non trovata: ${err.message}`);
    }
  }

  /**
   * Carica i doni dal log di distribuzioni
   */
  async caricaDoniDaLog() {
    try {
      const logContent = await fs.readFile(DISTRIBUZIONE_LOG, 'utf8');
      const distribuzioni = JSON.parse(logContent);

      for (const entry of distribuzioni) {
        // Estrai dati distribuzione
        const {
          timestamp,
          donorWallet,
          recipientWallet,
          amount,
          level,
          cycle,
          donationInCycle,
          distribuzione
        } = entry;

        // Se la distribuzione non è bloccata, aggiungi al ricevente
        if (!distribuzione.blocked) {
          await this.aggiungiDono({
            recipientWallet,
            donorWallet,
            amount: distribuzione.accumuloRicevente || 0,
            tipo: `${level} C${cycle}D${donationInCycle}`,
            timestamp,
            stato: 'Accreditato'
          });

          // Se c'è un importo per ricevente del ricevente
          if (distribuzione.riceventeDelRicevente > 0) {
            // TODO: identificare il ricevente del ricevente
            // Per ora registriamo solo il ricevente diretto
          }
        }
      }

      console.log(`✅ Doni caricati dal log: ${this.doniPerWallet.size} wallet con doni`);
    } catch (err) {
      console.warn(`⚠️  Log distribuzioni non trovato: ${err.message}`);
    }
  }

  /**
   * Aggiunge un dono per un wallet
   */
  async aggiungiDono(params) {
    const {
      recipientWallet,
      donorWallet,
      amount,
      tipo,
      timestamp,
      stato = 'Ricevuto'
    } = params;

    if (amount <= 0) return; // Non registrare doni a 0

    const walletNorm = recipientWallet.toLowerCase();

    if (!this.doniPerWallet.has(walletNorm)) {
      this.doniPerWallet.set(walletNorm, []);
    }

    this.doniPerWallet.get(walletNorm).push({
      data: new Date(timestamp).toISOString().split('T')[0],
      importo: amount,
      tipo,
      daWallet: donorWallet,
      stato
    });

    console.log(`📝 Dono registrato: ${recipientWallet.slice(0, 10)}... riceve ${amount} USDC`);
  }

  /**
   * Genera il file DONI RICEVUTI ROG.txt completo
   */
  async generaFileDoniRicevuti() {
    await this.init();

    const timestamp = new Date().toLocaleString('it-IT', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let output = '';

    // Header
    output += '='.repeat(100) + '\n';
    output += '                        DONI RICEVUTI ROG - Revolution of Giving\n';
    output += '                            Aggiornato al: ' + timestamp + '\n';
    output += '='.repeat(100) + '\n\n';

    // Statistiche generali
    const totalUtentiConDoni = this.doniPerWallet.size;
    let totalDoniDistribuiti = 0;
    let importoTotale = 0;

    for (const [wallet, doni] of this.doniPerWallet) {
      totalDoniDistribuiti += doni.length;
      importoTotale += doni.reduce((sum, d) => sum + d.importo, 0);
    }

    output += `📊 STATISTICHE GENERALI:\n`;
    output += `   • Utenti con doni ricevuti: ${totalUtentiConDoni}\n`;
    output += `   • Doni distribuiti: ${totalDoniDistribuiti}\n`;
    output += `   • Importo totale distribuito: ${importoTotale.toFixed(2)} USDC\n`;
    output += '\n' + '='.repeat(100) + '\n\n';

    // Sezione per ogni wallet
    const wallets = Array.from(this.doniPerWallet.keys()).sort();

    for (const wallet of wallets) {
      const doni = this.doniPerWallet.get(wallet);
      const userData = this.anagraficaData.get(wallet);
      const nome = userData ? userData.nome : 'Sconosciuto';

      output += `WALLET: ${wallet}\n`;
      output += `NOME: ${nome}\n`;
      output += '-'.repeat(100) + '\n';
      output += `${'DATA'.padEnd(15)} | ${'IMPORTO'.padEnd(15)} | ${'TIPO DONO'.padEnd(25)} | ${'DA WALLET'.padEnd(20)} | ${'STATO'.padEnd(15)}\n`;
      output += '-'.repeat(100) + '\n';

      // Ordina doni per data
      const doniOrdinati = [...doni].sort((a, b) => new Date(a.data) - new Date(b.data));

      for (const dono of doniOrdinati) {
        const data = dono.data.padEnd(15);
        const importo = `${dono.importo.toFixed(2)} USDC`.padEnd(15);
        const tipo = dono.tipo.padEnd(25);
        const daWallet = (dono.daWallet?.slice(0, 10) + '...').padEnd(20);
        const stato = (dono.stato === 'Ricevuto' || dono.stato === 'Accreditato' ? '✅ ' : '⏳ ') + dono.stato;

        output += `${data} | ${importo} | ${tipo} | ${daWallet} | ${stato}\n`;
      }

      // Totale per wallet
      const totaleWallet = doni.reduce((sum, d) => sum + d.importo, 0);
      output += '-'.repeat(100) + '\n';
      output += `TOTALE RICEVUTO: ${totaleWallet.toFixed(2)} USDC\n`;
      output += '='.repeat(100) + '\n\n';
    }

    // Footer
    output += '\n';
    output += '📌 NOTE:\n';
    output += '   • I doni vengono accreditati automaticamente al completamento dei cicli\n';
    output += '   • Gli accumuli vengono rilasciati al raggiungimento della soglia\n';
    output += '   • Per dettagli sulla distribuzione, consulta la documentazione ROG\n';
    output += '\n';
    output += '🔗 Maggiori informazioni: https://revolutionofgiving.com\n';
    output += '📧 Support: revolutionofgivingrog@protonmail.com\n';

    // Salva file
    await fs.writeFile(DONI_RICEVUTI_FILE, output, 'utf8');

    console.log(`\n✅ File DONI RICEVUTI ROG.txt generato con successo!`);
    console.log(`   Percorso: ${DONI_RICEVUTI_FILE}`);
    console.log(`   Wallet tracciati: ${totalUtentiConDoni}`);
    console.log(`   Doni totali: ${totalDoniDistribuiti}`);
    console.log(`   Importo distribuito: ${importoTotale.toFixed(2)} USDC\n`);

    return {
      success: true,
      filePath: DONI_RICEVUTI_FILE,
      stats: {
        utentiConDoni: totalUtentiConDoni,
        doniDistribuiti: totalDoniDistribuiti,
        importoTotale: importoTotale.toFixed(2)
      }
    };
  }

  /**
   * Ottiene i doni ricevuti per un singolo wallet
   */
  async getDoniPerWallet(wallet) {
    await this.init();

    const walletNorm = wallet.toLowerCase();
    const doni = this.doniPerWallet.get(walletNorm) || [];
    const userData = this.anagraficaData.get(walletNorm);

    const totale = doni.reduce((sum, d) => sum + d.importo, 0);

    return {
      wallet,
      nome: userData ? userData.nome : 'Sconosciuto',
      doni: doni.sort((a, b) => new Date(b.data) - new Date(a.data)),
      totaleRicevuto: totale.toFixed(2),
      numeroDoni: doni.length
    };
  }

  /**
   * Aggiorna il file con un nuovo dono (da chiamare quando arriva una donazione)
   */
  async registraNuovoDono(params) {
    await this.init();
    await this.aggiungiDono(params);
    return await this.generaFileDoniRicevuti();
  }

  /**
   * Ottiene le statistiche generali
   */
  async getStatistiche() {
    await this.init();

    let totalDoni = 0;
    let importoTotale = 0;

    for (const [wallet, doni] of this.doniPerWallet) {
      totalDoni += doni.length;
      importoTotale += doni.reduce((sum, d) => sum + d.importo, 0);
    }

    return {
      utentiConDoni: this.doniPerWallet.size,
      doniDistribuiti: totalDoni,
      importoTotaleDistribuito: importoTotale.toFixed(2),
      mediaPerUtente: (importoTotale / this.doniPerWallet.size).toFixed(2)
    };
  }
}

// Esporta singleton
const doniRicevutiManager = new DoniRicevutiManager();
module.exports = doniRicevutiManager;

/**
 * USAGE EXAMPLES:
 * 
 * // Genera il file completo
 * const result = await doniRicevutiManager.generaFileDoniRicevuti();
 * 
 * // Ottieni doni per un wallet specifico
 * const doni = await doniRicevutiManager.getDoniPerWallet('0x123...');
 * 
 * // Registra un nuovo dono
 * await doniRicevutiManager.registraNuovoDono({
 *   recipientWallet: '0x123...',
 *   donorWallet: '0xABC...',
 *   amount: 25,
 *   tipo: 'SMALL C1D1',
 *   timestamp: new Date().toISOString(),
 *   stato: 'Ricevuto'
 * });
 * 
 * // Ottieni statistiche
 * const stats = await doniRicevutiManager.getStatistiche();
 */
