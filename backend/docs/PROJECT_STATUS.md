# ROG — PROJECT STATUS
Aggiornato: 2026-06-26
## Ambiente
- Cartelle attive: `ROG_FRONTEND_26_GIUGNO`, `ROG_BACKEND_26GIUGNO`.
- `ROG_20GIUGNO`: snapshot pre-migrazione (Railway) — OBSOLETO, non usare.
- Backend: Coolify → `https://rog-backend.165.245.209.171.nip.io` (frontend `js/config.js`).
- Frontend: IPFS via Pinata.
## Controllo 4 punti (completato)
- Carta regalo: OK. "Contenuto irraggiungibile" era disservizio IPFS/IPNS temporaneo (Pinata/gateway), non bug di codice. Attualmente funzionante.
- Dono al volo: FIX applicato (rimosso loop di reload). Vedi CHANGELOG.
- Referral: FIX applicato (link nel formato corretto). Il path utente reale (link client-side area personale) era già funzionante.
- Send gift: OK by design — "SEND GIFT" e "rientro" sono donazioni dirette → `donation.html` (confermato dal team). Flusso gift-card/beneficiario separato in `carta-regalo.html`.
