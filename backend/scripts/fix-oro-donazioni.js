'use strict';
/**
 * 🥇 URANUS — Fix donazioni oro (XAUt0) con dual sotto-assegnati
 *
 * Il vecchio codice usava GOLD_PRICE_USD=4000 + Math.floor → alcuni dual
 * calcolati in meno. La mappa definitiva (MAPPA-DEFINITIVA-03LUGLIO) è la
 * fonte di verità per il numero corretto di dual.
 *
 * CORREZIONI (verificate dalla mappa):
 *   id=1  wallet=0x3a0fde… 4 dual → importo 80 USDC  (+1 dual mancante)
 *   id=7  wallet=0x2305…   2 dual → importo 40 USDC  (+1 dual mancante)
 *   id=17 wallet=0xca9f…   2 dual → importo 40 USDC  (solo importo, posizioni OK)
 *   id=18 wallet=0x9ca3…   2 dual → importo 40 USDC  (solo importo, posizioni OK)
 *
 * Uso:
 *   DRY_RUN (default): node scripts/fix-oro-donazioni.js
 *   APPLY:             APPLY=true node scripts/fix-oro-donazioni.js
 *
 * Idempotente: sicuro da eseguire più volte (controlla importo già corretto).
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const pg           = require(path.join(ROOT, 'pg-connection-manager'));
const flow         = require(path.join(ROOT, 'donation-flow-manager'));
const db           = require(path.join(ROOT, 'db-manager'));
const { URANUS_CASSA_WALLET } = require(path.join(ROOT, 'wallet-cassa'));

const DRY_RUN = process.env.APPLY !== 'true';

// ── Dati dalla mappa definitiva (fonte di verità on-chain) ──────────────────
const FIX_DONAZIONI = [
  { id: 1,  wallet: '0x3a0fde8d24c3c2b9448503a60d036e66417b2757', dualMappa: 4, usdc: 80,  dualMancanti: 1 },
  { id: 7,  wallet: '0x230527653ca927d5221b652ec25289218e782b8c', dualMappa: 2, usdc: 40,  dualMancanti: 1 },
  { id: 17, wallet: '0xca9f6924b98fedd68712aa878aca723b31c81965', dualMappa: 2, usdc: 40,  dualMancanti: 0 },
  { id: 18, wallet: '0x9ca3bb287ffbc6138926eaac8828e976c3f77146', dualMappa: 2, usdc: 40,  dualMancanti: 0 },
];

function hdr(t) {
  console.log(`\n${'═'.repeat(60)}\n  ${t}\n${'═'.repeat(60)}`);
}

async function main() {
  await db.initDatabase();

  console.log(`\n🥇 URANUS — Fix donazioni oro`);
  console.log(`   Modalità: ${DRY_RUN ? '🔍 DRY_RUN (nessuna modifica)' : '⚡ APPLY'}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);

  hdr('§ 1. STATO ATTUALE DONAZIONI ORO');

  const rows = await pg.queryMany(
    'SELECT id, donor_wallet, importo, tx_hash FROM donazioni WHERE id = ANY($1) ORDER BY id',
    [[1, 7, 17, 18]]
  );

  for (const r of rows) {
    const fix = FIX_DONAZIONI.find(f => f.id === r.id);
    const importoCorretto = fix?.usdc;
    const giaCorretto = Number(r.importo) === importoCorretto;
    console.log(`  id=${r.id} wallet=${r.donor_wallet.substring(0,14)}…`);
    console.log(`    importo DB: ${r.importo} USDC ${giaCorretto ? '✅ già corretto' : `→ deve essere ${importoCorretto} USDC`}`);
    console.log(`    dual mappa: ${fix?.dualMappa}  |  dual mancanti: ${fix?.dualMancanti}`);
  }

  hdr('§ 2. FIX IMPORTO DONAZIONI');

  for (const fix of FIX_DONAZIONI) {
    const row = rows.find(r => r.id === fix.id);
    if (!row) { console.log(`  id=${fix.id}: NON TROVATA nel DB`); continue; }

    const attuale = Number(row.importo);
    if (attuale === fix.usdc) {
      console.log(`  id=${fix.id}: importo già corretto (${fix.usdc} USDC) — skip`);
      continue;
    }

    if (!DRY_RUN) {
      await pg.query('UPDATE donazioni SET importo=$1 WHERE id=$2', [fix.usdc, fix.id]);
      console.log(`  id=${fix.id}: ${attuale} → ${fix.usdc} USDC ✅`);
    } else {
      console.log(`  id=${fix.id}: DRY_RUN — verrebbe aggiornato ${attuale} → ${fix.usdc} USDC`);
    }
  }

  hdr('§ 3. AGGIUNTA POSIZIONI MANCANTI A SOLE L0');

  const daAggiungere = FIX_DONAZIONI.filter(f => f.dualMancanti > 0);

  if (daAggiungere.length === 0) {
    console.log('  Nessuna posizione mancante da aggiungere.');
  }

  for (const fix of daAggiungere) {
    console.log(`\n  Wallet: ${fix.wallet.substring(0,16)}… — ${fix.dualMancanti} dual mancante/i`);

    for (let i = 0; i < fix.dualMancanti; i++) {
      if (!DRY_RUN) {
        // CASSA prima, HUMAN dopo (ordine standard dual)
        const rCassa = await flow.posizionaDonatoreEntrata(
          URANUS_CASSA_WALLET,
          'CASSA'
        );
        console.log(`    ✅ CASSA → Tavola #${rCassa?.tavolaNumero} casella ${rCassa?.casella}`);

        const rHuman = await flow.posizionaDonatoreEntrata(
          fix.wallet,
          fix.wallet.substring(0, 10)
        );
        console.log(`    ✅ HUMAN → Tavola #${rHuman?.tavolaNumero} casella ${rHuman?.casella}`);
      } else {
        console.log(`    DRY_RUN — verrebbe aggiunto: 1 CASSA + 1 HUMAN a Sole L0`);
      }
    }
  }

  hdr(DRY_RUN ? 'RISULTATO: DRY_RUN — nessuna modifica' : 'RISULTATO: APPLY completato ✅');
  if (DRY_RUN) {
    console.log('  Per applicare: APPLY=true node scripts/fix-oro-donazioni.js');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('❌ ERRORE:', err.message);
  process.exit(1);
});
