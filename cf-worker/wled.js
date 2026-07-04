export const WLED_HTML = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="התקנת WLED לשליטה בלדים בלי סנכרון למוזיקה — WLED install for non-synced LED setups.">
<title>WLED · LED Studio</title>
</head>
<body>
<style>
  :root {
    --bg:#0b0e15; --panel:#131826; --panel-2:#172033; --border:#212a3c; --border-2:#2c3852;
    --ink:#e7ecf6; --ink-soft:#aeb9cf; --ink-faint:#7a879f; --brand:#7e8dff; --brand-2:#a98bff;
    --brand-grad:linear-gradient(135deg,#5b8cff,#7a5cff); --ok:#38d39f; --plate:#0d1220; --plate-line:#263450;
    color-scheme:dark;
  }
  @media (prefers-color-scheme: light){ :root{
    --bg:#f4f6fb; --panel:#fff; --panel-2:#f7f9fd; --border:#dde3ee; --border-2:#c9d3e6;
    --ink:#182031; --ink-soft:#46536b; --ink-faint:#78859c; --brand:#4a5fdc; --brand-2:#7a4fd0;
    --ok:#1a9e73; --plate:#f7faff; --plate-line:#cdd8ec; color-scheme:light; } }
  :root[data-theme="dark"]{ --bg:#0b0e15; --panel:#131826; --panel-2:#172033; --border:#212a3c; --border-2:#2c3852;
    --ink:#e7ecf6; --ink-soft:#aeb9cf; --ink-faint:#7a879f; --brand:#7e8dff; --ok:#38d39f; --plate:#0d1220; --plate-line:#263450; color-scheme:dark; }
  :root[data-theme="light"]{ --bg:#f4f6fb; --panel:#fff; --panel-2:#f7f9fd; --border:#dde3ee; --border-2:#c9d3e6;
    --ink:#182031; --ink-soft:#46536b; --ink-faint:#78859c; --brand:#4a5fdc; --ok:#1a9e73; --plate:#f7faff; --plate-line:#cdd8ec; color-scheme:light; }

  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"Segoe UI",Roboto,"Noto Sans Hebrew",Arial,sans-serif;font-size:17px;line-height:1.7;-webkit-font-smoothing:antialiased;}
  .page.lang-he [data-l="en"]{display:none !important;}
  .page.lang-en [data-l="he"]{display:none !important;}
  code,.mono{font-family:ui-monospace,"Cascadia Code",Consolas,Menlo,monospace;}
  code{font-size:.86em;background:color-mix(in oklab,var(--brand) 14%,transparent);border:1px solid var(--border);padding:.08em .42em;border-radius:6px;white-space:nowrap;}

  .topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:12px clamp(16px,4vw,40px);
    background:color-mix(in oklab,var(--bg) 82%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);}
  .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:15px;}
  .brand .dot{width:10px;height:10px;border-radius:50%;background:var(--brand-grad);box-shadow:0 0 12px var(--brand);}
  .back{color:var(--brand);text-decoration:none;font-size:13.5px;font-weight:600;}
  .spacer{flex:1;}
  .seg{display:inline-flex;padding:3px;gap:2px;background:var(--panel);border:1px solid var(--border);border-radius:999px;}
  .seg button{appearance:none;border:0;cursor:pointer;font:inherit;font-size:13px;font-weight:700;padding:5px 13px;border-radius:999px;color:var(--ink-soft);background:transparent;}
  .seg button[aria-pressed="true"]{color:#fff;background:var(--brand-grad);}

  main{max-width:720px;margin:0 auto;padding:34px clamp(16px,4vw,40px) 100px;}
  .eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--brand);font-weight:700;margin:0 0 12px;}
  h1{font-size:clamp(28px,5vw,40px);line-height:1.1;margin:0 0 16px;letter-spacing:-.02em;text-wrap:balance;font-weight:800;}
  .lead{font-size:18px;color:var(--ink-soft);margin:0 0 26px;max-width:62ch;}
  h2{font-size:22px;margin:36px 0 10px;letter-spacing:-.01em;font-weight:800;}
  p{margin:0 0 16px;max-width:64ch;}
  a{color:var(--brand);text-underline-offset:3px;}
  ol{padding-inline-start:1.3em;margin:0 0 18px;max-width:64ch;}
  ol li{margin:0 0 9px;}
  ol li::marker{color:var(--brand);font-weight:700;}
  strong{color:var(--ink);font-weight:700;}
  .call{border:1px solid var(--border);border-inline-start:3px solid var(--ok);background:var(--panel);border-radius:12px;padding:15px 17px;margin:0 0 22px;max-width:66ch;}
  .call.brand{border-inline-start-color:var(--brand);}
  .call .ct{font-weight:800;font-size:13px;letter-spacing:.04em;text-transform:uppercase;display:flex;align-items:center;gap:8px;margin:0 0 6px;color:var(--ok);}
  .call.brand .ct{color:var(--brand);}
  .call p{margin:0;}
  footer{border-top:1px solid var(--border);margin-top:36px;padding-top:22px;color:var(--ink-faint);font-size:13.5px;}
</style>

<div class="page lang-he" dir="rtl" lang="he" id="page">
  <header class="topbar">
    <span class="brand"><span class="dot"></span> LED Studio</span>
    <a class="back" href="https://kivsee.iddofroom.co.il/guide"><span data-l="he">← למדריך המלא</span><span data-l="en">← Full guide</span></a>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Language">
      <button type="button" data-lang="he" aria-pressed="true">עברית</button>
      <button type="button" data-lang="en" aria-pressed="false">EN</button>
    </div>
  </header>

  <main>
    <p class="eyebrow" data-l="he">מסלול חלופי</p>
    <p class="eyebrow" data-l="en">Alternative path</p>
    <h1 data-l="he">WLED — אורות בלי סנכרון למוזיקה</h1>
    <h1 data-l="en">WLED — lights without music sync</h1>
    <p class="lead" data-l="he">מערכת KivSee (במדריך הראשי) היא למופע מסונכרן למוזיקה. אם אתה רק רוצה לשלוט בלדים — אפקטים, צבעים ותבניות מהטלפון, בלי סנכרון ובלי קוד — <strong>WLED</strong> היא הדרך הקלה, החינמית והנפוצה. היא רצה על אותה חומרת ESP32.</p>
    <p class="lead" data-l="en">The KivSee system (in the main guide) is for a music‑synced show. If you only want to control LEDs — effects, colors and patterns from your phone, no sync and no code — <strong>WLED</strong> is the easy, free, popular way. It runs on the same ESP32 hardware.</p>

    <div class="call">
      <div class="ct" data-l="he">✅ מתי WLED מתאים לך</div>
      <div class="ct" data-l="en">✅ When WLED is right for you</div>
      <p data-l="he">כשאתה <em>לא</em> צריך מופע מולחן שרוקד לביט של שיר — רק תאורה יפה, מתחלפת, נשלטת מהטלפון. למופע מסונכרן למוזיקה חזור ל<a href="https://kivsee.iddofroom.co.il/guide#software">מערכת KivSee במדריך</a>.</p>
      <p data-l="en">When you <em>don't</em> need a composed show that dances to a song's beat — just nice, shifting, phone‑controlled light. For a music‑synced show, head back to the <a href="https://kivsee.iddofroom.co.il/guide#software">KivSee system in the guide</a>.</p>
    </div>

    <h2 data-l="he">התקנה מהדפדפן — צעד אחר צעד</h2>
    <h2 data-l="en">Browser install — step by step</h2>
    <p data-l="he">כל ההתקנה מהדפדפן, בלי כלים מיוחדים:</p>
    <p data-l="en">The whole install is from your browser, no special tools:</p>
    <ol>
      <li data-l="he">התקן דרייבר: <a href="https://www.wemos.cc/en/latest/ch340_driver.html" target="_blank" rel="noopener">CH340 ל‑Windows</a> או <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noopener">הדרייבר ל‑Mac</a>.</li>
      <li data-l="en">Install a driver: <a href="https://www.wemos.cc/en/latest/ch340_driver.html" target="_blank" rel="noopener">CH340 for Windows</a> or <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noopener">the Mac driver</a>.</li>
      <li data-l="he">חבר את ה‑ESP32 בכבל micro‑USB (ב‑Chrome או Edge במחשב) ופתח את <a href="https://install.wled.me" target="_blank" rel="noopener">install.wled.me</a> — הצריבה רצה מהדפדפן.</li>
      <li data-l="en">Plug the ESP32 in with a micro‑USB cable (Chrome or Edge on a computer) and open <a href="https://install.wled.me" target="_blank" rel="noopener">install.wled.me</a> — it flashes from the browser.</li>
      <li data-l="he">אתחל את הבקר, חפש רשת וויי‑פיי <span class="mono">wled-ap</span> והתחבר (סיסמה <span class="mono">wled1234</span>).</li>
      <li data-l="en">Restart the controller, find the Wi‑Fi network <span class="mono">wled-ap</span> and connect (password <span class="mono">wled1234</span>).</li>
      <li data-l="he">בהגדרות → <span class="mono">LED settings</span>: קבע את <strong>מספר הלדים</strong> ואת <strong>data pin = 16</strong>. שמור. זהו — שליטה מלאה מהטלפון.</li>
      <li data-l="en">In settings → <span class="mono">LED settings</span>: set the <strong>LED count</strong> and <strong>data pin = 16</strong>. Save. That's it — full control from your phone.</li>
    </ol>
    <p data-l="he">להעמקה: <a href="https://kno.wled.ge/" target="_blank" rel="noopener">פרויקט WLED</a> · <a href="https://kno.wled.ge/basics/tutorials/" target="_blank" rel="noopener">מדריכים</a>.</p>
    <p data-l="en">Go deeper: <a href="https://kno.wled.ge/" target="_blank" rel="noopener">the WLED project</a> · <a href="https://kno.wled.ge/basics/tutorials/" target="_blank" rel="noopener">tutorials</a>.</p>

    <div class="call brand">
      <div class="ct" data-l="he">🎵 בעצם רוצה שהלדים ירקדו למוזיקה?</div>
      <div class="ct" data-l="en">🎵 Actually want the LEDs to dance to music?</div>
      <p data-l="he">אז זה לא WLED — זה LED Studio. חזור ל<a href="https://kivsee.iddofroom.co.il/guide#software">מדריך המלא</a> והתקן את מערכת KivSee.</p>
      <p data-l="en">Then it's not WLED — it's LED Studio. Head back to the <a href="https://kivsee.iddofroom.co.il/guide#software">full guide</a> and install the KivSee system.</p>
    </div>

    <footer>
      <span data-l="he">WLED הוא פרויקט קוד‑פתוח עצמאי, לא חלק מ‑KivSee. · <a href="https://kivsee.iddofroom.co.il/guide">חזרה למדריך</a></span>
      <span data-l="en">WLED is an independent open‑source project, not part of KivSee. · <a href="https://kivsee.iddofroom.co.il/guide">Back to the guide</a></span>
    </footer>
  </main>
</div>

<script>
  (function(){
    var page=document.getElementById('page'),STORE='ledguide:lang';
    function setLang(lang){var he=lang!=='en';page.classList.toggle('lang-he',he);page.classList.toggle('lang-en',!he);
      page.setAttribute('dir',he?'rtl':'ltr');page.setAttribute('lang',he?'he':'en');
      page.querySelectorAll('.seg button').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.lang===(he?'he':'en')?'true':'false');});
      try{localStorage.setItem(STORE,he?'he':'en');}catch(e){}}
    page.querySelectorAll('.seg button').forEach(function(b){b.addEventListener('click',function(){setLang(b.dataset.lang);});});
    try{var s=localStorage.getItem(STORE);if(s)setLang(s);}catch(e){}
  })();
</script>

</body>
</html>
`;
