/**
 * 🔐 SIWE — Sign-In With Ethereum
 *
 * Autenticazione wallet via firma EIP-4361.
 * Client-side per ora — verifica server-side al collegamento del backend.
 */

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export interface AuthSession {
  wallet: string;
  name: string;
  message: string;
  signature: string;
  chainId: number;
  issuedAt: string;
  expiresAt: string;
}

// ── SIWE Message ──────────────────────────────────────────────

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function createSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    "",
    "Accedi a ROG-URANUS \u2014 Sistema di Economia del Dono su Polygon.",
    "",
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expirationTime}`,
  ].join("\n");
}

/**
 * Autentica l'utente con SIWE via MetaMask.
 * Genera un messaggio EIP-4361, lo fa firmare, e restituisce la sessione.
 */
export async function signInWithEthereum(
  ethereum: EthereumProvider,
  wallet: string
): Promise<AuthSession> {
  const domain =
    typeof window !== "undefined" ? window.location.host : "localhost:3000";
  const uri =
    typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000";
  const chainId = 137; // Polygon
  const nonce = generateNonce();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const message = createSiweMessage({
    domain,
    address: wallet,
    uri,
    chainId,
    nonce,
    issuedAt,
    expirationTime: expiresAt,
  });

  const signature = (await ethereum.request({
    method: "personal_sign",
    params: [message, wallet],
  })) as string;

  return {
    wallet,
    name: wallet.slice(0, 6) + "..." + wallet.slice(-4),
    message,
    signature,
    chainId,
    issuedAt,
    expiresAt,
  };
}

// ── Session Management ────────────────────────────────────────

const SESSION_KEY = "uranus_session";

export function saveSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    const session: AuthSession = JSON.parse(stored);
    if (new Date(session.expiresAt) < new Date()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("uranus_user"); // pulizia legacy
}

export function getSessionWallet(): string | null {
  return getSession()?.wallet ?? null;
}
