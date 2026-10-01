export type AuthSession = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email?: string } };
type AuthResponse = Partial<AuthSession> & { expires_in?: number; error_description?: string; msg?: string; message?: string };
const storageKey = "merlin.auth.session.v1";
const recoveryKey = "merlin.auth.recovery";
const confirmationKey = "merlin.auth.email-confirmation";
export const getEmailConfirmationStatus = () => sessionStorage.getItem(confirmationKey);
export const isPasswordRecovery = () => sessionStorage.getItem(recoveryKey) === "1";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const authConfigured = Boolean(supabaseUrl && publishableKey);
export const authConfig = { url: supabaseUrl?.replace(/\/$/, ""), key: publishableKey };
const apiUrl = () => { if (!authConfigured) throw new Error("Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY."); return authConfig.url!; };
function emit() { window.dispatchEvent(new Event("merlin-auth-change")); }
function save(session: AuthSession | null) { if (session) localStorage.setItem(storageKey, JSON.stringify(session)); else { localStorage.removeItem(storageKey); sessionStorage.removeItem(recoveryKey); } emit(); }
export function getSession(): AuthSession | null { try { const value = localStorage.getItem(storageKey); return value ? JSON.parse(value) as AuthSession : null; } catch { return null; } }
async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl()}/auth/v1${path}`, { method: "POST", headers: { apikey: authConfig.key!, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const result = await response.json().catch(() => ({})) as AuthResponse & T;
  if (!response.ok) throw new Error(result.msg || result.message || result.error_description || "Authentication request failed.");
  return result;
}
function normalizeSession(value: AuthResponse): AuthSession | null {
  if (!value.access_token || !value.refresh_token || !value.user?.id) return null;
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (value.expires_in ?? 3600), user: value.user };
}
export async function signIn(email: string, password: string) { const response = await authRequest<AuthResponse>("/token?grant_type=password", { email, password }); const session = normalizeSession(response); if (!session) throw new Error("Sign-in did not return a session."); save(session); return session; }
export async function signUp(email: string, password: string, name: string) { const result = await authRequest<AuthResponse>(`/signup?redirect_to=${encodeURIComponent(`${window.location.origin}/login`)}`, { email, password, data: { display_name: name } }); const session = normalizeSession(result); if (session) save(session); return { session, confirmationRequired: !session }; }
export async function signOut() { const session = getSession(); if (session && authConfigured) await fetch(`${apiUrl()}/auth/v1/logout`, { method: "POST", headers: { apikey: authConfig.key!, Authorization: `Bearer ${session.access_token}` } }).catch(() => undefined); save(null); }
export async function sendPasswordReset(email: string) { await authRequest(`/recover?redirect_to=${encodeURIComponent(`${window.location.origin}/reset-password`)}`, { email }); }
export async function updatePassword(password: string) { const session = getSession(); if (!session) throw new Error("Open the password reset link from your email first."); const response = await fetch(`${apiUrl()}/auth/v1/user`, { method: "PUT", headers: { apikey: authConfig.key!, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); if (!response.ok) throw new Error("Could not update password. Request a new reset link."); }
async function refreshSession(session: AuthSession): Promise<AuthSession | null> { const result = await authRequest<AuthResponse>("/token?grant_type=refresh_token", { refresh_token: session.refresh_token }); const updated = normalizeSession(result); if (updated) save(updated); else save(null); return updated; }
export async function ensureFreshSession(): Promise<AuthSession | null> { let session = getSession(); if (!session) return null; if (session.expires_at <= Math.floor(Date.now() / 1000) + 60) { try { session = await refreshSession(session); } catch { save(null); return null; } } return session; }
export async function restoreSession(): Promise<AuthSession | null> {
  if (!authConfigured) return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const recoveryAccessToken = hash.get("access_token");
  const recoveryRefreshToken = hash.get("refresh_token");
  const flowType = hash.get("type");
  const query = new URLSearchParams(window.location.search);
  const tokenHash = query.get("token_hash");
  const confirmationType = flowType ?? query.get("type");
  const callbackError = hash.get("error") ?? query.get("error");
  const isConfirmation = ["signup", "email"].includes(confirmationType ?? "");
  const isConfirmationPage = [`${import.meta.env.BASE_URL}login`, `${import.meta.env.BASE_URL}email-confirmed`].includes(window.location.pathname);
  if (isConfirmation || (callbackError && isConfirmationPage)) {
    sessionStorage.removeItem(confirmationKey);
    save(null);
    let status = "error";
    try {
      if (!callbackError && (recoveryAccessToken || tokenHash)) {
        const response = tokenHash
          ? await fetch(`${apiUrl()}/auth/v1/verify`, {
              method: "POST",
              headers: { apikey: authConfig.key!, "Content-Type": "application/json" },
              body: JSON.stringify({ token_hash: tokenHash, type: confirmationType }),
            })
          : await fetch(`${apiUrl()}/auth/v1/user`, {
              headers: { apikey: authConfig.key!, Authorization: `Bearer ${recoveryAccessToken}` },
            });
        if (response.ok) {
          const result = await response.json() as { id?: string; email_confirmed_at?: string | null; confirmed_at?: string | null; user?: { id?: string; email_confirmed_at?: string | null; confirmed_at?: string | null } };
          const user = tokenHash ? result.user : result;
          status = user?.id && (user.email_confirmed_at || user.confirmed_at) ? "success" : "error";
        } else if (response.status >= 500 || response.status === 429) {
          status = "unavailable";
        }
      }
    } catch {
      status = "unavailable";
    }
    sessionStorage.setItem(confirmationKey, status);
    history.replaceState(null, "", `${import.meta.env.BASE_URL}email-confirmed`);
    return null;
  }
  if (window.location.pathname === `${import.meta.env.BASE_URL}email-confirmed`) return null;
  if (recoveryAccessToken && recoveryRefreshToken && ["recovery", "magiclink"].includes(flowType ?? "")) {
    if (flowType === "recovery") sessionStorage.setItem(recoveryKey, "1");
    const response = await fetch(`${apiUrl()}/auth/v1/user`, { headers: { apikey: authConfig.key!, Authorization: `Bearer ${recoveryAccessToken}` } });
    if (response.ok) { const user = await response.json() as AuthSession["user"]; const session = { access_token: recoveryAccessToken, refresh_token: recoveryRefreshToken, expires_at: Number(hash.get("expires_at")) || Math.floor(Date.now()/1000)+3600, user }; save(session); history.replaceState(null, "", `${location.pathname}${location.search}`); return session; }
  }
  const session = await ensureFreshSession(); if (!session) return null;
  try { const response = await fetch(`${apiUrl()}/auth/v1/user`, { headers: { apikey: authConfig.key!, Authorization: `Bearer ${session.access_token}` } }); if (response.ok) return session; } catch { /* Treat an unavailable Auth API as signed out for this browser view. */ }
  save(null); return null;
}
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  let session = await ensureFreshSession();
  const makeRequest = () => fetch(input, { ...init, headers: { ...init.headers, ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) } });
  let response = await makeRequest();
  if (response.status === 401 && session) { session = await refreshSession(session); if (session) response = await makeRequest(); }
  return response;
}
