import { describe, expect, it } from 'vitest'
import { buildState, isMusicCommand, lastSaid, parseChat } from './protocol'

describe("Namy's protocol", () => {
  it('knows the music orders and nothing else', () => {
    for (const c of ['playPause', 'nextTrack', 'previousTrack', 'volumeUp', 'volumeDown']) expect(isMusicCommand(c)).toBe(true)
    // Not the screen's brightness, and not anything a page could make up.
    for (const c of ['brightnessUp', 'rm -rf', '', 3, null, undefined, {}]) expect(isMusicCommand(c)).toBe(false)
  })

  it('reads her answer, dropping what is not valid', () => {
    const chat = parseChat({
      items: [{ id: 1, kind: 'assistant', text: 'Hola' }, { id: 'x', kind: 'assistant' }, 7, { id: 2, kind: 'action', action: 'music', command: 'nextTrack' }],
      latest: 2,
      status: { state: 'speaking', listen_mode: 'wake' },
    })
    expect(chat?.items.map((i) => i.id)).toEqual([1, 2])
    expect(chat?.status).toEqual({ state: 'speaking', listenMode: 'wake' })
    expect(chat?.items[1].command).toBe('nextTrack')
  })

  it('takes an unknown state as idle, and rejects an answer that is not hers', () => {
    expect(parseChat({ items: [], latest: 0, status: { state: 'dancing' } })?.status.state).toBe('idle')
    expect(parseChat({ items: [], latest: 0 })?.status).toEqual({ state: 'idle', listenMode: 'off' })
    for (const bad of [null, 'x', 3, {}, { items: 'no', latest: 1 }, { items: [], latest: 'a' }, { items: [], latest: NaN }]) {
      expect(parseChat(bad)).toBeNull()
    }
  })

  it('sends the game as not running when there is no telemetry', () => {
    const state = buildState({ telemetry: null, truck: null, job: null, weather: null })
    expect(state).toMatchObject({ v: 1, game: { running: false }, telemetry: null })
  })

  it('sends the state with the fields Namy reads', () => {
    const state = buildState({
      telemetry: { speed: 22, fuel: 400, fuelRange: 850, navigationSpeedLimit: 25, navigationDistance: 42000, navigationTime: 3000, gameTime: 100, paused: false, engineEnabled: true, cruiseControlSpeed: 0 },
      truck: { brandId: 'daf', brand: 'DAF', id: 'vehicle.daf.2021', name: 'XG+' },
      job: null,
      weather: { now: 'clear', coming: 'rain', changeIn: 60, wetness: 0 },
    }) as { game: { running: boolean }; telemetry: { speed: number; navigationDistance: number }; truck: { name: string }; weather: { coming: string } }
    expect(state.game.running).toBe(true)
    expect(state.telemetry.speed).toBe(22)
    expect(state.telemetry.navigationDistance).toBe(42000)
    expect(state.truck.name).toBe('XG+')
    expect(state.weather.coming).toBe('rain')
  })

  it('shows the newest thing she said, not the player\'s own words or the orders', () => {
    expect(
      lastSaid([
        { id: 1, kind: 'assistant', text: 'uno' },
        { id: 2, kind: 'alert', text: 'dos' },
        { id: 3, kind: 'user', text: 'yo' },
        { id: 4, kind: 'action', action: 'music', command: 'nextTrack' },
      ]),
    ).toEqual({ id: 2, kind: 'alert', text: 'dos' })
    expect(lastSaid([{ id: 1, kind: 'user', text: 'yo' }])).toBeNull()
  })
})
