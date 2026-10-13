import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { bomFor, type BomLine } from '../bom'
import { allJunctions, allLeafJunctions } from '../junction'
import { Icon } from './Icons'

// Shopping list, not just a table: tick off what is bought (kept per device), see which room needs what,
// and the list as text / CSV for the phone or the supplier.

const fmt = (l: { unit: 'm' | 'kom'; qty: number }) => (l.unit === 'm' ? `${l.qty.toFixed(1).replace('.', ',')} m` : `${l.qty} kom`)

export function MaterialView() {
  const project = useStore((s) => s.project)
  const { setView } = useStore.getState()
  const roomId = useStore((s) => s.roomId)
  const [hideDone, setHideDone] = useState(false)
  const [copied, setCopied] = useState(false)
  const lines = useMemo(() => bomFor(project, roomId), [project, roomId])
  // per-room split of every line, shown when the whole house is listed
  const byRoom = useMemo(() => {
    const m = new Map<string, { room: string; qty: number }[]>()
    if (roomId) return m
    for (const r of project.rooms) for (const l of bomFor(project, r.id)) {
      const k = `${l.group}|${l.item}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push({ room: r.name, qty: l.qty })
    }
    return m
  }, [project, roomId])
  const checks = useMemo(() => [...allJunctions(project), ...allLeafJunctions(project)].flatMap((j) => j.checks.filter((c) => c.level !== 'ok').map((c) => ({ ...c, j }))).filter((c) => !roomId || c.j.room.id === roomId), [project, roomId])
  const groups = [...new Set(lines.map((l) => l.group))]
  const scope = roomId && project.rooms.some((r) => r.id === roomId) ? project.rooms.find((r) => r.id === roomId)!.name : 'cijela kuća'

  // bought items live in this browser only: a shopping aid, not project data
  const doneKey = `trasa-bought:${project.name}`
  const [done, setDone] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(doneKey) ?? '[]')) } catch { return new Set() } })
  useEffect(() => { try { localStorage.setItem(doneKey, JSON.stringify([...done])) } catch { /* private mode */ } }, [done, doneKey])
  const key = (l: BomLine) => `${l.group}|${l.item}`
  const toggle = (l: BomLine) => setDone((d) => { const n = new Set(d); n.has(key(l)) ? n.delete(key(l)) : n.add(key(l)); return n })
  const nDone = lines.filter((l) => done.has(key(l))).length

  const asText = () => groups.map((g) => `${g.toUpperCase()}\n${lines.filter((l) => l.group === g).map((l) => `${done.has(key(l)) ? '[x]' : '[ ]'} ${l.item} · ${fmt(l)}`).join('\n')}`).join('\n\n')
  const copy = async () => {
    try { await navigator.clipboard.writeText(`Materijal · ${project.name} · ${scope}\n\n${asText()}`); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { window.prompt('Kopiraj:', asText()) }
  }
  // semicolon + decimal comma: what a Croatian Excel opens without asking
  const csv = () => {
    const rows = [['Grupa', 'Stavka', 'Količina', 'Jedinica', 'Nabavljeno'], ...lines.map((l) => [l.group, l.item, String(l.qty).replace('.', ','), l.unit, done.has(key(l)) ? 'da' : 'ne'])]
    const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `materijal-${project.name}-${scope}.csv`.replace(/\s+/g, '-'); a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div className="material">
      <div className="room-head">
        <h2>Materijal <span className="muted">· {scope}</span></h2>
        <div className="spacer" />
        <button className="primary" onClick={() => setView({ kind: 'print', roomId })}><Icon.print /> PDF za majstora</button>
      </div>
      <div className="material-body"><div className="material-inner">
        {!lines.length && <p className="muted">Nema materijala: nacrtaj bužire, kutije, elemente i kabele.</p>}
        {lines.length > 0 && (
          <div className="mat-bar">
            <span className="mat-progress"><b>{nDone}</b> / {lines.length} nabavljeno</span>
            <label className="inline"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> sakrij nabavljeno</label>
            <div className="spacer" />
            <button className="mini" onClick={() => void copy()} title="Popis kao tekst, za poruku ili bilješke">{copied ? <><Icon.check /> Kopirano</> : <>Kopiraj popis ({scope})</>}</button>
            <button className="mini" onClick={csv} title="Tablica za Excel (; i decimalni zarez)">Preuzmi CSV</button>
            {nDone > 0 && <button className="mini" onClick={() => setDone(new Set())}>Poništi kvačice</button>}
          </div>
        )}
        {groups.map((g) => {
          const gl = lines.filter((l) => l.group === g)
          const shown = hideDone ? gl.filter((l) => !done.has(key(l))) : gl
          if (!shown.length) return null
          return (
            <section key={g} className="panel-card">
              <h3>{g} <span className="count">{gl.filter((l) => done.has(key(l))).length} / {gl.length}</span>{g === 'Kabeli' && <span className="mini-note">okvirno, uzmi rezervu</span>}</h3>
              <table className="bom-table">
                <tbody>
                  {shown.map((l) => {
                    const isDone = done.has(key(l))
                    // conduits (and anything not tied to a room) show up as "ostalo" so the split adds up to the total
                    const rooms = [...(byRoom.get(key(l)) ?? [])]
                    const rest = l.qty - rooms.reduce((a, r) => a + r.qty, 0)
                    if (rooms.length && rest > 0.01) rooms.push({ room: 'ostalo', qty: Math.round(rest * 2) / 2 })
                    return (
                      <tr key={l.item} className={isDone ? 'done' : ''}>
                        <td className="chk"><input type="checkbox" checked={isDone} onChange={() => toggle(l)} aria-label={`Nabavljeno: ${l.item}`} /></td>
                        <td>
                          <div className="mat-item">{l.item}</div>
                          {rooms.length > 1 ? (
                            <div className="mat-sub">
                              {rooms.length > 1 && <span>{rooms.map((r) => `${r.room} ${fmt({ unit: l.unit, qty: r.qty })}`).join(' · ')}</span>}
                            </div>
                          ) : null}
                        </td>
                        <td className="num">{fmt(l)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
        {checks.length > 0 && (
          <section className="panel-card">
            <h3>Otvorene provjere <span className="count">{checks.length}</span></h3>
            <div className="checks">
              {checks.map((c, i) => <div key={i} className={`check ${c.level}`} role="button" tabIndex={0} onClick={() => setView({ kind: 'junctions', elementId: c.j.box.id })}><span>{c.level === 'err' ? '✕' : '⚠'}</span><span><b>{c.j.box.label} ({c.j.room.name}):</b> {c.text}</span></div>)}
            </div>
          </section>
        )}
        <p className="muted"><b>Duljine kabela su okvirne</b>: mjere s tlocrta i fotki nisu točne, pa uzmi rezervu. Računa se duljina po zidu + bužir + 30 cm po kraju u kutiji, zaokruženo na 0,5 m. Bužiri se ne popisuju. Kvačice "nabavljeno" ostaju samo na ovom uređaju.</p>
      </div>
      </div>
    </div>
  )
}

