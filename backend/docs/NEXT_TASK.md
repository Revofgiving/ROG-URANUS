# NEXT TASK
## Prossimo passo consigliato
1. Impostare `process.env.BASE_URL` sul dominio pubblico reale (es. `https://www.revolutionofgiving.world`) nel deploy Coolify; allineare il default in `voting-notifications.js:308` (oggi `.eth`).
2. (Opzionale) Svuotare la sezione `links` di `referral-state.json` per rigenerare subito i link nel nuovo formato.
3. Decidere sui generatori referral backend inutilizzati: rimuovere oppure esporre con risoluzione `code → wallet` se si vuole tornare a `?ref=<code>`.
4. Verifica funzionale end-to-end del dono al volo dopo il fix del loop (donazione multi-coppia: conteggi invitati corretti e performance).
## Non urgente
- Ripulire il refuso `primaPositzione`/`ultimaPositzione` (`position-creator.js:464-465`).
- UX: spostare il messaggio di successo del dono al volo dopo la conferma del pagamento.
