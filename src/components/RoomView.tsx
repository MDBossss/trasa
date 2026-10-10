import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { dist, projectOnSegment, signedArea } from '../geometry'
import { fileToDataUrl } from '../images'
import type { Conduit, Pt, Room } from '../types'

interface Exit { conduit: Conduit; end: 'start' | 'end'; posM: number; distM: number; offset: Pt }

// A conduit endpoint is an exit on its nearest wall when within 0.5 m of it.
// With a clockwise polygon (screen coords) wall i runs left→right as seen from inside.
function wallExits(room: Room, conduits: Conduit[], ppm: number) {
  const n = room.points.length
  const cw = signedArea(room.points) > 0
  const walls = room.points.map((a, i) => {
    const b = room.points[(i + 1) % n]
    return { i, a, b, lengthM: dist(a, b) / ppm, exits: [] as Exit[] }
  })
  for (const c of conduits) {
    for (const end of ['start', 'end'] as const) {
      const p: Pt = end === 'start' ? c.points[0] : c.points[c.points.length - 1]
      let best: { w: (typeof walls)[number]; t: number; distM: number } | null = null
      for (const w of walls) {
        const pr = projectOnSegment(p, w.a, w.b)
        const distM = pr.dist / ppm
        if (distM <= 0.5 && (!best || distM < best.distM)) best = { w, t: pr.t, distM }
      }
      if (best) {
        const foot = projectOnSegment(p, best.w.a, best.w.b).point
        best.w.exits.push({ conduit: c, end, posM: (cw ? best.t : 1 - best.t) * best.w.lengthM, distM: best.distM, offset: { x: p.x - foot.x, y: p.y - foot.y } })
      }
    }
  }
  for (const w of walls) w.exits.sort((x, y) => x.posM - y.posM)
  return walls
}

export function RoomView({ roomId, wall }: { roomId: string; wall: number | null }) {
  const project = useStore((s) => s.project)
  const { setView, setWallPhoto, updateConduit } = useStore.getState()
  const room = project.rooms.find((r) => r.id === roomId)
  const ppm = project.pxPerMeter ?? 100
  const fileRef = useRef<HTMLInputElement>(null)

  const walls = useMemo(() => (room ? wallExits(room, project.conduits, ppm) : []), [room, project.conduits, ppm])
  const cw = room ? signedArea(room.points) > 0 : true

  // Dragging an exit along the top edge moves that conduit end on the plan,
  // sliding it along the wall and keeping its distance from the wall.
  const moveExit = (w: { a: Pt; b: Pt; lengthM: number }, e: Exit, posM: number) => {
    const t = cw ? posM / w.lengthM : 1 - posM / w.lengthM
    const p: Pt = { x: w.a.x + (w.b.x - w.a.x) * t + e.offset.x, y: w.a.y + (w.b.y - w.a.y) * t + e.offset.y }
    const pts = e.conduit.points.map((q, i) => (i === (e.end === 'start' ? 0 : e.conduit.points.length - 1) ? p : q))
    updateConduit(e.conduit.id, { points: pts })
  }
  if (!room) return <div className="room-view"><p>Soba ne postoji.</p></div>

  const current = wall !== null ? walls[wall] : null
  const minX = Math.min(...room.points.map((p) => p.x))
  const minY = Math.min(...room.points.map((p) => p.y))
  const maxX = Math.max(...room.points.map((p) => p.x))
  const maxY = Math.max(...room.points.map((p) => p.y))
  const pad = 30

  const onPhoto = async (f: File | undefined) => {
    if (!f || wall === null) return
    const { url } = await fileToDataUrl(f, 2000)
    setWallPhoto(roomId, wall, url)
  }

  return (
    <div className="room-view">
      <div className="room-head">
        <button onClick={() => setView({ kind: 'plan' })}>← Tlocrt</button>
        <h2>{room.name}</h2>
        {!project.pxPerMeter && <span className="warn">Mjerilo nije postavljeno, duljine su procjena.</span>}
      </div>
      <div className="room-body">
        <div className="room-mini">
          <svg viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}>
            <polygon points={room.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(30,136,229,0.08)" stroke="#1e88e5" strokeWidth={2} />
            {walls.map((w) => {
              const mx = (w.a.x + w.b.x) / 2
              const my = (w.a.y + w.b.y) / 2
              const sel = wall === w.i
              return (
                <g key={w.i} className="wall-hit" onClick={() => setView({ kind: 'room', roomId, wall: w.i })}>
                  <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={sel ? '#ffb300' : 'transparent'} strokeWidth={10} strokeLinecap="round" />
                  <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={sel ? '#ffb300' : '#1e88e5'} strokeWidth={sel ? 4 : 2} />
                  <circle cx={mx} cy={my} r={11} fill={sel ? '#ffb300' : '#fff'} stroke="#1e88e5" />
                  <text x={mx} y={my + 4} textAnchor="middle" fontSize={12} fontWeight={700}>{w.i + 1}</text>
                </g>
              )
            })}
            {project.conduits.map((c) => (
              <polyline key={c.id} points={c.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={c.color} strokeWidth={3} strokeLinejoin="round" opacity={0.9} />
            ))}
          </svg>
          <ul className="list">
            {walls.map((w) => (
              <li key={w.i} className={wall === w.i ? 'sel' : ''} onClick={() => setView({ kind: 'room', roomId, wall: w.i })}>
                <span className="name">Zid {w.i + 1}</span>
                <span className="meta">{w.lengthM.toFixed(2)} m · {w.exits.length} izlaza · {room.walls[w.i]?.photo ? 'foto' : 'bez fote'}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="wall-panel">
          {!current && <p className="muted">Klikni zid na skici ili u listi.</p>}
          {current && (
            <>
              <div className="wall-head">
                <h3>Zid {current.i + 1} · {current.lengthM.toFixed(2)} m × {project.ceilingM} m</h3>
                <button onClick={() => fileRef.current?.click()}>{room.walls[current.i]?.photo ? 'Zamijeni fotku' : 'Učitaj fotku zida'}</button>
                {room.walls[current.i]?.photo && <button className="danger" onClick={() => setWallPhoto(roomId, current.i, undefined)}>Ukloni fotku</button>}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
              </div>
              <WallElevation lengthM={current.lengthM} heightM={project.ceilingM} photo={room.walls[current.i]?.photo} exits={current.exits} onMove={(e, posM) => moveExit(current, e, posM)} />
              <p className="muted">Povuci izlaz bužira lijevo-desno po gornjem rubu da ga namjestiš prema fotki (korak 1 cm). Pomiče i kraj bužira na tlocrtu.</p>
              <table className="exits">
                <thead><tr><th>Bužir</th><th>Kraj</th><th>Od lijevo</th><th>Od zida</th><th>Od / Do</th></tr></thead>
                <tbody>
                  {current.exits.map((e, i) => (
                    <tr key={i}>
                      <td><span className="swatch" style={{ background: e.conduit.color }} /> {e.conduit.name} ø{e.conduit.diameter}</td>
                      <td>{e.end === 'start' ? 'početak' : 'kraj'}</td>
                      <td>{e.posM.toFixed(2)} m</td>
                      <td>{e.distM.toFixed(2)} m</td>
                      <td>{e.conduit.from || '–'} → {e.conduit.to || '–'}</td>
                    </tr>
                  ))}
                  {current.exits.length === 0 && <tr><td colSpan={5} className="muted">Nijedan bužir ne završava uz ovaj zid.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function WallElevation({ lengthM, heightM, photo, exits, onMove }: { lengthM: number; heightM: number; photo?: string; exits: Exit[]; onMove: (e: Exit, posM: number) => void }) {
  const W = lengthM * 100
  const H = heightM * 100
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ idx: number; posM: number } | null>(null)

  const toSvgX = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const pt = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse())
    return pt.x
  }
  const clampPos = (xCm: number) => Math.max(0, Math.min(lengthM, Math.round(xCm) / 100))

  return (
    <svg
      ref={svgRef}
      className="elevation"
      viewBox={`-20 -40 ${W + 40} ${H + 70}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={(ev) => { if (drag) setDrag({ ...drag, posM: clampPos(toSvgX(ev.clientX, ev.clientY)) }) }}
      onPointerUp={() => { if (drag) { onMove(exits[drag.idx], drag.posM); setDrag(null) } }}
      onPointerLeave={() => { if (drag) { onMove(exits[drag.idx], drag.posM); setDrag(null) } }}
    >
      <rect x={0} y={0} width={W} height={H} fill="#f3f3f3" stroke="#555" strokeWidth={2} />
      {photo && <image href={photo} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
      {Array.from({ length: Math.floor(lengthM) + 1 }, (_, i) => (
        <g key={i}>
          <line x1={i * 100} y1={H} x2={i * 100} y2={H + 8} stroke="#555" />
          <text x={i * 100} y={H + 22} fontSize={12} textAnchor="middle" fill="#555">{i} m</text>
        </g>
      ))}
      {exits.map((e, i) => {
        const posM = drag?.idx === i ? drag.posM : e.posM
        const x = posM * 100
        return (
          <g key={i} className="exit" data-testid={`exit-${e.conduit.id}-${e.end}`} style={{ cursor: 'ew-resize' }}
            onPointerDown={(ev) => { ev.preventDefault(); (ev.currentTarget.ownerSVGElement ?? ev.currentTarget).setPointerCapture?.(ev.pointerId); setDrag({ idx: i, posM: e.posM }) }}>
            <line x1={x} y1={-30} x2={x} y2={0} stroke={e.conduit.color} strokeWidth={5} />
            {drag?.idx === i && <line x1={x} y1={0} x2={x} y2={H} stroke={e.conduit.color} strokeWidth={1.5} strokeDasharray="6 4" />}
            <circle cx={x} cy={0} r={9} fill={e.conduit.color} stroke="#fff" strokeWidth={2} />
            <text x={x} y={-34} fontSize={13} fontWeight={700} textAnchor="middle" fill={e.conduit.color}>
              {e.conduit.name}{drag?.idx === i ? ` ${posM.toFixed(2)} m` : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
