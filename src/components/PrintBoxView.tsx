import { useMemo } from 'react'
import { useStore } from '../store'
import { allJunctions, allLeafJunctions, wirePlan } from '../junction'
import { conduitTouchesRoom, wallExits } from '../walls'
import { bounds } from '../geometry'
import { ELEMENT_META, frameName } from '../types'
import { Icon } from './Icons'
import { CAP_COLOR, JunctionCanvas, wireSwatch } from './JunctionCanvas'

// One box on one A4 landscape sheet: where it is in the room, a legend, the drawing and the terminal table.

export function PrintBoxView({ elementId }: { elementId: string }) {
  const project = useStore((s) => s.project)
  const { setView } = useStore.getState()
  const j = useMemo(() => [...allJunctions(project), ...allLeafJunctions(project)].find((x) => x.box.id === elementId), [project, elementId])
  const plan = useMemo(() => (j ? wirePlan(j) : []), [j])
  if (!j) return <div className="print"><div className="print-bar"><button onClick={() => setView({ kind: 'junctions', elementId: null })}><Icon.back /> Natrag</button><span className="muted">Kutija ne postoji.</span></div></div>
  const room = j.room
  const ppm = project.pxPerMeter ?? 100
  const walls = wallExits(room, project.conduits, ppm)
  const w = walls[j.box.wall]
  const conduits = project.conduits.filter((c) => conduitTouchesRoom(c, room, project.pxPerMeter))
  // crop to the room plus 1 m around it; conduits running further away are clipped
  const b = bounds(room.points)
  const pad = ppm
  const vb = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + 2 * pad, h: b.maxY - b.minY + 2 * pad }
  // the box sits on its wall at xM from the wall's left end (seen from inside)
  const t = w ? (w.cw ? j.box.xM / w.lengthM : 1 - j.box.xM / w.lengthM) : 0
  const dot = w ? { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t } : null
  const date = new Date().toLocaleDateString('hr-HR')
  const kind = ELEMENT_META[j.box.type].label.toLowerCase()

  return (
    <div className="print print-box-mode">
      <div className="print-bar">
        <button onClick={() => setView({ kind: 'junctions', elementId })}><Icon.back /> Natrag na spojeve</button>
        <span className="muted">A4 vodoravno · u dijalogu odaberi "Spremi kao PDF"</span>
        <div className="spacer" />
        <button className="primary" onClick={() => window.print()}><Icon.print /> Ispiši / PDF</button>
      </div>
      <div className="print-pages">
        <section className="page page-landscape">
          <header className="pb-head">
            <div>
              <h1>{j.box.label} <span className="muted">· {kind}{j.box.type === 'modbox' ? ` ${frameName(j.box.modules ?? 3)}` : ''}{j.box.depth === 'duboka' ? ', duboka' : ''}</span></h1>
              <div className="muted">{project.name} · {room.name}, zid {j.box.wall + 1} · Trasa · {date}</div>
            </div>
            <div className="pb-bom">{j.bom.map((x) => <span key={x.item}>{x.item} × {x.qty}</span>)}</div>
          </header>
          <div className="pb-grid">
            <aside className="pb-side">
              <div className="pb-card">
                <h3>Gdje je</h3>
                <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="pb-plan">
                  <defs><clipPath id="pb-crop"><rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} /></clipPath></defs>
                  <polygon points={room.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="#f3f1ea" stroke="#333" strokeWidth={2} />
                  {w && <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#1e88e5" strokeWidth={6} strokeLinecap="round" />}
                  {walls.map((x) => <text key={x.i} x={(x.a.x + x.b.x) / 2} y={(x.a.y + x.b.y) / 2 + 4} fontSize={13} textAnchor="middle" fill={x.i === j.box.wall ? '#fff' : '#1e88e5'} fontWeight={700}>{x.i + 1}</text>)}
                  <g clipPath="url(#pb-crop)">
                    {conduits.map((c) => <polyline key={c.id} points={c.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={c.color} strokeWidth={3} strokeLinejoin="round" strokeDasharray={c.categoryId === 'todo' ? '8 6' : undefined} opacity={0.8} />)}
                  </g>
                  {dot && <><circle cx={dot.x} cy={dot.y} r={9} fill="#ff6d00" stroke="#fff" strokeWidth={2} /><text x={dot.x} y={dot.y - 13} fontSize={12} textAnchor="middle" fontWeight={700} fill="#ff6d00">{j.box.label}</text></>}
                </svg>
                <div className="muted">{room.name}, zid {j.box.wall + 1}{j.box.zM > project.ceilingM - 0.5 ? ', uz strop' : j.box.zM < 0.6 ? ', nisko' : ', na visini prekidača'}</div>
              </div>
              <div className="pb-card">
                <h3>Legenda</h3>
                <div className="pb-legend">
                  <span><i style={{ background: wireSwatch('brown') }} />L faza, smeđa</span>
                  <span><i style={{ background: wireSwatch('blue') }} />N nula, plava</span>
                  <span><i style={{ background: wireSwatch('gnye') }} />PE zaštitni, žuto-zelena</span>
                  <span><i style={{ background: wireSwatch('black') }} />povratna / putna / izlaz releja, crna ili siva</span>
                  <span><i style={{ background: '#f28c28' }} />WAGO 221: 412 = 2 žile, 413 = 3, 415 = 5</span>
                  <span><i style={{ background: '#c8803c' }} />ogoliti 11 mm, polugica gore → utakni → dolje</span>
                  <span><i style={{ background: '#2563eb' }} />Shelly (plavi): L N SW I O</span>
                  <span><i style={{ background: '#f0862b' }} />Sonoff (narančasti): L N Lout S1 S2</span>
                  {j.terminals.some((t) => t.cap) && <span><i style={{ background: CAP_COLOR }} />rezervna žila: presavij, izoliraj (kapica / traka)</span>}
                </div>
              </div>
              <div className="pb-card">
                <h3>Kabeli u kutiji</h3>
                <table className="print-table">
                  <tbody>{j.cables.map((c) => <tr key={c.cable.id}><td>{c.label}</td><td className="num">{c.sub}</td></tr>)}</tbody>
                </table>
              </div>
            </aside>
            <main className="pb-main">
              <JunctionCanvas className="pb-junction" j={j} plan={plan} mode="all" step={0} hover={null} onHover={() => {}} onPick={() => {}} />
            </main>
          </div>
          {j.checks.some((c) => c.level !== 'ok') && (
            <div className="print-checks">{j.checks.filter((c) => c.level !== 'ok').map((c, i) => <div key={i} className={`check ${c.level}`}><span>{c.level === 'err' ? '✕' : '⚠'}</span><span>{c.text}</span></div>)}</div>
          )}
        </section>
      </div>
    </div>
  )
}
