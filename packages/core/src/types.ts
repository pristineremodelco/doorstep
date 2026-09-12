// The shapes both shells agree on. Nothing here knows about React.

export type ThreadKind = 'personal' | 'client'
export type MemberRole = 'owner' | 'member' | 'guest'
export type MessageKind = 'video' | 'photo' | 'voice' | 'text'

/**
 * How long a copy is kept, in days.
 *
 * Days rather than months because three months was the shortest anyone could
 * pick, which is a long time to be stuck with something you wanted gone by the
 * weekend. Each side chooses their own and neither can shorten the other.
 */
export const RETENTION_CHOICES = [2, 7, 14, 30, 90, 180, 365] as const
export type RetentionDays = (typeof RETENTION_CHOICES)[number]

/** How a retention choice is written where somebody has to read it. */
export function retentionLabel (days: RetentionDays): string {
  if (days === 365) return '1 year'
  if (days === 180) return '6 months'
  if (days === 90) return '3 months'
  return `${days} days`
}

export interface Profile {
  id: string
  display_name: string
  avatar_path: string | null
  /** Null means keep indefinitely, which only an operator may choose. */
  retention_days: RetentionDays | null
  is_guest: boolean
  /** Whether this account can see what the project is costing to run. */
  is_owner: boolean
  /** Days of quiet before a conversation files itself away. Null means never. */
  auto_archive_days: number | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export interface Thread {
  id: string
  kind: ThreadKind
  created_by: string
  subject: string | null
  created_at: string
  updated_at: string
  last_message_at: string | null
  archived_at: string | null
}

export interface ThreadMember {
  thread_id: string
  user_id: string
  role: MemberRole
  joined_at: string
  last_read_at: string | null
  left_at: string | null
  /** Notifications stay off for this conversation until this moment passes. */
  muted_until: string | null
  /** What you call them. Yours alone; it does not rename them for themselves. */
  nickname: string | null
  favorite: boolean
}

export interface Message {
  id: string
  thread_id: string
  sender_id: string
  kind: MessageKind
  body: string
  media_path: string | null
  poster_path: string | null
  duration_ms: number | null
  width: number | null
  height: number | null
  bytes: number | null
  created_at: string
  /** Written when the row lands. The server has it; that is all "sent" means. */
  delivered_at: string | null
  /** The sender's name at the time, so a message outlives their account. */
  sender_name: string | null
  /** Set when the sender retracts, which clears it for both sides. */
  deleted_at: string | null
}

/**
 * Your copy of a message, with your own clock on it.
 *
 * Retention is per copy, so one person keeping things three months and another
 * keeping a year both get exactly what they asked for. The file survives until
 * the last copy goes.
 */
export interface MessageCopy {
  message_id: string
  user_id: string
  /** Null means kept indefinitely. */
  expires_at: string | null
  deleted_at: string | null
}

export interface Invite {
  id: string
  created_by: string
  kind: ThreadKind
  label: string
  reusable: boolean
  uses: number
  max_uses: number | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

/** A thread with the other person and the latest line, ready for a list row. */
export interface ThreadSummary {
  thread: Thread
  /**
   * The other person, when their profile can be read.
   *
   * Null once you block them, because blocking makes their profile unreadable,
   * which is the point of it. Anything that needs to know *who* the other
   * person is must use otherId instead: a rule written against this field
   * silently stops applying at the moment it matters most.
   */
  other: Profile | null
  /**
   * The other person's id, taken from thread membership rather than from their
   * profile, so it survives a block.
   */
  otherId: string | null
  latest: Message | null
  unread: number
  /** Your nickname for them, if you set one. */
  nickname: string | null
  favorite: boolean
  mutedUntil: string | null
}

/** How the conversation list is ordered. */
export type ThreadSort = 'recent' | 'name'
