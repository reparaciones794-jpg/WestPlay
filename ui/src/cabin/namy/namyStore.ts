import { create } from 'zustand'
import type { Link } from './client'
import { lastSaid, type ChatItem, type NamyStatus } from './protocol'

/** How long Namy's last words stay on the screen, ms. */
export const SAID_MS = 9000

/** What the cab shows of Namy (NamyHud.tsx): the link, what she is doing, and what she last said. */
export interface NamyShown {
  link: Link
  status: NamyStatus
  said: { id: number; kind: string; text: string; at: number } | null
}

export const useNamy = create<NamyShown>()(() => ({
  link: 'off',
  status: { state: 'idle', listenMode: 'off' },
  said: null,
}))

export function receiveLink(link: Link): void {
  useNamy.setState({ link })
}

/** `initial`: the first sync (what was said before the page loaded is not shown as new). */
export function receiveChat(items: readonly ChatItem[], status: NamyStatus, initial: boolean, now = Date.now()): void {
  const patch: Partial<NamyShown> = { status }
  const said = initial ? null : lastSaid(items)
  if (said) patch.said = { ...said, at: now }
  useNamy.setState(patch)
}
