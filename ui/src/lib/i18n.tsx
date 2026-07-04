import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Lightweight bilingual (English / Hebrew) i18n for the KivSee dashboard.
 *
 * Design: *inline* translations. Instead of a central key registry, each call site
 * passes both languages: `t({ en: 'Run', he: 'הפעל' })`. This keeps strings next to
 * where they're used (readable in context), makes it impossible to have a missing key,
 * and lets components be translated independently with no shared file to merge.
 *
 * RTL: switching to Hebrew flips `document.documentElement.dir` to `rtl` so text and
 * panels read right-to-left. Geometry-sensitive widgets (the horizontal timeline,
 * spectrogram, playback transport) opt back out with an explicit `dir="ltr"` where they
 * render — time always flows left→right, even in an RTL locale.
 */

export type Lang = 'en' | 'he'
export type Dir = 'ltr' | 'rtl'

/** A string in both supported languages. Passed inline to `t()`. */
export interface Bilingual {
  en: string
  he: string
}

export interface I18nValue {
  lang: Lang
  dir: Dir
  setLang: (l: Lang) => void
  toggleLang: () => void
  /** Translate an inline `{ en, he }` pair (or pass a plain string through unchanged). */
  t: (entry: Bilingual | string) => string
}

const LANG_STORAGE_KEY = 'kivsee-lang'

const I18nContext = createContext<I18nValue | null>(null)

function readInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    if (saved === 'he' || saved === 'en') return saved
  } catch {}
  return 'en'
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang)
  const dir: Dir = lang === 'he' ? 'rtl' : 'ltr'

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(LANG_STORAGE_KEY, l) } catch {}
  }, [])

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === 'he' ? 'en' : 'he'
      try { localStorage.setItem(LANG_STORAGE_KEY, next) } catch {}
      return next
    })
  }, [])

  const t = useCallback(
    (entry: Bilingual | string): string => {
      if (typeof entry === 'string') return entry
      return lang === 'he' ? entry.he : entry.en
    },
    [lang],
  )

  // Reflect the language on <html> so the whole page (shell, editor, modals, Clerk UI)
  // picks up direction + a hook for RTL-only CSS. Structural geometry that must not flip
  // opts back out locally with dir="ltr".
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('lang', lang)
    el.setAttribute('dir', dir)
  }, [lang, dir])

  const value = useMemo<I18nValue>(
    () => ({ lang, dir, setLang, toggleLang, t }),
    [lang, dir, setLang, toggleLang, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Full i18n context. Falls back to English if used outside a provider (never throws). */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  return {
    lang: 'en',
    dir: 'ltr',
    setLang: () => {},
    toggleLang: () => {},
    t: (entry) => (typeof entry === 'string' ? entry : entry.en),
  }
}

/** Convenience hook: just the translate function. `const t = useT()`. */
export function useT(): I18nValue['t'] {
  return useI18n().t
}

/**
 * The EN / עברית toggle. Drop it anywhere inside the provider.
 * `variant="header"` = light chrome for the purple app header; `variant="dark"` = for dark surfaces.
 */
export function LangToggle({ variant = 'header', style }: { variant?: 'header' | 'dark'; style?: React.CSSProperties }) {
  const { lang, setLang } = useI18n()
  const isHeader = variant === 'header'
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    borderRadius: 999,
    border: isHeader ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.14)',
    background: isHeader ? 'rgba(20, 28, 50, 0.6)' : 'rgba(255,255,255,0.06)',
    flexShrink: 0,
    // Keep the two segments in a stable EN | עב order regardless of page direction.
    direction: 'ltr',
  }
  const seg = (active: boolean): React.CSSProperties => ({
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.2,
    cursor: 'pointer',
    border: 'none',
    color: active ? '#fff' : isHeader ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.6)',
    background: active ? 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)' : 'transparent',
    transition: 'background 0.18s, color 0.18s',
  })
  return (
    <div role="group" aria-label="Language" style={{ ...base, ...style }}>
      <button type="button" onClick={() => setLang('en')} style={seg(lang === 'en')} aria-pressed={lang === 'en'} title="English">
        EN
      </button>
      <button type="button" onClick={() => setLang('he')} style={seg(lang === 'he')} aria-pressed={lang === 'he'} title="עברית">
        עב
      </button>
    </div>
  )
}
