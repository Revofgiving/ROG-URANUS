// ─── Admin API Utility ───
// Gestisce le chiamate al backend URANUS con autenticazione admin

export interface AdminConfig {
  apiUrl: string;
  apiKey: string;
}

const DEFAULT_CONFIG: AdminConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  apiKey: "",
};

export function getAdminConfig(): AdminConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  const stored = localStorage.getItem("uranus_admin_config");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

export function saveAdminConfig(config: AdminConfig) {
  localStorage.setItem("uranus_admin_config", JSON.stringify(config));
}

export interface ApiOptions extends RequestInit {
  admin?: boolean;
}

export async function adminApi<T = unknown>(
  path: string,
  opts: ApiOptions = {}
): Promise<T> {
  const config = getAdminConfig();
  const url = config.apiUrl.replace(/\/$/, "") + path;
  const { admin, headers: extraHeaders, ...rest } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extraHeaders as Record<string, string>),
  };
  if (admin) {
    headers["X-Admin-Key"] = config.apiKey;
  }
  const res = await fetch(url, { ...rest, headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

// ─── Admin Auth ───
export interface AdminSession {
  username: string;
  loggedAt: string;
}

export async function adminLogin(username: string, password: string): Promise<boolean> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const res = await fetch(`${apiUrl}/api/admin/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success && data.session) {
      localStorage.setItem("uranus_admin", JSON.stringify(data.session));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getAdminSession(): AdminSession | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem("uranus_admin");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

export function adminLogout() {
  localStorage.removeItem("uranus_admin");
}
