import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Stage, Layer, Image as KImage, Line, Circle, Rect, Shape, Text, Group, Arc } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import useImage from 'use-image'
import { useStore } from '../store'
import { cornerPartner } from '../junction'
import { CABLE_COLOR, cableColor, cablePath, cornerAt, endPos, neighbourWall, type Exit, type WallCtx, type WallInfo } from '../walls'
import { isPlace, modulesOf, type CableEnd, type ElementType, type WallElement, RELAY_LOOK, relayBrand, relayModelOf, hostedFront , isData, APPLIANCES, frameCols, frameRows, frameSlots } from '../types'
import { Hud } from './Hud'
import { activeWallTool } from './WallToolRail'
import { middlePan, pinch, useMobile, wheelNav, type Camera } from '../mobile'

type P = { xM: number; zM: number }
// one TEM module on the wall symbol: half as wide as tall, like the real 22.5 × 45 mm (2M is a square)
const MODW = 6

// Canvas units are centimetres: x from the left end of the wall, y from the ceiling down.
export function WallCanvas({ roomId, wall, photo, onMoveExit }: { roomId: string; wall: WallInfo; photo?: string; onMoveExit: (e: Exit, posM: number, zM: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ w: 0, h: 0 }) // measured by the ResizeObserver before the first fit
  const [cursor, setCursor] = useState<P | null>(null)
  const [draft, setDraft] = useState<{ from: CableEnd; via: P[] } | null>(null)
  const [space, setSpace] = useState(false)
  const [alt, setAlt] = useState(false)
  const [live, setLive] = useState<{ id: string; xM: number; zM: number } | null>(null)
  const [guide, setGuide] = useState<{ x?: number; z?: number } | null>(null)
  const fitted = useRef<string | null>(null)
  const mobile = useMobile()

  const project = useStore((s) => s.project)
  const tool = useStore((s) => s.wallTool)
  const elementType = useStore((s) => s.elementType)
  const placeKind = useStore((s) => s.placeSwitchKind)
  const selectedId = useStore((s) => s.selectedId)
  const camera = useStore((s) => s.wallCamera)
  const fitNonce = useStore((s) => s.wallFitNonce)
  const showGrid = useStore((s) => s.showGrid)
  const { select, setWallTool, setWallCamera, wallZoomBy, wallFitView, addElement, updateElement, addCable, updateCable, removeSelected, toggle } = useStore.getState()
  const [img] = useImage(photo ?? '')

  const H = project.ceilingM * 100
  const W = wall.lengthM * 100
  // the photo keeps its aspect ratio by default: scaled to the wall height, centred on the wall
  // a too-small photo can be stretched to the wall's full width (aspect ratio is given up)
  const stretch = !!project.rooms.find((r) => r.id === roomId)?.walls[wall.i]?.photoStretch
  const photoW = img && !stretch ? (H * img.width) / img.height : W
  const photo0 = (W - photoW) / 2
  const allOnWall = project.elements.filter((e) => e.roomId === roomId && e.wall === wall.i)
  // hosted devices (relays, buttons in a frame) are drawn inside their host, not on their own
  const elements = allOnWall.filter((e) => !e.host)
  const hostedOf = (id: string) => allOnWall.filter((e) => e.host === id)
  const cables = project.cables.filter((c) => c.roomId === roomId && c.wall === wall.i)
  const ctx: WallCtx = { wall, elements, ceilingM: project.ceilingM }
  const s = camera.scale
  const px = (n: number) => n / s
  const panning = tool === 'pan' || space || mobile
  const touch = useRef(pinch(() => stageRef.current, () => useStore.getState().wallCamera, (c) => useStore.getState().setWallCamera(c), [0.1, 30])).current
  const toX = (p: P) => p.xM * 100
  const toY = (p: P) => H - p.zM * 100

  // measured before the first paint so the first fit already uses the real size
  useLayoutEffect(() => {
    const el = wrap.current!
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const key = `${roomId}:${wall.i}:${W}:${H}:${fitNonce}:${img ? 1 : 0}`
    if (fitted.current === key || !size.w) return
    fitted.current = key
    const left = Math.min(0, photo0)
    const right = Math.max(W, photo0 + photoW)
    const span = right - left
    const scale = Math.min(size.w / (span + 60), size.h / (H + 80)) * 0.95
    setWallCamera({ scale, x: (size.w - span * scale) / 2 - left * scale, y: (size.h - H * scale) / 2 + 10 * scale })
  }, [roomId, wall.i, W, H, size, fitNonce, setWallCamera, img, photo0, photoW])

  useEffect(() => { setDraft(null) }, [tool])

  const toWall = useCallback((): P | null => {
    const st = stageRef.current
    const p = st?.getPointerPosition()
    if (!st || !p) return null
    const x = (p.x - st.x()) / st.scaleX()
    const y = (p.y - st.y()) / st.scaleY()
    return { xM: x / 100, zM: (H - y) / 100 }
  }, [H])

  // 1 cm snap; without Alt also x/z alignment with other elements and exits (±3 cm).
  // No absolute-height snapping: wall photos are approximate, not 1:1.
  const snapPos = useCallback(
    (p: P, skipId?: string): P => {
      let xM = Math.round(p.xM * 100) / 100
      let zM = Math.round(p.zM * 100) / 100
      const g: { x?: number; z?: number } = {}
      if (!alt) {
        if (Math.abs(zM - project.ceilingM) <= 0.03) zM = project.ceilingM
        const others = elements.filter((e) => e.id !== skipId)
        for (const x of [...others.map((e) => e.xM), ...wall.exits.map((e) => e.posM)]) if (Math.abs(xM - x) <= 0.03) { xM = x; g.x = x }
        for (const z of others.map((e) => e.zM)) if (Math.abs(zM - z) <= 0.03) { zM = z; g.z = z }
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
    if (name.startsWith('cornerin:')) { const [, corner, zM] = name.split(':'); return { kind: 'corner', corner: +corner, zM: +zM } }
    if (name.startsWith('corner:')) { const raw = toWall(); return { kind: 'corner', corner: +name.split(':')[1], zM: Math.round((raw?.zM ?? 1) * 100) / 100 } }
    return null
  }
  const leftCorner = cornerAt(wall, 'left'), rightCorner = cornerAt(wall, 'right')
  // cables from other walls that end in one of this wall's corners and are not continued here yet
  const cornerEnds = (c: { from: CableEnd; to: CableEnd }) => [c.from, c.to].filter((e): e is Extract<CableEnd, { kind: 'corner' }> => e.kind === 'corner')
  const incoming = project.cables
    .filter((c) => c.roomId === roomId && c.wall !== wall.i)
    .flatMap((c) => cornerEnds(c).filter((e) => e.corner === leftCorner || e.corner === rightCorner).map((e) => ({ cable: c, end: e })))
    .filter(({ cable, end }) => !cornerPartner(project, cable, end.corner))

  const finishCable = useCallback(
    (to: CableEnd) => {
      if (!draft) return
      // a cable from an internet conduit or to an RJ45 outlet is UTP by default
      const kipEnd = (e: CableEnd) => e.kind === 'element' && project.elements.find((x) => x.id === e.id)?.type === 'kip'
      const panelEnd = (e: CableEnd) => e.kind === 'element' && project.elements.find((x) => x.id === e.id)?.type === 'panel'
      const dataEnd = (e: CableEnd): string | null => {
        if (e.kind === 'element') { const el = project.elements.find((x) => x.id === e.id); return isData(el) ? (el!.socketKind === 'tv' ? 'koaks' : 'UTP cat6') : null }
        if (e.kind === 'exit') { const cat = project.conduits.find((c) => c.id === e.conduitId)?.categoryId; return cat === 'internet' ? 'UTP cat6' : cat === 'tv' ? 'koaks' : null }
        return null
      }
      // from the earthing terminal: Cu 16 to the board, Cu 6 bonding elsewhere
      const earth = kipEnd(draft.from) || kipEnd(to) ? (panelEnd(draft.from) || panelEnd(to) ? 'PE Cu 16 mm²' : 'PE Cu 6 mm²') : null
      const boilerEnd = (e: CableEnd) => e.kind === 'element' && project.elements.find((x) => x.id === e.id)?.type === 'boiler'
      const appOf = (e: CableEnd) => { const x = e.kind === 'element' ? project.elements.find((y) => y.id === e.id) : undefined; return x?.type === 'appliance' ? APPLIANCES[x.appliance ?? 'hob'].cable : null }
      const heavy = boilerEnd(draft.from) || boilerEnd(to) ? 'NYM-J 3x2.5' : appOf(to) ?? appOf(draft.from)
      addCable({ roomId, wall: wall.i, type: earth ?? heavy ?? dataEnd(to) ?? dataEnd(draft.from) ?? 'NYM-J 3x1.5', from: draft.from, to, via: draft.via, note: '' })
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
      const map: Record<string, [typeof tool, ElementType?, 'tipkalo'?]> = { v: ['select'], h: ['pan'], k: ['element', 'box'], u: ['element', 'socket'], p: ['element', 'switch'], t: ['element', 'switch', 'tipkalo'], l: ['element', 'light'], o: ['element', 'panel'], m: ['element', 'modbox'], r: ['element', 'relay'], n: ['element', 'ledpsu'], d: ['element', 'motor'], z: ['element', 'kip'], b: ['element', 'boiler'], f: ['element', 'appliance'], c: ['cable'] }
      if (map[e.key]) setWallTool(...map[e.key])
      if (e.key === 'g') toggle('showGrid')
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

  const onClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    // on a phone a tap still selects, it just never draws
    if (panning && !(mobile && tool === 'select')) return
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
      const name = e.target.name() || e.target.getParent()?.name() || ''
      const hit = elements.find((x) => x.id === name)
      // relays go into a box / frame / LED niche, buttons into a frame: click on the host places them inside
      const canHost = hit && (elementType === 'relay' ? isPlace(hit) || hit.type === 'ledpsu' : (elementType === 'switch' || elementType === 'socket') && hit.type === 'modbox')
      if (canHost) { addElement({ roomId, wall: wall.i, type: elementType, xM: hit.xM, zM: hit.zM, note: '', host: hit.id, switchKind: placeKind, relayModel: elementType === 'relay' ? (hit.type === 'ledpsu' ? 'rgbw' : 'zbminir2') : undefined }); return }
      if (elementType === 'relay') { select(null); return }
      addElement({ roomId, wall: wall.i, type: elementType, xM: p.xM, zM: p.zM, note: '', switchKind: elementType === 'switch' ? placeKind : undefined })
      return
    }
    if (tool === 'cable') {
      let port = portAt(e.target)
      if (!port && (raw.xM <= 0.15 || raw.xM >= wall.lengthM - 0.15)) port = { kind: 'corner', corner: raw.xM <= 0.15 ? leftCorner : rightCorner, zM: Math.max(0, Math.min(project.ceilingM, Math.round(raw.zM * 100) / 100)) }
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

  const camUpdate = (f: (c: Camera) => Camera) => useStore.getState().setWallCamera(f(useStore.getState().wallCamera))
  const onWheel = (e: KonvaEventObject<WheelEvent>) => wheelNav(e.evt, stageRef.current!.getPointerPosition()!, camUpdate, [0.1, 30])
  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => middlePan(e.evt, camUpdate)

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

  const t = activeWallTool(tool, elementType, placeKind)
  const selCable = cables.find((c) => c.id === selectedId)
  const draftPath = draft ? [endPos(draft.from, liveCtx)!, ...draft.via, ...(cursor ? [cursor] : [])] : null

  return (
    <div ref={wrap} className="canvas-wrap wall-canvas" style={{ cursor: panning ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
      <Hud
        scale={s}
        onZoomIn={() => wallZoomBy(1.2, { x: size.w / 2, y: size.h / 2 })}
        onZoomOut={() => wallZoomBy(1 / 1.2, { x: size.w / 2, y: size.h / 2 })}
        onFit={wallFitView}
        toggles={[{ icon: 'grid', on: showGrid, title: 'Grid 10 cm (G)', onClick: () => toggle('showGrid') }]}
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
        onMouseDown={onMouseDown}
        onClick={onClick}
        onTap={onClick}
        onDblClick={onDblClick}
        onDblTap={onDblClick}
        onMouseMove={onMove}
        onTouchMove={touch.onTouchMove}
        onTouchEnd={touch.onTouchEnd}
      >
        <Layer listening={false}>
          {img ? (
            <KImage image={img} x={photo0} y={0} width={photoW} height={H} />
          ) : (
            <Rect x={0} y={0} width={W} height={H} fill="#f5f5f5" stroke="#555" strokeWidth={px(2)} />
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
          {guide?.x !== undefined && <Line points={[guide.x * 100, 0, guide.x * 100, H]} stroke="#e91e63" strokeWidth={px(1)} dash={[px(6), px(4)]} />}
          {guide?.z !== undefined && <Line points={[0, H - guide.z * 100, W, H - guide.z * 100]} stroke="#e91e63" strokeWidth={px(1)} dash={[px(6), px(4)]} />}
        </Layer>

        <Layer listening={tool === 'select'}>
          {cables.map((c, ci) => {
            const path = cablePath(c, liveCtx)
            if (!path) return null
            const color = cableColor(c, project)
            const isSel = c.id === selectedId
            const flat = path.flatMap((p) => [toX(p), toY(p)])
            // several cables on the same run (UTP + coax from one conduit) are drawn side by side so each can be picked
            const key = (x: typeof c) => [x.from, x.to].map((e) => JSON.stringify(e)).sort().join('|')
            const dup = cables.slice(0, ci).filter((x) => key(x) === key(c) && JSON.stringify(x.via) === JSON.stringify(c.via)).length
            return (
              <Group key={c.id} x={dup * px(7)} y={dup * px(7)}>
                <Line points={flat} stroke="#fff" strokeWidth={px(isSel ? 9 : 6)} opacity={isSel ? 1 : 0.85} lineJoin="round" lineCap="round" />
                <Line name={c.id} points={flat} stroke={color} strokeWidth={px(3.5)} hitStrokeWidth={px(14)} lineJoin="round" lineCap="round" dash={isSel ? [px(10), px(6)] : undefined} />
              </Group>
            )
          })}
        </Layer>

        <Layer listening={tool === 'select' || tool === 'cable' || tool === 'element'}>
          {[{ c: leftCorner, x: 0 }, { c: rightCorner, x: W }].map(({ c, x }) => (
            <Group key={`corner:${c}`} name={`corner:${c}`}>
              <Rect x={x === 0 ? -12 : W - 8} y={0} width={20} height={H} fill={tool === 'cable' ? 'rgba(30,136,229,0.14)' : 'transparent'} stroke={tool === 'cable' ? '#1e88e5' : undefined} strokeWidth={px(1)} dash={[px(4), px(4)]} />
              {tool === 'cable' && <Text text={`kut ${c + 1}\n→ zid ${neighbourWall(wall, x === 0 ? 'left' : 'right') + 1}`} x={x === 0 ? px(4) : W - px(64)} y={H / 2 - px(14)} width={px(60)} align={x === 0 ? 'left' : 'right'} fontSize={px(11)} fill="#1e88e5" />}
            </Group>
          ))}
          {incoming.map(({ cable: c, end: e }) => {
            const left = e.corner === leftCorner
            // markers at the same height step down so each can be clicked
            const same = incoming.filter((o) => o.end.corner === e.corner && Math.abs(o.end.zM - e.zM) < 0.05).findIndex((o) => o.cable.id === c.id)
            const x = left ? 0 : W, y = toY({ xM: 0, zM: e.zM }) + same * px(22)
            const name = `cornerin:${e.corner}:${e.zM}`
            return (
              <Group key={`in:${c.id}:${e.corner}`} name={name} x={x} y={y}>
                <Line points={left ? [-px(40), 0, px(30), 0] : [-px(30), 0, px(40), 0]} stroke={cableColor(c, project)} strokeWidth={px(4)} dash={[px(6), px(5)]} hitStrokeWidth={px(20)} />
                <Circle x={left ? 0 : 0} radius={px(8)} fill="#fff" stroke={cableColor(c, project)} strokeWidth={px(2.5)} />
                <Text text={`iz zida ${c.wall + 1} ${left ? '→' : '←'} nastavi (C)`} x={left ? px(12) : -px(112)} y={-px(18)} width={px(100)} align={left ? 'left' : 'right'} fontSize={px(10)} fontStyle="bold" fill={cableColor(c, project)} />
              </Group>
            )
          })}
          {cables.filter((c) => [c.from, c.to].some((e) => e.kind === 'corner')).map((c) => [c.from, c.to].filter((e): e is Extract<CableEnd, { kind: 'corner' }> => e.kind === 'corner').map((e) => {
            const pos = endPos(e, liveCtx)
            if (!pos) return null
            const left = pos.xM === 0
            return (
              <Group key={`${c.id}:${e.corner}`} x={toX(pos)} y={toY(pos)}>
                <Line points={left ? [0, 0, -px(14), 0] : [0, 0, px(14), 0]} stroke={cableColor(c, project)} strokeWidth={px(3.5)} dash={[px(4), px(4)]} />
                <Text text={`zid ${neighbourWall(wall, left ? 'left' : 'right') + 1} ${left ? '←' : '→'}`} x={left ? px(2) : -px(62)} y={-px(16)} width={px(60)} align={left ? 'left' : 'right'} fontSize={px(10)} fill="#555" />
              </Group>
            )
          }))}
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
                {/* invisible hit area: symbols are thin strokes with gaps, a click a pixel off would miss them */}
                {el.type === 'modbox' ? <Rect x={-(frameCols(el.modules ?? 3) * MODW) / 2 - 4} y={-4 - 6 * frameRows(el.modules ?? 3)} width={frameCols(el.modules ?? 3) * MODW + 8} height={8 + 12 * frameRows(el.modules ?? 3)} fill="#000" opacity={0.001} /> : <Circle radius={14} fill="#000" opacity={0.001} />}
                <Symbol type={el.type} selected={isSel} px={px} modules={el.modules} swKind={el.switchKind} data={isData(el)} tv={el.socketKind === 'tv'} appKind={el.appliance} />
                {(() => {
                  const hosted = hostedOf(el.id)
                  const mods = hostedFront(project.elements, el.id)
                  const relays = hosted.filter((h) => h.type === 'relay')
                  const w = el.type === 'modbox' ? frameCols(el.modules ?? 3) * MODW : 16
                  const rows = el.type === 'modbox' ? frameRows(el.modules ?? 3) : 1
                  const top = el.type === 'modbox' ? -6 * rows : el.type === 'ledpsu' ? -3 : -7
                  const slots = frameSlots(mods, el.modules ?? 3).starts
                  const sel = (h: WallElement) => (ev: KonvaEventObject<MouseEvent | TouchEvent>) => { if (tool === 'select') { ev.cancelBubble = true; select(h.id) } }
                  return (
                    <>
                      {mods.map((h, i) => {
                        // frame slots: each front element takes its modules (šuko 2, tipkalo/euro 1)
                        const hs = h.id === selectedId
                        const m = Math.max(1, modulesOf(h))
                        const cols = frameCols(el.modules ?? 3), row = Math.floor(slots[i] / cols)
                        const cx = -w / 2 + ((slots[i] % cols) + m / 2) * MODW
                        const cy = rows > 1 ? (row === 0 ? -6 : 6) : 0
                        return (
                          <Group key={h.id} name={h.id} x={cx} y={cy} onClick={sel(h)} onTap={sel(h)}>
                            <Rect x={-m * MODW / 2 + 0.8} y={-5} width={m * MODW - 1.6} height={10} cornerRadius={h.type === 'socket' ? 1.5 : 1} fill="#fff" stroke={hs ? '#1e88e5' : '#1f2430'} strokeWidth={px(1.5)} />
                            {h.type === 'switch' && (h.switchKind === 'tipkalo' || !h.switchKind || h.switchKind === 'obicni') && <Circle radius={1.2} fill={hs ? '#1e88e5' : '#1f2430'} />}
                            {h.type === 'switch' && h.switchKind === 'izmjenicni' && <Line points={[-2.2, 2.2, 2.2, -2.2]} stroke={hs ? '#1e88e5' : '#1f2430'} strokeWidth={px(1.2)} lineCap="round" />}
                            {h.type === 'switch' && h.switchKind === 'krizni' && <Line points={[-2.2, 2.2, 2.2, -2.2, 0, 0, -2.2, -2.2, 2.2, 2.2]} stroke={hs ? '#1e88e5' : '#1f2430'} strokeWidth={px(1.2)} lineCap="round" />}
                            {h.type === 'switch' && h.switchKind === 'serijski' && <Line points={[-2, 2, 0, -2, 2, 2]} stroke={hs ? '#1e88e5' : '#1f2430'} strokeWidth={px(1.2)} lineCap="round" lineJoin="round" />}
                            {h.type === 'socket' && !isData(h) && <Circle radius={2.2} fill="none" stroke={hs ? '#1e88e5' : '#1f2430'} strokeWidth={px(1)} />}
                            {isData(h) && h.socketKind !== 'tv' && <Rect x={-2} y={-2.6} width={4} height={5.2} cornerRadius={0.6} fill="none" stroke={hs ? '#1e88e5' : '#1f2430'} strokeWidth={px(1)} />}
                            {h.socketKind === 'tv' && <Line points={[-2.4, -3.2, 0, -0.6, 2.4, -3.2, 0, -0.6, 0, 3.2]} stroke={hs ? '#1e88e5' : '#1f2430'} strokeWidth={px(1.1)} lineCap="round" lineJoin="round" />}
                            <Text text={h.label} y={rows > 1 && row === 0 ? -15 : 6} offsetX={30} width={60} align="center" fontSize={px(8)} fill={hs ? '#1e88e5' : '#1f2430'} />
                          </Group>
                        )
                      })}
                      {/* relays live behind the front: a small brand-coloured dot per relay on the symbol's corner, names under the label */}
                      {relays.map((h, k) => {
                        const hs = h.id === selectedId
                        const look = RELAY_LOOK[relayBrand(relayModelOf(h))]
                        return (
                          <Group key={h.id} name={h.id} x={w / 2 + 1 - k * 5.5} y={top - 1} onClick={sel(h)} onTap={sel(h)}>
                            <Circle radius={2.4} fill={look.fill} stroke={hs ? '#1e88e5' : '#fff'} strokeWidth={px(hs ? 2 : 1.2)} />
                          </Group>
                        )
                      })}
                      {relays.length > 0 && <Text text={relays.map((h) => h.label).join(' · ')} x={0} y={(el.type === 'modbox' ? 8 + 6 * frameRows(el.modules ?? 3) : el.type === 'ledpsu' ? 10 : 16) + px(13)} offsetX={60} width={120} align="center" fontSize={px(9)} fill="#5b6472" />}
                    </>
                  )
                })()}
                <Text text={el.label} x={0} y={el.type === 'modbox' ? 8 + 6 * frameRows(el.modules ?? 3) : el.type === 'ledpsu' ? 10 : 16} offsetX={60} width={120} align="center" fontSize={px(11)} fontStyle="bold" fill="#1f2430" />
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
            <>
              <Line points={draftPath.flatMap((p) => [toX(p), toY(p)])} stroke="#fff" strokeWidth={px(6)} opacity={0.85} lineJoin="round" />
              <Line points={draftPath.flatMap((p) => [toX(p), toY(p)])} stroke={CABLE_COLOR} strokeWidth={px(3)} dash={[px(8), px(5)]} lineJoin="round" />
            </>
          )}
          {draftPath && draftPath.slice(0, -1).map((p, i) => <Circle key={i} x={toX(p)} y={toY(p)} radius={px(4)} fill={CABLE_COLOR} stroke="#fff" strokeWidth={px(1.5)} />)}
          {cursor && tool === 'element' && !panning && (
            <Group x={toX(cursor)} y={toY(cursor)} opacity={0.5}><Symbol type={elementType} selected={false} px={px} swKind={placeKind} /></Group>
          )}
        </Layer>
      </Stage>
    </div>
  )
}

// IEC 60617-style symbols drawn in centimetres so they keep real-world size.
function Symbol({ type, selected, px, modules, swKind, data, tv, appKind }: { type: ElementType; selected: boolean; px: (n: number) => number; modules?: number; swKind?: string; data?: boolean; tv?: boolean; appKind?: string }) {
  const stroke = selected ? '#1e88e5' : '#1f2430'
  const sw = px(2)
  const halo = selected ? <Circle radius={13} fill="rgba(30,136,229,0.18)" /> : null
  switch (type) {
    case 'modbox': { // frame as wide as its modules (≈22 mm each at the wall scale)
      const cols = frameCols(modules ?? 3), rows = frameRows(modules ?? 3), w = cols * MODW, h = 6 * rows
      return <>{halo}<Rect x={-w / 2} y={-h} width={w} height={2 * h} cornerRadius={1.5} fill="#fff" stroke={stroke} strokeWidth={sw} />{Array.from({ length: cols - 1 }, (_, i) => <Line key={i} points={[-w / 2 + (i + 1) * MODW, -h, -w / 2 + (i + 1) * MODW, h]} stroke={stroke} strokeWidth={px(1)} />)}{rows > 1 && <Line points={[-w / 2, 0, w / 2, 0]} stroke={stroke} strokeWidth={px(1)} />}</>
    }
    case 'relay':
      return <>{halo}<Rect x={-7} y={-5} width={14} height={10} cornerRadius={2} fill="#2563eb" stroke={stroke} strokeWidth={sw} /></>
    case 'ledpsu':
      return <>{halo}<Rect x={-20} y={-3} width={40} height={6} fill="#fff1c7" stroke={stroke} strokeWidth={sw} /><Line points={[-14, -3, -14, 3]} stroke={stroke} strokeWidth={px(1)} /><Line points={[0, -3, 0, 3]} stroke={stroke} strokeWidth={px(1)} /><Line points={[14, -3, 14, 3]} stroke={stroke} strokeWidth={px(1)} /></>
    case 'box': // square like the physical flush box (IEC uses a circle; this is a personal planner)
      return <>{halo}<Rect x={-7} y={-7} width={14} height={14} fill="#fff" stroke={stroke} strokeWidth={sw} /><Circle radius={2.2} fill={stroke} /></>
    case 'socket':
      // data outlet: the socket half-circle with a small RJ45 plug inside instead of the pin
      // telecommunications outlet (IEC 60617 11-13-09): the socket half-circle with an oblique stroke and a letter code
      if (data || tv) return <>{halo}<Arc innerRadius={0} outerRadius={7} angle={180} rotation={180} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-9, 0, 9, 0]} stroke={stroke} strokeWidth={sw} /><Line points={[-3, 0, 4, -9]} stroke={stroke} strokeWidth={sw} /><Text text={tv ? 'TV' : 'LAN'} x={5} y={-16} fontSize={px(9)} fontStyle="bold" fill={stroke} /></>
      return <>{halo}<Arc innerRadius={0} outerRadius={7} angle={180} rotation={180} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-9, 0, 9, 0]} stroke={stroke} strokeWidth={sw} /><Line points={[0, 0, 0, 7]} stroke={stroke} strokeWidth={sw} /></>
    case 'switch': {
      if (swKind === 'tipkalo') return <>{halo}<Circle radius={6} fill="#fff" stroke={stroke} strokeWidth={sw} /><Circle radius={2.2} fill={stroke} /></>
      // IEC 60617-11: one arm = on-off (11-14-01), two opposite arms = two-way (11-14-06),
      // four arms = intermediate (11-14-07), two arms on one side = series (DIN 40900)
      const arm = (deg: number) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a); const x1 = 3.5 * c, y1 = -3.5 * si, x2 = 11 * c, y2 = -11 * si; const hx = x2 + 3 * si, hy = y2 + 3 * c; return <Line key={deg} points={[x1, y1, x2, y2, hx, hy]} stroke={stroke} strokeWidth={sw} lineJoin="round" /> }
      const arms = swKind === 'izmjenicni' ? [45, 225] : swKind === 'krizni' ? [45, 135, 225, 315] : swKind === 'serijski' ? [30, 70] : [45]
      return <>{halo}<Circle radius={3.5} fill="#fff" stroke={stroke} strokeWidth={sw} />{arms.map(arm)}</>
    }
    case 'light':
      return <>{halo}<Circle radius={7} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-5, -5, 5, 5]} stroke={stroke} strokeWidth={sw} /><Line points={[-5, 5, 5, -5]} stroke={stroke} strokeWidth={sw} /></>
    case 'appliance': { // fixed-connection appliance: hob (four rings), oven (window), hood (canopy)
      const k = appKind ?? 'hob'
      if (k === 'hood') return <>{halo}<Line points={[-12, 6, -6, -6, 6, -6, 12, 6]} closed fill="#fff" stroke={stroke} strokeWidth={sw} lineJoin="round" /><Line points={[-3, -6, -3, -12, 3, -12, 3, -6]} stroke={stroke} strokeWidth={sw} /></>
      if (k === 'oven') return <>{halo}<Rect x={-11} y={-10} width={22} height={20} cornerRadius={2} fill="#fff" stroke={stroke} strokeWidth={sw} /><Rect x={-7} y={-3} width={14} height={9} cornerRadius={1} fill="#fff" stroke={stroke} strokeWidth={0.9} /><Line points={[-7, -6, 7, -6]} stroke={stroke} strokeWidth={0.9} /></>
      return <>{halo}<Rect x={-12} y={-9} width={24} height={18} cornerRadius={2} fill="#fff" stroke={stroke} strokeWidth={sw} />{[[-5, -3.5], [5, -3.5], [-5, 3.5], [5, 3.5]].map(([x, y]) => <Circle key={`${x}${y}`} x={x} y={y} radius={2.8} fill="#fff" stroke={stroke} strokeWidth={0.9} />)}</>
    }
    case 'boiler': // water heater: upright tank with the heating element zigzag
      return <>{halo}<Rect x={-8} y={-13} width={16} height={26} cornerRadius={8} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-3, -6, 3, -3, -3, 0, 3, 3, -3, 6]} stroke={stroke} strokeWidth={sw} lineJoin="round" /></>
    case 'kip': // box with the IEC earth symbol (vertical stem, three shortening bars)
      return <>{halo}<Rect x={-9} y={-9} width={18} height={18} cornerRadius={2} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[0, -6, 0, 0]} stroke={stroke} strokeWidth={sw} /><Line points={[-6, 0, 6, 0]} stroke={stroke} strokeWidth={sw} /><Line points={[-4, 2.5, 4, 2.5]} stroke={stroke} strokeWidth={sw} /><Line points={[-2, 5, 2, 5]} stroke={stroke} strokeWidth={sw} /></>
    case 'motor': // control unit box with the motor circle: M in a box
      return <>{halo}<Rect x={-11} y={-7} width={22} height={14} cornerRadius={2} fill="#fff" stroke={stroke} strokeWidth={sw} /><Circle x={-4} radius={3.5} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-6, 1.5, -4, -1.5, -2, 1.5]} stroke={stroke} strokeWidth={px(1.2)} /><Line points={[2, -4, 8, -4, 2, 4, 8, 4]} stroke={stroke} strokeWidth={px(1.2)} /></>
    case 'panel':
      return <>{halo}<Rect x={-10} y={-15} width={20} height={30} fill="#fff" stroke={stroke} strokeWidth={sw} /><Line points={[-6, -7, 6, -7]} stroke={stroke} strokeWidth={sw} /><Line points={[-6, 0, 6, 0]} stroke={stroke} strokeWidth={sw} /><Line points={[-6, 7, 6, 7]} stroke={stroke} strokeWidth={sw} /></>
  }
}

