/**
 * Invite tokens.
 *
 * The token lives in the link and nowhere else. What reaches the server is only
 * its SHA-256 digest, both when the invite is created and when it is claimed,
 * so somebody reading the database finds no working invites in it.
 *
 * 22 characters of the unambiguous alphabet is about 113 bits. Guessing is not
 * a threat model worth worrying about, but the wrong-token error is uniform
 * anyway so a guesser learns nothing from trying.
 */

// No I, l, 1, O or 0. These get read aloud and typed by hand often enough.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'
const TOKEN_LENGTH = 22

export function makeToken (): string {
  const bytes = new Uint8Array (TOKEN_LENGTH)
  crypto.getRandomValues (bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

export async function hashToken (token: string): Promise<string> {
  const data = new TextEncoder ().encode (token)
  const digest = await crypto.subtle.digest ('SHA-256', data)
  return [...new Uint8Array (digest)]
    .map ((b) => b.toString (16).padStart (2, '0'))
    .join ('')
}
