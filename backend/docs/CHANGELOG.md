# CHANGELOG
## 2026-06-26
### Dono al volo — performance (`donation-flow-manager.js`, `referral-manager.js`)
- `processDonoAlVolo`: eliminati i reload PostgreSQL + `setTimeout(50ms)` dentro il loop coppie.
- Inviti accumulati e scritti UNA sola volta (`scriviInvitiPerPosizioni` in batch); UN solo `referralManager.reload()` finale.
- `referral-manager.registraInvito(params, { skipReload })`: nuova opzione per evitare reload/save ripetuti (default invariato → nessun impatto sugli altri chiamanti).
### Referral — link corretto (`referral-manager.js`, `area-personale-manager.js`)
- `generaReferralLink` (referral-manager.js): da `https://revolutionofgiving.eth/register?ref=<8char>` a `${BASE_URL}/referral.html?refWallet=<wallet>`. Link deterministico, sovrascrive cache vecchia.
- `area-personale-manager.js:402`: `referralUrl` da `${BASE_URL}/register?ref=<code>` a `${BASE_URL}/referral.html?refWallet=<walletNorm>` (QR/share allineati).
### File modificati
- `ROG_BACKEND_26GIUGNO/donation-flow-manager.js`
- `ROG_BACKEND_26GIUGNO/referral-manager.js`
- `ROG_BACKEND_26GIUGNO/area-personale-manager.js`
Validazione: `node --check` OK su tutti.
### Deploy
- Push su `Revofgiving/rog-backend@main` (commit `35afb56`, `20beb10..35afb56`). Coolify auto-deploy: verificare l'avvio/esito nella dashboard.
- `BASE_URL` (env.txt) = `https://revolutionofgiving.com` — verificare vs dominio reale (`www.revolutionofgiving.world`); impatto basso perché i generatori referral backend non sono usati dal frontend.
