/**
 * Position Lookup Module
 * Search position by number or wallet and return complete info
 * 
 * AGGIORNATO: Usa PostgreSQL come fonte di verità invece del file TXT obsoleto
 */

const pg = require('./pg-connection-manager');
const dbUnifiedPg = require('./db-unified-manager-pg');

// NOTA: Il movimento (SMALL/MEDIUM/LARGE) viene letto direttamente dal campo
// 'movimento' in wallet_positions. Non usiamo più soglie hardcoded perché
// le posizioni possono passare da un movimento all'altro (es. MEDIUM→LARGE).
// Le costanti seguenti sono mantenute solo per compatibilità legacy.

/**
 * Cerca posizioni nel database PostgreSQL
 * @param {string|number} query - Numero posizione o wallet
 * @returns {Promise<Array>} Array di posizioni trovate
 */
async function searchPositions(query) {
    try {
        await pg.initDatabase();
        const pool = pg.getPool();
        
        // Prova a parsare come numero
        const posNum = parseInt(query);
        
        if (!isNaN(posNum)) {
            // Cerca per numero posizione
            const result = await pool.query(`
                SELECT 
                    wp.posizione,
                    wp.wallet,
                    wp.movimento,
                    wp.molecola,
                    wp.generazione,
                    wp.ruolo,
                    wp.posizione_in_molecola,
                    wp.stato,
                    wm.nome,
                    wm.tipo
                FROM wallet_positions wp
                LEFT JOIN wallet_master wm ON wp.wallet = wm.wallet
                WHERE wp.posizione = $1
                LIMIT 1
            `, [posNum]);
            
            return result.rows;
        } else {
            // Cerca per wallet (partial match)
            const queryLower = String(query).toLowerCase();
            const result = await pool.query(`
                SELECT 
                    wp.posizione,
                    wp.wallet,
                    wp.movimento,
                    wp.molecola,
                    wp.generazione,
                    wp.ruolo,
                    wp.posizione_in_molecola,
                    wp.stato,
                    wm.nome,
                    wm.tipo
                FROM wallet_positions wp
                LEFT JOIN wallet_master wm ON wp.wallet = wm.wallet
                WHERE LOWER(wp.wallet) LIKE $1
                ORDER BY wp.posizione DESC
                LIMIT 10
            `, [`%${queryLower}%`]);
            
            return result.rows;
        }
    } catch (error) {
        console.error('Error searching positions in PostgreSQL:', error);
        return [];
    }
}

/**
 * Cerca una o più posizioni (ASYNC - usa PostgreSQL)
 * @param {string|number} query - Numero posizione o wallet
 * @returns {Promise<Object>} Risultato ricerca
 */
async function lookupPosition(query) {
    try {
        const positions = await searchPositions(query);
        
        if (positions.length === 0) {
            return { 
                success: false, 
                message: 'Posizione non trovata. Verifica numero o wallet.' 
            };
        }
        
        // Se cerca per wallet, restituisci tutte le posizioni trovate
        const isNumber = !isNaN(parseInt(query));
        
        if (isNumber) {
            // Ricerca per numero: restituisci singola posizione
            const found = positions[0];
            return {
                success: true,
                position: {
                    posizione: found.posizione,
                    nome: found.nome || 'N/A',
                    wallet: found.wallet,
                    tipo: found.tipo || 'HUMAN',
                    movimento: found.movimento,
                    molecola: found.molecola,
                    generazione: found.generazione,
                    ruolo: found.ruolo,
                    posizione_in_molecola: found.posizione_in_molecola,
                    stato: found.stato
                }
            };
        } else {
            // Ricerca per wallet: restituisci tutte le posizioni
            return {
                success: true,
                count: positions.length,
                positions: positions.map(p => ({
                    posizione: p.posizione,
                    nome: p.nome || 'N/A',
                    wallet: p.wallet,
                    tipo: p.tipo || 'HUMAN',
                    movimento: p.movimento,
                    molecola: p.molecola,
                    generazione: p.generazione,
                    ruolo: p.ruolo,
                    posizione_in_molecola: p.posizione_in_molecola,
                    stato: p.stato
                }))
            };
        }
    } catch (error) {
        console.error('Error in lookupPosition:', error);
        return {
            success: false,
            message: 'Errore durante la ricerca: ' + error.message
        };
    }
}

module.exports = {
    lookupPosition
};
