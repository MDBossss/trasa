import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { cablePlaces, wirePlan, type Junction } from '../junction'
import { coreColors } from '../types'
import { Hud } from './Hud'
import { JunctionCanvas, junctionViewBox } from './JunctionCanvas'

// All boxes of one room on one pannable, zoomable board: a card per box (its full drawing),
// rows per wall, and the cables that run box-to-box drawn between the cards.

const CARD_W = 560, HEAD = 40, FOOT = 26, GAP_X = 80, GAP_Y = 110, PAD = 60
type Card = { j: Junction; x: number; y: number; w: number; h: number }

function layoutCards(js: Junction[]): { cards: Card[]; walls: { i: number; y: number }[]; w: number; h: number } {
  const byWall = new Map<number, Junction[]>()
  for (const j of js) byWall.set(j.box.wall, [...(byWall.get(j.box.wall) ?? []), j])
  const cards: Card[] = [], walls: { i: number; y: number }[] = []
  let y = PAD, maxX = 0
  for (const wall of [...byWall.keys()].sort((a, b) => a - b)) {
    const row = byWall.get(wall)!.sort((a, b) => a.box.xM - b.box.xM)
    walls.push({ i: wall, y })
    let x = PAD, rowH = 0
    for (const j of row) {
      const vb = junctionViewBox(j)
      const h = HEAD + (CARD_W * vb.h) / vb.w + FOOT
      cards.push({ j, x, y: y + 34, w: CARD_W, h })
      x += CARD_W + GAP_X
      rowH = Math.max(rowH, h)
    }
    maxX = Math.max(maxX, x - GAP_X)
    y += 34 + rowH + GAP_Y
  }
  return { cards, walls, w: maxX + PAD, h: y - GAP_Y + PAD }
}

export function RoomScheme({ junctions, roomId, onOpen }: { junctions: Junction[]; roomId: string; onOpen: (boxId: string) => void }) {
  const project = useStore((s) => s.project)
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 })
  const js = useMemo(() => junctions.filter((j) => j.room.id === roomId), [junctions, roomId])
  const lay = useMemo(() => layoutCards(js), [js])
  const plans = useMemo(() => new Map(js.map((j) => [j.box.id, wirePlan(j)])), [js])
  const byBox = useMemo(() => new Map(lay.cards.map((c) => [c.j.box.id, c])), [lay])

  useLayoutEffect(() => {
    const el = wrap.current!
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = () => {
    if (!size.w || !lay.w) return
    const scale = Math.min(size.w / lay.w, size.h / lay.h, 1.2) * 0.96
    setCam({ scale, x: (size.w - lay.w * scale) / 2, y: (size.h - lay.h * scale) / 2 })
  }
  const fitted = useRef('')
  useEffect(() => { const k = `${roomId}:${size.w}x${size.h}:${lay.w}x${lay.h}`; if (fitted.current !== k && size.w) { fitted.current = k; fit() } }, [roomId, size, lay]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (factor: number, cx: number, cy: number) => setCam((c) => {
    const scale = Math.max(0.1, Math.min(4, c.scale * factor))
    return { scale, x: cx - ((cx - c.x) / c.scale) * scale, y: cy - ((cy - c.y) / c.scale) * scale }
  })
  // wheel zooms towards the pointer (pinch on a trackpad arrives as ctrl+wheel), dragging empty board pans
  useEffect(() => {
    const el = wrap.current!
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); const f = e.ctrlKey || e.metaKey ? 1.03 : 1.1; zoomAt(e.deltaY > 0 ? 1 / f : f, e.clientX - r.left, e.clientY - r.top) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; dist?: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }
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
  const onPointerUp = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); if (!ptrs.current.size) drag.current = null; else if (drag.current) drag.current.dist = undefined }

  // box-to-box cables of this room as links between cards; cables leaving the room end in a stub
  const links = useMemo(() => {
    const out: { id: string; d: string; lx: number; ly: number; text: string; dashed: boolean }[] = []
    const seen = new Set<string>()
    for (const c of project.cables) {
      const pl = cablePlaces(c, project)
      if (!pl || seen.has(c.id)) continue
      const a = byBox.get(pl[0].id), b = byBox.get(pl[1].id)
      if (!a && !b) continue
      seen.add(c.id)
      const cores = coreColors(c.type).length
      if (a && b) {
        const horiz = Math.abs((b.x + b.w / 2) - (a.x + a.w / 2)) > Math.abs((b.y + b.h / 2) - (a.y + a.h / 2))
        const [p, q] = horiz ? (a.x < b.x ? [a, b] : [b, a]) : (a.y < b.y ? [a, b] : [b, a])
        const x1 = horiz ? p.x + p.w : p.x + p.w / 2, y1 = horiz ? p.y + p.h / 2 : p.y + p.h
        const x2 = horiz ? q.x : q.x + q.w / 2, y2 = horiz ? q.y + q.h / 2 : q.y
        const d = horiz ? `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
        out.push({ id: c.id, d, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 8, text: `${c.type} · ${cores} žile`, dashed: false })
      } else {
        const here = (a ?? b)!, far = a ? pl[1] : pl[0]
        const room = project.rooms.find((r) => r.id === far.roomId)?.name ?? ''
        const x1 = here.x + here.w, y1 = here.y + here.h - 30
        out.push({ id: c.id, d: `M${x1},${y1} L${x1 + 70},${y1}`, lx: x1 + 76, ly: y1 + 4, text: `→ ${far.label} (${room}) · ${c.type}`, dashed: true })
      }
    }
    return out
  }, [project, byBox])

  const labelFor = (j: Junction) => j.box.type === 'modbox' ? `doza ${j.box.modules ?? 3}M` : `kutija ${j.size.W / 10 + 1} × ${j.size.H / 10 + 1}`
  return (
    <div ref={wrap} className="scheme" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <Hud scale={cam.scale} onZoomIn={() => zoomAt(1.2, size.w / 2, size.h / 2)} onZoomOut={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)} onFit={fit} toggles={[]} hint={<><b>Cijela soba</b> · vuci za pomicanje · kotačić zumira · "Otvori" na kartici daje korake</>} />
      {!js.length && <div className="empty"><div>U ovoj sobi nema kutija ni doza</div></div>}
      <div className="scheme-layer" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`, width: lay.w, height: lay.h }}>
        <svg className="scheme-links" width={lay.w} height={lay.h}>
          {links.map((l) => (
            <g key={l.id}>
              <path d={l.d} fill="none" stroke="var(--muted)" strokeWidth={3} strokeDasharray={l.dashed ? '8 6' : undefined} opacity={0.7} />
              <text x={l.lx} y={l.ly} textAnchor={l.dashed ? 'start' : 'middle'} fontSize={12} fill="var(--fg, currentColor)" className="scheme-link-text">{l.text}</text>
            </g>
          ))}
        </svg>
        {lay.walls.map((w) => <div key={w.i} className="swall" style={{ left: PAD, top: w.y }}>Zid {w.i + 1}</div>)}
        {lay.cards.map((c) => (
          <div key={c.j.box.id} className="scard" style={{ left: c.x, top: c.y, width: c.w }}>
            <div className="scard-head">
              <span className={`dot ${c.j.level}`} />
              <b>{c.j.box.label}</b>
              <span className="muted">{labelFor(c.j)}{c.j.box.depth ? `, ${c.j.box.depth}` : ''} · {c.j.cables.length} kab.{c.j.devices.length ? ` · ${c.j.devices.length} ur.` : ''}</span>
              <button className="mini" onClick={() => onOpen(c.j.box.id)}>Otvori</button>
            </div>
            <JunctionCanvas className="scard-svg" j={c.j} plan={plans.get(c.j.box.id) ?? []} mode="all" step={0} hover={null} onHover={() => {}} onPick={() => onOpen(c.j.box.id)} />
            <div className="scard-foot muted">{c.j.bom.map((b) => `${b.item} × ${b.qty}`).join(' · ') || 'bez stezaljki'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
