// Clerk auth for the front-door Worker.
//
// The app authenticates with Clerk (the shared iddofroom.co.il instance). The Worker verifies
// the Clerk session JWT — from the `__session` cookie or an `Authorization: Bearer` header —
// against the instance's public JWKS, and reads the user's verified `email` for authorization.
// Per-project membership/roles live in cf-worker/library.js. No Clerk SECRET key is needed
// (JWKS is public); the `email` claim must be added to the instance session token (dashboard).
//
// Config (Worker vars/secrets — never in git, repo is PUBLIC):
//   CLERK_ISSUER     instance Frontend API URL = the JWT `iss`, e.g. https://xxx.clerk.accounts.dev
//                    (JWKS at ${CLERK_ISSUER}/.well-known/jwks.json)
//   LIBRARY_API_KEY  shared key letting local dev reach /api/library/* without a Clerk session

// ── base64url ───────────────────────────────────────────────────────────────
function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64urlToStr(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

// Constant-time-ish compare (avoids early-exit timing leak on the library key).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// ── JWKS (cached per Worker isolate; refreshed on TTL or a kid miss) ───────────
let _jwks = { iss: null, keys: null, at: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(issuer, force) {
  const now = Date.now();
  if (!force && _jwks.keys && _jwks.iss === issuer && now - _jwks.at < JWKS_TTL_MS) return _jwks.keys;
  const resp = await fetch(`${issuer}/.well-known/jwks.json`, { cf: { cacheTtl: 3600 } });
  if (!resp.ok) throw new Error('JWKS fetch failed: ' + resp.status);
  const data = await resp.json();
  const keys = (data && data.keys) || [];
  // Don't clobber a good cache with an empty/degraded response (transient origin issue).
  if (keys.length || !_jwks.keys) _jwks = { iss: issuer, keys, at: now };
  return _jwks.keys;
}

async function importRsaKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/** Verify a Clerk RS256 JWT against the instance JWKS. Returns the payload, or null. */
async function verifyJwt(token, issuer) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64urlToStr(parts[0]));
    payload = JSON.parse(b64urlToStr(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let keys;
  try {
    keys = await getJwks(issuer, false);
  } catch {
    return null;
  }
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Signing key rotated — force one refresh before giving up.
    try {
      keys = await getJwks(issuer, true);
    } catch {
      return null;
    }
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  let ok = false;
  try {
    const key = await importRsaKey(jwk);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), data);
  } catch {
    return null;
  }
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  // Fail closed: require a numeric, unexpired exp and an issuer that matches exactly.
  if (typeof payload.exp !== 'number' || now > payload.exp) return null;
  if (typeof payload.nbf === 'number' && now + 5 < payload.nbf) return null;
  if (payload.iss !== issuer) return null;
  return payload;
}

/**
 * Verify the caller's Clerk session (Bearer header or __session cookie). Returns { email, sub }
 * on success, else null. `email` requires the instance session token to include the email claim.
 */
export async function verifyClerkRequest(request, env) {
  const issuer = env && env.CLERK_ISSUER;
  if (!issuer) return null;
  let token = '';
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
  if (!token) token = parseCookies(request)['__session'] || '';
  if (!token) return null;
  const payload = await verifyJwt(token, issuer);
  if (!payload) return null;
  return { email: String(payload.email || '').toLowerCase(), sub: payload.sub || '' };
}

/**
 * True for a machine caller presenting the shared library key (local-dev superuser bypass on
 * /api/library/* only). Accepts the key in the `X-Library-Key` header (fetch) OR a `libkey` query
 * param (media/audio URLs, where an <audio>/spectrogram element cannot set a custom header).
 */
export function hasLibraryKey(request, env) {
  const key = env && env.LIBRARY_API_KEY;
  if (!key) return false;
  let provided = request.headers.get('X-Library-Key') || '';
  if (!provided) {
    try {
      provided = new URL(request.url).searchParams.get('libkey') || '';
    } catch {}
  }
  return safeEqual(provided, key);
}
