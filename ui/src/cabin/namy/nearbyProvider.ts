import { type Ahead, placesAhead } from '../maps/alongRoute'
import { loadMapData } from '../maps/mapData'
import { type Destination, loadPlaces } from '../maps/places'
import { metresBetween, toLngLat } from '../maps/projection'
import { useLive } from '../state/store'
import { NEARBY_KINDS, type Nearby, nearestPlaces } from './nearby'

/** The places are worked out again after this long, ms, or once the truck has moved `MOVED` (it's a scan of
 * every place: no need to do it every second Namy is told the state). */
const EVERY_MS = 5000
const MOVED = 250

/**
 * The places around the truck for Namy (nearby.ts): loads the map's places the first time it's asked, and answers
 * `null` until they're there, when the map has none, or when the truck's position isn't known.
 */
export function createNearbyProvider(): () => Nearby | null {
  let places: Destination[] | null = null
  let loading = false
  let last: { at: number; x: number; z: number; value: Nearby | null } | null = null
  let working = false

  const load = () => {
    if (loading) return
    loading = true
    void loadMapData()
      .then((map) => (map?.places ? loadPlaces(map.places) : null))
      .then((all) => {
        places = all ? all.filter((place) => (NEARBY_KINDS as readonly string[]).includes(place.kind)) : null
      })
      .catch(() => {
        places = null
      })
      .finally(() => {
        // Tried again later if the map wasn't there yet (the host says which one a moment after start).
        if (places === null) setTimeout(() => (loading = false), 30_000)
      })
  }

  const work = async (x: number, z: number, now: number) => {
    working = true
    try {
      const map = await loadMapData()
      const from = toLngLat(x, z)
      let ahead: Ahead[] | null = null
      if (useLive.getState().route !== null) {
        // Only while the Maps app has drawn the route: its progress along it comes from the drawing. Loaded now,
        // so the cab doesn't carry the map's library until the player opens Maps.
        const { liveRouteProgress } = await import('../maps/liveMap')
        const live = liveRouteProgress()
        if (live && places) ahead = placesAhead(places, live.spans, live.progress)
      }
      const value = places ? nearestPlaces(places, ahead, (place) => metresBetween(place.at, from), map?.scale ?? 19) : null
      last = { at: now, x, z, value }
    } catch {
      last = { at: now, x, z, value: null }
    } finally {
      working = false
    }
  }

  return () => {
    const t = useLive.getState().telemetry
    if (!t) return null
    if (!places) {
      load()
      return null
    }
    const now = Date.now()
    const stale = !last || now - last.at > EVERY_MS || Math.hypot(t.x - last.x, t.z - last.z) > MOVED
    if (stale && !working) void work(t.x, t.z, now)
    return last?.value ?? null
  }
}
