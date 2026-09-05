import { useEffect, useState } from 'react'

/**
 * The whole router.
 *
 * Two shapes of address exist: the app itself, and an invite at /i/{token}.
 * A library for that would be more code than the code. Paths rather than
 * hashes, because the invite has to survive being pasted into a text message,
 * and Cloudflare already rewrites unmatched paths to the shell.
 */

export type Route =
  | { name: 'app' }
  | { name: 'invite'; token: string }

export function readRoute (): Route {
  const m = window.location.pathname.match (/^\/i\/([A-Za-z0-9]{6,64})\/?$/)
  return m ? { name: 'invite', token: m[1] } : { name: 'app' }
}

export function useRoute (): [Route, (to: string) => void] {
  const [route, setRoute] = useState<Route> (readRoute)

  useEffect (() => {
    const onPop = () => setRoute (readRoute ())
    window.addEventListener ('popstate', onPop)
    return () => window.removeEventListener ('popstate', onPop)
  }, [])

  const go = (to: string) => {
    window.history.pushState ({}, '', to)
    setRoute (readRoute ())
  }

  return [route, go]
}
