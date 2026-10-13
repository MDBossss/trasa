import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { cableEnds, cableNeeds, terminalMeta, wirePlan, type Junction } from '../junction'
import { ELEMENT_META, WIRE_LABEL, isPlace } from '../types'
import { coreColors } from '../types'
import { Hud } from './Hud'
import { JunctionCanvas, junctionAnchors, junctionViewBox } from './JunctionCanvas'

// One room as a clean schematic: every box drawn as on its own sheet, laid out left to right in the
// order they sit around the room, and the box-to-box cables drawn as sheaths between the matching
// stubs. Hovering a cable lights its wires up in both boxes and says what it carries.

const BOX_SCALE = 0.6
const GAP_X = 190, PAD = 90, LANE = 34 // lanes above the row carry cables between non-adjacent boxes

export function RoomScheme({ junctions, roomId, onOpen }: { junctions: Junction[]; roomId: string; onOpen: (boxId: string) => void }) {
  const project = useStore((s) => s.project)
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 })
  const [hover, setHover] = useState<string | null>(null)

  // boxes in walking order around the room: wall by wall, left to right on each wall
  const js = useMemo(() => junctions.filter((j) => j.room.id === roomId).sort((a, b) => a.box.wall - b.box.wall || a.box.xM - b.box.xM), [junctions, roomId])
  const rowOf = (j: Junction) => (j.box.zM >= 1.7 ? 0 : j.box.zM >= 0.7 ? 1 : 2)
  const boxes = useMemo(() => {
    const vbs = js.map((j) => junctionViewBox(j))
    const rowH = [0, 1, 2].map((r) => Math.max(0, ...js.map((j, i) => (rowOf(j) === r ? vbs[i].h * BOX_SCALE : 0))))
    const rowY = [PAD + 330, 0, 0]
    rowY[1] = rowY[0] + (rowH[0] ? rowH[0] + 300 : 0)
    rowY[2] = rowY[1] + (rowH[1] ? rowH[1] + 300 : 0)
    let x = PAD
    return js.map((j, i) => {
      const vb = vbs[i], a = junctionAnchors(j)
      const tx = x, ty = rowY[rowOf(j)]
      x += vb.w * BOX_SCALE + GAP_X
      const stubs = new Map([...a.stubs].map(([id, s]) => [id, { x: tx + s.x * BOX_SCALE, y: ty + s.y * BOX_SCALE, n: s.n, cableId: s.cableId }]))
      return { j, tx, ty, vb, stubs, plan: wirePlan(j), order: i }
    })
  }, [js]) // eslint-disable-line react-hooks/exhaustive-deps
  const boardW = (boxes.at(-1) ? boxes.at(-1)!.tx + boxes.at(-1)!.vb.w * BOX_SCALE : 0) + PAD
  const boardH = Math.max(...boxes.map((b) => b.ty + b.vb.h * BOX_SCALE), 0) + PAD + LANE * 3
  const byBox = useMemo(() => new Map(boxes.map((b) => [b.j.box.id, b])), [boxes])

  // cables that join two boxes of this room, as tubes between their stubs; cables leaving the room end in a short tail
  const links = useMemo(() => {
    const seen = new Set<string>()
    let lanes = 0, lanesBelow = 0
    const sideCount = new Map<string, number>()
    const bottom = Math.max(...boxes.map((b) => b.ty + b.vb.h * BOX_SCALE), 0) + 20
    type Link = { id: string; d: string; od: number; label: string; tip: string; mid: { x: number; y: number }; tail: boolean; boxes: string[]; cableIds: string[]; feed?: { x: number; y: number } }
    const out: Link[] = [], feeds: Link[] = []
    for (const bx of boxes) for (const bc of bx.j.cables) {
      if (bc.role !== 'feed') continue
      const st = bx.stubs.get(bc.cable.id)
      if (!st) continue
      const k = sideCount.get(`${bx.j.box.id}:${st.n[0]},${st.n[1]}`) ?? 0
      sideCount.set(`${bx.j.box.id}:${st.n[0]},${st.n[1]}`, k + 1)
      const cores = coreColors(bc.cable.type)
      const od = (cores.length >= 5 ? 11 : /2[.,]5/.test(bc.cable.type) ? 10 : 8.5) * 4 * BOX_SCALE
      const len = 110 + k * (od + 10)
      const end = { x: st.x + st.n[0] * len, y: st.y + st.n[1] * len }
      seen.add(bc.cable.id)
      feeds.push({ id: bc.cable.id, d: `M${st.x},${st.y} L${end.x},${end.y}`, od, label: bc.label, tip: `${bc.label} · ${bc.cable.type} · ${cores.length} žile: dolaz napajanja${bc.far.conduit ? ` (bužir ${bc.far.conduit.name})` : ''}`, mid: { x: (st.x + end.x) / 2, y: (st.y + end.y) / 2 }, tail: false, boxes: [bx.j.box.id], cableIds: [bc.cable.id], feed: { x: end.x + st.n[0] * 22, y: end.y + st.n[1] * 22 } })
    }
    for (const c of project.cables) {
      const ends = cableEnds(c, project)
      if (!ends[0] || !ends[1] || ends[0].id === ends[1].id || seen.has(c.id)) continue
      const pl: [typeof ends[0] & object, typeof ends[0] & object] = [ends[0], ends[1]]
      const a = byBox.get(pl[0].id), b = byBox.get(pl[1].id)
      if (!a && !b) continue
      seen.add(c.id)
      const cores = coreColors(c.type)
      const od = (cores.length >= 5 ? 11 : /2[.,]5/.test(c.type) ? 10 : 8.5) * 4 * BOX_SCALE
      const need = cableNeeds(c, project)
      const carries = need ? need.signals.map((s) => terminalMeta(s, project).label).join(', ') : ''
      const sa = a?.stubs.get(c.id) ?? a?.stubs.get(`to:${pl[1].id}`), sb = b?.stubs.get(c.id) ?? b?.stubs.get(`to:${pl[0].id}`)
      // a corner cable is two segments that both resolve to the same pair: draw it once
      const pair = sa && sb ? [sa.cableId, sb.cableId].sort().join('|') : ''
      if (pair && seen.has(pair)) continue
      if (pair) seen.add(pair)
      if (a && b && sa && sb) {
        // orthogonal route: out of the sheath, then either straight across the gap (neighbours) or up to a lane above the row.
        // Every further cable leaving the same side of a box runs one step further out, so parallel runs never overlap.
        const sideKey = (bx: typeof a, st: typeof sa) => `${bx.j.box.id}:${st.n[0]},${st.n[1]}`
        const ka = (sideCount.get(sideKey(a, sa)) ?? 0), kb = (sideCount.get(sideKey(b, sb)) ?? 0)
        sideCount.set(sideKey(a, sa), ka + 1); sideCount.set(sideKey(b, sb), kb + 1)
        const step = od + 10
        const p1 = { x: sa.x + sa.n[0] * (40 + ka * step), y: sa.y + sa.n[1] * (40 + ka * step) }, p2 = { x: sb.x + sb.n[0] * (40 + kb * step), y: sb.y + sb.n[1] * (40 + kb * step) }
        // neighbours whose sheaths face each other get a direct route across the gap; everything else goes
        // round the row on a lane: above, or below when a sheath leaves the bottom of its box
        const adjacent = Math.abs(a.order - b.order) === 1
        const facingH = sa.n[1] === 0 && sb.n[1] === 0 && sa.n[0] * (p2.x - p1.x) > 0 && sb.n[0] * (p1.x - p2.x) > 0
        const facingV = sa.n[0] === 0 && sb.n[0] === 0 && sa.n[1] * (p2.y - p1.y) > 0 && sb.n[1] * (p1.y - p2.y) > 0
        const facing = facingH || facingV
        let via: { x: number; y: number }[]
        if (adjacent && facingH) { const mx = (p1.x + p2.x) / 2 + (ka - kb) * step * 0.5; via = [{ x: mx, y: p1.y }, { x: mx, y: p2.y }] }
        else if (facingV) { const my = (p1.y + p2.y) / 2 + (ka - kb) * step * 0.5; via = [{ x: p1.x, y: my }, { x: p2.x, y: my }] }
        else {
          const below = sa.n[1] > 0 || sb.n[1] > 0
          const laneY = below ? bottom + LANE * (lanesBelow++ + 1) : PAD + 120 - LANE * (lanes++ + 1)
          via = [{ x: p1.x, y: laneY }, { x: p2.x, y: laneY }]
        }
        const pts = [{ x: sa.x, y: sa.y }, p1, ...via, p2, { x: sb.x, y: sb.y }]
        const d = 'M' + pts.map((q) => `${q.x},${q.y}`).join(' L')
        const mid = facing ? { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) } : { x: (p1.x + p2.x) / 2, y: via[0].y }
        // per core: where it lands on each side (terminal labels from both junctions)
        const bcA = a.j.cables.find((x) => x.cable.id === sa.cableId), bcB = b.j.cables.find((x) => x.cable.id === sb.cableId)
        const lands = (bc: typeof bcA, i: number) => { const w = bc?.wires[i]; return w?.terminal ? terminalMeta(w.terminal, project).label : w?.note ?? '–' }
        const perCore = cores.map((col, i) => `${WIRE_LABEL[col]}: ${pl[0].label} ${lands(bcA, i)} ↔ ${pl[1].label} ${lands(bcB, i)}`).join('\n')
        out.push({ id: c.id, d, od, label: c.type, tip: `${pl[0].label} ↔ ${pl[1].label} · ${c.type} · ${cores.length} žile${carries ? `: ${carries}` : ''}\n${perCore}`, mid, tail: false, boxes: [pl[0].id, pl[1].id], cableIds: [sa.cableId, sb.cableId] })
      } else {
        const here = a ?? b, st = sa ?? sb
        if (!here || !st) continue
        const far = a ? pl[1] : pl[0]
        const room = project.rooms.find((r) => r.id === far.roomId)?.name ?? ''
        const k = sideCount.get(`${here.j.box.id}:${st.n[0]},${st.n[1]}`) ?? 0
        sideCount.set(`${here.j.box.id}:${st.n[0]},${st.n[1]}`, k + 1)
        const p1 = { x: st.x + st.n[0] * (90 + k * (od + 10)), y: st.y + st.n[1] * (90 + k * (od + 10)) }
        out.push({ id: c.id, d: `M${st.x},${st.y} L${p1.x},${p1.y}`, od, label: `→ ${far.label} (${room})`, tip: `${here.j.box.label} → ${far.label} u sobi ${room} · ${c.type} · ${cores.length} žile${carries ? `: ${carries}` : ''}`, mid: { x: p1.x + st.n[0] * 10, y: p1.y + st.n[1] * 10 }, tail: true, boxes: [here.j.box.id], cableIds: [st.cableId] })
      }
    }
    return [...out, ...feeds]
  }, [project, byBox])

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
  useEffect(() => { const k = `${roomId}:${size.w}x${size.h}:${boardW}x${boardH}`; if (fitted.current !== k && size.w) { fitted.current = k; fit() } }, [roomId, size, boardW, boardH]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const sizeLabel = (j: Junction) => j.box.type === 'modbox' ? `doza ${j.box.modules ?? 3}M` : j.box.type === 'box' ? `kutija ${j.size.W / 10 + 1} × ${j.size.H / 10 + 1}` : ELEMENT_META[j.box.type].label.toLowerCase()
  const tubed = useMemo(() => new Set(links.flatMap((l) => l.cableIds)), [links])
  // each side of a corner cable is its own segment, so the box gets the id of its own segment
  const hoverFor = (boxId: string) => { const l = hover ? links.find((x) => x.id === hover) : null; const k = l ? l.boxes.indexOf(boxId) : -1; return l && k >= 0 ? `cable:${l.cableIds[k]}` : null }
  return (
    <div ref={wrap} className="scheme" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <Hud scale={cam.scale} onZoomIn={() => zoomAt(1.2, size.w / 2, size.h / 2)} onZoomOut={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)} onFit={fit} toggles={[]} hint={<><b>Cijela soba</b> · kutije redom kako stoje u sobi · pređi mišem preko kabela · klik na kutiju otvara njen spoj</>} />
      {!js.length && <div className="empty"><div>U ovoj sobi nema kutija ni doza</div></div>}
      <div className="scheme-layer" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`, width: boardW, height: boardH }}>
        <svg className="scheme-links" width={boardW} height={boardH}>
          {links.map((l) => (
            <g key={l.id} className={`slink ${hover === l.id ? 'hl' : hover ? 'dim' : ''}`} data-tip={l.tip} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>
              <path d={l.d} fill="none" stroke="transparent" strokeWidth={l.od + 16} />
              <path d={l.d} fill="none" stroke="#9a978f" strokeWidth={l.od + 2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.tail ? '14 8' : undefined} />
              <path d={l.d} fill="none" stroke="#d9d7cf" strokeWidth={l.od} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.tail ? '14 8' : undefined} />
              <text x={l.mid.x} y={l.mid.y - l.od / 2 - 6} textAnchor={l.tail ? 'start' : 'middle'} fontSize={12} fontWeight={600} className="scheme-link-text">{l.label}</text>
              {l.feed && (
                <g transform={`translate(${l.feed.x}, ${l.feed.y})`}>
                  <rect x={-22} y={-22} width={44} height={44} rx={8} fill="var(--panel)" stroke="var(--text)" strokeWidth={2.5} />
                  <path d="M3,-14 L-7,2 L1,2 L-3,14 L8,-3 L0,-3 Z" fill="#f28c28" stroke="#b35a0c" strokeWidth={1} />
                  <text x={0} y={38} textAnchor="middle" fontSize={11} fontWeight={700} className="scheme-link-text">DOLAZ</text>
                </g>
              )}
            </g>
          ))}
        </svg>
        {boxes.map(({ j, tx, ty, plan, vb }) => (
          <div key={j.box.id} className="sbox" data-box={j.box.id} style={{ left: tx, top: ty, width: vb.w, height: vb.h, transform: `scale(${BOX_SCALE})` }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(j.box.id) }}>
            <div className="sbox-head"><span className={`dot ${j.level}`} /><b>{j.box.label}</b><span className="muted">{sizeLabel(j)}{isPlace(j.box) && j.box.depth ? `, ${j.box.depth}` : ''} · zid {j.box.wall + 1}</span></div>
            <JunctionCanvas className="sbox-svg" j={j} plan={plan} mode="all" step={0} hover={hoverFor(j.box.id)} onHover={() => {}} onPick={() => onOpen(j.box.id)} labels={(c) => !tubed.has(c.cable.id)} />
          </div>
        ))}
      </div>
    </div>
  )
}
