import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { watchForErrors } from './errors'
import { settleUpdate } from './updates'

// Started before React, so a failure during the first render is still seen.
watchForErrors ()

// Settled before the first render, so a version that cannot read its own
// stored data has its predecessor's data put back before anything tries to use
// it. Rendering first would mean the crash happens before the recovery does.
settleUpdate ()
  .catch (() => 'clean' as const)
  .then ((outcome) => {
    createRoot (document.getElementById ('root')!).render (
      <StrictMode>
        <App recovered={outcome === 'recovered'} />
      </StrictMode>
    )
  })
