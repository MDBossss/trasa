import { useState } from 'react'
import { conduitVisible, useStore } from '../store'
import { fmtMeters, polylineLength } from '../geometry'
import { DIAMETERS, type Category, type Conduit } from '../types'
import { conduitTouchesRoom } from '../walls'
import { uid } from '../store'
import { detectSkew } from '../images'
import { Icon } from './Icons'

export function Sidebar() {
  const project = useStore((s) => s.project)
  const selectedId = useStore((s) => s.selectedId)
  const focusRoomId = useStore((s) => s.focusRoomId)
  const hiddenCategories = useStore((s) => s.hiddenCategories)
  const hiddenConduits = useStore((s) => s.hiddenConduits)
  const soloCategory = useStore((s) => s.soloCategory)
  const { setFocusRoom, toggleHiddenCategory, toggleHiddenConduit, setSoloCategory } = useStore.getState()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [listMode, setListModeState] = useState<'all' | 'category' | 'room'>(() => { try { return (localStorage.getItem('trasa-list-mode') as 'all') || 'all' } catch { return 'all' } })
  const setListMode = (m: typeof listMode) => { setListModeState(m); try { localStorage.setItem('trasa-list-mode', m) } catch { /* private mode */ } }
  const vis = (c: typeof project.conduits[number]) => conduitVisible(c, { project, focusRoomId, hiddenCategories, hiddenConduits, selectedId: null, soloCategory })
  const hiddenByFocus = project.conduits.filter((c) => !vis(c)).length
  const { select, patchProject, updateConduit, updateRoom, removeSelected, setView, setTool, setTilt, rotatePlan, setCategories } = useStore.getState()
  const conduit = project.conduits.find((c) => c.id === selectedId)
  const room = project.rooms.find((r) => r.id === selectedId)
  const ppm = project.pxPerMeter
  const hasPlan = !!project.planImage
  const setupDone = hasPlan && !!ppm
  const originSet = !!(project.gridOrigin.x || project.gridOrigin.y)
  // list groups: by category (uncategorised last) or by room (a conduit can enter two rooms)
  type Group = { id: string; name: string; color?: string; items: Conduit[]; kind: 'category' | 'room' | 'all' }
  const groups: Group[] =
    listMode === 'category'
      ? [
          ...project.categories.map((cat) => ({ id: cat.id, name: cat.name, color: cat.color, kind: 'category' as const, items: project.conduits.filter((c) => c.categoryId === cat.id) })),
          { id: '', name: 'Bez kategorije', color: '#9aa0ab', kind: 'category' as const, items: project.conduits.filter((c) => !c.categoryId || !project.categories.some((x) => x.id === c.categoryId)) },
        ].filter((g) => g.items.length > 0)
      : listMode === 'room'
        ? [
            ...project.rooms.map((r) => ({ id: r.id, name: r.name, kind: 'room' as const, items: project.conduits.filter((c) => conduitTouchesRoom(c, r, ppm)) })),
            { id: '', name: 'Izvan soba', kind: 'room' as const, items: project.conduits.filter((c) => !project.rooms.some((r) => conduitTouchesRoom(c, r, ppm))) },
          ].filter((g) => g.items.length > 0)
        : [{ id: 'all', name: 'Svi', kind: 'all' as const, items: project.conduits }]

  return (
    <aside className="sidebar">
      {conduit && (
        <section className="props">
          <div className="props-head">
            <span className="swatch lg" style={{ background: conduit.color }} />
            <h3>Bužir</h3>
            <button className="icon-btn danger" onClick={removeSelected} title="Obriši (Delete)" aria-label="Obriši bužir"><Icon.trash /></button>
          </div>
          <label>Naziv <input value={conduit.name} onChange={(e) => updateConduit(conduit.id, { name: e.target.value })} /></label>
          <label>
            Kategorija
            <select value={conduit.categoryId ?? ''} onChange={(e) => updateConduit(conduit.id, { categoryId: e.target.value || undefined })}>
              <option value="">(bez, vlastita boja)</option>
              {project.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="field-row">
            <label>Boja <input type="color" value={conduit.color} onChange={(e) => updateConduit(conduit.id, { color: e.target.value, categoryId: undefined })} /></label>
            <label>
              Promjer
              <select value={conduit.diameter} onChange={(e) => updateConduit(conduit.id, { diameter: +e.target.value })}>
                {DIAMETERS.map((d) => <option key={d} value={d}>ø{d}</option>)}
              </select>
            </label>
          </div>
          <label>Od <input value={conduit.from} placeholder="npr. ormar" onChange={(e) => updateConduit(conduit.id, { from: e.target.value })} /></label>
          <label>Do <input value={conduit.to} placeholder="npr. DS.K1" onChange={(e) => updateConduit(conduit.id, { to: e.target.value })} /></label>
          <label>Bilješka <textarea rows={2} value={conduit.note} onChange={(e) => updateConduit(conduit.id, { note: e.target.value })} /></label>
          <div className="stat"><span>Duljina</span><b>{fmtMeters(polylineLength(conduit.points), ppm)}</b><span className="muted">{conduit.points.length} točaka</span></div>
        </section>
      )}

      {room && (
        <section className="props">
          <div className="props-head">
            <h3>Soba</h3>
            <button className="icon-btn danger" onClick={removeSelected} title="Obriši (Delete)" aria-label="Obriši sobu"><Icon.trash /></button>
          </div>
          <label>Naziv <input value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value })} /></label>
          <div className="stat"><span>Zidova</span><b>{room.points.length}</b><span className="muted">{Object.values(room.walls).filter((w) => w.photo).length} s fotkom</span></div>
          <button className="primary" onClick={() => setView({ kind: 'room', roomId: room.id, wall: 0 })}><Icon.camera /> Otvori sobu</button>
        </section>
      )}

      <section>
        <h3>Bužiri <span className="count">{project.conduits.length - hiddenByFocus}{hiddenByFocus ? ` / ${project.conduits.length}` : ''}</span>
          {(focusRoomId || soloCategory !== null || hiddenCategories.length > 0 || hiddenConduits.length > 0) && (
            <button className="mini" onClick={() => { setFocusRoom(null); setSoloCategory(null); hiddenCategories.forEach(toggleHiddenCategory); hiddenConduits.forEach(toggleHiddenConduit) }}>Prikaži sve</button>
          )}
        </h3>
        {project.conduits.length === 0 && <p className="muted">Alat Bužir (B), pa klikaj trasu po tlocrtu.</p>}
        {project.conduits.length > 0 && (
          <div className="segmented" role="tablist" aria-label="Prikaz bužira">
            {([['all', 'Svi'], ['category', 'Po kategoriji'], ['room', 'Po sobama']] as const).map(([m, label]) => (
              <button key={m} role="tab" aria-selected={listMode === m} className={listMode === m ? 'active' : ''} onClick={() => setListMode(m)}>{label}</button>
            ))}
          </div>
        )}
        {groups.map((g) => {
          const off = g.kind === 'category' && g.id !== '' && hiddenCategories.includes(g.id)
          const solo = g.kind === 'category' ? soloCategory === g.id : g.kind === 'room' ? focusRoomId === g.id && g.id !== '' : false
          const open = g.kind === 'all' || !collapsed[g.id]
          const setSolo = () => (g.kind === 'category' ? setSoloCategory(solo ? null : g.id) : setFocusRoom(solo ? null : g.id))
          return (
            <div key={g.id} className={`group ${off ? 'off' : ''} ${solo ? 'solo' : ''} ${g.kind === 'all' ? 'flat' : ''}`}>
              {g.kind !== 'all' && (
                <div className="group-head" onClick={() => setCollapsed({ ...collapsed, [g.id]: open })}>
                  <Icon.chevron className={`chev ${open ? 'open' : ''}`} />
                  {g.color && <span className="swatch" style={{ background: g.color }} />}
                  <span className="name">{g.name}</span>
                  <span className="count">{g.items.length}</span>
                  {!(g.kind === 'room' && g.id === '') && (
                    <button className={`mini solo-btn ${solo ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setSolo() }}
                      title={solo ? 'Prikaži sve' : g.kind === 'room' ? 'Prikaži samo bužire ove sobe i zumiraj' : 'Prikaži samo ovu kategoriju'} aria-label={`Samo ${g.name}`} aria-pressed={solo}>
                      {g.kind === 'room' ? <><Icon.focus /> Fokus</> : 'Samo'}
                    </button>
                  )}
                  {g.kind === 'room' && g.id !== '' && <button className="mini" onClick={(e) => { e.stopPropagation(); setView({ kind: 'room', roomId: g.id, wall: 0 }) }}>Otvori</button>}
                  {g.kind === 'category' && g.id !== '' && (
                    <button className="icon-btn eye" onClick={(e) => { e.stopPropagation(); if (e.altKey) setSolo(); else toggleHiddenCategory(g.id) }}
                      title={off ? 'Prikaži kategoriju (Alt+klik = samo ova)' : 'Sakrij kategoriju (Alt+klik = samo ova)'} aria-label={off ? `Prikaži ${g.name}` : `Sakrij ${g.name}`}>
                      {off ? <Icon.eyeOff /> : <Icon.eye />}
                    </button>
                  )}
                </div>
              )}
              {open && (
                <ul className="list">
                  {g.items.map((c) => {
                    const shown = vis(c)
                    const eyeOff = hiddenConduits.includes(c.id)
                    return (
                      <li key={c.id} className={`${c.id === selectedId ? 'sel' : ''} ${shown ? '' : 'dim'}`} onClick={() => { setTool('select'); select(c.id) }}>
                        <span className="swatch" style={{ background: c.color }} />
                        <span className="name">{c.name}</span>
                        <span className="meta">ø{c.diameter} · {fmtMeters(polylineLength(c.points), ppm)}</span>
                        <button className="icon-btn eye" onClick={(e) => { e.stopPropagation(); toggleHiddenConduit(c.id) }} title={eyeOff ? 'Prikaži bužir' : 'Sakrij bužir'} aria-label={eyeOff ? `Prikaži ${c.name}` : `Sakrij ${c.name}`}>
                          {eyeOff ? <Icon.eyeOff /> : <Icon.eye />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </section>

      <section>
        <h3>Sobe <span className="count">{project.rooms.length}</span></h3>
        {project.rooms.length === 0 && <p className="muted">Alat Soba (R), pa klikaj kutove.</p>}
        <ul className="list">
          {project.rooms.map((r) => (
            <li key={r.id} className={`${r.id === selectedId ? 'sel' : ''} ${focusRoomId === r.id ? 'focused' : ''}`} onClick={() => { setTool('select'); select(r.id) }}>
              <span className="name">{r.name}</span>
              <span className="meta">{Object.values(r.walls).filter((w) => w.photo).length}/{r.points.length} fotki</span>
              <button className={`icon-btn ${focusRoomId === r.id ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); setFocusRoom(focusRoomId === r.id ? null : r.id) }} title={focusRoomId === r.id ? 'Prikaži sve sobe' : 'Fokusiraj sobu: samo njezini bužiri, zumiraj'} aria-label={`Fokus ${r.name}`} aria-pressed={focusRoomId === r.id}><Icon.focus /></button>
              <button className="mini" onClick={(e) => { e.stopPropagation(); setView({ kind: 'room', roomId: r.id, wall: 0 }) }}>Otvori</button>
            </li>
          ))}
        </ul>
      </section>

      <details className="setup">
        <summary>
          <Icon.chevron className="chev" />
          <h3>Kategorije bužira</h3>
          <span className="muted">{project.categories.length}</span>
        </summary>
        <p className="muted cat-hint">Bužir čiji naziv sadrži ključnu riječ dobije kategoriju i njezinu boju. Ključne riječi odvoji zarezom.</p>
        <ul className="cat-list">
          {project.categories.map((c) => (
            <CategoryRow key={c.id} c={c} onChange={(n) => setCategories(project.categories.map((x) => (x.id === c.id ? n : x)))} onRemove={() => setCategories(project.categories.filter((x) => x.id !== c.id))} />
          ))}
        </ul>
        <div className="cat-actions"><button className="mini" onClick={() => setCategories([...project.categories, { id: uid(), name: 'Nova', color: '#808080', keywords: [] }])}>+ Kategorija</button></div>
      </details>

      <details className="setup" open={!setupDone}>
        <summary>
          <Icon.chevron className="chev" />
          <h3>Tlocrt</h3>
          <span className={`badge ${setupDone ? 'ok' : 'warn'}`}>{setupDone ? 'postavljen' : 'postavi'}</span>
        </summary>
        <ol className="steps">
          <li className={hasPlan ? 'done' : ''}>
            <span className="step-n">{hasPlan ? <Icon.check /> : 1}</span>
            <div>
              <div className="step-t">Slika tlocrta</div>
              {hasPlan ? (
                <div className="step-c">
                  <button className="mini" onClick={() => rotatePlan(-1)} title="Rotiraj ulijevo"><Icon.rotateL /> 90°</button>
                  <button className="mini" onClick={() => rotatePlan(1)} title="Rotiraj udesno"><Icon.rotateR /> 90°</button>
                  <label className="inline">Prozirnost <input type="range" min={0} max={1} step={0.05} value={project.planOpacity} onChange={(e) => patchProject({ planOpacity: +e.target.value })} /></label>
                </div>
              ) : <div className="step-c muted">Meni ☰ → Učitaj tlocrt, ili ispusti sliku na platno.</div>}
            </div>
          </li>
          <li className={hasPlan && project.planTilt ? 'done' : ''}>
            <span className="step-n">{project.planTilt ? <Icon.check /> : 2}</span>
            <div>
              <div className="step-t">Poravnaj nakrivljen sken <span className="muted">(ako treba)</span></div>
              <div className="step-c">
                <button className="mini" disabled={!hasPlan} onClick={() => autoAlign(project.planImage!, setTilt)}>Auto poravnaj</button>
                <button className="mini" disabled={!hasPlan} onClick={() => setTool('align')}>Po liniji (A)</button>
                <span className="tilt-controls">
                  <button className="mini" disabled={!hasPlan} onClick={() => setTilt(project.planTilt - 1)}>−1°</button>
                  <button className="mini" disabled={!hasPlan} onClick={() => setTilt(project.planTilt - 0.1)}>−0.1</button>
                  <input type="number" step={0.1} value={project.planTilt} disabled={!hasPlan} onChange={(e) => setTilt(+e.target.value || 0)} aria-label="Nagib" />
                  <button className="mini" disabled={!hasPlan} onClick={() => setTilt(project.planTilt + 0.1)}>+0.1</button>
                  <button className="mini" disabled={!hasPlan} onClick={() => setTilt(project.planTilt + 1)}>+1°</button>
                  <button className="mini" disabled={!project.planTilt} onClick={() => setTilt(0)}>Reset</button>
                </span>
              </div>
            </div>
          </li>
          <li className={originSet ? 'done' : ''}>
            <span className="step-n">{originSet ? <Icon.check /> : 3}</span>
            <div>
              <div className="step-t">Ishodište grida na kut zida</div>
              <div className="step-c">
                <button className="mini" disabled={!hasPlan} onClick={() => setTool('origin')}>Postavi (O)</button>
                <span className="muted">{Math.round(project.gridOrigin.x)}, {Math.round(project.gridOrigin.y)}</span>
                <button className="mini" disabled={!originSet} onClick={() => patchProject({ gridOrigin: { x: 0, y: 0 } })}>Reset</button>
              </div>
            </div>
          </li>
          <li className={ppm ? 'done' : ''}>
            <span className="step-n">{ppm ? <Icon.check /> : 4}</span>
            <div>
              <div className="step-t">Mjerilo</div>
              <div className="step-c">
                <button className="mini" disabled={!hasPlan} onClick={() => setTool('calibrate')}>Izmjeri (C)</button>
                <span className={ppm ? 'ok' : 'muted'}>{ppm ? `${ppm.toFixed(1)} px/m` : 'nije postavljeno'}</span>
              </div>
            </div>
          </li>
        </ol>
        <div className="field-row">
          <label>Grid (cm) <input type="number" min={1} value={project.gridCm} onChange={(e) => patchProject({ gridCm: Math.max(1, +e.target.value || 10) })} /></label>
          <label>Strop (m) <input type="number" step={0.05} value={project.ceilingM} onChange={(e) => patchProject({ ceilingM: +e.target.value || 2.6 })} /></label>
        </div>
      </details>
    </aside>
  )
}

function autoAlign(src: string, setTilt: (deg: number) => void) {
  const img = new Image()
  img.onload = () => setTilt(-detectSkew(img))
  img.src = src
}

function CategoryRow({ c, onChange, onRemove }: { c: Category; onChange: (c: Category) => void; onRemove: () => void }) {
  return (
    <li className="cat-row">
      <input type="color" value={c.color} onChange={(e) => onChange({ ...c, color: e.target.value })} aria-label="Boja kategorije" />
      <input className="cat-name" value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value })} aria-label="Naziv kategorije" />
      <input className="cat-kw" value={c.keywords.join(', ')} placeholder="ključne riječi" onChange={(e) => onChange({ ...c, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} aria-label="Ključne riječi" />
      <button className="icon-btn danger" onClick={onRemove} title="Obriši kategoriju" aria-label="Obriši kategoriju"><Icon.trash /></button>
    </li>
  )
}
