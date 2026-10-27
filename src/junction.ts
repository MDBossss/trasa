import { CABLE_ROLES, ELEMENT_META, RELAY_MODELS, SOCKET_KINDS, coreColors, isFeedConduit, APPLIANCES, isPlace, isData, dataKindOf, DATA_META, sectionOf, type Cable, type CableEnd, type CableRole, type Conduit, type Project, type Room, type WallElement, type WireColor, spareCoresOf, socket15Of, isControlCable, bundleSlots, suggestCables, cableStockOf, cableShort, rulesOf, frameSlots, frameName, relayModelOf, hostedFront, type ElementType } from './types'
import { wallExits } from './walls'

// Everything a box needs: which cables enter it, what each core goes to, which devices sit inside
// and which WAGO 221 connectors (or direct jumpers) that takes. Derived from the drawing, nothing is stored.
//
// Terminal ids ("signals"): L, N, PE, PARK, SW:<switch> (classic return), SW:<switch>:<k> (serijski),
// SW:L:<light> + PUT1/PUT2:<light>:<segment> (izmjenični / križni lanac), O:<relay>:<n> (relay output), I:<relay>:<i> (relay input).

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Level = 'ok' | 'warn' | 'err'
export type Role = Exclude<CableRole, 'auto'> | 'unknown'

export interface Wire { color: WireColor; terminal: string | null; note?: string }
export interface BoxCable {
  cable: Cable
  label: string
  sub: string
  role: Role
  side: Side
  order: number
  cores: WireColor[]
  wires: Wire[]
  far: { element?: WallElement; room?: Room; conduit?: Conduit; place?: WallElement }
}
export interface Device { el: WallElement; label: string; ports: string[]; wMm: number; hMm: number; kind: 'relay' | 'button' | 'socket' | 'terminal' }
export type TerminalWire =
  | { kind: 'core'; cableId: string; cableLabel: string; color: WireColor; note?: string }
  | { kind: 'port'; deviceId: string; deviceLabel: string; port: string; color: WireColor; note?: string }
export interface Terminal { id: string; label: string; desc: string; wago: 0 | 412 | 413 | 415; chained: number; wires: TerminalWire[]; cap?: boolean }
export interface Check { level: Level; text: string; cableId?: string }
export interface Junction { box: WallElement; room: Room; cables: BoxCable[]; devices: Device[]; terminals: Terminal[]; checks: Check[]; bom: { item: string; qty: number }[]; level: Level; size: { W: number; H: number; overflow: boolean; stacked: boolean }; boxSizes?: [number, number][] }

const LNPE = ['L', 'N', 'PE']
const otherEnd = (c: Cable, box: WallElement): CableEnd => (c.from.kind === 'element' && c.from.id === box.id ? c.to : c.from)
const isAtBox = (c: Cable, box: WallElement) => (c.from.kind === 'element' && c.from.id === box.id) || (c.to.kind === 'element' && c.to.id === box.id)
const el = (p: Project, id: string | undefined) => (id ? p.elements.find((e) => e.id === id) : undefined)

// Cables bound to a conduit's two exits are paired one-to-one: same cable type first, then drawing order,
// so several cables through one conduit each keep their own continuation.
const conduitPairCache = new WeakMap<Project, Map<string, Cable>>()
function conduitPairs(p: Project): Map<string, Cable> {
  const hit = conduitPairCache.get(p)
  if (hit) return hit
  const out = new Map<string, Cable>()
  const at = (cd: string, end: 'start' | 'end') => p.cables.filter((x) => [x.from, x.to].some((e) => e.kind === 'exit' && e.conduitId === cd && e.end === end))
  for (const cd of p.conduits) {
    const a = at(cd.id, 'start'), b = at(cd.id, 'end')
    const free = new Set(b)
    const bind = (x: Cable, y: Cable) => { out.set(`${x.id}@${cd.id}:start`, y); out.set(`${y.id}@${cd.id}:end`, x); free.delete(y) }
    const rest: Cable[] = []
    for (const x of a) { const y = [...free].find((y) => y.type === x.type && y.id !== x.id); if (y) bind(x, y); else rest.push(x) }
    for (const x of rest) { const y = [...free].find((y) => y.id !== x.id); if (y) bind(x, y) }
  }
  conduitPairCache.set(p, out)
  return out
}
// Follow a conduit from one of its exits to the cable bound to its other exit.
function throughConduit(p: Project, c: Cable, conduitId: string, end: 'start' | 'end') {
  const far = end === 'start' ? 'end' : 'start'
  const x = conduitPairs(p).get(`${c.id}@${conduitId}:${end}`)
  if (!x) return null
  const e = x.from.kind === 'exit' && x.from.conduitId === conduitId && x.from.end === far ? x.to : x.from
  return { cable: x, end: e }
}

// Cables meeting at a room corner are paired one-to-one across the two walls: closest heights first
// (within 30 cm), ties by drawing order, so two cables round the same corner each keep their own continuation.
const cornerPairCache = new WeakMap<Project, Map<string, Cable>>()
function cornerPairs(p: Project): Map<string, Cable> {
  const hit = cornerPairCache.get(p)
  if (hit) return hit
  const out = new Map<string, Cable>()
  const key = (c: Cable, corner: number) => `${c.id}@${corner}`
  const ends = p.cables.flatMap((c, i) => [c.from, c.to].filter((e): e is Extract<CableEnd, { kind: 'corner' }> => e.kind === 'corner').map((e) => ({ c, i, e })))
  const pairs: { a: typeof ends[number]; b: typeof ends[number]; dz: number }[] = []
  for (const a of ends) for (const b of ends) {
    if (a.i >= b.i || a.c.roomId !== b.c.roomId || a.c.wall === b.c.wall || a.e.corner !== b.e.corner) continue
    const dz = Math.abs(a.e.zM - b.e.zM)
    if (dz < 0.3) pairs.push({ a, b, dz })
  }
  pairs.sort((x, y) => x.dz - y.dz || x.a.i - y.a.i || x.b.i - y.b.i)
  for (const { a, b } of pairs) {
    if (out.has(key(a.c, a.e.corner)) || out.has(key(b.c, b.e.corner))) continue
    out.set(key(a.c, a.e.corner), b.c); out.set(key(b.c, b.e.corner), a.c)
  }
  cornerPairCache.set(p, out)
  return out
}
// The other wall's cable that continues from this corner, if one is paired with it.
export function cornerPartner(p: Project, c: Cable, corner: number): Cable | null { return cornerPairs(p).get(`${c.id}@${corner}`) ?? null }
function throughCorner(p: Project, c: Cable, end: Extract<CableEnd, { kind: 'corner' }>) {
  const x = cornerPartner(p, c, end.corner)
  if (!x) return null
  const mine = x.from.kind === 'corner' && x.from.corner === end.corner ? x.from : x.to
  return { cable: x, end: mine === x.from ? x.to : x.from }
}

// Follow a cable end through conduits and corners to what it finally lands on.
function follow(p: Project, c: Cable, end: CableEnd, hops = 0): { end: CableEnd; via: string[]; cable: Cable } {
  if (hops > 8) return { end, via: [], cable: c }
  if (end.kind === 'corner') {
    const t = throughCorner(p, c, end)
    if (!t) return { end, via: [], cable: c }
    const r = follow(p, t.cable, t.end, hops + 1)
    return { end: r.end, via: [`kut ${end.corner + 1}`, ...r.via], cable: r.cable }
  }
  if (end.kind === 'exit') {
    const cd = p.conduits.find((x) => x.id === end.conduitId)
    if (!cd || isFeedConduit(cd)) return { end, via: [], cable: c }
    const t = throughConduit(p, c, cd.id, end.end)
    if (!t) return { end, via: [cd.name], cable: c }
    const r = follow(p, t.cable, t.end, hops + 1)
    return { end: r.end, via: [cd.name, ...r.via], cable: r.cable }
  }
  return { end, via: [], cable: c }
}

function roleOfElement(e: WallElement): Role {
  switch (e.type) {
    case 'socket': return 'socket'
    case 'light': case 'ledpsu': return 'light'
    case 'motor': return 'motor'
    case 'kip': return 'earth'
    case 'boiler': return e.feedRelayId ? 'light' : 'socket'
    case 'appliance': return 'socket'
    case 'switch': return 'switch'
    case 'box': case 'modbox': return 'pass'
    case 'panel': return 'feed'
    default: return 'unknown'
  }
}

export function resolveCable(c: Cable, box: WallElement, p: Project): Omit<BoxCable, 'wires' | 'side' | 'order'> {
  const end = otherEnd(c, box)
  const cores = coreColors(c.type)
  let role: Role = 'unknown'
  let label = 'slobodan kraj'
  let far: BoxCable['far'] = {}
  const classify = (e: WallElement, cd?: Conduit) => {
    const target = e.host ? (el(p, e.host) ?? e) : e
    role = roleOfElement(target)
    const room = p.rooms.find((r) => r.id === target.roomId)
    far = { conduit: cd, element: target, room, place: isPlace(target) ? target : undefined }
    const name = `${target.label} ${ELEMENT_META[target.type].label.toLowerCase()}`
    label = cd ? `${cd.name} ${role === 'feed' ? '←' : '→'} ${target.label}${room && room.id !== box.roomId ? ` (${room.name})` : ''}` : name
  }
  const cd0 = end.kind === 'exit' ? p.conduits.find((x) => x.id === end.conduitId) : undefined
  if (cd0 && isFeedConduit(cd0)) { role = 'feed'; label = `${cd0.name} ← dolaz`; far = { conduit: cd0 } }
  else {
    const f = follow(p, c, end)
    const e = f.end.kind === 'element' ? el(p, f.end.id) : undefined
    if (e) {
      classify(e, cd0)
      if (!cd0 && f.via.length) label = `${f.via.join(' · ')} → ${e.label}`
    } else if (f.via.length) label = cores.length === 0 ? f.via.join(' · ') : `${f.via.join(' · ')} → ?`
    else if (end.kind === 'corner') label = `kut ${end.corner + 1} → ?`
    far = { ...far, conduit: cd0 }
  }
  if (cores.length === 0) role = 'lowv'
  if (c.role && c.role !== 'auto') role = c.role
  return { cable: c, label, sub: c.type, role, cores, far }
}

// A Plus 1 whose output drives a door control unit works as a dry contact (I/O), not as a phase switch.
export const pulseTarget = (relay: WallElement, p: Project) => p.elements.find((e) => e.type === 'motor' && e.feedRelayId === relay.id)
// The cable (all its segments) that brings a door unit its pulse: a separate control cable if there is one,
// else the first cable with two cores beside L N PE. Power then comes over the other cable.
export function pulseChain(motor: WallElement, p: Project): Set<string> {
  const at = p.cables.filter((c) => isAtBox(c, motor))
  const spare = (c: Cable) => coreColors(c.type).filter((k) => k !== 'brown' && k !== 'blue' && k !== 'gnye').length
  const pick = at.find((c) => isControlCable(c.type) && spare(c) >= 2) ?? at.find((c) => spare(c) >= 2)
  return new Set(pick ? chainCables(pick, p).map((c) => c.id) : [])
}

// Terminal id for the phase that feeds a light (relay output or classic switch return).
// A LED strip with its own controller (Plus RGBW PM on the 24 V side): the supply stays live, the controller switches.
const ledController = (led: WallElement, p: Project) => (led.type === 'ledpsu' ? p.elements.find((e) => e.host === led.id && e.type === 'relay' && RELAY_MODELS[relayModelOf(e)].dc) : undefined)
// a push button on a 24 V controller input is a low-voltage pair, no 230 V in its frame
const lowVoltSwitch = (sw: WallElement, p: Project) => { const r = sw.relayId ? el(p, sw.relayId) : undefined; return !!r && RELAY_MODELS[relayModelOf(r)].dc }
function lightTerminal(light: WallElement, p: Project): { id: string; by?: WallElement } {
  const ctl = ledController(light, p)
  if (ctl) return { id: 'L', by: ctl }
  if (light.feedRelayId) return { id: `O:${light.feedRelayId}:${light.feedOutput ?? 1}`, by: el(p, light.feedRelayId) }
  const sw = p.elements.filter((e) => e.type === 'switch' && !e.relayId && e.controls?.includes(light.id))
  if (!sw.length) return { id: `SW:?:${light.id}` }
  const kinds = sw.map((s) => s.switchKind ?? 'obicni')
  if (kinds.some((k) => k === 'izmjenicni' || k === 'krizni')) return { id: `SW:L:${light.id}`, by: sw[0] }
  const s = sw[0]
  if ((s.switchKind ?? 'obicni') === 'serijski') return { id: `SW:${s.id}:${s.controls!.indexOf(light.id)}`, by: s }
  return { id: `SW:${s.id}`, by: s }
}

// A control lamp in a switch shows the load's state: it hangs between the switched output and N.
// With a relay that is the relay output; on a classic one-way switch it is the switch's own return.
function lampOf(sw: WallElement, p: Project, checks: Check[]): string | null {
  if (!sw.lamp) return null
  if (sw.relayId) {
    const r = el(p, sw.relayId)
    if (!r) return null
    const m = RELAY_MODELS[relayModelOf(r)]
    if (m.dry && pulseTarget(r, p)) { checks.push({ level: 'warn', text: `${sw.label}: lampica ne može pokazati stanje vrata (relej daje samo impuls). Makni kvačicu ili koristi senzor vrata.` }); return null }
    if (m.outputs !== 1) { checks.push({ level: 'warn', text: `${sw.label}: lampica uz ${m.label} nije podržana (više izlaza).` }); return null }
    return `O:${r.id}:1`
  }
  const kind = sw.switchKind ?? 'obicni'
  if (kind === 'obicni') return `SW:${sw.id}`
  if (kind === 'serijski') return `SW:${sw.id}:0`
  checks.push({ level: 'warn', text: `${sw.label}: kontrolna lampica uz ${kind} prekidač traži dodatnu žilu od svjetla; aplikacija je zasad crta samo za obični prekidač ili tipkalo na releju.` })
  return null
}

// What a switch's conductors carry (cable cores or hosted-button ports): L in, returns out.
function switchSignals(sw: WallElement, p: Project, checks: Check[], usable: number): { terminal: string; note: string }[] {
  const kind = sw.switchKind ?? 'obicni'
  if (sw.relayId) {
    const r = el(p, sw.relayId)
    if (!r) checks.push({ level: 'err', text: `${sw.label}: relej više ne postoji.` })
    if (kind !== 'tipkalo') checks.push({ level: 'warn', text: `${sw.label} je ${kind} na releju: koristi tipkalo ili postavi relej u "toggle/edge" način.` })
    if (r && RELAY_MODELS[relayModelOf(r)].dc) { const n = sw.relayInput ?? 1; return [{ terminal: `SI:${sw.relayId}:${n}:1`, note: `na ${r.label} +24 V` }, { terminal: `SI:${sw.relayId}:${n}:2`, note: `na ${r.label} SW${n}` }] }
    if (r && RELAY_MODELS[relayModelOf(r)].swLow) return [{ terminal: `SI:${sw.relayId}:1:1`, note: `na ${r.label} S1` }, { terminal: `SI:${sw.relayId}:1:2`, note: `na ${r.label} S2` }]
    return [{ terminal: 'L', note: 'dovod' }, { terminal: `I:${sw.relayId}:${sw.relayInput ?? 1}`, note: `na ${r?.label ?? 'relej'} SW${sw.relayInput ?? 1}` }]
  }
  const lights = (sw.controls ?? []).map((id) => el(p, id)).filter((x): x is WallElement => !!x)
  if (!lights.length) checks.push({ level: 'warn', text: `Prekidač ${sw.label} ne pali nijedno svjetlo. Odaberi svjetla u svojstvima prekidača.` })
  if (kind === 'tipkalo') checks.push({ level: 'warn', text: `${sw.label} je tipkalo bez releja: radi kao obični prekidač. Postavi relej (R) u dozu i tipkalo na njegov ulaz.` })
  if (kind === 'obicni' || kind === 'tipkalo') return [{ terminal: 'L', note: 'dovod' }, { terminal: `SW:${sw.id}`, note: 'povratna' }]
  if (kind === 'serijski') {
    if (usable < 3) checks.push({ level: 'err', text: `Serijski prekidač ${sw.label} treba 3 žile bez PE (NYM-O 3×1,5 ili 5×1,5).` })
    if (lights.length < 2) checks.push({ level: 'warn', text: `Serijski prekidač ${sw.label} treba dva svjetla.` })
    return [{ terminal: 'L', note: 'dovod' }, { terminal: `SW:${sw.id}:0`, note: 'povratna 1' }, { terminal: `SW:${sw.id}:1`, note: 'povratna 2' }]
  }
  if (kind === 'izmjenicni' || kind === 'krizni') {
    // classic multi-way chain: a two-way switch at each end, intermediate (cross) switches between them;
    // pair i of travellers runs between chain[i] and chain[i+1], the last two-way returns the phase to the light
    const light = lights[0]
    const key = light?.id ?? sw.id
    const byLabel = (x: WallElement, y: WallElement) => x.label.localeCompare(y.label)
    const members = light ? p.elements.filter((e) => e.type === 'switch' && !e.relayId && (e.switchKind === 'izmjenicni' || e.switchKind === 'krizni') && e.controls?.includes(light.id)) : [sw]
    const ends = members.filter((e) => e.switchKind === 'izmjenicni').sort(byLabel)
    const mids = members.filter((e) => e.switchKind === 'krizni').sort(byLabel)
    const chain = [ends[0], ...mids, ...ends.slice(1)].filter((e): e is WallElement => !!e)
    const idx = chain.findIndex((e) => e.id === sw.id)
    const put = (n: 1 | 2, seg: number, note: string) => ({ terminal: `PUT${n}:${key}:${seg}`, note })
    if (kind === 'izmjenicni') {
      if (ends.length < 2) checks.push({ level: 'warn', text: `Izmjenični ${sw.label} nema par (drugi izmjenični koji pali isto svjetlo).` })
      if (usable < 3) checks.push({ level: 'err', text: `Izmjenični ${sw.label} treba 3 žile bez PE (NYM-O 3×1,5 ili 5×1,5).` })
      const isLast = ends.length > 1 && chain[chain.length - 1].id === sw.id
      const seg = isLast ? idx - 1 : idx
      return [isLast ? { terminal: `SW:L:${key}`, note: 'povratna → svjetlo' } : { terminal: 'L', note: 'dovod' }, put(1, seg, 'putna 1'), put(2, seg, 'putna 2')]
    }
    if (ends.length < 2) checks.push({ level: 'warn', text: `Križni ${sw.label} treba dva izmjenična na krajevima lanca (isto svjetlo).` })
    if (usable < 4) checks.push({ level: 'err', text: `Križni ${sw.label} treba 4 žile bez PE (5×1,5).` })
    return [put(1, idx - 1, 'putna 1 ulaz'), put(2, idx - 1, 'putna 2 ulaz'), put(1, idx, 'putna 1 izlaz'), put(2, idx, 'putna 2 izlaz')]
  }
  return []
}

function leafWires(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement, p: Project, checks: Check[]): Wire[] {
  const { cores, role } = bc
  const park = (c: WireColor, note = 'rezerva'): Wire => ({ color: c, terminal: 'PARK', note })
  const lnpe = (c: WireColor): Wire => (c === 'brown' ? { color: c, terminal: 'L' } : c === 'blue' ? { color: c, terminal: 'N' } : c === 'gnye' ? { color: c, terminal: 'PE' } : park(c))
  if (role === 'lowv') {
    const dk = dataKindOf(bc.cable.type)
    if (dk === 'rj45' || dk === 'tv') {
      // the n-th UTP (coax) cable in a frame lands on its n-th RJ45 (TV) module; drawn as one wire
      const meta = DATA_META[dk]
      const keystones = hostedFront(p.elements, box.id).filter((e) => isData(e) && e.socketKind === dk)
      const i = p.cables.filter((c) => isAtBox(c, box) && dataKindOf(c.type) === dk).findIndex((c) => c.id === bc.cable.id)
      const k = keystones[i]
      if (k) return [{ color: 'other', terminal: `DATA:${k.id}`, note: meta.wire }]
      if (box.type === 'modbox') checks.push({ cableId: bc.cable.id, level: 'warn', text: `${bc.label}: ${meta.port} kabel u dozi bez slobodnog modula; dodaj utičnicu vrste ${SOCKET_KINDS[dk].label}.` })
      return [{ color: 'other', terminal: null, note: `${meta.port}, prolazi` }]
    }
    return cores.map((c) => ({ color: c, terminal: null, note: 'slaba struja, prolazi' }))
  }
  if (role === 'unknown') { checks.push({ cableId: bc.cable.id, level: 'warn', text: `${bc.label}: ne znam što je na drugom kraju kabela ${bc.sub}, žile parkirane.` }); return cores.map((c) => park(c, 'nepoznato')) }
  if (role === 'feed' || role === 'socket' || role === 'pass' || role === 'earth') return cores.map(lnpe)
  if (role === 'motor') {
    // L N PE feed the control unit; the next two cores are the pulse loop from the relay's I and O
    const m = bc.far.element
    const relay = m?.feedRelayId ? el(p, m.feedRelayId) : undefined
    if (m && !relay) checks.push({ level: 'warn', text: `Vrata ${m.label}: nitko ih ne pali. Odaberi relej (Shelly Plus 1) pod "Pali ga relej".` })
    const spare = cores.filter((c) => c !== 'brown' && c !== 'blue' && c !== 'gnye')
    const pulse = m ? pulseChain(m, p) : new Set<string>()
    if (m && relay && !pulse.size) checks.push({ cableId: bc.cable.id, level: 'err', text: `Kabel do ${m.label} (${bc.sub}) nema 2 slobodne žile za impuls: uzmi 5×1,5 ili dodaj upravljački 2×0,75.` })
    const carries = pulse.has(bc.cable.id)
    return cores.map((c) => {
      if (c === 'brown' || c === 'blue' || c === 'gnye') return lnpe(c)
      const k = spare.indexOf(c)
      return relay && carries && k < 2 ? { color: c, terminal: `IMP:${relay.id}:${k + 1}`, note: `impuls ${k + 1}` } : park(c)
    })
  }
  if (role === 'light') {
    const light = bc.far.element
    const t = light ? lightTerminal(light, p) : { id: 'SW:?' }
    if (light && !t.by) checks.push({ level: 'warn', text: `Svjetlo ${light.label} nitko ne pali. Označi ga na prekidaču ("Pali svjetla") ili mu odaberi relej ("Napaja ga").` })
    const ctl = light ? ledController(light, p) : undefined
    if (ctl) {
      // supply always live; the spare cores carry the low-voltage button pairs from this frame to the controller
      const sig = devicesIn(box, p).filter((d) => d.el.type === 'switch' && d.el.relayId === ctl.id).flatMap((d) => switchSignals(d.el, p, [], Infinity))
      const spare: WireColor[] = cores.filter((c) => c !== 'brown' && c !== 'blue' && c !== 'gnye')
      if (sig.length > spare.length) checks.push({ cableId: bc.cable.id, level: 'err', text: `Kabel do ${light!.label} (${bc.sub}) treba ${sig.length} žile za tipkala na ${ctl.label}, ima ${spare.length} slobodnih: dodaj upravljački 2×0,75 ili UTP.` })
      return cores.map((c) => { if (c === 'brown') return { color: c, terminal: 'L', note: 'napajanje, stalno' }; const i = spare.indexOf(c); return i >= 0 && i < sig.length ? { color: c, terminal: sig[i].terminal, note: `tipkalo, 24 V (${sig[i].note})` } : lnpe(c) })
    }
    return cores.map((c) => (c === 'brown' ? { color: c, terminal: t.id, note: 'L svjetla' } : lnpe(c)))
  }
  const sw = bc.far.element
  if (!sw) return cores.map((c) => park(c, 'nepoznato'))
  const lamp = lampOf(sw, p, checks)
  const usable = cores.filter((c) => c !== 'gnye' && !(lamp && c === 'blue'))
  const sig = [...switchSignals(sw, p, checks, usable.length), ...(lamp ? [{ terminal: lamp, note: 'kontrolna lampica' }] : [])]
  if (lamp && !cores.includes('blue')) checks.push({ cableId: bc.cable.id, level: 'err', text: `${sw.label}: kontrolna lampica treba nulu, a kabel ${bc.sub} nema plavu žilu.` })
  if (lamp && usable.length < sig.length) checks.push({ level: 'err', text: `${sw.label}: s kontrolnom lampicom kabel treba ${sig.length + 2} žile (${sig.length} + N + PE), ima ${cores.length}. Uzmi ${sig.length + 2 <= 5 ? '5×1,5' : '7×1,5'}.` })
  if (!sig.length) return cores.map((c) => ({ color: c, terminal: null, note: 'prolazi do drugog prekidača' }))
  return cores.map((c) => {
    if (c === 'gnye') return { color: c, terminal: 'PE', note: 'prekidač nema PE: u dozi presavij i izoliraj' }
    if (lamp && c === 'blue') return { color: c, terminal: 'N', note: 'nula za kontrolnu lampicu' }
    const s = sig[usable.indexOf(c)]
    if (!s) return park(c)
    return { color: c, terminal: s.terminal, note: [s.note, c === 'blue' && s.terminal !== 'L' ? 'plava označena kao povratna' : ''].filter(Boolean).join(', ') }
  })
}

// Which side of the box a cable enters: the side the far end lies on, seen from the box on the wall
// (a conduit to the left enters left, a frame below enters from below); ties go to top/bottom.
function sideOf(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement, p: Project): { side: Side; order: number } {
  const end = otherEnd(bc.cable, box)
  const room = p.rooms.find((r) => r.id === box.roomId)
  const wall = room ? wallExits(room, p.conduits, p.pxPerMeter ?? 100)[box.wall] : undefined
  let far: { xM: number; zM: number } | null = null
  if (end.kind === 'exit') {
    const ex = wall?.exits.find((x) => x.conduit.id === end.conduitId && x.end === end.end)
    if (!ex) return { side: 'top', order: bc.far.conduit ? bc.far.conduit.points[0].x : 0 }
    far = { xM: ex.posM, zM: ex.zM ?? p.ceilingM }
  } else if (end.kind === 'free') far = { xM: end.xM, zM: end.zM }
  else if (end.kind === 'corner') far = { xM: end.corner === box.wall ? 0 : (wall?.lengthM ?? box.xM + 1), zM: end.zM }
  else {
    const e = bc.far.element
    if (!e || e.roomId !== box.roomId || e.wall !== box.wall) return { side: 'top', order: 0 }
    far = { xM: e.xM, zM: e.zM }
  }
  const dx = far.xM - box.xM, dz = far.zM - box.zM
  if (Math.abs(dz) >= Math.abs(dx)) return { side: dz > 0 ? 'top' : 'bottom', order: far.xM }
  return { side: dx < 0 ? 'left' : 'right', order: -far.zM }
}

// Devices sitting inside a place: relays and buttons with host = place.
export function devicesIn(place: WallElement, p: Project): Device[] {
  // front elements in their frame order (left → right), relays after them
  return [...hostedFront(p.elements, place.id).filter((e) => e.type === 'switch' || e.type === 'socket'), ...p.elements.filter((e) => e.host === place.id && e.type === 'relay')]
    .map((e) => {
      if (e.type === 'relay') {
        const m = RELAY_MODELS[relayModelOf(e)]
        return { el: e, label: `${e.label} ${m.label}`, ports: m.ports, wMm: Math.max(37, m.ports.length * 7), hMm: 14, kind: 'relay' as const }
      }
      if (isData(e)) { const m = DATA_META[e.socketKind as 'rj45' | 'tv']; return { el: e, label: `${e.label} ${m.name}`, ports: [m.port], wMm: 14, hMm: 18, kind: 'socket' as const } }
      if (e.type === 'socket') { const k = SOCKET_KINDS[e.socketKind ?? 'schuko']; return { el: e, label: `${e.label} ${k.label.toLowerCase()} utičnica`, ports: ['L', 'N', 'PE', 'L′', 'N′', 'PE′'], wMm: Math.max(24, k.modules * 11), hMm: 18, kind: 'socket' as const } }
      return { el: e, label: `${e.label} ${(e.switchKind ?? 'obicni') === 'tipkalo' ? 'tipkalo' : 'prekidač'}${(e.modules ?? 1) > 1 ? ` ${e.modules}M` : ''}`, ports: [...['1', '2', '3', '4'].slice(0, e.switchKind === 'krizni' ? 4 : (e.switchKind === 'serijski' || e.switchKind === 'izmjenicni') ? 3 : 2), ...(e.lamp ? ['X1', 'X2'] : [])], wMm: Math.max(14, (e.modules ?? 1) * 11), hMm: 18, kind: 'button' as const }
    })
}

type PortMember = { port: string; terminal: string; color: WireColor; note?: string }
function devicePorts(d: Device, p: Project, checks: Check[]): PortMember[] {
  const out: PortMember[] = []
  if (d.kind === 'relay') {
    const m = RELAY_MODELS[relayModelOf(d.el)]
    out.push({ port: 'L', terminal: 'L', color: 'brown' })
    if (m.needsN) out.push({ port: 'N', terminal: 'N', color: 'blue' })
    if (m.dc) return out
    if (m.swLow) {
      // Sonoff: the button is a low-voltage pair on S1/S2, the light's phase leaves on Lout (Nout stays unused here)
      out.push({ port: 'S1', terminal: `SI:${d.el.id}:1:1`, color: 'black', note: 'tipkalo, niski napon' })
      out.push({ port: 'S2', terminal: `SI:${d.el.id}:1:2`, color: 'grey', note: 'tipkalo, niski napon' })
      out.push({ port: 'Lout', terminal: `O:${d.el.id}:1`, color: 'black', note: 'izlaz 1' })
      return out
    }
    for (let i = 1; i <= m.inputs; i++) out.push({ port: `SW${i}`, terminal: `I:${d.el.id}:${i}`, color: 'black', note: `ulaz ${i}` })
    if (m.dry) {
      const motor = pulseTarget(d.el, p)
      if (motor) {
        // dry contact: I and O go straight to the door unit's pulse input, no phase on them
        out.push({ port: 'I', terminal: `IMP:${d.el.id}:1`, color: 'black', note: `impuls za ${motor.label}` })
        out.push({ port: 'O', terminal: `IMP:${d.el.id}:2`, color: 'grey', note: `impuls za ${motor.label}` })
        return out
      }
      // phase switching: a short jumper bridges L to I on the device
      out.push({ port: 'L', terminal: `JMP:${d.el.id}`, color: 'brown', note: 'premosnica L → I' })
      out.push({ port: 'I', terminal: `JMP:${d.el.id}`, color: 'brown' })
    }
    for (let n = 1; n <= m.outputs; n++) out.push({ port: m.outputs === 1 ? 'O' : `O${n}`, terminal: `O:${d.el.id}:${n}`, color: 'black', note: `izlaz ${n}` })
    return out
  }
  if (isData(d.el)) { const m = DATA_META[d.el.socketKind as 'rj45' | 'tv']; return [{ port: m.port, terminal: `DATA:${d.el.id}`, color: 'other', note: m.wire }] }
  if (d.kind === 'socket') {
    // sockets have double terminals per pole: the first one hangs on L/N/PE, the next ones loop from the previous socket
    const chain = hostedFront(p.elements, d.el.host!).filter((e) => e.type === 'socket' && !isData(e))
    const i = chain.findIndex((e) => e.id === d.el.id)
    const prev = i > 0 ? chain[i - 1] : null
    const inT = (pole: string) => (prev ? `CH:${pole}:${prev.id}` : pole)
    const out: PortMember[] = [{ port: 'L', terminal: inT('L'), color: 'brown', note: prev ? `s ${prev.label}` : undefined }, { port: 'N', terminal: inT('N'), color: 'blue', note: prev ? `s ${prev.label}` : undefined }, { port: 'PE', terminal: inT('PE'), color: 'gnye', note: prev ? `s ${prev.label}` : undefined }]
    if (i < chain.length - 1) { const nx = chain[i + 1]; for (const pole of ['L', 'N', 'PE'] as const) out.push({ port: `${pole}′`, terminal: `CH:${pole}:${d.el.id}`, color: pole === 'L' ? 'brown' : pole === 'N' ? 'blue' : 'gnye', note: `dalje na ${nx.label}` }) }
    return out
  }
  // a hosted switch has no cable of its own: the frame's cables are checked by crossWires, so no core limit here
  const sig = switchSignals(d.el, p, checks, Infinity)
  if (!sig.length) return out
  const ports: PortMember[] = sig.map((s, i) => ({ port: `${i + 1}`, terminal: s.terminal, color: i === 0 && s.terminal === 'L' ? 'brown' : 'black', note: s.note }))
  const lamp = lampOf(d.el, p, checks)
  if (lamp) ports.push({ port: 'X1', terminal: lamp, color: 'black', note: 'kontrolna lampica' }, { port: 'X2', terminal: 'N', color: 'blue', note: 'kontrolna lampica, nula' })
  return ports
}

// Signals a place needs on its own (leaf cables + devices), without place-to-place cables.
function localSignals(place: WallElement, p: Project): Set<string> {
  const out = new Set<string>()
  const sink: Check[] = []
  for (const c of p.cables.filter((x) => isAtBox(x, place))) {
    const r = resolveCable(c, place, p)
    if (r.far.place && r.role !== 'feed') continue
    for (const w of leafWires(r, place, p, sink)) if (w.terminal && w.terminal !== 'PARK') out.add(w.terminal)
  }
  for (const d of devicesIn(place, p)) for (const m of devicePorts(d, p, sink)) out.add(m.terminal)
  return out
}

// Signals a place-to-place cable must carry: L N PE plus whatever both sides want.
// Both ends of a cable resolved to elements (through conduits / corners), hosted elements mapped to their host.
// All segments of one physical cable (corner and conduit continuations), this one included.
export function chainCables(c: Cable, p: Project): Cable[] {
  const seen = new Map<string, Cable>([[c.id, c]])
  const walk = (x: Cable, end: CableEnd, hops: number) => {
    if (hops > 8) return
    let t: { cable: Cable; end: CableEnd } | null = null
    if (end.kind === 'corner') t = throughCorner(p, x, end)
    else if (end.kind === 'exit') { const cd = p.conduits.find((k) => k.id === end.conduitId); if (cd && !isFeedConduit(cd)) t = throughConduit(p, x, cd.id, end.end) }
    if (!t || seen.has(t.cable.id)) return
    seen.set(t.cable.id, t.cable); walk(t.cable, t.end, hops + 1)
  }
  walk(c, c.from, 0); walk(c, c.to, 0)
  return [...seen.values()]
}
// The thinnest segment of the chain: the signals a chain can carry are limited by it.
export const thinnest = (c: Cable, p: Project) => chainCables(c, p).sort((a, b) => coreColors(a.type).length - coreColors(b.type).length)[0]

export function cableEnds(c: Cable, p: Project): (WallElement | undefined)[] {
  return [c.from, c.to].map((e) => { const f = follow(p, c, e).end; const el0 = f.kind === 'element' ? el(p, f.id) : undefined; return el0?.host ? el(p, el0.host) : el0 })
}
// Which places a cable joins (both ends resolved through conduits / corners / hosted elements).
export function cablePlaces(c: Cable, p: Project): [WallElement, WallElement] | null {
  const ends = [c.from, c.to].map((e) => { const f = follow(p, c, e).end; return f.kind === 'element' ? el(p, f.id) : undefined })
  const places = ends.map((e) => (e?.host ? el(p, e.host) : e)).filter((e): e is WallElement => !!e && isPlace(e))
  return places.length === 2 && places[0].id !== places[1].id ? [places[0], places[1]] : null
}

// Which cables carry which extra signal: for every signal wanted in two or more places, the cables on the
// shortest paths joining those places (first place as root). Rings of boxes therefore do not duplicate signals.
const carriersCache = new WeakMap<Project, Map<string, Set<string>>>()
function signalCarriers(p: Project): Map<string, Set<string>> {
  const hit = carriersCache.get(p)
  if (hit) return hit
  const places = p.elements.filter(isPlace)
  // one edge per physical cable: a chain of corner segments is one cable, and every segment carries the same signals
  const chainOf = new Map<string, string[]>()
  const adj = new Map<string, { to: string; cable: string }[]>()
  for (const c of p.cables) {
    if (chainOf.has(c.id)) continue
    const ids = chainCables(c, p).map((x) => x.id)
    for (const id of ids) chainOf.set(id, ids)
    const pl = cablePlaces(c, p)
    if (!pl) continue
    adj.set(pl[0].id, [...(adj.get(pl[0].id) ?? []), { to: pl[1].id, cable: c.id }])
    adj.set(pl[1].id, [...(adj.get(pl[1].id) ?? []), { to: pl[0].id, cable: c.id }])
  }
  const wants = new Map<string, string[]>()
  for (const pl of places) for (const sgn of localSignals(pl, p)) if (!LNPE.includes(sgn)) wants.set(sgn, [...(wants.get(sgn) ?? []), pl.id])
  const out = new Map<string, Set<string>>()
  const bundleIds = (cable: string) => bundleMembers(cable, p).flatMap((m) => m.ids)
  for (const [sgn, ids] of wants) {
    if (ids.length < 2) continue
    // BFS from the first place; parent links give the path to every other place that wants the signal
    const parent = new Map<string, { from: string; cable: string } | null>([[ids[0], null]])
    const queue = [ids[0]]
    while (queue.length) { const cur = queue.shift()!; for (const e of adj.get(cur) ?? []) if (!parent.has(e.to)) { parent.set(e.to, { from: cur, cable: e.cable }); queue.push(e.to) } }
    for (const id of ids.slice(1)) {
      let cur = id
      while (parent.get(cur)) { const st = parent.get(cur)!; for (const id of bundleIds(st.cable)) { if (!out.has(id)) out.set(id, new Set()); out.get(id)!.add(sgn) } cur = st.from }
    }
  }
  carriersCache.set(p, out)
  return out
}

// Signals a place-to-place cable must carry: L N PE plus the extra signals routed over it.
export function crossSignals(a: WallElement, b: WallElement, p: Project, cableId?: string): string[] {
  if (!cableId) { const sa = localSignals(a, p), sb = localSignals(b, p); return [...LNPE, ...[...sa].filter((s) => sb.has(s) && !LNPE.includes(s)).sort()] }
  return [...LNPE.filter((s) => s !== 'N' || !noNeutral(p).has(cableId)), ...[...(signalCarriers(p).get(cableId) ?? [])].sort()]
}

// Cables that need no N (only with the neutralEverywhere rule off): everything on one side of the cable (reached without it) wants no neutral, e.g. a drop
// to a frame of plain switches. Such a cable carries L PE and returns, and blue may be one of them.
const noNCache = new WeakMap<Project, Set<string>>()
export function noNeutral(p: Project): Set<string> {
  const hit = noNCache.get(p)
  if (hit) return hit
  if (rulesOf(p).neutralEverywhere) { const none = new Set<string>(); noNCache.set(p, none); return none }
  const adj = new Map<string, { to: string; bundle: string }[]>()
  const bundles = new Map<string, string[]>()
  for (const c of p.cables) {
    const pl = cablePlaces(c, p)
    const ids = bundleMembers(c.id, p).flatMap((m) => m.ids)
    if (!pl || !ids.length || bundles.has(ids[0])) continue
    bundles.set(ids[0], ids)
    adj.set(pl[0].id, [...(adj.get(pl[0].id) ?? []), { to: pl[1].id, bundle: ids[0] }])
    adj.set(pl[1].id, [...(adj.get(pl[1].id) ?? []), { to: pl[0].id, bundle: ids[0] }])
  }
  const wantsN = new Map<string, boolean>()
  const wants = (id: string) => { if (!wantsN.has(id)) { const e = p.elements.find((x) => x.id === id); wantsN.set(id, !!e && localSignals(e, p).has('N')) } return wantsN.get(id)! }
  const out = new Set<string>()
  for (const [key, ids] of bundles) {
    const pl = cablePlaces(p.cables.find((c) => c.id === ids[0])!, p)!
    // flood each side without crossing this bundle; a side that loops back to the other end is not a dead end
    const side = (start: string, other: string) => {
      const seen = new Set([start]), queue = [start]
      while (queue.length) { const cur = queue.shift()!; if (cur === other || wants(cur)) return true; for (const e of adj.get(cur) ?? []) if (e.bundle !== key && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to) } }
      return false
    }
    if (!side(pl[0].id, pl[1].id) || !side(pl[1].id, pl[0].id)) for (const id of ids) out.add(id)
  }
  noNCache.set(p, out)
  return out
}

// Cables joining the same two places form one bundle (e.g. 5×1,5 + 3×1,5 instead of a 7-core cable).
// Members are whole physical cables (corner / conduit segments together), the thickest first: it carries L N PE.
export interface BundleMember { ids: string[]; type: string; first: Cable }
const bundleCache = new WeakMap<Project, Map<string, BundleMember[]>>()
export function bundleMembers(cableId: string, p: Project): BundleMember[] {
  let byCable = bundleCache.get(p)
  if (!byCable) {
    byCable = new Map()
    const groups = new Map<string, BundleMember[]>()
    const seen = new Set<string>()
    for (const c of p.cables) {
      if (seen.has(c.id)) continue
      const chain = chainCables(c, p)
      chain.forEach((x) => seen.add(x.id))
      const pl = cablePlaces(c, p)
      const m: BundleMember = { ids: chain.map((x) => x.id), type: thinnest(c, p).type, first: c }
      const key = pl ? [pl[0].id, pl[1].id].sort().join('|') : `solo:${c.id}`
      groups.set(key, [...(groups.get(key) ?? []), m])
    }
    for (const ms of groups.values()) {
      ms.sort((a, b) => sectionOf(b.type) - sectionOf(a.type) || coreColors(b.type).length - coreColors(a.type).length || p.cables.indexOf(a.first) - p.cables.indexOf(b.first))
      for (const m of ms) for (const id of m.ids) byCable.set(id, ms)
    }
    bundleCache.set(p, byCable)
  }
  return byCable.get(cableId) ?? []
}

// Which signal each core of a cable carries, spread over its bundle: the first member takes L N PE and its spares,
// a further member keeps PE on green-yellow, leaves blue unused and carries signals on every other core — unless
// the rules let blue (and green-yellow) carry a return too.
export interface CableLoad { signals: string[]; core: Map<WireColor, string | null>; missing: string[]; members: string[] }
const loadCache = new WeakMap<Project, Map<string, CableLoad>>()
export function cableLoad(cableId: string, a: WallElement, b: WallElement, p: Project): CableLoad {
  let cache = loadCache.get(p)
  if (!cache) { cache = new Map(); loadCache.set(p, cache) }
  const hit = cache.get(cableId)
  if (hit) return hit
  const members = bundleMembers(cableId, p)
  const signals = crossSignals(a, b, p, cableId)
  const extras = signals.filter((x) => !LNPE.includes(x))
  const blueOk = rulesOf(p).blueReturn
  const gnyeOk = rulesOf(p).gnyeReturn
  let k = 0
  const loads = members.map((m, i) => {
    const core = new Map<WireColor, string | null>()
    for (const c of coreColors(m.type)) {
      if (c === 'gnye' && (i === 0 || !gnyeOk || k >= extras.length)) core.set(c, 'PE')
      else if (c === 'blue' && i === 0 && signals.includes('N')) core.set(c, 'N')
      else if (c === 'blue' && !blueOk) core.set(c, null)
      else if (c === 'brown' && i === 0) core.set(c, 'L')
      else core.set(c, extras[k++] ?? null)
    }
    return core
  })
  const missing = extras.slice(k)
  members.forEach((m, i) => { const l: CableLoad = { signals, core: loads[i], missing, members: members.map((x) => x.type) }; for (const id of m.ids) cache!.set(id, l) })
  return cache.get(cableId) ?? { signals, core: new Map(), missing, members: [] }
}

export interface CableNeeds { signals: string[]; needed: number; has: number; suggest: string; fix: string[] | null; rows: { color: WireColor; sig: string | null }[]; missing: string[]; members: string[]; places: [WallElement, WallElement] }
export function cableNeeds(c: Cable, p: Project): CableNeeds | null {
  const places = cablePlaces(c, p)
  if (!places) return null
  const load = cableLoad(c.id, places[0], places[1], p)
  const needed = load.signals.length
  const blue = rulesOf(p).blueReturn
  const gnye = rulesOf(p).gnyeReturn
  const noN = !load.signals.includes('N')
  const has = bundleSlots(load.members, blue, gnye, noN)
  const first = bundleMembers(c.id, p)[0]?.first ?? c
  const heavy = load.signals.some((s) => heavyOutput(s, p))
  const fix = suggestCables(needed, Math.max(minSectionFor(first, p), sectionOf(load.members[0] ?? c.type)), cableStockOf(p), heavy ? 2.5 : 1.5, blue, gnye, noN)
  const suggest = fix ? fix.map(cableShort).join(' + ') : `${needed} žila`
  const rows = coreColors(thinnest(c, p).type).map((color) => ({ color, sig: load.core.get(color) ?? null }))
  return { signals: load.signals, needed, has, suggest, fix, rows, missing: load.missing, members: load.members, places: [places[0], places[1]] }
}

function crossWires(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement, p: Project, checks: Check[]): Wire[] {
  const far = bc.far.place!
  const load = cableLoad(bc.cable.id, box, far, p)
  // a bundle reports once, from its first cable
  if (load.missing.length && bundleMembers(bc.cable.id, p)[0]?.ids.includes(bc.cable.id) !== false) {
    const need = cableNeeds(bc.cable, p)
    const what = load.members.length > 1 ? `Kabeli ${bc.label} (${load.members.map(cableShort).join(' + ')})` : `Kabel ${bc.label}`
    const thin = thinnest(bc.cable, p)
    const where = thin.id !== bc.cable.id ? ` Nastavak na zidu ${thin.wall + 1} je ${thin.type}.` : ''
    checks.push({ cableId: bc.cable.id, level: 'err', text: `${what} treba${load.members.length > 1 ? 'ju' : ''} ${load.signals.length} žila (${load.signals.map((s) => terminalMeta(s, p).label).join(', ')}), nema mjesta za ${load.missing.map((s) => terminalMeta(s, p).label).join(', ')}.${where} Rješenje: ${need?.suggest ?? 'deblji kabel'}.` })
  }
  return bc.cores.map((c) => {
    const s = load.core.get(c)
    if (s === 'L' || s === 'N' || s === 'PE') return { color: c, terminal: s }
    if (s && c === 'blue') return { color: c, terminal: s, note: `${terminalMeta(s, p).desc} · plava kao povratna: označi smeđom ili crnom trakom na oba kraja` }
    if (s && c === 'gnye') return { color: c, terminal: s, note: `${terminalMeta(s, p).desc} · žuto-zelena kao povratna: označi smeđom ili crnom trakom na oba kraja` }
    return s ? { color: c, terminal: s, note: terminalMeta(s, p).desc } : { color: c, terminal: 'PARK', note: load.members.length > 1 && c === 'blue' ? 'drugi kabel: plava se ne koristi' : 'rezerva' }
  })
}

export function terminalMeta(id: string, p: Project): { label: string; desc: string } {
  if (id === 'L') return { label: 'L', desc: 'faza' }
  if (id === 'N') return { label: 'N', desc: 'nula' }
  if (id.startsWith('L@') || id.startsWith('N@')) { const name = circuitsOf(p).names.get(id.slice(2)) ?? 'krug'; return { label: id[0], desc: `${id[0] === 'L' ? 'faza' : 'nula'} · ${name}` } }
  if (id === 'PE') return { label: 'PE', desc: 'zaštitni' }
  if (id === 'V+' || id === 'V-') return { label: id === 'V+' ? 'V+' : 'V−', desc: `24 V iz napajanja → trake (${id === 'V+' ? 'plus' : 'minus'})` }
  if (id.startsWith('SI:') && el(p, id.split(':')[1]) && RELAY_MODELS[relayModelOf(el(p, id.split(':')[1])!)].dc) { const [, rid, n, k] = id.split(':'); return { label: k === '1' ? '+24' : `SW${n}`, desc: `tipkalo → ${el(p, rid)?.label ?? ''} ${k === '1' ? '+24 V' : `SW${n}`}, 24 V` } }
  if (id.startsWith('SI:')) { const [, rid, , k] = id.split(':'); return { label: `S${k}`, desc: `tipkalo → ${el(p, rid)?.label ?? ''} S${k}, niski napon` } }
  if (id.startsWith('JMP:')) return { label: 'L→I', desc: 'premosnica na Shellyju (pali fazom)' }
  if (id.startsWith('IMP:')) { const [, rid, n] = id.split(':'); return { label: `IMP${n}`, desc: `impuls ${el(p, rid)?.label ?? ''}: suhi kontakt, bez napona` } }
  if (id.startsWith('DATA:') || id === 'UTP' || id === 'ANT') { const e = el(p, id.split(':')[1] ?? ''); const tv = id === 'ANT' || e?.socketKind === 'tv'; return { label: tv ? 'ANT' : 'UTP', desc: tv ? `antena → ${e?.label ?? 'TV'} F-konektor` : `internet → ${e?.label ?? 'RJ45'} keystone` } }
  if (id.startsWith('PARK')) return spareCoresOf(p) === 'cap' ? { label: '·', desc: 'rezerva' } : { label: '·', desc: 'parkirano' }
  const [kind, a, b] = id.split(':')
  if (kind === 'CH') return { label: a, desc: `provlačenje ${el(p, b)?.label ?? ''} → sljedeća utičnica` }
  if (kind === 'PUT1' || kind === 'PUT2') { const seg = +(b ?? 0); return { label: `${kind === 'PUT1' ? 'p1' : 'p2'}${"′".repeat(seg)}`, desc: `putna ${kind.slice(-1)}${seg ? ` · dionica ${seg + 1}` : ''} · ${el(p, a)?.label ?? '?'}` } }
  if (kind === 'O') { const r = el(p, a); const lights = p.elements.filter((e) => e.feedRelayId === a && (e.feedOutput ?? 1) === +b); return { label: lights.map((l) => l.label).join('+') || `O${b}`, desc: `${r?.label ?? 'relej'} izlaz ${b} → ${lights.some((l) => l.type === 'boiler') ? 'bojler' : lights.some((l) => l.type === 'ledpsu') ? 'LED' : 'svjetlo'}` } }
  if (kind === 'I') { const r = el(p, a); return { label: `SW${b}`, desc: `${r?.label ?? 'relej'} ulaz ${b} ← tipkalo` } }
  if (a === '?') return { label: '?', desc: `${el(p, b)?.label ?? 'svjetlo'} bez prekidača` }
  if (a === 'L') return { label: el(p, b)?.label ?? 'S', desc: 'povratna → svjetlo' }
  const sw = el(p, a)
  const lights = (sw?.controls ?? []).map((x) => el(p, x)?.label).filter(Boolean)
  const lbl = b !== undefined ? (el(p, sw?.controls?.[+b] ?? '')?.label ?? `S${+b + 1}`) : lights.join('+') || 'S'
  return { label: lbl, desc: `povratna ${sw?.label ?? ''} → svjetlo` }
}

// fitting order: feed first, then what it feeds
const ROLE_ORDER: Role[] = ['feed', 'pass', 'socket', 'light', 'motor', 'switch', 'lowv', 'earth', 'unknown']
const SIDE_ORDER: Side[] = ['top', 'right', 'bottom', 'left']
// loop-through terminals follow the socket order in the frame, L N PE per socket
const chainPos = (id: string, p: Project) => (id.startsWith('CH:') ? p.elements.findIndex((e) => e.id === id.split(':')[2]) * 3 + ['L', 'N', 'PE'].indexOf(id.split(':')[1]) : 0)
const ORDER = (id: string) => (id.startsWith('DATA:') ? 9 : baseId(id) === 'L' ? 0 : baseId(id) === 'N' ? 1 : id === 'PE' ? 2 : id.startsWith('O:') ? 3 : id.startsWith('SW') ? 4 : id.startsWith('I:') ? 5 : id.startsWith('PUT') ? 6 : id.startsWith('CH:') ? 7 : 8)

// Flush junction boxes sold in Croatia (Knauf/Terma, Vimar at Ellabo, Legrand at Gromel), smallest first: inner size in mm,
// retail label (outer size) and number of cable entries. The box grows along this ladder before a split is suggested.
export const BOX_CATALOG: { w: number; h: number; label: string; entries: number; note?: string }[] = [
  { w: 90, h: 90, label: '10 × 10', entries: 8 },
  { w: 110, h: 90, label: '10 × 12', entries: 10 }, // mounted landscape: three rows of WAGOs instead of four short ones
  { w: 145, h: 120, label: '15 × 13', entries: 12, note: 'Vimar V70005 154 × 128 × 70' },
  { w: 160, h: 160, label: '17 × 17', entries: 14, note: 'Legrand 089374 170 × 170 × 48' },
  { w: 220, h: 170, label: '23 × 18', entries: 16, note: 'Legrand 089275 230 × 180 × 50' },
  { w: 280, h: 180, label: '30 × 20', entries: 20, note: 'vodoravno, duža strana' },
]
export const BOX_SIZES: [number, number][] = BOX_CATALOG.map((b) => [b.w, b.h])
export const boxSizeLabel = (W: number, H: number) => BOX_CATALOG.find((b) => b.w === W && b.h === H)?.label ?? `${Math.round(W / 10 + 1)} × ${Math.round(H / 10 + 1)}`
// the junction boxes this project uses (Postavke projekta), smallest first; unset = the whole catalog
export const boxSizesOf = (p: { boxStock?: string[] }): [number, number][] => { const s = BOX_CATALOG.filter((b) => !p.boxStock?.length || p.boxStock.includes(b.label)); return (s.length ? s : BOX_CATALOG).map((b) => [b.w, b.h]) }
export const boxEntries = (W: number, H: number) => BOX_CATALOG.find((b) => b.w === W && b.h === H)?.entries ?? 14
export const WAGO = { 412: { w: 13.0, n: 2 }, 413: { w: 18.7, n: 3 }, 415: { w: 30.0, n: 5 } } as const
export const DEPTH = 18.6

export type Item = { kind: 'wago'; t: Terminal; w: number; h: number } | { kind: 'cap'; t: Terminal; w: number; h: number } | { kind: 'device'; d: Device; w: number; h: number }
export const CAP_W = 4, CAP_H = 12 // tape / small cap on a folded-back spare core: ~1 mm thicker than the core
export type Placed = Item & { x: number; y: number; flip: boolean }

export const GAP = 4 // mm between bridged WAGO units
function wagoWidth(t: Terminal) { return WAGO[t.wago as 412 | 413 | 415].w * t.chained + (t.chained - 1) * GAP }

// Greedy packing of WAGOs, caps and devices into rows (top, bottom, middle); the box grows when they overflow.
// Lives here so the size check and the material list see the same box as the drawing.
export function boxLayout(j: Pick<Junction, 'box' | 'terminals' | 'devices' | 'boxSizes'>): { W: number; H: number; placed: Placed[]; overflow: boolean; stacked: boolean } {
  const items: Item[] = [
    ...j.terminals.filter((t) => t.wago).map((t): Item => ({ kind: 'wago', t, w: wagoWidth(t), h: DEPTH })),
    ...j.terminals.filter((t) => t.cap).map((t): Item => ({ kind: 'cap', t, w: CAP_W, h: CAP_H })),
    ...j.devices.map((d): Item => ({ kind: 'device', d, w: d.wMm, h: d.hMm })),
  ]
  const base = j.box.type === 'modbox' ? [(j.box.modules ?? 3) <= 3 ? [100, 70] : (j.box.modules ?? 3) <= 4 ? [120, 70] : (j.box.modules ?? 3) <= 7 ? [160, 70] : [160, 120], [160, 100], [200, 120]] : isPlace(j.box) ? j.boxSizes ?? BOX_SIZES : j.box.type === 'kip' ? [[130, 90]] : [[60, 46], [90, 60]]
  for (const [W, H] of base) {
    const rows: { y: number; flip: boolean; x: number; items: Placed[]; h: number; inner?: boolean }[] = [
      { y: 5, flip: false, x: 5, items: [], h: DEPTH },
      { y: H - 5 - DEPTH, flip: true, x: 5, items: [], h: DEPTH },
    ]
    if (H >= 110) {
      // the taller box takes four rows: WAGOs in two layers at the top and bottom, as they do in practice; that counts as full
      rows.push({ y: 5 + DEPTH + 4, flip: false, x: 5, items: [], h: DEPTH, inner: true }, { y: H - 5 - 2 * DEPTH - 4, flip: true, x: 5, items: [], h: DEPTH, inner: true })
    } else if (W >= 110 && H >= 90) rows.push({ y: H / 2 - DEPTH / 2, flip: false, x: 5, items: [], h: DEPTH })
    let ok = true
    for (const it of items) {
      // the earthing busbar sits at the top with its terminals facing down: cables and the FeZn tail come up to it
      const pref = it.kind === 'device' && it.d.kind !== 'relay' && j.box.type !== 'kip' ? [...rows].reverse() : rows
      const row = pref.find((r) => r.x + it.w <= W - 5)
      if (!row) { ok = false; break }
      row.items.push({ ...it, x: row.x, y: row.flip ? row.y + DEPTH - it.h : row.y, flip: row.flip })
      row.x += it.w + 4
    }
    if (ok) return { W, H, placed: rows.flatMap((r) => r.items), overflow: W > base[0][0] || H > base[0][1], stacked: rows.some((r) => r.inner && r.items.length > 0) }
  }
  const [W, H] = base[base.length - 1]
  return { W, H, placed: [], overflow: true, stacked: true }
}


// Fed directly, or through a place-to-place cable from a place that is fed (boxes may be daisy-chained).
function isFed(place: WallElement, p: Project, seen = new Set<string>()): boolean {
  if (seen.has(place.id)) return false
  seen.add(place.id)
  for (const c of p.cables.filter((x) => isAtBox(x, place))) {
    const r = resolveCable(c, place, p)
    if (r.role === 'feed') return true
    if (r.far.place && r.far.place.id !== place.id && isFed(r.far.place, p, seen)) return true
  }
  return false
}

// Which supply each cable's L and N belong to. Every feed cable starts a circuit; a cable gets the circuit
// whose feed is nearest over the box graph (ties are reported); a cable's own "circuit" setting wins.
export interface CircuitInfo { id: string; name: string; tie: boolean }
const circuitCache = new WeakMap<Project, { byCable: Map<string, CircuitInfo>; names: Map<string, string>; dist: Map<string, Map<string, number>>; feedCables: Set<string>; withSockets: Set<string>; socketPath: Set<string> }>()
export function circuitsOf(p: Project) {
  const hit = circuitCache.get(p)
  if (hit) return hit
  const names = new Map<string, string>()
  const places = p.elements.filter(isPlace)
  const dist = new Map<string, Map<string, number>>() // circuit -> place -> hops
  const feedOf = new Map<string, string>() // feed cable -> circuit
  const queue: [string, string][] = []
  for (const pl of places) for (const c of p.cables.filter((x) => isAtBox(x, pl))) {
    const r = resolveCable(c, pl, p)
    if (r.role !== 'feed') continue
    const id = r.far.conduit?.id ?? r.far.element?.id ?? c.id
    names.set(id, r.far.conduit?.name ?? r.far.element?.label ?? 'dolaz')
    for (const x of chainCables(c, p)) feedOf.set(x.id, id)
    if (!dist.has(id)) dist.set(id, new Map())
    if (!dist.get(id)!.has(pl.id)) { dist.get(id)!.set(pl.id, 0); queue.push([id, pl.id]) }
  }
  const adj = new Map<string, string[]>()
  for (const c of p.cables) { const pl = cablePlaces(c, p); if (!pl) continue; adj.set(pl[0].id, [...(adj.get(pl[0].id) ?? []), pl[1].id]); adj.set(pl[1].id, [...(adj.get(pl[1].id) ?? []), pl[0].id]) }
  while (queue.length) {
    const [k, at] = queue.shift()!
    const d = dist.get(k)!.get(at)!
    for (const nb of adj.get(at) ?? []) if (!dist.get(k)!.has(nb)) { dist.get(k)!.set(nb, d + 1); queue.push([k, nb]) }
  }
  const nearest = (ends: string[]): { id: string; tie: boolean } | null => {
    let best = Infinity, ids: string[] = []
    for (const [k, m] of dist) { const d = Math.min(...ends.map((e) => m.get(e) ?? Infinity)); if (d < best) { best = d; ids = [k] } else if (d === best && d < Infinity) ids.push(k) }
    return ids.length ? { id: ids[0], tie: ids.length > 1 } : null
  }
  const byCable = new Map<string, CircuitInfo>()
  for (const c of p.cables) {
    if (byCable.has(c.id)) continue
    const chain = chainCables(c, p)
    const own = chain.map((x) => feedOf.get(x.id)).find(Boolean)
    const pick = chain.map((x) => x.circuit).find((x) => x && names.has(x))
    let info: CircuitInfo | null = null
    if (own) info = { id: own, name: names.get(own)!, tie: false }
    else if (pick) info = { id: pick, name: names.get(pick)!, tie: false }
    else {
      const ends = cableEnds(c, p).filter((e): e is WallElement => !!e && isPlace(e)).map((e) => e.id)
      const n = nearest(ends)
      if (n) info = { id: n.id, name: names.get(n.id)!, tie: n.tie }
    }
    if (info) for (const x of chain) byCable.set(x.id, info)
  }
  // a tie between two boxes goes to the circuit the other end already has on its own, so that box stays
  // single-circuit (e.g. the cable from a mixed frame back to the light circuit's box)
  for (const c of p.cables) {
    const info = byCable.get(c.id)
    if (!info?.tie) continue
    const ends = cableEnds(c, p).filter((e): e is WallElement => !!e && isPlace(e))
    for (const end of ends) {
      const others = new Set(p.cables.filter((x) => x.id !== c.id && isAtBox(x, end) && !chainCables(c, p).some((y) => y.id === x.id)).map((x) => byCable.get(x.id)).filter((x): x is CircuitInfo => !!x && !x.tie).map((x) => x.id))
      if (others.size === 1) { const id = [...others][0]; for (const x of chainCables(c, p)) byCable.set(x.id, { id, name: names.get(id)!, tie: false }); break }
    }
  }
  // cables that carry socket current: from every socket (bedrooms excepted) back to its feed along the shortest
  // path. On B16 those need 2,5 mm²; branches that only reach lights and switches may stay 1,5 (HD 60364-4-43).
  const withSockets = new Set<string>(), socketPath = new Set<string>()
  const markChain = (c: Cable) => chainCables(c, p).forEach((x) => socketPath.add(x.id))
  const placeOf = (id: string) => p.elements.find((e) => e.id === id)
  for (const e of p.elements) {
    if (e.type !== 'socket' || isData(e)) continue
    const room = p.rooms.find((r) => r.id === e.roomId)
    if (room && socket15Of(room)) continue
    // a socket on its own hangs off a box by a cable; that cable and the box are the start
    const starts: { place: WallElement; via?: Cable }[] = []
    if (e.host) { const h = placeOf(e.host); if (h) starts.push({ place: h }) }
    else for (const c of p.cables) if (isAtBox(c, e)) { const pl = cableEnds(c, p).find((x): x is WallElement => !!x && isPlace(x)); if (pl) starts.push({ place: pl, via: c }) }
    for (const st of starts) {
      const k = st.via ? byCable.get(st.via.id)?.id : p.cables.filter((c) => isAtBox(c, st.place)).map((c) => byCable.get(c.id)?.id).find(Boolean)
      if (!k) continue
      withSockets.add(k)
      if (st.via) markChain(st.via)
      const d = dist.get(k)
      const walk = [st.place.id], seenP = new Set(walk)
      while (walk.length) {
        const at = walk.shift()!, here = d?.get(at)
        if (here === undefined) continue
        for (const c of p.cables) {
          if (!isAtBox(c, placeOf(at)!) || byCable.get(c.id)?.id !== k) continue
          if (feedOf.get(c.id) === k) { markChain(c); continue }
          const pl = cablePlaces(c, p)
          const other = pl ? (pl[0].id === at ? pl[1] : pl[0]) : null
          if (other && (d!.get(other.id) ?? Infinity) === here - 1) { markChain(c); if (!seenP.has(other.id)) { seenP.add(other.id); walk.push(other.id) } }
        }
      }
    }
  }
  const out = { byCable, names, dist, feedCables: new Set(feedOf.keys()), withSockets, socketPath }
  circuitCache.set(p, out)
  return out
}
// The thinnest section a cable may have under the project rules (feeds and socket circuits 2,5 mm²).
const heavyOutput = (s: string, p: Project) => { const [k, r, n] = s.split(':'); return k === 'O' && p.elements.some((e) => (e.type === 'boiler' || e.type === 'appliance') && e.feedRelayId === r && (e.feedOutput ?? 1) === +n) }
export function minSectionFor(c: Cable, p: Project): number {
  const r = rulesOf(p), circ = circuitsOf(p)
  if (isControlCable(c.type) || coreColors(c.type).length === 0 || /^pe\b/i.test(c.type)) return 0
  // a relay output to a boiler or appliance carries its full current, and so does the L feeding that relay
  const ms = bundleMembers(c.id, p)
  const pl = cablePlaces(c, p)
  if (pl) {
    const load = cableLoad(c.id, pl[0], pl[1], p)
    const mine = [...load.core.values()]
    if (mine.some((s) => s && heavyOutput(s, p)) || (mine.includes('L') && load.signals.some((s) => heavyOutput(s, p)))) return 2.5
  }
  // otherwise a further cable of a bundle carries only returns (lights, switches), never the circuit's L
  if (ms.length > 1 && !ms[0].ids.includes(c.id)) return 1.5
  if (r.feed25 && circ.feedCables.has(c.id)) return 2.5
  if (r.socket25 && circ.socketPath.has(c.id)) return 2.5
  return 1.5
}
const baseId = (id: string) => id.split('@')[0]

// Project rules on the cables of one box: feeds and socket circuits at 2,5 mm², sections never growing from the feed
// towards the load, and only cables from the project's list.
function sectionChecks(box: WallElement, cables: BoxCable[], p: Project, checks: Check[]) {
  const rules = rulesOf(p), circ = circuitsOf(p), stock = p.cableStock
  const power = (bc: BoxCable) => coreColors(bc.cable.type).length > 0 && !isControlCable(bc.cable.type) && !/^pe\b/i.test(bc.cable.type) && bc.role !== 'lowv' && bc.role !== 'earth'
  const thinType = (bc: BoxCable) => thinnest(bc.cable, p).type
  const sec = (bc: BoxCable) => sectionOf(thinType(bc))
  for (const bc of cables.filter(power)) {
    const min = minSectionFor(bc.cable, p)
    if (sec(bc) < min) {
      const k = circ.byCable.get(bc.cable.id)?.id
      checks.push({ cableId: bc.cable.id, level: 'err', text: circ.feedCables.has(bc.cable.id) ? `Dolaz ${bc.label} je ${cableShort(thinType(bc))}: dolazi moraju biti 2,5 mm² (3×2,5).` : !circ.socketPath.has(bc.cable.id) ? `Kabel ${bc.label} nosi struju bojlera ili trošila preko releja: ${cableShort(thinType(bc))} je pretanak, mora biti 2,5 mm².` : `Kabel ${bc.label} nosi struju utičnica (krug ${k ? circ.names.get(k) : ''}, B16): ${cableShort(thinType(bc))} je pretanak, mora biti 2,5 mm².` })
    }
    if (stock && /^NYM/.test(bc.cable.type) && !stock.includes(bc.cable.type)) checks.push({ cableId: bc.cable.id, level: 'warn', text: `Kabel ${bc.label}: ${cableShort(bc.cable.type)} nije na popisu kabela koje koristiš (Postavke projekta).` })
  }
  if (!rules.flow) return
  for (const k of new Set(cables.filter(power).map((bc) => circ.byCable.get(bc.cable.id)?.id).filter((x): x is string => !!x))) {
    const d = circ.dist.get(k), here = d?.get(box.id)
    if (!d || here === undefined) continue
    // a further cable in a bundle carries only returns, so it says nothing about the section feeding the load
    const mine = cables.filter((bc) => power(bc) && circ.byCable.get(bc.cable.id)?.id === k && (bundleMembers(bc.cable.id, p)[0]?.ids.includes(bc.cable.id) ?? true))
    const incoming = mine.filter((bc) => circ.feedCables.has(bc.cable.id) || (bc.far.place && (d.get(bc.far.place.id) ?? Infinity) < here))
    if (!incoming.length) continue
    const inMin = Math.min(...incoming.map(sec))
    const thin = incoming.find((bc) => sec(bc) === inMin)!
    for (const bc of mine) {
      if (incoming.includes(bc) || (bc.far.place && (d.get(bc.far.place.id) ?? Infinity) <= here)) continue
      if (sec(bc) > inMin) checks.push({ cableId: bc.cable.id, level: 'warn', text: `Kabel ${bc.label} je ${cableShort(thinType(bc))}, a dolazi mu ${cableShort(thinType(thin))} (${thin.label}). Presjek se od dolaza prema trošilu ne povećava: osigurač štiti tanji kabel, pa deblji nastavak ne daje ništa.` })
    }
  }
}

export function junctionFor(box: WallElement, p: Project): Junction {
  const room = p.rooms.find((r) => r.id === box.roomId)!
  const checks: Check[] = []
  const cables: BoxCable[] = p.cables
    .filter((c) => isAtBox(c, box))
    .map((c) => {
      const r = resolveCable(c, box, p)
      const cross = r.far.place && r.far.place.id !== box.id && r.role !== 'feed' && r.role !== 'lowv'
      return { ...r, ...sideOf(r, box, p), wires: cross ? crossWires(r, box, p, checks) : leafWires(r, box, p, checks) }
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side) || a.order - b.order)
  const devices = devicesIn(box, p)
  for (const d of devices) if (d.kind === 'relay' && !RELAY_MODELS[relayModelOf(d.el)].dry && pulseTarget(d.el, p)) checks.push({ level: 'err', text: `${d.el.label}: suhi kontakt za vrata ima samo Shelly 1 Gen4; ${RELAY_MODELS[relayModelOf(d.el)].label} pali fazom.` })
  const feeds = cables.filter((c) => c.role === 'feed').length
  const hasL = cables.some((c) => c.wires.some((w) => w.terminal === 'L'))
  const hasN = cables.some((c) => c.wires.some((w) => w.terminal === 'N'))
  // two or more circuits in this box: each keeps its own L and N (PE stays common)
  const circ = circuitsOf(p)
  const circOf = (bc: BoxCable) => (bc.role === 'lowv' || bc.role === 'earth' ? undefined : circ.byCable.get(bc.cable.id))
  const here = new Map<string, string>()
  for (const bc of cables) { const c = circOf(bc); if (c) here.set(c.id, c.name) }
  const multi = here.size > 1
  sectionChecks(box, cables, p, checks)
  const devCirc = new Map<string, string>()
  if (multi) {
    for (const bc of cables) { const c = circOf(bc); if (c?.tie) checks.push({ cableId: bc.cable.id, level: 'err', text: `Kabel ${bc.label}: ne zna se na kojem je strujnom krugu (${[...here.values()].join(' ili ')}). Odaberi krug u svojstvima kabela.` }) }
    // a device belongs to the circuit of the cable that carries its signals (a switch's return, a relay's output)
    const ports = new Map(devices.map((d) => [d.el.id, devicePorts(d, p, []).map((m) => m.terminal).filter((t) => !LNPE.includes(t))]))
    for (let round = 0; round < 3; round++) for (const d of devices) {
      if (devCirc.has(d.el.id)) continue
      for (const t of ports.get(d.el.id) ?? []) {
        const viaCable = cables.find((bc) => bc.wires.some((w) => w.terminal === t))
        const viaDev = devices.find((o) => o.el.id !== d.el.id && devCirc.has(o.el.id) && (ports.get(o.el.id) ?? []).includes(t))
        const c = viaCable ? circOf(viaCable)?.id : viaDev ? devCirc.get(viaDev.el.id) : undefined
        if (c) { devCirc.set(d.el.id, c); break }
      }
    }
    const fallback = [...here.keys()][0]
    const guessed = devices.filter((d) => !devCirc.has(d.el.id) && !isData(d.el))
    for (const d of guessed) devCirc.set(d.el.id, fallback)
    if (guessed.length) checks.push({ level: 'warn', text: `${guessed.map((d) => d.el.label).join(', ')}: pretpostavljeno na krugu ${here.get(fallback)}.` })
    const per = [...here].map(([id, name]) => `${name}: ${[...cables.filter((bc) => circOf(bc)?.id === id).map((bc) => bc.label), ...devices.filter((d) => devCirc.get(d.el.id) === id).map((d) => d.el.label)].join(', ')}`)
    checks.push({ level: 'ok', text: `${here.size} strujna kruga u ${box.label}, svaki sa svojim L i N (PE zajednički). ${per.join(' · ')}. Krivo? Promijeni krug na kabelu.` })
  }
  const tagged = (t: string, c: string | undefined) => (multi && c && (t === 'L' || t === 'N') ? `${t}@${c}` : t)
  if (!cables.length) checks.push({ level: 'warn', text: 'U kutiju ne ulazi nijedan kabel.' })
  else if (box.type === 'box' && feeds === 0 && !isFed(box, p)) checks.push({ level: 'err', text: 'Kutija nema dolaza: ni izravno (bužir kategorije Dolaz, ormar, uloga "Dolaz") ni preko druge kutije koja ga ima.' })
  else if (box.type === 'modbox' && !hasL && devices.some((d) => !isData(d.el) && !(d.el.type === 'switch' && lowVoltSwitch(d.el, p)))) checks.push({ level: 'err', text: 'Doza nema faze: treba kabel iz razvodne kutije.' })
  else if (feeds > 1) checks.push({ level: 'warn', text: `${feeds} dolaza u istu kutiju; obično je jedan.` })

  const map = new Map<string, TerminalWire[]>()
  const add = (id: string, w: TerminalWire) => { if (!map.has(id)) map.set(id, []); map.get(id)!.push(w) }
  for (const bc of cables) for (const w of bc.wires) {
    if (!w.terminal) continue
    add(w.terminal === 'PARK' ? `PARK:${bc.cable.id}:${w.color}` : tagged(w.terminal, circOf(bc)?.id), { kind: 'core', cableId: bc.cable.id, cableLabel: bc.label, color: w.color, note: w.note })
  }
  // buttons first (they create the I:/SW: demands), then relays whose SW/O ports only join when something uses them
  const sorted = [...devices].sort((a, b) => (a.kind === 'relay' ? 1 : 0) - (b.kind === 'relay' ? 1 : 0))
  for (const d of sorted) {
    const m = d.kind === 'relay' ? RELAY_MODELS[relayModelOf(d.el)] : null
    if (m?.needsN && !hasN) checks.push({ level: 'err', text: `${d.label} treba nulu (N), a u dozu ne dolazi nula. Dovedi 3×1,5 ili 5×1,5 s N iz razvodne kutije.` })
    // an unmarked frame is a standard (≈50 mm) one; a relay needs the deep variant
    if (m && box.type !== 'box' && (box.depth ?? 'plitka') === 'plitka') checks.push({ level: 'err', text: `${d.label} ne stane u standardnu dozu (≈50 mm). Označi dozu kao duboku (TEM PM7-65 / 65 mm) ili preseli relej u razvodnu kutiju.` })
    for (const pm of devicePorts(d, p, checks)) {
      const optional = d.kind === 'relay' && (pm.terminal.startsWith('O:') || pm.terminal.startsWith('I:'))
      if (optional && !map.has(pm.terminal)) {
        if (pm.terminal.startsWith('O:')) {
          const n = +pm.terminal.split(':')[2]
          const lights = p.elements.filter((e) => e.feedRelayId === d.el.id && (e.feedOutput ?? 1) === n)
          if (lights.length) checks.push({ level: 'err', text: `${d.label} izlaz ${n} napaja ${lights.map((l) => l.label).join(', ')}, ali između ove doze i kutije tog svjetla nema kabela.` })
        }
        continue
      }
      add(tagged(pm.terminal, devCirc.get(d.el.id)), { kind: 'port', deviceId: d.el.id, deviceLabel: d.label, port: pm.port, color: pm.color, note: pm.note })
    }
  }
  if (box.type === 'modbox') { const used = frameSlots(hostedFront(p.elements, box.id), box.modules ?? 3).used; if (used > (box.modules ?? 3)) checks.push({ level: 'err', text: `Doza je ${frameName(box.modules ?? 3)}, a unutra treba ${used}M (šuko 2M, tipkalo i euro 1M${(box.modules ?? 3) > 7 ? ', šuko ne prelazi u drugi red' : ''}). Uzmi veću dozu ili makni element.` }) }
  if (devices.filter((d) => d.kind === 'relay').length > 2) checks.push({ level: 'warn', text: `${devices.filter((d) => d.kind === 'relay').length} releja u jednoj dozi: provjeri stane li uz stezaljke.` })

  const terminals: Terminal[] = [...map.entries()]
    .sort((a, b) => ORDER(a[0]) - ORDER(b[0]) || chainPos(a[0], p) - chainPos(b[0], p) || a[0].localeCompare(b[0]))
    .map(([id, wires]) => {
      const n = wires.length
      const direct = n === 2 && wires.some((w) => w.kind === 'port') && !id.startsWith('PARK')
      // a core with nothing to join (spare, or e.g. the only PE in a switch frame) is a spare too
      const lone = n === 1 && wires[0].kind === 'core' && LNPE.includes(baseId(id))
      const cap = (id.startsWith('PARK') || lone) && spareCoresOf(p) === 'cap'
      const wago: Terminal['wago'] = direct || cap ? 0 : n <= 2 ? 412 : n <= 3 ? 413 : 415
      const chained = n <= 5 ? 1 : Math.ceil((n - 2) / 3)
      const meta = terminalMeta(id, p)
      if (cap && lone) meta.desc = `${meta.desc}, sam`
      if (id.startsWith('SW:?')) checks.push({ level: 'warn', text: `${meta.desc}: povratna nema para.` })
      else if (!LNPE.includes(baseId(id)) && !id.startsWith('PARK') && !id.startsWith('CH:') && n === 1) {
        const w = wires[0]
        checks.push({ level: 'warn', text: `Stezaljka ${meta.label} (${meta.desc}): samo ${w.kind === 'core' ? w.cableLabel : `${w.deviceLabel} ${w.port}`}, nedostaje druga strana.` })
      }
      return { id, ...meta, wago, chained, wires, cap }
    })
  // a light or socket whose only neutral is its own cable: nothing brings N into this box
  for (const t of terminals) if (baseId(t.id) === 'N' && t.wires.length === 1 && t.wires[0].kind === 'core') {
    const w = t.wires[0], bc = cables.find((c) => c.cable.id === (w as { cableId: string }).cableId)
    if (bc && ['light', 'socket', 'motor'].includes(bc.role)) checks.push({ cableId: bc.cable.id, level: 'err', text: `${bc.label}: nema nule. U ${box.label} ne dolazi nijedan kabel s plavom žilom (NYM-O nema nulu); dovedi N, npr. kabel NYM-J.` })
  }
  const bom = new Map<string, number>()
  for (const t of terminals) if (t.wago) bom.set(`WAGO 221-${t.wago}`, (bom.get(`WAGO 221-${t.wago}`) ?? 0) + t.chained)
  for (const d of devices) if (d.kind === 'relay') { const k = RELAY_MODELS[relayModelOf(d.el)].label; bom.set(k, (bom.get(k) ?? 0) + 1) }
  // how big the box has to be, and when to split instead of growing
  const fixed = BOX_CATALOG.find((b) => b.label === box.boxSize)
  const boxSizes: [number, number][] = fixed ? [[fixed.w, fixed.h]] : boxSizesOf(p)
  const lay = boxLayout({ box, terminals, devices, boxSizes })
  const size = { W: lay.W, H: lay.H, overflow: lay.overflow, stacked: lay.stacked }
  if (box.type === 'box') {
    const entries = boxEntries(lay.W, lay.H)
    const relays = devices.filter((d) => d.kind === 'relay').length
    const smallest = boxSizes[0], largest = boxSizes[boxSizes.length - 1]
    const tooBig = lay.W >= largest[0] && lay.H >= largest[1] && lay.placed.length === 0
    if (cables.length > entries) checks.push({ level: 'err', text: `${cables.length} kabela u jednoj kutiji: kutija ${boxSizeLabel(lay.W, lay.H)} ima ${entries} uvodnica. Podijeli na dvije kutije (npr. svjetla / utičnice / vrata).` })
    else if (tooBig) checks.push({ level: 'err', text: fixed ? `Ne stane u odabranu ${fixed.label}: odaberi veću ili Automatski, ili podijeli kutiju.` : `Ne stane ni u ${boxSizeLabel(largest[0], largest[1])}: podijeli na dvije kutije po namjeni (svjetla / utičnice / vrata).` })
    else if (lay.overflow) { const cat = BOX_CATALOG.find((b) => b.w === lay.W && b.h === lay.H); checks.push({ level: 'warn', text: `U ${boxSizeLabel(smallest[0], smallest[1])} ne stane: uzmi kutiju ${boxSizeLabel(lay.W, lay.H)}${cat?.note ? ` (${cat.note})` : ''}${relays ? ', duboku (relej)' : ''}.` }) }
  }
  const level: Level = checks.some((c) => c.level === 'err') ? 'err' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok'
  if (level === 'ok' && cables.length) checks.push({ level: 'ok', text: `Sve žile uparene: ${terminals.length} stezaljki, ${cables.length} kabela${devices.length ? `, ${devices.length} uređaja` : ''}.` })
  return { box, room, cables, devices, terminals, checks, bom: [...bom.entries()].sort().map(([item, qty]) => ({ item, qty })), level, size, boxSizes }
}

export function allJunctions(p: Project): Junction[] {
  return p.elements.filter((e) => isPlace(e) && !e.host && p.rooms.some((r) => r.id === e.roomId)).map((b) => junctionFor(b, p))
}

// A light, a door unit or a stand-alone socket: one terminal block (klema) and the cable's cores going straight onto it.
export const LEAF_TYPES: ElementType[] = ['light', 'motor', 'socket', 'kip', 'boiler', 'appliance', 'ledpsu']
export const isLeaf = (e: WallElement) => LEAF_TYPES.includes(e.type) && !e.host
export function leafJunctionFor(el: WallElement, p: Project): Junction {
  if (el.type === 'kip') return kipJunctionFor(el, p)
  const room = p.rooms.find((r) => r.id === el.roomId)!
  const checks: Check[] = []
  const data = isData(el)
  const dm = data ? DATA_META[el.socketKind as 'rj45' | 'tv'] : null
  const ap = el.type === 'appliance' ? APPLIANCES[el.appliance ?? 'hob'] : null
  // a hob on a 5-core cable is three-phase: L1 L2 L3 on brown, black, grey
  const threePhase = el.type === 'appliance' && (el.appliance ?? 'hob') === 'hob' && p.cables.some((c) => isAtBox(c, el) && coreColors(c.type).length >= 5)
  // LED strip: the supply plugs into a socket in the cabinet; with a 24 V controller the button pairs land on it too
  const ctl = ledController(el, p)
  const ledSig = ctl ? p.elements.filter((e) => e.type === 'switch' && e.relayId === ctl.id).flatMap((e) => switchSignals(e, p, [], Infinity)) : []
  const portTerm: Record<string, string> = Object.fromEntries(ledSig.map((x) => [terminalMeta(x.terminal, p).label, x.terminal]))
  // without a controller, control cables at a LED supply are its 24 V outputs to the strips (all in parallel)
  const out24 = el.type === 'ledpsu' && !ctl && p.cables.some((c) => isAtBox(c, el) && isControlCable(c.type))
  if (out24) { portTerm['V+'] = 'V+'; portTerm['V−'] = 'V-' }
  const ports = el.type === 'motor' ? ['L', 'N', 'PE', 'IMP 1', 'IMP 2'] : dm ? [dm.port] : threePhase ? ['L1', 'L2', 'L3', 'N', 'PE'] : ['L', 'N', 'PE', ...Object.keys(portTerm)]
  const name = el.type === 'ledpsu' ? 'utičnica za napajanje LED trake' : el.type === 'light' ? 'svjetiljka' : el.type === 'motor' ? 'upravljačka jedinica' : el.type === 'boiler' ? 'bojler, priključna stezaljka' : ap ? `${ap.label.toLowerCase()}, priključna stezaljka` : dm ? dm.name : 'utičnica'
  const device: Device = { el, label: `${el.label} ${name}`, ports, wMm: Math.max(24, ports.length * 8), hMm: 16, kind: 'terminal' }
  const pulse = el.type === 'motor' ? pulseChain(el, p) : new Set<string>()
  const cables: BoxCable[] = p.cables
    .filter((c) => isAtBox(c, el))
    .map((c) => {
      const r = resolveCable(c, el, p)
      const spare = r.cores.filter((k) => k !== 'brown' && k !== 'blue' && k !== 'gnye')
      const wires: Wire[] = dm && dataKindOf(c.type) ? [{ color: 'other', terminal: dm.port, note: dm.wire }] : r.cores.map((k) => {
        if (threePhase && (k === 'brown' || k === 'black' || k === 'grey')) { const n = k === 'brown' ? 1 : k === 'black' ? 2 : 3; return { color: k, terminal: `L${n}`, note: `faza L${n}` } }
        if (k === 'brown') return { color: k, terminal: 'L', note: el.type === 'light' || (el.type === 'ledpsu' && !ctl) ? 'faza sa prekidača / releja' : 'faza' }
        if (k === 'blue') return { color: k, terminal: 'N' }
        if (k === 'gnye') return { color: k, terminal: 'PE' }
        const i = spare.indexOf(k)
        if (el.type === 'ledpsu' && i >= 0 && i < ledSig.length) return { color: k, terminal: ledSig[i].terminal, note: 'tipkalo, 24 V' }
        if (out24 && isControlCable(c.type) && (i === 0 || i === 1)) return { color: k, terminal: i === 0 ? 'V+' : 'V-', note: i === 0 ? '+24 V prema traci' : '− prema traci' }
        if (el.type === 'motor' && pulse.has(c.id) && i < 2) return { color: k, terminal: `IMP${i + 1}`, note: 'impuls sa Shellyja (suhi kontakt)' }
        return { color: k, terminal: 'PARK', note: 'rezerva' }
      })
      return { ...r, ...sideOf(r, el, p), wires }
    })
  if (!cables.length) checks.push({ level: 'warn', text: `${el.label}: do ${name === 'svjetiljka' ? 'svjetla' : name} ne dolazi nijedan kabel.` })
  if (ap) for (const c of cables) {
    // the thinnest segment of the run decides (a 3×1,5 stub before a corner limits the whole cable)
    const thin = thinnest(c.cable, p).type, sect = sectionOf(thin), cores = coreColors(thin).length
    const kind = el.appliance ?? 'hob'
    if (sect < ap.minMm2) checks.push({ cableId: c.cable.id, level: 'err', text: `${el.label}: ${ap.label.toLowerCase()} treba barem ${String(ap.minMm2).replace('.', ',')} mm², kabel je ${thin}${thin !== c.cable.type ? ' na dijelu trase' : ''}.` })
    else if (kind === 'hob' && cores < 5 && sect < 6) checks.push({ level: 'warn', text: `${el.label}: jednofazno na ${thin} ploča radi samo uz ograničenje snage (~3,7 kW, B16). Za punu snagu 5×2,5 trofazno ili 3×6 na B32.` })
    if (kind !== 'hood' && c.far.place) checks.push({ level: 'warn', text: `${el.label}: ${ap.label.toLowerCase()} se napaja preko kutije ${c.far.place.label}. Uobičajeno je vlastiti krug ravno iz ormara.` })
  }
  if (el.type === 'ledpsu') {
    const w = (el.ledM ?? 5) * (el.ledWpm ?? 10), need = Math.ceil((w * 1.2) / 10) * 10
    const t = lightTerminal(el, p)
    if (!t.by) checks.push({ level: 'warn', text: `${el.label}: traku nitko ne pali. Označi je na prekidaču ("Pali svjetla"), odaberi relej ("Napaja ga") ili u nju stavi LED regulator.` })
    checks.push({ level: 'ok', text: `${el.label}: ${String(el.ledM ?? 5).replace('.', ',')} m × ${el.ledWpm ?? 10} W/m = ${w} W, napajanje ${el.ledV ?? 24} V od barem ${need} W. ${ctl ? `Utičnica stalno pod naponom, pali ${ctl.label} na 24 V strani.` : `Utičnica na prekidaču: ${t.by ? t.by.label : '?'} pali fazu, napajanje i traka se pale s njom.`}` })
  }
  if (el.type === 'boiler' && el.feedRelayId) {
    const r = p.elements.find((x) => x.id === el.feedRelayId)
    if (r && relayModelOf(r) !== 'gen4pm') checks.push({ level: 'warn', text: `${el.label}: bojler (~9 A satima) pali ${r.label}. Za trajno opterećenje uzmi Shelly 1PM Gen4 ili sklopnik u ormaru.` })
  }
  if (el.type === 'boiler') for (const c of cables) {
    // a water heater (~2 kW, hours at a time) gets its own circuit: 2,5 mm² on B16, straight from the board
    if (sectionOf(thinnest(c.cable, p).type) < 2.5) checks.push({ cableId: c.cable.id, level: 'warn', text: `${el.label}: bojler vuče ~2 kW satima, kabel ${thinnest(c.cable, p).type} je pretanak. Uzmi 3×2,5 na osigurač B16.` })
    if (c.far.place && !el.feedRelayId) checks.push({ level: 'warn', text: `${el.label}: bojler se napaja preko kutije ${c.far.place.label}. Uobičajeno je vlastiti krug ravno iz ormara (bužir kategorije Dolaz ili kabel do ormara).` })
  }
  // a door unit may take power and pulse over two cables (L N PE + a control pair)
  const power = cables.filter((c) => !isControlCable(c.cable.type))
  if (el.type === 'motor' && cables.length && !power.some((c) => c.cores.includes('brown'))) checks.push({ level: 'warn', text: `${el.label}: stiže samo upravljački kabel, nema napajanja (L N PE).` })
  if (power.length > 1) checks.push({ level: 'warn', text: `${el.label}: ${power.length} kabela na jednom uređaju; obično je jedan (ili provlačenje kroz dozu).` })
  const map = new Map<string, TerminalWire[]>()
  const add = (id: string, w: TerminalWire) => { if (!map.has(id)) map.set(id, []); map.get(id)!.push(w) }
  for (const bc of cables) for (const w of bc.wires) if (w.terminal) add(w.terminal === 'PARK' ? `PARK:${bc.cable.id}:${w.color}` : w.terminal, { kind: 'core', cableId: bc.cable.id, cableLabel: bc.label, color: w.color, note: w.note })
  for (const port of ports) { const id = portTerm[port] ?? port.replace(' ', ''); if (map.has(id)) add(id, { kind: 'port', deviceId: el.id, deviceLabel: portTerm[port] && ctl ? `${ctl.label} ${RELAY_MODELS[relayModelOf(ctl)].label}` : portTerm[port] ? `${el.label} napajanje 24 V` : device.label, port, color: id === 'L' || id === 'L1' ? 'brown' : id === 'N' ? 'blue' : id === 'PE' ? 'gnye' : id === 'L3' ? 'grey' : id === 'UTP' || id === 'ANT' ? 'other' : 'black' }) }
  const terminals: Terminal[] = [...map.entries()].map(([id, wires]) => {
    const meta = /^L[123]$/.test(id) ? { label: id, desc: `faza ${id}` } : id.startsWith('IMP') ? { label: id, desc: 'impuls, suhi kontakt' } : id.startsWith('PARK') ? (spareCoresOf(p) === 'cap' ? { label: '·', desc: 'rezerva' } : { label: '·', desc: 'parkirano' }) : terminalMeta(id, p)
    const cap = id.startsWith('PARK') && spareCoresOf(p) === 'cap'
    const direct = wires.length === 2 && wires.some((w) => w.kind === 'port')
    const wago: Terminal['wago'] = direct || cap ? 0 : wires.length <= 2 ? 412 : wires.length <= 3 ? 413 : 415
    return { id, ...meta, wago, chained: 1, wires, cap }
  })
  const lay = boxLayout({ box: el, terminals, devices: [device] })
  const level: Level = checks.some((c) => c.level === 'err') ? 'err' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok'
  if (level === 'ok' && cables.length) checks.push({ level: 'ok', text: `Žile na stezaljke uređaja: ${terminals.filter((t) => !t.id.startsWith('PARK')).map((t) => t.label).join(', ')}.` })
  return { box: el, room, cables, devices: [device], terminals, checks, bom: [], level, size: { W: lay.W, H: lay.H, overflow: false, stacked: false } }
}
// Main earthing terminal (KIP): one busbar; the FeZn foundation-electrode tail is bolted to it, every cable is a
// single green-yellow conductor going straight onto the bar (Cu 16 to the board, Cu 6 bonding to pipes and tanks).
function kipJunctionFor(el: WallElement, p: Project): Junction {
  const room = p.rooms.find((r) => r.id === el.roomId)!
  const checks: Check[] = []
  const resolved = p.cables.filter((c) => isAtBox(c, el)).map((c) => resolveCable(c, el, p))
  const short = (r: Omit<BoxCable, 'wires' | 'side' | 'order'>) => (r.far.element?.type === 'panel' ? 'RO' : (r.cable.note || r.far.element?.label || 'IP').slice(0, 8))
  const seen = new Map<string, number>()
  const ports = ['FeZn', ...resolved.map(short).map((n) => { const k = (seen.get(n) ?? 0) + 1; seen.set(n, k); return k > 1 ? `${n} ${k}` : n })]
  const device: Device = { el, label: `${el.label} sabirnica za izjednačenje potencijala`, ports, wMm: Math.max(40, ports.length * 9), hMm: 16, kind: 'terminal' }
  const cables: BoxCable[] = resolved.map((r, i) => {
    const sect = sectionOf(r.cable.type)
    const toBoard = r.far.element?.type === 'panel'
    const what = toBoard ? 'glavni zaštitni vodič → ormar' : `izjednačenje → ${r.cable.note || r.far.element?.label || 'metalna masa (upiši u bilješku)'}`
    if (!/^pe\b/i.test(r.cable.type)) checks.push({ level: 'warn', text: `${r.label}: za uzemljenje uzmi jednožilni zeleno-žuti vodič (PE Cu), ne ${r.cable.type}.` })
    if (toBoard && sect < 16) checks.push({ level: 'err', text: `${r.label}: glavni zaštitni vodič do ormara mora biti Cu 16 mm² (HD 60364-5-54, 542.3), ima ${sect || '?'} mm².` })
    if (!toBoard && sect < 6) checks.push({ level: 'err', text: `${r.label}: vodič za izjednačenje potencijala mora biti Cu ≥ 6 mm² (HD 60364-5-54, 544.1), ima ${sect || '?'} mm².` })
    const wires: Wire[] = [{ color: 'gnye', terminal: `E:${r.cable.id}`, note: what }]
    const label = r.far.element ? r.label : r.cable.note ? `${r.cable.note} (izjednačenje)` : r.label
    return { ...r, label, ...sideOf(r, el, p), wires, _port: ports[i + 1] } as BoxCable
  })
  if (!cables.some((c) => c.far.element?.type === 'panel')) checks.push({ level: 'warn', text: `${el.label}: nema glavnog zaštitnog vodiča do ormara (Cu 16 mm²). Povuci kabel KIP → ormar.` })
  if (cables.filter((c) => c.far.element?.type !== 'panel').length === 0) checks.push({ level: 'warn', text: `${el.label}: nema vodiča za izjednačenje (Cu 6 mm² na vodovod, grijanje, plin, bojler, metalnu kadu). Kabel do slobodnog kraja s bilješkom što spaja.` })
  const terminals: Terminal[] = cables.map((c, i) => ({
    id: `E:${c.cable.id}`, label: ports[i + 1], desc: c.wires[0].note ?? '', wago: 0, chained: 1,
    wires: [{ kind: 'core', cableId: c.cable.id, cableLabel: c.label, color: 'gnye', note: c.wires[0].note }, { kind: 'port', deviceId: el.id, deviceLabel: device.label, port: ports[i + 1], color: 'gnye' }],
  }))
  const lay = boxLayout({ box: el, terminals, devices: [device] })
  const level: Level = checks.some((c) => c.level === 'err') ? 'err' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok'
  checks.push({ level: 'ok', text: 'Traka FeZn 25×4 iz temelja na sabirnicu: vijak M10 s mjedenom podloškom (Cu na Zn korodira); izlaz iz betona omotati antikorozivnom trakom 30 cm gore i dolje.' })
  return { box: el, room, cables, devices: [device], terminals, checks, bom: [], level, size: { W: lay.W, H: lay.H, overflow: false, stacked: false } }
}
// Problems tied to a cable, gathered from every box and device it touches, for marking the cable itself.
export interface CableIssue { level: 'err' | 'warn'; texts: string[] }
const issueCache = new WeakMap<Project, Map<string, CableIssue>>()
export function cableIssues(p: Project): Map<string, CableIssue> {
  const hit = issueCache.get(p)
  if (hit) return hit
  const out = new Map<string, CableIssue>()
  for (const j of [...allJunctions(p), ...allLeafJunctions(p)]) for (const ch of j.checks) {
    if (!ch.cableId || ch.level === 'ok') continue
    const cable = p.cables.find((c) => c.id === ch.cableId)
    for (const c of cable ? chainCables(cable, p) : []) {
      const cur = out.get(c.id) ?? { level: 'warn' as const, texts: [] }
      if (ch.level === 'err') cur.level = 'err'
      if (!cur.texts.includes(ch.text)) cur.texts.push(ch.text)
      out.set(c.id, cur)
    }
  }
  // one physical cable (corner / conduit segments) drawn with different types on its parts
  const seen = new Set<string>()
  for (const c of p.cables) {
    if (seen.has(c.id)) continue
    const chain = chainCables(c, p)
    chain.forEach((x) => seen.add(x.id))
    const types = [...new Set(chain.map((x) => x.type))]
    if (types.length < 2) continue
    const text = `Isti kabel ima različite tipove po dijelovima (${types.map(cableShort).join(', ')}): odaberi tip na jednom dijelu, primijeni se na cijeli kabel.`
    for (const x of chain) { const cur = out.get(x.id) ?? { level: 'warn' as const, texts: [] }; cur.texts.push(text); out.set(x.id, cur) }
  }
  // a cable off the list is marked wherever it is, also on a segment no box sees (round a corner, to an appliance)
  const stock = p.cableStock
  if (stock) for (const c of p.cables) if (/^NYM/.test(c.type) && !stock.includes(c.type)) {
    const cur = out.get(c.id) ?? { level: 'warn' as const, texts: [] }
    const text = `${cableShort(c.type)} nije na popisu kabela koje koristiš (Postavke projekta).`
    if (!cur.texts.some((t) => t.includes('nije na popisu'))) cur.texts.push(text)
    out.set(c.id, cur)
  }
  issueCache.set(p, out)
  return out
}
export function allLeafJunctions(p: Project): Junction[] {
  return p.elements.filter((e) => isLeaf(e) && p.rooms.some((r) => r.id === e.roomId)).map((e) => leafJunctionFor(e, p))
}

export const roleLabel = (r: Role) => (r === 'unknown' ? 'nepoznato' : CABLE_ROLES[r])

// Wires in fitting order: terminal by terminal, member by member. The key identifies a wire in the drawing and the list.
export interface PlanWire { key: string; terminal: Terminal; port: number; member: TerminalWire; cable?: BoxCable; device?: Device; color: WireColor; note?: string }
export function wirePlan(j: Junction): PlanWire[] {
  const out: PlanWire[] = []
  for (const t of j.terminals) t.wires.forEach((w, port) => {
    const cable = w.kind === 'core' ? j.cables.find((c) => c.cable.id === w.cableId) : undefined
    const device = w.kind === 'port' ? j.devices.find((d) => d.el.id === w.deviceId) : undefined
    out.push({ key: `${t.id}#${port}`, terminal: t, port, member: w, cable, device, color: w.color, note: w.note })
  })
  return out
}

// Physical port of member `i` on a (possibly chained) WAGO: units are bridged first-port ↔ last-port,
// so unit 0 holds members on ports 1–4, middle units on 2–4, the last unit on 2–5.
export function wagoSlot(t: Terminal, i: number): { unit: number; port: number } {
  if (t.chained <= 1) return { unit: 0, port: i }
  if (i < 4) return { unit: 0, port: i }
  let rem = i - 4
  for (let u = 1; u < t.chained - 1; u++) { if (rem < 3) return { unit: u, port: rem + 1 }; rem -= 3 }
  return { unit: t.chained - 1, port: rem + 1 }
}
export const wagoSlotLabel = (t: Terminal, i: number) => { const s = wagoSlot(t, i); return t.chained > 1 ? `WAGO ${s.unit + 1}, port ${s.port + 1}` : `port ${s.port + 1}` }

// Split an overfull box. Candidates move an increasing number of cables (grouped by purpose: sockets, doors,
// passes to other boxes, lights, switches) into a new box 35 cm to the side fed from the old one; each candidate
// is evaluated with the real engine on both boxes, and the first one where both fit wins. If none fits, the best
// (smallest) result is returned and the caller can split again.
export function splitBoxPlan(box: WallElement, p: Project, newId: string, label: string): { newBox: WallElement; moveCableIds: string[]; feed: Omit<Cable, 'id'>; bothFit: boolean } | null {
  const at = p.cables.filter((c) => isAtBox(c, box))
  const resolved = at.map((c) => ({ c, r: resolveCable(c, box, p) }))
  const feeds = resolved.filter(({ r }) => r.role === 'feed').map(({ c }) => c.id)
  const order: Role[] = ['socket', 'motor', 'pass', 'light', 'switch', 'unknown', 'lowv', 'earth']
  const movable = resolved.filter(({ c }) => !feeds.includes(c.id)).sort((a, b) => order.indexOf(a.r.role) - order.indexOf(b.r.role) || a.c.id.localeCompare(b.c.id))
  if (movable.length < 2) return null
  const wall = p.rooms.find((r) => r.id === box.roomId)
  const wallLen = wall ? Math.hypot(wall.points[(box.wall + 1) % wall.points.length].x - wall.points[box.wall].x, wall.points[(box.wall + 1) % wall.points.length].y - wall.points[box.wall].y) / (p.pxPerMeter ?? 100) : 99
  const xM = box.xM + 0.35 <= wallLen - 0.1 ? box.xM + 0.35 : Math.max(0.1, box.xM - 0.35)
  const newBox: WallElement = { ...box, id: newId, label, xM, note: `odvojeno iz ${box.label}` }
  const feed: Omit<Cable, 'id'> = { roomId: box.roomId, wall: box.wall, type: 'NYM-J 5x1.5', from: { kind: 'element', id: box.id }, to: { kind: 'element', id: newId }, via: [], note: '' }
  // fits = one of the project's boxes with no entry / split error
  const fits = (j: Junction) => !j.checks.some((c) => c.level === 'err' && /podijeli|uvodnic/i.test(c.text))
  const area = (j: Junction) => j.size.W * j.size.H
  let best: { ids: string[]; score: number; bothFit: boolean } | null = null
  for (let k = 1; k < movable.length; k++) {
    const ids = movable.slice(0, k).map(({ c }) => c.id)
    const moved = new Set(ids)
    const swap = (e: CableEnd) => (e.kind === 'element' && e.id === box.id ? { ...e, id: newId } : e)
    const trial: Project = { ...p, elements: [...p.elements, newBox], cables: [...p.cables.map((c) => (moved.has(c.id) ? { ...c, from: swap(c.from), to: swap(c.to) } : c)), { ...feed, id: `tmp-${newId}` }] }
    const a = junctionFor(box, trial), b = junctionFor(newBox, trial)
    const bothFit = fits(a) && fits(b)
    const score = area(a) + area(b)
    if (bothFit) return { newBox, moveCableIds: ids, feed, bothFit: true }
    if (!best || score < best.score) best = { ids, score, bothFit }
  }
  return best ? { newBox, moveCableIds: best.ids, feed, bothFit: false } : null
}
