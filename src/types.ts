export type Pt = { x: number; y: number }

export const DIAMETERS = [16, 20, 25, 32, 40] as const

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
}

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
]

export function matchCategory(name: string, categories: Category[]): Category | undefined {
  const n = name.toLowerCase()
  return categories.find((c) => c.keywords.some((k) => k && n.includes(k.toLowerCase())))
}

export interface Wall {
  photo?: string
}

export type ElementType = 'box' | 'socket' | 'switch' | 'light' | 'panel'
export type SwitchKind = 'obicni' | 'serijski' | 'izmjenicni' | 'krizni'

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
}

export type CableEnd =
  | { kind: 'element'; id: string }
  | { kind: 'exit'; conduitId: string; end: 'start' | 'end' }
  | { kind: 'free'; xM: number; zM: number }

export interface Cable {
  id: string
  roomId: string
  wall: number
  type: string
  from: CableEnd
  to: CableEnd
  via: { xM: number; zM: number }[]
  note: string
}

export const CABLE_TYPES = ['NYM-J 3x1.5', 'NYM-J 3x2.5', 'NYM-J 5x1.5', 'NYM-J 5x2.5', 'NYM-J 4x1.5', 'UTP cat6', 'koaks', 'zvono 2x0.75', 'ostalo']

export const ELEMENT_META: Record<ElementType, { label: string; key: string; prefix: string; zM: number }> = {
  box: { label: 'Razvodna kutija', key: 'K', prefix: 'K', zM: 2.3 },
  socket: { label: 'Utičnica', key: 'U', prefix: 'U', zM: 0.3 },
  switch: { label: 'Prekidač', key: 'P', prefix: 'P', zM: 1.05 },
  light: { label: 'Svjetlo', key: 'L', prefix: 'S', zM: 2.6 },
  panel: { label: 'Ormar', key: 'O', prefix: 'RO', zM: 1.5 },
}


export interface Room {
  id: string
  name: string
  points: Pt[]
  walls: Record<number, Wall>
}

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
  conduits: Conduit[]
  rooms: Room[]
  elements: WallElement[]
  cables: Cable[]
  categories: Category[]
}

export type Tool = 'select' | 'pan' | 'calibrate' | 'room' | 'conduit' | 'align' | 'origin'
export type WallTool = 'select' | 'pan' | 'element' | 'cable'

export type View = { kind: 'plan' } | { kind: 'room'; roomId: string; wall: number | null }

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
