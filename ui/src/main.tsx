import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppErrorBoundary } from './App'
import RootShell from './shell/RootShell'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RootShell />
    </AppErrorBoundary>
  </React.StrictMode>,
)
