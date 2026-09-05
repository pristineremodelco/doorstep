/**
 * More than one person on one phone.
 *
 * The case this exists for: someone's battery dies and they borrow a phone to
 * reach a person only Doorstep can reach. That has to be possible without
 * signing the owner out of their own account.
 *
 * Two decisions carry the security here.
 *
 * Staying signed in is asked, not assumed. Declining puts the session in
 * sessionStorage, so it is gone when the tab closes and nothing is left behind
 * on a phone that was borrowed for five minutes. That is the right default for
 * exactly the situation this feature is for.
 *
 * Only remembered accounts are listed for switching. A guest session is never
 * added to the roster, so borrowing a phone leaves no trace of who you are in
 * its account list.
 */

const ROSTER_KEY = 'doorstep.accounts.v1'
const REMEMBER_KEY = 'doorstep.remember'

export interface RememberedAccount {
  userId: string
  email: string
  /** Only ever a refresh token: an access token expires within the hour. */
  refreshToken: string
  savedAt: string
}

/** Whether this browser should keep sessions past the tab closing. */
export function remembering (): boolean {
  try {
    return localStorage.getItem (REMEMBER_KEY) !== 'no'
  } catch {
    return false
  }
}

export function setRemembering (yes: boolean): void {
  try {
    localStorage.setItem (REMEMBER_KEY, yes ? 'yes' : 'no')
  } catch {
    // A browser that refuses storage simply forgets everything, which is the
    // safer of the two failures.
  }
}

/**
 * Where Supabase keeps the session.
 *
 * localStorage when the person said to remember them, sessionStorage when they
 * did not. Reads try both, so a session started before the choice was made is
 * still found.
 */
export const sessionStore = {
  getItem (key: string): string | null {
    try {
      return localStorage.getItem (key) ?? sessionStorage.getItem (key)
    } catch {
      return null
    }
  },
  setItem (key: string, value: string): void {
    try {
      if (remembering ()) {
        localStorage.setItem (key, value)
        sessionStorage.removeItem (key)
      } else {
        sessionStorage.setItem (key, value)
        localStorage.removeItem (key)
      }
    } catch {
      // Nothing to do. The session lives in memory for this page either way.
    }
  },
  removeItem (key: string): void {
    try {
      localStorage.removeItem (key)
      sessionStorage.removeItem (key)
    } catch {
      // Already gone.
    }
  },
}

export function roster (): RememberedAccount[] {
  try {
    const raw = localStorage.getItem (ROSTER_KEY)
    if (!raw) return []
    const parsed = JSON.parse (raw)
    return Array.isArray (parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Adds an account to the switcher. Never called for a guest session. */
export function remember (account: RememberedAccount): void {
  if (!remembering ()) return
  try {
    const next = [account, ...roster ().filter ((a) => a.userId !== account.userId)]
    localStorage.setItem (ROSTER_KEY, JSON.stringify (next.slice (0, 5)))
  } catch {
    // A roster that cannot be saved just means no switcher.
  }
}

export function forget (userId: string): void {
  try {
    localStorage.setItem (
      ROSTER_KEY,
      JSON.stringify (roster ().filter ((a) => a.userId !== userId))
    )
  } catch {
    // Nothing to do.
  }
}

export function forgetAll (): void {
  try {
    localStorage.removeItem (ROSTER_KEY)
  } catch {
    // Nothing to do.
  }
}
