# URANUS — Mappa definitiva posizioni Sole L0
Generato il 2026-07-03 dall'export on-chain della Cassa Uranus `0x4f53…`. SOLA LETTURA: nessuna modifica a DB/produzione/repo.
## Quadratura (combacia con i riferimenti ufficiali dell'handoff)
- Donazioni legittime: 82 — donatori unici: 75
- Dual totali: 116 → 232 posizioni da donazione (116 CASSA + 116 HUMAN)
- USDC donati (nativi): 2120 — Oro (XAUt0, USD del giorno): 193.80 (10 dual)
- Slot Gemelli riservati: 16 — Posizione massima: 248 — Buchi: 0
- Righe on-chain escluse (spam/dust/staff/uscite): 77
## File prodotti
- `URANUS-mappa-definitiva-20260703.csv` — una riga per posizione Sole (0…248).
- `URANUS-donazioni-20260703.csv` — vista per-donazione (tx → posizioni cassa/human).
## Regola di posizionamento (confermata)
- Posizione 0 = Fortunato (FONDO), centro/erede della tavola 1 (genesi).
- Ogni donazione da 20 USDC = 1 dual: 1a posizione libera = CASSA, successiva libera = HUMAN.
- Oro (XAUt0): valore USD del giorno arrotondato al multiplo di 20 → n. dual.
- Numeri 26, 40, 54… (26+14k) RISERVATI ai Gemelli: saltati dalle donazioni. Un dual puo' risultare spezzato da una prenotazione (es. pos 25 CASSA, 26 riservata, 27 HUMAN).
- 6 caselle per tavola: tavola K ha al centro la posizione K-1.
- Alternanza multi-dual: blocchi di max 2 dual in round-robin fra donazioni entro 5 minuti.
## Gemelli — slot riservati (predeterministici)
- 26 = ATTIVO: Gemello 1-A di pos 0 (Fortunato). Struttura: Venere L3, 7a tavola, casella 2.
- Riservati futuri (owner da confermare all'uscita da Venere del rispettivo faraone): 40, 54, 68, 82, 96, 110, 124, 138, 152, 166, 180, 194, 208, 222, 236.
## Funzioni rilasciate finora — solo da pos 0 / Fortunato (uscita Venere L3), come PHARAOH
- 3 Simbionti → Mercurio L2: tav.1 caselle 1,2 + tav.2 casella 1 (non duplicabili).
- 1 Perpetuo A.1 → Mercurio L2 tav.2 casella 2 (duplicabile).
- 1 Gemello 1-A → Venere L3 7a tavola casella 2, ticket/pos riservata 26 (duplicabile).
- 5 doni a credito → pool 5.3.
- Le funzioni degli altri faraoni non sono ancora state rilasciate (nessun altro e' ancora uscito da Venere).
## Emissioni dono
- EMESSO: pos 0 (Fortunato) = 500 USDC — tx `0x1ae343c5…` del 2026-06-22 (FONDO: 610 -10 ROG -100 PHARAOH -0 Nettuno gratis = 500).
- Nessun altro dono emesso finora.
- Proiezione soglie successive (informativa): PRIMARIO uscita Venere = 480; Nettuno = 800 (a 108 posizioni dopo); Secondario Venere = 90; Giove = 400; Saturno = 2.400.
## Alternanza applicata (burst con 2+ donazioni multi-dual entro 5 min)
- 2026-06-14 12:40:25 → 0x889358bf9f… (4 dual USDC) + 0xca9f6924b9… (2 dual XAUt0)
## Riconciliazione (informativa)
- Rispetto a `uranus-ricostruzione-posizioni.csv` (precedente): (1) ordine dual CORRETTO CASSA→HUMAN (prima invertito); (2) AGGIUNTE le prenotazioni Gemelli 26/40/54… (prima assenti). Le due mappe differiscono in numerazione dopo la pos 26.
- Rispetto al codice backend attuale: il codice NON riserva gli slot Gemelli nella numerazione Sole (mette il Gemello solo a Venere 7a tav. con un ticket_number); l'alternanza e' opportunistica (coda), non deterministica. Allineare il sistema a questa mappa richiede una riconciliazione DB/codice in uno step successivo (con OK esplicito).
## Punti da confermare
- Frequenza prenotazioni: qui i Gemelli sono ogni 14 POSIZIONI (26,40,54…) → 16 slot nel range attuale. Se invece devono seguire il conteggio dei soli HUMAN (come i ticket-donatori PHARAOH), sarebbero piu' radi. Da confermare.
- Owner dei Gemelli futuri (40,54…): assegnati quando i rispettivi faraoni usciranno da Venere.
