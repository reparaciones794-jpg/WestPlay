import type { Ahead } from '../maps/alongRoute'
import type { Destination } from '../maps/places'

/**
 * What Namy is told about the places around the truck, to answer "where's a fuel station?" by voice: the nearest
 * fuel station, rest area and service, from the map the Maps app draws (maps/places.ts). Namy has no map of her own.
 */

export const NEARBY_KINDS = ['fuel', 'parking', 'service', 'hotel', 'weigh', 'dealer', 'garage'] as const
export type NearbyKind = (typeof NEARBY_KINDS)[number]

export interface NearbyPlace {
  name?: string
  /** In the units the game's GPS gives (the map's `scale` applied). */
  km: number
  /** On the route still to drive (else in a straight line). */
  ahead: boolean
  /** lng, lat: where it is on the map (for marking it; Namy doesn't use it). */
  at: [number, number]
  /** The map node the game routes to (its uid, hex), for taking the player there (Namy doesn't use it). */
  node: string
}

export type Nearby = Partial<Record<NearbyKind, NearbyPlace>>

export function isNearbyKind(kind: unknown): kind is NearbyKind {
  return typeof kind === 'string' && (NEARBY_KINDS as readonly string[]).includes(kind)
}

/**
 * The nearest place of each kind: the first along the route ahead (`ahead`, nearest along it first) when the
 * truck is on a route with one in reach, else the nearest in a straight line (`straight`: its ground distance
 * in metres). `scale`: the map's, to the distances the game's GPS gives.
 */
export function nearestPlaces(
  places: readonly Destination[],
  ahead: readonly Ahead[] | null,
  straight: (place: Destination) => number,
  scale: number,
): Nearby {
  const found: Nearby = {}
  for (const item of ahead ?? []) {
    const kind = item.place.kind
    if (isNearbyKind(kind) && !found[kind]) {
      found[kind] = { name: item.place.localized ?? item.place.name, km: (item.along * scale) / 1000, ahead: true, at: item.place.at, node: item.place.node }
    }
  }
  const best: Partial<Record<NearbyKind, { place: Destination; metres: number }>> = {}
  for (const place of places) {
    const kind = place.kind
    if (!isNearbyKind(kind) || found[kind]) continue
    const metres = straight(place)
    if (!Number.isFinite(metres)) continue
    const at = best[kind]
    if (!at || metres < at.metres) best[kind] = { place, metres }
  }
  for (const kind of NEARBY_KINDS) {
    const at = best[kind]
    if (at) found[kind] = { name: at.place.localized ?? at.place.name, km: (at.metres * scale) / 1000, ahead: false, at: at.place.at, node: at.place.node }
  }
  return found
}
