import { useRef } from 'react'
import { useStore } from '../store'
import { fileToDataUrl } from '../images'
import { cableLengthM, endLabel, type WallInfo } from '../walls'
import { CABLE_TYPES, ELEMENT_META, type Room, type SwitchKind } from '../types'
import { Icon } from './Icons'

const SWITCH_KINDS: { id: SwitchKind; label: string; wires: string }[] = [
  { id: 'obicni', label: 'Obični', wires: '2 žile do prekidača' },
  { id: 'serijski', label: 'Serijski', wires: '3 žile' },
  { id: 'izmjenicni', label: 'Izmjenični', wires: '3 žile između prekidača' },
  { id: 'krizni', label: 'Križni', wires: '4 žile' },
]

export function WallSidebar({ room, walls, wall }: { room: Room; walls: WallInfo[]; wall: number | null }) {
  const project = useStore((s) => s.project)
  const selectedId = useStore((s) => s.selectedId)
  const { select, setView, setWallPhoto, updateElement, updateCable, removeSelected, setWallTool } = useStore.getState()
  const fileRef = useRef<HTMLInputElement>(null)
  const current = wall !== null ? walls[wall] : null
  const elements = current ? project.elements.filter((e) => e.roomId === room.id && e.wall === current.i) : []
  const cables = current ? project.cables.filter((c) => c.roomId === room.id && c.wall === current.i) : []
  const ctx = current ? { wall: current, elements, ceilingM: project.ceilingM } : null
  const el = project.elements.find((e) => e.id === selectedId)
  const cable = project.cables.find((c) => c.id === selectedId)

  const minX = Math.min(...room.points.map((p) => p.x))
  const minY = Math.min(...room.points.map((p) => p.y))
  const maxX = Math.max(...room.points.map((p) => p.x))
  const maxY = Math.max(...room.points.map((p) => p.y))
  const pad = 30

  const onPhoto = async (f: File | undefined) => {
    if (!f || wall === null) return
    const { url } = await fileToDataUrl(f, 2000)
    setWallPhoto(room.id, wall, url)
  }

  return (
    <aside className="sidebar">
      <section>
        <h3>{room.name} <span className="count">{walls.length} zidova</span></h3>
        <svg className="room-mini-svg" viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}>
          <polygon points={room.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(30,136,229,0.08)" stroke="#1e88e5" strokeWidth={2} />
          {walls.map((w) => {
            const mx = (w.a.x + w.b.x) / 2
            const my = (w.a.y + w.b.y) / 2
            const sel = wall === w.i
            return (
              <g key={w.i} className="wall-hit" onClick={() => setView({ kind: 'room', roomId: room.id, wall: w.i })}>
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
            <li key={w.i} className={wall === w.i ? 'sel' : ''} onClick={() => setView({ kind: 'room', roomId: room.id, wall: w.i })}>
              <span className="name">Zid {w.i + 1}</span>
              <span className="meta">{w.lengthM.toFixed(2)} m · {w.exits.length} izl. · {room.walls[w.i]?.photo ? 'foto' : 'bez fote'}</span>
            </li>
          ))}
        </ul>
      </section>

      {current && (
        <section>
          <h3>Fotka zida {current.i + 1}</h3>
          <div className="field-row">
            <button className="primary" onClick={() => fileRef.current?.click()}><Icon.camera /> {room.walls[current.i]?.photo ? 'Zamijeni fotku' : 'Učitaj fotku'}</button>
            {room.walls[current.i]?.photo && <button className="icon-btn danger" title="Ukloni fotku" aria-label="Ukloni fotku" onClick={() => setWallPhoto(room.id, current.i, undefined)}><Icon.trash /></button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </section>
      )}

      {el && (
        <section className="props">
          <div className="props-head">
            <h3>{ELEMENT_META[el.type].label}</h3>
            <button className="icon-btn danger" onClick={removeSelected} title="Obriši (Delete)" aria-label="Obriši element"><Icon.trash /></button>
          </div>
          <label>Oznaka <input value={el.label} onChange={(e) => updateElement(el.id, { label: e.target.value })} /></label>
          <label>
            Tip
            <select value={el.type} onChange={(e) => updateElement(el.id, { type: e.target.value as typeof el.type })}>
              {(Object.keys(ELEMENT_META) as (keyof typeof ELEMENT_META)[]).map((t) => <option key={t} value={t}>{ELEMENT_META[t].label}</option>)}
            </select>
          </label>
          {el.type === 'switch' && (
            <label>
              Vrsta
              <select value={el.switchKind ?? 'obicni'} onChange={(e) => updateElement(el.id, { switchKind: e.target.value as SwitchKind })}>
                {SWITCH_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} · {k.wires}</option>)}
              </select>
            </label>
          )}
          <div className="field-row">
            <label>Od lijevo (m) <input type="number" step={0.01} value={el.xM} onChange={(e) => updateElement(el.id, { xM: +e.target.value || 0 })} /></label>
            <label>Visina (m) <input type="number" step={0.01} value={el.zM} onChange={(e) => updateElement(el.id, { zM: +e.target.value || 0 })} /></label>
          </div>
          <label>Bilješka <textarea rows={2} value={el.note} onChange={(e) => updateElement(el.id, { note: e.target.value })} /></label>
        </section>
      )}

      {cable && ctx && (
        <section className="props">
          <div className="props-head">
            <h3>Kabel</h3>
            <button className="icon-btn danger" onClick={removeSelected} title="Obriši (Delete)" aria-label="Obriši kabel"><Icon.trash /></button>
          </div>
          <label>
            Tip
            <select value={cable.type} onChange={(e) => updateCable(cable.id, { type: e.target.value })}>
              {CABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="stat"><span>Od</span><b>{endLabel(cable.from, project)}</b></div>
          <div className="stat"><span>Do</span><b>{endLabel(cable.to, project)}</b></div>
          <div className="stat"><span>Duljina na zidu</span><b>{cableLengthM(cable, ctx).toFixed(2)} m</b><span className="muted">{cable.via.length} lomova</span></div>
          <label>Bilješka <textarea rows={2} value={cable.note} onChange={(e) => updateCable(cable.id, { note: e.target.value })} /></label>
        </section>
      )}

      {current && (
        <section>
          <h3>Na zidu {current.i + 1}</h3>
          {current.exits.length + elements.length + cables.length === 0 && <p className="muted">Postavi kutiju (K), utičnicu (U) ili prekidač (P), pa kabel (C) od izlaza bužira do elementa.</p>}
          <ul className="list">
            {current.exits.map((e) => (
              <li key={`${e.conduit.id}:${e.end}`} onClick={() => { setWallTool('select'); select(e.conduit.id) }}>
                <span className="swatch" style={{ background: e.conduit.color }} />
                <span className="name">{e.conduit.name} <span className="muted">bužir ø{e.conduit.diameter}</span></span>
                <span className="meta">{e.posM.toFixed(2)} m · {e.zM === null ? 'strop' : `h ${e.zM.toFixed(2)}`}</span>
              </li>
            ))}
            {elements.map((e) => (
              <li key={e.id} className={e.id === selectedId ? 'sel' : ''} onClick={() => { setWallTool('select'); select(e.id) }}>
                <span className="name">{e.label} <span className="muted">{ELEMENT_META[e.type].label.toLowerCase()}</span></span>
                <span className="meta">{e.xM.toFixed(2)} m · h {e.zM.toFixed(2)}</span>
              </li>
            ))}
            {cables.map((c) => (
              <li key={c.id} className={c.id === selectedId ? 'sel' : ''} onClick={() => { setWallTool('select'); select(c.id) }}>
                <span className="name">{endLabel(c.from, project)} → {endLabel(c.to, project)}</span>
                <span className="meta">{c.type} · {ctx ? cableLengthM(c, ctx).toFixed(2) : '?'} m</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
