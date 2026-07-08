/**
 * Gallery API Local - Endpoints per galleria ROG
 * Supporta: immagini (JPEG, PNG, GIF, WebP), video (MP4, WebM), PDF, testo, link
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const galleryManager = require('./gallery-manager-local');

const router = express.Router();

// Configurazione multer per upload multi-tipo
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subfolder = galleryManager.getUploadSubfolder(file.mimetype);
    const destPath = path.join(galleryManager.UPLOADS_DIR, subfolder);
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    // Tipi di file permessi
    const allowedTypes = [
      // Immagini
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      // Video
      'video/mp4', 'video/webm', 'video/quicktime',
      // Audio
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      // Documenti
      'application/pdf'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo file non supportato: ${file.mimetype}. Supportati: immagini, video, audio, PDF`));
    }
  }
});

// ============================================
// GET /api/gallery - Lista items
// ============================================
router.get('/', async (req, res) => {
  try {
    const publishedOnly = req.query.published === 'true';
    const items = await galleryManager.getItems(publishedOnly);
    res.json({ success: true, items });
  } catch (error) {
    console.error('Error fetching gallery:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET /api/gallery/:id - Singolo item
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const item = await galleryManager.getItemById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item non trovato' });
    }
    // Incrementa visualizzazioni
    await galleryManager.incrementViews(req.params.id);
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// POST /api/gallery - Aggiungi nuovo item
// ============================================
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { type, title, description, file_url, tags, is_published } = req.body;

    // Determina tipo e URL file
    let itemType = type || 'text';
    let fileUrl = file_url || '';

    // Se è stato caricato un file
    if (req.file) {
      itemType = galleryManager.getContentType(req.file.mimetype);
      const subfolder = galleryManager.getUploadSubfolder(req.file.mimetype);
      fileUrl = `uploads/gallery/${subfolder}/${req.file.filename}`;
    }

    // Parse tags se stringa JSON
    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (e) {
        parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const newItem = await galleryManager.addItem({
      type: itemType,
      title: title || 'Senza titolo',
      description: description || '',
      file_url: fileUrl,
      tags: parsedTags,
      is_published: is_published !== 'false' && is_published !== false
    });

    console.log('✅ Nuovo item galleria aggiunto:', newItem.id, newItem.title);
    res.json({ success: true, item: newItem });
  } catch (error) {
    console.error('Error adding gallery item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// PUT /api/gallery/:id - Aggiorna item
// ============================================
router.put('/:id', async (req, res) => {
  try {
    const { title, description, tags, is_published, file_url } = req.body;

    // Parse tags se necessario
    let parsedTags;
    if (tags !== undefined) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (e) {
        parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (parsedTags !== undefined) updateData.tags = parsedTags;
    if (is_published !== undefined) updateData.is_published = is_published === true || is_published === 'true';
    if (file_url !== undefined) updateData.file_url = file_url;

    const updatedItem = await galleryManager.updateItem(req.params.id, updateData);

    if (!updatedItem) {
      return res.status(404).json({ success: false, error: 'Item non trovato' });
    }

    console.log('✅ Item galleria aggiornato:', req.params.id);
    res.json({ success: true, item: updatedItem });
  } catch (error) {
    console.error('Error updating gallery item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// DELETE /api/gallery/:id - Elimina item
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await galleryManager.deleteItem(req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Item non trovato' });
    }

    console.log('✅ Item galleria eliminato:', req.params.id);
    res.json({ success: true, message: 'Item eliminato con successo' });
  } catch (error) {
    console.error('Error deleting gallery item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
