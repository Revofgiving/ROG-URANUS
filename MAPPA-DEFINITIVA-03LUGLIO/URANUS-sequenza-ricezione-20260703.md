# URANUS — Sequenza di ricezione (uscite Venere Primario) — certificazione

Generato dalla mappa definitiva (read-only). Modello: PHARAOH ÷10 + dual.

## Stato attuale (dalla mappa)

- Donazioni: 82 · duali: 116 · posizioni da donazione: 232 (116 CASSA + 116 HUMAN)
- Slot riservati (Gemelli): 16 · **posizione massima attuale: 248**

## Regola soglia (uscita Venere)

- Faraone del turno K = posizione (K-1). Soglia = 114 + 78·(K-1) posizioni.
- Turno 1 = 19 tavole (18 sacerdoti + tavola del Fondo A) = 114. Ogni turno dopo = +13 tavole = +78.
- Le 5 funzioni (3 Simbionti + Perpetuo + Gemello) riducono i sacerdoti da 18 a 13 dal 2° turno.

## Schedule faraoni 0–16

- **pos 0** (turno 1, FONDO) → soglia **114** · RAGGIUNTA · dono: 500 USDC · PAGATO (500, tx 0x1ae343…, 22/06)
- **pos 1** (turno 2, CASSA) → soglia **192** · RAGGIUNTA · dono: — (accantonato in cassa) · MATURATA → ACCANTONAMENTO (nessun payout)
- **pos 2** (turno 3, HUMAN) → soglia **270** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)
- **pos 3** (turno 4, CASSA) → soglia **348** · non raggiunta · dono: — (accantonato in cassa) · FUTURA (soglia non raggiunta)
- **pos 4** (turno 5, HUMAN) → soglia **426** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)
- **pos 5** (turno 6, CASSA) → soglia **504** · non raggiunta · dono: — (accantonato in cassa) · FUTURA (soglia non raggiunta)
- **pos 6** (turno 7, HUMAN) → soglia **582** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)
- **pos 7** (turno 8, CASSA) → soglia **660** · non raggiunta · dono: — (accantonato in cassa) · FUTURA (soglia non raggiunta)
- **pos 8** (turno 9, HUMAN) → soglia **738** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)
- **pos 9** (turno 10, CASSA) → soglia **816** · non raggiunta · dono: — (accantonato in cassa) · FUTURA (soglia non raggiunta)
- **pos 10** (turno 11, HUMAN) → soglia **894** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)
- **pos 11** (turno 12, CASSA) → soglia **972** · non raggiunta · dono: — (accantonato in cassa) · FUTURA (soglia non raggiunta)
- **pos 12** (turno 13, HUMAN) → soglia **1050** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)
- **pos 13** (turno 14, CASSA) → soglia **1128** · non raggiunta · dono: — (accantonato in cassa) · FUTURA (soglia non raggiunta)
- **pos 14** (turno 15, HUMAN) → soglia **1206** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)
- **pos 15** (turno 16, CASSA) → soglia **1284** · non raggiunta · dono: — (accantonato in cassa) · FUTURA (soglia non raggiunta)
- **pos 16** (turno 17, HUMAN) → soglia **1362** · non raggiunta · dono: 480 USDC · FUTURA (soglia non raggiunta)

## Conclusioni robuste (indipendenti dall'incertezza ±)

- **pos 0 (FONDO): 500 USDC GIÀ PAGATO** (unico payout dovuto finora).
- **pos 1 (CASSA): soglia raggiunta ma è CASSA → ACCANTONAMENTO**, nessun bonifico.
- **Prossimo payout su wallet: pos 2 (HUMAN) = 480 USDC**, alla soglia 270 → **NON ancora dovuto** (mancano ~22 posizioni ≈ ~11 duali).
- Quindi: **nessun nuovo bonifico da erogare adesso.**

## Verifica di coerenza (pos 0)

- Soglia pos 0 = 114. Nella mappa la posizione 114 è del 2026-06-14; il dono di 500 è stato pagato il 2026-06-22 (tx 0x1ae343…). Coerente (soglia raggiunta prima del pagamento).

## Caveat

- L'intero esatto della soglia ha incertezza ± (dipende da come gli slot Gemelli contano nel riempimento delle prime tavole; un Gemello si materializza solo all'uscita da Venere del genitore). Le conclusioni direzionali sopra restano valide (114«248, 270»248).
- Copre lo stadio **Venere Primario**. I doni a valle (Nettuno 800 a 108 posizioni; Venere Secondario 90; Giove 400; Saturno 2400) richiedono il motore completo (Blocco 2 + coda Nettuno FIFO) — step successivo se serve.
- **CASSA = accantonamento**, non payout: le posizioni dispari maturano ma non generano bonifici.
