// Google OAuth gate for leds.iddofroom.co.il — built into the front-door Worker.
//
// The whole subdomain sits behind a Google sign-in restricted to an email allowlist.
// Sessions are stateless: a signed (HMAC-SHA256) cookie carrying { email, exp }. No KV,
// no external session store. The OAuth endpoints live under /auth/* and are the only
// routes served BEFORE the auth check (see worker.js).
//
// Config (all via `wrangler secret put`, never committed — this repo is PUBLIC):
//   GOOGLE_CLIENT_ID      OAuth 2.0 Web client id
//   GOOGLE_CLIENT_SECRET  OAuth 2.0 Web client secret
//   SESSION_SECRET        random string, HMAC key for the session + state cookies
//   ALLOWED_EMAILS        comma-separated allowlist (case-insensitive)
//   LIBRARY_API_KEY       shared key that lets local dev reach /api/library/* w/o a cookie

const SESSION_COOKIE = 'leds_session';
const STATE_COOKIE = 'leds_oauth_state';
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const STATE_TTL_SEC = 10 * 60; // 10 minutes

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

// ── base64url helpers ─────────────────────────────────────────────────────────
function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function strToB64url(str) {
  return bytesToB64url(new TextEncoder().encode(str));
}
function b64urlToStr(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── HMAC signing ──────────────────────────────────────────────────────────────
async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToB64url(new Uint8Array(sig));
}
// Constant-time-ish string compare (avoids early-exit timing leak on the signature).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build a signed token `<b64url(payloadJson)>.<b64url(hmac)>`. */
async function signToken(secret, payload) {
  const body = strToB64url(JSON.stringify(payload));
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}
/** Verify a signed token; returns the payload object or null (bad sig / expired / malformed). */
async function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacSign(secret, body);
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlToStr(body));
  } catch {
    return null;
  }
  // Require a numeric, unexpired exp: a signed token missing/with a non-numeric exp is rejected
  // (never treated as valid forever), even if the signing code ever changes.
  if (!payload || typeof payload.exp !== 'number' || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

// ── cookies ───────────────────────────────────────────────────────────────────
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
function setCookie(name, value, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  return parts.join('; ');
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function allowedSet(env) {
  return new Set(
    String((env && env.ALLOWED_EMAILS) || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Read + verify the session cookie. Returns { email } for a valid, unexpired, allowlisted
 * session, else null. (Re-checks the allowlist on every request so revoking access is
 * immediate — remove the email from ALLOWED_EMAILS and the next request is rejected.)
 */
export async function requireAuth(request, env) {
  const secret = env && env.SESSION_SECRET;
  if (!secret) return null;
  const token = parseCookies(request)[SESSION_COOKIE];
  const payload = await verifyToken(secret, token);
  if (!payload || !payload.email) return null;
  if (!allowedSet(env).has(String(payload.email).toLowerCase())) return null;
  return { email: payload.email };
}

/**
 * True for a machine caller presenting the shared library key (local dev bypass). Accepts the
 * key in the `X-Library-Key` header (fetch calls) OR a `libkey` query param (media/audio URLs,
 * where a <audio>/spectrogram element cannot set a custom header).
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

// ── /auth/* routes (served before the auth gate) ────────────────────────────────
export async function handleAuth(request, env, url) {
  const p = url.pathname;
  const secret = env && env.SESSION_SECRET;
  const clientId = env && env.GOOGLE_CLIENT_ID;
  const clientSecret = env && env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${url.origin}/auth/callback`;

  if (p === '/auth/me') {
    const session = await requireAuth(request, env);
    return new Response(JSON.stringify(session ? { email: session.email } : { email: null }), {
      status: session ? 200 : 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (p === '/auth/logout') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/auth/login', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, 'Cache-Control': 'no-store' },
    });
  }

  if (p === '/auth/login') {
    if (!clientId || !secret) return html('<h1>Auth not configured</h1><p>Worker secrets GOOGLE_CLIENT_ID / SESSION_SECRET are missing.</p>', 500);
    const state = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
    const stateToken = await signToken(secret, { state, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC });
    const auth = new URL(GOOGLE_AUTH);
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', redirectUri);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('scope', 'openid email profile');
    auth.searchParams.set('prompt', 'select_account');
    auth.searchParams.set('state', state);
    return new Response(null, {
      status: 302,
      headers: { Location: auth.toString(), 'Set-Cookie': setCookie(STATE_COOKIE, stateToken, STATE_TTL_SEC), 'Cache-Control': 'no-store' },
    });
  }

  if (p === '/auth/callback') {
    if (!clientId || !clientSecret || !secret) return html('<h1>Auth not configured</h1>', 500);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) return html('<h1>Sign-in failed</h1><p>Missing authorization code.</p>', 400);

    // CSRF: the state must match the value we signed into the short-lived state cookie.
    const stateToken = parseCookies(request)[STATE_COOKIE];
    const statePayload = await verifyToken(secret, stateToken);
    if (!statePayload || !state || statePayload.state !== state) {
      return html('<h1>Sign-in failed</h1><p>Invalid or expired state. <a href="/auth/login">Try again</a>.</p>', 400);
    }

    // Exchange the code for tokens (server-to-server, over TLS).
    let tokenJson;
    try {
      const resp = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      tokenJson = await resp.json();
      if (!resp.ok) return html(`<h1>Sign-in failed</h1><pre>${escapeHtml(JSON.stringify(tokenJson))}</pre>`, 400);
    } catch (e) {
      return html('<h1>Sign-in failed</h1><p>Token exchange error.</p>', 502);
    }

    // The id_token came straight from Google's token endpoint over TLS, so reading its
    // payload (no JWKS signature re-check) is sufficient to trust the email claim.
    const idToken = tokenJson && tokenJson.id_token;
    let claims = {};
    try {
      const mid = String(idToken || '').split('.')[1];
      claims = JSON.parse(b64urlToStr(mid));
    } catch {
      return html('<h1>Sign-in failed</h1><p>Could not read identity token.</p>', 400);
    }
    const email = String(claims.email || '').toLowerCase();
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    // Defense-in-depth: the token came from a client-secret-keyed exchange, but also require it
    // to be minted for THIS client (aud) so a misconfigured/reused secret can't grant access.
    const audOk = claims.aud === clientId;

    if (!email || !verified || !audOk || !allowedSet(env).has(email)) {
      const body = accessDeniedHtml(claims.email || '(unknown)');
      // Clear the state cookie; do NOT set a session.
      return new Response(body, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
    }

    const session = await signToken(secret, { email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC });
    const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', setCookie(SESSION_COOKIE, session, SESSION_TTL_SEC));
    headers.append('Set-Cookie', `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  }

  return html('<h1>Not found</h1>', 404);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function accessDeniedHtml(email) {
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>אין הרשאה</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}
  body{margin:0;min-height:100vh;font-family:system-ui,"Segoe UI",Arial,sans-serif;
    background:radial-gradient(1200px 600px at 50% -10%,#3a1f2a,#0b0f1a 60%);color:#e7ecf5;
    display:flex;align-items:center;justify-content:center;padding:24px}
  .card{width:100%;max-width:460px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
    border-radius:20px;padding:32px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  h1{margin:0 0 10px;font-size:24px}p{color:#c3b0b8;line-height:1.6;margin:0 0 20px}
  code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:6px}
  a{display:inline-block;background:linear-gradient(135deg,#5b8cff,#7a5cff);color:#fff;font-weight:700;
    text-decoration:none;padding:12px 22px;border-radius:12px}
</style></head><body><div class="card">
  <h1>🔒 אין הרשאת גישה</h1>
  <p>החשבון <code>${escapeHtml(email)}</code> אינו מורשה לגשת לכלי הזה.</p>
  <a href="/auth/login">התחבר עם חשבון אחר</a>
</div></body></html>`;
}
