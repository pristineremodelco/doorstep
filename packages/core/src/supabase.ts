import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * One client per shell. Both apps talk to the same project, so the difference
 * between them is entirely in what they render, never in what they may read.
 *
 * `storage` is handed in rather than assumed, because where a session is kept
 * is a decision about the device: remembered on your own phone, forgotten when
 * the tab closes on somebody else's.
 */
export interface ClientOptions {
  storage?: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
  }
}

export function makeClient (
  url: string, anonKey: string, opts: ClientOptions = {}
): SupabaseClient {
  return createClient (url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      ...(opts.storage ? { storage: opts.storage } : {}),
    },
  })
}

export const MEDIA_BUCKET = 'media'
