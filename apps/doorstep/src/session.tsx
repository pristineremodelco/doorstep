import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { myProfile, type Profile } from '@doorstep/core'
import { db } from './db'
import { remember, remembering } from './accounts'

/**
 * Who is signed in, and their profile row.
 *
 * `loading` starts true and matters more than it looks: the very first paint
 * happens before Supabase has read the stored session, and rendering the
 * sign-in screen during that gap makes a returning user think they have been
 * logged out every time they open the app.
 */

interface SessionValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const Ctx = createContext<SessionValue> ({
  session: null, profile: null, loading: true, refreshProfile: async () => {},
})

export function SessionProvider ({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null> (null)
  const [profile, setProfile] = useState<Profile | null> (null)
  const [loading, setLoading] = useState (true)

  const refreshProfile = useCallback (async () => {
    if (!db) return
    try {
      setProfile (await myProfile (db))
    } catch {
      // A profile that will not load must not blank the app. The row is created
      // by a trigger on signup and may lag the session by a moment.
      setProfile (null)
    }
  }, [])

  useEffect (() => {
    if (!db) { setLoading (false); return }

    let alive = true
    db.auth.getSession ().then (({ data }) => {
      if (!alive) return
      setSession (data.session)
      setLoading (false)
    })

    const { data: sub } = db.auth.onAuthStateChange ((_event, next) => {
      setSession (next)
      setLoading (false)
      // Only a session the person asked to keep joins the switcher. A borrowed
      // phone must not end up listing who used it.
      if (next?.user?.email && next.refresh_token && remembering ()) {
        remember ({
          userId: next.user.id,
          email: next.user.email,
          refreshToken: next.refresh_token,
          savedAt: new Date ().toISOString (),
        })
      }
    })
    return () => { alive = false; sub.subscription.unsubscribe () }
  }, [])

  useEffect (() => {
    if (session) void refreshProfile ()
    else setProfile (null)
  }, [session, refreshProfile])

  const value = useMemo (
    () => ({ session, profile, loading, refreshProfile }),
    [session, profile, loading, refreshProfile]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession () {
  return useContext (Ctx)
}
