export type Pt = { x: number; y: number }

export const DIAMETERS = [16, 20, 25, 32, 40] as const

export interface Conduit {
  id: string
  name: string
  color: string
  diameter: number
  points: Pt[]
  from: string
  to: string
  note: string
}

export interface Wall {
  photo?: string
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
  pxPerMeter: number | null
  gridCm: number
  gridOrigin: Pt
  ceilingM: number
  conduits: Conduit[]
  rooms: Room[]
}

export type Tool = 'select' | 'pan' | 'calibrate' | 'room' | 'conduit' | 'align' | 'origin'

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
    pxPerMeter: null,
    gridCm: 10,
    gridOrigin: { x: 0, y: 0 },
    ceilingM: 2.6,
    conduits: [],
    rooms: [],
  }
}
