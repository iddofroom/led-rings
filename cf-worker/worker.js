// Front-door Worker for kivsee.iddofroom.co.il
// - Host (friend's PC) DOWN  -> serve a landing page (password-gated download + setup steps)
// - Host UP                  -> transparently proxy the live app (same URL = the bridge)
// The Worker reaches the host via an internal hostname (ORIGIN) that the tunnel serves.
import { BUNDLE_B64 } from './bundle.js';
import { GUIDE_HTML } from './guide.js';
import { handleLibrary, roleOf } from './library.js';
import { verifyClerkRequest, hasLibraryKey } from './auth.js';

const noStore = { 'Cache-Control': 'no-store' };
const unauthorized = () => new Response('Unauthorized', { status: 401, headers: noStore });
const forbidden = () => new Response('Forbidden', { status: 403, headers: noStore });

const ORIGIN = 'https://o.iddofroom.co.il'; // internal tunnel hostname (not user-facing)
const BUNDLE_NAME = 'led-rings-host-bundle.zip';
const PASSWORD = 'RFID'; // download password (case-insensitive)

// esp-web-tools manifest for browser flashing. `builds` is empty until real KivSee binaries are
// published (see firmware/README.md for the build + config contract); the flash UI degrades
// gracefully on an empty builds array. Replace with per-chip merged-bin @ offset 0 when ready.
const FIRMWARE_MANIFEST = {
  name: 'KivSee LED Controller',
  version: '0.0.0-placeholder',
  new_install_prompt_erase: true,
  builds: [],
  status: 'no-firmware-yet',
  note: 'Firmware binaries are not published yet. See firmware/README.md for the build + config contract.',
};

function isDown(resp) {
  // Cloudflare returns 530 (1033) when the tunnel has no healthy connector,
  // and 502/503/504/52x during connector drop or while reconnecting.
  if (!resp) return true;
  const s = resp.status;
  return s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 530);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ownerEmail = String((env && env.OWNER_EMAIL) || '').toLowerCase();

    // Public build guide — served from the edge, no auth, even when the host PC is down.
    // Open to everyone (no account needed), so it short-circuits BEFORE the Clerk gate and
    // the host proxy below. Content is baked into guide.js for a buildless deploy.
    if (request.method === 'GET' && (url.pathname === '/guide' || url.pathname === '/guide/')) {
      return new Response(GUIDE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      });
    }

    // Clerk gates the API surface only. Static app assets (everything not under /api/* and not
    // /download) proxy through UNAUTHENTICATED so the React app + Clerk sign-in page can load;
    // the app then renders nothing until signed in. Per-project authorization is enforced below.
    const isLibraryPath = url.pathname.startsWith('/api/library');
    const isApi = url.pathname.startsWith('/api/');
    const isPreflight = request.method === 'OPTIONS' && isLibraryPath;
    const libKeyOk = isLibraryPath && hasLibraryKey(request, env);

    // CSRF defense-in-depth: reject cross-site state-changing API calls. The app is same-origin
    // (Origin host === this host); local dev is cross-origin but authenticates with the library
    // key (exempt, since a browser can't attach it cross-site). Clerk's SameSite=Lax cookie
    // already blocks this, but a browser can never forge the Origin header, so this is a hard gate.
    if (isApi && !isPreflight && !libKeyOk && request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin) {
        let crossSite = true;
        try { crossSite = new URL(origin).host !== url.host; } catch {}
        if (crossSite) return forbidden();
      }
    }

    let session = null; // { email, sub } | null
    if (isApi && !isPreflight) {
      // Liveness probe used by the (pre-login) landing page to detect the host coming up.
      const isLiveness = (request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/brightness';
      if (isLibraryPath) {
        if (!libKeyOk) {
          session = await verifyClerkRequest(request, env);
          if (!session) return unauthorized();
        }
      } else if (!isLiveness) {
        // LED control / host-compute API → require a member of the rings project (the hardware).
        session = await verifyClerkRequest(request, env);
        if (!session) return unauthorized();
        const role = await roleOf(env && env.LED_LIBRARY, 'rings', session.email, ownerEmail);
        if (!role) return forbidden();
      }
    }

    // Song library (KV-backed): list/upload/save MP3s, analysis, AI output and saved animations.
    // Handled at the edge — never proxied to the host PC. Per-project membership enforced inside
    // handleLibrary using `auth`. Returns null for non-library routes so the proxy below runs.
    const auth = { email: session ? session.email : '', isSuperuser: libKeyOk, ownerEmail };
    const lib = await handleLibrary(request, env, url, auth);
    if (lib) return lib;

    // Password-gated download of the host bundle (served from the edge, even when host is down).
    // A correct password always works; WRONG attempts are rate limited to 3 per IP per day.
    if (url.pathname === '/download' || url.pathname === '/' + BUNDLE_NAME) {
      const key = (url.searchParams.get('key') || '').trim();

      if (key.toUpperCase() === PASSWORD.toUpperCase()) {
        const bin = atob(BUNDLE_B64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${BUNDLE_NAME}"`,
            'Cache-Control': 'no-store',
          },
        });
      }

      // Wrong password -> brute-force throttle: max 3 failed tries per IP per (UTC) day.
      const MAX = 3;
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const day = new Date().toISOString().slice(0, 10);
      const rlKey = `rl:dl:${day}:${ip}`;
      const KV = env && env.LED_LIBRARY;
      const txt = (m, s) => new Response(m, { status: s, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

      let count = 0;
      if (KV) { try { count = parseInt(await KV.get(rlKey), 10) || 0; } catch (e) {} }
      if (count >= MAX) return txt('⛔ חרגת מ-3 הניסיונות המותרים להיום. נסה שוב מחר.', 429);

      const newCount = count + 1;
      if (KV) { try { await KV.put(rlKey, String(newCount), { expirationTtl: 172800 }); } catch (e) {} }

      if (newCount >= MAX) return txt('⛔ סיסמה שגויה. זה היה הניסיון השלישי — ההורדה חסומה עד מחר.', 429);
      if (newCount === 2) return txt('⚠️ סיסמה שגויה. אזהרה: נשאר לך ניסיון אחד בלבד היום.', 403);
      return txt('סיסמה שגויה.', 403);
    }

    // Firmware for browser-based ESP flashing (esp-web-tools). Served same-origin from the edge
    // (never proxied to the Pi, works even when it's down) so no CORS proxy is needed. The manifest
    // ships with an empty `builds` array until real KivSee binaries are published — the flash UI
    // detects that and degrades to a "firmware not published yet / flash manually" panel.
    if (url.pathname === '/firmware/manifest.json') {
      return new Response(JSON.stringify(FIRMWARE_MANIFEST), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (url.pathname.startsWith('/firmware/')) {
      // .bin parts will be served here (from R2/KV) once firmware is published.
      return new Response('Firmware binary not published yet', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    // Try the live host (tunnel origin).
    let resp = null;
    try {
      const headers = new Headers(request.headers);
      headers.delete('host');
      const init = { method: request.method, headers, redirect: 'manual' };
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
      resp = await fetch(ORIGIN + url.pathname + url.search, init);
    } catch (e) {
      resp = null;
    }

    if (!isDown(resp)) {
      // Host is up: pass its response straight through.
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
    }

    // Host is down: HTML navigations get the landing page; everything else gets 503.
    const accept = request.headers.get('Accept') || '';
    if (request.method === 'GET' && (url.pathname === '/' || accept.includes('text/html'))) {
      return new Response(LANDING_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Host offline', { status: 503 });
  },
};

const LANDING_HTML = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>שליטה בלדים — הקמה</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; font-family: system-ui, "Segoe UI", Arial, sans-serif;
         background: radial-gradient(1200px 600px at 50% -10%, #1f2a44, #0b0f1a 60%); color:#e7ecf5;
         display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:560px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
          border-radius:20px; padding:32px; box-shadow:0 20px 60px rgba(0,0,0,.4); }
  h1 { margin:0 0 6px; font-size:26px; }
  .sub { color:#9fb0cc; margin:0 0 22px; font-size:15px; line-height:1.5; }
  .pw { width:100%; padding:14px 16px; border-radius:12px; border:1px solid rgba(255,255,255,.14);
        background:rgba(0,0,0,.25); color:#fff; font-size:16px; margin:0 0 12px; text-align:center; }
  .pw:focus { outline:none; border-color:#7a5cff; }
  .dl { display:block; width:100%; text-align:center; border:0; cursor:pointer;
        background:linear-gradient(135deg,#5b8cff,#7a5cff);
        color:#fff; font-weight:700; font-size:18px; padding:16px; border-radius:14px;
        box-shadow:0 10px 30px rgba(90,120,255,.35); }
  .dl:hover { filter:brightness(1.08); }
  .err { min-height:20px; margin:10px 0 18px; color:#ff8a8a; font-size:14px; text-align:center; }
  ol { margin:0; padding-inline-start:20px; line-height:1.8; }
  ol b { color:#fff; }
  a.inline { color:#8fb4ff; }
  .foot { margin-top:22px; font-size:13px; color:#8295b5; display:flex; align-items:center; gap:8px; }
  .dot { width:9px; height:9px; border-radius:50%; background:#f0a020; box-shadow:0 0 10px #f0a020; animation:p 1.4s infinite; }
  @keyframes p { 0%,100%{opacity:.4} 50%{opacity:1} }
  code { background:rgba(255,255,255,.08); padding:2px 6px; border-radius:6px; font-size:13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>🎛️ שליטה בלדים</h1>
    <p class="sub">ה-Raspberry Pi שמחובר ללדים עדיין לא פעיל. כדי להפעיל את השליטה, הרץ עליו פעם אחת את התוכנה הקטנה:</p>
    <input id="pw" class="pw" type="password" placeholder="סיסמה" autocomplete="off" onkeydown="if(event.key==='Enter')dl()">
    <button class="dl" onclick="dl()">⬇️ הורד את חבילת ההתקנה</button>
    <div id="err" class="err"></div>
    <ol>
      <li>העבר וחלץ את ה-zip על ה-<b>Raspberry Pi</b> (Raspberry Pi OS, 64-bit).</li>
      <li>בטרמינל, היכנס לתיקייה והרץ <code>bash led-rings-host.sh</code> — מתקין הכל לבד (Node, cloudflared, הקוד) ובונה את הממשק (כמה דקות).</li>
      <li>אופציונלי, שיעלה לבד בכל הדלקה: <code>bash led-rings-host-enable-autostart.sh</code>.</li>
    </ol>
    <div class="foot"><span class="dot"></span> ברגע שהתוכנה תרוץ, הדף הזה יתחלף אוטומטית לכלי השליטה.</div>
    <p style="margin:18px 0 0;font-size:13.5px"><a class="inline" href="/guide">📖 מדריך הבנייה — איך בונים מיצב לדים מוזיקלי (פתוח לכולם)</a></p>
  </div>
  <script>
    async function dl() {
      var key = document.getElementById('pw').value.trim();
      var err = document.getElementById('err');
      err.textContent = '';
      if (!key) { err.textContent = 'נא להזין סיסמה'; return; }
      try {
        var r = await fetch('/download?key=' + encodeURIComponent(key), { cache: 'no-store' });
        if (!r.ok) { var m = await r.text(); err.textContent = m || 'שגיאה, נסה שוב'; return; }
        var blob = await r.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'led-rings-host-bundle.zip';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(a.href);
      } catch (e) { err.textContent = 'שגיאה, נסה שוב'; }
    }
    setInterval(async () => {
      try {
        const r = await fetch('/api/brightness', { cache: 'no-store' });
        if (r.ok) location.reload();
      } catch (e) {}
    }, 5000);
  </script>
</body>
</html>`;
