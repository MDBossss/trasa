import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { bomFor } from '../bom'
import { allJunctions } from '../junction'
import { Icon } from './Icons'

export function MaterialView() {
  const project = useStore((s) => s.project)
  const { setView } = useStore.getState()
  const [roomId, setRoomId] = useState<string | null>(null)
  const lines = useMemo(() => bomFor(project, roomId), [project, roomId])
  const checks = useMemo(() => allJunctions(project).flatMap((j) => j.checks.filter((c) => c.level !== 'ok').map((c) => ({ ...c, j }))).filter((c) => !roomId || c.j.room.id === roomId), [project, roomId])
  const groups = [...new Set(lines.map((l) => l.group))]
  const fmt = (l: { unit: 'm' | 'kom'; qty: number }) => (l.unit === 'm' ? `${l.qty.toFixed(1).replace('.', ',')} m` : `${l.qty} kom`)

  return (
    <div className="material">
      <div className="room-head">
        <button onClick={() => setView({ kind: 'plan' })}><Icon.back /> Tlocrt</button>
        <h2>Materijal</h2>
        <div className="segmented">
          <button className={roomId === null ? 'on' : ''} onClick={() => setRoomId(null)}>Cijela kuća</button>
          {project.rooms.map((r) => <button key={r.id} className={roomId === r.id ? 'on' : ''} onClick={() => setRoomId(r.id)}>{r.name}</button>)}
        </div>
        <div className="spacer" />
        <button className="primary" onClick={() => setView({ kind: 'print', roomId })}><Icon.print /> PDF za majstora</button>
      </div>
      <div className="material-body">
        {!lines.length && <p className="muted">Nema materijala: nacrtaj bužire, kutije, elemente i kabele.</p>}
        {groups.map((g) => (
          <section key={g} className="panel-card">
            <h3>{g}</h3>
            <table className="bom-table">
              <tbody>
                {lines.filter((l) => l.group === g).map((l) => (
                  <tr key={l.item}><td>{l.item}</td><td className="num">{fmt(l)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {checks.length > 0 && (
          <section className="panel-card">
            <h3>Otvorene provjere <span className="count">{checks.length}</span></h3>
            <div className="checks">
              {checks.map((c, i) => <div key={i} className={`check ${c.level}`} role="button" tabIndex={0} onClick={() => setView({ kind: 'junctions', elementId: c.j.box.id })}><span>{c.level === 'err' ? '✕' : '⚠'}</span><span><b>{c.j.box.label} ({c.j.room.name}):</b> {c.text}</span></div>)}
            </div>
          </section>
        )}
        <p className="muted">Kabeli: duljina po zidu + bužir + 30 cm rezerve po kraju u kutiji, zaokruženo na 0,5 m. Bužir se broji jednom, uz kabel na njegovom početku.</p>
      </div>
    </div>
  )
}
