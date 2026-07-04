import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { AppErrorBoundary } from './App'
import RootShell from './shell/RootShell'
import { CLERK_PUBLISHABLE_KEY } from './lib/clerk'
import { I18nProvider } from './lib/i18n'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (!CLERK_PUBLISHABLE_KEY) {
  root.render(
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1218', color: '#e8eaed', fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
      <div>
        <h1 style={{ fontSize: 22 }}>⚙️ Auth not configured</h1>
        <p style={{ color: '#9aa7bd' }}>Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in the build environment.</p>
      </div>
    </div>,
  )
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
        <I18nProvider>
          <AppErrorBoundary>
            <RootShell />
          </AppErrorBoundary>
        </I18nProvider>
      </ClerkProvider>
    </React.StrictMode>,
  )
}
