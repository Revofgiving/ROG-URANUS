# KNOWN ISSUES
## Aperti
- BASE_URL: default `https://revolutionofgiving.com` (`area-personale-manager.js:53`, `referral-manager.js`); `voting-notifications.js:308` usa fallback `.eth`. Dominio reale = `www.revolutionofgiving.world`. Impostare `process.env.BASE_URL` e allineare i default.
- `referral-state.json`: può contenere link referral in formato vecchio; vengono riscritti alla prossima `generaReferralLink`, oppure svuotare la sezione `links`.
- `getInvitanteDiretto` (`referral-manager.js:274-283`): priorità al JSON `relazioniInviti` rispetto a PostgreSQL → invitante potenzialmente "stale"; `relazioniInviti` cresce senza dedup.
- UX dono al volo: messaggio "🎉 Regalo Ricevuto!" mostrato prima del pagamento reale (`anagrafica-alvolo.html:603,759`; `handleDono` salva in localStorage e fa redirect).
- Generatori referral backend (`referral-manager`/`area-personale`): non collegati ad alcun endpoint/uso frontend (codice morto). Ora allineati al formato corretto; valutare rimozione o esposizione.
- Refuso chiavi `primaPositzione`/`ultimaPositzione` (`position-creator.js:464-465`): funzionante (duplicato intenzionale) ma da ripulire.
## Risolti (2026-06-26)
- Dono al volo: reload PostgreSQL ripetuti nel loop → batch unico + reload singolo.
- Referral link: dominio/parametro errati (`.eth`/`.com`, `?ref=code`) → `${BASE_URL}/referral.html?refWallet=<wallet>`.
- Carta regalo: "Contenuto irraggiungibile" = disservizio IPFS temporaneo (non codice); rientrato.
