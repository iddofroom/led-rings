import React, { useEffect, useState } from 'react'

/**
 * Browser-based ESP flashing entry (WLED-style), using esp-web-tools over the Web Serial API.
 *
 * Reality check: flashing needs published KivSee firmware binaries. Until firmware/manifest.json
 * carries a non-empty `builds` array, this degrades to a clear "firmware not published yet" panel
 * with the manual-flash path — the esp-web-tools <esp-web-install-button> is only loaded (lazily)
 * once real binaries exist. Web Serial is Chromium-desktop only, so we feature-detect and explain.
 *
 * See firmware/README.md for the firmware build + config contract this depends on.
 */

// The esp-web-tools custom element (loaded lazily). Declared here so TSX accepts the tag.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': any
    }
  }
}

const MANIFEST_URL = '/firmware/manifest.json'

interface Manifest {
  name?: string
  version?: string
  status?: string
  builds?: unknown[]
  note?: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'no-firmware'; note?: string }
  | { kind: 'unsupported' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

export default function FlashController() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const webSerial = typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext
      let manifest: Manifest | null = null
      try {
        const r = await fetch(MANIFEST_URL, { cache: 'no-store' })
        manifest = await r.json()
      } catch {
        /* manifest unreachable → treat as no-firmware */
      }
      if (cancelled) return

      const hasBuilds = !!manifest && Array.isArray(manifest.builds) && manifest.builds.length > 0
      if (!hasBuilds) {
        setState({ kind: 'no-firmware', note: manifest?.note })
        return
      }
      if (!webSerial) {
        setState({ kind: 'unsupported' })
        return
      }
      // Real firmware exists AND the browser supports Web Serial → load the flasher component.
      try {
        await import('esp-web-tools')
        if (!cancelled) setState({ kind: 'ready' })
      } catch (e: any) {
        if (!cancelled) setState({ kind: 'error', message: e?.message || 'Failed to load flasher' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={S.wrap}>
      <div style={S.title}>Install firmware on a controller</div>

      {state.kind === 'loading' && <div style={S.muted}>Checking firmware availability…</div>}

      {state.kind === 'ready' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={S.muted}>Plug the ESP32 into this computer over USB, then:</div>
          {/* esp-web-tools custom element — manifest passed as a string attribute */}
          <esp-web-install-button manifest={MANIFEST_URL}>
            <button slot="activate" style={S.primary}>⚡ Flash controller</button>
            <span slot="unsupported" style={S.warn}>Your browser can’t flash — use Chrome or Edge on a desktop.</span>
            <span slot="not-allowed" style={S.warn}>This page must be served over HTTPS to flash.</span>
          </esp-web-install-button>
        </div>
      )}

      {state.kind === 'unsupported' && (
        <div style={S.panel}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>This browser can’t flash over USB</div>
          <div style={S.muted}>
            Browser flashing uses the Web Serial API, available only in <b>Chrome</b> or <b>Edge</b> on a
            desktop/laptop (not Safari, Firefox, iPhone, or iPad). Open this page there and plug the ESP32 in over USB.
          </div>
        </div>
      )}

      {state.kind === 'no-firmware' && (
        <div style={S.panel}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Firmware isn’t published yet</div>
          <div style={S.muted}>
            {state.note || 'The controller firmware for browser flashing hasn’t been published yet.'} You can still
            declare your controllers below now — flashing turns on automatically once firmware is available. Until
            then, flash the KivSee firmware with PlatformIO (<code style={S.code}>pio run -t upload</code>).
          </div>
        </div>
      )}

      {state.kind === 'error' && <div style={S.warn}>Couldn’t start the flasher: {state.message}</div>}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 14, fontWeight: 700, color: '#c7d2e6' },
  muted: { color: '#8fa0bd', fontSize: 13, lineHeight: 1.5 },
  panel: { background: '#0d1016', border: '1px solid #232c3c', borderRadius: 10, padding: 14 },
  primary: { background: 'linear-gradient(135deg,#5b8cff,#7a5cff)', color: '#fff', border: 0, borderRadius: 10, padding: '9px 14px', cursor: 'pointer', fontWeight: 700 },
  warn: { color: '#f0b429', fontSize: 13 },
  code: { fontFamily: 'ui-monospace, monospace', background: '#12161d', border: '1px solid #232c3c', borderRadius: 5, padding: '1px 6px', fontSize: 12 },
}
