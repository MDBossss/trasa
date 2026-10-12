import { useRef } from 'react'
import { useStore } from '../store'
import { fileToDataUrl } from '../images'
import { cableLengthM, endLabel, type WallInfo } from '../walls'
import { CABLE_ROLES, CABLE_TYPES, ELEMENT_META, RELAY_MODELS, SOCKET_KINDS, isPlace, modulesOf, type BoxDepth, type CableRole, type RelayModel, type Room, type SocketKind, type SwitchKind } from '../types'
import { cableNeeds, resolveCable, roleLabel, terminalMeta } from '../junction'
import { Icon } from './Icons'

const SWITCH_KINDS: { id: SwitchKind; label: string; wires: string }[] = [
  { id: 'obicni', label: 'Obični', wires: 'L + povratna' },
  { id: 'tipkalo', label: 'Tipkalo', wires: 'za relej (Shelly), L + povratna' },
  { id: 'serijski', label: 'Serijski', wires: 'L + 2 povratne, 2 svjetla' },
  { id: 'izmjenicni', label: 'Izmjenični', wires: 'L/povratna + 2 putne, par prekidača' },
  { id: 'krizni', label: 'Križni', wires: '4 putne, između izmjeničnih' },
]
const DEPTHS: { id: BoxDepth; label: string }[] = [{ id: 'plitka', label: 'Standardna (≈50 mm)' }, { id: 'duboka', label: 'Duboka (≥65 mm, za relej)' }]

export function WallSidebar({ room, walls, wall }: { room: Room; walls: WallInfo[]; wall: number | null }) {
  const project = useStore((s) => s.project)
  const selectedId = useStore((s) => s.selectedId)
  const { select, setView, setWallPhoto, updateElement, updateCable, removeSelected, setWallTool } = useStore.getState()
  const roomLights = project.elements.filter((e) => (e.type === 'light' || e.type === 'ledpsu') && e.roomId === room.id)
  const relays = project.elements.filter((e) => e.type === 'relay')
  const hostLabel = (id?: string) => project.elements.find((e) => e.id === id)?.label ?? '?'
  const controllers = (lightId: string) => project.elements.filter((e) => e.type === 'switch' && e.controls?.includes(lightId))
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
            <>
              <label>
                Vrsta
                <select value={el.switchKind ?? 'obicni'} onChange={(e) => updateElement(el.id, { switchKind: e.target.value as SwitchKind })}>
                  {SWITCH_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} · {k.wires}</option>)}
                </select>
              </label>
              <label>
                Na relej
                <select value={el.relayId ?? ''} onChange={(e) => updateElement(el.id, { relayId: e.target.value || undefined, relayInput: e.target.value ? el.relayInput ?? 1 : undefined })}>
                  <option value="">bez releja (klasično)</option>
                  {relays.map((r) => <option key={r.id} value={r.id}>{r.label} {RELAY_MODELS[r.relayModel ?? 'plus1'].label} · u {hostLabel(r.host)}</option>)}
                </select>
              </label>
              {el.relayId && (
                <label>
                  Ulaz releja
                  <select value={el.relayInput ?? 1} onChange={(e) => updateElement(el.id, { relayInput: +e.target.value })}>
                    {Array.from({ length: RELAY_MODELS[relays.find((r) => r.id === el.relayId)?.relayModel ?? 'plus1'].inputs }, (_, i) => <option key={i} value={i + 1}>SW{i + 1}</option>)}
                  </select>
                </label>
              )}
              {el.host && (
                <label>
                  Širina
                  <select value={el.modules ?? 1} onChange={(e) => updateElement(el.id, { modules: +e.target.value })}>
                    <option value={1}>1M</option>
                    <option value={2}>2M</option>
                  </select>
                </label>
              )}
              <div className="controls" hidden={!!el.relayId}>
                <span className="muted">Pali svjetla</span>
                {!roomLights.length && <span className="muted">(nema svjetala u sobi, postavi Svjetlo (L) na zid)</span>}
                {roomLights.map((l) => {
                  const on = el.controls?.includes(l.id) ?? false
                  return (
                    <label key={l.id} className="inline">
                      <input type="checkbox" checked={on} onChange={(e) => updateElement(el.id, { controls: e.target.checked ? [...(el.controls ?? []), l.id] : (el.controls ?? []).filter((x) => x !== l.id) })} />
                      {l.label} <span className="muted">zid {l.wall + 1}</span>
                    </label>
                  )
                })}
              </div>
            </>
          )}
          {(el.type === 'light' || el.type === 'ledpsu') && (
            <>
              <label>
                Napaja ga
                <select value={el.feedRelayId ? `${el.feedRelayId}:${el.feedOutput ?? 1}` : ''} onChange={(e) => { const [r, n] = e.target.value.split(':'); updateElement(el.id, { feedRelayId: r || undefined, feedOutput: r ? +n : undefined }) }}>
                  <option value="">prekidač (klasično)</option>
                  {relays.flatMap((r) => Array.from({ length: RELAY_MODELS[r.relayModel ?? 'plus1'].outputs }, (_, i) => <option key={`${r.id}:${i + 1}`} value={`${r.id}:${i + 1}`}>{r.label} {RELAY_MODELS[r.relayModel ?? 'plus1'].label} · izlaz O{i + 1} · u {hostLabel(r.host)}</option>))}
                </select>
              </label>
              {!el.feedRelayId && <div className="stat"><span>Pali ga</span><b>{controllers(el.id).map((s) => s.label).join(', ') || '—'}</b><span className="muted">označi na prekidaču</span></div>}
            </>
          )}
          {el.type === 'motor' && (
            <>
              <label>
                Pali ga relej
                <select value={el.feedRelayId ?? ''} onChange={(e) => updateElement(el.id, { feedRelayId: e.target.value || undefined, feedOutput: undefined })}>
                  <option value="">nitko (samo daljinski)</option>
                  {relays.filter((r) => RELAY_MODELS[r.relayModel ?? 'plus1'].dry).map((r) => <option key={r.id} value={r.id}>{r.label} {RELAY_MODELS[r.relayModel ?? 'plus1'].label} · u {hostLabel(r.host)}</option>)}
                </select>
              </label>
              <p className="muted">Jedinica vrata dobiva L N PE i dvije žile "impuls" s I i O releja (suhi kontakt, bez napona). Kabel 5×1,5. Shelly: Auto OFF 0,5 s. Tipkalo veži na taj relej ("Na relej"). Sonoff Zigbee releji nemaju suhi kontakt, zato nisu u izboru.</p>
            </>
          )}
          {el.type === 'ledpsu' && (
            <>
              <div className="field-row">
                <label>Traka (m) <input type="number" step={0.1} min={0} value={el.ledM ?? 5} onChange={(e) => updateElement(el.id, { ledM: +e.target.value || 0 })} /></label>
                <label>W/m <input type="number" step={1} min={0} value={el.ledWpm ?? 10} onChange={(e) => updateElement(el.id, { ledWpm: +e.target.value || 0 })} /></label>
              </div>
              <label>Napon <select value={el.ledV ?? 24} onChange={(e) => updateElement(el.id, { ledV: +e.target.value as 12 | 24 })}><option value={24}>24 V (preporuka)</option><option value={12}>12 V</option></select></label>
              <div className="stat"><span>Napajanje</span><b>≥ {Math.ceil(((el.ledM ?? 5) * (el.ledWpm ?? 10) * 1.2) / 10) * 10} W</b><span className="muted">{(el.ledM ?? 5) * (el.ledWpm ?? 10)} W trake × 1,2</span></div>
              <div className="stat"><span>Releji u niši</span><b>{project.elements.filter((h) => h.host === el.id).map((h) => `${h.label} ${RELAY_MODELS[h.relayModel ?? 'rgbw'].label}`).join(', ') || '—'}</b></div>
            </>
          )}
          {el.type === 'socket' && (
            <label>
              Vrsta
              <select value={el.socketKind ?? 'schuko'} onChange={(e) => updateElement(el.id, { socketKind: e.target.value as SocketKind })}>
                {(Object.keys(SOCKET_KINDS) as SocketKind[]).map((k) => <option key={k} value={k}>{SOCKET_KINDS[k].label} · {SOCKET_KINDS[k].modules}M</option>)}
              </select>
            </label>
          )}
          {el.type === 'modbox' && (() => { const used = project.elements.filter((h) => h.host === el.id).reduce((n, h) => n + modulesOf(h), 0); return <div className={`stat ${used > (el.modules ?? 3) ? 'warn' : ''}`}><span>Zauzeto</span><b>{used} / {el.modules ?? 3} M</b><span className="muted">{project.elements.filter((h) => h.host === el.id).map((h) => h.label).join(', ') || 'prazno'}</span></div> })()}
          {el.type === 'modbox' && (
            <label>
              Moduli
              <select value={el.modules ?? 3} onChange={(e) => updateElement(el.id, { modules: +e.target.value })}>
                {[1, 2, 3, 4, 7].map((m) => <option key={m} value={m}>{m}M{m === 3 ? ' (TEM PM3)' : m === 4 ? ' (TEM PM4)' : m === 7 ? ' (TEM PM7)' : ''}</option>)}
              </select>
            </label>
          )}
          {el.type === 'relay' && (
            <>
              <label>
                Model
                <select value={el.relayModel ?? 'plus1'} onChange={(e) => updateElement(el.id, { relayModel: e.target.value as RelayModel })}>
                  {(Object.keys(RELAY_MODELS) as RelayModel[]).map((m) => <option key={m} value={m}>{RELAY_MODELS[m].label} · {RELAY_MODELS[m].inputs} ul. / {RELAY_MODELS[m].outputs} izl.</option>)}
                </select>
              </label>
              {(() => { const m = project.elements.find((x) => x.type === 'motor' && x.feedRelayId === el.id); return <div className="stat"><span>Mod</span><b>{m ? `impuls (suhi kontakt I/O) za ${m.label}` : 'pali fazom (premosnica L → I)'}</b></div> })()}
              <div className="stat"><span>U</span><b>{hostLabel(el.host)}</b><span className="muted">klikni relejem na drugu kutiju da ga preseliš</span></div>
              <div className="stat"><span>Ulazi</span><b>{project.elements.filter((s) => s.relayId === el.id).map((s) => `${s.label}→SW${s.relayInput ?? 1}`).join(', ') || '—'}</b></div>
              <div className="stat"><span>Izlazi</span><b>{project.elements.filter((l) => l.feedRelayId === el.id).map((l) => `O${l.feedOutput ?? 1}→${l.label}`).join(', ') || '—'}</b></div>
              {RELAY_MODELS[el.relayModel ?? 'plus1'].dc && <p className="muted">24 V strana: traka i napajanje u niši, 230 V dolaz na L/N. Tipkala preko mreže (Plus i4) ili na DC ulaze.</p>}
            </>
          )}
          {el.type === 'modbox' && <button onClick={() => setView({ kind: 'junctions', elementId: el.id })}><Icon.box /> Otvori dozu (spojevi)</button>}
          {(isPlace(el) || el.type === 'socket' || (el.type === 'switch' && !el.host)) && (
            <label>
              Doza
              <select value={el.depth ?? ''} onChange={(e) => updateElement(el.id, { depth: (e.target.value || undefined) as BoxDepth | undefined })}>
                <option value="">nije označeno</option>
                {DEPTHS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
          )}
          {el.type === 'box' && <button onClick={() => setView({ kind: 'junctions', elementId: el.id })}><Icon.box /> Otvori kutiju (spojevi)</button>}
          {el.host && <div className="stat"><span>U</span><b>{hostLabel(el.host)}</b></div>}
          <div className="field-row" hidden={!!el.host}>
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
          {(['from', 'to'] as const).map((k) => { const e = cable[k]; return e.kind === 'corner' ? <label key={k}>Visina u kutu (m) <input type="number" step={0.01} value={e.zM} onChange={(ev) => updateCable(cable.id, { [k]: { ...e, zM: +ev.target.value || 0 } })} /></label> : null })}
          {(() => {
            const needs = cableNeeds(cable, project)
            if (needs) return (
              <div className={`stat ${needs.has < needs.needed ? 'warn' : ''}`}>
                <span>Žile</span><b>{needs.needed} potrebno · {needs.has} ima</b>
                <span className="muted">{needs.signals.map((s) => terminalMeta(s, project).label).join(', ')}{needs.has < needs.needed ? ` → uzmi ${needs.suggest}` : ''}</span>
              </div>
            )
            const box = [cable.from, cable.to].map((e) => (e.kind === 'element' ? project.elements.find((x) => x.id === e.id) : undefined)).find((x) => x && isPlace(x))
            const derived = box ? resolveCable(cable, box, project).role : null
            return (
              <label>
                Uloga u kutiji
                <select value={cable.role ?? 'auto'} onChange={(e) => updateCable(cable.id, { role: e.target.value as CableRole })}>
                  <option value="auto">{derived ? `izvedeno: ${roleLabel(derived)}` : 'izvedeno (kad je vezan na kutiju)'}</option>
                  {(Object.keys(CABLE_ROLES) as Exclude<CableRole, 'auto'>[]).map((r) => <option key={r} value={r}>{CABLE_ROLES[r]}</option>)}
                </select>
              </label>
            )
          })()}
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
                <span className="name">{e.conduit.name} <span className="muted">{e.conduit.diameter ? `bužir ø${e.conduit.diameter}` : 'kabel u žlijebu'}</span></span>
                <span className="meta">{e.posM.toFixed(2)} m · {e.zM === null ? 'strop' : `h ${e.zM.toFixed(2)}`}</span>
              </li>
            ))}
            {elements.map((e) => (
              <li key={e.id} className={e.id === selectedId ? 'sel' : ''} onClick={() => { setWallTool('select'); select(e.id) }}>
                <span className="name">{e.label} <span className="muted">{e.type === 'relay' ? RELAY_MODELS[e.relayModel ?? 'plus1'].label : e.switchKind === 'tipkalo' ? 'tipkalo' : ELEMENT_META[e.type].label.toLowerCase()}</span></span>
                <span className="meta">{e.host ? `u ${hostLabel(e.host)}` : `${e.xM.toFixed(2)} m · h ${e.zM.toFixed(2)}`}</span>
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
