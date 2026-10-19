import { randomBytes, timingSafeEqual } from "node:crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const TOKEN_HEADER = "x-studio-token";

/**
 * Request guard against other web pages and other devices driving the local API.
 * - Host must be one of the app's own addresses (blocks DNS rebinding).
 * - Origin, when present, must be one of the app's own origins.
 * - Cross-site fetches are refused outright.
 * - Anything that changes state needs the per-start token, which only a page served from an
 *   allowed Host/Origin can read from /api/session.
 *
 * @param {{ ports: number[], extraHosts?: string[], token?: string }} options
 */
export function createGuard({ ports, extraHosts = [], token = randomBytes(32).toString("hex") }) {
  const hosts = new Set(extraHosts.map((host) => host.toLowerCase()));
  for (const port of ports) {
    hosts.add(`127.0.0.1:${port}`);
    hosts.add(`localhost:${port}`);
  }
  const origins = new Set([...hosts].flatMap((host) => [`http://${host}`, `https://${host}`]));
  const tokenBuffer = Buffer.from(token);

  function tokenMatches(candidate) {
    if (typeof candidate !== "string") return false;
    const candidateBuffer = Buffer.from(candidate);
    // timingSafeEqual throws on a length mismatch, so compare lengths first.
    return candidateBuffer.length === tokenBuffer.length && timingSafeEqual(candidateBuffer, tokenBuffer);
  }

  /** @returns {{ ok: true } | { ok: false, status: number, error: string }} */
  function check(req) {
    const host = String(req.headers.host ?? "").toLowerCase();
    if (!hosts.has(host)) return { ok: false, status: 403, error: "허용되지 않은 주소입니다." };

    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(String(origin).toLowerCase())) {
      return { ok: false, status: 403, error: "허용되지 않은 출처입니다." };
    }
    if (req.headers["sec-fetch-site"] === "cross-site") {
      return { ok: false, status: 403, error: "다른 사이트의 요청은 허용되지 않습니다." };
    }

    if (!SAFE_METHODS.has(String(req.method).toUpperCase()) && !tokenMatches(req.headers[TOKEN_HEADER])) {
      return { ok: false, status: 403, error: "토큰이 없거나 올바르지 않습니다." };
    }
    return { ok: true };
  }

  return { token, check };
}
