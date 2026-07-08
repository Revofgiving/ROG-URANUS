/**
 * 📸 ROG MEDIA UPLOAD MANAGER
 * 
 * Gestisce upload di immagini e media files dall'Admin Panel.
 * Lo staff può caricare immagini senza accesso FTP/SSH.
 * 
 * FEATURES:
 * - Upload drag-and-drop
 * - Preview immagini
 * - Gestione cartelle img/
 * - Validazione tipo file e dimensione
 * - Lista media caricati
 * - Eliminazione media
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 * @date 19 Novembre 2025
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

// ========================================
// CONFIGURAZIONE
// ========================================

const UPLOAD_DIR = path.join(__dirname, '..', 'img');
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per video

// Tipi di file consentiti per upload media
const ALLOWED_TYPES = [
  // Immagini
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  // Video
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
  // Audio
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  // Documenti
  'application/pdf'
];

const ALLOWED_EXTENSIONS = [
  // Immagini
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  // Video
  '.mp4', '.webm', '.mov', '.avi',
  // Audio
  '.mp3', '.wav', '.ogg', '.m4a',
  // Documenti
  '.pdf'
];

// ========================================
// MULTER STORAGE CONFIGURATION
// ========================================

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Crea directory se non esiste
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    } catch (error) {
      cb(error);
    }
  },
  
  filename: (req, file, cb) => {
    // Genera nome sicuro: timestamp + hash + estensione originale
    const ext = path.extname(file.originalname).toLowerCase();
    const timestamp = Date.now();
    const hash = crypto.randomBytes(8).toString('hex');
    const safeName = `${timestamp}-${hash}${ext}`;
    cb(null, safeName);
  }
});

// File filter per validazione
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (ALLOWED_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo file non consentito. Usa: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }
};

// Multer upload instance
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: fileFilter
});

// ========================================
// CLASSE MEDIA UPLOAD MANAGER
// ========================================

class MediaUploadManager {
  constructor() {
    this.uploadDir = UPLOAD_DIR;
    this.initialized = false;
  }

  /**
   * Inizializza il manager
   */
  async init() {
    if (this.initialized) return;

    console.log('📸 Inizializzazione Media Upload Manager...');

    // Crea directory upload se non esiste
    await fs.mkdir(this.uploadDir, { recursive: true });

    this.initialized = true;
    console.log('✅ Media Upload Manager pronto');
    console.log(`   Upload directory: ${this.uploadDir}`);
  }

  /**
   * Lista tutti i media caricati
   */
  async listMedia() {
    await this.init();

    try {
      const files = await fs.readdir(this.uploadDir);
      
      const mediaList = await Promise.all(
        files
          .filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ALLOWED_EXTENSIONS.includes(ext);
          })
          .map(async (file) => {
            const filePath = path.join(this.uploadDir, file);
            const stats = await fs.stat(filePath);
            
            return {
              filename: file,
              path: `/img/${file}`,
              size: stats.size,
              sizeFormatted: this.formatBytes(stats.size),
              uploadedAt: stats.birthtime,
              type: path.extname(file).toLowerCase().substring(1)
            };
          })
      );

      // Ordina per data (più recenti prima)
      mediaList.sort((a, b) => b.uploadedAt - a.uploadedAt);

      return mediaList;
    } catch (error) {
      console.error('❌ Errore lista media:', error.message);
      return [];
    }
  }

  /**
   * Elimina media
   */
  async deleteMedia(filename) {
    await this.init();

    // Validazione nome file (security)
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Nome file non valido');
    }

    const filePath = path.join(this.uploadDir, filename);

    try {
      // Verifica esistenza
      await fs.access(filePath);
      
      // Elimina
      await fs.unlink(filePath);
      
      console.log(`✅ Media eliminato: ${filename}`);
      return { success: true, message: 'Media eliminato con successo' };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('File non trovato');
      }
      throw error;
    }
  }

  /**
   * Rinomina media
   */
  async renameMedia(oldFilename, newFilename) {
    await this.init();

    // Validazione nomi (security)
    if (oldFilename.includes('..') || newFilename.includes('..') ||
        oldFilename.includes('/') || newFilename.includes('/')) {
      throw new Error('Nome file non valido');
    }

    // Preserva estensione originale
    const ext = path.extname(oldFilename);
    const newName = path.basename(newFilename, path.extname(newFilename)) + ext;

    const oldPath = path.join(this.uploadDir, oldFilename);
    const newPath = path.join(this.uploadDir, newName);

    try {
      await fs.rename(oldPath, newPath);
      
      console.log(`✅ Media rinominato: ${oldFilename} → ${newName}`);
      return {
        success: true,
        message: 'Media rinominato con successo',
        newFilename: newName,
        newPath: `/img/${newName}`
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('File non trovato');
      }
      throw error;
    }
  }

  /**
   * Statistiche upload
   */
  async getStats() {
    await this.init();

    const mediaList = await this.listMedia();
    
    const totalSize = mediaList.reduce((sum, media) => sum + media.size, 0);
    
    const typeCount = mediaList.reduce((acc, media) => {
      acc[media.type] = (acc[media.type] || 0) + 1;
      return acc;
    }, {});

    return {
      totalFiles: mediaList.length,
      totalSize: totalSize,
      totalSizeFormatted: this.formatBytes(totalSize),
      typeCount: typeCount,
      recentUploads: mediaList.slice(0, 5)
    };
  }

  /**
   * Formatta bytes in formato leggibile
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// ========================================
// REGISTRAZIONE ENDPOINTS EXPRESS
// ========================================

function registerMediaUploadEndpoints(app, authMiddleware) {
  const manager = new MediaUploadManager();

  /**
   * Upload media (POST /api/admin/media/upload)
   * 
   * Multipart form-data con campo 'media'
   */
  app.post('/api/admin/media/upload', authMiddleware, upload.single('media'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Nessun file caricato'
        });
      }

      console.log(`📸 Media caricato: ${req.file.filename}`);

      res.json({
        success: true,
        message: 'Media caricato con successo',
        media: {
          filename: req.file.filename,
          path: `/img/${req.file.filename}`,
          size: req.file.size,
          sizeFormatted: manager.formatBytes(req.file.size),
          mimetype: req.file.mimetype
        }
      });
    } catch (error) {
      console.error('❌ Errore upload media:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Lista media (GET /api/admin/media/list)
   */
  app.get('/api/admin/media/list', authMiddleware, async (req, res) => {
    try {
      const mediaList = await manager.listMedia();
      
      res.json({
        success: true,
        media: mediaList,
        count: mediaList.length
      });
    } catch (error) {
      console.error('❌ Errore lista media:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Elimina media (DELETE /api/admin/media/:filename)
   */
  app.delete('/api/admin/media/:filename', authMiddleware, async (req, res) => {
    try {
      const result = await manager.deleteMedia(req.params.filename);
      res.json(result);
    } catch (error) {
      console.error('❌ Errore eliminazione media:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Rinomina media (PUT /api/admin/media/:filename/rename)
   */
  app.put('/api/admin/media/:filename/rename', authMiddleware, async (req, res) => {
    try {
      const { newFilename } = req.body;
      
      if (!newFilename) {
        return res.status(400).json({
          success: false,
          error: 'Nuovo nome file richiesto'
        });
      }

      const result = await manager.renameMedia(req.params.filename, newFilename);
      res.json(result);
    } catch (error) {
      console.error('❌ Errore rinomina media:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Statistiche media (GET /api/admin/media/stats)
   */
  app.get('/api/admin/media/stats', authMiddleware, async (req, res) => {
    try {
      const stats = await manager.getStats();
      
      res.json({
        success: true,
        stats: stats
      });
    } catch (error) {
      console.error('❌ Errore statistiche media:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  console.log('📸 Endpoint Media Upload registrati');
  console.log('   POST   /api/admin/media/upload');
  console.log('   GET    /api/admin/media/list');
  console.log('   DELETE /api/admin/media/:filename');
  console.log('   PUT    /api/admin/media/:filename/rename');
  console.log('   GET    /api/admin/media/stats');
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  MediaUploadManager,
  registerMediaUploadEndpoints,
  upload
};
