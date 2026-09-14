/**
 * The app's icons.
 *
 * Every action in Doorstep used to be a word: Settings, Back, Flip, Look, All
 * conversations, Throw away. Words set in the body font read as captions, not
 * controls, and a screen made of them looks like a web form rather than an app.
 * These replace them where a symbol is universally understood, and sit beside a
 * label where it is not.
 *
 * Drawn for this app on one 24 unit grid with one stroke weight and rounded
 * ends, so they read as a set. They take the colour of the text around them.
 */

export type IconName =
  | 'back' | 'settings' | 'camera' | 'flip' | 'look' | 'trash' | 'send'
  | 'plus' | 'search' | 'close' | 'bell-off' | 'chevron-down' | 'check' | 'chat'
  | 'chevron-right' | 'pin' | 'user' | 'key' | 'mail' | 'share' | 'copy'

const PATHS: Record<IconName, React.ReactNode> = {
  back: <path d="M15 18l-6-6 6-6" />,
  settings: (
    <>
      <path d="M19.08 9.84 L21.48 10.50 L21.48 13.50 L19.08 14.16 L18.53 15.47 L19.77 17.64 L17.64 19.77 L15.47 18.53 L14.16 19.08 L13.50 21.48 L10.50 21.48 L9.84 19.08 L8.53 18.53 L6.36 19.77 L4.23 17.64 L5.47 15.47 L4.92 14.16 L2.52 13.50 L2.52 10.50 L4.92 9.84 L5.47 8.53 L4.23 6.36 L6.36 4.23 L8.53 5.47 L9.84 4.92 L10.50 2.52 L13.50 2.52 L14.16 4.92 L15.47 5.47 L17.64 4.23 L19.77 6.36 L18.53 8.53 Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h2.2l1.6-2h6.4l1.6 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  flip: (
    <>
      <path d="M4.5 11a7.5 7.5 0 0 1 13-4.6L19.5 8.5" />
      <path d="M19.5 4v4.5H15" />
      <path d="M19.5 13a7.5 7.5 0 0 1-13 4.6L4.5 15.5" />
      <path d="M4.5 20v-4.5H9" />
    </>
  ),
  look: (
    <>
      <path d="M11 3.5l1.8 4.9L17.7 10l-4.9 1.8L11 16.7l-1.8-4.9L4.3 10l4.9-1.6z" />
      <path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  send: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.3-4.3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'bell-off': (
    <>
      <path d="M6 16h12l-1.6-2.2V10a4.4 4.4 0 0 0-8.8 0v3.8z" />
      <path d="M10.3 19a1.8 1.8 0 0 0 3.4 0" />
      <path d="M4 4l16 16" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  pin: (
    <>
      <path className="icon-fill" d="M9 3.5h6l-1.1 5.4 3.1 3.1v2H7v-2l3.1-3.1z" />
      <path d="M12 14v6.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2L19 4M15.5 7.5l2.5 2.5M17.5 5.5l2 2" />
    </>
  ),
  share: (
    <>
      <path d="M12 14.5V3.5M8 7.5l4-4 4 4" />
      <path d="M7.5 10.5H6.5a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  chat: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.2A.5.5 0 0 1 5 19.8V17h-.5A.5.5 0 0 1 4 16.5z" />,
}

export function Icon ({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
