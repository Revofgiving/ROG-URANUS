/**
 * Script per aggiornare gli invitanti nel movimento LARGE
 * Legge il file "invitati large 2.txt" e aggiorna la tabella anagrafica_invitati
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configurazione database: usa DATABASE_URL (Coolify) dall'ambiente
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('❌ DATABASE_URL non impostata. Esportala prima di eseguire lo script.');
    process.exit(1);
}
const pool = new Pool({
    connectionString,
    ssl: (process.env.PGSSLMODE || process.env.DATABASE_SSL || '').toLowerCase() === 'require'
        ? { rejectUnauthorized: false }
        : false
});

// Funzione per estrarre wallet da una stringa (cerca pattern 0x...)
function extractWallet(str) {
    if (!str) return null;
    // Rimuovi spazi extra e caratteri strani
    str = str.trim();
    // Cerca un wallet Ethereum (0x seguito da 40 caratteri hex)
    const match = str.match(/0x[a-fA-F0-9]{40}/i);
    return match ? match[0].toLowerCase() : null;
}

// Funzione per parsare il file
function parseFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    
    const invitati = [];
    let i = 0;
    
    // Salta la prima riga (intestazione "INVITATI LARGE")
    if (lines[0].includes('INVITATI LARGE')) {
        i = 1;
    }
    
    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) {
            i++;
            continue;
        }
        
        // Prova a parsare la riga
        // Formato 1: "POSIZIONE\tNOME\t" (wallet sulla riga successiva)
        // Formato 2: "POSIZIONE\tNOME\tWALLET" oppure "POSIZIONE    NOME\tWALLET"
        
        // Splitta per tab o spazi multipli
        const parts = line.split(/\t+|\s{2,}/);
        
        if (parts.length >= 1) {
            // Estrai il numero di posizione
            const posMatch = parts[0].match(/^\d+/);
            if (!posMatch) {
                i++;
                continue;
            }
            
            const position = parseInt(posMatch[0]);
            if (position < 1 || position > 3495) {
                i++;
                continue;
            }
            
            // Cerca il wallet nella riga corrente
            let wallet = extractWallet(line);
            let name = '';
            
            if (parts.length >= 2) {
                name = parts[1].trim();
            }
            
            // Se non c'è wallet nella riga corrente, guarda la riga successiva
            if (!wallet && i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                wallet = extractWallet(nextLine);
                if (wallet) {
                    i++; // Salta anche la riga successiva
                }
            }
            
            if (wallet && position >= 1 && position <= 3495) {
                invitati.push({
                    position,
                    name,
                    wallet
                });
            }
        }
        
        i++;
    }
    
    return invitati;
}

// Funzione principale
async function main() {
    const filePath = path.join(__dirname, 'invitati large 2.txt');
    
    console.log('=== AGGIORNAMENTO INVITANTI LARGE ===\n');
    console.log('Parsing del file...');
    
    // Parsa il file
    const invitati = parseFile(filePath);
    console.log(`Trovate ${invitati.length} posizioni nel file\n`);
    
    // Verifica alcune posizioni
    console.log('Prime 5 posizioni:');
    invitati.slice(0, 5).forEach(inv => {
        console.log(`  Pos ${inv.position}: ${inv.name} -> ${inv.wallet}`);
    });
    
    console.log('\nUltime 5 posizioni:');
    invitati.slice(-5).forEach(inv => {
        console.log(`  Pos ${inv.position}: ${inv.name} -> ${inv.wallet}`);
    });
    
    // Verifica posizione 531 (ingresso Susanna Bussani)
    const pos531 = invitati.find(inv => inv.position === 531);
    if (pos531) {
        console.log(`\nPosizione 531 (Susanna Bussani): invitante = ${pos531.name} (${pos531.wallet})`);
    }
    
    // Connessione al database
    console.log('\nConnessione al database...');
    const client = await pool.connect();
    
    try {
        // Conta posizioni LARGE attuali
        const countResult = await client.query(`
            SELECT COUNT(*) as total FROM anagrafica_invitati 
            WHERE invitato_pos >= 1 AND invitato_pos <= 3495
        `);
        console.log(`Posizioni LARGE nel database: ${countResult.rows[0].total}`);
        
        // Aggiorna in batch
        console.log('\nInizio aggiornamento...');
        
        let updated = 0;
        let errors = 0;
        let notFound = 0;
        
        for (const inv of invitati) {
            try {
                const result = await client.query(`
                    UPDATE anagrafica_invitati 
                    SET invitante_wallet = $1
                    WHERE invitato_pos = $2
                `, [inv.wallet, inv.position]);
                
                if (result.rowCount > 0) {
                    updated++;
                } else {
                    notFound++;
                    if (notFound <= 10) {
                        console.log(`  Posizione ${inv.position} non trovata nel DB`);
                    }
                }
            } catch (err) {
                errors++;
                if (errors <= 10) {
                    console.log(`  Errore posizione ${inv.position}: ${err.message}`);
                }
            }
        }
        
        console.log(`\n=== RISULTATO ===`);
        console.log(`Aggiornate: ${updated} posizioni`);
        console.log(`Non trovate: ${notFound} posizioni`);
        console.log(`Errori: ${errors}`);
        
        // Verifica finale
        console.log('\n=== VERIFICA FINALE ===');
        
        // Conta per invitante
        const statsResult = await client.query(`
            SELECT 
                CASE 
                    WHEN LOWER(invitante_wallet) = 'self' THEN 'SELF'
                    WHEN LOWER(invitante_wallet) = '0xd5bcc7acc9d6862c784807134c1f70c3e7f9f790' THEN 'ROG'
                    WHEN LOWER(invitante_wallet) = '0x96e6a17f968b73d10263072899c95b83305281fe' THEN 'PILETTA'
                    WHEN LOWER(invitante_wallet) = '0x7978c4423b4fd17fa05df593b4c05e138606f972' THEN 'AVENGERS'
                    ELSE 'ALTRI'
                END as tipo,
                COUNT(*) as conteggio
            FROM anagrafica_invitati
            WHERE invitato_pos >= 1 AND invitato_pos <= 3495
            GROUP BY tipo
            ORDER BY conteggio DESC
        `);
        
        console.log('Distribuzione invitanti LARGE:');
        statsResult.rows.forEach(row => {
            console.log(`  ${row.tipo}: ${row.conteggio}`);
        });
        
        // Verifica Susanna Bussani (pos 531)
        const susannaCheck = await client.query(`
            SELECT invitato_pos, invitante_wallet 
            FROM anagrafica_invitati 
            WHERE invitato_pos <= 3495 
            AND LOWER(invitato_wallet) = '0xb41916c2eb6fc873e506fb4eadb96791bd24c11f'
            ORDER BY invitato_pos
        `);
        
        console.log('\nPosizioni di Susanna Bussani (LARGE):');
        susannaCheck.rows.forEach(row => {
            console.log(`  Pos ${row.invitato_pos}: invitante = ${row.invitante_wallet}`);
        });
        
    } finally {
        client.release();
        await pool.end();
    }
    
    console.log('\n=== COMPLETATO ===');
}

main().catch(err => {
    console.error('Errore:', err);
    process.exit(1);
});
