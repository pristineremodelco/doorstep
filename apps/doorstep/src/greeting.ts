/**
 * The line under the name.
 *
 * It changes every time the conversation list comes up: opening the app, coming
 * back out of a conversation, and again next time the app is opened.
 *
 * The order is shuffled rather than fixed, but not drawn at random each time.
 * True random repeats: four phrases means a one in four chance of seeing the
 * same one twice running and one in sixteen of three in a row, which reads as a
 * bug rather than as chance. So the phrases are dealt from a shuffled deck.
 * Every one appears before any repeats, the deck is reshuffled when it runs
 * out, and a reshuffle that would put the last phrase first is dealt again. The
 * order is different each round and you never see the same line twice in a row.
 */

export const GREETINGS = [
  'Welcome Friends',
  'Come On In!',
  'It\u2019s Been Too Long..',
  'Your Place Next Time',
  'Wazzup?!?',
  'How\u2019ve You Been?',
  'Howdy There, Partner.',
  // The note sits outside the font's subset on purpose, so it falls through to
  // the system glyph and comes out crisp instead of stretched into a script it
  // was never drawn for.
  'I\u2019d Like To Be\u2026 \u266B',
] as const

const DECK_KEY = 'doorstep.greeting.deck'
const LAST_KEY = 'doorstep.greeting.last'

function shuffled (): number[] {
  const deck = GREETINGS.map ((_, i) => i)
  // Fisher-Yates, with crypto rather than Math.random for an even deal.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues (new Uint32Array (1))[0]! % (i + 1)
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  return deck
}

/** A fresh deck that will not open on the phrase just shown. */
function dealFresh (last: number | null): number[] {
  let deck = shuffled ()
  // With four cards this settles immediately; the guard is here so it cannot
  // spin if the list is ever cut to one.
  for (let tries = 0; tries < 8 && last !== null && deck[0] === last; tries++) {
    deck = shuffled ()
  }
  return deck
}

export function nextGreeting (): string {
  let deck: number[] = []
  let last: number | null = null

  try {
    last = Number.parseInt (localStorage.getItem (LAST_KEY) ?? '', 10)
    if (!Number.isInteger (last)) last = null

    const raw = localStorage.getItem (DECK_KEY)
    const parsed = raw ? JSON.parse (raw) : null
    if (Array.isArray (parsed)) {
      deck = parsed.filter (
        (n: unknown): n is number => Number.isInteger (n) && (n as number) < GREETINGS.length
      )
    }
  } catch {
    // Storage that cannot be read simply starts a new round.
  }

  if (deck.length === 0) deck = dealFresh (last)

  const index = deck.shift () ?? 0

  try {
    localStorage.setItem (DECK_KEY, JSON.stringify (deck))
    localStorage.setItem (LAST_KEY, String (index))
  } catch {
    // Without storage every visit deals a fresh deck, which is still varied.
  }

  return GREETINGS[index] ?? GREETINGS[0]
}
