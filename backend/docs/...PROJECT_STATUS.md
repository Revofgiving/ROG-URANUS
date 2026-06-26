# PROJECT STATUS — URANUS Backend

## Completato
- Wallet treasury uniformati tramite ENV Coolify.
- Cassa ROG, Uranus, PHARAOH e Fortunato configurate.
- Creato `cassa-transfer-manager.js`.
- Tabella `trasferimenti_cassa` attiva.
- Retry automatico ogni 60 secondi, massimo 20 tentativi.
- Alert Telegram per trasferimenti cassa `FAILED`.
- Idempotenza attiva per trasferimenti ROG L3, L5 e Nettuno.
- Flusso doni pendenti verificato: nessun dono PENDING o PROCESSING.

## Da verificare
- Prima uscita reale L3, L5 o Nettuno:
  controllo `trasferimenti_cassa` da PENDING a SENT con tx_hash.

## Bloccato
- Rilascio PHARAOH bloccato fino ad autorizzazione del committente.
