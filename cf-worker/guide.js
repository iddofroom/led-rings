export const GUIDE_HTML = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="מדריך בניית מיצבי לדים מוזיקליים — LED Studio Build Guide (WS2812).">
<title>מדריך הבנייה · LED Studio Build Guide</title>
</head>
<body>
<style>
  /* ============================================================
     LED Studio — Build Guide
     Field-manual aesthetic. Honors the product palette
     (blue→violet brand #5b8cff→#7a5cff, amber #f0a020, dark ground).
     Wiring diagrams use semantic electrical colors:
       +V = warm red · GND = slate · DATA = cyan.
     Bilingual: only the inactive language is hidden, so the
     active language always keeps its natural display.
     ============================================================ */

  :root {
    /* neutrals — cool-biased, not pure grey */
    --bg:        #0b0e15;
    --bg-2:      #0f131c;
    --panel:     #131826;
    --panel-2:   #172033;
    --border:    #212a3c;
    --border-2:  #2c3852;
    --ink:       #e7ecf6;
    --ink-soft:  #aeb9cf;
    --ink-faint: #7a879f;

    /* brand — inherited from the product's sign-in gradient */
    --brand:     #7e8dff;
    --brand-2:   #a98bff;
    --brand-grad: linear-gradient(135deg, #5b8cff, #7a5cff);

    /* semantic — wiring + callouts */
    --w-v:    #ff6a53;   /* +V power  */
    --w-gnd:  #8ea1c4;   /* ground    */
    --w-data: #35cdea;   /* data      */
    --warn:   #f0a020;   /* caution   */
    --danger: #ff5c5c;   /* mains / kill */
    --ok:     #38d39f;

    /* diagram surface */
    --plate:   #0d1220;
    --plate-line: #263450;

    --maxw: 760px;
    --radius: 14px;
    --shadow: 0 18px 50px rgba(0,0,0,.45);
    color-scheme: dark;
  }

  @media (prefers-color-scheme: light) {
    :root {
      --bg:        #f4f6fb;
      --bg-2:      #eef1f8;
      --panel:     #ffffff;
      --panel-2:   #f7f9fd;
      --border:    #dde3ee;
      --border-2:  #c9d3e6;
      --ink:       #182031;
      --ink-soft:  #46536b;
      --ink-faint: #78859c;
      --brand:     #4a5fdc;
      --brand-2:   #7a4fd0;
      --w-v:    #e2452f;
      --w-gnd:  #5f6f8f;
      --w-data: #0a95b8;
      --warn:   #b5730a;
      --danger: #d43535;
      --ok:     #1a9e73;
      --plate:   #f7faff;
      --plate-line: #cdd8ec;
      --shadow: 0 16px 40px rgba(40,60,110,.14);
      color-scheme: light;
    }
  }
  /* explicit theme toggle wins over the media query, both ways */
  :root[data-theme="dark"] {
    --bg:#0b0e15; --bg-2:#0f131c; --panel:#131826; --panel-2:#172033;
    --border:#212a3c; --border-2:#2c3852; --ink:#e7ecf6; --ink-soft:#aeb9cf; --ink-faint:#7a879f;
    --brand:#7e8dff; --brand-2:#a98bff; --w-v:#ff6a53; --w-gnd:#8ea1c4; --w-data:#35cdea;
    --warn:#f0a020; --danger:#ff5c5c; --ok:#38d39f; --plate:#0d1220; --plate-line:#263450;
    --shadow:0 18px 50px rgba(0,0,0,.45); color-scheme:dark;
  }
  :root[data-theme="light"] {
    --bg:#f4f6fb; --bg-2:#eef1f8; --panel:#ffffff; --panel-2:#f7f9fd;
    --border:#dde3ee; --border-2:#c9d3e6; --ink:#182031; --ink-soft:#46536b; --ink-faint:#78859c;
    --brand:#4a5fdc; --brand-2:#7a4fd0; --w-v:#e2452f; --w-gnd:#5f6f8f; --w-data:#0a95b8;
    --warn:#b5730a; --danger:#d43535; --ok:#1a9e73; --plate:#f7faff; --plate-line:#cdd8ec;
    --shadow:0 16px 40px rgba(40,60,110,.14); color-scheme:light;
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Hebrew", sans-serif;
    font-size: 17px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }

  /* language visibility — hide only the inactive language */
  .guide.lang-he [data-l="en"] { display: none !important; }
  .guide.lang-en [data-l="he"] { display: none !important; }

  code, .mono, kbd { font-family: ui-monospace, "Cascadia Code", "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace; }
  code {
    font-size: .86em;
    background: color-mix(in oklab, var(--brand) 14%, transparent);
    border: 1px solid var(--border);
    padding: .08em .42em;
    border-radius: 6px;
    white-space: nowrap;
  }

  /* ---------- header ---------- */
  .topbar {
    position: sticky; top: 0; z-index: 40;
    display: flex; align-items: center; gap: 14px;
    padding: 12px clamp(16px, 4vw, 40px);
    background: color-mix(in oklab, var(--bg) 82%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 800; letter-spacing: .01em; font-size: 15px; }
  .brand .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--brand-grad); box-shadow: 0 0 12px var(--brand); }
  .spacer { flex: 1; }
  .seg {
    display: inline-flex; padding: 3px; gap: 2px;
    background: var(--panel); border: 1px solid var(--border); border-radius: 999px;
  }
  .seg button {
    appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700;
    padding: 5px 13px; border-radius: 999px; color: var(--ink-soft); background: transparent;
  }
  .seg button[aria-pressed="true"] { color: #fff; background: var(--brand-grad); }
  :root[data-theme="light"] .seg button[aria-pressed="true"],
  .seg button[aria-pressed="true"] { color: #fff; }

  /* ---------- layout ---------- */
  .layout {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr);
    gap: clamp(20px, 4vw, 56px);
    max-width: 1160px;
    margin: 0 auto;
    padding: 0 clamp(16px, 4vw, 40px) 120px;
  }
  aside {
    position: sticky; top: 68px; align-self: start;
    max-height: calc(100vh - 90px); overflow-y: auto;
    padding-block: 26px;
  }
  aside .toc-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: .16em;
    color: var(--ink-faint); margin: 0 0 12px; font-weight: 700;
  }
  aside ol { list-style: none; margin: 0; padding: 0; counter-reset: ch; }
  aside li { margin: 0; }
  aside a {
    display: flex; gap: 10px; align-items: baseline;
    padding: 7px 10px; border-radius: 9px; text-decoration: none;
    color: var(--ink-soft); font-size: 14px; line-height: 1.35;
    border: 1px solid transparent;
  }
  aside a .n { font: 600 12px/1 ui-monospace, monospace; color: var(--ink-faint); min-width: 16px; }
  aside a:hover { background: var(--panel); color: var(--ink); }
  aside a.active { background: var(--panel); border-color: var(--border-2); color: var(--ink); font-weight: 600; }
  aside a.active .n { color: var(--brand); }
  aside a.soon { opacity: .55; }
  aside a.soon::after { content: attr(data-soon); margin-inline-start: auto; font-size: 10px; color: var(--ink-faint); }

  main { min-width: 0; padding-top: 26px; }

  /* ---------- hero ---------- */
  .hero { padding: 22px 0 30px; border-bottom: 1px solid var(--border); margin-bottom: 40px; }
  .eyebrow { font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: var(--brand); font-weight: 700; margin: 0 0 14px; }
  .hero h1 { font-size: clamp(30px, 5vw, 46px); line-height: 1.08; margin: 0 0 16px; letter-spacing: -.02em; text-wrap: balance; font-weight: 800; }
  .hero p { font-size: 18px; color: var(--ink-soft); margin: 0; max-width: 60ch; text-wrap: pretty; }
  .hero .free {
    display: inline-flex; align-items: center; gap: 7px; margin-top: 20px;
    font-size: 13px; color: var(--ink-soft);
    background: var(--panel); border: 1px solid var(--border); border-radius: 999px; padding: 6px 13px;
  }
  .hero .free b { color: var(--ok); }

  /* ---------- sections ---------- */
  section { scroll-margin-top: 80px; margin-bottom: 64px; }
  .chapter-tag { font: 700 12px/1 ui-monospace, monospace; letter-spacing: .12em; color: var(--brand); text-transform: uppercase; }
  h2 { font-size: clamp(24px, 4vw, 32px); line-height: 1.15; margin: 8px 0 10px; letter-spacing: -.015em; text-wrap: balance; font-weight: 800; }
  .dek { font-size: 17px; color: var(--ink-soft); margin: 0 0 26px; max-width: 62ch; }
  h3 { font-size: 20px; margin: 40px 0 8px; letter-spacing: -.01em; font-weight: 700; }
  h3 .h3n { font: 700 14px/1 ui-monospace, monospace; color: var(--brand); margin-inline-end: 10px; }
  p { margin: 0 0 16px; max-width: 65ch; }
  main a { color: var(--brand); text-decoration-color: color-mix(in oklab, var(--brand) 40%, transparent); text-underline-offset: 3px; }
  ul, ol.body { padding-inline-start: 1.25em; margin: 0 0 16px; max-width: 64ch; }
  li { margin: 0 0 8px; }
  strong { color: var(--ink); font-weight: 700; }
  .lead-in { color: var(--ink); font-weight: 600; }

  /* spec strip */
  .specs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 4px 0 30px; }
  @media (max-width: 620px) { .specs { grid-template-columns: repeat(2, 1fr); } }
  .spec {
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 15px;
  }
  .spec .k { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--ink-faint); margin: 0 0 6px; }
  .spec .v { font: 700 22px/1 ui-monospace, monospace; color: var(--ink); font-variant-numeric: tabular-nums; }
  .spec .v small { font-size: 13px; color: var(--ink-soft); font-weight: 600; }

  /* callouts */
  .call {
    border: 1px solid var(--border); border-inline-start: 3px solid var(--brand);
    background: var(--panel); border-radius: 12px; padding: 15px 17px; margin: 0 0 22px;
    max-width: 66ch;
  }
  .call p:last-child { margin-bottom: 0; }
  .call .ct { font-weight: 800; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; margin: 0 0 6px; }
  .call.warn { border-inline-start-color: var(--warn); }
  .call.warn .ct { color: var(--warn); }
  .call.danger { border-inline-start-color: var(--danger); background: color-mix(in oklab, var(--danger) 9%, var(--panel)); }
  .call.danger .ct { color: var(--danger); }
  .call.tip { border-inline-start-color: var(--ok); }
  .call.tip .ct { color: var(--ok); }
  .call.rule { border-inline-start-color: var(--w-v); }
  .call.rule .ct { color: var(--w-v); }

  /* figure / diagram plate */
  figure { margin: 24px 0 28px; }
  .plate {
    background: var(--plate); border: 1px solid var(--border-2); border-radius: var(--radius);
    padding: 20px; overflow-x: auto;
  }
  .plate svg { display: block; width: 100%; height: auto; min-width: 460px; }
  figcaption { font-size: 13.5px; color: var(--ink-faint); margin-top: 10px; padding-inline-start: 2px; }
  figcaption b { color: var(--ink-soft); }

  /* legend */
  .legend { display: flex; flex-wrap: wrap; gap: 16px; margin: 14px 0 0; font-size: 13px; color: var(--ink-soft); }
  .legend span { display: inline-flex; align-items: center; gap: 7px; }
  .legend i { width: 22px; height: 4px; border-radius: 2px; display: inline-block; }

  /* wire label chips inline */
  .chip { display: inline-block; font: 700 12px/1.6 ui-monospace, monospace; padding: 1px 7px; border-radius: 6px; vertical-align: baseline; }
  .chip.v { color: #fff; background: var(--w-v); }
  .chip.g { color: #fff; background: var(--w-gnd); }
  .chip.d { color: #04222b; background: var(--w-data); }
  :root[data-theme="light"] .chip.g, .chip.g { color:#fff; }

  /* coming-soon stub */
  .stub {
    border: 1px dashed var(--border-2); border-radius: var(--radius);
    padding: 22px 24px; background: var(--panel-2); max-width: 66ch;
  }
  .stub .soon-badge { font: 700 11px/1 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--warn); }
  .stub h2 { margin: 10px 0 8px; }
  .stub p { color: var(--ink-soft); margin-bottom: 0; }

  /* footer */
  footer { border-top: 1px solid var(--border); margin-top: 30px; padding: 28px 0 0; color: var(--ink-faint); font-size: 13.5px; }

  /* mobile TOC */
  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; }
    aside {
      position: static; max-height: none; overflow: visible;
      padding: 16px; margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
    }
    aside ol { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
    main { padding-top: 8px; }
  }
</style>

<div class="guide lang-he" dir="rtl" lang="he" id="guide">

  <header class="topbar">
    <span class="brand"><span class="dot"></span> LED Studio</span>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Language">
      <button type="button" data-lang="he" aria-pressed="true">עברית</button>
      <button type="button" data-lang="en" aria-pressed="false">EN</button>
    </div>
  </header>

  <div class="layout">
    <!-- ================= TOC ================= -->
    <aside>
      <p class="toc-label" data-l="he">פרקי המדריך</p>
      <p class="toc-label" data-l="en">Chapters</p>
      <ol>
        <li><a href="#overview" class="toclink"><span class="n">01</span><span data-l="he">סקירה כללית</span><span data-l="en">Overview</span></a></li>
        <li><a href="#leds" class="toclink soon" data-soon="בקרוב"><span class="n">02</span><span data-l="he">בחירת לדים</span><span data-l="en">Choosing LEDs</span></a></li>
        <li><a href="#power" class="toclink"><span class="n">03</span><span data-l="he">אלקטרוניקה וחשמל</span><span data-l="en">Electronics &amp; Power</span></a></li>
        <li><a href="#diffusers" class="toclink soon" data-soon="בקרוב"><span class="n">04</span><span data-l="he">דיפיוזרים</span><span data-l="en">Diffusers</span></a></li>
        <li><a href="#story" class="toclink soon" data-soon="בקרוב"><span class="n">05</span><span data-l="he">סיפוריות</span><span data-l="en">Storytelling</span></a></li>
        <li><a href="#addons" class="toclink soon" data-soon="בקרוב"><span class="n">06</span><span data-l="he">רכיבים נוספים</span><span data-l="en">Add-ons</span></a></li>
        <li><a href="#burn" class="toclink soon" data-soon="בקרוב"><span class="n">07</span><span data-l="he">מיצבי ברן</span><span data-l="en">Burn installs</span></a></li>
      </ol>
    </aside>

    <!-- ================= CONTENT ================= -->
    <main>
      <div class="hero">
        <p class="eyebrow" data-l="he">מדריך הבנייה</p>
        <p class="eyebrow" data-l="en">The Build Guide</p>
        <h1 data-l="he">בונים מיצב לדים מוזיקלי — מהחוט הראשון ועד הפלייה</h1>
        <h1 data-l="en">Build a music-reactive LED installation — from the first wire to the playa</h1>
        <p data-l="he">מדריך פרקטי לבניית מיצבי אור מבוססי לדים כתובתיים (WS2812 ודומיהם): איך מזינים אותם בחשמל בבטחה, איך מחווטים בקר, ואיך שורדים אבק, לחות ולילה שלם של אנימציות.</p>
        <p data-l="en">A hands-on guide to building light art with addressable LEDs (WS2812 &amp; friends): how to power them safely, how to wire the controller, and how to survive dust, moisture and a full night of animation.</p>
        <span class="free" data-l="he">🔓 <span><b>פתוח לכולם</b> — לא צריך חשבון כדי לקרוא</span></span>
        <span class="free" data-l="en">🔓 <span><b>Open to everyone</b> — no account needed to read</span></span>
      </div>

      <!-- ============ 01 · OVERVIEW ============ -->
      <section id="overview">
        <span class="chapter-tag">01</span>
        <h2 data-l="he">סקירה כללית</h2>
        <h2 data-l="en">Overview</h2>
        <p class="dek" data-l="he">כל מיצב לדים, מהקטן ועד הענק, מורכב מאותם חלקים. הכר אותם ותדע מה כל פרק במדריך פותר.</p>
        <p class="dek" data-l="en">Every LED build, tiny or huge, is made of the same parts. Know them and you'll know what each chapter solves.</p>

        <p data-l="he"><span class="lead-in">ארבעה דברים</span> הופכים ערימת רכיבים למיצב חי:</p>
        <p data-l="en"><span class="lead-in">Four things</span> turn a pile of parts into a living installation:</p>
        <ul>
          <li data-l="he"><strong>הלדים</strong> — רצועות או פיקסלים כתובתיים שכל נורה בהם נשלטת בנפרד (WS2812B, WS2815 ועוד).</li>
          <li data-l="en"><strong>The LEDs</strong> — addressable strips or pixels where every light is controlled individually (WS2812B, WS2815, etc.).</li>
          <li data-l="he"><strong>חשמל</strong> — ספק כוח שמאכיל את הלדים במתח ובזרם הנכונים, בלי שהקצה יתעמעם או משהו יישרף.</li>
          <li data-l="en"><strong>Power</strong> — a supply that feeds the LEDs the right voltage and current, without dim ends or fried parts.</li>
          <li data-l="he"><strong>בקר</strong> — ה״מוח״ (Raspberry Pi / ESP32 / בקר ייעודי) ששולח לכל פיקסל את הצבע שלו, בזמן.</li>
          <li data-l="en"><strong>Controller</strong> — the "brain" (Raspberry Pi / ESP32 / dedicated controller) that tells each pixel its color, in time.</li>
          <li data-l="he"><strong>עיצוב וחומר</strong> — דיפיוזר, מבנה, עמידות לשטח — מה שהופך אור גולמי ליצירה.</li>
          <li data-l="en"><strong>Design &amp; material</strong> — diffuser, structure, ruggedness — what turns raw light into a piece.</li>
        </ul>

        <div class="call tip">
          <div class="ct" data-l="he">💡 מאיפה מתחילים</div>
          <div class="ct" data-l="en">💡 Where to start</div>
          <p data-l="he">אם זה המיצב הראשון שלך — קרא את פרק <a href="#power">אלקטרוניקה וחשמל</a> לפני שאתה קונה משהו. הבחירה של הלדים קובעת את המתח, והמתח קובע את הספק, את החיווט ואת התקציב.</p>
          <p data-l="en">First build? Read <a href="#power">Electronics &amp; Power</a> before you buy anything. Your LED choice sets the voltage, and voltage decides the power supply, the wiring and the budget.</p>
        </div>
      </section>

      <!-- ============ 02 · CHOOSING LEDS (stub) ============ -->
      <section id="leds">
        <div class="stub">
          <span class="soon-badge">· בקרוב · coming soon ·</span>
          <span class="chapter-tag" style="display:block;margin-top:6px">02</span>
          <h2 data-l="he">בחירת לדים</h2>
          <h2 data-l="en">Choosing LEDs</h2>
          <p data-l="he">איזה סוג פיקסלים מתאים למיצב שלך: WS2812B (5V, פיקסל־לנורה, רזולוציה גבוהה) מול WS2815 (12V, קו דאטה גיבוי, מעולה למיצבים גדולים), צפיפות נורות למטר, דירוג עמידות למים (IP), ורצועה מול מחרוזת פיקסלים. עד שהפרק מוכן — טעימה מהיר: <strong>WS2812B</strong> לחתיכות קטנות ומפורטות, <strong>WS2815 / 12V</strong> לריצות ארוכות. ההשלכות של הבחירה מוסברות בפרק הבא.</p>
          <p data-l="en">Which pixel type fits your build: WS2812B (5V, one pixel per LED, high resolution) vs WS2815 (12V, backup data line, great for large pieces), LED density per metre, water rating (IP), and strip vs pixel-string. Until it's ready — the short version: <strong>WS2812B</strong> for small, detailed pieces, <strong>WS2815 / 12V</strong> for long runs. What that choice implies is covered next.</p>
        </div>
      </section>

      <!-- ============ 03 · ELECTRONICS & POWER (full) ============ -->
      <section id="power">
        <span class="chapter-tag">03</span>
        <h2 data-l="he">אלקטרוניקה וחשמל</h2>
        <h2 data-l="en">Electronics &amp; Power</h2>
        <p class="dek" data-l="he">איך מחברים לדים, בקרים וספקי כוח — נכון ובבטחה. תעשה את זה כמו שצריך והמיצב ידלוק כל הלילה; תפספס, ותקבל קצוות כהים, סטיית צבע, הבהובים או פיקסלים שרופים.</p>
        <p class="dek" data-l="en">How to connect LEDs, controllers and power supplies — correctly and safely. Get it right and the piece runs all night; get it wrong and you get dark ends, color shift, flicker, or fried pixels.</p>

        <!-- mental model -->
        <h3><span class="h3n">A</span><span data-l="he">מודל מנטלי: שלושה חוטים</span><span data-l="en">The mental model: three wires</span></h3>
        <p data-l="he">כל מיצב לדים כתובתי, בלי קשר לגודל, הוא בסוף שלושה מוליכים בין הבקר לרצועה:</p>
        <p data-l="en">Every addressable LED build, whatever its size, comes down to three conductors between the controller and the strip:</p>
        <ul>
          <li data-l="he"><span class="chip v">+V</span> &nbsp;<strong>מתח</strong> — האנרגיה (למשל +5V), מגיע מספק הכוח.</li>
          <li data-l="en"><span class="chip v">+V</span> &nbsp;<strong>Power</strong> — the energy (e.g. +5V), from the power supply.</li>
          <li data-l="he"><span class="chip g">GND</span> &nbsp;<strong>הארקה / אפס משותף</strong> — חוט החזרה. גם הבקר, גם הספק וגם כל הרצועה חייבים לחלוק אותו.</li>
          <li data-l="en"><span class="chip g">GND</span> &nbsp;<strong>Ground / common</strong> — the return wire. Controller, supply and the whole strip must all share it.</li>
          <li data-l="he"><span class="chip d">DIN</span> &nbsp;<strong>דאטה</strong> — האות שאומר לכל פיקסל איזה צבע להיות. יוצא מהבקר, נכנס לרצועה בקצה ה־DIN.</li>
          <li data-l="en"><span class="chip d">DIN</span> &nbsp;<strong>Data</strong> — the signal telling each pixel what color to be. Leaves the controller, enters the strip at DIN.</li>
        </ul>
        <p data-l="he">כל הפרק הזה הוא בעצם ״איך לחבר את שלושת החוטים האלה נכון״.</p>
        <p data-l="en">This entire chapter is really just "how to get those three wires right."</p>

        <figure>
          <div class="plate">
            <!-- DIAGRAM 1: three wires -->
            <svg viewBox="0 0 620 190" role="img" aria-labelledby="d1t">
              <title id="d1t">Controller feeding three wires to an LED strip</title>
              <!-- controller -->
              <rect x="24" y="60" width="118" height="70" rx="10" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="83" y="90" text-anchor="middle" fill="var(--ink)" font-size="13" font-weight="700" font-family="ui-monospace,monospace">CTRL</text>
              <text x="83" y="110" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="system-ui">Pi / ESP32</text>
              <!-- strip -->
              <rect x="470" y="40" width="126" height="110" rx="8" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <g>
                <circle cx="500" cy="70" r="7" fill="var(--w-data)"/><circle cx="533" cy="70" r="7" fill="var(--w-v)"/>
                <circle cx="566" cy="70" r="7" fill="var(--ok)"/><circle cx="500" cy="120" r="7" fill="var(--warn)"/>
                <circle cx="533" cy="120" r="7" fill="var(--brand)"/><circle cx="566" cy="120" r="7" fill="var(--w-data)"/>
              </g>
              <text x="533" y="168" text-anchor="middle" fill="var(--ink-faint)" font-size="11" font-family="system-ui">LED strip</text>
              <!-- three wires -->
              <path d="M142 78 H 470" stroke="var(--w-v)" stroke-width="3" fill="none"/>
              <path d="M142 95 H 470" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <path d="M142 112 H 470" stroke="var(--w-data)" stroke-width="3" fill="none"/>
              <text x="300" y="72" text-anchor="middle" fill="var(--w-v)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">+5V</text>
              <text x="300" y="90" text-anchor="middle" fill="var(--w-gnd)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">GND</text>
              <text x="300" y="129" text-anchor="middle" fill="var(--w-data)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">DATA →</text>
            </svg>
          </div>
          <figcaption data-l="he"><b>שלושת החוטים.</b> מתח והארקה מזינים, הדאטה זורם בכיוון אחד — מהבקר אל ה־DIN של הפיקסל הראשון.</figcaption>
          <figcaption data-l="en"><b>The three wires.</b> Power and ground feed; data flows one way — from the controller into the first pixel's DIN.</figcaption>
        </figure>

        <!-- voltage first -->
        <h3><span class="h3n">B</span><span data-l="he">קודם כול — מתח</span><span data-l="en">Voltage first</span></h3>
        <p data-l="he">אחרי שבחרת את סוג הלדים, <strong>הנתון החשוב ביותר הוא המתח שלהם</strong>. לפי המתח בוחרים את ספק הכוח — והוא חייב להתאים בדיוק.</p>
        <p data-l="en">Once you've chosen the LED type, <strong>the most important spec is their operating voltage</strong>. Voltage picks the power supply — and it must match exactly.</p>
        <ul>
          <li data-l="he"><strong>WS2812B → 5V.</strong> WS2815 והרבה רצועות WS2811 → <strong>12V</strong>. חלק → 24V.</li>
          <li data-l="en"><strong>WS2812B → 5V.</strong> WS2815 and many WS2811 strips → <strong>12V</strong>. Some → 24V.</li>
          <li data-l="he">מתח הספק חייב להיות זהה למתח הלדים. <strong>5V לדים ← ספק 5V.</strong> מתח שגוי = רצועה מתה או שרופה.</li>
          <li data-l="en">The supply voltage must equal the LED voltage. <strong>5V LEDs ← 5V supply.</strong> Wrong voltage = dead or burnt strip.</li>
          <li data-l="he"><strong>5V מול 12V:</strong> באותה עוצמת אור, רצועת 12V מושכת פחות זרם → פחות נפילת מתח → פחות נקודות הזרקה, חוט דק יותר, ריצות ארוכות יותר. החיסרון: רצועות 12V ותיקות (WS2811) שולטות ב־3 נורות כפיקסל אחד (רזולוציה נמוכה). <strong>WS2815</strong> הוא 12V אבל פיקסל־לנורה עם קו דאטה גיבוי — בחירה מצוינת למיצבים גדולים.</li>
          <li data-l="en"><strong>5V vs 12V:</strong> at the same brightness a 12V strip pulls less current → less voltage drop → fewer injection points, thinner wire, longer runs. Downside: older 12V strips (WS2811) control 3 LEDs as one pixel (lower resolution). <strong>WS2815</strong> is 12V but per-pixel with a backup data line — an excellent choice for large installs.</li>
        </ul>

        <!-- the math -->
        <h3><span class="h3n">C</span><span data-l="he">כמה חשמל? החשבון של WS2812</span><span data-l="en">How much power? The WS2812 math</span></h3>
        <p data-l="he">כל פיקסל WS2812B הוא בעצם <strong>שלוש נורות זעירות</strong> (אדום, ירוק, כחול). בעוצמה מלאה, לבן מלא, כל פיקסל מושך עד <strong>~60mA ב־5V ≈ 0.3W</strong> (הגזרה: 3 × ~20mA × 5V).</p>
        <p data-l="en">Each WS2812B pixel is really <strong>three tiny LEDs</strong> (red, green, blue). At full brightness, full white, each pixel draws up to <strong>~60mA at 5V ≈ 0.3W</strong> (derivation: 3 × ~20mA × 5V).</p>

        <div class="specs">
          <div class="spec"><p class="k" data-l="he">מתח</p><p class="k" data-l="en">Voltage</p><p class="v">5<small>V</small></p></div>
          <div class="spec"><p class="k" data-l="he">לפיקסל (לבן מלא)</p><p class="k" data-l="en">Per pixel (full white)</p><p class="v">60<small>mA</small></p></div>
          <div class="spec"><p class="k" data-l="he">הספק לפיקסל</p><p class="k" data-l="en">Power / pixel</p><p class="v">0.3<small>W</small></p></div>
          <div class="spec"><p class="k" data-l="he">1000 פיקסלים = מקסימום</p><p class="k" data-l="en">1000 pixels = max</p><p class="v">300<small>W · 60A</small></p></div>
        </div>

        <p data-l="he">כלומר במקרה הגרוע ביותר — כל פיקסל בלבן מלא — <strong>1000 פיקסלים = 60A = 300W</strong>. אבל אנימציה אמיתית כמעט אף פעם לא מדליקה את הכל בלבן מלא בבת אחת; סצנה מוזיקלית טיפוסית ממצעת 20%–50% מזה. לכן ספק <strong>300W (5V/60A)</strong> מזין בנוחות ~1000 פיקסלים של אנימציה — ואם תגביל בהירות גלובלית (נניח 60%), אפילו יותר.</p>
        <p data-l="en">So worst case — every pixel full white — <strong>1000 pixels = 60A = 300W</strong>. But real animation almost never lights everything full white at once; a typical music scene averages 20%–50% of that. So a <strong>300W (5V/60A)</strong> supply comfortably feeds ~1000 pixels of animation — and if you cap global brightness (say 60%), even more.</p>

        <div class="call rule">
          <div class="ct" data-l="he">🔢 כלל אצבע לגודל הספק</div>
          <div class="ct" data-l="en">🔢 PSU sizing rule</div>
          <p data-l="he">מקסימום תיאורטי = <code>מספר פיקסלים × 0.3W</code> (60mA). לתכנון תוכן אנימציה טיפוסי אפשר להעריך <strong>~0.1W (20mA) לפיקסל</strong> — בערך שליש מהמקסימום. הכלל: תכנן כך שהשיא האמיתי יישאר מתחת ל־<strong>80%</strong> מהדירוג של הספק (מרווח של ~25%). ל־1000 פיקסלים: לבן מלא מובטח → מחלקת <strong>~375W (80A)</strong> ב־5V; תוכן אנימציה רגיל → ספק <strong>200W (40A)</strong> בשפע. לעולם אל תריץ ספק ברציפות על 100%.</p>
          <p data-l="en">Theoretical max = <code>pixels × 0.3W</code> (60mA). For planning typical animated content, reckon <strong>~0.1W (20mA) per pixel</strong> — about a third of max. The rule: size so your real peak stays under <strong>80%</strong> of the supply's rating (~25% headroom). For 1000 pixels: guaranteed full white → a <strong>~375W (80A)</strong> class at 5V; ordinary animated content → a <strong>200W (40A)</strong> supply with room to spare. Never run a supply continuously at 100%.</p>
        </div>
        <div class="call">
          <div class="ct" data-l="he">ℹ️ למה לפעמים כתוב מספר כפול</div>
          <div class="ct" data-l="en">ℹ️ Why you'll sometimes see double</div>
          <p data-l="he">ברשת מסתובב לפעמים ״0.6W לנורה / 600W ל־1000״. זה מספר שמרני־מדי או ספירה כפולה; המדידה בפועל ללבן מלא היא <strong>60mA / 0.3W לפיקסל</strong>. עדיף לתכנן לפי 0.3W ולהוסיף מרווח בכוונה, מאשר לשלם על ספק כפול בגודלו.</p>
          <p data-l="en">You'll sometimes see "0.6W/LED / 600W per 1000". That's an over-conservative or double-counted figure; the measured full-white draw is <strong>60mA / 0.3W per pixel</strong>. Better to plan at 0.3W and add margin on purpose than to pay for a supply twice the size.</p>
        </div>

        <!-- the PSU -->
        <h3><span class="h3n">D</span><span data-l="he">ספק הכוח (״השנאי״)</span><span data-l="en">The power supply</span></h3>
        <p data-l="he">מה שמכנים בדיבור ״שנאי״ הוא בעצם <strong>ספק כוח מיתוג</strong> שממיר חשמל הרשת (230V AC) למתח DC נמוך ומיוצב. בחר אותו לפי מתח הלדים ולפי הזרם הכולל שחישבת.</p>
        <p data-l="en">What people loosely call a "transformer" is really a <strong>switching power supply</strong> that converts mains (230V AC) into low, regulated DC. Choose it by your LED voltage and by the total current you computed.</p>
        <ul>
          <li data-l="he"><strong>סוס העבודה המומלץ: <span class="mono">MEAN WELL LRS-350-5</span></strong> — 5V, 60A (300W). פענוח השם: <span class="mono">LRS</span> = הסדרה הסגורה, <span class="mono">350</span> = מחלקת הוואט, <span class="mono">-5</span> = מוצא 5V (ב־5V הספק מוגבל ל־60A ≈ 300W). אמין, זול, נמצא בכל חנות.</li>
          <li data-l="en"><strong>Recommended workhorse: <span class="mono">MEAN WELL LRS-350-5</span></strong> — 5V, 60A (300W). Decoding the name: <span class="mono">LRS</span> = the enclosed series, <span class="mono">350</span> = watt class, <span class="mono">-5</span> = 5V output (at 5V it's current-limited to 60A ≈ 300W). Reliable, cheap, everywhere.</li>
          <li data-l="he">לחתיכות קטנות: <span class="mono">LRS-150-5</span> (5V/30A) או <span class="mono">LRS-100-5</span>. אותה משפחה, פחות זרם.</li>
          <li data-l="en">For smaller pieces: <span class="mono">LRS-150-5</span> (5V/30A) or <span class="mono">LRS-100-5</span>. Same family, less current.</li>
          <li data-l="he">בצד ה־DC יש כמה זוגות מהדקי <span class="mono">+V</span> / <span class="mono">−V</span> — נצל אותם כדי לפצל את העומס. בצד ה־AC יש <span class="mono">L</span> (פאזה), <span class="mono">N</span> (אפס) ו־<span class="mono">⏚</span> (הארקה).</li>
          <li data-l="en">The DC side has several <span class="mono">+V</span> / <span class="mono">−V</span> terminal pairs — use them to split the load. The AC side has <span class="mono">L</span> (live), <span class="mono">N</span> (neutral) and <span class="mono">⏚</span> (earth).</li>
        </ul>
        <div class="call danger">
          <div class="ct" data-l="he">⚡ בטיחות רשת החשמל</div>
          <div class="ct" data-l="en">⚡ Mains safety</div>
          <p data-l="he">230V הורגים. חבר תמיד את מהדק ה־<strong>הארקה (⏚)</strong> למארז המתכת של הספק. הוסף נתיך בכניסת ה־AC, שחרור מאמץ (strain relief) לכבל, ובמיצב ציבורי — מפסק פחת (RCD) על קו ההזנה. אם אתה לא בטוח בחיווט רשת — תן למישהו מוסמך לעשות את הצד הזה.</p>
          <p data-l="he">שתי מלכודות ספציפיות ל־LRS: (1) יש בו לרוב <strong>מתג בורר 115V/230V</strong> — במצב הלא נכון הספק נשרף מיד. ודא שהוא על 230V. (2) ה־LRS הוא <strong>IP20</strong> (פתוח, עם מהדקי רשת חשופים — לא אטום למים); בחוץ הוא חייב קופסה אטומה ומורם מהקרקע.</p>
          <p data-l="en">Mains kills. Always connect the <strong>earth (⏚)</strong> terminal to the supply's metal case. Add a fuse on the AC input, strain-relief the cable, and for a public piece — an RCD/GFCI on the feed. Not confident with mains wiring? Have someone qualified do that side.</p>
          <p data-l="en">Two LRS-specific traps: (1) it usually has a <strong>115V/230V selector switch</strong> — set wrong, the supply dies instantly. Confirm it's on 230V. (2) The LRS is <strong>IP20</strong> (open-frame, exposed mains terminals — not waterproof); outdoors it must live in a sealed box, raised off the ground.</p>
        </div>

        <!-- power injection -->
        <h3><span class="h3n">E</span><span data-l="he">הזרקת מתח (Power Injection)</span><span data-l="en">Power injection</span></h3>
        <p data-l="he"><span class="lead-in">הבעיה:</span> הנחושת ברצועה דקה. זרם שזורם לאורכה מפיל מתח (<code>V = I·R</code>). ב־5V אפילו נפילה של ~1V היא אחוז גדול — הקצה הרחוק מתעמעם וגם <strong>סוטה בצבע</strong>: לבן הופך כתום/אדמדם, כי הנורות הכחולה והירוקה (שצריכות מתח גבוה יותר) דועכות ראשונות.</p>
        <p data-l="en"><span class="lead-in">The problem:</span> strip copper is thin. Current flowing down it drops voltage (<code>V = I·R</code>). At 5V even a ~1V drop is a big percentage — the far end dims and <strong>shifts color</strong>: white turns orange/red, because the blue and green LEDs (which need more voltage) fade first.</p>
        <p data-l="he"><span class="lead-in">מתי זה קורה:</span> ברצועת 5V בבהירות גבוהה זה נראה לעין כבר אחרי בערך <strong>1–1.5 מטר</strong> (~60–100 פיקסלים בצפיפות 60/מ׳).</p>
        <p data-l="en"><span class="lead-in">When it bites:</span> on a 5V strip at high brightness it's visible after roughly <strong>1–1.5&nbsp;m</strong> (~60–100 pixels at 60/m).</p>
        <p data-l="he"><span class="lead-in">הפתרון — הזרקת מתח:</span> להזין <span class="chip v">+V</span> ו־<span class="chip g">GND</span> מהספק בכמה נקודות לאורך הרצועה, לא רק בהתחלה. קו ה־<span class="chip d">DATA</span> נשאר שרשרת טורית אחת; רק המתח מוזרק במקביל בנקודות (״טאפים״).</p>
        <p data-l="en"><span class="lead-in">The fix — power injection:</span> feed <span class="chip v">+V</span> and <span class="chip g">GND</span> from the supply at several points along the strip, not just the start. The <span class="chip d">DATA</span> line stays one serial chain; only power is fed in parallel at taps.</p>
        <ul>
          <li data-l="he">תמיד להזין את <strong>שני הקצוות</strong>.</li>
          <li data-l="en">Always feed <strong>both ends</strong>.</li>
          <li data-l="he">ב־5V בבהירות מלאה — טאפ בערך כל <strong>1–1.5 מטר (~100 פיקסלים)</strong>; בבהירות בינונית מספיק כל 2–5 מטר.</li>
          <li data-l="en">5V at full brightness — a tap roughly every <strong>1–1.5&nbsp;m (~100 pixels)</strong>; at moderate brightness every 2–5&nbsp;m is fine.</li>
          <li data-l="he">הרץ את חוטי ההזרקה מפס מתח משותף בחוט <strong>עבה</strong> (בערך <span class="mono">18 AWG</span> לטאפים קצרים, <span class="mono">16–14 AWG</span> לריצות ראשיות). התאם את עובי החוט לזרם שהוא נושא.</li>
          <li data-l="en">Run injection power from a common bus in <strong>thick</strong> wire (about <span class="mono">18 AWG</span> for short taps, <span class="mono">16–14 AWG</span> for main runs). Match wire gauge to the current it carries.</li>
          <li data-l="he">כל ה־<span class="chip v">+V</span> המוזרק מגיע מאותו פס של הספק; כל ה־<span class="chip g">GND</span> משותף.</li>
          <li data-l="en">All injected <span class="chip v">+V</span> comes from the same supply rail; all <span class="chip g">GND</span> is common.</li>
        </ul>

        <figure>
          <div class="plate">
            <!-- DIAGRAM 2: power injection -->
            <svg viewBox="0 0 640 250" role="img" aria-labelledby="d2t">
              <title id="d2t">Power injected at both ends and the middle of a strip; data stays serial</title>
              <!-- PSU -->
              <rect x="20" y="95" width="96" height="60" rx="9" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="68" y="120" text-anchor="middle" fill="var(--ink)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">PSU</text>
              <text x="68" y="138" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="system-ui">5V</text>
              <!-- strip -->
              <rect x="150" y="112" width="470" height="26" rx="5" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <g fill="var(--ink-faint)">
                <circle cx="180" cy="125" r="4"/><circle cx="230" cy="125" r="4"/><circle cx="280" cy="125" r="4"/>
                <circle cx="330" cy="125" r="4"/><circle cx="380" cy="125" r="4"/><circle cx="430" cy="125" r="4"/>
                <circle cx="480" cy="125" r="4"/><circle cx="530" cy="125" r="4"/><circle cx="580" cy="125" r="4"/>
              </g>
              <!-- power bus (top) -->
              <path d="M68 95 V 40 H 155 M155 40 V 108" stroke="var(--w-v)" stroke-width="3" fill="none"/>
              <path d="M385 40 V 108" stroke="var(--w-v)" stroke-width="3" fill="none"/>
              <path d="M615 40 V 108 M155 40 H 615" stroke="var(--w-v)" stroke-width="3" fill="none"/>
              <!-- ground bus (bottom) -->
              <path d="M68 155 V 210 H 155 M155 210 V 142" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <path d="M385 210 V 142" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <path d="M615 210 V 142 M155 210 H 615" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <!-- injection markers -->
              <g fill="var(--w-v)"><circle cx="155" cy="108" r="4"/><circle cx="385" cy="108" r="4"/><circle cx="615" cy="108" r="4"/></g>
              <!-- data (from controller into DIN, serial) -->
              <rect x="150" y="165" width="70" height="30" rx="7" fill="none" stroke="var(--plate-line)" stroke-width="1.5"/>
              <text x="185" y="184" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="ui-monospace,monospace">CTRL</text>
              <path d="M185 165 V 138" stroke="var(--w-data)" stroke-width="2.5" fill="none" stroke-dasharray="1 0"/>
              <text x="150" y="72" fill="var(--w-v)" font-size="11" font-weight="700" font-family="ui-monospace,monospace">+5V bus</text>
              <text x="150" y="232" fill="var(--w-gnd)" font-size="11" font-weight="700" font-family="ui-monospace,monospace">GND bus</text>
              <text x="205" y="160" fill="var(--w-data)" font-size="11" font-weight="700" font-family="ui-monospace,monospace">DIN →</text>
            </svg>
          </div>
          <div class="legend">
            <span><i style="background:var(--w-v)"></i><span data-l="he">מתח +V (מוזרק במקביל)</span><span data-l="en">+V power (injected in parallel)</span></span>
            <span><i style="background:var(--w-gnd)"></i>GND</span>
            <span><i style="background:var(--w-data)"></i><span data-l="he">דאטה (טורי)</span><span data-l="en">Data (serial)</span></span>
          </div>
          <figcaption data-l="he"><b>הזרקת מתח.</b> +V ו־GND מוזנים בשני הקצוות ובאמצע מפסי מתח עבים; הדאטה נכנס פעם אחת ל־DIN וזורם טורית דרך כל הפיקסלים.</figcaption>
          <figcaption data-l="en"><b>Power injection.</b> +V and GND are fed at both ends and the middle from thick buses; data enters DIN once and flows serially through every pixel.</figcaption>
        </figure>

        <div class="call tip">
          <div class="ct" data-l="he">💡 למה 12V חוסך כאב ראש</div>
          <div class="ct" data-l="en">💡 Why 12V saves headaches</div>
          <p data-l="he">באותה בהירות, רצועת 12V מושכת בערך פי 2.4 פחות זרם → נפילת מתח קטנה פי 2.4 → מזריקים כל כמה מטרים במקום כל מטר. זו הסיבה שמיצבי ברן גדולים נוטים ל־12V (WS2815).</p>
          <p data-l="en">At the same brightness a 12V strip pulls ~2.4× less current → ~2.4× less voltage drop → inject every few metres instead of every metre. That's why big Burn pieces lean 12V (WS2815).</p>
        </div>

        <div class="call danger">
          <div class="ct" data-l="he">🔥 נתיכים — הסכנה מס׳ 1 לשריפה</div>
          <div class="ct" data-l="en">🔥 Fuses — the #1 fire hazard</div>
          <p data-l="he">כל מוצא של ספק וכל נקודת הזרקה צריכים <strong>נתיך בטור</strong>, בצמוד לספק, בגודל שמתאים ל<strong>עובי החוט</strong> — לא לספק. ה־LRS-350-5 ישמח לדחוף 60A לתוך רצועה שנקמטה או שנוצר בה קצר; בלי נתיך, <strong>החוט עצמו הופך לנתיך</strong> ונשרף לפני שההגנה של הספק בכלל מתעוררת.</p>
          <p data-l="en">Every supply output and every injection tap needs an <strong>inline fuse</strong>, right at the supply, sized to the <strong>wire</strong> — not the supply. An LRS-350-5 will happily push 60A into a pinched or shorted strip; with no fuse, <strong>the wire itself becomes the fuse</strong> and burns before the supply's protection ever trips.</p>
        </div>
        <div class="call tip">
          <div class="ct" data-l="he">🧵 עובי חוט (AWG)</div>
          <div class="ct" data-l="en">🧵 Wire gauge (AWG)</div>
          <p data-l="he">אמפרים בלי עובי חוט זה חצי שיעור מסוכן. ב־5V תקציב נפילת המתח זעיר (רק 0.5V ל־10%), אז צריך נחושת עבה: בערך <span class="mono">14 AWG</span> לריצת 5 מטר ב־5V, ופס של 60A דורש גייג׳ כבד עוד יותר. התאם תמיד את עובי החוט לזרם שהוא נושא ולנתיך שמגן עליו.</p>
          <p data-l="en">Amps without wire gauge is a dangerous half-lesson. At 5V the voltage-drop budget is tiny (just 0.5V for 10%), so you need thick copper: about <span class="mono">14 AWG</span> for a 5m 5V run, and a 60A bus needs heavier still. Always match wire gauge to the current it carries and to the fuse protecting it.</p>
        </div>

        <!-- multiple PSUs -->
        <h3><span class="h3n">F</span><span data-l="he">חיבור כמה ספקי כוח יחד</span><span data-l="en">Combining multiple supplies</span></h3>
        <p data-l="he">כשספק אחד לא מספק את כל הזרם (למשל 2000+ פיקסלים), משתמשים בכמה — <strong>כל ספק מזין מקטע (סגמנט) משלו</strong> ברצועה. שני כללים, ואסור לפספס אף אחד:</p>
        <p data-l="en">When one supply can't provide the total current (say 2000+ pixels), use several — <strong>each supply powers its own segment</strong> of the strip. Two rules, and you can't miss either:</p>

        <div class="call rule">
          <div class="ct" data-l="he">כלל 1 · GND משותף — תמיד</div>
          <div class="ct" data-l="en">Rule 1 · Common ground — always</div>
          <p data-l="he">חבר את כל מהדקי ה־<span class="chip g">GND</span> (−V) של כל הספקים יחד, וגם ל־GND של הבקר ולכל סגמנט. אות הדאטה נמדד ביחס ל־GND; בלי אפס משותף הפיקסלים לא יכולים לקרוא את הדאטה — תקבל ג׳יבריש או כלום.</p>
          <p data-l="en">Tie every supply's <span class="chip g">GND</span> (−V) terminal together, plus the controller's GND and every segment's GND. The data signal is measured relative to GND; without a shared ground the pixels can't read data — you'll get garbage or nothing.</p>
        </div>
        <div class="call danger">
          <div class="ct" data-l="he">כלל 2 · לעולם לא לחבר +V של שני ספקים</div>
          <div class="ct" data-l="en">Rule 2 · Never join two supplies' +V</div>
          <p data-l="he">שני ספקים אף פעם לא בדיוק באותו מתח. אם תחבר <span class="chip v">+V</span> ל־<span class="chip v">+V</span>, הגבוה יזרים אחורה לתוך הנמוך — זרם ״נשפך״ בין הספקים, הם מתחממים, הרגולציה מתערערת ואחד עלול להישרף. במקום זה: <strong>נתק (חתוך) את פס ה־+V ברצועה בין שני סגמנטים</strong> שמוזנים מספקים שונים, כך שה־+V של כל ספק מזין רק את הסגמנט שלו.</p>
          <p data-l="en">Two supplies are never at exactly the same voltage. Wire <span class="chip v">+V</span> to <span class="chip v">+V</span> and the higher one back-feeds the lower — current dumps between supplies, they overheat, regulation goes unstable and one can fail. Instead: <strong>cut the +V trace on the strip between two segments</strong> fed by different supplies, so each supply's +V feeds only its own segment.</p>
        </div>
        <p data-l="he">קו ה־<span class="chip d">DATA</span> כן ממשיך ברציפות מעבר לחתך — הוא רק צריך את ה־GND המשותף כדי לחצות את הגבול. אז בגבול בין סגמנטים: <strong>GND מחובר, DATA ממשיך, +V מנותק.</strong> תוספות בטיחות: נתיך על ה־+V של כל ספק, הזנת רשת מוארקת נפרדת לכל ספק, וסגמנטים מאוזנים בערך במספר הפיקסלים.</p>
        <p data-l="en">The <span class="chip d">DATA</span> line does continue across the cut — it only needs the common ground to cross the boundary. So at a segment boundary: <strong>GND joined, DATA continues, +V separated.</strong> Extras: fuse each supply's +V feed, give each supply its own earthed mains input, and keep segments roughly equal in pixel count.</p>

        <figure>
          <div class="plate">
            <!-- DIAGRAM 3: two PSUs -->
            <svg viewBox="0 0 640 250" role="img" aria-labelledby="d3t">
              <title id="d3t">Two supplies feed two segments; +V is cut at the boundary, ground and data continue</title>
              <!-- PSU A -->
              <rect x="24" y="40" width="90" height="52" rx="9" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="69" y="63" text-anchor="middle" fill="var(--ink)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">PSU A</text>
              <text x="69" y="80" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="system-ui">5V</text>
              <!-- PSU B -->
              <rect x="526" y="40" width="90" height="52" rx="9" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="571" y="63" text-anchor="middle" fill="var(--ink)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">PSU B</text>
              <text x="571" y="80" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="system-ui">5V</text>
              <!-- segment 1 -->
              <rect x="150" y="120" width="150" height="26" rx="5" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <!-- segment 2 -->
              <rect x="340" y="120" width="150" height="26" rx="5" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="225" y="164" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="system-ui">segment 1</text>
              <text x="415" y="164" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="system-ui">segment 2</text>
              <!-- +V A into seg1 -->
              <path d="M69 92 V 108 H 175 V 116" stroke="var(--w-v)" stroke-width="3" fill="none"/>
              <!-- +V B into seg2 -->
              <path d="M571 92 V 108 H 465 V 116" stroke="var(--w-v)" stroke-width="3" fill="none"/>
              <!-- +V CUT at boundary -->
              <line x1="308" y1="112" x2="332" y2="112" stroke="var(--w-v)" stroke-width="3"/>
              <g stroke="var(--danger)" stroke-width="2.5"><line x1="314" y1="104" x2="326" y2="120"/><line x1="326" y1="104" x2="314" y2="120"/></g>
              <text x="320" y="98" text-anchor="middle" fill="var(--danger)" font-size="10" font-weight="700" font-family="ui-monospace,monospace" data-l="en">+V CUT</text>
              <text x="320" y="98" text-anchor="middle" fill="var(--danger)" font-size="10" font-weight="700" font-family="ui-monospace,monospace" data-l="he">+V חתוך</text>
              <!-- common GND bus -->
              <path d="M69 92 V 200 H 571 V 92" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <path d="M225 200 V 148 M415 200 V 148" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <text x="320" y="216" text-anchor="middle" fill="var(--w-gnd)" font-size="11" font-weight="700" font-family="ui-monospace,monospace">common GND</text>
              <!-- data continuous across boundary -->
              <path d="M150 133 H 130 M300 133 H 340" stroke="var(--w-data)" stroke-width="2.5" fill="none"/>
              <path d="M305 133 H 335" stroke="var(--w-data)" stroke-width="2.5" fill="none"/>
              <text x="320" y="140" text-anchor="middle" fill="var(--w-data)" font-size="9" font-weight="700" font-family="ui-monospace,monospace">DATA →</text>
            </svg>
          </div>
          <div class="legend">
            <span><i style="background:var(--w-v)"></i><span data-l="he">+V — נפרד לכל ספק, חתוך בגבול</span><span data-l="en">+V — separate per supply, cut at the boundary</span></span>
            <span><i style="background:var(--w-gnd)"></i><span data-l="he">GND — משותף לכולם</span><span data-l="en">GND — shared by all</span></span>
            <span><i style="background:var(--w-data)"></i><span data-l="he">דאטה — ממשיך רציף</span><span data-l="en">Data — continuous</span></span>
          </div>
          <figcaption data-l="he"><b>שני ספקים, רצועה אחת.</b> בגבול הסגמנטים: ה־+V חתוך כך שהספקים לא נפגשים, ה־GND משותף לכולם, והדאטה חוצה ברציפות.</figcaption>
          <figcaption data-l="en"><b>Two supplies, one strip.</b> At the segment boundary: +V is cut so the supplies never meet, GND is shared by all, and data crosses continuously.</figcaption>
        </figure>

        <!-- controller wiring -->
        <h3><span class="h3n">G</span><span data-l="he">חיווט הבקר (״המוח״)</span><span data-l="en">Wiring the controller</span></h3>
        <p data-l="he">הבקר (מארח KivSee / Raspberry Pi / ESP32 / בקר פיקסלים ייעודי) מוציא את אות ה־<span class="chip d">DATA</span> מפין GPIO אחד, והוא מתחבר ל־<strong>DIN</strong> (כניסת הדאטה) של הרצועה. רצועות הן כיווניות — לך לפי החצים המודפסים: <span class="mono">DIN → DOUT</span>.</p>
        <p data-l="en">The controller (KivSee host / Raspberry Pi / ESP32 / dedicated pixel controller) outputs the <span class="chip d">DATA</span> signal on one GPIO pin, connecting to the strip's <strong>DIN</strong> (data-in). Strips are directional — follow the printed arrows: <span class="mono">DIN → DOUT</span>.</p>

        <div class="call danger">
          <div class="ct" data-l="he">🔗 שוב: GND משותף</div>
          <div class="ct" data-l="en">🔗 Again: common ground</div>
          <p data-l="he">ה־GND של הבקר חייב להתחבר ל־GND של הספק ושל הרצועה. זו <strong>טעות מס׳ 1 של מתחילים</strong>. הבקר בדרך כלל <em>לא</em> מספק את מתח הלדים (זה בא מהספק) — אבל האפסים שלהם חייבים להתחבר.</p>
          <p data-l="en">The controller's GND must connect to the supply's GND and the strip's GND. This is the <strong>#1 beginner mistake</strong>. The controller usually does <em>not</em> supply the LED power (that comes from the PSU) — but their grounds must be joined.</p>
        </div>

        <p data-l="he" class="lead-in">שני רכיבים שמגנים על הפיקסל הראשון:</p>
        <p data-l="en" class="lead-in">Two parts that protect the first pixel:</p>
        <ul>
          <li data-l="he"><strong>נגד ~330–470Ω בטור</strong> על קו הדאטה ממש בכניסה לפיקסל הראשון — מרגיע ״ריצוד״ (ringing) והחזרים באות.</li>
          <li data-l="en"><strong>A ~330–470Ω series resistor</strong> on the data line right at the first pixel — tames signal ringing and reflections.</li>
          <li data-l="he"><strong>קבל ~1000µF</strong> (מתח נקוב ≥6.3V, עדיף 16V; שים לב לקוטביות) בין +V ל־GND בכניסת הרצועה — בולע את קפיצת הזרם (inrush) ברגע ההדלקה ומגן על הפיקסלים הראשונים.</li>
          <li data-l="en"><strong>A ~1000µF capacitor</strong> (rated ≥6.3V, prefer 16V; mind polarity) across +V/GND at the strip input — absorbs the inrush spike at power-on and protects the first pixels.</li>
        </ul>

        <div class="call warn">
          <div class="ct" data-l="he">⚠️ מתח אות: 3.3V מול 5V</div>
          <div class="ct" data-l="en">⚠️ Signal level: 3.3V vs 5V</div>
          <p data-l="he">WS2812B רוצה ״1״ בדאטה ב־<strong>3.5V ומעלה</strong> (0.7 מהמתח), אבל GPIO של Pi/ESP32 מוציא רק ~3.3V — כלומר טכנית <strong>מחוץ למפרט</strong>. בריצות קצרות זה לפעמים ״עובד״, אבל למיצב קבוע הוסף <strong>מתאם רמות (level shifter)</strong> כמו <span class="mono">74AHCT125</span> או <span class="mono">74HCT245</span> שמרים את הדאטה ל־5V. הימנע ממתאמים דו־כיווניים אוטומטיים (<span class="mono">TXB0108</span>/<span class="mono">TXS0102</span>/BSS138) — הם איטיים מדי לאות המהיר הזה. שמור על כבל הדאטה לפיקסל הראשון קצר, או זוג שזור עם GND.</p>
          <p data-l="en">WS2812B wants a data "1" at <strong>≥3.5V</strong> (0.7×VDD), but a Pi/ESP32 GPIO only puts out ~3.3V — technically <strong>out of spec</strong>. Short runs sometimes "work", but for a permanent piece add a <strong>level shifter</strong> such as a <span class="mono">74AHCT125</span> or <span class="mono">74HCT245</span> to lift data to 5V. Avoid auto-direction bidirectional shifters (<span class="mono">TXB0108</span>/<span class="mono">TXS0102</span>/BSS138) — too slow for this fast signal. Keep the first-pixel data lead short, or use twisted pair with GND.</p>
        </div>

        <figure>
          <div class="plate">
            <!-- DIAGRAM 4: full basic wiring -->
            <svg viewBox="0 0 640 250" role="img" aria-labelledby="d4t">
              <title id="d4t">Supply and controller feeding a strip with a series resistor and a bulk capacitor, sharing a common ground</title>
              <!-- PSU -->
              <rect x="24" y="40" width="96" height="60" rx="9" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="72" y="66" text-anchor="middle" fill="var(--ink)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">PSU 5V</text>
              <text x="72" y="84" text-anchor="middle" fill="var(--ink-faint)" font-size="9" font-family="system-ui">+V  −V</text>
              <!-- controller -->
              <rect x="24" y="150" width="96" height="58" rx="9" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="72" y="176" text-anchor="middle" fill="var(--ink)" font-size="12" font-weight="700" font-family="ui-monospace,monospace">CTRL</text>
              <text x="72" y="193" text-anchor="middle" fill="var(--ink-faint)" font-size="9" font-family="system-ui">GPIO · GND</text>
              <!-- strip -->
              <rect x="470" y="95" width="146" height="30" rx="6" fill="none" stroke="var(--plate-line)" stroke-width="2"/>
              <text x="543" y="145" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="system-ui">strip · DIN → DOUT</text>
              <g fill="var(--ink-faint)"><circle cx="495" cy="110" r="4"/><circle cx="525" cy="110" r="4"/><circle cx="555" cy="110" r="4"/><circle cx="585" cy="110" r="4"/></g>
              <!-- +V from PSU to strip top -->
              <path d="M120 60 H 300 V 100 H 470" stroke="var(--w-v)" stroke-width="3" fill="none"/>
              <!-- capacitor across +V/GND near strip -->
              <path d="M440 92 V 82 M430 82 H 450 M432 76 H 448" stroke="var(--warn)" stroke-width="2.5" fill="none"/>
              <path d="M440 128 V 150 H 300" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <circle cx="440" cy="82" r="3" fill="var(--warn)"/>
              <text x="410" y="70" fill="var(--warn)" font-size="9" font-weight="700" font-family="ui-monospace,monospace">1000µF</text>
              <!-- GND common bus: PSU -V + CTRL GND join then to strip -->
              <path d="M120 90 V 150 M120 150 H 300 M300 100 V 150" stroke="var(--w-gnd)" stroke-width="3" fill="none" opacity="0"/>
              <path d="M120 88 V 178 H 24" stroke="var(--w-gnd)" stroke-width="0" fill="none"/>
              <!-- simpler GND: PSU -V down to node, CTRL GND to node, node to strip bottom -->
              <path d="M120 88 V 230 H 300 V 128 H 470" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <path d="M120 200 H 300" stroke="var(--w-gnd)" stroke-width="0"/>
              <path d="M120 178 H 300" stroke="var(--w-gnd)" stroke-width="0"/>
              <!-- CTRL GND into common -->
              <path d="M120 196 H 250 V 230" stroke="var(--w-gnd)" stroke-width="3" fill="none"/>
              <!-- data from CTRL GPIO through resistor to DIN -->
              <path d="M120 162 H 380" stroke="var(--w-data)" stroke-width="3" fill="none"/>
              <!-- resistor symbol -->
              <path d="M380 162 l6 -7 l10 14 l10 -14 l10 14 l6 -7 H 470 V 118" stroke="var(--w-data)" stroke-width="3" fill="none"/>
              <text x="405" y="150" text-anchor="middle" fill="var(--w-data)" font-size="9" font-weight="700" font-family="ui-monospace,monospace">330Ω</text>
              <text x="470" y="70" fill="var(--w-v)" font-size="10" font-weight="700" font-family="ui-monospace,monospace">+5V</text>
              <text x="250" y="245" fill="var(--w-gnd)" font-size="10" font-weight="700" font-family="ui-monospace,monospace">common GND</text>
              <text x="150" y="156" fill="var(--w-data)" font-size="10" font-weight="700" font-family="ui-monospace,monospace">DATA</text>
            </svg>
          </div>
          <div class="legend">
            <span><i style="background:var(--w-v)"></i>+5V</span>
            <span><i style="background:var(--w-gnd)"></i><span data-l="he">GND משותף</span><span data-l="en">common GND</span></span>
            <span><i style="background:var(--w-data)"></i><span data-l="he">דאטה + נגד 330Ω</span><span data-l="en">data + 330Ω</span></span>
            <span><i style="background:var(--warn)"></i><span data-l="he">קבל 1000µF</span><span data-l="en">1000µF cap</span></span>
          </div>
          <figcaption data-l="he"><b>החיווט הבסיסי המלא.</b> הספק מזין את המתח, הבקר מזין את הדאטה דרך נגד 330Ω, קבל 1000µF בכניסה — והכי חשוב, כולם חולקים GND אחד.</figcaption>
          <figcaption data-l="en"><b>The full basic wiring.</b> The supply feeds power, the controller feeds data through a 330Ω resistor, a 1000µF cap sits at the input — and above all, everyone shares one GND.</figcaption>
        </figure>

        <!-- first power-on -->
        <h3><span class="h3n">H</span><span data-l="he">צ׳ק־ליסט לפני הדלקה ראשונה</span><span data-l="en">First power-on checklist</span></h3>
        <p data-l="he">לפני שאתה מכניס את הרשת — עבור על הרשימה. דקה כאן חוסכת רצועה שרופה.</p>
        <p data-l="en">Before you plug in mains — run the list. A minute here saves a fried strip.</p>
        <ul>
          <li data-l="he">בדוק קוטביות בכל מקום (<span class="mono">+V↔+V</span>, <span class="mono">GND↔GND</span>). קוטביות הפוכה יכולה להרוג רצועה שלמה מיד — השתמש במחברים מקוטבים (keyed) ובקוד צבעים עקבי כדי שלא תתבלבל.</li>
          <li data-l="en">Check polarity everywhere (<span class="mono">+V↔+V</span>, <span class="mono">GND↔GND</span>). Reverse polarity can kill a whole strip instantly — use keyed connectors and a consistent color convention so you can't mix them up.</li>
          <li data-l="he">ודא שכל ה־GND משותפים — ספק(ים), בקר, כל הסגמנטים.</li>
          <li data-l="en">Confirm every GND is common — supply(ies), controller, all segments.</li>
          <li data-l="he">ודא שלא חיברת +V של שני ספקים שונים.</li>
          <li data-l="en">Confirm you did not bridge two different supplies' +V.</li>
          <li data-l="he">נתיכים במקום; הארקת רשת מחוברת; מדוד עם מולטימטר שהספק באמת על 5V <em>לפני</em> שאתה מחבר לדים.</li>
          <li data-l="en">Fuses in place; mains earth connected; measure with a multimeter that the supply is actually at 5V <em>before</em> connecting LEDs.</li>
          <li data-l="he">כשמחברים ״חם״ — חבר בסדר: <strong>GND קודם</strong>, אחר כך +5V, ולבסוף דאטה.</li>
          <li data-l="en">When hot-plugging, connect in this order: <strong>GND first</strong>, then +5V, then data.</li>
          <li data-l="he">העלה קודם בבהירות נמוכה. חפש נקודות חמות, קצוות כהים (צריך עוד הזרקה) וסטיית צבע.</li>
          <li data-l="en">Bring it up at low brightness first. Watch for hot spots, dark ends (need more injection) and color shift.</li>
        </ul>

        <div class="call warn">
          <div class="ct" data-l="he">🏜️ מציאות הפלייה (טעימה)</div>
          <div class="ct" data-l="en">🏜️ Playa realities (a taste)</div>
          <p data-l="he">אבק ולחות אוהבים לקצר חשמל. סגור ספקים וחיבורים בקופסאות אטומות, השתמש ברצועה בדירוג IP או בדיפיוזר/מארז משלך, שים RCD על ההזנה, אוורר את הספק (הוא מתחמם), ושחרר מאמץ לכל חוט — הלחמה + שרוול מתכווץ עדיפים על מהדק ברגים שמשתחרר מרעידות. הרחבה מלאה בפרק <a href="#burn">מיצבי ברן</a>.</p>
          <p data-l="en">Dust and moisture love to short things. Enclose supplies and joints in sealed boxes, use IP-rated strip or your own diffuser/enclosure, put an RCD on the feed, ventilate the supply (it runs hot), and strain-relieve every wire — solder + heatshrink beats screw terminals that rattle loose. Full treatment in <a href="#burn">Burn installs</a>.</p>
        </div>
      </section>

      <!-- ============ 04 · DIFFUSERS (stub) ============ -->
      <section id="diffusers">
        <div class="stub">
          <span class="soon-badge">· בקרוב · coming soon ·</span>
          <span class="chapter-tag" style="display:block;margin-top:6px">04</span>
          <h2 data-l="he">דיפיוזרים</h2>
          <h2 data-l="en">Diffusers</h2>
          <p data-l="he">איך הופכים נקודות אור חדות למשטח זוהר ורך: חומרים (אקריל אופל, פוליקרבונט, סיליקון, בד), מרחק הפיזור מהלד, יחס בין צפיפות נורות לעובי הדיפיוזר, ומתי ״נקודות״ זו דווקא האסתטיקה שרוצים.</p>
          <p data-l="en">Turning sharp points of light into a soft glowing surface: materials (opal acrylic, polycarbonate, silicone, fabric), diffuser-to-LED distance, the balance between LED density and diffuser thickness, and when visible "dots" are actually the look you want.</p>
        </div>
      </section>

      <!-- ============ 05 · STORYTELLING (stub) ============ -->
      <section id="story">
        <div class="stub">
          <span class="soon-badge">· בקרוב · coming soon ·</span>
          <span class="chapter-tag" style="display:block;margin-top:6px">05</span>
          <h2 data-l="he">סיפוריות</h2>
          <h2 data-l="en">Storytelling</h2>
          <p data-l="he">מ״אורות מהבהבים״ ל״חוויה״: איך בונים קשת רגשית לאורך שיר, מסנכרנים אנימציה לביט ולמבנה, ומעצבים רגעים שמובילים את הצופה דרך המופע. הפרק יתחבר ישירות ל־LED Studio — הכלי שהופך שיר לרצף אנימציות שמספר סיפור.</p>
          <p data-l="en">From "blinking lights" to "an experience": building an emotional arc across a track, syncing animation to beat and structure, and designing moments that lead the viewer through the show. This chapter ties straight into LED Studio — the tool that turns a song into a sequence that tells a story.</p>
        </div>
      </section>

      <!-- ============ 06 · ADD-ONS (stub) ============ -->
      <section id="addons">
        <div class="stub">
          <span class="soon-badge">· בקרוב · coming soon ·</span>
          <span class="chapter-tag" style="display:block;margin-top:6px">06</span>
          <h2 data-l="he">רכיבים נוספים שאפשר לחבר</h2>
          <h2 data-l="en">Add-on components</h2>
          <p data-l="he">מה עוד אפשר לחבר למיצב: מיקרופון/כניסת אודיו לתגובה לצליל, חיישני תנועה/מגע/מרחק, כפתורים ופוטנציומטרים, בקרת בהירות אוטומטית, סוללות ואל־פסק לשטח, ותקשורת אלחוטית בין מיצבים.</p>
          <p data-l="en">What else you can wire in: a microphone/audio input for sound reactivity, motion/touch/distance sensors, buttons and potentiometers, automatic brightness control, batteries and UPS for the field, and wireless links between installations.</p>
        </div>
      </section>

      <!-- ============ 07 · BURN (stub) ============ -->
      <section id="burn">
        <div class="stub">
          <span class="soon-badge">· בקרוב · coming soon ·</span>
          <span class="chapter-tag" style="display:block;margin-top:6px">07</span>
          <h2 data-l="he">פרקטיקות טובות למיצבי ברן</h2>
          <h2 data-l="en">Good practices for Burn installations</h2>
          <p data-l="he">לשרוד שבוע במדבר: אבק ולחות (אטימה, IP, RCD), חום ואוורור, ניהול חשמל וסוללות, עיגון נגד רוח, שחרור מאמץ והלחמות שלא מתפרקות, תיקונים בשטח בערכה מינימלית, ובטיחות קהל. המשך ישיר של הצ׳ק־ליסט בפרק <a href="#power">אלקטרוניקה וחשמל</a>.</p>
          <p data-l="en">Surviving a week in the desert: dust and moisture (sealing, IP, RCD), heat and ventilation, power and battery management, anchoring against wind, strain relief and joints that don't fail, field repairs from a minimal kit, and crowd safety. A direct continuation of the checklist in <a href="#power">Electronics &amp; Power</a>.</p>
        </div>
      </section>

      <footer>
        <span data-l="he">מדריך הבנייה של LED Studio · פתוח וחופשי לקריאה · נבנה עם ❤️ לקהילת האור</span>
        <span data-l="en">The LED Studio Build Guide · free and open to read · built with ❤️ for the light community</span>
      </footer>
    </main>
  </div>
</div>

<script>
  (function () {
    var guide = document.getElementById('guide');
    var STORE = 'ledguide:lang';

    function setLang(lang) {
      var he = lang !== 'en';
      guide.classList.toggle('lang-he', he);
      guide.classList.toggle('lang-en', !he);
      guide.setAttribute('dir', he ? 'rtl' : 'ltr');
      guide.setAttribute('lang', he ? 'he' : 'en');
      var btns = guide.querySelectorAll('.seg button');
      btns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.lang === (he ? 'he' : 'en') ? 'true' : 'false'); });
      try { localStorage.setItem(STORE, he ? 'he' : 'en'); } catch (e) {}
    }

    guide.querySelectorAll('.seg button').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.dataset.lang); });
    });

    try { var saved = localStorage.getItem(STORE); if (saved) setLang(saved); } catch (e) {}

    // scrollspy — highlight the chapter in view
    var links = Array.prototype.slice.call(guide.querySelectorAll('.toclink'));
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var sections = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            links.forEach(function (l) { l.classList.remove('active'); });
            var a = map[en.target.id];
            if (a) a.classList.add('active');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
      sections.forEach(function (s) { io.observe(s); });
    }
  })();
</script>

</body>
</html>
`;
