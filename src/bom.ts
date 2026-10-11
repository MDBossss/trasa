import { polylineLength } from './geometry'
import { allJunctions } from './junction'
import { ELEMENT_META, RELAY_MODELS, SOCKET_KINDS, type Project } from './types'
import { cableLengthM, wallExits } from './walls'

// Bill of materials summed from the drawing: cable metres (wall runs + conduit runs + reserve),
// conduit metres, WAGO connectors from the junctions, boxes, devices, LED strips and supplies.

export interface BomLine { group: string; item: string; unit: 'm' | 'kom'; qty: number }
const RESERVE_M = 0.3 // per cable end in a box

export function bomFor(p: Project, roomId: string | null): BomLine[] {
  const ppm = p.pxPerMeter ?? 100
  const rooms = p.rooms.filter((r) => !roomId || r.id === roomId)
  const inScope = (rid: string) => !roomId || rid === roomId
  const add = (map: Map<string, BomLine>, group: string, item: string, unit: 'm' | 'kom', qty: number) => {
    const k = `${group}|${item}`
    const cur = map.get(k)
    if (cur) cur.qty += qty
    else map.set(k, { group, item, unit, qty })
  }
  const out = new Map<string, BomLine>()

  // cables: wall run + reserve; the conduit run goes to the cable bound at the conduit's start (or end) exit
  const wallsByRoom = new Map(p.rooms.map((r) => [r.id, wallExits(r, p.conduits, ppm)]))
  for (const c of p.cables) {
    if (!inScope(c.roomId)) continue
    const walls = wallsByRoom.get(c.roomId)
    const wall = walls?.[c.wall]
    if (!wall) continue
    const elements = p.elements.filter((e) => e.roomId === c.roomId && e.wall === c.wall)
    let m = cableLengthM(c, { wall, elements, ceilingM: p.ceilingM })
    for (const end of [c.from, c.to]) if (end.kind === 'element') m += RESERVE_M
    add(out, 'Kabeli', c.type, 'm', m)
  }
  for (const cd of p.conduits) {
    const bound = (end: 'start' | 'end') => p.cables.find((c) => [c.from, c.to].some((e) => e.kind === 'exit' && e.conduitId === cd.id && e.end === end))
    const c = bound('start') ?? bound('end')
    const lenM = polylineLength(cd.points) / ppm
    if (c && inScope(c.roomId)) add(out, 'Kabeli', c.type, 'm', lenM + 2 * RESERVE_M)
    const touches = rooms.some((r) => p.cables.some((x) => x.roomId === r.id && [x.from, x.to].some((e) => e.kind === 'exit' && e.conduitId === cd.id)))
    if (!roomId || touches) add(out, 'Bužiri', `Bužir ø${cd.diameter}`, 'm', lenM)
  }
  // junction connectors
  for (const j of allJunctions(p)) {
    if (!inScope(j.room.id)) continue
    for (const b of j.bom) if (b.item.startsWith('WAGO')) add(out, 'Stezaljke', b.item, 'kom', b.qty)
  }
  // elements
  for (const e of p.elements) {
    if (!inScope(e.roomId)) continue
    const depth = e.depth ? `, ${e.depth}` : ''
    switch (e.type) {
      case 'box': add(out, 'Doze i kutije', `Razvodna kutija 100 × 100 mm${depth}`, 'kom', 1); break
      case 'modbox': add(out, 'Doze i kutije', `Doza modularna ${e.modules ?? 3}M${depth}`, 'kom', 1); break
      case 'socket':
        if (!e.host) add(out, 'Doze i kutije', `Doza Ø60${depth}`, 'kom', 1)
        add(out, 'Oprema', `Utičnica ${SOCKET_KINDS[e.socketKind ?? 'schuko'].label.toLowerCase()} ${SOCKET_KINDS[e.socketKind ?? 'schuko'].modules}M${e.host ? ' (u modularnoj)' : ''}`, 'kom', 1); break
      case 'switch':
        if (!e.host) add(out, 'Doze i kutije', `Doza Ø60${depth}`, 'kom', 1)
        add(out, 'Oprema', e.switchKind === 'tipkalo' ? 'Tipkalo' : `Prekidač ${e.switchKind ?? 'obični'}`, 'kom', 1); break
      case 'light': add(out, 'Oprema', 'Svjetlo (rasvjetno mjesto)', 'kom', 1); break
      case 'panel': add(out, 'Oprema', ELEMENT_META.panel.label, 'kom', 1); break
      case 'relay': add(out, 'Releji', RELAY_MODELS[e.relayModel ?? 'plus1'].label, 'kom', 1); break
      case 'ledpsu': {
        const m = e.ledM ?? 5, w = e.ledWpm ?? 10
        add(out, 'LED', `LED traka ${e.ledV ?? 24} V COB (${w} W/m)`, 'm', m)
        add(out, 'LED', `Alu profil s difuzorom`, 'm', m)
        add(out, 'LED', `Napajanje ${e.ledV ?? 24} V ≥ ${Math.ceil((m * w * 1.2) / 10) * 10} W`, 'kom', 1)
        break
      }
    }
  }
  const order = ['Kabeli', 'Bužiri', 'Stezaljke', 'Doze i kutije', 'Oprema', 'Releji', 'LED']
  return [...out.values()]
    .map((l) => ({ ...l, qty: l.unit === 'm' ? Math.ceil(l.qty * 2) / 2 : l.qty }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.item.localeCompare(b.item))
}
