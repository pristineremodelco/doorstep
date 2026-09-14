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

/**
 * Whether this page was opened from a sign-in link, read before the client
 * clears the address.
 *
 * On an iPhone that is the moment somebody with Doorstep on their home screen
 * has just done the natural thing, tapped the button in the email, and signed
 * Safari in instead of the app. Knowing it lets Safari offer the code the app
 * needs, at the point it is needed. Taken as the module loads, because the
 * client strips these parameters from the address as soon as it starts.
 */
export const arrivedByLink = typeof window !== 'undefined'
  && /access_token=|type=magiclink|error_code=otp|[?&]code=/.test (window.location.hash + window.location.search)

export const db = configured
  ? makeClient (url!, key!, { storage: sessionStore })
  : null

/** Where a sign-in link should land. Origin only, so it works on any host. */
export const redirectTo = typeof window !== 'undefined' ? window.location.origin : ''
