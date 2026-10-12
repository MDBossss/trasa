import { Fragment, useMemo } from 'react'
import useImage from 'use-image'
import { useStore } from '../store'
import { bomFor } from '../bom'
import { allJunctions, wirePlan, type Junction } from '../junction'
import { cableColor, cablePath, conduitTouchesRoom, cornerAt, wallExits, type WallInfo } from '../walls'
import { bounds } from '../geometry'
import { ELEMENT_META, RELAY_MODELS, WIRE_LABEL, type Project, type Room, type WallElement } from '../types'
import { Icon } from './Icons'
import { JunctionCanvas } from './JunctionCanvas'

// Printable handover per room: plan, walls with elements, every box with its terminal table,
// relays, material and open checks. The browser's print dialog makes the PDF.

export function PrintView({ roomId }: { roomId: string | null }) {
  const project = useStore((s) => s.project)
  const { setView } = useStore.getState()
  const rooms = project.rooms.filter((r) => !roomId || r.id === roomId)
  const junctions = useMemo(() => allJunctions(project), [project])
  const date = new Date().toLocaleDateString('hr-HR')
  return (
    <div className="print">
      <div className="print-bar">
        <button onClick={() => setView({ kind: 'bom' })}><Icon.back /> Natrag</button>
        <span className="muted">Pregled za ispis · u dijalogu odaberi "Spremi kao PDF"</span>
        <div className="spacer" />
        <button className="primary" onClick={() => window.print()}><Icon.print /> Ispiši / PDF</button>
      </div>
      <div className="print-pages">
        {rooms.map((r) => <RoomPages key={r.id} room={r} project={project} junctions={junctions.filter((j) => j.room.id === r.id)} date={date} />)}
        {!roomId && (
          <section className="page">
            <h1>{project.name} · materijal za cijelu kuću</h1>
            <div className="muted">Trasa · {date}</div>
            <Bom project={project} roomId={null} />
          </section>
        )}
      </div>
    </div>
  )
}

function RoomPages({ room, project, junctions, date }: { room: Room; project: Project; junctions: Junction[]; date: string }) {
  const ppm = project.pxPerMeter ?? 100
  const walls = wallExits(room, project.conduits, ppm)
  const conduits = project.conduits.filter((c) => conduitTouchesRoom(c, room, project.pxPerMeter))
  const b = bounds([...room.points, ...conduits.flatMap((c) => c.points)])
  const pad = 40
  const relays = project.elements.filter((e) => e.type === 'relay' && e.roomId === room.id)
  return (
    <>
      <section className="page">
        <h1>{room.name} · elektroinstalacija</h1>
        <div className="muted">{project.name} · Trasa · {date}</div>
        <h2>Tlocrt sobe i bužiri</h2>
        <svg className="print-plan" viewBox={`${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`}>
          <polygon points={room.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="#f3f1ea" stroke="#333" strokeWidth={2} />
          {walls.map((w) => <text key={w.i} x={(w.a.x + w.b.x) / 2} y={(w.a.y + w.b.y) / 2} fontSize={14} textAnchor="middle" fill="#1e88e5" fontWeight={700}>{w.i + 1}</text>)}
          {conduits.map((c) => (
            <g key={c.id}>
              <polyline points={c.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={c.color} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
              <text x={c.points[0].x} y={c.points[0].y - 6} fontSize={12} fill={c.color} fontWeight={600}>{c.name}</text>
            </g>
          ))}
        </svg>
        <table className="print-table">
          <thead><tr><th>Bužir</th><th>Kategorija</th><th>Ø</th><th>Od → do</th><th>Duljina</th></tr></thead>
          <tbody>
            {conduits.map((c) => <tr key={c.id}><td><span className="sw" style={{ background: c.color }} />{c.name}</td><td>{project.categories.find((k) => k.id === c.categoryId)?.name ?? ''}</td><td>{c.diameter || 'žlijeb'}</td><td>{c.from} → {c.to}</td><td>{(polyLen(c.points) / ppm).toFixed(1)} m</td></tr>)}
          </tbody>
        </table>
      </section>
      {walls.map((w) => <WallPage key={w.i} room={room} wall={w} project={project} />)}
      {junctions.map((j) => <JunctionPage key={j.box.id} j={j} />)}
      {relays.length > 0 && (
        <section className="page">
          <h2>{room.name} · releji</h2>
          <table className="print-table">
            <thead><tr><th>Relej</th><th>Model</th><th>Gdje</th><th>Ulazi (tipkala)</th><th>Izlazi (svjetla)</th><th>Način</th></tr></thead>
            <tbody>
              {relays.map((r) => {
                const m = RELAY_MODELS[r.relayModel ?? 'plus1']
                const ins = project.elements.filter((s) => s.relayId === r.id)
                const outs = project.elements.filter((l) => l.feedRelayId === r.id)
                return <tr key={r.id}><td>{r.label}</td><td>{m.label}</td><td>{project.elements.find((e) => e.id === r.host)?.label ?? '?'}</td><td>{ins.map((s) => `SW${s.relayInput ?? 1} ← ${s.label}`).join(', ') || '—'}</td><td>{outs.map((l) => `O${l.feedOutput ?? 1} → ${l.label}`).join(', ') || '—'}</td><td>{ins.every((s) => s.switchKind === 'tipkalo') ? 'button / momentary' : 'switch / edge'}</td></tr>
              })}
            </tbody>
          </table>
        </section>
      )}
      <section className="page">
        <h2>{room.name} · materijal</h2>
        <Bom project={project} roomId={room.id} />
        <Checks junctions={junctions} />
      </section>
    </>
  )
}

function WallPage({ room, wall, project }: { room: Room; wall: WallInfo; project: Project }) {
  const photo = room.walls[wall.i]?.photo
  const [img] = useImage(photo ?? '')
  const H = project.ceilingM * 100
  const W = wall.lengthM * 100
  const photoW = img ? (H * img.width) / img.height : W
  const photo0 = (W - photoW) / 2
  const left = Math.min(0, photo0), right = Math.max(W, photo0 + photoW)
  const elements = project.elements.filter((e) => e.roomId === room.id && e.wall === wall.i && !e.host)
  const hosted = (id: string) => project.elements.filter((e) => e.host === id)
  const cables = project.cables.filter((c) => c.roomId === room.id && c.wall === wall.i)
  const ctx = { wall, elements, ceilingM: project.ceilingM }
  const x = (m: number) => m * 100
  const y = (m: number) => H - m * 100
  if (!elements.length && !wall.exits.length && !photo) return null
  return (
    <section className="page">
      <h2>{room.name} · zid {wall.i + 1} <span className="muted">· {wall.lengthM.toFixed(2)} × {project.ceilingM} m, x od lijevog kuta gledano iznutra, visina od poda</span></h2>
      <svg className="print-wall" viewBox={`${left - 10} -40 ${right - left + 20} ${H + 70}`}>
        {img ? <image href={photo} x={photo0} y={0} width={photoW} height={H} preserveAspectRatio="none" /> : <rect x={0} y={0} width={W} height={H} fill="#f3f1ea" stroke="#999" />}
        {cables.map((c) => { const path = cablePath(c, ctx); return path ? <g key={c.id}><polyline points={path.map((p) => `${x(p.xM)},${y(p.zM)}`).join(' ')} fill="none" stroke="#fff" strokeWidth={6} strokeLinejoin="round" /><polyline points={path.map((p) => `${x(p.xM)},${y(p.zM)}`).join(' ')} fill="none" stroke={cableColor(c, project)} strokeWidth={3} strokeLinejoin="round" /></g> : null })}
        {wall.exits.map((e) => (
          <g key={`${e.conduit.id}:${e.end}`}>
            <line x1={x(e.posM)} y1={-30} x2={x(e.posM)} y2={y(e.zM ?? project.ceilingM)} stroke={e.conduit.color} strokeWidth={5} />
            <text x={x(e.posM)} y={-32} fontSize={12} textAnchor="middle" fill={e.conduit.color} fontWeight={700}>{e.conduit.name}</text>
          </g>
        ))}
        {cables.flatMap((c) => [c.from, c.to].filter((e) => e.kind === 'corner').map((e, i) => { const pos = e.kind === 'corner' ? ({ xM: e.corner === cornerAt(wall, 'left') ? 0 : wall.lengthM, zM: e.zM }) : null; return pos ? <text key={`${c.id}${i}`} x={x(pos.xM)} y={y(pos.zM) - 6} fontSize={10} textAnchor={pos.xM === 0 ? 'start' : 'end'} fill="#555">{pos.xM === 0 ? '← kut' : 'kut →'}</text> : null }))}
        {elements.map((e) => (
          <g key={e.id}>
            <circle cx={x(e.xM)} cy={y(e.zM)} r={9} fill="#fff" stroke="#111" strokeWidth={2} />
            <text x={x(e.xM)} y={y(e.zM) + 24} fontSize={12} textAnchor="middle" fontWeight={700} fill="#111">{e.label}</text>
            <text x={x(e.xM)} y={y(e.zM) + 37} fontSize={10} textAnchor="middle" fill="#444">{Math.round(e.xM * 100)} / {Math.round(e.zM * 100)} cm{hosted(e.id).length ? ` · ${hosted(e.id).map((h) => h.label).join(', ')}` : ''}</text>
          </g>
        ))}
      </svg>
      <table className="print-table">
        <thead><tr><th>Element</th><th>Tip</th><th>x</th><th>visina</th><th>Napomena</th></tr></thead>
        <tbody>
          {elements.map((e) => <tr key={e.id}><td>{e.label}</td><td>{elLabel(e)}{hosted(e.id).length ? ` · unutra: ${hosted(e.id).map((h) => `${h.label} ${elLabel(h)}`).join(', ')}` : ''}</td><td>{Math.round(e.xM * 100)} cm</td><td>{Math.round(e.zM * 100)} cm</td><td>{[e.depth, e.note].filter(Boolean).join(' · ')}</td></tr>)}
          {wall.exits.map((e) => <tr key={`${e.conduit.id}:${e.end}`}><td>{e.conduit.name}</td><td>{e.conduit.diameter ? `izlaz bužira ø${e.conduit.diameter}` : 'kabel iz žlijeba'}</td><td>{Math.round(e.posM * 100)} cm</td><td>{e.zM === null ? 'strop' : `${Math.round(e.zM * 100)} cm`}</td><td /></tr>)}
        </tbody>
      </table>
    </section>
  )
}

function JunctionPage({ j }: { j: Junction }) {
  const plan = wirePlan(j)
  return (
    <section className="page">
      <h2>{j.room.name} · {j.box.label} <span className="muted">· {ELEMENT_META[j.box.type].label.toLowerCase()}{j.box.type === 'modbox' ? ` ${j.box.modules ?? 3}M` : ''}, zid {j.box.wall + 1}{j.box.depth ? `, ${j.box.depth}` : ''}</span></h2>
      <JunctionCanvas className="print-junction" j={j} plan={plan} mode="all" step={0} hover={null} onHover={() => {}} onPick={() => {}} />
      <table className="print-table">
        <thead><tr><th>Stezaljka</th><th>WAGO</th><th>Žile</th></tr></thead>
        <tbody>
          {j.terminals.map((t) => (
            <tr key={t.id}>
              <td><b>{t.label}</b><br /><span className="muted">{t.desc}</span></td>
              <td>{t.wago ? `221-${t.wago}${t.chained > 1 ? ` ×${t.chained}` : ''}` : t.cap ? 'kapica' : 'izravno'}</td>
              <td>{t.wires.map((w, i) => <div key={i}><span className="sw" style={{ background: w.color === 'gnye' ? 'repeating-linear-gradient(90deg,#2e8b3a 0 3px,#f2d31b 3px 6px)' : WIRE_HEX_PRINT[w.color] }} />{w.kind === 'core' ? `${w.cableLabel}, ${WIRE_LABEL[w.color]}` : `${w.deviceLabel} ${w.port}`}{w.note ? ` (${w.note})` : ''}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="print-bom">{j.bom.map((b) => <span key={b.item}>{b.item} × {b.qty}</span>)}</div>
      <Checks junctions={[j]} />
    </section>
  )
}

function Bom({ project, roomId }: { project: Project; roomId: string | null }) {
  const lines = bomFor(project, roomId)
  const groups = [...new Set(lines.map((l) => l.group))]
  return (
    <table className="print-table">
      <tbody>
        {groups.map((g) => (
          <Fragment key={g}>
            <tr className="grp"><td colSpan={2}>{g}{g === 'Kabeli' && <span className="muted"> · duljine su okvirne (mjere s tlocrta i fotki), uzmi rezervu</span>}</td></tr>
            {lines.filter((l) => l.group === g).map((l) => <tr key={l.item}><td>{l.item}</td><td className="num">{l.unit === 'm' ? `${l.qty.toFixed(1).replace('.', ',')} m` : `${l.qty} kom`}</td></tr>)}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

function Checks({ junctions }: { junctions: Junction[] }) {
  const open = junctions.flatMap((j) => j.checks.filter((c) => c.level !== 'ok').map((c) => ({ ...c, j })))
  if (!open.length) return null
  return (
    <div className="print-checks">
      <h3>Otvorene provjere</h3>
      {open.map((c, i) => <div key={i} className={`check ${c.level}`}><span>{c.level === 'err' ? '✕' : '⚠'}</span><span><b>{c.j.box.label}:</b> {c.text}</span></div>)}
    </div>
  )
}

const elLabel = (e: WallElement) => (e.type === 'relay' ? RELAY_MODELS[e.relayModel ?? 'plus1'].label : e.switchKind === 'tipkalo' ? 'tipkalo' : ELEMENT_META[e.type].label.toLowerCase())
const polyLen = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0)
const WIRE_HEX_PRINT: Record<string, string> = { brown: '#6b3a1e', blue: '#1f4fb3', gnye: '#2e8b3a', black: '#222', grey: '#8c8c8c', black2: '#3a3a3a', grey2: '#a5a5a5', other: '#c9a' }
