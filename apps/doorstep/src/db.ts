import { makeClient } from '@doorstep/core'
import { sessionStore } from './accounts'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * One client for the whole app, or none at all.
 *
 * With no project configured Doorstep still runs: the camera works and captures
 * stay on the device. That is what the "local only" badge means, and it keeps
 * the recorder testable without a network.
 *
 * The session goes wherever `sessionStore` decides, which is localStorage for
 * someone who asked to stay signed in and sessionStorage for someone borrowing
 * a phone.
 */
export const configured = Boolean (url && key)

export const db = configured
  ? makeClient (url!, key!, { storage: sessionStore })
  : null

/** Where a sign-in link should land. Origin only, so it works on any host. */
export const redirectTo = typeof window !== 'undefined' ? window.location.origin : ''
