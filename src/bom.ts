import { polylineLength } from './geometry'
import { allJunctions, boxSizeLabel } from './junction'
import { APPLIANCES, ELEMENT_META, RELAY_MODELS, SOCKET_KINDS, type Project, relayModelOf, hostedFront, modulesOf } from './types'
import { TEM_BLANK, TEM_FRAME, TEM_SOCKET, TEM_SWITCH, temCode } from './tem'
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
  // a single device on its own sits in a round Ø60 box with a 2M frame (a 1M device gets a blank beside it)
  const single = (depth: string, mods: number) => {
    add(out, 'Doze i kutije', `Doza Ø60${depth}`, 'kom', 1)
    add(out, 'Dekorativno', `${temCode(TEM_FRAME[2].frame)} · okvir LINE 2M`, 'kom', 1)
    add(out, 'Dekorativno', `${temCode(TEM_FRAME[2].carrier, false)} · ${TEM_FRAME[2].carrierName}`, 'kom', 1)
    if (mods < 2) add(out, 'Dekorativno', `${temCode(TEM_BLANK.code)} · ${TEM_BLANK.name}`, 'kom', 1)
  }
  // elements
  for (const e of p.elements) {
    if (!inScope(e.roomId)) continue
    const depth = e.depth === 'duboka' ? ', duboka' : ''
    switch (e.type) {
      case 'box': add(out, 'Doze i kutije', `Razvodna kutija ${sizes.get(e.id) ?? '10 × 10'}${depth}`, 'kom', 1); break
      case 'modbox': {
        const m = e.modules ?? 3
        add(out, 'Doze i kutije', `Doza modularna ${m}M${m === 3 ? ' (TEM PM3)' : m === 4 ? ' (TEM PM4)' : m === 7 ? (e.depth === 'duboka' ? ' (TEM PM7-65)' : ' (TEM PM7)') : ''}${depth}`, 'kom', 1)
        const f = TEM_FRAME[m]
        if (f) { add(out, 'Dekorativno', `${temCode(f.frame)} · okvir LINE ${m}M`, 'kom', 1); add(out, 'Dekorativno', `${temCode(f.carrier, false)} · ${f.carrierName}`, 'kom', 1) }
        else add(out, 'Dekorativno', `Nosač + okvir ${m}M`, 'kom', 1)
        // empty modules (gaps and the free end) get a blank
        const front = hostedFront(p.elements, e.id)
        const used = front.reduce((n, x) => n + (x.gapBefore ?? 0) + Math.max(1, modulesOf(x)), 0)
        const free = Math.max(0, m - used) + front.reduce((n, x) => n + (x.gapBefore ?? 0), 0)
        if (free > 0) add(out, 'Dekorativno', `${temCode(TEM_BLANK.code)} · ${TEM_BLANK.name}`, 'kom', free)
        break
      }
      case 'socket': {
        const kind = e.socketKind ?? 'schuko'
        const t = TEM_SOCKET[kind]
        if (!e.host) single(depth, SOCKET_KINDS[kind].modules)
        add(out, 'Utičnice', `${temCode(t.code)} · ${t.name}`, 'kom', 1)
        break
      }
      case 'switch': {
        const t = TEM_SWITCH[e.switchKind ?? 'obicni']
        const mods = e.modules ?? 1
        if (!e.host) single(depth, mods)
        if (t.code) add(out, 'Prekidači', `${temCode(t.code)} · ${t.name}${mods > 1 ? ` (s tipkom ${mods}M)` : ''}`, 'kom', 1)
        if (e.lamp) { add(out, 'Prekidači', 'Tipka s prozorčićem za indikator (ista serija)', 'kom', 1); add(out, 'Prekidači', 'IA20 · LED umetak 230 V za kontrolnu lampicu', 'kom', 1) }
        else add(out, 'Prekidači', `${temCode('SM10')} × 2 · ${t.name}`, 'kom', 1) // two SM10 side by side
        break
      }
      case 'light': add(out, 'Svjetla', 'Svjetlo (rasvjetno mjesto)', 'kom', 1); break
      case 'panel': add(out, 'Ostalo', ELEMENT_META.panel.label, 'kom', 1); break
      case 'boiler': add(out, 'Ostalo', 'Priključna kutija za bojler (izvod kabela, IP44)', 'kom', 1); break
      case 'appliance': add(out, 'Ostalo', `Priključna kutija s izvodom kabela (${APPLIANCES[e.appliance ?? 'hob'].label.toLowerCase()})`, 'kom', 1); break
      case 'kip':
        add(out, 'Ostalo', 'KIP kutija za izjednačenje potencijala sa sabirnicom', 'kom', 1)
        add(out, 'Ostalo', 'Križna spojnica FeZn/Cu + vijak M10 s mjedenom podloškom', 'kom', 1)
        add(out, 'Ostalo', 'Antikorozivna (bitumenska) traka za izlaz FeZn iz betona', 'kom', 1)
        break
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
