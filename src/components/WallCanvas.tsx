import { useCallback, useEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KImage, Line, Circle, Rect, Shape, Text, Group, Arc } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import useImage from 'use-image'
import { useStore } from '../store'
import { cableColor, cablePath, endPos, type Exit, type WallCtx, type WallInfo } from '../walls'
import { STANDARD_HEIGHTS, type CableEnd, type ElementType, type WallElement } from '../types'
import { Hud } from './Hud'
import { activeWallTool } from './WallToolRail'

type P = { xM: number; zM: number }

// Canvas units are centimetres: x from the left end of the wall, y from the ceiling down.
export function WallCanvas({ roomId, wall, photo, onMoveExit }: { roomId: string; wall: WallInfo; photo?: string; onMoveExit: (e: Exit, posM: number, zM: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [cursor, setCursor] = useState<P | null>(null)
  const [draft, setDraft] = useState<{ from: CableEnd; via: P[] } | null>(null)
  const [space, setSpace] = useState(false)
  const [alt, setAlt] = useState(false)
  const [live, setLive] = useState<{ id: string; xM: number; zM: number } | null>(null)
  const [guide, setGuide] = useState<{ x?: number; z?: number } | null>(null)
  const fitted = useRef<string | null>(null)

  const project = useStore((s) => s.project)
  const tool = useStore((s) => s.wallTool)
  const elementType = useStore((s) => s.elementType)
  const selectedId = useStore((s) => s.selectedId)
  const camera = useStore((s) => s.wallCamera)
  const fitNonce = useStore((s) => s.wallFitNonce)
  const showZones = useStore((s) => s.showZones)
  const showGrid = useStore((s) => s.showGrid)
  const { select, setWallTool, setWallCamera, wallZoomBy, wallFitView, addElement, updateElement, addCable, updateCable, removeSelected, toggle } = useStore.getState()
  const [img] = useImage(photo ?? '')

  const H = project.ceilingM * 100
  const W = wall.lengthM * 100
  const elements = project.elements.filter((e) => e.roomId === roomId && e.wall === wall.i)
  const cables = project.cables.filter((c) => c.roomId === roomId && c.wall === wall.i)
  const ctx: WallCtx = { wall, elements, ceilingM: project.ceilingM }
  const s = camera.scale
  const px = (n: number) => n / s
  const panning = tool === 'pan' || space
  const toX = (p: P) => p.xM * 100
  const toY = (p: P) => H - p.zM * 100

  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const key = `${roomId}:${wall.i}:${W}:${H}:${fitNonce}`
    if (fitted.current === key || !size.w) return
    fitted.current = key
    const scale = Math.min(size.w / (W + 60), size.h / (H + 80)) * 0.95
    setWallCamera({ scale, x: (size.w - W * scale) / 2, y: (size.h - H * scale) / 2 + 10 * scale })
  }, [roomId, wall.i, W, H, size, fitNonce, setWallCamera])

  useEffect(() => { setDraft(null) }, [tool])

  const toWall = useCallback((): P | null => {
    const st = stageRef.current
    const p = st?.getPointerPosition()
    if (!st || !p) return null
    const x = (p.x - st.x()) / st.scaleX()
    const y = (p.y - st.y()) / st.scaleY()
    return { xM: x / 100, zM: (H - y) / 100 }
  }, [H])

  // 1 cm snap; without Alt also standard heights and x-alignment with other ports (±3 cm)
  const snapPos = useCallback(
    (p: P, skipId?: string): P => {
      let xM = Math.round(p.xM * 100) / 100
      let zM = Math.round(p.zM * 100) / 100
      const g: { x?: number; z?: number } = {}
      if (!alt) {
        for (const h of STANDARD_HEIGHTS) if (Math.abs(zM - h) <= 0.03) { zM = h; g.z = h }
        if (Math.abs(zM - project.ceilingM) <= 0.03) zM = project.ceilingM
        const xs = [...elements.filter((e) => e.id !== skipId).map((e) => e.xM), ...wall.exits.map((e) => e.posM)]
        for (const x of xs) if (Math.abs(xM - x) <= 0.03) { xM = x; g.x = x }
      }
      setGuide(g.x !== undefined || g.z !== undefined ? g : null)
      return { xM: Math.max(0, Math.min(wall.lengthM, xM)), zM: Math.max(0, Math.min(project.ceilingM, zM)) }
    },
    [alt, elements, wall, project.ceilingM],
  )

  // cable corners run horizontal or vertical from the previous point
  const orthoSnap = (p: P, prev: P): P => {
    if (alt) return { xM: Math.round(p.xM * 100) / 100, zM: Math.round(p.zM * 100) / 100 }
    const dx = Math.abs(p.xM - prev.xM)
    const dz = Math.abs(p.zM - prev.zM)
    return dx > dz ? { xM: Math.round(p.xM * 100) / 100, zM: prev.zM } : { xM: prev.xM, zM: Math.round(p.zM * 100) / 100 }
  }

  const portAt = (target: Konva.Node): CableEnd | null => {
    const name = target.name() || target.getParent()?.name() || ''
    if (name.startsWith('exit:')) {
      const [, conduitId, end] = name.split(':')
      return { kind: 'exit', conduitId, end: end as 'start' | 'end' }
    }
    if (elements.some((e) => e.id === name)) return { kind: 'element', id: name }
    return null
  }

  const finishCable = useCallback(
    (to: CableEnd) => {
      if (!draft) return
      addCable({ roomId, wall: wall.i, type: 'NYM-J 3x1.5', from: draft.from, to, via: draft.via, note: '' })
      setDraft(null)
    },
    [draft, addCable, roomId, wall.i],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      if (e.key === 'Alt') { setAlt(true); e.preventDefault(); return }
      if (e.code === 'Space') { setSpace(true); e.preventDefault(); return }
      if (e.key === 'Escape') { if (draft) setDraft(null); else if (tool !== 'select') setWallTool('select'); else select(null); return }
      if (e.key === 'Enter' && draft) { const last = draft.via[draft.via.length - 1]; if (last) finishCable({ kind: 'free', ...last }); return }
      if (e.key === 'Backspace' && draft) { setDraft({ ...draft, via: draft.via.slice(0, -1) }); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { removeSelected(); return }
      if (e.metaKey || e.ctrlKey) return
      const map: Record<string, [typeof tool, ElementType?]> = { v: ['select'], h: ['pan'], k: ['element', 'box'], u: ['element', 'socket'], p: ['element', 'switch'], l: ['element', 'light'], o: ['element', 'panel'], c: ['cable'] }
      if (map[e.key]) setWallTool(...map[e.key])
      if (e.key === 'g') toggle('showGrid')
      if (e.key === 'z') toggle('showZones')
      if (e.key === '+' || e.key === '=') wallZoomBy(1.2, { x: size.w / 2, y: size.h / 2 })
      if (e.key === '-') wallZoomBy(1 / 1.2, { x: size.w / 2, y: size.h / 2 })
      if (e.key === '0') wallFitView()
    }
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); if (e.key === 'Alt') setAlt(false) }
    const onBlur = () => { setSpace(false); setAlt(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', onBlur) }
  }, [draft, tool, selectedId, finishCable, select, setWallTool, removeSelected, toggle, wallZoomBy, wallFitView, size])

  const onClick = (e: KonvaEventObject<MouseEvent>) => {
    if (panning) return
    const raw = toWall()
    if (!raw) return
    if (tool === 'select') {
      const name = e.target.name() || e.target.getParent()?.name() || ''
      const id = name.startsWith('exit:') ? null : name || null
      select(id)
      return
    }
    if (tool === 'element') {
      const p = snapPos(raw)
      addElement({ roomId, wall: wall.i, type: elementType, xM: p.xM, zM: p.zM, note: '' })
      return
    }
    if (tool === 'cable') {
      const port = portAt(e.target)
      if (!draft) {
        setDraft({ from: port ?? { kind: 'free', ...snapPos(raw) }, via: [] })
        return
      }
      if (port) { finishCable(port); return }
      const prev = draft.via[draft.via.length - 1] ?? endPos(draft.from, ctx)!
      setDraft({ ...draft, via: [...draft.via, orthoSnap(raw, prev)] })
    }
  }

  const onDblClick = () => {
    if (tool === 'cable' && draft && draft.via.length >= 2) {
      const v = draft.via
      const last = v[v.length - 1]
      const prev = v[v.length - 2]
      if (Math.abs(last.xM - prev.xM) < 0.005 && Math.abs(last.zM - prev.zM) < 0.005) {
        setDraft({ ...draft, via: v.slice(0, -1) })
        finishCable({ kind: 'free', ...prev })
      }
    }
  }

  const onMove = () => {
    const raw = toWall()
    if (!raw) return
    if (tool === 'cable' && draft) {
      const prev = draft.via[draft.via.length - 1] ?? endPos(draft.from, ctx) ?? raw
      setCursor(orthoSnap(raw, prev))
    } else if (tool === 'element') setCursor(snapPos(raw))
    else setCursor({ xM: Math.round(raw.xM * 100) / 100, zM: Math.round(raw.zM * 100) / 100 })
  }

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const p = stageRef.current!.getPointerPosition()!
    const factor = e.evt.ctrlKey || e.evt.metaKey ? 1.03 : 1.1
    wallZoomBy(e.evt.deltaY > 0 ? 1 / factor : factor, p)
  }

  const dragPos = (e: KonvaEventObject<DragEvent>): P => ({ xM: e.target.x() / 100, zM: (H - e.target.y()) / 100 })
  const elementDrag = (el: WallElement) => ({
    draggable: tool === 'select' && !panning,
    onDragStart: (e: KonvaEventObject<DragEvent>) => { e.cancelBubble = true; select(el.id) },
    onDragMove: (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true
      const p = snapPos(dragPos(e), el.id)
      e.target.position({ x: toX(p), y: toY(p) })
      setLive({ id: el.id, ...p })
    },
    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true
      const p = snapPos(dragPos(e), el.id)
      setLive(null)
      setGuide(null)
      updateElement(el.id, p)
    },
  })
  const exitDrag = (ex: Exit) => ({
    draggable: tool === 'select' && !panning,
    onDragStart: (e: KonvaEventObject<DragEvent>) => { e.cancelBubble = true },
    onDragMove: (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true
      const p = snapPos(dragPos(e))
      e.target.position({ x: toX(p), y: toY(p) })
      setLive({ id: `exit:${ex.conduit.id}:${ex.end}`, ...p })
    },
    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true
      const p = snapPos(dragPos(e))
      setLive(null)
      setGuide(null)
      onMoveExit(ex, p.xM, p.zM)
    },
  })

  // live positions override store positions while something is being dragged
  const liveCtx: WallCtx = live
    ? {
        ...ctx,
        elements: elements.map((e) => (e.id === live.id ? { ...e, xM: live.xM, zM: live.zM } : e)),
        wall: { ...wall, exits: wall.exits.map((x) => (`exit:${x.conduit.id}:${x.end}` === live.id ? { ...x, posM: live.xM, zM: live.zM } : x)) },
      }
    : ctx

  const t = activeWallTool(tool, elementType)
  const selCable = cables.find((c) => c.id === selectedId)
  const draftPath = draft ? [endPos(draft.from, liveCtx)!, ...draft.via, ...(cursor ? [cursor] : [])] : null

  return (
    <div ref={wrap} className="canvas-wrap wall-canvas" style={{ cursor: panning ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
      <Hud
        scale={s}
        onZoomIn={() => wallZoomBy(1.2, { x: size.w / 2, y: size.h / 2 })}
        onZoomOut={() => wallZoomBy(1 / 1.2, { x: size.w / 2, y: size.h / 2 })}
        onFit={wallFitView}
        toggles={[
          { icon: 'grid', on: showGrid, title: 'Grid 10 cm (G)', onClick: () => toggle('showGrid') },
          { icon: 'zones', on: showZones, title: 'Instalacijske zone DIN 18015-3 (Z)', onClick: () => toggle('showZones') },
        ]}
        hint={<><b>{t.label}</b> · {t.hint}</>}
        extra={cursor && <div className="hud-group hud-coords">x {cursor.xM.toFixed(2)} m · h {cursor.zM.toFixed(2)} m</div>}
      />
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={camera.x}
        y={camera.y}
        scaleX={s}
        scaleY={s}
        draggable={panning}
        onDragEnd={(e) => { if (e.target === stageRef.current) setWallCamera({ ...camera, x: e.target.x(), y: e.target.y() }) }}
        onWheel={onWheel}
        onClick={onClick}
        onDblClick={onDblClick}
        onMouseMove={onMove}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={W} height={H} fill="#f5f5f5" stroke="#555" strokeWidth={px(2)} />
          {img && <KImage image={img} x={0} y={0} width={W} height={H} />}
          {showZones && (
            <Group opacity={0.22}>
              {[[15, 45], [100, 130], [H - 45, H - 15]].map(([a, b], i) => (
                <Rect key={i} x={0} y={H - b} width={W} height={b - a} fill="#1e88e5" />
              ))}
              <Rect x={10} y={0} width={20} height={H} fill="#1e88e5" />
              <Rect x={W - 30} y={0} width={20} height={H} fill="#1e88e5" />
            </Group>
          )}
          {showGrid && (
            <Shape
              sceneFunc={(ctx2, shape) => {
                let st = 10
                while (st * s < 6) st *= 5
                ctx2.beginPath()
                for (let x = 0; x <= W; x += st) { ctx2.moveTo(x, 0); ctx2.lineTo(x, H) }
                for (let y = H; y >= 0; y -= st) { ctx2.moveTo(0, y); ctx2.lineTo(W, y) }
                ctx2.setAttr('strokeStyle', 'rgba(0,0,0,0.08)')
                ctx2.setAttr('lineWidth', px(1))
                ctx2.stroke()
                ctx2.fillStrokeShape(shape)
              }}
            />
          )}
          {Array.from({ length: Math.floor(wall.lengthM) + 1 }, (_, i) => (
            <Group key={i}>
              <Line points={[i * 100, H, i * 100, H + px(8)]} stroke="#555" strokeWidth={px(1)} />
              <Text x={i * 100} y={H + px(10)} text={`${i} m`} fontSize={px(12)} fill="#555" offsetX={px(10)} />
            </Group>
          ))}
          {[0.3, 1.05, 2.3].map((h) => (
            <Text key={h} x={-px(4)} y={H - h * 100} text={`${h.toFixed(2)}`} fontSize={px(10)} fill="#888" align="right" width={px(40)} offsetX={px(40)} offsetY={px(5)} />
          ))}
          {guide?.x !== undefined && <Line points={[guide.x * 100, 0, guide.x * 100, H]} stroke="#e91e63" strokeWidth={px(1)} dash={[px(6), px(4)]} />}
          {guide?.z !== undefined && <Line points={[0, H - guide.z * 100, W, H - guide.z * 100]} stroke="#e91e63" strokeWidth={px(1)} dash={[px(6), px(4)]} />}
        </Layer>

        <Layer listening={tool === 'select'}>
          {cables.map((c) => {
            const path = cablePath(c, liveCtx)
            if (!path) return null
            const color = cableColor(c, project)
            const isSel = c.id === selectedId
            const flat = path.flatMap((p) => [toX(p), toY(p)])
            return (
              <Group key={c.id}>
                {isSel && <Line points={flat} stroke="#fff" strokeWidth={px(9)} lineJoin="round" lineCap="round" />}
                <Line name={c.id} points={flat} stroke={color} strokeWidth={px(3.5)} hitStrokeWidth={px(14)} lineJoin="round" lineCap="round" dash={isSel ? [px(10), px(6)] : undefined} />
              </Group>
            )
          })}
        </Layer>

        <Layer listening={tool === 'select' || tool === 'cable'}>
          {wall.exits.map((ex) => {
            const pos = endPos({ kind: 'exit', conduitId: ex.conduit.id, end: ex.end }, liveCtx)!
            const x = toX(pos)
            const y = toY(pos)
            const name = `exit:${ex.conduit.id}:${ex.end}`
            return (
              <Group key={name} name={name} x={x} y={y} {...exitDrag(ex)}>
                {y > 0.5 ? <Line points={[0, -y, 0, 0]} stroke={ex.conduit.color} strokeWidth={px(4)} dash={[px(8), px(5)]} opacity={0.6} /> : <Line points={[0, -px(28), 0, 0]} stroke={ex.conduit.color} strokeWidth={px(5)} />}
                <Circle radius={px(9)} fill={ex.conduit.color} stroke="#fff" strokeWidth={px(2)} />
                <Text text={ex.conduit.name} x={0} y={y > 0.5 ? px(12) : -px(42)} offsetX={px(60)} width={px(120)} align="center" fontSize={px(12)} fontStyle="bold" fill={ex.conduit.color} />
              </Group>
            )
          })}
          {elements.map((el) => {
            const p = live?.id === el.id ? live : el
            const isSel = el.id === selectedId
            return (
              <Group key={el.id} name={el.id} x={toX(p)} y={toY(p)} {...elementDrag(el)}>
                <Symbol type={el.type} selected={isSel} px={px} />
                <Text text={el.label} x={0} y={16} offsetX={60} width={120} align="center" fontSize={px(11)} fontStyle="bold" fill="#1f2430" />
              </Group>
            )
          })}
        </Layer>

        <Layer>
          {selCable && tool === 'select' &&
            selCable.via.map((v, i) => (
              <Circle
                key={i}
                x={toX(v)}
                y={toY(v)}
                radius={px(6)}
                fill="#fff"
                stroke="#333"
                strokeWidth={px(2)}
                draggable
                onDragMove={(e) => { e.cancelBubble = true; const q = { xM: Math.round(e.target.x()) / 100, zM: Math.round(H - e.target.y()) / 100 }; e.target.position({ x: toX(q), y: toY(q) }) }}
                onDragEnd={(e) => { e.cancelBubble = true; const q = { xM: Math.round(e.target.x()) / 100, zM: Math.round(H - e.target.y()) / 100 }; updateCable(selCable.id, { via: selCable.via.map((w, j) => (j === i ? q : w)) }) }}
              />
            ))}
        </Layer>

        <Layer listening={false}>
          {draftPath && draftPath.length >= 2 && (
            <Line points={draftPath.flatMap((p) => [toX(p), toY(p)])} stroke="#333" strokeWidth={px(3)} dash={[px(8), px(5)]} lineJoin="round" />
          )}
          {draftPath && draftPath.slice(0, -1).map((p, i) => <Circle key={i} x={toX(p)} y={toY(p)} radius={px(4)} fill="#333" />)}
          {cursor && tool === 'element' && !panning && (
            <Group x={toX(cursor)} y={toY(cursor)} opacity={0.5}><Symbol type={elementType} selected={false} px={px} /></Group>
          )}
        </Layer>
      </Stage>
    </div>
  )
}

// IEC 60617-style symbols drawn in centimetres so they keep real-world size.
function Symbol({ type, selected, px }: { type: ElementType; selected: boolean; px: (n: number) => number }) {
  const stroke = selected ? '#1e88e5' : '#1f2430'
  const sw = px(2)
  const halo = selected ? <Circle radius={13} fill="rgba(30,136,229,0.18)" /> : null
  switch (type) {
    case 'box':
      return <>{halo}<Circle radius={7} fill="#fff" stroke={stroke} strokeWidth={sw} /><Circle radius={2.2} fill={stroke} /></>
    case 'socket':
      return <>{halo}<Arc innerRadius={0} outerRadius={7} angle={180} rotation={180} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-9, 0, 9, 0]} stroke={stroke} strokeWidth={sw} /><Line points={[0, 0, 0, 7]} stroke={stroke} strokeWidth={sw} /></>
    case 'switch':
      return <>{halo}<Circle radius={3.5} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[2.5, -2.5, 10, -10]} stroke={stroke} strokeWidth={sw} /><Line points={[10, -10, 13, -8]} stroke={stroke} strokeWidth={sw} /></>
    case 'light':
      return <>{halo}<Circle radius={7} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-5, -5, 5, 5]} stroke={stroke} strokeWidth={sw} /><Line points={[-5, 5, 5, -5]} stroke={stroke} strokeWidth={sw} /></>
    case 'panel':
      return <>{halo}<Rect x={-10} y={-15} width={20} height={30} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-6, -7, 6, -7]} stroke={stroke} strokeWidth={sw} /><Line points={[-6, 0, 6, 0]} stroke={stroke} strokeWidth={sw} /><Line points={[-6, 7, 6, 7]} stroke={stroke} strokeWidth={sw} /></>
  }
}

