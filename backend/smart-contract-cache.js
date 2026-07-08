/**
 * 🚀 SMART CONTRACT CACHE LAYER
 * 
 * Riduce drasticamente i call RPC implementando caching intelligente
 * per dati che cambiano raramente o che possono essere letti in batch.
 * 
 * OTTIMIZZAZIONI:
 * - Cache in-memory per dati letti frequentemente
 * - TTL configurabile per tipo di dato
 * - Invalidazione automatica
 * - Batching delle richieste
 * 
 * @author Warp AI Agent
 * @version 1.0.0
 */

const NodeCache = require('node-cache');

// ========================================
// CONFIGURAZIONE CACHE
// ========================================

// TTL (Time To Live) in secondi per tipo di dato
const TTL_CONFIG = {
  // Dati che cambiano raramente
  donationData: 300,        // 5 minuti - le donazioni sono immutabili
  walletRole: 600,          // 10 minuti - i ruoli cambiano raramente
  contractConfig: 3600,     // 1 ora - configurazione contratto quasi statica
  
  // Dati che cambiano più frequentemente
  userPositions: 60,        // 1 minuto - posizioni possono cambiare
  userStats: 30,            // 30 secondi - statistiche aggiornate frequentemente
  
  // Dati dinamici con cache breve
  blockNumber: 10,          // 10 secondi - block number per throttling
  gasPrice: 15              // 15 secondi - gas price varia
};

// ========================================
// CACHE INSTANCES
// ========================================

class SmartContractCache {
  constructor() {
    // Cache principale con check period ogni 120s
    this.cache = new NodeCache({ 
      stdTTL: 60, 
      checkperiod: 120,
      useClones: false // Performance: non clonare oggetti
    });
    
    // Statistiche
    this.stats = {
      hits: 0,
      misses: 0,
      saves: 0,
      invalidations: 0
    };
    
    // Throttling per batch requests
    this.pendingBatches = new Map();
  }

  /**
   * Genera chiave cache unica
   */
  _makeKey(type, ...params) {
    return `${type}:${params.join(':')}`.toLowerCase();
  }

  /**
   * Get con fallback
   */
  async get(type, params, fetchFn, ttl = null) {
    const key = this._makeKey(type, ...params);
    
    // Cerca in cache
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.stats.hits++;
      return cached;
    }
    
    // Cache miss - fetch dai dati reali
    this.stats.misses++;
    const value = await fetchFn();
    
    // Salva in cache con TTL appropriato
    const cacheTTL = ttl || TTL_CONFIG[type] || 60;
    this.cache.set(key, value, cacheTTL);
    this.stats.saves++;
    
    return value;
  }

  /**
   * Set manuale con TTL custom
   */
  set(type, params, value, ttl = null) {
    const key = this._makeKey(type, ...params);
    const cacheTTL = ttl || TTL_CONFIG[type] || 60;
    this.cache.set(key, value, cacheTTL);
    this.stats.saves++;
  }

  /**
   * Invalidazione manuale
   */
  invalidate(type, ...params) {
    const key = this._makeKey(type, ...params);
    const deleted = this.cache.del(key);
    if (deleted > 0) {
      this.stats.invalidations++;
    }
    return deleted > 0;
  }

  /**
   * Invalidazione pattern (es: tutti i dati di un wallet)
   */
  invalidatePattern(pattern) {
    const keys = this.cache.keys();
    const matching = keys.filter(k => k.includes(pattern.toLowerCase()));
    const deleted = this.cache.del(matching);
    this.stats.invalidations += deleted;
    return deleted;
  }

  /**
   * Batch request con deduplicazione
   * Raggruppa richieste identiche fatte nello stesso momento
   */
  async batchGet(type, paramsArray, fetchFn, ttl = null) {
    const results = [];
    const toFetch = [];
    const toFetchIndices = [];
    
    // Prima pass: cerca in cache
    for (let i = 0; i < paramsArray.length; i++) {
      const params = paramsArray[i];
      const key = this._makeKey(type, ...params);
      const cached = this.cache.get(key);
      
      if (cached !== undefined) {
        this.stats.hits++;
        results[i] = cached;
      } else {
        toFetch.push(params);
        toFetchIndices.push(i);
      }
    }
    
    // Seconda pass: fetch mancanti in batch
    if (toFetch.length > 0) {
      this.stats.misses += toFetch.length;
      const fetched = await fetchFn(toFetch);
      
      const cacheTTL = ttl || TTL_CONFIG[type] || 60;
      
      for (let i = 0; i < toFetch.length; i++) {
        const params = toFetch[i];
        const value = fetched[i];
        const key = this._makeKey(type, ...params);
        
        this.cache.set(key, value, cacheTTL);
        this.stats.saves++;
        
        const resultIndex = toFetchIndices[i];
        results[resultIndex] = value;
      }
    }
    
    return results;
  }

  /**
   * Flush completo cache
   */
  flush() {
    this.cache.flushAll();
    console.log('🗑️  Cache svuotata completamente');
  }

  /**
   * Statistiche cache
   */
  getStats() {
    const keys = this.cache.keys();
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cachedKeys: keys.length,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    };
  }

  /**
   * Log periodico statistiche (chiamare ogni 5-10 minuti)
   */
  logStats() {
    const stats = this.getStats();
    console.log('📊 CACHE STATS:', JSON.stringify(stats, null, 2));
  }
}

// Singleton instance
const cache = new SmartContractCache();

// Log stats ogni 10 minuti
setInterval(() => cache.logStats(), 10 * 60 * 1000);

module.exports = cache;
