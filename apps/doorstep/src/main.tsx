import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { watchForErrors } from './errors'

// Started before React, so a failure during the first render is still seen.
watchForErrors ()

createRoot (document.getElementById ('root')!).render (
  <StrictMode>
    <App />
  </StrictMode>
)
