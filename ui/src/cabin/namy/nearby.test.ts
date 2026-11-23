import { describe, expect, it } from 'vitest'
import type { Ahead } from '../maps/alongRoute'
import type { Destination, DestinationKind } from '../maps/places'
import { nearestPlaces } from './nearby'

function place(kind: DestinationKind, name: string | undefined, metres: number): Destination {
  return { kind, name, at: [metres, 0], node: `${kind}-${metres}` }
}
const straight = (p: Destination) => Math.abs(p.at[0])

describe("the places Namy is told of", () => {
  it('takes the nearest of each kind in a straight line, in the units of the game\'s GPS', () => {
    const found = nearestPlaces(
      [place('fuel', 'Far', 9000), place('fuel', 'Near', 3000), place('parking', undefined, 1000), place('hotel', 'Inn', 10)],
      null,
      straight,
      19,
    )
    expect(found.fuel).toMatchObject({ name: 'Near', km: 57, ahead: false, at: [3000, 0] })
    expect(found.parking?.km).toBeCloseTo(19)
    expect(found.service).toBeUndefined()
    expect(Object.keys(found).sort()).toEqual(['fuel', 'parking'])
  })

  it('prefers the place ahead on the route, nearest along it, over a nearer one off it', () => {
    const near = place('fuel', 'Behind', 100)
    const first = place('fuel', 'First', 5000)
    const second = place('fuel', 'Second', 6000)
    const ahead: Ahead[] = [
      { place: first, along: 2000, off: 10 },
      { place: second, along: 3000, off: 10 },
    ]
    const found = nearestPlaces([near, first, second, place('parking', 'P', 400)], ahead, straight, 1)
    expect(found.fuel).toMatchObject({ name: 'First', km: 2, ahead: true })
    // Nothing ahead of that kind: it falls back to the straight line.
    expect(found.parking).toMatchObject({ name: 'P', km: 0.4, ahead: false })
  })

  it('skips places whose distance is unknown', () => {
    expect(nearestPlaces([place('fuel', 'A', 1)], null, () => Infinity, 1)).toEqual({})
  })
})
