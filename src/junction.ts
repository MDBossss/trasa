import { CABLE_ROLES, ELEMENT_META, coreColors, type Cable, type CableEnd, type CableRole, type Conduit, type Project, type Room, type WallElement, type WireColor } from './types'

// Everything a junction box needs: which cables enter it, what each core goes to,
// and which WAGO 221 connectors that takes. Derived from the drawing, nothing is stored.

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
  far: { element?: WallElement; room?: Room; conduit?: Conduit }
}
export interface TerminalWire { cableId: string; cableLabel: string; color: WireColor; note?: string }
export interface Terminal { id: string; label: string; desc: string; wago: 412 | 413 | 415; chained: number; wires: TerminalWire[] }
export interface Check { level: Level; text: string }
export interface Junction { box: WallElement; room: Room; cables: BoxCable[]; terminals: Terminal[]; checks: Check[]; bom: { item: string; qty: number }[]; level: Level }

const otherEnd = (c: Cable, box: WallElement): CableEnd => (c.from.kind === 'element' && c.from.id === box.id ? c.to : c.from)
const isAtBox = (c: Cable, box: WallElement) => (c.from.kind === 'element' && c.from.id === box.id) || (c.to.kind === 'element' && c.to.id === box.id)

// Follow a conduit from one of its exits to whatever cable is bound to its other exit.
function throughConduit(p: Project, conduitId: string, end: 'start' | 'end') {
  const far = end === 'start' ? 'end' : 'start'
  const c = p.cables.find((x) => [x.from, x.to].some((e) => e.kind === 'exit' && e.conduitId === conduitId && e.end === far))
  if (!c) return null
  const e = c.from.kind === 'exit' && c.from.conduitId === conduitId && c.from.end === far ? c.to : c.from
  return { cable: c, end: e }
}

function roleOfElement(el: WallElement): Role {
  switch (el.type) {
    case 'socket': return 'socket'
    case 'light': return 'light'
    case 'switch': return 'switch'
    case 'box': return 'pass'
    case 'panel': return 'feed'
  }
}

export function resolveCable(c: Cable, box: WallElement, p: Project): Omit<BoxCable, 'wires' | 'side' | 'order'> {
  const end = otherEnd(c, box)
  const cores = coreColors(c.type)
  const lowv = cores.length === 0
  let role: Role = 'unknown'
  let label = 'slobodan kraj'
  let far: BoxCable['far'] = {}
  if (end.kind === 'element') {
    const el = p.elements.find((e) => e.id === end.id)
    if (el) { role = roleOfElement(el); label = `${el.label} ${ELEMENT_META[el.type].label.toLowerCase()}`; far = { element: el, room: p.rooms.find((r) => r.id === el.roomId) } }
  } else if (end.kind === 'exit') {
    const cd = p.conduits.find((x) => x.id === end.conduitId)
    far = { conduit: cd }
    if (cd?.categoryId === 'dolaz') { role = 'feed'; label = `${cd.name} ← dolaz` }
    else if (cd) {
      const t = throughConduit(p, cd.id, end.end)
      const tEnd = t?.end
      if (tEnd?.kind === 'element') {
        const el = p.elements.find((e) => e.id === tEnd.id)
        if (el) {
          role = roleOfElement(el)
          const room = p.rooms.find((r) => r.id === el.roomId)
          far = { conduit: cd, element: el, room }
          label = `${cd.name} ${role === 'feed' ? '←' : '→'} ${el.label}${room && room.id !== box.roomId ? ` (${room.name})` : ''}`
        }
      } else label = `${cd.name} → ?`
    }
  }
  if (lowv) role = 'lowv'
  if (c.role && c.role !== 'auto') role = c.role
  return { cable: c, label, sub: c.type, role, cores, far }
}

// Terminal id for the switched phase that feeds a light.
function lightTerminal(light: WallElement, p: Project): { id: string; sw?: WallElement } {
  const sw = p.elements.filter((e) => e.type === 'switch' && e.controls?.includes(light.id))
  if (!sw.length) return { id: `SW:?:${light.id}` }
  const kinds = sw.map((s) => s.switchKind ?? 'obicni')
  if (kinds.some((k) => k === 'izmjenicni' || k === 'krizni')) return { id: `SW:L:${light.id}`, sw: sw[0] }
  const s = sw[0]
  if ((s.switchKind ?? 'obicni') === 'serijski') return { id: `SW:${s.id}:${s.controls!.indexOf(light.id)}`, sw: s }
  return { id: `SW:${s.id}`, sw: s }
}

function wiresFor(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, p: Project, checks: Check[]): Wire[] {
  const { cores, role } = bc
  const park = (c: WireColor, note = 'rezerva'): Wire => ({ color: c, terminal: 'PARK', note })
  const basic = (): Wire[] => cores.map((c) => (c === 'brown' ? { color: c, terminal: 'L' } : c === 'blue' ? { color: c, terminal: 'N' } : c === 'gnye' ? { color: c, terminal: 'PE' } : park(c)))
  if (role === 'lowv') return cores.map((c) => ({ color: c, terminal: null, note: 'slaba struja, prolazi' }))
  if (role === 'unknown') { checks.push({ level: 'warn', text: `${bc.label}: ne znam što je na drugom kraju kabela ${bc.sub}, žile parkirane.` }); return cores.map((c) => park(c, 'nepoznato')) }
  if (role === 'feed' || role === 'pass' || role === 'socket') return basic()
  if (role === 'light') {
    const light = bc.far.element
    const t = light ? lightTerminal(light, p) : { id: 'SW:?' }
    if (light && !t.sw) checks.push({ level: 'warn', text: `Svjetlo ${light.label} ne pali nijedan prekidač. Označi na prekidaču "Pali svjetla".` })
    return cores.map((c) => (c === 'brown' ? { color: c, terminal: t.id, note: 'L svjetla' } : c === 'blue' ? { color: c, terminal: 'N' } : c === 'gnye' ? { color: c, terminal: 'PE' } : park(c)))
  }
  // switch
  const sw = bc.far.element
  const kind = sw?.switchKind ?? 'obicni'
  const lights = (sw?.controls ?? []).map((id) => p.elements.find((e) => e.id === id)).filter((x): x is WallElement => !!x)
  const usable = cores.filter((c) => c !== 'gnye')
  const extra = cores.filter((c) => c === 'gnye').map((c) => park(c, 'prekidač nema PE'))
  const marked = (c: WireColor) => (c === 'blue' ? 'plava označena kao povratna' : undefined)
  if (!sw) return cores.map((c) => park(c, 'nepoznato'))
  if (!lights.length) { checks.push({ level: 'warn', text: `Prekidač ${sw.label} ne pali nijedno svjetlo. Odaberi svjetla u svojstvima prekidača.` }) }
  if (kind === 'obicni' || kind === 'tipkalo') {
    if (kind === 'tipkalo') checks.push({ level: 'warn', text: `${sw.label} je tipkalo: bez releja radi kao obični prekidač. Relej dolazi u sljedećoj fazi.` })
    return [...usable.map((c, i) => (i === 0 ? { color: c, terminal: 'L', note: 'dovod' } : i === 1 ? { color: c, terminal: `SW:${sw.id}`, note: ['povratna', marked(c)].filter(Boolean).join(', ') } : park(c))), ...extra]
  }
  if (kind === 'serijski') {
    if (usable.length < 3) checks.push({ level: 'err', text: `Serijski prekidač ${sw.label} treba 3 žile bez PE (NYM-O 3×1,5 ili 5×1,5), kabel je ${bc.sub}.` })
    if (lights.length < 2) checks.push({ level: 'warn', text: `Serijski prekidač ${sw.label} treba dva svjetla.` })
    return [...usable.map((c, i) => (i === 0 ? { color: c, terminal: 'L', note: 'dovod' } : i <= 2 ? { color: c, terminal: `SW:${sw.id}:${i - 1}`, note: ['povratna ' + i, marked(c)].filter(Boolean).join(', ') } : park(c))), ...extra]
  }
  if (kind === 'izmjenicni') {
    const light = lights[0]
    const partners = light ? p.elements.filter((e) => e.type === 'switch' && e.id !== sw.id && (e.switchKind === 'izmjenicni') && e.controls?.includes(light.id)) : []
    if (!partners.length) checks.push({ level: 'warn', text: `Izmjenični ${sw.label} nema par (drugi izmjenični koji pali isto svjetlo).` })
    const all = [sw, ...partners].sort((a, b) => a.label.localeCompare(b.label))
    const isLast = all[all.length - 1].id === sw.id && all.length > 1
    if (usable.length < 3) checks.push({ level: 'err', text: `Izmjenični ${sw.label} treba 3 žile bez PE (NYM-O 3×1,5), kabel je ${bc.sub}.` })
    const key = light?.id ?? sw.id
    return [...usable.map((c, i) => (i === 0 ? (isLast ? { color: c, terminal: `SW:L:${key}`, note: 'povratna → svjetlo' } : { color: c, terminal: 'L', note: 'dovod' }) : i === 1 ? { color: c, terminal: `PUT1:${key}`, note: 'putna 1' } : i === 2 ? { color: c, terminal: `PUT2:${key}`, note: 'putna 2' } : park(c))), ...extra]
  }
  checks.push({ level: 'warn', text: `Križni ${sw.label}: putne žile idu izravno između prekidača, u kutiji nema spoja.` })
  return cores.map((c) => ({ color: c, terminal: null, note: 'prolazi do drugog prekidača' }))
}

function sideOf(bc: Omit<BoxCable, 'wires' | 'side' | 'order'>, box: WallElement): { side: Side; order: number } {
  const end = otherEnd(bc.cable, box)
  if (end.kind === 'exit') return { side: 'top', order: bc.far.conduit ? bc.far.conduit.points[0].x : 0 }
  if (end.kind === 'free') return { side: 'bottom', order: end.xM }
  const el = bc.far.element
  if (!el || el.roomId !== box.roomId || el.wall !== box.wall) return { side: 'top', order: 0 }
  const dx = el.xM - box.xM, dz = el.zM - box.zM
  if (Math.abs(dz) >= Math.abs(dx)) return { side: dz > 0 ? 'top' : 'bottom', order: el.xM }
  return { side: dx < 0 ? 'left' : 'right', order: -el.zM }
}

function terminalMeta(id: string, p: Project): { label: string; desc: string } {
  if (id === 'L') return { label: 'L', desc: 'faza' }
  if (id === 'N') return { label: 'N', desc: 'nula' }
  if (id === 'PE') return { label: 'PE', desc: 'zaštitni' }
  if (id === 'PARK') return { label: '·', desc: 'parkirano' }
  const [kind, a, b] = id.split(':')
  const el = (x: string) => p.elements.find((e) => e.id === x)
  if (kind === 'PUT1' || kind === 'PUT2') return { label: kind === 'PUT1' ? 'p1' : 'p2', desc: `putna ${kind.slice(-1)} · ${el(a)?.label ?? '?'}` }
  if (a === '?') return { label: '?', desc: `${el(b)?.label ?? 'svjetlo'} bez prekidača` }
  if (a === 'L') return { label: el(b)?.label ?? 'S', desc: 'povratna → svjetlo' }
  const sw = el(a)
  const lights = (sw?.controls ?? []).map((x) => el(x)?.label).filter(Boolean)
  const lbl = b !== undefined ? (el(sw?.controls?.[+b] ?? '')?.label ?? `S${+b + 1}`) : lights.join('+') || 'S'
  return { label: lbl, desc: `povratna ${sw?.label ?? ''} → svjetlo` }
}

// fitting order: feed first, then what it feeds
const ROLE_ORDER: Role[] = ['feed', 'pass', 'socket', 'light', 'switch', 'lowv', 'unknown']
const SIDE_ORDER: Side[] = ['top', 'right', 'bottom', 'left']
const ORDER = (id: string) => (id === 'L' ? 0 : id === 'N' ? 1 : id === 'PE' ? 2 : id.startsWith('SW') ? 3 : id.startsWith('PUT') ? 4 : 5)

export function junctionFor(box: WallElement, p: Project): Junction {
  const room = p.rooms.find((r) => r.id === box.roomId)!
  const checks: Check[] = []
  const cables: BoxCable[] = p.cables
    .filter((c) => isAtBox(c, box))
    .map((c) => { const r = resolveCable(c, box, p); return { ...r, ...sideOf(r, box), wires: wiresFor(r, p, checks) } })
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side) || a.order - b.order)
  const feeds = cables.filter((c) => c.role === 'feed').length
  if (!cables.length) checks.push({ level: 'warn', text: 'U kutiju ne ulazi nijedan kabel.' })
  else if (feeds === 0) checks.push({ level: 'err', text: 'Kutija nema dolaza: nijedan kabel nije napajanje (bužir kategorije Dolaz, ormar, ili uloga "Dolaz").' })
  else if (feeds > 1) checks.push({ level: 'warn', text: `${feeds} dolaza u istu kutiju; obično je jedan.` })

  const map = new Map<string, TerminalWire[]>()
  for (const bc of cables) for (const w of bc.wires) {
    if (!w.terminal) continue
    const id = w.terminal === 'PARK' ? `PARK:${bc.cable.id}:${w.color}` : w.terminal
    if (!map.has(id)) map.set(id, [])
    map.get(id)!.push({ cableId: bc.cable.id, cableLabel: bc.label, color: w.color, note: w.note })
  }
  const terminals: Terminal[] = [...map.entries()]
    .sort((a, b) => ORDER(a[0]) - ORDER(b[0]) || a[0].localeCompare(b[0]))
    .map(([id, wires]) => {
      const n = wires.length
      const wago: 412 | 413 | 415 = n <= 2 ? 412 : n <= 3 ? 413 : 415
      const chained = n <= 5 ? 1 : 1 + Math.ceil((n - 5) / 4)
      const meta = terminalMeta(id.startsWith('PARK') ? 'PARK' : id, p)
      if (id.startsWith('SW:?')) checks.push({ level: 'warn', text: `${meta.desc}: povratna nema para.` })
      if (id.startsWith('SW:') && !id.startsWith('SW:?') && n === 1) checks.push({ level: 'warn', text: `Stezaljka ${meta.label}: samo jedna žila (${wires[0].cableLabel}), nedostaje druga strana.` })
      return { id, ...meta, wago, chained, wires }
    })
  const bom = new Map<string, number>()
  for (const t of terminals) bom.set(`WAGO 221-${t.wago}`, (bom.get(`WAGO 221-${t.wago}`) ?? 0) + t.chained)
  const level: Level = checks.some((c) => c.level === 'err') ? 'err' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok'
  if (level === 'ok' && cables.length) checks.push({ level: 'ok', text: `Sve žile uparene: ${terminals.length} stezaljki, ${cables.length} kabela.` })
  return { box, room, cables, terminals, checks, bom: [...bom.entries()].sort().map(([item, qty]) => ({ item, qty })), level }
}

export function allJunctions(p: Project): Junction[] {
  return p.elements.filter((e) => e.type === 'box' && p.rooms.some((r) => r.id === e.roomId)).map((b) => junctionFor(b, p))
}

export const roleLabel = (r: Role) => (r === 'unknown' ? 'nepoznato' : CABLE_ROLES[r])

// Wires in fitting order: terminal by terminal, port by port. The key identifies a wire in the drawing and the list.
export interface PlanWire { key: string; terminal: Terminal; port: number; cable: BoxCable; color: WireColor; note?: string }
export function wirePlan(j: Junction): PlanWire[] {
  const out: PlanWire[] = []
  for (const t of j.terminals) t.wires.forEach((w, port) => {
    const cable = j.cables.find((c) => c.cable.id === w.cableId)!
    out.push({ key: `${t.id}#${port}`, terminal: t, port, cable, color: w.color, note: w.note })
  })
  return out
}
