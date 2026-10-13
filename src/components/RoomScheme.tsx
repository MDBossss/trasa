import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { wirePlan, type Junction } from '../junction'
import { cableColor, cablePath, wallExits, type WallInfo } from '../walls'
import { ELEMENT_META, isPlace, type WallElement } from '../types'
import { Hud } from './Hud'
import { JunctionCanvas, junctionAnchors, junctionViewBox } from './JunctionCanvas'

// The room's walls unfolded side by side, every box drawn where it sits, and each cable continuing
// from the sheath on the box drawing to the other box, the light, the socket or the conduit exit,
// with the same bends as on the wall photo. One pannable, zoomable board.

const K = 320 // px per metre of wall
const BOX_SCALE = 0.5 // junction drawings are shrunk so neighbours rarely overlap
const WALL_GAP = 60, PAD = 80

export function RoomScheme({ junctions, roomId, onOpen }: { junctions: Junction[]; roomId: string; onOpen: (boxId: string) => void }) {
  const project = useStore((s) => s.project)
  const room = project.rooms.find((r) => r.id === roomId)
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 })
  const ppm = project.pxPerMeter ?? 100
  const H = project.ceilingM * K

  const walls = useMemo(() => (room ? wallExits(room, project.conduits, ppm) : []), [room, project.conduits, ppm])
  // walls unfold left to right; a wide room wraps into two or three rows so the board stays near screen shape
  const ROW_H = H + 150
  const slots = useMemo(() => {
    const total = walls.reduce((n, w) => n + w.lengthM * K + WALL_GAP, 0)
    const rows = Math.max(1, Math.round(Math.sqrt(total / (ROW_H * 1.8))))
    const limit = total / rows + 1
    let x = PAD, row = 0
    return walls.map((w) => {
      const width = w.lengthM * K
      if (x > PAD && x + width - PAD > limit) { row += 1; x = PAD }
      const s = { w, x, y: PAD + row * ROW_H, width }
      x += width + WALL_GAP
      return s
    })
  }, [walls, ROW_H])
  const boardW = Math.max(...slots.map((s) => s.x + s.width), 0) + PAD
  const boardH = Math.max(...slots.map((s) => s.y), 0) + H + PAD + 60
  const toBoard = (wall: number, xM: number, zM: number) => { const sl = slots[wall]; return sl ? { x: sl.x + xM * K, y: sl.y + (project.ceilingM - zM) * K } : { x: 0, y: 0 } }

  const js = useMemo(() => junctions.filter((j) => j.room.id === roomId), [junctions, roomId])
  const boxes = useMemo(() => js.map((j) => {
    const a = junctionAnchors(j)
    const c = toBoard(j.box.wall, j.box.xM, j.box.zM)
    const tx = c.x - a.cx * BOX_SCALE, ty = c.y - a.cy * BOX_SCALE
    const stubs = new Map([...a.stubs].map(([id, s]) => [id, { x: tx + s.x * BOX_SCALE, y: ty + s.y * BOX_SCALE, n: s.n }]))
    return { j, tx, ty, stubs, plan: wirePlan(j), vb: junctionViewBox(j) }
  }), [js, slots]) // eslint-disable-line react-hooks/exhaustive-deps
  const stubOf = (cableId: string, elId: string) => boxes.find((b) => b.j.box.id === elId)?.stubs.get(cableId)

  // cables: from a box stub (or element / exit / corner / free point) through its bends to the other end
  const cables = useMemo(() => {
    if (!room) return []
    return project.cables.filter((c) => c.roomId === room.id && walls[c.wall]).map((c) => {
      const wall = walls[c.wall]
      const elements = project.elements.filter((e) => e.roomId === room.id && e.wall === c.wall)
      const path = cablePath(c, { wall, elements, ceilingM: project.ceilingM })
      if (!path) return null
      const pts = path.map((p) => toBoard(c.wall, p.xM, p.zM))
      const endPt = (end: typeof c.from, i: 0 | -1) => {
        if (end.kind !== 'element') return null
        const el = project.elements.find((e) => e.id === end.id)
        const target = el?.host ? project.elements.find((e) => e.id === el.host) : el
        if (!target || !isPlace(target)) return null
        const st = stubOf(c.id, target.id)
        return st ? { pt: { x: st.x, y: st.y }, n: st.n, i } : null
      }
      const a = endPt(c.from, 0), b = endPt(c.to, -1)
      if (a) pts[0] = a.pt
      if (b) pts[pts.length - 1] = b.pt
      // leave the box along the sheath direction before heading off
      const lead = (p: { x: number; y: number }, n: [number, number]) => ({ x: p.x + n[0] * 26, y: p.y + n[1] * 26 })
      const full = [...(a ? [a.pt, lead(a.pt, a.n)] : [pts[0]]), ...pts.slice(1, -1), ...(b ? [lead(b.pt, b.n), b.pt] : [pts[pts.length - 1]])]
      const d = 'M' + full.map((p) => `${p.x},${p.y}`).join(' L')
      const mid = full[Math.floor(full.length / 2)]
      return { c, d, color: cableColor(c, project), mid, len: full.length }
    }).filter((x): x is NonNullable<typeof x> => !!x)
  }, [project, room, walls, boxes]) // eslint-disable-line react-hooks/exhaustive-deps

  const markers = useMemo(() => room ? project.elements.filter((e) => e.roomId === room.id && !e.host && !isPlace(e) && walls[e.wall]).map((e) => ({ e, ...toBoard(e.wall, e.xM, e.zM) })) : [], [project, room, walls]) // eslint-disable-line react-hooks/exhaustive-deps
  const exits = useMemo(() => walls.flatMap((w) => w.exits.map((ex) => ({ ex, ...toBoard(w.i, ex.posM, ex.zM ?? project.ceilingM) }))), [walls]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = wrap.current!
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = () => {
    if (!size.w || !boardW) return
    const scale = Math.min(size.w / boardW, size.h / boardH, 1.5) * 0.96
    setCam({ scale, x: (size.w - boardW * scale) / 2, y: (size.h - boardH * scale) / 2 })
  }
  const fitted = useRef('')
  useEffect(() => { const k = `${roomId}:${size.w}x${size.h}:${boardW}`; if (fitted.current !== k && size.w) { fitted.current = k; fit() } }, [roomId, size, boardW]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (factor: number, cx: number, cy: number) => setCam((c) => {
    const scale = Math.max(0.1, Math.min(4, c.scale * factor))
    return { scale, x: cx - ((cx - c.x) / c.scale) * scale, y: cy - ((cy - c.y) / c.scale) * scale }
  })
  useEffect(() => {
    const el = wrap.current!
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); const f = e.ctrlKey || e.metaKey ? 1.03 : 1.1; zoomAt(e.deltaY > 0 ? 1 / f : f, e.clientX - r.left, e.clientY - r.top) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; dist?: number; moved: boolean; box?: string } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // pointer capture sends the click to the board, so remember which box was pressed and open it on release
    const box = (e.target as HTMLElement).closest('.sbox') as HTMLElement | null
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, box: box?.dataset.box }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...ptrs.current.values()]
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const r = wrap.current!.getBoundingClientRect()
      if (drag.current.dist) zoomAt(d / drag.current.dist, (pts[0].x + pts[1].x) / 2 - r.left, (pts[0].y + pts[1].y) / 2 - r.top)
      drag.current.dist = d
      return
    }
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true
    setCam((c) => ({ ...c, x: drag.current!.cx + dx, y: drag.current!.cy + dy }))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size) { if (drag.current) drag.current.dist = undefined; return }
    const d = drag.current
    drag.current = null
    if (d && !d.moved && d.box) onOpen(d.box)
  }

  if (!room) return null
  const sizeLabel = (j: Junction) => j.box.type === 'modbox' ? `doza ${j.box.modules ?? 3}M` : `kutija ${j.size.W / 10 + 1} × ${j.size.H / 10 + 1}`
  return (
    <div ref={wrap} className="scheme" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <Hud scale={cam.scale} onZoomIn={() => zoomAt(1.2, size.w / 2, size.h / 2)} onZoomOut={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)} onFit={fit} toggles={[]} hint={<><b>Cijela soba</b> · zidovi razmotani u niz · vuci za pomicanje · kotačić zumira · klik na kutiju otvara korake</>} />
      {!js.length && <div className="empty"><div>U ovoj sobi nema kutija ni doza</div></div>}
      <div className="scheme-layer" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`, width: boardW, height: boardH }}>
        <svg className="scheme-links" width={boardW} height={boardH}>
          {slots.map((sl) => (
            <g key={sl.w.i}>
              <rect x={sl.x} y={sl.y} width={sl.width} height={H} fill="var(--panel)" stroke="var(--line)" />
              <text x={sl.x + 8} y={sl.y + H + 22} fontSize={15} fontWeight={700} fill="var(--muted)">ZID {sl.w.i + 1} · {sl.w.lengthM.toFixed(2)} m</text>
              {Array.from({ length: Math.floor(sl.w.lengthM) }, (_, m) => <g key={m}><line x1={sl.x + (m + 1) * K} y1={sl.y + H} x2={sl.x + (m + 1) * K} y2={sl.y + H + 8} stroke="var(--muted)" /><text x={sl.x + (m + 1) * K} y={sl.y + H + 22} textAnchor="middle" fontSize={11} fill="var(--muted)">{m + 1} m</text></g>)}
            </g>
          ))}
          {exits.map(({ ex, x, y }) => (
            <g key={`${ex.conduit.id}:${ex.end}`}>
              <line x1={x} y1={y - 40} x2={x} y2={y} stroke={ex.conduit.color} strokeWidth={5} strokeDasharray="8 5" opacity={0.7} />
              <circle cx={x} cy={y} r={9} fill={ex.conduit.color} stroke="#fff" strokeWidth={2} />
              <text x={x} y={y - 46} textAnchor="middle" fontSize={12} fontWeight={700} fill={ex.conduit.color} className="scheme-link-text">{ex.conduit.name}</text>
            </g>
          ))}
          {cables.map(({ c, d, color, mid }) => (
            <g key={c.id}>
              <path d={d} fill="none" stroke="#fff" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
              <path d={d} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
              <text x={mid.x} y={mid.y - 7} textAnchor="middle" fontSize={11} className="scheme-link-text">{c.type}</text>
            </g>
          ))}
          {markers.map(({ e, x, y }) => (
            <g key={e.id}>
              <circle cx={x} cy={y} r={13} fill="#fff" stroke="#1f2430" strokeWidth={2} />
              <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1f2430">{ELEMENT_META[e.type].key}</text>
              <text x={x} y={y + 30} textAnchor="middle" fontSize={12} fontWeight={600} className="scheme-link-text">{e.label}</text>
            </g>
          ))}
        </svg>
        {boxes.map(({ j, tx, ty, plan, vb }) => (
          <div key={j.box.id} className="sbox" data-box={j.box.id} style={{ left: tx, top: ty, width: vb.w, height: vb.h, transform: `scale(${BOX_SCALE})` }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(j.box.id) }}>
            <div className="sbox-head"><span className={`dot ${j.level}`} /><b>{j.box.label}</b><span className="muted">{sizeLabel(j)}{j.box.depth ? `, ${j.box.depth}` : ''}</span></div>
            <JunctionCanvas className="sbox-svg" j={j} plan={plan} mode="all" step={0} hover={null} onHover={() => {}} onPick={() => onOpen(j.box.id)} labels={false} />
          </div>
        ))}
      </div>
    </div>
  )
}
export type { WallElement, WallInfo }
