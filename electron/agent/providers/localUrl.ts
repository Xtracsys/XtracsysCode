/**
 * v5 R9 — local-only enforcement for backend URLs.
 *
 * Every model-backend URL must point at the loopback host. This is the single
 * validation both providers use: supported schemes only, no credentials in the URL,
 * and loopback hosts only (localhost, 127.0.0.0/8, ::1). The providers also fetch
 * with redirect: "error" so a compromised/redirecting endpoint can't bounce traffic
 * off the machine.
 */

const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  if (LOOPBACK_V4.test(host)) return true;
  // IPv6 loopback forms like 0:0:0:0:0:0:0:1.
  return host === "0:0:0:0:0:0:0:1";
}

/**
 * Validate and normalize a backend base URL. Throws with an actionable message for
 * anything that is not a plain http(s) URL on the loopback host.
 */
export function loopbackBase(rawUrl: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} URL is not valid: "${rawUrl}". Use e.g. http://127.0.0.1:11434`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} URL must use http:// or https:// (got "${parsed.protocol}").`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} URL must not contain credentials (user:password@).`);
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `${label} URL must point at this machine (localhost / 127.x.x.x / ::1) — got "${parsed.hostname}". XtracsysCode is local-only.`,
    );
  }
  return parsed.origin === "null" ? rawUrl.replace(/\/+$/, "") : parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, ""));
}

/** fetch options that refuse redirects (a redirect could leave the loopback). */
export const NO_REDIRECT = { redirect: "error" } as const;
