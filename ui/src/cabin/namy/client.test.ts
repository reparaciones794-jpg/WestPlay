import { describe, expect, it } from 'vitest'
import { type ClientDeps, type Link, NamyClient } from './client'
import type { ChatItem, MusicCommand } from './protocol'

type Reply = { status: number; body: unknown } | 'down'

/** A fake Namy: answers by path, and remembers what was asked. */
function setup(replies: Record<string, Reply[] | Reply>) {
  const calls: { path: string; method: string; auth?: string; body?: string }[] = []
  const store = new Map<string, string>()
  const music: MusicCommand[] = []
  const plays: string[] = []
  const maps: string[] = []
  const chats: { items: ChatItem[]; initial: boolean }[] = []
  const links: Link[] = []
  const deps: ClientDeps = {
    request: async (url, init) => {
      const path = url.replace('http://namy.test', '')
      calls.push({ path, method: init.method, auth: init.headers.Authorization, body: init.body })
      const key = path.split('?')[0]
      const entry = replies[key]
      const reply = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry
      if (!reply || reply === 'down') throw new Error('connection refused')
      return { status: reply.status, json: async () => reply.body }
    },
    live: () => ({ telemetry: null, truck: null, job: null, weather: null }),
    storage: {
      get: (k) => store.get(k) ?? null,
      set: (k, v) => void store.set(k, v),
      remove: (k) => void store.delete(k),
    },
    makeId: () => 'abcdef0123456789',
    onMusic: (c) => music.push(c),
    onPlay: (q) => plays.push(q),
    onMap: (k) => maps.push(k),
    onChat: (items, _status, initial) => chats.push({ items, initial }),
    onLink: (l) => links.push(l),
    baseUrl: 'http://namy.test',
  }
  return { deps, calls, store, music, plays, maps, chats, links }
}

const ok = (body: unknown) => ({ status: 200, body })
const chat = (latest: number, items: unknown[] = []) => ok({ items, latest, status: { state: 'idle', listen_mode: 'off' } })

describe('the cab pairing with Namy', () => {
  it('asks once with its own id, waits while she has not been allowed, and keeps the token', async () => {
    const t = setup({ '/pair': [ok({ status: 'pending' }), ok({ status: 'allowed', token: 'tok-1' })], '/state': ok({ ok: true }), '/chat': chat(0) })
    const client = new NamyClient(t.deps)
    expect(await client.step()).toBe(2000)
    expect(t.links).toEqual(['pairing'])
    expect(JSON.parse(t.calls[0].body!)).toEqual({ client_id: 'abcdef0123456789' })
    expect(t.calls[0].auth).toBeUndefined() // pairing needs no token
    await client.step()
    expect(t.store.get('westplay.namy.token')).toBe('tok-1')
    expect(t.links.at(-1)).toBe('connected')
  })

  it('starts from the saved token without asking again', async () => {
    const t = setup({ '/state': ok({ ok: true }), '/chat': chat(0) })
    t.store.set('westplay.namy.token', 'saved')
    await new NamyClient(t.deps).step()
    expect(t.calls.map((c) => c.path)).toEqual(['/state', '/chat'])
    expect(t.calls[0].auth).toBe('Bearer saved')
  })

  it('waits a minute when the player says no', async () => {
    const t = setup({ '/pair': ok({ status: 'denied' }) })
    expect(await new NamyClient(t.deps).step()).toBe(60_000)
    expect(t.links).toEqual(['denied'])
  })

  it('asks again when Namy forgot it (401)', async () => {
    const t = setup({ '/state': { status: 401, body: {} } })
    t.store.set('westplay.namy.token', 'old')
    const client = new NamyClient(t.deps)
    await client.step()
    expect(t.store.has('westplay.namy.token')).toBe(false)
  })

  it('is offline, quietly, while Namy is not running, backing off', async () => {
    const t = setup({ '/pair': 'down' })
    const client = new NamyClient(t.deps)
    const waits = [await client.step(), await client.step(), await client.step(), await client.step(), await client.step()]
    expect(waits).toEqual([2000, 4000, 8000, 15000, 15000])
    expect(t.links).toEqual(['offline'])
  })
})

describe('the cab following Namy', () => {
  const paired = (replies: Record<string, Reply[] | Reply>) => {
    const t = setup({ '/state': ok({ ok: true }), ...replies })
    t.store.set('westplay.namy.token', 'tok')
    return t
  }

  it('does not play an order that was there before the page loaded', async () => {
    const t = paired({ '/chat': chat(5, [{ id: 4, kind: 'action', action: 'music', command: 'nextTrack' }]) })
    await new NamyClient(t.deps).step()
    expect(t.music).toEqual([])
    expect(t.chats[0].initial).toBe(true)
  })

  it('searches and plays what a play order asks, once, never on the first sync and never empty', async () => {
    const play = (id: number, query?: string) => ({ id, kind: 'action', action: 'music', command: 'play', query })
    const t = paired({ '/chat': [chat(5, [play(5, 'old')]), chat(8, [play(6, ' soda stereo '), play(7, '   '), play(8)]), chat(8)] })
    const client = new NamyClient(t.deps)
    await client.step()
    await client.step()
    await client.step()
    expect(t.plays).toEqual(['soda stereo'])
    expect(t.music).toEqual([])
  })

  it('marks the nearest place of a kind once, never on the first sync and never a kind it does not know', async () => {
    const map = (id: number, command: string) => ({ id, kind: 'action', action: 'map', command })
    const t = paired({ '/chat': [chat(5, [map(5, 'fuel')]), chat(8, [map(6, 'parking'), map(7, 'hotel'), map(8, 'service')]), chat(8)] })
    const client = new NamyClient(t.deps)
    await client.step()
    await client.step()
    await client.step()
    expect(t.maps).toEqual(['parking', 'service'])
  })

  it('plays each new music order once, and only the valid ones', async () => {
    const t = paired({
      '/chat': [
        chat(5),
        chat(7, [
          { id: 6, kind: 'action', action: 'music', command: 'nextTrack' },
          { id: 7, kind: 'action', action: 'music', command: 'format-disk' },
        ]),
        chat(7),
      ],
    })
    const client = new NamyClient(t.deps)
    await client.step()
    await client.step()
    await client.step()
    expect(t.music).toEqual(['nextTrack'])
    expect(t.calls.filter((c) => c.path.startsWith('/chat')).map((c) => c.path)).toEqual(['/chat', '/chat?since=5', '/chat?since=7'])
  })

  it('gives the screen what she said, without the orders', async () => {
    const t = paired({ '/chat': [chat(0), chat(2, [{ id: 1, kind: 'assistant', text: 'Hola' }, { id: 2, kind: 'action', action: 'music', command: 'playPause' }])] })
    const client = new NamyClient(t.deps)
    await client.step()
    await client.step()
    expect(t.chats[1].initial).toBe(false)
    expect(t.chats[1].items.map((i) => i.id)).toEqual([1])
  })

  it('starts over when Namy was restarted (her numbers began again)', async () => {
    const t = paired({ '/chat': [chat(50), chat(1), chat(1, [{ id: 1, kind: 'assistant', text: 'Hola otra vez' }])] })
    const client = new NamyClient(t.deps)
    await client.step()
    expect(await client.step()).toBe(0)
    await client.step()
    expect(t.calls.filter((c) => c.path.startsWith('/chat')).map((c) => c.path)).toEqual(['/chat', '/chat?since=50', '/chat'])
  })

  it('sends the game state every round', async () => {
    const t = paired({ '/chat': chat(0) })
    await new NamyClient(t.deps).step()
    expect(JSON.parse(t.calls[0].body!)).toMatchObject({ v: 1, game: { running: false } })
  })

  it('treats a garbled answer as offline', async () => {
    const t = paired({ '/chat': ok({ nope: true }) })
    expect(await new NamyClient(t.deps).step()).toBe(15_000)
    expect(t.links).toEqual(['offline'])
  })
})
