// Gate di ingresso ROG → URANUS (logica CONDIVISA tra /register e /community).
// Implementa l'ordine ESATTO della specifica del flusso di donazione:
//   (3-4) storico URANUS → utente di ritorno: accede e dona subito              → "form"
//   (6)   community ROG = NO                                                     → "not-community"
//         community OK, donazione ROG Small NON verificata (posizione < 20488)   → "need-rog-small"
//         community OK + donazione verificata                                    → "form"
// Se il backend ROG non è raggiungibile per un nuovo utente → "offline-blocked" (fail-closed).

export type GateDecision = "form" | "not-community" | "need-rog-small" | "offline-blocked";

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function evaluateRogGate(walletAddr: string): Promise<GateDecision> {
  const w = (walletAddr || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(w)) return "offline-blocked";

  // (3) Storico URANUS: se ha già una posizione è un utente "di ritorno".
  let hasUranusAccount = false;
  try {
    const accountRes = await fetch(`${BACKEND}/api/posizione/${w}`);
    if (accountRes.ok) {
      const accountData = (await accountRes.json()) as { success?: boolean; account?: unknown };
      hasUranusAccount = !!(accountData?.success && accountData?.account);
    }
  } catch {}

  // (4) Utente di ritorno → accede e può donare subito, nessun prerequisito ROG.
  if (hasUranusAccount) return "form";

  // (5-6) Nuovo utente: prerequisiti ROG (community + donazione ROG Small ≥ 2 USDC).
  let rogData: { communityRegistered?: boolean; canProceed?: boolean } | null = null;
  try {
    const rogRes = await fetch(`${BACKEND}/api/rog-status/${w}`, { signal: AbortSignal.timeout(6000) });
    if (rogRes.ok) rogData = (await rogRes.json()) as { communityRegistered?: boolean; canProceed?: boolean };
  } catch {}

  // ROG non raggiungibile: fail-closed per i nuovi utenti.
  if (!rogData) return "offline-blocked";

  // CHECK 1 — iscrizione community ROG.
  if (!rogData.communityRegistered) return "not-community";

  // CHECK 2 — donazione ROG Small verificata (posizione ≥ 20488 o conferma on-chain, lato backend).
  if (!rogData.canProceed) return "need-rog-small";

  return "form";
}
