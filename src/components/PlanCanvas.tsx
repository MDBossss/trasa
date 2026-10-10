import { useCallback, useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KImage, Line, Circle, Rect, Shape, Label, Tag, Text, Group } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import useImage from 'use-image'
import { gridStepPx, planDims, useStore } from '../store'
import { centroid, dist, fmtMeters, midpointOfPolyline, polylineLength, snapPoint } from '../geometry'
import type { Pt } from '../types'

type ViewT = { x: number; y: number; scale: number }

export function PlanCanvas() {
  const wrap = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<ViewT>({ x: 0, y: 0, scale: 1 })
  const [draft, setDraft] = useState<Pt[]>([])
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [space, setSpace] = useState(false)
  const [live, setLive] = useState<{ id: string; points: Pt[] } | null>(null)
  const fitted = useRef<string | null>(null)

  const project = useStore((s) => s.project)
  const tool = useStore((s) => s.tool)
  const selectedId = useStore((s) => s.selectedId)
  const showGrid = useStore((s) => s.showGrid)
  const snapGrid = useStore((s) => s.snapGrid)
  const snapAngle = useStore((s) => s.snapAngle)
  const { select, setTool, addConduit, addRoom, updateConduit, updateRoom, patchProject, removeSelected, setTilt } = useStore.getState()

  const [img] = useImage(project.planImage ?? '')
  const step = gridStepPx(project)
  const snapStep = snapGrid ? step : null

  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dims = planDims(project)
  const rot = project.planRotation
  useEffect(() => {
    const key = `${project.planImage?.length}:${rot}`
    if (!img || !dims || fitted.current === key) return
    fitted.current = key
    const scale = Math.min(size.w / dims.w, size.h / dims.h) * 0.95
    setView({ scale, x: (size.w - dims.w * scale) / 2, y: (size.h - dims.h * scale) / 2 })
  }, [img, size, project.planImage, rot, dims])

  useEffect(() => {
    setDraft([])
  }, [tool])

  const toImg = useCallback((): Pt | null => {
    const st = stageRef.current
    const p = st?.getPointerPosition()
    if (!st || !p) return null
    return { x: (p.x - st.x()) / st.scaleX(), y: (p.y - st.y()) / st.scaleY() }
  }, [])

  const snapped = useCallback(
    (p: Pt, prev: Pt | null) => snapPoint(p, prev, snapStep, snapAngle),
    [snapStep, snapAngle],
  )

  const finishDraft = useCallback(() => {
    const pts = draft.filter((p, i) => i === 0 || dist(p, draft[i - 1]) > 0.5)
    setDraft([])
    if (tool === 'conduit' && pts.length >= 2) addConduit(pts)
    if (tool === 'room' && pts.length >= 3) {
      const name = window.prompt('Naziv sobe', `Soba ${project.rooms.length + 1}`)
      if (name) addRoom(pts, name)
    }
  }, [draft, tool, addConduit, addRoom, project.rooms.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.code === 'Space') { setSpace(true); e.preventDefault(); return }
      if (e.key === 'Escape') { setDraft([]); select(null); return }
      if (e.key === 'Enter') { finishDraft(); return }
      if (e.key === 'Backspace' && draft.length) { setDraft((d) => d.slice(0, -1)); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { removeSelected(); return }
      if (e.metaKey || e.ctrlKey) return
      const map: Record<string, typeof tool> = { v: 'select', h: 'pan', b: 'conduit', r: 'room', c: 'calibrate', a: 'align' }
      if (map[e.key]) setTool(map[e.key])
      if (e.key === 'g') useStore.getState().toggle('showGrid')
    }
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp) }
  }, [draft.length, selectedId, finishDraft, select, setTool, removeSelected])

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const st = stageRef.current!
    const p = st.getPointerPosition()!
    const old = st.scaleX()
    const factor = e.evt.ctrlKey || e.evt.metaKey ? 1.03 : 1.1
    const ns = e.evt.deltaY > 0 ? old / factor : old * factor
    const scale = Math.max(0.05, Math.min(20, ns))
    const mx = (p.x - st.x()) / old
    const my = (p.y - st.y()) / old
    setView({ scale, x: p.x - mx * scale, y: p.y - my * scale })
  }

  const panning = tool === 'pan' || space

  const onClick = (e: KonvaEventObject<MouseEvent>) => {
    if (panning) return
    const raw = toImg()
    if (!raw) return
    if (tool === 'select') {
      const id = e.target.name() || null
      select(id)
      return
    }
    if (tool === 'align') {
      if (draft.length === 1) {
        const a = (Math.atan2(raw.y - draft[0].y, raw.x - draft[0].x) * 180) / Math.PI
        const delta = a - Math.round(a / 90) * 90
        setTilt(project.planTilt - delta)
        setDraft([])
        setTool('select')
      } else setDraft([raw])
      return
    }
    const prev = draft.length ? draft[draft.length - 1] : null
    const p = snapped(raw, tool === 'calibrate' ? null : prev)
    if (tool === 'calibrate') {
      if (draft.length === 1) {
        const px = dist(draft[0], p)
        const m = parseFloat(window.prompt('Stvarna udaljenost u metrima', '1') ?? '')
        if (m > 0) patchProject({ pxPerMeter: px / m })
        setDraft([])
        setTool('select')
      } else setDraft([p])
      return
    }
    if (tool === 'room' && draft.length >= 3 && dist(p, draft[0]) < 10 / view.scale) { finishDraft(); return }
    setDraft((d) => [...d, p])
  }

  // Konva fires dblclick for any two clicks within 400 ms, so only a true
  // double click (both on the same spot) ends the draft.
  const onDblClick = () => {
    if (tool !== 'conduit' && tool !== 'room') return
    const n = draft.length
    if (n >= 2 && dist(draft[n - 1], draft[n - 2]) < 0.5) finishDraft()
  }

  const onMove = () => {
    const raw = toImg()
    if (!raw) return
    const prev = draft.length ? draft[draft.length - 1] : null
    setCursor(tool === 'align' ? raw : snapped(raw, tool === 'calibrate' ? null : prev))
  }

  const sel = selectedId
  const selConduit = project.conduits.find((c) => c.id === sel)
  const selRoom = project.rooms.find((r) => r.id === sel)
  const s = view.scale
  const px = (n: number) => n / s // constant screen size regardless of zoom

  // Dragging previews through local state and commits once on drop, so undo
  // restores the pre-drag shape instead of the last intermediate position.
  const vertexDrag = (id: string, pts: Pt[], i: number, commit: (pts: Pt[]) => void) => {
    const moved = (e: KonvaEventObject<DragEvent>) => {
      const prev = i > 0 ? pts[i - 1] : null
      const p = snapped({ x: e.target.x(), y: e.target.y() }, prev)
      e.target.position(p)
      return pts.map((q, j) => (j === i ? p : q))
    }
    return {
      draggable: true,
      onDragMove: (e: KonvaEventObject<DragEvent>) => setLive({ id, points: moved(e) }),
      onDragEnd: (e: KonvaEventObject<DragEvent>) => { setLive(null); commit(moved(e)) },
    }
  }

  const cursorStyle = panning ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div ref={wrap} className="canvas-wrap" style={{ cursor: cursorStyle }}>
      {!project.planImage && <div className="empty">Učitaj tlocrt (gumb gore) ili ga ispusti ovdje.</div>}
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={s}
        scaleY={s}
        draggable={panning}
        onDragEnd={(e) => { if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() })) }}
        onWheel={onWheel}
        onClick={onClick}
        onDblClick={onDblClick}
        onMouseMove={onMove}
      >
        <Layer listening={false}>
          {img && dims && (
            <KImage
              image={img}
              rotation={rot + project.planTilt}
              x={dims.w / 2}
              y={dims.h / 2}
              offsetX={img.width / 2}
              offsetY={img.height / 2}
            />
          )}
          {showGrid && step && img && (
            <Shape
              sceneFunc={(ctx, shape) => {
                // grid covers the visible viewport, not just the image
                let st = step
                while (st * s < 8) st *= 5
                const x0 = Math.floor(-view.x / s / st) * st
                const y0 = Math.floor(-view.y / s / st) * st
                const x1 = (size.w - view.x) / s
                const y1 = (size.h - view.y) / s
                const draw = (stepPx: number, style: string) => {
                  ctx.beginPath()
                  for (let x = Math.floor(x0 / stepPx) * stepPx; x <= x1; x += stepPx) { ctx.moveTo(x, y0); ctx.lineTo(x, y1) }
                  for (let y = Math.floor(y0 / stepPx) * stepPx; y <= y1; y += stepPx) { ctx.moveTo(x0, y); ctx.lineTo(x1, y) }
                  ctx.setAttr('strokeStyle', style)
                  ctx.setAttr('lineWidth', px(1))
                  ctx.stroke()
                }
                draw(st, 'rgba(0,120,255,0.18)')
                draw(st * 10, 'rgba(0,120,255,0.35)')
                ctx.fillStrokeShape(shape)
              }}
            />
          )}
        </Layer>

        <Layer listening={tool === 'select'}>
          {project.rooms.map((r0) => {
            const r = live?.id === r0.id ? { ...r0, points: live.points } : r0
            const c = centroid(r.points)
            const isSel = r.id === sel
            return (
              <Group key={r.id}>
                <Line
                  name={r.id}
                  points={r.points.flatMap((p) => [p.x, p.y])}
                  closed
                  fill={isSel ? 'rgba(255,200,0,0.18)' : 'rgba(0,160,255,0.08)'}
                  stroke={isSel ? '#ffb300' : '#1e88e5'}
                  strokeWidth={px(isSel ? 2.5 : 1.5)}
                  dash={isSel ? [px(8), px(5)] : undefined}
                />
                <Text name={r.id} x={c.x} y={c.y} offsetX={0} text={r.name} fontSize={px(14)} fontStyle="bold" fill="#0d47a1" />
              </Group>
            )
          })}
        </Layer>

        <Layer listening={tool === 'select'}>
          {project.conduits.map((c0) => {
            const c = live?.id === c0.id ? { ...c0, points: live.points } : c0
            const isSel = c.id === sel
            const mid = midpointOfPolyline(c.points)
            const flat = c.points.flatMap((p) => [p.x, p.y])
            const a = c.points[0]
            const b = c.points[c.points.length - 1]
            return (
              <Group key={c.id}>
                {isSel && <Line points={flat} stroke="#fff" strokeWidth={px(9)} opacity={0.9} lineJoin="round" lineCap="round" />}
                <Line
                  name={c.id}
                  points={flat}
                  stroke={c.color}
                  strokeWidth={px(isSel ? 4 : 3)}
                  hitStrokeWidth={px(14)}
                  lineJoin="round"
                  lineCap="round"
                  dash={isSel ? [px(12), px(7)] : undefined}
                  opacity={sel && !isSel ? 0.55 : 1}
                />
                <Circle name={c.id} x={a.x} y={a.y} radius={px(5)} fill={c.color} stroke="#fff" strokeWidth={px(1.5)} />
                <Rect name={c.id} x={b.x - px(5)} y={b.y - px(5)} width={px(10)} height={px(10)} fill={c.color} stroke="#fff" strokeWidth={px(1.5)} />
                <Label x={mid.x} y={mid.y} name={c.id} offsetY={px(10)}>
                  <Tag fill={c.color} cornerRadius={px(3)} opacity={0.95} />
                  <Text text={c.name} fontSize={px(11)} fill="#fff" padding={px(3)} fontStyle="bold" name={c.id} />
                </Label>
              </Group>
            )
          })}
        </Layer>

        <Layer>
          {selConduit && tool === 'select' &&
            selConduit.points.map((p, i) => (
              <Circle
                key={i}
                x={p.x}
                y={p.y}
                radius={px(6)}
                fill="#fff"
                stroke={selConduit.color}
                strokeWidth={px(2)}
                {...vertexDrag(selConduit.id, selConduit.points, i, (points) => updateConduit(selConduit.id, { points }))}
              />
            ))}
          {selRoom && tool === 'select' &&
            selRoom.points.map((p, i) => (
              <Circle
                key={i}
                x={p.x}
                y={p.y}
                radius={px(6)}
                fill="#fff"
                stroke="#ffb300"
                strokeWidth={px(2)}
                {...vertexDrag(selRoom.id, selRoom.points, i, (points) => updateRoom(selRoom.id, { points }))}
              />
            ))}
        </Layer>

        <Layer listening={false}>
          {draft.length > 0 && cursor && (
            <>
              <Line
                points={[...draft, cursor].flatMap((p) => [p.x, p.y])}
                stroke={tool === 'calibrate' || tool === 'align' ? '#ff5722' : tool === 'room' ? '#1e88e5' : '#333'}
                strokeWidth={px(2)}
                dash={[px(6), px(4)]}
                closed={tool === 'room' && draft.length >= 2}
                fill={tool === 'room' ? 'rgba(30,136,229,0.1)' : undefined}
              />
              {draft.map((p, i) => <Circle key={i} x={p.x} y={p.y} radius={px(4)} fill="#333" />)}
              <Label x={cursor.x} y={cursor.y} offsetX={px(-12)} offsetY={px(-12)}>
                <Tag fill="rgba(0,0,0,0.75)" cornerRadius={px(3)} />
                <Text
                  text={
                    tool === 'align'
                      ? `${((Math.atan2(cursor.y - draft[0].y, cursor.x - draft[0].x) * 180) / Math.PI).toFixed(1)}°`
                      : tool === 'calibrate'
                      ? `${Math.round(dist(draft[0], cursor))} px`
                      : `seg ${fmtMeters(dist(draft[draft.length - 1], cursor), project.pxPerMeter)} · uk ${fmtMeters(polylineLength([...draft, cursor]), project.pxPerMeter)}`
                  }
                  fontSize={px(11)}
                  fill="#fff"
                  padding={px(4)}
                />
              </Label>
            </>
          )}
          {cursor && tool !== 'select' && !panning && (
            <Circle x={cursor.x} y={cursor.y} radius={px(3)} fill={tool === 'calibrate' || tool === 'align' ? '#ff5722' : '#333'} />
          )}
        </Layer>
      </Stage>
    </div>
  )
}
