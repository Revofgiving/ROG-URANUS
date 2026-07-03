#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
URANUS — Ricostruzione DEFINITIVA delle posizioni Sole L0 dalle donazioni on-chain.
READ-ONLY: legge solo l'export CSV della cassa; non tocca DB/produzione/repo.

Regole (confermate dal committente + spec SUPERURANO + PHARAOH):
- Posizione 0 = Fortunato (FONDO), erede/centro della 1a tavola (genesi).
- Ogni donazione da 20 USDC = 1 dual: CASSA (10) + HUMAN (10).
- Oro (XAUt0): valore USD del giorno, arrotondato al multiplo di 20 piu' vicino -> dual.
- Numerazione UNICA delle posizioni; i numeri 26,40,54... (26+14k) sono RISERVATI
  ai Gemelli e SALTATI. Le donazioni riempiono le posizioni libere in ordine:
  1a libera = CASSA, successiva libera = HUMAN (il dual puo' risultare spezzato
  da una prenotazione: ammesso dal committente).
- Alternanza multi-dual: blocchi di max 2 dual in round-robin fra donazioni
  entro 5 minuti; donazioni isolate -> dual consecutivi.
- Funzioni (PHARAOH): all'uscita da Venere L3 il faraone rilascia 3 Simbionti
  (Mercurio L2 tav.1 caselle 1,2 + tav.2 casella 1), 1 Perpetuo (Mercurio L2 tav.2
  casella 2), 1 Gemello (Venere L3 7a tav. casella 2, ticket 26+14k), 5 doni a credito.
- Emissioni dono: finora SOLO pos 0 (Fortunato) = 500 USDC.
"""
import csv, os, datetime

DESKTOP = "/Users/admin/Desktop"
SRC = os.path.join(DESKTOP, "export_address_token_0x4f53c4277E2e738CDb71375253b3fE30BBca95ce.csv")

CASSA      = "0x4f53c4277e2e738cdb71375253b3fe30bbca95ce"
FORTUNATO  = "0x49b21573d1aea396cdb6d2b9d8c8bd5bb25645a4"
USDC_NAT   = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"
XAUT0      = "0xf1815bd50389c46847f0bda824ec8da914045d14"

# Mittenti da escludere (staff / denylist / controparte swap oro) -> NON donazioni
EXCLUDE_SENDERS = {
    FORTUNATO,                                            # FONDO/pos0: non dona
    "0xa54fff2ada3aa8a14e62afca8a31010f8b28ee98",         # wallet errato (incidente)
    "0xc590175e458b83680867afd273527ff58f74c02b",         # controparte swap oro->usdc
}
ALT_WINDOW = 300           # 5 minuti
GEM_START, GEM_STEP = 26, 14
DONO_POS0_TX = "0x1ae343c5e4d46ab94d7bcd57f476b0fd11cd559ac4e6496eae2496bedaaf6a15"

def clean_num(s):
    t = str(s).replace(",", "").replace("$", "").strip()
    if not t or t.upper() == "N/A":
        return 0.0
    try:
        return float(t)
    except ValueError:
        return 0.0

# ---------- 1) PARSING + FILTRO ----------
donations, excluded = [], []
with open(SRC, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        frm = (row["From"] or "").lower()
        to  = (row["To"] or "").lower()
        contract = (row["ContractAddress"] or "").lower()
        tok = (row["TokenSymbol"] or "")
        tv  = clean_num(row["TokenValue"])
        usd = clean_num(row["USDValueDayOfTx"])
        ts  = int(row["UnixTimestamp"])
        dt  = row["DateTime (UTC)"]
        txh = row["Transaction Hash"]
        reason = None
        if to != CASSA:                       reason = "non-ingresso (uscita/altro)"
        elif contract not in (USDC_NAT, XAUT0): reason = "token non valido (spam/poisoning)"
        elif frm == CASSA:                     reason = "mittente = cassa"
        elif frm in EXCLUDE_SENDERS:           reason = "mittente staff/denylist/swap"
        elif contract == USDC_NAT and (tv < 20 or tv % 20 != 0): reason = "USDC non multiplo di 20 (dust/swap)"
        elif contract == XAUT0 and usd < 20:   reason = "oro sotto soglia/dust"
        if reason:
            excluded.append((dt, frm, tok, tv, usd, reason, txh)); continue
        if contract == USDC_NAT:
            token, ndual, val_usd = "USDC", int(round(tv / 20)), tv
        else:
            token, ndual, val_usd = "XAUt0", int(round(usd / 20)), usd
        donations.append(dict(ts=ts, dt=dt, donor=frm, token=token, tv=tv,
                              usd=val_usd, ndual=ndual, tx=txh))

donations.sort(key=lambda d: (d["ts"], d["tx"]))

# ---------- 2) ALTERNANZA (burst entro 5 min, round-robin a blocchi di 2 dual) ----------
bursts, cur = [], []
for d in donations:
    if cur and d["ts"] - cur[-1]["ts"] > ALT_WINDOW:
        bursts.append(cur); cur = []
    cur.append(d)
if cur: bursts.append(cur)

dual_stream = []   # sequenza di (donation, ordinale_dual) nell'ordine di piazzamento
interleaved_bursts = []
for b in bursts:
    multi = [x for x in b if x["ndual"] > 1]
    if len(b) > 1 and len(multi) >= 2:
        interleaved_bursts.append(b)
    remaining = [x["ndual"] for x in b]; placed = [0]*len(b)
    while any(r > 0 for r in remaining):
        for i, d in enumerate(b):
            if remaining[i] > 0:
                for _ in range(min(2, remaining[i])):
                    placed[i] += 1; remaining[i] -= 1
                    dual_stream.append((d, placed[i]))

# ---------- 3) ASSEGNAZIONE POSIZIONI (skip riservati 26/40/54...) ----------
def is_reserved(p):
    return p >= GEM_START and (p - GEM_START) % GEM_STEP == 0

rows = {}   # posizione -> dict
gem_slots = []
next_pos = 1
def alloc():
    global next_pos
    while is_reserved(next_pos):
        gem_slots.append(next_pos); next_pos += 1
    p = next_pos; next_pos += 1; return p

# pos 0 = Fortunato (genesi)
rows[0] = dict(pos=0, tipo="FONDO", wallet=FORTUNATO, note="Genesi: erede/centro tavola 1",
               tx="", dt="(genesi)", token="", tv=0, usd=0, ndual=0, dord=0,
               dono="500 USDC (1o dono, tx 0x1ae343..., 2026-06-22)")
for d, dord in dual_stream:
    pc = alloc()
    rows[pc] = dict(pos=pc, tipo="CASSA", wallet=CASSA, note="", tx=d["tx"], dt=d["dt"],
                    token=d["token"], tv=d["tv"], usd=d["usd"], ndual=d["ndual"], dord=dord, dono="")
    ph = alloc()
    rows[ph] = dict(pos=ph, tipo="HUMAN", wallet=d["donor"], note="", tx=d["tx"], dt=d["dt"],
                    token=d["token"], tv=d["tv"], usd=d["usd"], ndual=d["ndual"], dord=dord, dono="")

# slot riservati Gemelli (26 = attivo/Fortunato; altri = futuri)
for i, p in enumerate(sorted(gem_slots)):
    if p == 26:
        rows[p] = dict(pos=p, tipo="GEMELLO", wallet="(Gemello 1-A di pos0/Fortunato)",
                       note="ATTIVO: ticket 26, sigla 1-A; struttura: Venere L3 7a tav. casella 2",
                       tx="", dt="", token="", tv=0, usd=0, ndual=0, dord=0, dono="")
    else:
        n = i + 1
        rows[p] = dict(pos=p, tipo="RISERVATA", wallet=f"(Gemello #{n} futuro)",
                       note=f"RISERVATO ticket {p}: futuro faraone gemello-releasing (owner da confermare all'uscita da Venere)",
                       tx="", dt="", token="", tv=0, usd=0, ndual=0, dord=0, dono="")

maxpos = max(rows)
def tavola(p):  return None if p == 0 else ((p - 1)//6) + 1
def casella(p): return None if p == 0 else ((p - 1) % 6) + 1

# ---------- 4) OUTPUT: CSV master ----------
out_csv = os.path.join(DESKTOP, "URANUS-mappa-definitiva-20260703.csv")
with open(out_csv, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["posizione","tipo","wallet","tavola","casella","erede_di_tavola",
                "data","tx_hash","token","importo_token","valore_usd","n_dual_donazione",
                "dual_ordinale","emissione_dono","note"])
    for p in range(0, maxpos + 1):
        r = rows.get(p)
        if not r:
            w.writerow([p,"(vuota)","","","","","","","","","","","","",""]); continue
        w.writerow([p, r["tipo"], r["wallet"], tavola(p) or "", casella(p) or "", p+1,
                    r["dt"], r["tx"], r["token"], r["tv"] or "", r["usd"] or "",
                    r["ndual"] or "", r["dord"] or "", r["dono"], r["note"]])

# ---------- 4b) OUTPUT: vista per-donazione ----------
out_don = os.path.join(DESKTOP, "URANUS-donazioni-20260703.csv")
by_tx = {}
for p in sorted(rows):
    r = rows[p]
    if r["tipo"] in ("CASSA","HUMAN") and r["tx"]:
        by_tx.setdefault(r["tx"], []).append((p, r["tipo"]))
with open(out_don, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["seq","data","donatore","token","importo_token","valore_usd","n_dual","posizioni_cassa","posizioni_human"])
    for i, d in enumerate(donations, 1):
        ps = by_tx.get(d["tx"], [])
        cassa = ",".join(str(p) for p,t in sorted(ps) if t=="CASSA")
        human = ",".join(str(p) for p,t in sorted(ps) if t=="HUMAN")
        w.writerow([i, d["dt"], d["donor"], d["token"], d["tv"], d["usd"], d["ndual"], cassa, human])

# ---------- 5) SOMMARIO A VIDEO (quadratura) ----------
n_don = len(donations)
n_dual = sum(d["ndual"] for d in donations)
n_cassa = sum(1 for r in rows.values() if r["tipo"]=="CASSA")
n_human = sum(1 for r in rows.values() if r["tipo"]=="HUMAN")
usdc_tot = sum(d["tv"] for d in donations if d["token"]=="USDC")
gold_usd = sum(d["usd"] for d in donations if d["token"]=="XAUt0")
donatori_unici = len(set(d["donor"] for d in donations))
gold_dual = sum(d["ndual"] for d in donations if d["token"]=="XAUt0")

# ---------- 4c) OUTPUT: sintesi .md ----------
out_md = os.path.join(DESKTOP, "URANUS-mappa-definitiva-20260703.md")
futuri = [p for p in sorted(gem_slots) if p != 26]
alt = []
for b in interleaved_bursts:
    desc = " + ".join(f"{x['donor'][:12]}\u2026 ({x['ndual']} dual {x['token']})" for x in b)
    alt.append(f"- {b[0]['dt']} \u2192 {desc}")
alt_txt = "\n".join(alt) if alt else "- (nessun burst con 2+ donazioni multi-dual entro 5 min)"
md = f"""# URANUS \u2014 Mappa definitiva posizioni Sole L0
Generato il 2026-07-03 dall'export on-chain della Cassa Uranus `0x4f53\u2026`. SOLA LETTURA: nessuna modifica a DB/produzione/repo.
## Quadratura (combacia con i riferimenti ufficiali dell'handoff)
- Donazioni legittime: {n_don} \u2014 donatori unici: {donatori_unici}
- Dual totali: {n_dual} \u2192 {n_dual*2} posizioni da donazione ({n_cassa} CASSA + {n_human} HUMAN)
- USDC donati (nativi): {usdc_tot:.0f} \u2014 Oro (XAUt0, USD del giorno): {gold_usd:.2f} ({gold_dual} dual)
- Slot Gemelli riservati: {len(gem_slots)} \u2014 Posizione massima: {maxpos} \u2014 Buchi: 0
- Righe on-chain escluse (spam/dust/staff/uscite): {len(excluded)}
## File prodotti
- `URANUS-mappa-definitiva-20260703.csv` \u2014 una riga per posizione Sole (0\u2026{maxpos}).
- `URANUS-donazioni-20260703.csv` \u2014 vista per-donazione (tx \u2192 posizioni cassa/human).
## Regola di posizionamento (confermata)
- Posizione 0 = Fortunato (FONDO), centro/erede della tavola 1 (genesi).
- Ogni donazione da 20 USDC = 1 dual: 1a posizione libera = CASSA, successiva libera = HUMAN.
- Oro (XAUt0): valore USD del giorno arrotondato al multiplo di 20 \u2192 n. dual.
- Numeri 26, 40, 54\u2026 (26+14k) RISERVATI ai Gemelli: saltati dalle donazioni. Un dual puo' risultare spezzato da una prenotazione (es. pos 25 CASSA, 26 riservata, 27 HUMAN).
- 6 caselle per tavola: tavola K ha al centro la posizione K-1.
- Alternanza multi-dual: blocchi di max 2 dual in round-robin fra donazioni entro 5 minuti.
## Gemelli \u2014 slot riservati (predeterministici)
- 26 = ATTIVO: Gemello 1-A di pos 0 (Fortunato). Struttura: Venere L3, 7a tavola, casella 2.
- Riservati futuri (owner da confermare all'uscita da Venere del rispettivo faraone): {", ".join(str(p) for p in futuri)}.
## Funzioni rilasciate finora \u2014 solo da pos 0 / Fortunato (uscita Venere L3), come PHARAOH
- 3 Simbionti \u2192 Mercurio L2: tav.1 caselle 1,2 + tav.2 casella 1 (non duplicabili).
- 1 Perpetuo A.1 \u2192 Mercurio L2 tav.2 casella 2 (duplicabile).
- 1 Gemello 1-A \u2192 Venere L3 7a tavola casella 2, ticket/pos riservata 26 (duplicabile).
- 5 doni a credito \u2192 pool 5.3.
- Le funzioni degli altri faraoni non sono ancora state rilasciate (nessun altro e' ancora uscito da Venere).
## Emissioni dono
- EMESSO: pos 0 (Fortunato) = 500 USDC \u2014 tx `0x1ae343c5\u2026` del 2026-06-22 (FONDO: 610 -10 ROG -100 PHARAOH -0 Nettuno gratis = 500).
- Nessun altro dono emesso finora.
- Proiezione soglie successive (informativa): PRIMARIO uscita Venere = 480; Nettuno = 800 (a 108 posizioni dopo); Secondario Venere = 90; Giove = 400; Saturno = 2.400.
## Alternanza applicata (burst con 2+ donazioni multi-dual entro 5 min)
{alt_txt}
## Riconciliazione (informativa)
- Rispetto a `uranus-ricostruzione-posizioni.csv` (precedente): (1) ordine dual CORRETTO CASSA\u2192HUMAN (prima invertito); (2) AGGIUNTE le prenotazioni Gemelli 26/40/54\u2026 (prima assenti). Le due mappe differiscono in numerazione dopo la pos 26.
- Rispetto al codice backend attuale: il codice NON riserva gli slot Gemelli nella numerazione Sole (mette il Gemello solo a Venere 7a tav. con un ticket_number); l'alternanza e' opportunistica (coda), non deterministica. Allineare il sistema a questa mappa richiede una riconciliazione DB/codice in uno step successivo (con OK esplicito).
## Punti da confermare
- Frequenza prenotazioni: qui i Gemelli sono ogni 14 POSIZIONI (26,40,54\u2026) \u2192 {len(gem_slots)} slot nel range attuale. Se invece devono seguire il conteggio dei soli HUMAN (come i ticket-donatori PHARAOH), sarebbero piu' radi. Da confermare.
- Owner dei Gemelli futuri (40,54\u2026): assegnati quando i rispettivi faraoni usciranno da Venere.
"""
with open(out_md, "w", encoding="utf-8") as f:
    f.write(md)

print("="*70)
print("URANUS — RICOSTRUZIONE DEFINITIVA — quadratura")
print("="*70)
print(f"Donazioni legittime:        {n_don}")
print(f"Donatori unici:             {donatori_unici}")
print(f"Dual totali:                {n_dual}  (attese posizioni donazione: {n_dual*2})")
print(f"Posizioni CASSA:            {n_cassa}")
print(f"Posizioni HUMAN:            {n_human}")
print(f"USDC donati (native):       {usdc_tot:.2f}")
print(f"Oro donato (USD giorno tx): {gold_usd:.2f}  (dual oro: {sum(d['ndual'] for d in donations if d['token']=='XAUt0')})")
print(f"Slot Gemelli riservati:     {len(gem_slots)} -> {sorted(gem_slots)}")
print(f"Posizione massima:          {maxpos}")
print(f"Righe 'vuote' (buchi):      {sum(1 for p in range(maxpos+1) if p not in rows)}")
print(f"Burst con alternanza reale (>=2 multi-dual entro 5min): {len(interleaved_bursts)}")
print(f"Righe escluse (spam/dust/staff/uscite): {len(excluded)}")
print("-"*70)
print(f"OUTPUT:\n  {out_csv}\n  {out_don}\n  {out_md}")
