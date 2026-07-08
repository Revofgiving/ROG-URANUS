/**
 * MAINTENANCE MANAGER
 * Gestisce lo stato di manutenzione del sito ROG.
 * 
 * - Permette di attivare/disattivare la manutenzione dal pannello admin
 * - Il pannello admin è SEMPRE accessibile
 * - Nessun costo: non richiede modifiche ENS
 */

const fs = require('fs').promises;
const path = require('path');

const MAINTENANCE_FILE = path.join(__dirname, 'data', 'maintenance-status.json');

class MaintenanceManager {
    constructor() {
        this.status = {
            enabled: false,
            message: 'Il sito è in manutenzione. Torneremo presto online!',
            startedAt: null,
            estimatedEndTime: null,
            allowedPaths: [
                '/admin-panel.html',
                '/api/admin/',
                '/api/auth/',
                '/api/site-status'
            ]
        };
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        
        try {
            await fs.mkdir(path.dirname(MAINTENANCE_FILE), { recursive: true });
            const data = await fs.readFile(MAINTENANCE_FILE, 'utf8');
            this.status = { ...this.status, ...JSON.parse(data) };
            console.log('✅ Maintenance status caricato:', this.status.enabled ? 'ATTIVO' : 'DISATTIVO');
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📝 Creazione maintenance status (default: disattivo)');
                await this.save();
            } else {
                console.error('❌ Errore caricamento maintenance status:', error);
            }
        }
        
        this.initialized = true;
    }

    async save() {
        await fs.mkdir(path.dirname(MAINTENANCE_FILE), { recursive: true });
        await fs.writeFile(MAINTENANCE_FILE, JSON.stringify(this.status, null, 2), 'utf8');
    }

    /**
     * Attiva la modalità manutenzione
     * @param {Object} options - Opzioni
     * @param {string} options.message - Messaggio personalizzato
     * @param {string} options.estimatedEndTime - Ora stimata fine manutenzione
     */
    async enableMaintenance(options = {}) {
        await this.init();
        
        this.status.enabled = true;
        this.status.startedAt = new Date().toISOString();
        
        if (options.message) {
            this.status.message = options.message;
        }
        if (options.estimatedEndTime) {
            this.status.estimatedEndTime = options.estimatedEndTime;
        }
        
        await this.save();
        console.log('🔧 MANUTENZIONE ATTIVATA');
        
        return this.status;
    }

    /**
     * Disattiva la modalità manutenzione
     */
    async disableMaintenance() {
        await this.init();
        
        this.status.enabled = false;
        this.status.startedAt = null;
        this.status.estimatedEndTime = null;
        
        await this.save();
        console.log('✅ MANUTENZIONE DISATTIVATA - Sito online');
        
        return this.status;
    }

    /**
     * Ottiene lo stato corrente
     */
    async getStatus() {
        await this.init();
        return {
            maintenance: this.status.enabled,
            message: this.status.message,
            startedAt: this.status.startedAt,
            estimatedEndTime: this.status.estimatedEndTime
        };
    }

    /**
     * Verifica se un path è autorizzato durante la manutenzione
     * @param {string} requestPath - Path della richiesta
     */
    isPathAllowed(requestPath) {
        // Admin panel e API admin sono SEMPRE accessibili
        return this.status.allowedPaths.some(allowed => 
            requestPath.startsWith(allowed) || requestPath.includes('admin')
        );
    }

    /**
     * Middleware Express per bloccare accesso durante manutenzione
     */
    middleware() {
        return async (req, res, next) => {
            await this.init();
            
            // Se manutenzione non attiva, passa
            if (!this.status.enabled) {
                return next();
            }
            
            // Se path è autorizzato (admin), passa
            if (this.isPathAllowed(req.path)) {
                return next();
            }
            
            // Se ha parametro segreto admin bypass, passa
            if (req.query.adminBypass === 'ROG2024Admin') {
                return next();
            }
            
            // Altrimenti blocca con messaggio manutenzione
            // Per API restituisce JSON, per pagine restituisce HTML
            if (req.path.startsWith('/api/')) {
                return res.status(503).json({
                    success: false,
                    maintenance: true,
                    message: this.status.message,
                    estimatedEndTime: this.status.estimatedEndTime
                });
            }
            
            // Per richieste normali, il frontend gestirà l'overlay
            return next();
        };
    }
}

const maintenanceManager = new MaintenanceManager();

module.exports = maintenanceManager;
