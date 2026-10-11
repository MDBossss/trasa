// an end outside the polygon counts only within this distance of a wall (ends inside always count)
export const ROOM_TOL_M = 0.1

import { dist, pointInPolygon, projectOnSegment, signedArea } from './geometry'
import type { Cable, CableEnd, Conduit, Project, Pt, Room, WallElement } from './types'

export interface Exit { conduit: Conduit; end: 'start' | 'end'; posM: number; distM: number; offset: Pt; zM: number | null }
export interface WallInfo { i: number; n: number; cw: boolean; a: Pt; b: Pt; lengthM: number; exits: Exit[] }
// corner index at the left/right edge of a wall as seen from inside, and the wall that continues there
export const cornerAt = (w: Pick<WallInfo, 'i' | 'n' | 'cw'>, side: 'left' | 'right') => ((side === 'left') === w.cw ? w.i : (w.i + 1) % w.n)
export const neighbourWall = (w: Pick<WallInfo, 'i' | 'n' | 'cw'>, side: 'left' | 'right') => (((side === 'left') === w.cw ? w.i - 1 : w.i + 1) + w.n) % w.n

// A conduit endpoint is an exit on its nearest wall (inside: within 0.5 m, outside: ROOM_TOL_M).
// With a clockwise polygon (screen coords) wall i runs left→right as seen from inside.
export function wallExits(room: Room, conduits: Conduit[], ppm: number): WallInfo[] {
  const n = room.points.length
  const cw = signedArea(room.points) > 0
  const walls: WallInfo[] = room.points.map((a, i) => {
    const b = room.points[(i + 1) % n]
    return { i, n, cw, a, b, lengthM: dist(a, b) / ppm, exits: [] }
  })
  for (const c of conduits) {
    for (const end of ['start', 'end'] as const) {
      const p: Pt = end === 'start' ? c.points[0] : c.points[c.points.length - 1]
      const inside = pointInPolygon(p, room.points)
      let best: { w: WallInfo; t: number; distM: number } | null = null
      for (const w of walls) {
        const pr = projectOnSegment(p, w.a, w.b)
        const distM = pr.dist / ppm
        if (distM <= (inside ? 0.5 : ROOM_TOL_M) && (!best || distM < best.distM)) best = { w, t: pr.t, distM }
      }
      if (best) {
        const foot = projectOnSegment(p, best.w.a, best.w.b).point
        best.w.exits.push({ conduit: c, end, posM: (cw ? best.t : 1 - best.t) * best.w.lengthM, distM: best.distM, offset: { x: p.x - foot.x, y: p.y - foot.y }, zM: c.exitZ?.[end] ?? null })
      }
    }
  }
  for (const w of walls) w.exits.sort((x, y) => x.posM - y.posM)
  return walls
}

export interface WallCtx { wall: WallInfo; elements: WallElement[]; ceilingM: number }

export function endPos(end: CableEnd, ctx: WallCtx): { xM: number; zM: number } | null {
  if (end.kind === 'free') return { xM: end.xM, zM: end.zM }
  if (end.kind === 'corner') {
    if (end.corner === cornerAt(ctx.wall, 'left')) return { xM: 0, zM: end.zM }
    if (end.corner === cornerAt(ctx.wall, 'right')) return { xM: ctx.wall.lengthM, zM: end.zM }
    return null
  }
  if (end.kind === 'element') {
    const el = ctx.elements.find((e) => e.id === end.id)
    return el ? { xM: el.xM, zM: el.zM } : null
  }
  const ex = ctx.wall.exits.find((x) => x.conduit.id === end.conduitId && x.end === end.end)
  return ex ? { xM: ex.posM, zM: ex.zM ?? ctx.ceilingM } : null
}

export function cablePath(c: Cable, ctx: WallCtx) {
  const a = endPos(c.from, ctx)
  const b = endPos(c.to, ctx)
  if (!a || !b) return null
  return [a, ...c.via, b]
}

export function cableLengthM(c: Cable, ctx: WallCtx) {
  const path = cablePath(c, ctx)
  if (!path) return 0
  let l = 0
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i].xM - path[i - 1].xM, path[i].zM - path[i - 1].zM)
  return l
}

export function endLabel(end: CableEnd, p: Project) {
  if (end.kind === 'free') return 'slobodan kraj'
  if (end.kind === 'corner') return `kut ${end.corner + 1} (dalje na susjedni zid)`
  if (end.kind === 'element') return p.elements.find((e) => e.id === end.id)?.label ?? '?'
  return `${p.conduits.find((c) => c.id === end.conduitId)?.name ?? '?'} (bužir)`
}

// cables on a conduit take its colour; the rest get a strong orange that reads on photos and bare walls
export const CABLE_COLOR = '#ff6d00'
export function cableColor(c: Cable, p: Project) {
  for (const end of [c.from, c.to]) if (end.kind === 'exit') return p.conduits.find((x) => x.id === end.conduitId)?.color ?? CABLE_COLOR
  return CABLE_COLOR
}

// A conduit "enters" a room when either end is inside it or within 0.5 m of one of its walls.
export function conduitTouchesRoom(c: Conduit, room: Room, ppm: number | null) {
  const tol = (ppm ?? 100) * ROOM_TOL_M
  const ends = [c.points[0], c.points[c.points.length - 1]]
  return ends.some((p) => {
    if (pointInPolygon(p, room.points)) return true
    for (let i = 0; i < room.points.length; i++) {
      if (projectOnSegment(p, room.points[i], room.points[(i + 1) % room.points.length]).dist <= tol) return true
    }
    return false
  })
}
