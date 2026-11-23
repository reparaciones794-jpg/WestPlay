import { keybinds } from '../apps/keybinds'
import { ask, play } from '../apps/youtube/youtube'
import type { MusicPlayer } from '../apps/musicWithGame'
import { showVolume } from '../shell/volumeShown'
import { useLive } from '../state/store'
import { NamyClient } from './client'
import { createNearbyProvider } from './nearbyProvider'
import { receiveChat, receiveLink } from './namyStore'

/** A request gives up after this long, ms (Namy is on this PC: she answers at once or not at all). */
const GIVE_UP_MS = 3000

function storage() {
  // The page's storage may be off (a private profile): then the cab asks to be paired again each time.
  const memory = new Map<string, string>()
  return {
    get(key: string): string | null {
      try {
        return localStorage.getItem(key)
      } catch {
        return memory.get(key) ?? null
      }
    },
    set(key: string, value: string): void {
      try {
        localStorage.setItem(key, value)
      } catch {
        memory.set(key, value)
      }
    },
    remove(key: string): void {
      try {
        localStorage.removeItem(key)
      } catch {
        memory.delete(key)
      }
    },
  }
}

function makeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** "Play <query>" by voice: asks YouTube (no sign-in needed) and plays the first video that isn't a live stream,
 * sound only (the cab screen stays where it is). Nothing found, or YouTube not answering: nothing happens. */
function playByName(query: string): void {
  void ask({ action: 'search', query }).then((answer) => {
    if (answer.failed) return
    const video = answer.videos?.find((v) => !v.live)
    if (video) play(video, false)
  })
}

/**
 * Connects the cab with Namy, the voice copilot (namy/protocol.ts): the game's state goes to her, her words show
 * on the screen (NamyHud.tsx), and her music orders act on the cab's players as the keybinds do. Returns the
 * function that stops it. Where Namy isn't running (or her WestPlay link is off) it only tries now and then.
 */
export function followNamy(players: readonly MusicPlayer[]): () => void {
  const binds = keybinds(players)
  const nearby = createNearbyProvider()
  const client = new NamyClient({
    request: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(GIVE_UP_MS) }),
    live: () => {
      const { telemetry, truck, job, weather } = useLive.getState()
      return { telemetry, truck, job, weather, nearby: nearby() }
    },
    storage: storage(),
    makeId,
    onMusic: (command) => {
      const shown = binds.press(command)
      if (shown) showVolume(shown.volume)
    },
    onPlay: playByName,
    // Loaded now, not at start: the map's library isn't carried until the player (or Namy) needs it.
    onMap: (kind) => {
      const at = nearby()?.[kind]?.at ?? null
      void import('../maps/liveMap').then((map) => map.pointOutPlace(at))
    },
    onChat: receiveChat,
    onLink: receiveLink,
  })
  client.run()
  return () => {
    client.stop()
    binds.stop()
  }
}
