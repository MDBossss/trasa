export type Pt = { x: number; y: number }

// 0 = no conduit: the cable runs in a chased groove / above the ceiling
export const DIAMETERS = [16, 20, 25, 32, 40, 0] as const
export const conduitLabel = (c: { diameter: number }) => (c.diameter ? `ø${c.diameter}` : 'žlijeb, bez bužira')

export interface Conduit {
  id: string
  name: string
  color: string
  categoryId?: string
  diameter: number
  points: Pt[]
  from: string
  to: string
  note: string
  // height from floor (m) where each end leaves the wall; undefined = ceiling
  exitZ?: { start?: number; end?: number }
  // brings the supply from the board, whatever its category (e.g. a TODO conduit that will be a feed)
  feed?: boolean
}
export const isFeedConduit = (c: { categoryId?: string; feed?: boolean } | undefined) => !!c && (c.categoryId === 'dolaz' || !!c.feed)

// A category gives conduits a constant colour; keywords in the conduit name assign it automatically.
export interface Category {
  id: string
  name: string
  color: string
  keywords: string[]
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'struja', name: 'Struja', color: '#e6194b', keywords: ['struja', 'uticnic', 'utičnic', 'prekidac', 'prekidač'] },
  { id: 'dolaz', name: 'Dolaz / napajanje', color: '#1f2430', keywords: ['dolaz', 'napajanje', 'ormar', 'glavni'] },
  { id: 'internet', name: 'Internet / LAN', color: '#4363d8', keywords: ['internet', 'lan', 'utp', 'mreza', 'mreža', 'wifi', 'router'] },
  { id: 'tv', name: 'TV / SAT', color: '#911eb4', keywords: ['tv', 'sat', 'koaks', 'antena'] },
  { id: 'rasvjeta', name: 'Rasvjeta', color: '#3cb44b', keywords: ['rasvjet', 'svjetlo', 'lampa', 'led'] },
  { id: 'zvono', name: 'Zvono / interfon', color: '#f58231', keywords: ['zvono', 'interfon', 'portafon'] },
  { id: 'alarm', name: 'Alarm / kamere', color: '#fabe00', keywords: ['alarm', 'kamer', 'senzor'] },
  { id: 'grijanje', name: 'Grijanje / termostat', color: '#9a6324', keywords: ['grijanje', 'termostat', 'bojler', 'klima'] },
  // planned but not pulled yet: counted like any other conduit, drawn dashed in turquoise
  { id: 'todo', name: 'TODO (još nije napravljen)', color: '#06b6b4', keywords: ['todo', 'planiran'] },
]
// categories added to the defaults after a project was saved are appended to it on load
export const withDefaultCategories = (cats: Category[] | undefined) => { const have = new Set((cats ?? []).map((c) => c.id)); return [...(cats ?? DEFAULT_CATEGORIES).map((c) => ({ ...c, keywords: [...c.keywords] })), ...DEFAULT_CATEGORIES.filter((c) => cats && !have.has(c.id)).map((c) => ({ ...c, keywords: [...c.keywords] }))] }

export function matchCategory(name: string, categories: Category[]): Category | undefined {
  const n = name.toLowerCase()
  return categories.find((c) => c.keywords.some((k) => k && n.includes(k.toLowerCase())))
}

export interface Wall {
  photo?: string
}

export type ElementType = 'box' | 'socket' | 'switch' | 'light' | 'panel' | 'modbox' | 'relay' | 'ledpsu' | 'motor' | 'kip' | 'boiler'

// Smart relays that sit in a box: inputs are SW terminals, outputs are O terminals.
export type RelayModel = 'gen4' | 'gen4pm' | 'zbminir2' | 'rgbw'
// dry: relay contact is potential-free (I/O), usable as an impulse for a door unit
// swLow: the button input is a low-voltage pair (S1/S2) instead of L-referenced SW
export const RELAY_MODELS: Record<RelayModel, { label: string; inputs: number; outputs: number; needsN: boolean; dim: boolean; dc: boolean; dry: boolean; swLow: boolean; ports: string[]; wMm: number; hMm: number }> = {
  zbminir2: { label: 'Sonoff ZBMINIR2 (Zigbee)', inputs: 1, outputs: 1, needsN: true, dim: false, dc: false, dry: false, swLow: true, ports: ['L', 'N', 'Lout', 'Nout', 'S1', 'S2'], wMm: 40, hMm: 33 },
  // switched output (phase on O) with power metering; for heavier loads such as a water heater
  gen4pm: { label: 'Shelly 1PM Gen4 (Zigbee, mjerenje, 16 A)', inputs: 1, outputs: 1, needsN: true, dim: false, dc: false, dry: false, swLow: false, ports: ['L', 'N', 'SW1', 'O'], wMm: 37, hMm: 42 },
  gen4: { label: 'Shelly 1 Gen4 (Zigbee, suhi kontakt)', inputs: 1, outputs: 1, needsN: true, dim: false, dc: false, dry: true, swLow: false, ports: ['L', 'N', 'SW1', 'I', 'O'], wMm: 37, hMm: 42 },
  rgbw: { label: 'Shelly Plus RGBW PM (24 V)', inputs: 4, outputs: 4, needsN: true, dim: true, dc: true, dry: false, swLow: false, ports: ['L', 'N'], wMm: 37, hMm: 42 },
}
// older saves may carry models that are no longer offered; they land on the nearest current one
const LEGACY_RELAY: Record<string, RelayModel> = { plus1: 'gen4', plus2pm: 'gen4', dimmer: 'gen4', i4: 'gen4', zbminil2: 'zbminir2' }
export type RelayBrand = 'shelly' | 'sonoff'
export const RELAY_LOOK: Record<RelayBrand, { fill: string; stroke: string; text: string }> = { shelly: { fill: '#2563eb', stroke: '#1e40af', text: '#fff' }, sonoff: { fill: '#f0862b', stroke: '#b85e12', text: '#fff' } }
export const relayBrand = (m: RelayModel): RelayBrand => (m.startsWith('zb') ? 'sonoff' : 'shelly')
export const relayModelOf = (e: { relayModel?: string }): RelayModel => (e.relayModel && e.relayModel in RELAY_MODELS ? (e.relayModel as RelayModel) : LEGACY_RELAY[e.relayModel ?? ''] ?? 'zbminir2')
export type SwitchKind = 'obicni' | 'serijski' | 'izmjenicni' | 'krizni' | 'tipkalo'
export type BoxDepth = 'plitka' | 'duboka'
export type SocketKind = 'schuko' | 'euro' | 'rj45' | 'tv'
export const SOCKET_KINDS: Record<SocketKind, { label: string; modules: number }> = { schuko: { label: 'Šuko', modules: 2 }, euro: { label: 'Euro', modules: 1 }, rj45: { label: 'RJ45 internet', modules: 1 }, tv: { label: 'TV antena (koaks)', modules: 1 } }
// a data outlet: a keystone module in a frame, fed by a UTP cable and nothing else
export const DATA_KINDS: SocketKind[] = ['rj45', 'tv']
export const isData = (e: { type: ElementType; socketKind?: SocketKind } | undefined) => !!e && e.type === 'socket' && DATA_KINDS.includes(e.socketKind ?? 'schuko')
export const isUtp = (type: string) => /utp|ftp|cat\s?[5-8]/i.test(type)
// cross-section of a cable type in mm² (NYM 3x1.5 → 1.5, PE Cu 16 mm² → 16)
export const sectionOf = (type: string) => { const m = /(\d+(?:[.,]\d+)?)\s*(?:mm|$)/.exec(type.replace(/^.*[x×]/, '')); return m ? +m[1].replace(',', '.') : 0 }
export const isCoax = (type: string) => /koaks|coax|rg-?6|rg-?59/i.test(type)
// which data outlet a signal cable lands on
export const dataKindOf = (type: string): SocketKind | null => (isUtp(type) ? 'rj45' : isCoax(type) ? 'tv' : null)
// how the cable is drawn in the frame: one wire with the termination note
export const DATA_META: Record<'rj45' | 'tv', { port: string; wire: string; name: string; item: string; conduitCat: string }> = {
  rj45: { port: 'UTP', wire: '8 žila → keystone, T568B', name: 'RJ45 keystone', item: 'RJ45 keystone modul 1M (cat.6)', conduitCat: 'internet' },
  tv: { port: 'ANT', wire: 'koaks → F-konektor', name: 'TV antenska utičnica', item: 'TV/SAT antenska utičnica 1M (F-konektor)', conduitCat: 'tv' },
}
// position inside a modular frame: explicit order (left → right) and empty modules kept free on the left
export const hostedFront = (elements: WallElement[], hostId: string) =>
  elements.map((e, i) => ({ e, i })).filter(({ e }) => e.host === hostId && e.type !== 'relay').sort((a, b) => (a.e.slotOrder ?? 1e9) - (b.e.slotOrder ?? 1e9) || a.i - b.i).map(({ e }) => e)
// A new front element takes the first free run of modules it fits in (gaps first, then the end);
// returns the elements with slotOrder / gapBefore rebuilt for that frame.
export function placeInFrame(elements: WallElement[], hostId: string, newId: string): WallElement[] {
  const size = (e: WallElement) => Math.max(1, modulesOf(e))
  const front = hostedFront(elements, hostId)
  const fresh = front.find((e) => e.id === newId)
  if (!fresh) return elements
  const others = front.filter((e) => e.id !== newId)
  let pos = 0
  const placed = others.map((e) => { pos += e.gapBefore ?? 0; const st = pos; pos += size(e); return { e, st } })
  // first gap that fits, else right after the last one
  let st = -1, cursor = 0
  for (const q of placed) { if (q.st - cursor >= size(fresh)) { st = cursor; break } cursor = q.st + size(q.e) }
  if (st < 0) st = cursor
  const all = [...placed, { e: fresh, st }].sort((a, b) => a.st - b.st)
  const patch = new Map<string, Partial<WallElement>>()
  let end = 0
  all.forEach(({ e, st: s2 }, k) => { patch.set(e.id, { slotOrder: k, gapBefore: s2 - end || undefined }); end = s2 + size(e) })
  return elements.map((e) => (patch.has(e.id) ? { ...e, ...patch.get(e.id) } : e))
}
// After one element changes width, the others keep their absolute modules; only a real overlap pushes a neighbour.
export function keepFramePositions(before: WallElement[], after: WallElement[], hostId: string): WallElement[] {
  const size = (e: WallElement) => Math.max(1, modulesOf(e))
  const starts = new Map<string, number>()
  let pos = 0
  for (const e of hostedFront(before, hostId)) { pos += e.gapBefore ?? 0; starts.set(e.id, pos); pos += size(e) }
  const patch = new Map<string, Partial<WallElement>>()
  let end = 0
  hostedFront(after, hostId).forEach((e, k) => { const st = Math.max(starts.get(e.id) ?? end, end); patch.set(e.id, { slotOrder: k, gapBefore: st - end || undefined }); end = st + size(e) })
  return after.map((e) => (patch.has(e.id) ? { ...e, ...patch.get(e.id) } : e))
}
// modules an element takes inside a modular frame
export const modulesOf = (e: WallElement) => (e.type === 'socket' ? SOCKET_KINDS[e.socketKind ?? 'schuko'].modules : e.type === 'switch' ? (e.modules ?? 1) : 0)

// Placed on a wall: x from the left (inside view), z from the floor, metres.
export interface WallElement {
  id: string
  roomId: string
  wall: number
  type: ElementType
  label: string
  xM: number
  zM: number
  note: string
  switchKind?: SwitchKind
  // flush box depth as seen on the photo; unset means the standard ('plitka'), a relay needs 'duboka'
  depth?: BoxDepth
  // for switches: ids of the lights this switch controls
  controls?: string[]
  // element placed inside another one (relay or button in a box / modular frame); drawn at the host
  host?: string
  // modbox: number of modules in the frame; switch: how many modules it takes (1 or 2)
  modules?: number
  // relay
  relayModel?: RelayModel | string
  slotOrder?: number // place in the frame, left to right
  gapBefore?: number // empty modules kept free on the left of it
  // switch wired to a relay input (1-based) instead of straight to the light
  relayId?: string
  relayInput?: number
  // light / LED supply powered by a relay output (1-based) instead of a classic switch
  feedRelayId?: string
  feedOutput?: number
  // socket: schuko takes 2 modules in a frame, euro 1
  socketKind?: SocketKind
  // LED supply + strip in a niche
  ledM?: number
  ledWpm?: number
  ledV?: 12 | 24
}

export type CableEnd =
  | { kind: 'element'; id: string }
  | { kind: 'exit'; conduitId: string; end: 'start' | 'end' }
  | { kind: 'free'; xM: number; zM: number }
  // the cable runs on around the room corner: corner k sits between wall k-1 and wall k
  | { kind: 'corner'; corner: number; zM: number }

export interface Cable {
  id: string
  roomId: string
  wall: number
  type: string
  from: CableEnd
  to: CableEnd
  via: { xM: number; zM: number }[]
  note: string
  // what the cable does in the box; 'auto' derives it from its ends
  role?: CableRole
  // which supply (feed conduit / board id) this cable's L and N belong to, when a box holds two circuits
  circuit?: string
}

export type CableRole = 'auto' | 'feed' | 'pass' | 'socket' | 'light' | 'switch' | 'motor' | 'lowv' | 'earth'
export const CABLE_ROLES: Record<Exclude<CableRole, 'auto'>, string> = {
  feed: 'Dolaz (napajanje)', pass: 'Prolaz u drugu kutiju', socket: 'Utičnica', light: 'Svjetlo', switch: 'Prekidač', motor: 'Vrata / motor (napajanje + impuls)', lowv: 'Slaba struja', earth: 'Uzemljenje / izjednačenje potencijala',
}

export type WireColor = 'brown' | 'blue' | 'gnye' | 'black' | 'grey' | 'black2' | 'grey2' | 'other'
// core colours by cable type (HD 308 S2); NYM-O has no PE: brown / black / grey
export function coreColors(type: string): WireColor[] {
  const t = type.toLowerCase()
  if (/utp|koaks|zvono|ostalo/.test(t)) return []
  // single green-yellow protective conductor (H07V-K) pulled through a conduit
  if (/^pe\b/.test(t)) return ['gnye']
  const m = /(\d)\s*[x×]/.exec(t)
  const n = m ? +m[1] : 3
  if (t.includes('nym-o')) return n <= 3 ? ['brown', 'black', 'grey'] : ['brown', 'black', 'grey', 'black2']
  if (n <= 3) return ['brown', 'blue', 'gnye']
  if (n === 4) return ['brown', 'black', 'blue', 'gnye']
  if (n === 5) return ['brown', 'black', 'grey', 'blue', 'gnye']
  return ['brown', 'black', 'grey', 'black2', 'grey2', 'blue', 'gnye']
}
export const WIRE_LABEL: Record<WireColor, string> = { brown: 'smeđa', blue: 'plava', gnye: 'žuto-zelena', black: 'crna', grey: 'siva', black2: 'crna 2', grey2: 'siva 2', other: 'UTP' }
export const WIRE_HEX: Record<WireColor, string> = { brown: '#6b3a1e', blue: '#1f4fb3', gnye: '#2e8b3a', black: '#222', grey: '#8c8c8c', black2: '#3a3a3a', grey2: '#a5a5a5', other: '#4a90d9' }

export const CABLE_TYPES = ['NYM-J 3x1.5', 'NYM-J 3x2.5', 'NYM-O 3x1.5', 'NYM-J 5x1.5', 'NYM-J 5x2.5', 'NYM-J 7x1.5', 'NYM-J 4x1.5', 'PE Cu 16 mm²', 'PE Cu 6 mm²', 'UTP cat6', 'koaks', 'zvono 2x0.75', 'ostalo']

export const ELEMENT_META: Record<ElementType, { label: string; key: string; prefix: string; zM: number }> = {
  box: { label: 'Razvodna kutija', key: 'K', prefix: 'K', zM: 2.3 },
  socket: { label: 'Utičnica', key: 'U', prefix: 'U', zM: 0.3 },
  switch: { label: 'Prekidač', key: 'P', prefix: 'P', zM: 1.05 },
  light: { label: 'Svjetlo', key: 'L', prefix: 'S', zM: 2.6 },
  panel: { label: 'Ormar', key: 'O', prefix: 'RO', zM: 1.5 },
  modbox: { label: 'Modularna doza', key: 'M', prefix: 'D', zM: 1.05 },
  relay: { label: 'Relej', key: 'R', prefix: 'R', zM: 1.05 },
  ledpsu: { label: 'LED niša', key: 'N', prefix: 'N', zM: 2.5 },
  // garage door / roller shutter control unit: fed L N PE, driven by a dry-contact pulse from a Shelly Plus 1
  motor: { label: 'Vrata / motor', key: 'D', prefix: 'V', zM: 2.3 },
  // main earthing terminal: the FeZn foundation-electrode tail lands on a busbar; Cu 16 to the board, Cu 6 bonding
  kip: { label: 'KIP · izjednačenje potencijala', key: 'Z', prefix: 'KIP', zM: 1.0 },
  // electric water heater: fixed connection L N PE on its own circuit (3×2,5, B16), via a flush outlet box
  boiler: { label: 'Bojler', key: 'B', prefix: 'BO', zM: 1.8 },
}
// places where cables are joined (have a junction drawing)
export const PLACE_TYPES: ElementType[] = ['box', 'modbox']
export const isPlace = (e: WallElement) => PLACE_TYPES.includes(e.type)
export const isHosted = (e: WallElement) => !!e.host


export interface Room {
  id: string
  name: string
  points: Pt[]
  walls: Record<number, Wall>
}

export type SpareCores = 'wago' | 'cap'
export const spareCoresOf = (p: { spareCores?: SpareCores }): SpareCores => p.spareCores ?? 'wago'

export interface Project {
  version: 1
  name: string
  planImage: string | null
  planSize: { w: number; h: number } | null
  planRotation: 0 | 90 | 180 | 270
  planTilt: number
  planOpacity: number
  pxPerMeter: number | null
  gridCm: number
  gridOrigin: Pt
  ceilingM: number
  // unused cores in a box: each in its own WAGO (the old default) or folded back and insulated with a cap / tape
  spareCores?: SpareCores
  conduits: Conduit[]
  rooms: Room[]
  elements: WallElement[]
  cables: Cable[]
  categories: Category[]
}

export type Tool = 'select' | 'pan' | 'calibrate' | 'room' | 'conduit' | 'align' | 'origin'
export type WallTool = 'select' | 'pan' | 'element' | 'cable'

export type View = { kind: 'plan' } | { kind: 'room'; roomId: string; wall: number | null } | { kind: 'junctions'; elementId: string | null } | { kind: 'bom' } | { kind: 'print'; roomId: string | null } | { kind: 'printbox'; elementId: string }

export const PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
  '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9a6324',
  '#800000', '#aaffc3', '#808000', '#000075',
]

export function emptyProject(): Project {
  return {
    version: 1,
    name: 'Kuća',
    planImage: null,
    planSize: null,
    planRotation: 0,
    planTilt: 0,
    planOpacity: 1,
    pxPerMeter: null,
    gridCm: 10,
    gridOrigin: { x: 0, y: 0 },
    ceilingM: 2.6,
    conduits: [],
    rooms: [],
    elements: [],
    cables: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, keywords: [...c.keywords] })),
  }
}
