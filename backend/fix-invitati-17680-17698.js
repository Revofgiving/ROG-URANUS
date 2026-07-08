/**
 * FIX: Riassegna invitati posizioni 17680-17698
 * 
 * Problema: Le posizioni 17680-17698 appartengono a Anna IONITA (0xbe17cE...6a0)
 * ma nella tabella anagrafica_invitati risultano come invitate da Pasquale (0x4f1b12c9...17E).
 * Devono essere invitate da Anna stessa (rientro).
 * 
 * Uso: node fix-invitati-17680-17698.js [--apply]
 * Senza --apply mostra solo preview, con --apply applica le modifiche.
 */
require('dotenv').config();
const pgConn = require('./pg-connection-manager');

const ANNA_WALLET = '0xbe17ce579328fcdb3213ba98957c95b4d9fce6a0';
const PASQUALE_WALLET = '0x4f1b12c9d4182d55d23b87a2dd451ec0618eb17e';
const POSITIONS = [17680, 17682, 17684, 17686, 17688, 17690, 17692, 17694, 17696, 17698];

const APPLY = process.argv.includes('--apply');

async function fix() {
  console.log(`\n🔧 FIX INVITATI posizioni 17680-17698`);
  console.log(`   Da: ${PASQUALE_WALLET} (Pasquale)`);
  console.log(`   A:  ${ANNA_WALLET} (Anna IONITA)`);
  console.log(`   Modalità: ${APPLY ? '⚡ APPLY' : '👀 PREVIEW'}\n`);

  const pool = pgConn.getPool();

  // 1. Verifica stato attuale
  const current = await pool.query(
    `SELECT posizione, invitante_wallet, invitato_wallet, nome_invitante, nome_invitato
     FROM anagrafica_invitati 
     WHERE posizione = ANY($1)
     ORDER BY posizione`,
    [POSITIONS]
  );

  console.log(`Trovati ${current.rows.length} record in anagrafica_invitati:\n`);
  
  let toFix = 0;
  for (const row of current.rows) {
    const needsFix = row.invitante_wallet?.toLowerCase() === PASQUALE_WALLET;
    const marker = needsFix ? '⚠️  DA CORREGGERE' : '✅ OK';
    console.log(`  Pos #${row.posizione}: invitante=${row.invitante_wallet?.substring(0,12)}... (${row.nome_invitante || '?'}) ${marker}`);
    if (needsFix) toFix++;
  }

  console.log(`\n${toFix} record da correggere.\n`);

  if (toFix === 0) {
    console.log('✅ Nessuna correzione necessaria.');
    process.exit(0);
  }

  if (!APPLY) {
    console.log('👀 PREVIEW - Per applicare le modifiche usa: node fix-invitati-17680-17698.js --apply');
    process.exit(0);
  }

  // 2. Applica fix
  const result = await pool.query(
    `UPDATE anagrafica_invitati 
     SET invitante_wallet = $1, nome_invitante = 'Anna IONITA'
     WHERE posizione = ANY($2) AND invitante_wallet = $3
     RETURNING posizione`,
    [ANNA_WALLET, POSITIONS, PASQUALE_WALLET]
  );

  console.log(`✅ ${result.rowCount} record aggiornati!\n`);

  // 3. Verifica
  const verify = await pool.query(
    `SELECT posizione, invitante_wallet, nome_invitante
     FROM anagrafica_invitati 
     WHERE posizione = ANY($1)
     ORDER BY posizione`,
    [POSITIONS]
  );

  console.log('Verifica dopo fix:');
  for (const row of verify.rows) {
    console.log(`  Pos #${row.posizione}: invitante=${row.invitante_wallet?.substring(0,12)}... (${row.nome_invitante})`);
  }

  console.log('\n✅ Fix completato!');
  process.exit(0);
}

fix().catch(err => {
  console.error('❌ Errore:', err.message);
  process.exit(1);
});
