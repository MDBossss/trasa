import { polylineLength } from './geometry'
import { allJunctions, boxSizeLabel } from './junction'
import { ELEMENT_META, RELAY_MODELS, SOCKET_KINDS, type Project, relayModelOf , DATA_META } from './types'
import { cableLengthM, wallExits } from './walls'

// Bill of materials summed from the drawing: cable metres (wall runs + conduit runs + reserve),
// WAGO connectors from the junctions, boxes, devices, LED strips and supplies. Conduits are not listed (user's call).

export interface BomLine { group: string; item: string; unit: 'm' | 'kom'; qty: number }
const RESERVE_M = 0.3 // per cable end in a box

export function bomFor(p: Project, roomId: string | null): BomLine[] {
  const ppm = p.pxPerMeter ?? 100
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
  }
  // junction connectors, and the box size each junction needs
  const sizes = new Map<string, string>()
  for (const j of allJunctions(p)) {
    sizes.set(j.box.id, boxSizeLabel(j.size.W, j.size.H))
    if (!inScope(j.room.id)) continue
    for (const b of j.bom) if (b.item.startsWith('WAGO')) add(out, 'Stezaljke', b.item, 'kom', b.qty)
  }
  // elements
  for (const e of p.elements) {
    if (!inScope(e.roomId)) continue
    const depth = e.depth === 'duboka' ? ', duboka' : ''
    switch (e.type) {
      case 'box': add(out, 'Doze i kutije', `Razvodna kutija ${sizes.get(e.id) ?? '10 × 10'}${depth}`, 'kom', 1); break
      case 'modbox': { const m = e.modules ?? 3; add(out, 'Doze i kutije', `Doza modularna ${m}M${m === 3 ? ' (TEM PM3)' : m === 4 ? ' (TEM PM4)' : m === 7 ? (e.depth === 'duboka' ? ' (TEM PM7-65)' : ' (TEM PM7)') : ''}${depth}`, 'kom', 1); add(out, 'Dekorativno', `Nosivi okvir + ukrasni okvir ${m}M`, 'kom', 1); break }
      case 'socket':
        if (!e.host) add(out, 'Doze i kutije', `Doza Ø60${depth}`, 'kom', 1)
        if (e.socketKind === 'rj45' || e.socketKind === 'tv') { add(out, 'Utičnice', `${DATA_META[e.socketKind].item}${e.host ? ' (u modularnoj)' : ''}`, 'kom', 1); break }
        add(out, 'Utičnice', `Utičnica ${SOCKET_KINDS[e.socketKind ?? 'schuko'].label.toLowerCase()} ${SOCKET_KINDS[e.socketKind ?? 'schuko'].modules}M${e.host ? ' (u modularnoj)' : ''}`, 'kom', 1); break
      case 'switch':
        if (!e.host) add(out, 'Doze i kutije', `Doza Ø60${depth}`, 'kom', 1)
        add(out, 'Prekidači', `${e.switchKind === 'tipkalo' ? 'Tipkalo' : `Prekidač ${e.switchKind ?? 'obični'}`}${e.host ? ` ${e.modules ?? 1}M` : ''}`, 'kom', 1); break
      case 'light': add(out, 'Svjetla', 'Svjetlo (rasvjetno mjesto)', 'kom', 1); break
      case 'panel': add(out, 'Ostalo', ELEMENT_META.panel.label, 'kom', 1); break
      case 'relay': add(out, 'Releji', RELAY_MODELS[relayModelOf(e)].label, 'kom', 1); break
      case 'ledpsu': {
        const m = e.ledM ?? 5, w = e.ledWpm ?? 10
        add(out, 'LED', `LED traka ${e.ledV ?? 24} V COB (${w} W/m)`, 'm', m)
        add(out, 'LED', `Alu profil s difuzorom`, 'm', m)
        add(out, 'LED', `Napajanje ${e.ledV ?? 24} V ≥ ${Math.ceil((m * w * 1.2) / 10) * 10} W`, 'kom', 1)
        break
      }
    }
  }
  const order = ['Kabeli', 'Stezaljke', 'Doze i kutije', 'Utičnice', 'Prekidači', 'Dekorativno', 'Svjetla', 'Releji', 'LED', 'Ostalo']
  return [...out.values()]
    .map((l) => ({ ...l, qty: l.unit === 'm' ? Math.ceil(l.qty * 2) / 2 : l.qty }))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.item.localeCompare(b.item))
}
