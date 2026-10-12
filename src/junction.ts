import { CABLE_ROLES, ELEMENT_META, RELAY_MODELS, SOCKET_KINDS, coreColors, isPlace, modulesOf, type Cable, type CableEnd, type CableRole, type Conduit, type Project, type Room, type WallElement, type WireColor, spareCoresOf, relayModelOf, hostedFront } from './types'

// Everything a box needs: which cables enter it, what each core goes to, which devices sit inside
// and which WAGO 221 connectors (or direct jumpers) that takes. Derived from the drawing, nothing is stored.
//
// Terminal ids ("signals"): L, N, PE, PARK, SW:<switch> (classic return), SW:<switch>:<k> (serijski),
// SW:L:<light> + PUT1/PUT2:<light> (izmjenični), O:<relay>:<n> (relay output), I:<relay>:<i> (relay input).

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
export interface Device { el: WallElement; label: string; ports: string[]; wMm: number; hMm: number; kind: 'relay' | 'button' | 'socket' }
export type TerminalWire =
  | { kind: 'core'; cableId: string; cableLabel: string; color: WireColor; note?: string }
  | { kind: 'port'; deviceId: string; deviceLabel: string; port: string; color: WireColor; note?: string }
export interface Terminal { id: string; label: string; desc: string; wago: 0 | 412 | 413 | 415; chained: number; wires: TerminalWire[]; cap?: boolean }
export interface Check { level: Level; text: string }
export interface Junction { box: WallElement; room: Room; cables: BoxCable[]; devices: Device[]; terminals: Terminal[]; checks: Check[]; bom: { item: string; qty: number }[]; level: Level }

const LNPE = ['L', 'N', 'PE']
const otherEnd = (c: Cable, box: WallElement): CableEnd => (c.from.kind === 'element' && c.from.id === box.id ? c.to : c.from)
const isAtBox = (c: Cable, box: WallElement) => (c.from.kind === 'element' && c.from.id === box.id) || (c.to.kind === 'element' && c.to.id === box.id)
const el = (p: Project, id: string | undefined) => (id ? p.elements.find((e) => e.id === id) : undefined)

// Follow a conduit from one of its exits to whatever cable is bound to its other exit.
function throughConduit(p: Project, conduitId: string, end: 'start' | 'end') {
  const far = end === 'start' ? 'end' : 'start'
  const c = p.cables.find((x) => [x.from, x.to].some((e) => e.kind === 'exit' && e.conduitId === conduitId && e.end === far))
  if (!c) return null
  const e = c.from.kind === 'exit' && c.from.conduitId === conduitId && c.from.end === far ? c.to : c.from
  return { cable: c, end: e }
}

// The other wall's cable that continues from the same corner at about the same height.
function throughCorner(p: Project, c: Cable, end: Extract<CableEnd, { kind: 'corner' }>) {
  const cands = p.cables.filter((x) => x.id !== c.id && x.roomId === c.roomId && x.wall !== c.wall && [x.from, x.to].some((e) => e.kind === 'corner' && e.corner === end.corner && Math.abs(e.zM - end.zM) < 0.3))
  const x = cands.sort((a, b) => cornerDz(a, end) - cornerDz(b, end))[0]
  if (!x) return null
  const mine = x.from.kind === 'corner' && x.from.corner === end.corner ? x.from : x.to
  return { cable: x, end: mine === x.from ? x.to : x.from }
}
const cornerDz = (x: Cable, end: { corner: number; zM: number }) => Math.min(...[x.from, x.to].filter((e): e is Extract<CableEnd, { kind: 'corner' }> => e.kind === 'corner' && e.corner === end.corner).map((e) => Math.abs(e.zM - end.zM)))

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
    if (!cd || cd.categoryId === 'dolaz') return { end, via: [], cable: c }
    const t = throughConduit(p, cd.id, end.end)
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
  if (cd0?.categoryId === 'dolaz') { role = 'feed'; label = `${cd0.name} ← dolaz`; far = { conduit: cd0 } }
  else {
    const f = follow(p, c, end)
    const e = f.end.kind === 'element' ? el(p, f.end.id) : undefined
    if (e) {
      classify(e, cd0)
      if (!cd0 && f.via.length) label = `${f.via.join(' · ')} → ${e.label}`
    } else if (f.via.length) label = `${f.via.join(' · ')} → ?`
    else if (end.kind === 'corner') label = `kut ${end.corner + 1} → ?`
    far = { ...far, conduit: cd0 }
  }
  if (cores.length === 0) role = 'lowv'
  if (c.role && c.role !== 'auto') role = c.role
  return { cable: c, label, sub: c.type, role, cores, far }
}

// A Plus 1 whose output drives a door control unit works as a dry contact (I/O), not as a phase switch.
export const pulseTarget = (relay: WallElement, p: Project) => p.elements.find((e) => e.type === 'motor' && e.feedRelayId === relay.id)

// Terminal id for the phase that feeds a light (relay output or classic switch return).
function lightTerminal(light: WallElement, p: Project): { id: string; by?: WallElement } {
  if (light.feedRelayId) return { id: `O:${light.feedRelayId}:${light.feedOutput ?? 1}`, by: el(p, light.feedRelayId) }
  const sw = p.elements.filter((e) => e.type === 'switch' && !e.relayId && e.controls?.includes(light.id))
  if (!sw.length) return { id: `SW:?:${light.id}` }
  const kinds = sw.map((s) => s.switchKind ?? 'obicni')
  if (kinds.some((k) => k === 'izmjenicni' || k === 'krizni')) return { id: `SW:L:${light.id}`, by: sw[0] }
  const s = sw[0]
  if ((s.switchKind ?? 'obicni') === 'serijski') return { id: `SW:${s.id}:${s.controls!.indexOf(light.id)}`, by: s }
  return { id: `SW:${s.id}`, by: s }
}

// What a switch's conductors carry (cable cores or hosted-button ports): L in, returns out.
function switchSignals(sw: WallElement, p: Project, checks: Check[], usable: number): { terminal: string; note: string }[] {
  const kind = sw.switchKind ?? 'obicni'
  if (sw.relayId) {
    const r = el(p, sw.relayId)
    if (!r) checks.push({ level: 'err', text: `${sw.label}: relej više ne postoji.` })
    if (kind !== 'tipkalo') checks.push({ level: 'warn', text: `${sw.label} je ${kind} na releju: koristi tipkalo ili postavi relej u "toggle/edge" način.` })
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
  if (kind === 'izmjenicni') {
    const light = lights[0]
    const partners = light ? p.elements.filter((e) => e.type === 'switch' && e.id !== sw.id && e.switchKind === 'izmjenicni' && e.controls?.includes(light.id)) : []
    if (!partners.length) checks.push({ level: 'warn', text: `Izmjenični ${sw.label} nema par (drugi izmjenični koji pali isto svjetlo).` })
    if (usable < 3) checks.push({ level: 'err', text: `Izmjenični ${sw.label} treba 3 žile bez PE (NYM-O 3×1,5).` })
    const all = [sw, ...partners].sort((a, b) => a.label.localeCompare(b.label))
    const isLast = all.length > 1 && all[all.length - 1].id === sw.id
    const key = light?.id ?? sw.id
    return [isLast ? { terminal: `SW:L:${key}`, note: 'povratna → svjetlo' } : { terminal: 'L', note: 'dovod' }, { terminal: `PUT1:${key}`, note: 'putna 1' }, { terminal: `PUT2:${key}`, note: 'putna 2' }]
  }
  checks.push({ level: 'warn', text: `Križni ${sw.label}: putne žile idu izravno između prekidača, u kutiji nema spoja.` })
  return []
}

function leafWires(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, p: Project, checks: Check[]): Wire[] {
  const { cores, role } = bc
  const park = (c: WireColor, note = 'rezerva'): Wire => ({ color: c, terminal: 'PARK', note })
  const lnpe = (c: WireColor): Wire => (c === 'brown' ? { color: c, terminal: 'L' } : c === 'blue' ? { color: c, terminal: 'N' } : c === 'gnye' ? { color: c, terminal: 'PE' } : park(c))
  if (role === 'lowv') return cores.map((c) => ({ color: c, terminal: null, note: 'slaba struja, prolazi' }))
  if (role === 'unknown') { checks.push({ level: 'warn', text: `${bc.label}: ne znam što je na drugom kraju kabela ${bc.sub}, žile parkirane.` }); return cores.map((c) => park(c, 'nepoznato')) }
  if (role === 'feed' || role === 'socket' || role === 'pass') return cores.map(lnpe)
  if (role === 'motor') {
    // L N PE feed the control unit; the next two cores are the pulse loop from the relay's I and O
    const m = bc.far.element
    const relay = m?.feedRelayId ? el(p, m.feedRelayId) : undefined
    if (m && !relay) checks.push({ level: 'warn', text: `Vrata ${m.label}: nitko ih ne pali. Odaberi relej (Shelly Plus 1) pod "Pali ga relej".` })
    const spare = cores.filter((c) => c !== 'brown' && c !== 'blue' && c !== 'gnye')
    if (m && relay && spare.length < 2) checks.push({ level: 'err', text: `Kabel do ${m.label} (${bc.sub}) nema 2 slobodne žile za impuls: uzmi 5×1,5.` })
    return cores.map((c) => {
      if (c === 'brown' || c === 'blue' || c === 'gnye') return lnpe(c)
      const k = spare.indexOf(c)
      return relay && k < 2 ? { color: c, terminal: `IMP:${relay.id}:${k + 1}`, note: `impuls ${k + 1}` } : park(c)
    })
  }
  if (role === 'light') {
    const light = bc.far.element
    const t = light ? lightTerminal(light, p) : { id: 'SW:?' }
    if (light && !t.by) checks.push({ level: 'warn', text: `Svjetlo ${light.label} nitko ne pali. Označi ga na prekidaču ("Pali svjetla") ili mu odaberi relej ("Napaja ga").` })
    return cores.map((c) => (c === 'brown' ? { color: c, terminal: t.id, note: 'L svjetla' } : lnpe(c)))
  }
  const sw = bc.far.element
  if (!sw) return cores.map((c) => park(c, 'nepoznato'))
  const usable = cores.filter((c) => c !== 'gnye')
  const sig = switchSignals(sw, p, checks, usable.length)
  if (!sig.length) return cores.map((c) => ({ color: c, terminal: null, note: 'prolazi do drugog prekidača' }))
  return cores.map((c) => {
    if (c === 'gnye') return { color: c, terminal: 'PE', note: 'prekidač nema PE: u dozi presavij i izoliraj' }
    const s = sig[usable.indexOf(c)]
    if (!s) return park(c)
    return { color: c, terminal: s.terminal, note: [s.note, c === 'blue' && s.terminal !== 'L' ? 'plava označena kao povratna' : ''].filter(Boolean).join(', ') }
  })
}

function sideOf(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement): { side: Side; order: number } {
  const end = otherEnd(bc.cable, box)
  if (end.kind === 'exit') return { side: 'top', order: bc.far.conduit ? bc.far.conduit.points[0].x : 0 }
  if (end.kind === 'free') return { side: 'bottom', order: end.xM }
  if (end.kind === 'corner') return { side: end.corner === box.wall ? 'left' : 'right', order: -end.zM }
  const e = bc.far.element
  if (!e || e.roomId !== box.roomId || e.wall !== box.wall) return { side: 'top', order: 0 }
  const dx = e.xM - box.xM, dz = e.zM - box.zM
  if (Math.abs(dz) >= Math.abs(dx)) return { side: dz > 0 ? 'top' : 'bottom', order: e.xM }
  return { side: dx < 0 ? 'left' : 'right', order: -e.zM }
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
      if (e.type === 'socket') { const k = SOCKET_KINDS[e.socketKind ?? 'schuko']; return { el: e, label: `${e.label} ${k.label.toLowerCase()} utičnica`, ports: ['L', 'N', 'PE', 'L′', 'N′', 'PE′'], wMm: Math.max(24, k.modules * 11), hMm: 18, kind: 'socket' as const } }
      return { el: e, label: `${e.label} ${(e.switchKind ?? 'obicni') === 'tipkalo' ? 'tipkalo' : 'prekidač'}${(e.modules ?? 1) > 1 ? ` ${e.modules}M` : ''}`, ports: ['1', '2', '3'].slice(0, (e.switchKind === 'serijski' || e.switchKind === 'izmjenicni') ? 3 : 2), wMm: Math.max(14, (e.modules ?? 1) * 11), hMm: 18, kind: 'button' as const }
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
  if (d.kind === 'socket') {
    // sockets have double terminals per pole: the first one hangs on L/N/PE, the next ones loop from the previous socket
    const chain = hostedFront(p.elements, d.el.host!).filter((e) => e.type === 'socket')
    const i = chain.findIndex((e) => e.id === d.el.id)
    const prev = i > 0 ? chain[i - 1] : null
    const inT = (pole: string) => (prev ? `CH:${pole}:${prev.id}` : pole)
    const out: PortMember[] = [{ port: 'L', terminal: inT('L'), color: 'brown', note: prev ? `s ${prev.label}` : undefined }, { port: 'N', terminal: inT('N'), color: 'blue', note: prev ? `s ${prev.label}` : undefined }, { port: 'PE', terminal: inT('PE'), color: 'gnye', note: prev ? `s ${prev.label}` : undefined }]
    if (i < chain.length - 1) { const nx = chain[i + 1]; for (const pole of ['L', 'N', 'PE'] as const) out.push({ port: `${pole}′`, terminal: `CH:${pole}:${d.el.id}`, color: pole === 'L' ? 'brown' : pole === 'N' ? 'blue' : 'gnye', note: `dalje na ${nx.label}` }) }
    return out
  }
  const sig = switchSignals(d.el, p, checks, 3)
  if (!sig.length) return out
  return sig.map((s, i) => ({ port: `${i + 1}`, terminal: s.terminal, color: i === 0 && s.terminal === 'L' ? 'brown' : 'black', note: s.note }))
}

// Signals a place needs on its own (leaf cables + devices), without place-to-place cables.
function localSignals(place: WallElement, p: Project): Set<string> {
  const out = new Set<string>()
  const sink: Check[] = []
  for (const c of p.cables.filter((x) => isAtBox(x, place))) {
    const r = resolveCable(c, place, p)
    if (r.far.place && r.role !== 'feed') continue
    for (const w of leafWires(r, p, sink)) if (w.terminal && w.terminal !== 'PARK') out.add(w.terminal)
  }
  for (const d of devicesIn(place, p)) for (const m of devicePorts(d, p, sink)) out.add(m.terminal)
  return out
}

// Signals a place-to-place cable must carry: L N PE plus whatever both sides want.
// Which places a cable joins (both ends resolved through conduits / corners / hosted elements).
function cablePlaces(c: Cable, p: Project): [WallElement, WallElement] | null {
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
  const edges = p.cables.map((c) => ({ c, pl: cablePlaces(c, p) })).filter((e): e is { c: Cable; pl: [WallElement, WallElement] } => !!e.pl)
  const adj = new Map<string, { to: string; cable: string }[]>()
  for (const { c, pl } of edges) {
    adj.set(pl[0].id, [...(adj.get(pl[0].id) ?? []), { to: pl[1].id, cable: c.id }])
    adj.set(pl[1].id, [...(adj.get(pl[1].id) ?? []), { to: pl[0].id, cable: c.id }])
  }
  const wants = new Map<string, string[]>()
  for (const pl of places) for (const sgn of localSignals(pl, p)) if (!LNPE.includes(sgn)) wants.set(sgn, [...(wants.get(sgn) ?? []), pl.id])
  const out = new Map<string, Set<string>>()
  for (const [sgn, ids] of wants) {
    if (ids.length < 2) continue
    // BFS from the first place; parent links give the path to every other place that wants the signal
    const parent = new Map<string, { from: string; cable: string } | null>([[ids[0], null]])
    const queue = [ids[0]]
    while (queue.length) { const cur = queue.shift()!; for (const e of adj.get(cur) ?? []) if (!parent.has(e.to)) { parent.set(e.to, { from: cur, cable: e.cable }); queue.push(e.to) } }
    for (const id of ids.slice(1)) {
      let cur = id
      while (parent.get(cur)) { const st = parent.get(cur)!; if (!out.has(st.cable)) out.set(st.cable, new Set()); out.get(st.cable)!.add(sgn); cur = st.from }
    }
  }
  carriersCache.set(p, out)
  return out
}

// Signals a place-to-place cable must carry: L N PE plus the extra signals routed over it.
export function crossSignals(a: WallElement, b: WallElement, p: Project, cableId?: string): string[] {
  if (!cableId) { const sa = localSignals(a, p), sb = localSignals(b, p); return [...LNPE, ...[...sa].filter((s) => sb.has(s) && !LNPE.includes(s)).sort()] }
  return [...LNPE, ...[...(signalCarriers(p).get(cableId) ?? [])].sort()]
}

export interface CableNeeds { signals: string[]; needed: number; has: number; suggest: string; places: [WallElement, WallElement] }
export function cableNeeds(c: Cable, p: Project): CableNeeds | null {
  const places = cablePlaces(c, p)
  if (!places) return null
  const signals = crossSignals(places[0], places[1], p, c.id)
  const has = coreColors(c.type).length
  const needed = signals.length
  const suggest = needed <= 3 ? '3×1,5' : needed <= 5 ? '5×1,5' : needed <= 7 ? '7×1,5' : `${needed} žila (dva kabela)`
  return { signals, needed, has, suggest, places: [places[0], places[1]] }
}

function crossWires(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement, p: Project, checks: Check[]): Wire[] {
  const far = bc.far.place!
  const signals = crossSignals(box, far, p, bc.cable.id)
  const cores = bc.cores
  const extras = signals.filter((s) => !LNPE.includes(s))
  const spare = cores.filter((c) => !['brown', 'blue', 'gnye'].includes(c))
  if (extras.length > spare.length) checks.push({ level: 'err', text: `Kabel ${bc.label} treba ${signals.length} žila (${signals.map((s) => terminalMeta(s, p).label).join(', ')}), ima ${cores.length}. Zamijeni s ${signals.length <= 5 ? '5×1,5' : '7×1,5'}.` })
  let k = 0
  return cores.map((c) => {
    if (c === 'brown') return { color: c, terminal: 'L' }
    if (c === 'blue') return { color: c, terminal: 'N' }
    if (c === 'gnye') return { color: c, terminal: 'PE' }
    const s = extras[k++]
    return s ? { color: c, terminal: s, note: terminalMeta(s, p).desc } : { color: c, terminal: 'PARK', note: 'rezerva' }
  })
}

export function terminalMeta(id: string, p: Project): { label: string; desc: string } {
  if (id === 'L') return { label: 'L', desc: 'faza' }
  if (id === 'N') return { label: 'N', desc: 'nula' }
  if (id === 'PE') return { label: 'PE', desc: 'zaštitni' }
  if (id.startsWith('SI:')) { const [, rid, , k] = id.split(':'); return { label: `S${k}`, desc: `tipkalo → ${el(p, rid)?.label ?? ''} S${k}, niski napon` } }
  if (id.startsWith('JMP:')) return { label: 'L→I', desc: 'premosnica na Shellyju (pali fazom)' }
  if (id.startsWith('IMP:')) { const [, rid, n] = id.split(':'); return { label: `IMP${n}`, desc: `impuls ${el(p, rid)?.label ?? ''}: suhi kontakt, bez napona` } }
  if (id.startsWith('PARK')) return spareCoresOf(p) === 'cap' ? { label: '·', desc: 'rezerva' } : { label: '·', desc: 'parkirano' }
  const [kind, a, b] = id.split(':')
  if (kind === 'CH') return { label: a, desc: `provlačenje ${el(p, b)?.label ?? ''} → sljedeća utičnica` }
  if (kind === 'PUT1' || kind === 'PUT2') return { label: kind === 'PUT1' ? 'p1' : 'p2', desc: `putna ${kind.slice(-1)} · ${el(p, a)?.label ?? '?'}` }
  if (kind === 'O') { const r = el(p, a); const lights = p.elements.filter((e) => e.feedRelayId === a && (e.feedOutput ?? 1) === +b); return { label: lights.map((l) => l.label).join('+') || `O${b}`, desc: `${r?.label ?? 'relej'} izlaz ${b} → svjetlo` } }
  if (kind === 'I') { const r = el(p, a); return { label: `SW${b}`, desc: `${r?.label ?? 'relej'} ulaz ${b} ← tipkalo` } }
  if (a === '?') return { label: '?', desc: `${el(p, b)?.label ?? 'svjetlo'} bez prekidača` }
  if (a === 'L') return { label: el(p, b)?.label ?? 'S', desc: 'povratna → svjetlo' }
  const sw = el(p, a)
  const lights = (sw?.controls ?? []).map((x) => el(p, x)?.label).filter(Boolean)
  const lbl = b !== undefined ? (el(p, sw?.controls?.[+b] ?? '')?.label ?? `S${+b + 1}`) : lights.join('+') || 'S'
  return { label: lbl, desc: `povratna ${sw?.label ?? ''} → svjetlo` }
}

// fitting order: feed first, then what it feeds
const ROLE_ORDER: Role[] = ['feed', 'pass', 'socket', 'light', 'motor', 'switch', 'lowv', 'unknown']
const SIDE_ORDER: Side[] = ['top', 'right', 'bottom', 'left']
// loop-through terminals follow the socket order in the frame, L N PE per socket
const chainPos = (id: string, p: Project) => (id.startsWith('CH:') ? p.elements.findIndex((e) => e.id === id.split(':')[2]) * 3 + ['L', 'N', 'PE'].indexOf(id.split(':')[1]) : 0)
const ORDER = (id: string) => (id === 'L' ? 0 : id === 'N' ? 1 : id === 'PE' ? 2 : id.startsWith('O:') ? 3 : id.startsWith('SW') ? 4 : id.startsWith('I:') ? 5 : id.startsWith('PUT') ? 6 : id.startsWith('CH:') ? 7 : 8)

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

export function junctionFor(box: WallElement, p: Project): Junction {
  const room = p.rooms.find((r) => r.id === box.roomId)!
  const checks: Check[] = []
  const cables: BoxCable[] = p.cables
    .filter((c) => isAtBox(c, box))
    .map((c) => {
      const r = resolveCable(c, box, p)
      const cross = r.far.place && r.far.place.id !== box.id && r.role !== 'feed' && r.role !== 'lowv'
      return { ...r, ...sideOf(r, box), wires: cross ? crossWires(r, box, p, checks) : leafWires(r, p, checks) }
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side) || a.order - b.order)
  const devices = devicesIn(box, p)
  for (const d of devices) if (d.kind === 'relay' && !RELAY_MODELS[relayModelOf(d.el)].dry && pulseTarget(d.el, p)) checks.push({ level: 'err', text: `${d.el.label}: suhi kontakt za vrata ima samo Shelly 1 Gen4; ${RELAY_MODELS[relayModelOf(d.el)].label} pali fazom.` })
  const feeds = cables.filter((c) => c.role === 'feed').length
  const hasL = cables.some((c) => c.wires.some((w) => w.terminal === 'L'))
  const hasN = cables.some((c) => c.wires.some((w) => w.terminal === 'N'))
  if (!cables.length) checks.push({ level: 'warn', text: 'U kutiju ne ulazi nijedan kabel.' })
  else if (box.type === 'box' && feeds === 0 && !isFed(box, p)) checks.push({ level: 'err', text: 'Kutija nema dolaza: ni izravno (bužir kategorije Dolaz, ormar, uloga "Dolaz") ni preko druge kutije koja ga ima.' })
  else if (box.type === 'modbox' && !hasL) checks.push({ level: 'err', text: 'Doza nema faze: treba kabel iz razvodne kutije.' })
  else if (feeds > 1) checks.push({ level: 'warn', text: `${feeds} dolaza u istu kutiju; obično je jedan.` })

  const map = new Map<string, TerminalWire[]>()
  const add = (id: string, w: TerminalWire) => { if (!map.has(id)) map.set(id, []); map.get(id)!.push(w) }
  for (const bc of cables) for (const w of bc.wires) {
    if (!w.terminal) continue
    add(w.terminal === 'PARK' ? `PARK:${bc.cable.id}:${w.color}` : w.terminal, { kind: 'core', cableId: bc.cable.id, cableLabel: bc.label, color: w.color, note: w.note })
  }
  // buttons first (they create the I:/SW: demands), then relays whose SW/O ports only join when something uses them
  const sorted = [...devices].sort((a, b) => (a.kind === 'relay' ? 1 : 0) - (b.kind === 'relay' ? 1 : 0))
  for (const d of sorted) {
    const m = d.kind === 'relay' ? RELAY_MODELS[relayModelOf(d.el)] : null
    if (m?.needsN && !hasN) checks.push({ level: 'err', text: `${d.label} treba nulu (N), a u dozu ne dolazi nula. Dovedi 3×1,5 ili 5×1,5 s N iz razvodne kutije.` })
    if (m && box.depth === 'plitka') checks.push({ level: 'err', text: `${d.label} ne stane u standardnu dozu (≈50 mm). Uzmi duboku (TEM PM7-65 / 65 mm) ili preseli relej u razvodnu kutiju.` })
    if (m && !box.depth && box.type !== 'box') checks.push({ level: 'warn', text: `${d.label}: označi dubinu doze (relej traži duboku, ≥65 mm).` })
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
      add(pm.terminal, { kind: 'port', deviceId: d.el.id, deviceLabel: d.label, port: pm.port, color: pm.color, note: pm.note })
    }
  }
  if (box.type === 'modbox') { const used = devices.reduce((n, d) => n + modulesOf(d.el) + (d.el.gapBefore ?? 0), 0); if (used > (box.modules ?? 3)) checks.push({ level: 'err', text: `Doza je ${box.modules ?? 3}M, a unutra je ${used}M (šuko 2M, tipkalo i euro 1M). Uzmi veću dozu ili makni element.` }) }
  if (devices.filter((d) => d.kind === 'relay').length > 2) checks.push({ level: 'warn', text: `${devices.filter((d) => d.kind === 'relay').length} releja u jednoj dozi: provjeri stane li uz stezaljke.` })

  const terminals: Terminal[] = [...map.entries()]
    .sort((a, b) => ORDER(a[0]) - ORDER(b[0]) || chainPos(a[0], p) - chainPos(b[0], p) || a[0].localeCompare(b[0]))
    .map(([id, wires]) => {
      const n = wires.length
      const direct = n === 2 && wires.some((w) => w.kind === 'port') && !id.startsWith('PARK')
      // a core with nothing to join (spare, or e.g. the only PE in a switch frame) is a spare too
      const lone = n === 1 && wires[0].kind === 'core' && LNPE.includes(id)
      const cap = (id.startsWith('PARK') || lone) && spareCoresOf(p) === 'cap'
      const wago: Terminal['wago'] = direct || cap ? 0 : n <= 2 ? 412 : n <= 3 ? 413 : 415
      const chained = n <= 5 ? 1 : Math.ceil((n - 2) / 3)
      const meta = terminalMeta(id, p)
      if (cap && lone) meta.desc = `${meta.desc}, sam`
      if (id.startsWith('SW:?')) checks.push({ level: 'warn', text: `${meta.desc}: povratna nema para.` })
      else if (!LNPE.includes(id) && !id.startsWith('PARK') && !id.startsWith('CH:') && n === 1) {
        const w = wires[0]
        checks.push({ level: 'warn', text: `Stezaljka ${meta.label} (${meta.desc}): samo ${w.kind === 'core' ? w.cableLabel : `${w.deviceLabel} ${w.port}`}, nedostaje druga strana.` })
      }
      return { id, ...meta, wago, chained, wires, cap }
    })
  const bom = new Map<string, number>()
  for (const t of terminals) if (t.wago) bom.set(`WAGO 221-${t.wago}`, (bom.get(`WAGO 221-${t.wago}`) ?? 0) + t.chained)
  for (const d of devices) if (d.kind === 'relay') { const k = RELAY_MODELS[relayModelOf(d.el)].label; bom.set(k, (bom.get(k) ?? 0) + 1) }
  const level: Level = checks.some((c) => c.level === 'err') ? 'err' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok'
  if (level === 'ok' && cables.length) checks.push({ level: 'ok', text: `Sve žile uparene: ${terminals.length} stezaljki, ${cables.length} kabela${devices.length ? `, ${devices.length} uređaja` : ''}.` })
  return { box, room, cables, devices, terminals, checks, bom: [...bom.entries()].sort().map(([item, qty]) => ({ item, qty })), level }
}

export function allJunctions(p: Project): Junction[] {
  return p.elements.filter((e) => isPlace(e) && !e.host && p.rooms.some((r) => r.id === e.roomId)).map((b) => junctionFor(b, p))
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
