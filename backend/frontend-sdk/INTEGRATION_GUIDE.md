# 🎨 ROG Frontend SDK - Guida Integrazione Webflow

## 📋 Panoramica

Questo SDK permette di leggere dati direttamente dallo smart contract ROGDao su Polygon **senza passare dal backend**, eliminando il 70-80% dei costi RPC.

### ✅ Vantaggi:
- **Zero costi per ROG** - gli utenti usano il loro provider MetaMask
- **Più veloce** - nessun hop backend
- **Sempre aggiornato** - dati real-time dalla blockchain
- **Più sicuro** - nessun intermediario

---

## 🚀 Setup Iniziale

### 1. Includere ethers.js nel progetto Webflow

Aggiungi nel `<head>` del sito o nella pagina Custom Code (Before `</body>`):

```html
<!-- ethers.js v5 (CDN) -->
<script src="https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js"></script>

<!-- ROG Frontend SDK -->
<script src="https://yourdomain.com/rog-frontend-sdk.js"></script>
```

### 2. Verifica caricamento

Apri la console del browser e verifica:

```javascript
console.log(window.ROGSDK);
// Deve mostrare: ROGFrontendSDK { provider: null, contract: null, ... }
```

---

## 📖 Esempi di Utilizzo

### Esempio 1: Mostrare posizioni utente nell'Area Personale

```html
<!-- HTML Webflow -->
<div id="user-positions">
  <div class="loading">Caricamento posizioni...</div>
  <div class="positions-list" style="display: none;"></div>
</div>

<script>
// Ottieni wallet dell'utente (es: da MetaMask o URL parameter)
const userWallet = '0x...'; // Wallet address utente loggato

// Inizializza SDK e leggi posizioni
async function loadUserPositions() {
  try {
    // Inizializza SDK (read-only, non serve MetaMask connesso)
    await window.ROGSDK.init(false);
    
    // Leggi posizioni dallo smart contract
    const result = await window.ROGSDK.getUserPositions(userWallet);
    
    if (result.success) {
      displayPositions(result.posizioni);
    } else {
      console.error('Errore:', result.error);
      showError('Impossibile caricare le posizioni');
    }
    
  } catch (error) {
    console.error('Errore:', error);
    showError('Errore di connessione');
  }
}

function displayPositions(positions) {
  const container = document.querySelector('.positions-list');
  const loading = document.querySelector('.loading');
  
  loading.style.display = 'none';
  container.style.display = 'block';
  
  if (positions.length === 0) {
    container.innerHTML = '<p>Nessuna posizione attiva</p>';
    return;
  }
  
  // Crea HTML per ogni posizione
  const html = positions.map(pos => `
    <div class="position-card">
      <div class="position-number">#${pos.posizione}</div>
      <div class="position-details">
        <p><strong>Movimento:</strong> ${pos.movimento}</p>
        <p><strong>Molecola:</strong> ${pos.molecola}</p>
        <p><strong>Generazione:</strong> ${pos.generazione}</p>
        <p><strong>Ruolo:</strong> ${pos.ruolo}</p>
        <p><strong>Stato:</strong> <span class="badge-${pos.stato.toLowerCase()}">${pos.stato}</span></p>
      </div>
    </div>
  `).join('');
  
  container.innerHTML = html;
}

function showError(message) {
  const container = document.querySelector('#user-positions');
  container.innerHTML = `<div class="error-message">${message}</div>`;
}

// Carica posizioni all'apertura pagina
loadUserPositions();
</script>
```

---

### Esempio 2: Statistiche Invitati

```html
<div id="user-invites">
  <h3>I tuoi invitati</h3>
  <div class="stats">
    <div class="stat-box">
      <span class="stat-label">Totale Invitati</span>
      <span class="stat-value" id="total-invites">-</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">Invitati LARGE</span>
      <span class="stat-value" id="large-invites">-</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">Invitati SMALL</span>
      <span class="stat-value" id="small-invites">-</span>
    </div>
  </div>
  <div id="invites-list"></div>
</div>

<script>
async function loadUserInvites(wallet) {
  try {
    await window.ROGSDK.init(false);
    
    const result = await window.ROGSDK.getUserInvitati(wallet);
    
    if (result.success) {
      // Aggiorna statistiche
      document.getElementById('total-invites').textContent = result.totaleInvitati;
      document.getElementById('large-invites').textContent = result.invitatiLARGE;
      document.getElementById('small-invites').textContent = result.invitatiSMALL;
      
      // Mostra lista invitati
      const listHtml = result.invitati.map(inv => `
        <div class="invite-item">
          <span class="wallet-address">${inv.wallet.slice(0, 6)}...${inv.wallet.slice(-4)}</span>
          <span class="movement-badge">${inv.movimento}</span>
        </div>
      `).join('');
      
      document.getElementById('invites-list').innerHTML = listHtml;
    }
    
  } catch (error) {
    console.error('Errore caricamento invitati:', error);
  }
}

// Uso
const userWallet = '0x...';
loadUserInvites(userWallet);
</script>
```

---

### Esempio 3: Verifica ZK-KYC con Badge Dinamico

```html
<div id="zkkyc-status">
  <span class="zkkyc-label">ZK-KYC:</span>
  <span id="zkkyc-badge" class="badge">Verifica in corso...</span>
</div>

<script>
async function checkUserZKKYC(wallet) {
  try {
    await window.ROGSDK.init(false);
    
    const result = await window.ROGSDK.checkZKKYC(wallet);
    
    const badge = document.getElementById('zkkyc-badge');
    
    if (result.success) {
      if (result.hasVerification) {
        badge.textContent = '✅ Verificato';
        badge.className = 'badge badge-success';
      } else {
        badge.textContent = '❌ Non verificato';
        badge.className = 'badge badge-warning';
      }
    } else {
      badge.textContent = '⚠️ Errore';
      badge.className = 'badge badge-error';
    }
    
  } catch (error) {
    console.error('Errore verifica ZK-KYC:', error);
  }
}

// Uso
checkUserZKKYC('0x...');
</script>
```

---

### Esempio 4: Dashboard Completo Utente

```html
<div id="user-dashboard">
  <div class="dashboard-header">
    <h2>Area Personale</h2>
    <button id="connect-wallet-btn">Connetti Wallet</button>
  </div>
  
  <div id="dashboard-content" style="display: none;">
    <div class="user-stats">
      <div class="stat">
        <label>Posizioni Attive</label>
        <span id="total-positions">-</span>
      </div>
      <div class="stat">
        <label>Totale Donato</label>
        <span id="total-donated">-</span>
      </div>
      <div class="stat">
        <label>Totale Ricevuto</label>
        <span id="total-received">-</span>
      </div>
      <div class="stat">
        <label>NFT RGx</label>
        <span id="rgx-tokens">-</span>
      </div>
    </div>
    
    <div id="positions-container"></div>
  </div>
</div>

<script>
// Gestione connessione wallet
document.getElementById('connect-wallet-btn').addEventListener('click', async () => {
  try {
    // Connetti a MetaMask
    const result = await window.ROGSDK.init(true);
    
    if (result.success && result.connected) {
      console.log('Connesso:', result.address);
      await loadUserDashboard(result.address);
      
      document.querySelector('.dashboard-header h2').textContent = 
        `Benvenuto ${result.address.slice(0, 6)}...${result.address.slice(-4)}`;
      
      document.getElementById('dashboard-content').style.display = 'block';
      document.getElementById('connect-wallet-btn').textContent = 'Disconnetti';
    }
    
  } catch (error) {
    console.error('Errore connessione:', error);
    alert('Errore connessione wallet. Assicurati di avere MetaMask installato.');
  }
});

async function loadUserDashboard(wallet) {
  try {
    // Carica dati utente
    const userData = await window.ROGSDK.getUserData(wallet);
    const positions = await window.ROGSDK.getUserPositions(wallet);
    
    if (userData.success) {
      document.getElementById('total-donated').textContent = 
        `${userData.totalDonated} USDC`;
      document.getElementById('total-received').textContent = 
        `${userData.totalReceived} USDC`;
      document.getElementById('rgx-tokens').textContent = 
        userData.rgxTokensOwned;
    }
    
    if (positions.success) {
      document.getElementById('total-positions').textContent = 
        positions.totalePosizioniAttive;
      
      displayPositionsGrid(positions.posizioni);
    }
    
  } catch (error) {
    console.error('Errore caricamento dashboard:', error);
  }
}

function displayPositionsGrid(positions) {
  const container = document.getElementById('positions-container');
  
  const html = positions.map(pos => `
    <div class="position-card-grid">
      <div class="position-header">
        <span class="position-id">#${pos.posizione}</span>
        <span class="movement-badge ${pos.movimento.toLowerCase()}">${pos.movimento}</span>
      </div>
      <div class="position-body">
        <div class="info-row">
          <span class="label">Molecola:</span>
          <span class="value">${pos.molecola}</span>
        </div>
        <div class="info-row">
          <span class="label">Generazione:</span>
          <span class="value">${pos.generazione}</span>
        </div>
        <div class="info-row">
          <span class="label">Ruolo:</span>
          <span class="value">${pos.ruolo}</span>
        </div>
      </div>
      <div class="position-footer">
        <span class="status-badge ${pos.stato.toLowerCase()}">${pos.stato}</span>
      </div>
    </div>
  `).join('');
  
  container.innerHTML = `<div class="positions-grid">${html}</div>`;
}
</script>

<style>
.positions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  margin-top: 30px;
}

.position-card-grid {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  padding: 20px;
  transition: transform 0.2s;
}

.position-card-grid:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.movement-badge.small { background: #4CAF50; }
.movement-badge.medium { background: #FF9800; }
.movement-badge.large { background: #2196F3; }

.status-badge.attivo { color: #4CAF50; }
.status-badge.inattivo { color: #9E9E9E; }
</style>
```

---

## 🔧 API Reference

### `ROGSDK.init(connectWallet)`

Inizializza SDK e connette a Polygon.

**Parametri:**
- `connectWallet` (boolean): Se `true`, richiede connessione MetaMask

**Ritorna:**
```javascript
{
  success: true,
  connected: true,
  address: "0x...",
  network: "Polygon Mainnet"
}
```

---

### `ROGSDK.getUserPositions(wallet)`

Legge posizioni attive di un wallet.

**Parametri:**
- `wallet` (string): Indirizzo wallet (opzionale se MetaMask connesso)

**Ritorna:**
```javascript
{
  success: true,
  totalePosizioniAttive: 5,
  posizioni: [
    {
      posizione: 100,
      wallet: "0x...",
      movimento: "SMALL",
      molecola: 20,
      generazione: 7,
      ruolo: "RICEVENTE",
      stato: "ATTIVO"
    },
    ...
  ]
}
```

---

### `ROGSDK.getUserInvitati(wallet)`

Ottiene statistiche invitati.

**Ritorna:**
```javascript
{
  success: true,
  totaleInvitati: 10,
  numeroInvitati: 10,
  invitatiLARGE: 3,
  invitatiSMALL: 7,
  invitati: [
    {
      wallet: "0x...",
      posizione: null,
      movimento: "SMALL"
    },
    ...
  ]
}
```

---

### `ROGSDK.checkZKKYC(wallet)`

Verifica stato ZK-KYC.

**Ritorna:**
```javascript
{
  success: true,
  hasVerification: true,
  wallet: "0x..."
}
```

---

### `ROGSDK.getUserData(wallet)`

Ottiene dati completi utente.

**Ritorna:**
```javascript
{
  success: true,
  wallet: "0x...",
  totalDonated: "100.50", // USDC
  totalReceived: "50.25",
  rgxTokensOwned: 25,
  hasZKKYC: true,
  zkKYCTimestamp: 1704067200,
  registrationTime: 1704067200,
  isActive: true,
  donationCount: 5
}
```

---

## 🎯 Migrazione da Backend API a Frontend SDK

### Prima (Backend):
```javascript
// Chiamata backend (costa RPC calls)
const response = await fetch('https://backend.rog.com/api/user-positions/0x...');
const data = await response.json();
```

### Dopo (Frontend SDK):
```javascript
// Chiamata diretta smart contract (gratis)
await window.ROGSDK.init(false);
const data = await window.ROGSDK.getUserPositions('0x...');
```

---

## 💰 Risparmio Costi

### Scenario con 1000 utenti/giorno che visitano Area Personale:

**Prima (tutto backend):**
- 1000 users × 3 query (positions, invites, zkkyc) = 3000 RPC calls/giorno
- 3000 × 30 giorni = 90,000 calls/mese
- Costo stimato: **~$40/mese**

**Dopo (frontend SDK):**
- Backend: 0 RPC calls
- Frontend: Gli utenti usano il loro provider
- Costo: **$0/mese** ✨

---

## ⚠️ Note Importanti

1. **Smart Contract non cambia** - è lo stesso già deployato
2. **Backend mantiene operazioni privilegiate** - minting NFT, distributions
3. **Compatibilità** - funziona con tutti i wallet Web3 (MetaMask, WalletConnect, ecc.)
4. **Fallback** - Se l'utente non ha wallet, usa RPC pubblici read-only
5. **Privacy** - I dati sono pubblici sulla blockchain, nessun dato sensibile esposto

---

## 🆘 Troubleshooting

### "ethers is not defined"
Assicurati di aver incluso ethers.js prima di rog-frontend-sdk.js

### "Cannot read property 'request' of undefined"
L'utente non ha MetaMask installato. Usa `init(false)` per read-only mode.

### "Wrong network"
L'SDK switcha automaticamente a Polygon. Se fallisce, chiedi all'utente di cambiare network manualmente.

---

## 📞 Supporto

Per domande o problemi:
- GitHub Issues: [link]
- Email: support@rog.com
- Docs: https://docs.rog.com
