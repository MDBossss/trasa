import { useStore } from '../store'
import { fmtMeters, polylineLength } from '../geometry'
import { DIAMETERS } from '../types'
import { detectSkew } from '../images'

export function Sidebar() {
  const project = useStore((s) => s.project)
  const selectedId = useStore((s) => s.selectedId)
  const { select, patchProject, updateConduit, updateRoom, removeSelected, setView, setTool, setTilt } = useStore.getState()
  const conduit = project.conduits.find((c) => c.id === selectedId)
  const room = project.rooms.find((r) => r.id === selectedId)
  const ppm = project.pxPerMeter

  return (
    <aside className="sidebar">
      <section>
        <h3>Projekt</h3>
        <label>Naziv <input value={project.name} onChange={(e) => patchProject({ name: e.target.value })} /></label>
        <label>
          Mjerilo
          <span className={ppm ? 'ok' : 'warn'}>{ppm ? `${ppm.toFixed(1)} px/m` : 'nije postavljeno (alat Mjerilo)'}</span>
        </label>
        <label>Grid (cm) <input type="number" min={1} value={project.gridCm} onChange={(e) => patchProject({ gridCm: Math.max(1, +e.target.value || 10) })} /></label>
        <label>
          Ishodište grida
          <span className="tilt-controls">
            <span className="muted">{Math.round(project.gridOrigin.x)}, {Math.round(project.gridOrigin.y)}</span>
            <button className="mini" onClick={() => setTool('origin')}>Postavi (O)</button>
            <button className="mini" onClick={() => patchProject({ gridOrigin: { x: 0, y: 0 } })} disabled={!project.gridOrigin.x && !project.gridOrigin.y}>Reset</button>
          </span>
        </label>
        <label>Visina stropa (m) <input type="number" step={0.05} value={project.ceilingM} onChange={(e) => patchProject({ ceilingM: +e.target.value || 2.6 })} /></label>
        {project.planImage && (
          <div className="tilt">
            <label>
              Nagib slike
              <span className="tilt-controls">
                <button className="mini" onClick={() => setTilt(project.planTilt - 1)}>−1°</button>
                <button className="mini" onClick={() => setTilt(project.planTilt - 0.1)}>−0.1</button>
                <input type="number" step={0.1} value={project.planTilt} onChange={(e) => setTilt(+e.target.value || 0)} />
                <button className="mini" onClick={() => setTilt(project.planTilt + 0.1)}>+0.1</button>
                <button className="mini" onClick={() => setTilt(project.planTilt + 1)}>+1°</button>
              </span>
            </label>
            <div className="tilt-actions">
              <button className="mini" onClick={() => autoAlign(project.planImage!, setTilt)}>Auto poravnaj</button>
              <button className="mini" onClick={() => setTool('align')}>Po liniji (A)</button>
              <button className="mini" onClick={() => setTilt(0)} disabled={!project.planTilt}>Reset</button>
            </div>
            <p className="muted">Poravnaj sliku s gridom prije crtanja: nagib pomiče samo sliku, ne i nacrtano.</p>
          </div>
        )}
      </section>

      {conduit && (
        <section className="props">
          <h3>Bužir</h3>
          <label>Naziv <input value={conduit.name} onChange={(e) => updateConduit(conduit.id, { name: e.target.value })} /></label>
          <label>Boja <input type="color" value={conduit.color} onChange={(e) => updateConduit(conduit.id, { color: e.target.value })} /></label>
          <label>
            Promjer
            <select value={conduit.diameter} onChange={(e) => updateConduit(conduit.id, { diameter: +e.target.value })}>
              {DIAMETERS.map((d) => <option key={d} value={d}>ø{d}</option>)}
            </select>
          </label>
          <label>Od <input value={conduit.from} placeholder="npr. ormar" onChange={(e) => updateConduit(conduit.id, { from: e.target.value })} /></label>
          <label>Do <input value={conduit.to} placeholder="npr. DS.K1" onChange={(e) => updateConduit(conduit.id, { to: e.target.value })} /></label>
          <label>Bilješka <textarea rows={2} value={conduit.note} onChange={(e) => updateConduit(conduit.id, { note: e.target.value })} /></label>
          <div className="row">
            <span>Duljina: <b>{fmtMeters(polylineLength(conduit.points), ppm)}</b> · {conduit.points.length} točaka</span>
          </div>
          <button className="danger" onClick={removeSelected}>Obriši bužir</button>
        </section>
      )}

      {room && (
        <section className="props">
          <h3>Soba</h3>
          <label>Naziv <input value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value })} /></label>
          <div className="row"><span>{room.points.length} zidova</span></div>
          <button onClick={() => setView({ kind: 'room', roomId: room.id, wall: null })}>Otvori sobu →</button>
          <button className="danger" onClick={removeSelected}>Obriši sobu</button>
        </section>
      )}

      <section>
        <h3>Bužiri ({project.conduits.length})</h3>
        {project.conduits.length === 0 && <p className="muted">Alat Bužir (B) pa klikaj po tlocrtu.</p>}
        <ul className="list">
          {project.conduits.map((c) => (
            <li key={c.id} className={c.id === selectedId ? 'sel' : ''} onClick={() => { setTool('select'); select(c.id) }}>
              <span className="swatch" style={{ background: c.color }} />
              <span className="name">{c.name}</span>
              <span className="meta">ø{c.diameter} · {fmtMeters(polylineLength(c.points), ppm)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Sobe ({project.rooms.length})</h3>
        {project.rooms.length === 0 && <p className="muted">Alat Soba (R) pa klikaj kutove.</p>}
        <ul className="list">
          {project.rooms.map((r) => (
            <li key={r.id} className={r.id === selectedId ? 'sel' : ''} onClick={() => { setTool('select'); select(r.id) }}>
              <span className="name">{r.name}</span>
              <span className="meta">{Object.values(r.walls).filter((w) => w.photo).length}/{r.points.length} fotki</span>
              <button className="mini" onClick={(e) => { e.stopPropagation(); setView({ kind: 'room', roomId: r.id, wall: null }) }}>Otvori</button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

function autoAlign(src: string, setTilt: (deg: number) => void) {
  const img = new Image()
  img.onload = () => setTilt(-detectSkew(img))
  img.src = src
}
