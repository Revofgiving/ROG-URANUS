/**
 * Gallery API Router - Endpoints per la galleria ROG
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const galleryManager = require('./gallery-manager');

const router = express.Router();

// Configurazione multer per upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, galleryManager.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Tipi di file consentiti per la galleria
const ALLOWED_EXTENSIONS = {
  image: ['jpeg', 'jpg', 'png', 'gif', 'webp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'avi'],
  audio: ['mp3', 'wav', 'ogg', 'm4a'],
  document: ['pdf']
};

const ALLOWED_MIMETYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'],
  document: ['application/pdf']
};

const getAllowedExtensions = () => Object.values(ALLOWED_EXTENSIONS).flat();
const getAllowedMimetypes = () => Object.values(ALLOWED_MIMETYPES).flat();

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per video
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mimetype = file.mimetype.toLowerCase();
    
    const isAllowedExt = getAllowedExtensions().includes(ext);
    const isAllowedMime = getAllowedMimetypes().includes(mimetype);
    
    if (isAllowedExt || isAllowedMime) {
      return cb(null, true);
    }
    cb(new Error(`Tipo file non permesso. Formati consentiti: immagini (${ALLOWED_EXTENSIONS.image.join(', ')}), video (${ALLOWED_EXTENSIONS.video.join(', ')}), audio (${ALLOWED_EXTENSIONS.audio.join(', ')}), documenti (${ALLOWED_EXTENSIONS.document.join(', ')})`));
  }
});

// GET /api/gallery - Lista immagini (con URL Cloudinary)
router.get('/', async (req, res) => {
  try {
    const images = await galleryManager.getGalleryImages();
    // Arricchisci con file_url per compatibilità frontend
    const enriched = images.map(img => ({
      ...img,
      file_url: img.cloudinary_url || `uploads/gallery/${img.filename}`,
      type: img.file_type || 'image'
    }));
    res.json({ success: true, images: enriched, items: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/gallery - Upload immagine (salva su Cloudinary)
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Nessun file caricato' });
    }

    const imageData = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      title: req.body.title || '',
      description: req.body.description || '',
      category: req.body.category || 'general'
    };

    const image = await galleryManager.addGalleryImage(imageData);
    res.json({ success: true, image });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/gallery/:id - Aggiorna immagine
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const image = await galleryManager.updateGalleryImage(id, req.body);
    if (!image) {
      return res.status(404).json({ success: false, message: 'Immagine non trovata' });
    }
    res.json({ success: true, image });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/gallery/:id - Elimina immagine
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await galleryManager.deleteGalleryImage(id);
    res.json({ success: true, message: 'Immagine eliminata' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
