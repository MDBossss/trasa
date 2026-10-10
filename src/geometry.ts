import type { Pt } from './types'

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)

export function polylineLength(pts: Pt[]) {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i])
  return l
}

const O: Pt = { x: 0, y: 0 }

export function snapToGrid(p: Pt, step: number, origin: Pt = O): Pt {
  return {
    x: Math.round((p.x - origin.x) / step) * step + origin.x,
    y: Math.round((p.y - origin.y) / step) * step + origin.y,
  }
}

// Angle snap keeps the point on the grid: ortho segments round the length,
// diagonal ones round the per-axis delta so dx === dy stays on grid nodes.
export function snapPoint(p: Pt, prev: Pt | null, step: number | null, angle: boolean, origin: Pt = O): Pt {
  if (prev && angle) {
    const dx = p.x - prev.x
    const dy = p.y - prev.y
    const k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
    const diag = k % 2 !== 0
    const dir = DIRS[((k % 8) + 8) % 8]
    if (diag) {
      let d = (Math.abs(dx) + Math.abs(dy)) / 2
      if (step) d = Math.round(d / step) * step
      return { x: prev.x + dir.x * d, y: prev.y + dir.y * d }
    }
    let len = Math.abs(dir.x ? dx : dy)
    if (step) len = Math.round(len / step) * step
    return { x: prev.x + dir.x * len, y: prev.y + dir.y * len }
  }
  if (step) return snapToGrid(p, step, origin)
  return p
}

const DIRS: Pt[] = [
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
]

export function projectOnSegment(p: Pt, a: Pt, b: Pt) {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const l2 = abx * abx + aby * aby
  let t = l2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2
  t = Math.max(0, Math.min(1, t))
  const point = { x: a.x + abx * t, y: a.y + aby * t }
  return { t, point, dist: dist(p, point) }
}

export function signedArea(pts: Pt[]) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

// Area-weighted polygon centroid (vertex average drifts on L-shaped rooms).
export function centroid(pts: Pt[]): Pt {
  const a = signedArea(pts)
  if (Math.abs(a) < 1e-9) {
    const n = pts.length
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n }
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function midpointOfPolyline(pts: Pt[]): Pt {
  const total = polylineLength(pts)
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i])
    if (acc + d >= total / 2) {
      const t = d === 0 ? 0 : (total / 2 - acc) / d
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    acc += d
  }
  return pts[0]
}

export function fmtMeters(px: number, pxPerMeter: number | null) {
  if (!pxPerMeter) return `${Math.round(px)} px`
  return `${(px / pxPerMeter).toFixed(2)} m`
}
