import { type Ahead, placesAhead } from '../maps/alongRoute'
import { loadMapData } from '../maps/mapData'
import { type Destination, type DestinationKind, loadPlaces, searchPlaces } from '../maps/places'
import { metresBetween, toLngLat } from '../maps/projection'
import { useLive } from '../state/store'
import { isNearbyKind, NEARBY_KINDS, type Nearby, type NearbyPlace, nearestPlaces } from './nearby'

/** The places are worked out again after this long, ms, or once the truck has moved `MOVED` (it's a scan of
 * every place: no need to do it every second Namy is told the state). */
const EVERY_MS = 5000
const MOVED = 250

/** The kinds' names, empty: a name searched for matches the place's own name or city, never "what it is". */
const NO_KIND_NAMES = Object.fromEntries(
  ['fuel', 'service', 'garage', 'dealer', 'company', 'parking', 'hotel', 'recruitment', 'weigh', 'ferry', 'train', 'city'].map((k) => [k, '']),
) as Record<DestinationKind, string>

/** What Namy asked for, found on the map: the place, its name as shown, and how far it is (the game's GPS units). */
export interface Found {
  place: Destination
  name: string
  km: number
  /** On the route ahead (else in a straight line). */
  ahead: boolean
}

export interface NearbyProvider {
  /** The nearest fuel station, rest area… for Namy; `null` until the map's places are there, or without a truck. */
  current(): Nearby | null
  /** What `query` asks for: a kind of place ("fuel": the nearest, as Namy was told) or a name ("Hamburg"). `'noMap'`
   * while there's no map to look in, `null` if nothing matches. */
  find(query: string): Found | 'noMap' | null
}

function nameOf(place: Destination): string {
  return place.localized ?? place.name ?? ''
}

/**
 * The places around the truck for Namy (nearby.ts), and a way to find one she names: loads the map's places the first
 * time it's asked.
 */
export function createNearbyProvider(): NearbyProvider {
  let all: Destination[] | null = null
  let near: Destination[] | null = null
  let scale = 19
  let loading = false
  let last: { at: number; x: number; z: number; value: Nearby | null } | null = null
  let working = false

  const load = () => {
    if (loading) return
    loading = true
    void loadMapData()
      .then((map) => {
        scale = map?.scale ?? 19
        return map?.places ? loadPlaces(map.places) : null
      })
      .then((places) => {
        all = places
        near = places ? places.filter((place) => (NEARBY_KINDS as readonly string[]).includes(place.kind)) : null
      })
      .catch(() => {
        all = near = null
      })
      .finally(() => {
        // Tried again later if the map wasn't there yet (the host says which one a moment after start).
        if (all === null) setTimeout(() => (loading = false), 30_000)
      })
  }

  const work = async (x: number, z: number, now: number) => {
    working = true
    try {
      const from = toLngLat(x, z)
      let ahead: Ahead[] | null = null
      if (useLive.getState().route !== null) {
        // Only while the Maps app has drawn the route: its progress along it comes from the drawing. Loaded now,
        // so the cab doesn't carry the map's library until the player opens Maps.
        const { liveRouteProgress } = await import('../maps/liveMap')
        const live = liveRouteProgress()
        if (live && near) ahead = placesAhead(near, live.spans, live.progress)
      }
      const value = near ? nearestPlaces(near, ahead, (place) => metresBetween(place.at, from), scale) : null
      last = { at: now, x, z, value }
    } catch {
      last = { at: now, x, z, value: null }
    } finally {
      working = false
    }
  }

  const current = (): Nearby | null => {
    const t = useLive.getState().telemetry
    if (!t) return null
    if (!near) {
      load()
      return null
    }
    const now = Date.now()
    const stale = !last || now - last.at > EVERY_MS || Math.hypot(t.x - last.x, t.z - last.z) > MOVED
    if (stale && !working) void work(t.x, t.z, now)
    return last?.value ?? null
  }

  const find = (query: string): Found | 'noMap' | null => {
    const t = useLive.getState().telemetry
    if (!all) {
      load()
      return 'noMap'
    }
    if (isNearbyKind(query)) {
      const at: NearbyPlace | undefined = last?.value?.[query]
      const place = at && all.find((p) => p.node === at.node)
      return at && place ? { place, name: at.name ?? '', km: at.km, ahead: at.ahead } : null
    }
    const from = t ? toLngLat(t.x, t.z) : null
    const [place] = searchPlaces(all, query, from, NO_KIND_NAMES)
    if (!place) return null
    const km = from ? (metresBetween(place.at, from) * scale) / 1000 : 0
    return { place, name: nameOf(place), km, ahead: false }
  }

  return { current, find }
}
