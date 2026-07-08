/**
 * Gallery Manager - Gestione immagini galleria ROG
 * 
 * Usa Cloudinary come CDN per immagini/video/audio.
 * I file vengono caricati su Cloudinary e l'URL permanente
 * viene salvato in PostgreSQL.
 */

const path = require('path');
const fs = require('fs').promises;
const pg = require('./pg-connection-manager');

// 🌩️ CLOUDINARY
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'djrwj3ufm',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Directory temporanea per upload (multer salva qui, poi upload su Cloudinary)
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'gallery');
(async () => { try { await fs.mkdir(UPLOADS_DIR, { recursive: true }); } catch (_) {} })();

/**
 * Inizializza tabella gallery in PostgreSQL
 */
async function initGalleryTable() {
  try {
    const pool = pg.getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gallery (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        title VARCHAR(255),
        description TEXT,
        category VARCHAR(100),
        cloudinary_url TEXT,
        cloudinary_public_id VARCHAR(255),
        file_type VARCHAR(50),
        uploaded_at TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      )
    `);
    // Aggiungi colonne Cloudinary se non esistono (per DB già creati)
    try {
      await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS cloudinary_url TEXT`);
      await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS cloudinary_public_id VARCHAR(255)`);
      await pool.query(`ALTER TABLE gallery ADD COLUMN IF NOT EXISTS file_type VARCHAR(50)`);
    } catch (_) {}
    console.log('✅ Gallery table ready (Cloudinary)');
  } catch (error) {
    console.error('❌ Error creating gallery table:', error.message);
  }
}

/**
 * Upload file su Cloudinary
 * @param {string} filePath - Path locale del file
 * @param {string} resourceType - 'image', 'video', 'raw' (per audio/pdf)
 * @returns {Object} Risultato Cloudinary { secure_url, public_id }
 */
async function uploadToCloudinary(filePath, resourceType = 'auto') {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'rog-gallery',
      resource_type: resourceType,
      transformation: resourceType === 'image' ? [
        { quality: 'auto:good', fetch_format: 'auto' }
      ] : undefined
    });
    console.log(`✅ Cloudinary upload: ${result.secure_url}`);
    return result;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error.message);
    throw error;
  }
}

/**
 * Ottiene tutte le immagini della galleria
 */
async function getGalleryImages() {
  try {
    const pool = pg.getPool();
    const result = await pool.query(`
      SELECT * FROM gallery 
      WHERE is_active = true 
      ORDER BY uploaded_at DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching gallery:', error.message);
    return [];
  }
}

/**
 * Aggiunge un'immagine alla galleria (upload su Cloudinary + salva in DB)
 * @param {Object} imageData - { filePath, filename, originalName, title, description, category }
 */
async function addGalleryImage(imageData) {
  try {
    // Determina tipo risorsa per Cloudinary
    const ext = path.extname(imageData.originalName || imageData.filename).toLowerCase();
    let resourceType = 'auto';
    let fileType = 'image';
    if (['.mp4', '.webm', '.mov', '.avi'].includes(ext)) { resourceType = 'video'; fileType = 'video'; }
    else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) { resourceType = 'video'; fileType = 'audio'; }
    else if (['.pdf'].includes(ext)) { resourceType = 'raw'; fileType = 'document'; }

    // Upload su Cloudinary
    let cloudinaryUrl = null;
    let cloudinaryPublicId = null;
    const filePath = imageData.filePath || path.join(UPLOADS_DIR, imageData.filename);
    
    try {
      const cloudResult = await uploadToCloudinary(filePath, resourceType);
      cloudinaryUrl = cloudResult.secure_url;
      cloudinaryPublicId = cloudResult.public_id;
    } catch (cloudErr) {
      console.error('⚠️  Cloudinary fallito, uso path locale:', cloudErr.message);
      // Fallback: usa path locale (non ideale ma non blocca)
      cloudinaryUrl = null;
    }

    // Elimina file temporaneo locale dopo upload su Cloudinary
    if (cloudinaryUrl) {
      try { await fs.unlink(filePath); } catch (_) {}
    }

    // Salva in PostgreSQL
    const pool = pg.getPool();
    const result = await pool.query(`
      INSERT INTO gallery (filename, original_name, title, description, category, cloudinary_url, cloudinary_public_id, file_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      imageData.filename,
      imageData.originalName,
      imageData.title,
      imageData.description,
      imageData.category,
      cloudinaryUrl,
      cloudinaryPublicId,
      fileType
    ]);
    return result.rows[0];
  } catch (error) {
    console.error('Error adding gallery image:', error.message);
    throw error;
  }
}

/**
 * Aggiorna un'immagine della galleria
 */
async function updateGalleryImage(id, updateData) {
  try {
    const pool = pg.getPool();
    const result = await pool.query(`
      UPDATE gallery 
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          category = COALESCE($3, category)
      WHERE id = $4
      RETURNING *
    `, [updateData.title, updateData.description, updateData.category, id]);
    return result.rows[0];
  } catch (error) {
    console.error('Error updating gallery image:', error.message);
    throw error;
  }
}

/**
 * Elimina un'immagine dalla galleria (soft delete + elimina da Cloudinary)
 */
async function deleteGalleryImage(id) {
  try {
    const pool = pg.getPool();
    // Recupera public_id per eliminare da Cloudinary
    const existing = await pool.query('SELECT cloudinary_public_id, file_type FROM gallery WHERE id = $1', [id]);
    if (existing.rows[0]?.cloudinary_public_id) {
      try {
        const resType = existing.rows[0].file_type === 'image' ? 'image' : 'video';
        await cloudinary.uploader.destroy(existing.rows[0].cloudinary_public_id, { resource_type: resType });
        console.log(`✅ Eliminato da Cloudinary: ${existing.rows[0].cloudinary_public_id}`);
      } catch (e) {
        console.warn('⚠️  Errore eliminazione Cloudinary:', e.message);
      }
    }
    await pool.query('UPDATE gallery SET is_active = false WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('Error deleting gallery image:', error.message);
    throw error;
  }
}

module.exports = {
  UPLOADS_DIR,
  initGalleryTable,
  getGalleryImages,
  addGalleryImage,
  updateGalleryImage,
  deleteGalleryImage,
  uploadToCloudinary
};
