/**
 * Gallery Manager Local - Gestione galleria ROG con storage JSON locale
 * Supporta: immagini (JPEG, PNG), video (MP4), PDF, testo, link
 */

const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

// Directory
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'gallery');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery-data.json');

// Assicura che le directory esistano
async function ensureDirectories() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.mkdir(path.join(UPLOADS_DIR, 'images'), { recursive: true });
    await fs.mkdir(path.join(UPLOADS_DIR, 'videos'), { recursive: true });
    await fs.mkdir(path.join(UPLOADS_DIR, 'documents'), { recursive: true });
  } catch (err) {
    // Ignora se già esistono
  }
}

// Inizializza
ensureDirectories();

/**
 * Legge i dati della galleria
 */
async function readGalleryData() {
  try {
    const data = await fs.readFile(GALLERY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Se non esiste, crea struttura vuota
    const defaultData = { success: true, items: [] };
    await writeGalleryData(defaultData);
    return defaultData;
  }
}

/**
 * Scrive i dati della galleria
 */
async function writeGalleryData(data) {
  await fs.writeFile(GALLERY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Ottiene tutti gli items (opzionalmente filtrati per pubblicati)
 */
async function getItems(publishedOnly = false) {
  const data = await readGalleryData();
  if (publishedOnly) {
    return data.items.filter(item => item.is_published);
  }
  return data.items;
}

/**
 * Ottiene un singolo item per ID
 */
async function getItemById(id) {
  const data = await readGalleryData();
  return data.items.find(item => item.id === id);
}

/**
 * Aggiunge un nuovo item alla galleria
 */
async function addItem(itemData) {
  const data = await readGalleryData();
  
  const newItem = {
    id: uuidv4(),
    type: itemData.type || 'image',
    title: itemData.title || 'Senza titolo',
    description: itemData.description || '',
    file_url: itemData.file_url || '',
    tags: itemData.tags || [],
    is_published: itemData.is_published !== false,
    views_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  data.items.unshift(newItem); // Aggiungi in cima
  await writeGalleryData(data);
  
  return newItem;
}

/**
 * Aggiorna un item esistente
 */
async function updateItem(id, updateData) {
  const data = await readGalleryData();
  const index = data.items.findIndex(item => item.id === id);
  
  if (index === -1) {
    return null;
  }

  data.items[index] = {
    ...data.items[index],
    ...updateData,
    updated_at: new Date().toISOString()
  };

  await writeGalleryData(data);
  return data.items[index];
}

/**
 * Elimina un item
 */
async function deleteItem(id) {
  const data = await readGalleryData();
  const index = data.items.findIndex(item => item.id === id);
  
  if (index === -1) {
    return false;
  }

  // Rimuovi file se esiste
  const item = data.items[index];
  if (item.file_url && !item.file_url.startsWith('http')) {
    try {
      const filePath = path.join(__dirname, item.file_url);
      await fs.unlink(filePath);
    } catch (err) {
      // Ignora errori di eliminazione file
    }
  }

  data.items.splice(index, 1);
  await writeGalleryData(data);
  return true;
}

/**
 * Incrementa il contatore visualizzazioni
 */
async function incrementViews(id) {
  const data = await readGalleryData();
  const index = data.items.findIndex(item => item.id === id);
  
  if (index !== -1) {
    data.items[index].views_count = (data.items[index].views_count || 0) + 1;
    await writeGalleryData(data);
  }
}

/**
 * Determina la sottocartella in base al tipo di file
 */
function getUploadSubfolder(mimetype) {
  if (mimetype.startsWith('image/')) return 'images';
  if (mimetype.startsWith('video/')) return 'videos';
  return 'documents';
}

/**
 * Determina il tipo di contenuto dal mimetype
 */
function getContentType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype === 'application/pdf') return 'document';
  return 'document';
}

/**
 * Inizializza la galleria (per compatibilità con api-server.js)
 */
async function initGalleryTable() {
  await ensureDirectories();
  await readGalleryData();
  console.log('✅ Gallery local storage initialized');
}

module.exports = {
  UPLOADS_DIR,
  DATA_DIR,
  ensureDirectories,
  initGalleryTable,
  readGalleryData,
  writeGalleryData,
  getItems,
  getItemById,
  addItem,
  updateItem,
  deleteItem,
  incrementViews,
  getUploadSubfolder,
  getContentType
};
