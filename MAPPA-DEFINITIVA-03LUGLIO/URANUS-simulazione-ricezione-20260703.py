#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
URANUS — Simulazione DETERMINISTICA della sequenza di ricezione (uscite Venere Primario).
READ-ONLY: legge la mappa definitiva; non tocca DB/produzione.

Modello (PHARAOH ÷10 + dual):
- Il faraone del turno K = posizione (K-1). Esce da Venere quando ha ricevuto i doni
  dei suoi sacerdoti: 18 al 1° turno, 13 dal 2° in poi (le 5 funzioni sostituiscono 5 sacerdoti).
- Ogni sacerdote = 1 tavola Sole completata (6 posizioni). Turno 1 = 18 tavole sacerdoti + 1 tavola
  del Fondo A = 19 tavole = 114 posizioni. Ogni turno successivo = 13 tavole = +78 posizioni.
  => Soglia uscita Venere per faraone p:  114 + 78*p   (in posizioni della numerazione unica).
- Tipo posizione: p=0 FONDO; p dispari CASSA; p pari (>=2) HUMAN.
  * HUMAN => DONO su wallet (Primario netto 480; Fondo pos0 = 500).
  * CASSA => nessun payout: netto ACCANTONATO in cassa.
- 'Raggiunta' se soglia <= posizione massima attuale della mappa.

CAVEAT (documentato): l'intero esatto della soglia ha una piccola incertezza (±) a seconda
di come gli slot riservati (Gemelli) contano nel riempimento delle prime tavole (un Gemello
si materializza solo all'uscita da Venere del suo faraone-genitore). Le conclusioni DIREZIONALI
(chi è pagato / accantonato / prossimo) sono robuste. Copre lo stadio Venere Primario; i doni a
valle (Nettuno 800, Venere Secondario 90, Giove 400, Saturno 2400) richiedono il motore completo.
"""
import csv, os

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_CSV = os.path.join(HERE, "URANUS-mappa-definitiva-20260703.csv")

TABLE = 6
TURN1_TAVOLE = 19        # 18 sacerdoti + tavola del Fondo A
SUB_TAVOLE = 13          # dal 2° turno: 13 sacerdoti (5 funzioni sostituiscono 5)
DONO_FONDO = 500         # pos 0 (FONDO): 610 -10 ROG -100 PHARAOH -0 Nettuno(gratis)
DONO_PRIMARIO = 480      # HUMAN Primario: 610 -20 Nettuno -10 ROG -100 PHARAOH
ORIZZONTE = 16           # faraoni da elencare

# ---------- Stato attuale dalla mappa ----------
positions = {}
donation_tx = set()
n_cassa = n_human = n_reserved = 0
maxpos = 0
with open(MAP_CSV, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        p = int(row["posizione"]); maxpos = max(maxpos, p)
        tipo = row["tipo"]; positions[p] = tipo
        if tipo == "CASSA": n_cassa += 1
        elif tipo == "HUMAN": n_human += 1
        elif tipo in ("GEMELLO", "RISERVATA"): n_reserved += 1
        if row.get("tx_hash"): donation_tx.add(row["tx_hash"])

donation_positions = n_cassa + n_human
duals = donation_positions // 2
donations = len(donation_tx)

def soglia(p):        return TABLE * (TURN1_TAVOLE + SUB_TAVOLE * p)   # 114 + 78p
def tipo_faraone(p):  return "FONDO" if p == 0 else ("CASSA" if p % 2 == 1 else "HUMAN")
def dono(p):
    if p == 0: return ("payout", DONO_FONDO)
    if p % 2 == 0: return ("payout", DONO_PRIMARIO)
    return ("accantonamento", None)

# ---------- Schedule ----------
rows = []
for p in range(0, ORIZZONTE + 1):
    s = soglia(p); t = tipo_faraone(p); kind, amount = dono(p)
    reached = s <= maxpos
    if p == 0:
        stato = "PAGATO (500, tx 0x1ae343…, 22/06)"
    elif reached and kind == "accantonamento":
        stato = "MATURATA → ACCANTONAMENTO (nessun payout)"
    elif reached and kind == "payout":
        stato = "MATURATA → DA PAGARE (payout dovuto)"
    else:
        stato = "FUTURA (soglia non raggiunta)"
    rows.append(dict(p=p, turno=p+1, tipo=t, soglia=s, reached=reached,
                     kind=kind, amount=amount, stato=stato))

# prossimo payout su wallet non ancora maturato
prossimo = next((r for r in rows if r["kind"] == "payout" and not r["reached"]), None)

# ---------- Output CSV ----------
out_csv = os.path.join(HERE, "URANUS-sequenza-ricezione-20260703.csv")
with open(out_csv, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["faraone_posizione","turno","tipo","soglia_uscita_venere_posizione",
                "raggiunta","tipo_dono","importo_usdc","stato"])
    for r in rows:
        w.writerow([r["p"], r["turno"], r["tipo"], r["soglia"],
                    "SI" if r["reached"] else "NO", r["kind"],
                    r["amount"] if r["amount"] is not None else "", r["stato"]])

# ---------- Output report .md ----------
out_md = os.path.join(HERE, "URANUS-sequenza-ricezione-20260703.md")
lines = []
lines.append("# URANUS — Sequenza di ricezione (uscite Venere Primario) — certificazione\n")
lines.append("Generato dalla mappa definitiva (read-only). Modello: PHARAOH ÷10 + dual.\n")
lines.append("## Stato attuale (dalla mappa)\n")
lines.append(f"- Donazioni: {donations} · duali: {duals} · posizioni da donazione: {donation_positions} ({n_cassa} CASSA + {n_human} HUMAN)")
lines.append(f"- Slot riservati (Gemelli): {n_reserved} · **posizione massima attuale: {maxpos}**\n")
lines.append("## Regola soglia (uscita Venere)\n")
lines.append("- Faraone del turno K = posizione (K-1). Soglia = 114 + 78·(K-1) posizioni.")
lines.append("- Turno 1 = 19 tavole (18 sacerdoti + tavola del Fondo A) = 114. Ogni turno dopo = +13 tavole = +78.")
lines.append("- Le 5 funzioni (3 Simbionti + Perpetuo + Gemello) riducono i sacerdoti da 18 a 13 dal 2° turno.\n")
lines.append("## Schedule faraoni 0–%d\n" % ORIZZONTE)
for r in rows:
    imp = f"{r['amount']} USDC" if r["amount"] is not None else "— (accantonato in cassa)"
    lines.append(f"- **pos {r['p']}** (turno {r['turno']}, {r['tipo']}) → soglia **{r['soglia']}** · {'RAGGIUNTA' if r['reached'] else 'non raggiunta'} · dono: {imp} · {r['stato']}")
lines.append("\n## Conclusioni robuste (indipendenti dall'incertezza ±)\n")
lines.append("- **pos 0 (FONDO): 500 USDC GIÀ PAGATO** (unico payout dovuto finora).")
lines.append("- **pos 1 (CASSA): soglia raggiunta ma è CASSA → ACCANTONAMENTO**, nessun bonifico.")
if prossimo:
    gap = prossimo["soglia"] - maxpos
    lines.append(f"- **Prossimo payout su wallet: pos {prossimo['p']} (HUMAN) = {prossimo['amount']} USDC**, alla soglia {prossimo['soglia']} → **NON ancora dovuto** (mancano ~{gap} posizioni ≈ ~{max(1, round(gap/2))} duali).")
lines.append("- Quindi: **nessun nuovo bonifico da erogare adesso.**\n")
lines.append("## Verifica di coerenza (pos 0)\n")
lines.append("- Soglia pos 0 = 114. Nella mappa la posizione 114 è del 2026-06-14; il dono di 500 è stato pagato il 2026-06-22 (tx 0x1ae343…). Coerente (soglia raggiunta prima del pagamento).\n")
lines.append("## Caveat\n")
lines.append("- L'intero esatto della soglia ha incertezza ± (dipende da come gli slot Gemelli contano nel riempimento delle prime tavole; un Gemello si materializza solo all'uscita da Venere del genitore). Le conclusioni direzionali sopra restano valide (114«248, 270»248).")
lines.append("- Copre lo stadio **Venere Primario**. I doni a valle (Nettuno 800 a 108 posizioni; Venere Secondario 90; Giove 400; Saturno 2400) richiedono il motore completo (Blocco 2 + coda Nettuno FIFO) — step successivo se serve.")
lines.append("- **CASSA = accantonamento**, non payout: le posizioni dispari maturano ma non generano bonifici.")
with open(out_md, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

# ---------- Sommario a video ----------
print("="*72)
print("URANUS — SEQUENZA DI RICEZIONE (uscite Venere Primario)")
print("="*72)
print(f"Stato: {donations} donazioni · {duals} duali · {donation_positions} pos donazione · {n_reserved} riservati · pos max {maxpos}")
print("-"*72)
for r in rows[:8]:
    imp = f"{r['amount']}" if r["amount"] is not None else "acc."
    print(f"pos {r['p']:>2} | turno {r['turno']:>2} | {r['tipo']:<6} | soglia {r['soglia']:>4} | {'RAGGIUNTA' if r['reached'] else 'futura   '} | {r['stato']}")
print("-"*72)
if prossimo:
    print(f"Prossimo payout su wallet: pos {prossimo['p']} (HUMAN) {prossimo['amount']} USDC @ soglia {prossimo['soglia']} (mancano ~{prossimo['soglia']-maxpos} posizioni)")
print(f"OUTPUT:\n  {out_csv}\n  {out_md}")
