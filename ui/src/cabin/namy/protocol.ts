/**
 * What the cab and Namy (the voice copilot, a separate app on the same PC) say to each other. Namy listens only
 * on 127.0.0.1; the cab asks to be paired once (the player allows it in Namy's window) and then reads her
 * messages and the music orders she gives, and tells her what the truck, the job and the weather are.
 */

import type { Nearby } from './nearby'

/** Where Namy listens: her default port (Namy's Configuración › Conectar con WestPlay). */
export const NAMY_URL = 'http://127.0.0.1:27182'

/** The music orders Namy gives: the same words as the keybinds' (`KeybindAction`), so they take the same path. */
export const MUSIC_COMMANDS = ['playPause', 'nextTrack', 'previousTrack', 'volumeUp', 'volumeDown'] as const
export type MusicCommand = (typeof MUSIC_COMMANDS)[number]

export function isMusicCommand(value: unknown): value is MusicCommand {
  return typeof value === 'string' && (MUSIC_COMMANDS as readonly string[]).includes(value)
}

/** What Namy is doing: nothing, listening to the player, thinking an answer, or speaking it. */
export type NamyState = 'idle' | 'listening' | 'thinking' | 'speaking'
const STATES: readonly string[] = ['idle', 'listening', 'thinking', 'speaking']

export interface NamyStatus {
  state: NamyState
  listenMode: string
}

/** One item of Namy's log: something said (`user`, `assistant`, `alert`, `system`) or an order (`action`). */
export interface ChatItem {
  id: number
  kind: string
  text?: string
  action?: string
  command?: string
  /** With the `play` order: what to search and play. */
  query?: string
}

export interface ChatAnswer {
  items: ChatItem[]
  latest: number
  status: NamyStatus
}

/** Reads Namy's answer to `GET /chat`, whatever she sent (`null`: not a valid answer). */
export function parseChat(body: unknown): ChatAnswer | null {
  if (typeof body !== 'object' || body === null) return null
  const { items, latest, status } = body as Record<string, unknown>
  if (!Array.isArray(items) || typeof latest !== 'number' || !Number.isFinite(latest)) return null
  const clean: ChatItem[] = []
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'number' || typeof item.kind !== 'string') continue
    clean.push({
      id: item.id,
      kind: item.kind,
      text: typeof item.text === 'string' ? item.text : undefined,
      action: typeof item.action === 'string' ? item.action : undefined,
      command: typeof item.command === 'string' ? item.command : undefined,
      query: typeof item.query === 'string' ? item.query : undefined,
    })
  }
  const s = typeof status === 'object' && status !== null ? (status as Record<string, unknown>) : {}
  const state = typeof s.state === 'string' && STATES.includes(s.state) ? (s.state as NamyState) : 'idle'
  const listenMode = typeof s.listen_mode === 'string' ? s.listen_mode : 'off'
  return { items: clean, latest, status: { state, listenMode } }
}

/** The pieces of the live state Namy gets (a subset of `useLive`; all of it as the game's telemetry has it). */
export interface LiveForNamy {
  telemetry: {
    speed: number
    fuel: number
    fuelRange: number
    navigationSpeedLimit: number
    navigationDistance: number
    navigationTime: number
    gameTime: number
    paused: boolean
    engineEnabled: boolean
    cruiseControlSpeed: number
  } | null
  truck: { brandId: string; brand: string; id: string; name: string } | null
  job: {
    active: boolean
    cargoLoaded: boolean
    cargo: string
    cargoMass: number
    sourceCity: string
    sourceCompany: string
    destinationCity: string
    destinationCompany: string
    income: number
    plannedDistanceKm: number
    deliveryTime: number
  } | null
  weather: { now: string; coming: string; changeIn?: number | null; wetness?: number | null } | null
  /** The nearest fuel station, rest area and service, from the map (nearby.ts); none without the map. */
  nearby?: Nearby | null
}

/** The state sent to Namy (`POST /state`). Units as the host's: speed in m/s, fuel in litres, range in km. */
export function buildState(live: LiveForNamy): Record<string, unknown> {
  const t = live.telemetry
  return {
    v: 1,
    game: { running: t !== null },
    telemetry: t && {
      speed: t.speed,
      fuel: t.fuel,
      fuelRange: t.fuelRange,
      navigationSpeedLimit: t.navigationSpeedLimit,
      navigationDistance: t.navigationDistance,
      navigationTime: t.navigationTime,
      gameTime: t.gameTime,
      paused: t.paused,
      engineEnabled: t.engineEnabled,
      cruiseControlSpeed: t.cruiseControlSpeed,
    },
    truck: live.truck,
    job: live.job,
    weather: live.weather,
    nearby: live.nearby ?? null,
  }
}

/** The newest thing Namy said among `items` (the player's own words are not shown back to them). */
export function lastSaid(items: readonly ChatItem[]): { id: number; kind: string; text: string } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if ((item.kind === 'assistant' || item.kind === 'alert') && item.text) {
      return { id: item.id, kind: item.kind, text: item.text }
    }
  }
  return null
}
