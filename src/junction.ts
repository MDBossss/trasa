import { CABLE_ROLES, ELEMENT_META, RELAY_MODELS, coreColors, isPlace, type Cable, type CableEnd, type CableRole, type Conduit, type Project, type Room, type WallElement, type WireColor } from './types'

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
export interface Device { el: WallElement; label: string; ports: string[]; wMm: number; hMm: number; kind: 'relay' | 'button' }
export type TerminalWire =
  | { kind: 'core'; cableId: string; cableLabel: string; color: WireColor; note?: string }
  | { kind: 'port'; deviceId: string; deviceLabel: string; port: string; color: WireColor; note?: string }
export interface Terminal { id: string; label: string; desc: string; wago: 0 | 412 | 413 | 415; chained: number; wires: TerminalWire[] }
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

function roleOfElement(e: WallElement): Role {
  switch (e.type) {
    case 'socket': return 'socket'
    case 'light': case 'ledpsu': return 'light'
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
  if (end.kind === 'element') {
    const e = el(p, end.id)
    if (e) classify(e)
  } else if (end.kind === 'exit') {
    const cd = p.conduits.find((x) => x.id === end.conduitId)
    far = { conduit: cd }
    if (cd?.categoryId === 'dolaz') { role = 'feed'; label = `${cd.name} ← dolaz` }
    else if (cd) {
      const t = throughConduit(p, cd.id, end.end)
      const tEnd = t?.end
      const e = tEnd?.kind === 'element' ? el(p, tEnd.id) : undefined
      if (e) classify(e, cd)
      else label = `${cd.name} → ?`
    }
  }
  if (cores.length === 0) role = 'lowv'
  if (c.role && c.role !== 'auto') role = c.role
  return { cable: c, label, sub: c.type, role, cores, far }
}

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
    if (c === 'gnye') return park(c, 'prekidač nema PE')
    const s = sig[usable.indexOf(c)]
    if (!s) return park(c)
    return { color: c, terminal: s.terminal, note: [s.note, c === 'blue' && s.terminal !== 'L' ? 'plava označena kao povratna' : ''].filter(Boolean).join(', ') }
  })
}

function sideOf(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement): { side: Side; order: number } {
  const end = otherEnd(bc.cable, box)
  if (end.kind === 'exit') return { side: 'top', order: bc.far.conduit ? bc.far.conduit.points[0].x : 0 }
  if (end.kind === 'free') return { side: 'bottom', order: end.xM }
  const e = bc.far.element
  if (!e || e.roomId !== box.roomId || e.wall !== box.wall) return { side: 'top', order: 0 }
  const dx = e.xM - box.xM, dz = e.zM - box.zM
  if (Math.abs(dz) >= Math.abs(dx)) return { side: dz > 0 ? 'top' : 'bottom', order: e.xM }
  return { side: dx < 0 ? 'left' : 'right', order: -e.zM }
}

// Devices sitting inside a place: relays and buttons with host = place.
export function devicesIn(place: WallElement, p: Project): Device[] {
  return p.elements
    .filter((e) => e.host === place.id && (e.type === 'relay' || e.type === 'switch'))
    .map((e) => {
      if (e.type === 'relay') {
        const m = RELAY_MODELS[e.relayModel ?? 'plus1']
        const ports = m.dc ? ['L', 'N'] : ['L', ...(m.needsN ? ['N'] : []), ...Array.from({ length: m.inputs }, (_, i) => `SW${i + 1}`), ...Array.from({ length: m.outputs }, (_, i) => (m.outputs === 1 ? 'O' : `O${i + 1}`))]
        return { el: e, label: `${e.label} ${m.label}`, ports, wMm: 37, hMm: 14, kind: 'relay' as const }
      }
      return { el: e, label: `${e.label} ${(e.switchKind ?? 'obicni') === 'tipkalo' ? 'tipkalo' : 'prekidač'}`, ports: ['1', '2', '3'].slice(0, (e.switchKind === 'serijski' || e.switchKind === 'izmjenicni') ? 3 : 2), wMm: 14, hMm: 18, kind: 'button' as const }
    })
}

type PortMember = { port: string; terminal: string; color: WireColor; note?: string }
function devicePorts(d: Device, p: Project, checks: Check[]): PortMember[] {
  const out: PortMember[] = []
  if (d.kind === 'relay') {
    const m = RELAY_MODELS[d.el.relayModel ?? 'plus1']
    out.push({ port: 'L', terminal: 'L', color: 'brown' })
    if (m.needsN) out.push({ port: 'N', terminal: 'N', color: 'blue' })
    if (m.dc) return out
    for (let i = 1; i <= m.inputs; i++) out.push({ port: `SW${i}`, terminal: `I:${d.el.id}:${i}`, color: 'black', note: `ulaz ${i}` })
    for (let n = 1; n <= m.outputs; n++) out.push({ port: m.outputs === 1 ? 'O' : `O${n}`, terminal: `O:${d.el.id}:${n}`, color: 'black', note: `izlaz ${n}` })
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
export function crossSignals(a: WallElement, b: WallElement, p: Project): string[] {
  const sa = localSignals(a, p), sb = localSignals(b, p)
  const shared = [...sa].filter((s) => sb.has(s) && !LNPE.includes(s)).sort()
  return [...LNPE, ...shared]
}

export interface CableNeeds { signals: string[]; needed: number; has: number; suggest: string; places: [WallElement, WallElement] }
export function cableNeeds(c: Cable, p: Project): CableNeeds | null {
  const ends = [c.from, c.to].map((e) => (e.kind === 'element' ? el(p, e.id) : undefined))
  const places = ends.map((e) => (e?.host ? el(p, e.host) : e)).filter((e): e is WallElement => !!e && isPlace(e))
  if (places.length !== 2 || places[0].id === places[1].id) return null
  const signals = crossSignals(places[0], places[1], p)
  const has = coreColors(c.type).length
  const needed = signals.length
  const suggest = needed <= 3 ? '3×1,5' : needed <= 5 ? '5×1,5' : needed <= 7 ? '7×1,5' : `${needed} žila (dva kabela)`
  return { signals, needed, has, suggest, places: [places[0], places[1]] }
}

function crossWires(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement, p: Project, checks: Check[]): Wire[] {
  const far = bc.far.place!
  const signals = crossSignals(box, far, p)
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
  if (id.startsWith('PARK')) return { label: '·', desc: 'parkirano' }
  const [kind, a, b] = id.split(':')
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
const ROLE_ORDER: Role[] = ['feed', 'pass', 'socket', 'light', 'switch', 'lowv', 'unknown']
const SIDE_ORDER: Side[] = ['top', 'right', 'bottom', 'left']
const ORDER = (id: string) => (id === 'L' ? 0 : id === 'N' ? 1 : id === 'PE' ? 2 : id.startsWith('O:') ? 3 : id.startsWith('SW') ? 4 : id.startsWith('I:') ? 5 : id.startsWith('PUT') ? 6 : 7)

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
  const feeds = cables.filter((c) => c.role === 'feed').length
  const hasL = cables.some((c) => c.wires.some((w) => w.terminal === 'L'))
  const hasN = cables.some((c) => c.wires.some((w) => w.terminal === 'N'))
  if (!cables.length) checks.push({ level: 'warn', text: 'U kutiju ne ulazi nijedan kabel.' })
  else if (box.type === 'box' && feeds === 0) checks.push({ level: 'err', text: 'Kutija nema dolaza: nijedan kabel nije napajanje (bužir kategorije Dolaz, ormar, ili uloga "Dolaz").' })
  else if (box.type === 'modbox' && !hasL) checks.push({ level: 'err', text: 'Doza nema faze: treba kabel iz razvodne kutije.' })
  else if (feeds > 1) checks.push({ level: 'warn', text: `${feeds} dolaza u istu kutiju; obično je jedan.` })

  const map = new Map<string, TerminalWire[]>()
  const add = (id: string, w: TerminalWire) => { if (!map.has(id)) map.set(id, []); map.get(id)!.push(w) }
  for (const bc of cables) for (const w of bc.wires) {
    if (!w.terminal) continue
    add(w.terminal === 'PARK' ? `PARK:${bc.cable.id}:${w.color}` : w.terminal, { kind: 'core', cableId: bc.cable.id, cableLabel: bc.label, color: w.color, note: w.note })
  }
  // buttons first (they create the I:/SW: demands), then relays whose SW/O ports only join when something uses them
  const sorted = [...devices].sort((a, b) => (a.kind === 'button' ? 0 : 1) - (b.kind === 'button' ? 0 : 1))
  for (const d of sorted) {
    const m = d.kind === 'relay' ? RELAY_MODELS[d.el.relayModel ?? 'plus1'] : null
    if (m?.needsN && !hasN) checks.push({ level: 'err', text: `${d.label} treba nulu (N), a u dozu ne dolazi nula. Dovedi 3×1,5 ili 5×1,5 s N iz razvodne kutije.` })
    if (m && box.depth === 'plitka') checks.push({ level: 'err', text: `${d.label} ne stane u plitku dozu. Označi dozu kao duboku (60 mm) ili preseli relej u razvodnu kutiju.` })
    if (m && !box.depth && box.type !== 'box') checks.push({ level: 'warn', text: `${d.label}: označi dubinu doze (relej traži duboku, 60 mm).` })
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
  if (devices.filter((d) => d.kind === 'relay').length > 2) checks.push({ level: 'warn', text: `${devices.filter((d) => d.kind === 'relay').length} releja u jednoj dozi: provjeri stane li uz stezaljke.` })

  const terminals: Terminal[] = [...map.entries()]
    .sort((a, b) => ORDER(a[0]) - ORDER(b[0]) || a[0].localeCompare(b[0]))
    .map(([id, wires]) => {
      const n = wires.length
      const direct = n === 2 && wires.every((w) => w.kind === 'port')
      const wago: Terminal['wago'] = direct ? 0 : n <= 2 ? 412 : n <= 3 ? 413 : 415
      const chained = n <= 5 ? 1 : 1 + Math.ceil((n - 5) / 4)
      const meta = terminalMeta(id, p)
      if (id.startsWith('SW:?')) checks.push({ level: 'warn', text: `${meta.desc}: povratna nema para.` })
      else if (!LNPE.includes(id) && !id.startsWith('PARK') && n === 1) {
        const w = wires[0]
        checks.push({ level: 'warn', text: `Stezaljka ${meta.label} (${meta.desc}): samo ${w.kind === 'core' ? w.cableLabel : `${w.deviceLabel} ${w.port}`}, nedostaje druga strana.` })
      }
      return { id, ...meta, wago, chained, wires }
    })
  const bom = new Map<string, number>()
  for (const t of terminals) if (t.wago) bom.set(`WAGO 221-${t.wago}`, (bom.get(`WAGO 221-${t.wago}`) ?? 0) + t.chained)
  for (const d of devices) if (d.kind === 'relay') { const k = RELAY_MODELS[d.el.relayModel ?? 'plus1'].label; bom.set(k, (bom.get(k) ?? 0) + 1) }
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
