import { isNearbyKind, type NearbyKind } from './nearby'
import {
  buildState,
  type ChatItem,
  isMusicCommand,
  type LiveForNamy,
  type MusicCommand,
  NAMY_URL,
  type NamyStatus,
  parseChat,
} from './protocol'

/** Where the cab stands with Namy: not looked for yet / not answering / waiting for the player to allow it /
 * refused / connected. */
export type Link = 'off' | 'offline' | 'pairing' | 'denied' | 'connected'

/** What the client needs from outside, so it can be tested without a browser. */
const MAX_QUERY = 100

export interface ClientDeps {
  /** `fetch`, as far as the client uses it. */
  request(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number
    json(): Promise<unknown>
  }>
  live(): LiveForNamy
  storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }
  /** A random id of 8 to 64 letters, digits, `_` or `-` (this cab's name to Namy). */
  makeId(): string
  onMusic(command: MusicCommand): void
  /** "Play this": search it and play the first result. */
  onPlay(query: string): void
  /** "Show me this kind of place": mark the nearest on the map (nearby.ts). */
  onMap(kind: NearbyKind): void
  /** New things Namy said (`initial`: the first sync, the last few already said before). */
  onChat(items: ChatItem[], status: NamyStatus, initial: boolean): void
  onLink(link: Link): void
  baseUrl?: string
}

const TOKEN_KEY = 'westplay.namy.token'
const ID_KEY = 'westplay.namy.client'

/** Pace, ms. */
const SYNC_EVERY = 1000
const PAIRING_EVERY = 2000
const DENIED_WAIT = 60_000
const OFFLINE_MAX = 15_000

/**
 * Talks to Namy: pairs once (the player allows it in her window; the token is kept), then every second tells her
 * the state of the game and reads what she said and the music orders she gave. `step()` does one round and says
 * how long to wait for the next; `run()` loops them.
 */
export class NamyClient {
  private token: string | null = null
  private last: number | null = null
  private failures = 0
  private link: Link = 'off'
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly deps: ClientDeps

  constructor(deps: ClientDeps) {
    this.deps = deps
    this.token = deps.storage.get(TOKEN_KEY)
  }

  private url(path: string): string {
    return (this.deps.baseUrl ?? NAMY_URL) + path
  }

  private setLink(link: Link): void {
    if (link === this.link) return
    this.link = link
    this.deps.onLink(link)
  }

  private clientId(): string {
    let id = this.deps.storage.get(ID_KEY)
    if (!id) {
      id = this.deps.makeId()
      this.deps.storage.set(ID_KEY, id)
    }
    return id
  }

  private forgetToken(): void {
    this.token = null
    this.last = null
    this.deps.storage.remove(TOKEN_KEY)
  }

  /** One round. Returns how long to wait before the next (ms). Never throws. */
  async step(): Promise<number> {
    try {
      const wait = this.token ? await this.sync(this.token) : await this.pair()
      this.failures = 0
      return wait
    } catch {
      this.setLink('offline')
      this.failures += 1
      return Math.min(OFFLINE_MAX, 2000 * 2 ** Math.min(this.failures - 1, 3))
    }
  }

  private async pair(): Promise<number> {
    const answer = await this.deps.request(this.url('/pair'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId() }),
    })
    const body = (await answer.json()) as { status?: unknown; token?: unknown }
    if (body.status === 'allowed' && typeof body.token === 'string' && body.token) {
      this.token = body.token
      this.deps.storage.set(TOKEN_KEY, body.token)
      this.setLink('connected')
      return 100
    }
    if (body.status === 'pending' || body.status === 'busy') {
      this.setLink('pairing')
      return PAIRING_EVERY
    }
    if (body.status === 'denied') {
      this.setLink('denied')
      return DENIED_WAIT
    }
    this.setLink('offline')
    return OFFLINE_MAX
  }

  private async sync(token: string): Promise<number> {
    const auth = { Authorization: `Bearer ${token}` }
    const pushed = await this.deps.request(this.url('/state'), {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildState(this.deps.live())),
    })
    if (pushed.status === 401) {
      this.forgetToken() // the player forgot this cab in Namy: ask again
      return 200
    }
    const since = this.last === null ? '' : `?since=${this.last}`
    const answer = await this.deps.request(this.url('/chat' + since), { method: 'GET', headers: auth })
    if (answer.status === 401) {
      this.forgetToken()
      return 200
    }
    const chat = parseChat(await answer.json())
    if (!chat) {
      this.setLink('offline')
      return OFFLINE_MAX
    }
    if (this.last !== null && chat.latest < this.last) {
      this.last = null // Namy started over (her numbers began again): read from her first sync
      return 0
    }
    const initial = this.last === null
    this.last = chat.latest
    this.setLink('connected')
    // The first sync never carries orders (an old "next song" must not play when the page loads).
    for (const item of chat.items) {
      if (item.kind === 'action' && item.action === 'music' && isMusicCommand(item.command) && !initial) {
        this.deps.onMusic(item.command)
      } else if (item.kind === 'action' && item.action === 'music' && item.command === 'play' && !initial) {
        const query = (item.query ?? '').trim().slice(0, MAX_QUERY)
        if (query) this.deps.onPlay(query)
      } else if (item.kind === 'action' && item.action === 'map' && isNearbyKind(item.command) && !initial) {
        this.deps.onMap(item.command)
      }
    }
    const said = chat.items.filter((item) => item.kind !== 'action')
    this.deps.onChat(said, chat.status, initial)
    return SYNC_EVERY
  }

  /** Starts the rounds. */
  run(): void {
    this.stopped = false
    const loop = async () => {
      const wait = await this.step()
      if (!this.stopped) this.timer = setTimeout(loop, wait)
    }
    void loop()
  }

  /** Stops them. */
  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
  }
}
