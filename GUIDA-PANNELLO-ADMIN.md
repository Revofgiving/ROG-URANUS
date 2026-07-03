# 🔐 GUIDA PANNELLO DI CONTROLLO — ROG-URANUS

Guida per lo staff su come accedere e usare il pannello admin.

---

## Come accedere

1. Apri il browser e vai all'indirizzo del sito, poi aggiungi `/admin/login`
   - Esempio: `https://tuodominio.com/admin/login`
2. Inserisci username e password forniti dall'amministratore
3. Clicca **🔐 Accedi**

> ⚠️ La sessione dura **24 ore**. Dopo 24 ore verrai disconnessa automaticamente.

---

## Panoramica delle sezioni

### 📊 Dashboard (Home)
La prima cosa che vedi dopo il login. Mostra:
- Numero di account totali nel sistema
- Uscite HUMAN e CASSA con totali in USDC
- Stato tavole, turni attivi, rientri in coda
- Si aggiorna automaticamente ogni 10 secondi

---

### 💎 Dono
Permette di effettuare donazioni di test/manuali:
- **Connetti MetaMask** → clicca il bottone e approva in MetaMask
- **Dona con MetaMask** → invia USDC reali su Polygon
- **DEV Mode** → testa senza blockchain (solo in sviluppo, bloccato in produzione)
> Ogni dono crea 1 posizione HUMAN + 1 CASSA URANUS nel sistema

---

### 🔍 Cerca Wallet
Digita un indirizzo wallet (0x...) e premi **Cerca**.
Mostra: tipo account, ticket, posizioni nelle tavole, uscite Nettuno.

---

### 🔄 Flussi Esterni
Visualizza tutti i movimenti cross-sistema (ROG Small, GALASSIA, Sole L0).
Clicca **🔄 Aggiorna** per ricaricare.

---

### 👤 Utenti
Lista di tutti gli utenti registrati nel sistema.
- Cerca per nome o wallet con la barra di ricerca
- Filtra per stato (Attivi / Inattivi)
- Pagine precedente/successiva per navigare

---

### 🌍 Comunità
Lista di tutti i membri della community con livello, posizioni, totale donato.
- Cerca per wallet
- Naviga le pagine

---

### 📅 Eventi
Gestisci eventi della community:
- **＋ Crea Evento** → inserisci nome, data, tipo (online/presenza), descrizione
- Ogni evento mostra partecipanti iscritti e stato
- Puoi eliminare eventi passati con 🗑️

---

### 📦 Risorse (Gallery)
Carica materiali che gli utenti possono scaricare dal sito:
1. Clicca **＋ Nuova risorsa**
2. Inserisci: **Nome** (obbligatorio), **URL download** (link diretto al file, es. Google Drive, Dropbox), **Tipo** (PDF, ZIP, etc.), **Categoria**, **Dimensione**, **Data**
3. Clicca **💾 Salva risorsa**
4. La risorsa apparirà immediatamente nella pagina pubblica `/risorse`
5. Per rimuoverla clicca 🗑️

> **Come ottenere l'URL di un file:**
> - Google Drive → tasto destro → "Ottieni link" → "Chiunque con il link"
> - Dropbox → "Condividi" → "Copia link"

---

### ✉️ Comunicazioni
**Sezione Comunicazioni:**
- Clicca **＋ Nuova** per aggiungere un annuncio
- Inserisci titolo, tag (Ufficiale/Urgente/ecc.), categoria, data
- Clicca **💾 Pubblica**
- Gli annunci salvati diventano visibili nel sistema
- Elimina con 🗑️

**Sezione Testimonianze:**
- Mostra le testimonianze inviate dagli utenti
- Badge **⏳ In attesa** = da approvare
- Clicca **✓ Approva** per renderla pubblica
- Clicca **✗ Rifiuta** per scartarla

---

### ⭐ Posizioni al Volo
Gestisce le richieste di posizioni gratuite:
- Mostra le richieste in attesa di approvazione (con wallet e nome)
- **✓ APPROVA** → il wallet entra in coda FIFO: riceverà automaticamente una posizione gratuita alla prossima uscita da Giove o Saturno
- **✕ RIFIUTA** → la richiesta viene scartata (puoi aggiungere una nota)

---

### ⚙️ Admin (Settings)
**Configurazione:**
- Imposta l'URL del backend e la chiave API
- Clicca **Test Connessione** per verificare che il backend risponda

**Kill Switch:**
- Clicca **Aggiorna Stato** per vedere se il sistema è bloccato
- **🔴 Blocca** → blocca TUTTO il sistema (nessun utente può donare)
- **🟢 Sblocca** → riattiva il sistema

> ⚠️ Usa il Kill Switch **solo in emergenza**. Inserisci sempre un motivo.

**Inizializzazione:**
- **Solo la prima volta** che si avvia il sistema. Non cliccare se il sistema è già attivo.

---

## Sicurezza

- La sessione scade dopo **24 ore**: dovrai fare di nuovo il login
- Non condividere username e password
- Non lasciare il pannello aperto su computer non sicuri
- Dopo aver finito, clicca **🚪 Logout** in basso nella sidebar

---

## In caso di problemi

| Sintomo | Causa probabile | Soluzione |
|---------|----------------|-----------|
| "Chiave admin non valida" | Key sbagliata in Settings | Vai in ⚙️ Settings e inserisci la chiave corretta |
| La pagina non carica | Backend offline | Controlla che Coolify sia attivo |
| "Offline" nella top bar | Backend non raggiungibile | Controlla l'URL in ⚙️ Settings |
| Sessione scaduta | 24h trascorse | Fai di nuovo il login |

---

*Guida preparata il 29 Giugno 2026 — ROG-URANUS Team*
