import { Fragment, useRef } from 'react'
import { useStore } from '../store'
import { fileToDataUrl } from '../images'
import { cableLengthM, endLabel, type WallInfo } from '../walls'
import { socket15Of, cableStockOf, cableShort, frameSlots, frameName, CABLE_ROLES, CABLE_TYPES, ELEMENT_META, RELAY_MODELS, SOCKET_KINDS, isPlace, modulesOf, WIRE_LABEL, APPLIANCES, type ApplianceKind, type BoxDepth, type CableRole, type RelayModel, type Room, type SocketKind, type SwitchKind, type WallElement, relayModelOf, hostedFront } from '../types'
import { cableIssues, cableNeeds, chainCables, circuitsOf, resolveCable, roleLabel, terminalMeta } from '../junction'
import { Icon } from './Icons'
import { wireSwatch } from './JunctionCanvas'

// smallest NYM-J of the same cross-section that has enough cores

const SWITCH_KINDS: { id: SwitchKind; label: string; wires: string }[] = [
  { id: 'obicni', label: 'Obični', wires: 'L + povratna' },
  { id: 'tipkalo', label: 'Tipkalo', wires: 'za relej (Shelly), L + povratna' },
  { id: 'serijski', label: 'Serijski', wires: 'L + 2 povratne, 2 svjetla' },
  { id: 'izmjenicni', label: 'Izmjenični', wires: 'L/povratna + 2 putne, par prekidača' },
  { id: 'krizni', label: 'Križni', wires: '4 putne, između izmjeničnih' },
]
const DEPTHS: { id: BoxDepth; label: string }[] = [{ id: 'plitka', label: 'Standardna (≈50 mm)' }, { id: 'duboka', label: 'Duboka (≥65 mm, za relej)' }]

export function WallSidebar({ room, walls, wall, part }: { room: Room; walls: WallInfo[]; wall: number | null; part?: 'nav' | 'props' }) {
  const nav = !part || part === 'nav', props = !part || part === 'props'
  const project = useStore((s) => s.project)
  const selectedId = useStore((s) => s.selectedId)
  const { select, setView, setWallPhoto, updateRoom, updateElement, updateCable, addCable, removeSelected, setWallTool } = useStore.getState()
  const allLights = project.elements.filter((e) => e.type === 'light' || e.type === 'ledpsu')
  const roomLights = allLights.filter((e) => e.roomId === room.id)
  const relays = project.elements.filter((e) => e.type === 'relay')
  const roomName = (id: string) => project.rooms.find((r) => r.id === id)?.name ?? '?'
  // relays of this room first, the rest grouped by room (a hallway relay may sit next door)
  const relayGroups = (list: typeof relays, render: (r: typeof relays[number]) => React.ReactNode) => {
    const here = list.filter((r) => r.roomId === room.id), there = list.filter((r) => r.roomId !== room.id)
    return (
      <>
        {here.length > 0 && <optgroup label="U ovoj sobi">{here.map(render)}</optgroup>}
        {there.length > 0 && <optgroup label="Ostale sobe">{there.map(render)}</optgroup>}
      </>
    )
  }
  const hostLabel = (id?: string) => project.elements.find((e) => e.id === id)?.label ?? '?'
  const controllers = (lightId: string) => project.elements.filter((e) => e.type === 'switch' && e.controls?.includes(lightId))
  const fileRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
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
    <aside className={`sidebar ${part === 'nav' ? 'navigator' : ''}`}>
      {nav && <section>
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
        <label className="inline" title="Spavaće sobe: utičnice za punjače i lampe smiju biti na 3×1,5. Ostale sobe traže 2,5 mm² (Postavke projekta).">
          <input type="checkbox" checked={socket15Of(room)} onChange={(e) => updateRoom(room.id, { socket15: e.target.checked })} />
          Utičnice smiju na 3×1,5 (spavaća soba)
        </label>
        <ul className="list">
          {walls.map((w) => (
            <li key={w.i} className={wall === w.i ? 'sel' : ''} onClick={() => setView({ kind: 'room', roomId: room.id, wall: w.i })}>
              <span className="name">Zid {w.i + 1}</span>
              <span className="meta">{w.lengthM.toFixed(2)} m · {w.exits.length} izl. · {room.walls[w.i]?.photo ? 'foto' : 'bez fote'}</span>
            </li>
          ))}
        </ul>
      </section>}

      {props && current && (
        <section>
          <h3>Fotka zida {current.i + 1}</h3>
          <div className="field-row">
            <button onClick={() => fileRef.current?.click()} title="Otvori kameru (na mobitelu)"><Icon.camera /> Slikaj</button>
            <button onClick={() => galleryRef.current?.click()} title="Odaberi postojeću fotku iz galerije ili mape"><Icon.image /> {room.walls[current.i]?.photo ? 'Zamijeni iz galerije' : 'Iz galerije'}</button>
            {room.walls[current.i]?.photo && <button className="icon-btn danger" title="Ukloni fotku" aria-label="Ukloni fotku" onClick={() => setWallPhoto(room.id, current.i, undefined)}><Icon.trash /></button>}
          </div>
          {room.walls[current.i]?.photo && (
            <label className="check-row" title="Fotka se rastegne na punu širinu i visinu zida; omjer slike se mijenja">
              <input type="checkbox" checked={!!room.walls[current.i]?.photoStretch} onChange={(e) => updateRoom(room.id, { walls: { ...room.walls, [current.i]: { ...room.walls[current.i], photoStretch: e.target.checked || undefined } } })} />
              <span>Rastegni na širinu zida</span>
            </label>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = '' }} />
        </section>
      )}

      {props && el && (
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
                  {relayGroups(relays, (r) => <option key={r.id} value={r.id}>{r.label} {RELAY_MODELS[relayModelOf(r)].label} · u {hostLabel(r.host)}{r.roomId !== room.id ? ` (${roomName(r.roomId)})` : ''}</option>)}
                </select>
              </label>
              {el.relayId && (
                <label>
                  Ulaz releja
                  <select value={el.relayInput ?? 1} onChange={(e) => updateElement(el.id, { relayInput: +e.target.value })}>
                    {Array.from({ length: RELAY_MODELS[relayModelOf(relays.find((r) => r.id === el.relayId) ?? {})].inputs }, (_, i) => <option key={i} value={i + 1}>SW{i + 1}</option>)}
                  </select>
                </label>
              )}
              <label className="check-row" title="LED u tipki svijetli dok je trošilo upaljeno; spaja se na izlaz (releja ili prekidača) i nulu">
                <input type="checkbox" checked={!!el.lamp} onChange={(e) => updateElement(el.id, { lamp: e.target.checked || undefined })} />
                <span>S kontrolnom lampicom <span className="muted">(svijetli kad je upaljeno)</span></span>
              </label>
              {el.host && (
                <label>
                  Širina
                  <select value={el.modules ?? 1} onChange={(e) => updateElement(el.id, { modules: +e.target.value })}>
                    <option value={1}>1M</option>
                    <option value={2}>2M</option>
                  </select>
                </label>
              )}
              {el.host && <SlotRow el={el} />}
              <div className="controls" hidden={!!el.relayId}>
                <span className="muted">Pali svjetla</span>
                {!roomLights.length && <span className="muted">(nema svjetala u sobi, postavi Svjetlo (L) na zid)</span>}
                {/* lights of this room, then lights elsewhere this switch already drives (e.g. a terrace light switched from inside) */}
                {[...roomLights, ...allLights.filter((l) => l.roomId !== room.id && el.controls?.includes(l.id))].map((l) => {
                  const on = el.controls?.includes(l.id) ?? false
                  return (
                    <label key={l.id} className="inline">
                      <input type="checkbox" checked={on} onChange={(e) => updateElement(el.id, { controls: e.target.checked ? [...(el.controls ?? []), l.id] : (el.controls ?? []).filter((x) => x !== l.id) })} />
                      {l.label} <span className="muted">{l.roomId !== room.id ? `${roomName(l.roomId)}, ` : ''}zid {l.wall + 1}</span>
                    </label>
                  )
                })}
                {allLights.some((l) => l.roomId !== room.id && !el.controls?.includes(l.id)) && (
                  <select aria-label="Svjetlo u drugoj sobi" value="" onChange={(e) => e.target.value && updateElement(el.id, { controls: [...(el.controls ?? []), e.target.value] })}>
                    <option value="">+ svjetlo u drugoj sobi…</option>
                    {project.rooms.filter((r) => r.id !== room.id).map((r) => { const ls = allLights.filter((l) => l.roomId === r.id && !el.controls?.includes(l.id)); return ls.length ? <optgroup key={r.id} label={r.name}>{ls.map((l) => <option key={l.id} value={l.id}>{l.label} · zid {l.wall + 1}</option>)}</optgroup> : null })}
                  </select>
                )}
              </div>
            </>
          )}
          {(el.type === 'light' || el.type === 'ledpsu' || el.type === 'boiler') && (
            <>
              <label>
                Napaja ga
                <select value={el.feedRelayId ? `${el.feedRelayId}:${el.feedOutput ?? 1}` : ''} onChange={(e) => { const [r, n] = e.target.value.split(':'); updateElement(el.id, { feedRelayId: r || undefined, feedOutput: r ? +n : undefined }) }}>
                  <option value="">{el.type === 'boiler' ? 'izravno (bez releja)' : 'prekidač (klasično)'}</option>
                  {relayGroups(relays.filter((r) => RELAY_MODELS[relayModelOf(r)].outputs > 0), (r) => <Fragment key={r.id}>{Array.from({ length: RELAY_MODELS[relayModelOf(r)].outputs }, (_, i) => <option key={`${r.id}:${i + 1}`} value={`${r.id}:${i + 1}`}>{r.label} {RELAY_MODELS[relayModelOf(r)].label} · izlaz O{i + 1} · u {hostLabel(r.host)}{r.roomId !== room.id ? ` (${roomName(r.roomId)})` : ''}</option>)}</Fragment>)}
                </select>
              </label>
              {!el.feedRelayId && el.type !== 'boiler' && <div className="stat"><span>Pali ga</span><b>{controllers(el.id).map((s) => s.label).join(', ') || '—'}</b><span className="muted">označi na prekidaču</span></div>}
            </>
          )}
          {el.type === 'appliance' && (
            <>
              <label>
                Uređaj
                <select value={el.appliance ?? 'hob'} onChange={(e) => { const k = e.target.value as ApplianceKind; const was = APPLIANCES[el.appliance ?? 'hob']; updateElement(el.id, { appliance: k, ...(Math.abs(el.zM - was.zM) < 0.01 ? { zM: APPLIANCES[k].zM } : {}) }) }}>
                  {(Object.keys(APPLIANCES) as ApplianceKind[]).map((k) => <option key={k} value={k}>{APPLIANCES[k].label} · {APPLIANCES[k].cable.replace('NYM-J ', '')}</option>)}
                </select>
              </label>
              <p className="muted">{APPLIANCES[el.appliance ?? 'hob'].note}</p>
            </>
          )}
          {el.type === 'boiler' && (
            <p className="muted">Fiksni priključak bez utikača: kabel <b>3×2,5</b> na vlastiti krug (<b>B16</b>, FID 30 mA), ravno iz ormara. Na zidu podžbukna priključna kutija s izvodom kabela; kod bojlera u kupaoni po želji dvopolni prekidač (TEM SM20) da se isključe i faza i nula.</p>
          )}
          {el.type === 'kip' && (
            <p className="muted">Traka FeZn iz temelja na sabirnicu. Kabel do ormara je Cu 16 mm² (glavni zaštitni vodič), kabeli do slobodnog kraja su Cu 6 mm² za izjednačenje: u bilješku kabela upiši što spaja (vodovod, grijanje, plin, bojler, kada).</p>
          )}
          {el.type === 'motor' && (
            <>
              <label>
                Pali ga relej
                <select value={el.feedRelayId ?? ''} onChange={(e) => updateElement(el.id, { feedRelayId: e.target.value || undefined, feedOutput: undefined })}>
                  <option value="">nitko (samo daljinski)</option>
                  {relayGroups(relays.filter((r) => RELAY_MODELS[relayModelOf(r)].dry), (r) => <option key={r.id} value={r.id}>{r.label} {RELAY_MODELS[relayModelOf(r)].label} · u {hostLabel(r.host)}{r.roomId !== room.id ? ` (${roomName(r.roomId)})` : ''}</option>)}
                </select>
              </label>
              <p className="muted">Jedinica vrata dobiva L N PE i dvije žile "impuls" s I i O releja (suhi kontakt, bez napona). Kabel 5×1,5, ili 3×1,5 za napajanje i zaseban upravljački 2×0,75 za impuls. Shelly: Auto OFF 0,5 s. Tipkalo veži na taj relej ("Na relej"). Sonoff nema suhi kontakt, zato za vrata nije u izboru.</p>
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
              <div className="stat"><span>Releji uz traku</span><b>{project.elements.filter((h) => h.host === el.id).map((h) => `${h.label} ${RELAY_MODELS[relayModelOf(h)].label}`).join(', ') || '—'}</b></div>
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
          {el.type === 'socket' && el.host && <SlotRow el={el} />}
          {el.type === 'modbox' && (() => { const front = hostedFront(project.elements, el.id); const used = frameSlots(front, el.modules ?? 3).used; return <div className={`stat ${used > (el.modules ?? 3) ? 'warn' : ''}`}><span>Zauzeto</span><b>{used} / {el.modules ?? 3} M{(el.modules ?? 3) > 7 ? ' (2 reda)' : ''}</b><span className="muted">{front.map((h) => `${h.gapBefore ? '· '.repeat(h.gapBefore) : ''}${h.label}`).join(' → ') || 'prazno'}</span></div> })()}
          {el.type === 'modbox' && (
            <label>
              Moduli
              <select value={el.modules ?? 3} onChange={(e) => updateElement(el.id, { modules: +e.target.value })}>
                {[1, 2, 3, 4, 7, 14].map((m) => <option key={m} value={m}>{frameName(m)}{m === 3 ? ' (TEM PM3)' : m === 4 ? ' (TEM PM4)' : m === 7 ? ' (TEM PM7)' : m === 14 ? ' (dvoredna, 2 × 7)' : ''}</option>)}
              </select>
            </label>
          )}
          {el.type === 'relay' && (
            <>
              <label>
                Model
                <select value={relayModelOf(el)} onChange={(e) => updateElement(el.id, { relayModel: e.target.value as RelayModel })}>
                  {(Object.keys(RELAY_MODELS) as RelayModel[]).map((m) => <option key={m} value={m}>{RELAY_MODELS[m].label} · {RELAY_MODELS[m].inputs} ul. / {RELAY_MODELS[m].outputs} izl.</option>)}
                </select>
              </label>
              {(() => { const m = project.elements.find((x) => x.type === 'motor' && x.feedRelayId === el.id); return <div className="stat"><span>Mod</span><b>{m ? `impuls (suhi kontakt I/O) za ${m.label}` : 'pali fazom (premosnica L → I)'}</b></div> })()}
              <div className="stat"><span>U</span><b>{hostLabel(el.host)}</b><span className="muted">klikni relejem na drugu kutiju da ga preseliš</span></div>
              <div className="stat"><span>Ulazi</span><b>{project.elements.filter((s) => s.relayId === el.id).map((s) => `${s.label}→SW${s.relayInput ?? 1}`).join(', ') || '—'}</b></div>
              <div className="stat"><span>Izlazi</span><b>{project.elements.filter((l) => l.feedRelayId === el.id).map((l) => `O${l.feedOutput ?? 1}→${l.label}`).join(', ') || '—'}</b></div>
              {RELAY_MODELS[relayModelOf(el)].dc && <p className="muted">24 V strana: traka i njeno napajanje, 230 V dolaz na L/N. Tipkala preko mreže (Plus i4) ili na DC ulaze.</p>}
            </>
          )}
          {el.type === 'modbox' && <button className="primary" onClick={() => setView({ kind: 'junctions', elementId: el.id })}><Icon.box /> Otvori dozu (spojevi)</button>}
          {(isPlace(el) || el.type === 'socket' || (el.type === 'switch' && !el.host)) && (
            <label>
              Doza
              <select value={el.depth ?? 'plitka'} onChange={(e) => updateElement(el.id, { depth: e.target.value as BoxDepth })}>
                {DEPTHS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
          )}
          {el.type === 'box' && <button className="primary" onClick={() => setView({ kind: 'junctions', elementId: el.id })}><Icon.box /> Otvori kutiju (spojevi)</button>}
          {(el.type === 'light' || el.type === 'ledpsu' || el.type === 'motor' || el.type === 'kip' || el.type === 'boiler' || el.type === 'appliance' || (el.type === 'socket' && !el.host)) && <button className="primary" onClick={() => setView({ kind: 'junctions', elementId: el.id })}><Icon.box /> Otvori spoj (koje žile kamo)</button>}
          {el.host && <div className="stat"><span>U</span><b>{hostLabel(el.host)}</b></div>}
          <div className="field-row" hidden={!!el.host}>
            <label>Od lijevo (m) <input type="number" step={0.01} value={el.xM} onChange={(e) => updateElement(el.id, { xM: +e.target.value || 0 })} /></label>
            <label>Visina (m) <input type="number" step={0.01} value={el.zM} onChange={(e) => updateElement(el.id, { zM: +e.target.value || 0 })} /></label>
          </div>
          <label>Bilješka <textarea rows={2} value={el.note} onChange={(e) => updateElement(el.id, { note: e.target.value })} /></label>
        </section>
      )}

      {props && cable && ctx && (
        <section className="props">
          <div className="props-head">
            <h3>Kabel</h3>
            <button className="icon-btn danger" onClick={removeSelected} title="Obriši (Delete)" aria-label="Obriši kabel"><Icon.trash /></button>
          </div>
          <label>
            Tip
            <select value={cable.type} onChange={(e) => updateCable(cable.id, { type: e.target.value })}>
              {(() => { const stock = cableStockOf(project); const mine = CABLE_TYPES.filter((t) => stock.includes(t) || !/^NYM/.test(t)), rest = CABLE_TYPES.filter((t) => !mine.includes(t)); return <>{mine.map((t) => <option key={t} value={t}>{t}</option>)}{rest.length > 0 && <optgroup label="Nije na mom popisu">{rest.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>}</> })()}
            </select>
          </label>
          {(() => { const is = cableIssues(project).get(cable.id); return is ? <div className="checks">{is.texts.map((t, i) => <div key={i} className={`check ${is.level}`}><span>{is.level === 'err' ? '✕' : '⚠'}</span><span>{t}</span></div>)}</div> : null })()}
          <div className="stat"><span>Od</span><b>{endLabel(cable.from, project)}</b></div>
          <div className="stat"><span>Do</span><b>{endLabel(cable.to, project)}</b></div>
          {(() => {
            // only meaningful when the house has more than one supply
            const circ = circuitsOf(project)
            if (circ.names.size < 2) return null
            const cur = circ.byCable.get(cable.id)
            const box = [cable.from, cable.to].map((e) => (e.kind === 'element' ? project.elements.find((x) => x.id === e.id) : undefined)).find((x) => x && isPlace(x))
            if (box && resolveCable(cable, box, project).role === 'feed') return null
            return (
              <label>
                Strujni krug
                <select value={cable.circuit ?? ''} onChange={(e) => updateCable(cable.id, { circuit: e.target.value || undefined })}>
                  <option value="">{cur ? `izvedeno: ${cur.name}${cur.tie ? ' (nejasno)' : ''}` : 'izvedeno'}</option>
                  {[...circ.names].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            )
          })()}
          {(['from', 'to'] as const).map((k) => { const e = cable[k]; return e.kind === 'corner' ? <label key={k}>Visina u kutu (m) <input type="number" step={0.01} value={e.zM} onChange={(ev) => updateCable(cable.id, { [k]: { ...e, zM: +ev.target.value || 0 } })} /></label> : null })}
          {(() => {
            const needs = cableNeeds(cable, project)
            if (needs) {
              // core schedule (žilni raspored): which core carries what, same assignment as the junction drawing
              const rows = needs.rows.map((r) => ({ c: r.color, sig: r.sig }))
              const missing = needs.missing
              const ok = missing.length === 0
              const spare = rows.filter((r) => !r.sig).length
              const chain = chainCables(cable, project)
              const setType = (t: string) => chain.forEach((x) => updateCable(x.id, { type: t }))
              // a second cable along the same run: every segment copied (corners and conduits pair by type and order)
              const addParallel = (t: string) => chain.forEach((x) => { const { id: _id, ...rest } = x; addCable({ ...rest, type: t, circuit: undefined }) })
              const fix = needs.fix
              const bundle = needs.members.length > 1
              return (
                <div className="cores">
                  {bundle && <div className="stat"><span>Paralelno</span><b>{needs.members.map(cableShort).join(' + ')}</b><span className="muted">žile se dijele: prvi kabel nosi L N PE</span></div>}
                  <div className={`check ${ok ? '' : 'err'}`}>
                    <span>{ok ? '✓' : '✕'}</span>
                    <span>
                      {ok ? <>Dovoljno žila: {needs.needed} od {needs.has}{spare ? `, ${spare} rezervna u ovom kabelu` : ''}</> : <>Treba {needs.needed} žila, {bundle ? 'kabeli imaju' : 'kabel ima'} {needs.has}</>}
                      {!ok && fix && !bundle && fix.length === 1 && <button className="mini fix" onClick={() => setType(fix[0])}>Zamijeni s {cableShort(fix[0])}</button>}
                      {!ok && fix && !bundle && fix.length === 2 && <button className="mini fix" onClick={() => { if (fix[0] !== cable.type) setType(fix[0]); addParallel(fix[1]) }}>{fix[0] !== cable.type ? `Zamijeni s ${cableShort(fix[0])} i dodaj ${cableShort(fix[1])}` : `Dodaj paralelno ${cableShort(fix[1])}`}</button>}
                      {!ok && bundle && fix && <span className="muted"> Treba: {fix.map(cableShort).join(' + ')}</span>}
                    </span>
                  </div>
                  <table className="core-table">
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className={r.sig ? '' : 'spare'}>
                          <td><i className="core-dot" style={{ background: wireSwatch(r.c) }} /></td>
                          <td className="core-color">{WIRE_LABEL[r.c]}</td>
                          <td className="core-sig">{r.sig ? terminalMeta(r.sig, project).label : '—'}</td>
                          <td className="core-desc">{r.sig ? terminalMeta(r.sig, project).desc : 'rezerva'}</td>
                        </tr>
                      ))}
                      {missing.map((sig) => (
                        <tr key={sig} className="missing">
                          <td><i className="core-dot none" /></td>
                          <td className="core-color">nema žile</td>
                          <td className="core-sig">{terminalMeta(sig, project).label}</td>
                          <td className="core-desc">{terminalMeta(sig, project).desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
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

      {nav && current && (
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
                <span className="name">{e.label} <span className="muted">{e.type === 'relay' ? RELAY_MODELS[relayModelOf(e)].label : e.switchKind === 'tipkalo' ? 'tipkalo' : ELEMENT_META[e.type].label.toLowerCase()}</span></span>
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

// Where a front element sits in its frame. ◀ ▶ move it one module: into a free module when there is one,
// otherwise it swaps with the neighbour. Positions are rebuilt from absolute module starts.
function SlotRow({ el }: { el: WallElement }) {
  const project = useStore((s) => s.project)
  const { updateElement } = useStore.getState()
  const host = project.elements.find((e) => e.id === el.host)
  const total = host?.modules ?? 3
  const front = hostedFront(project.elements, el.host!)
  const size = (e: WallElement) => Math.max(1, modulesOf(e))
  let pos = 0
  const starts = front.map((e) => { pos += e.gapBefore ?? 0; const st = pos; pos += size(e); return st })
  const i = front.findIndex((x) => x.id === el.id)
  const apply = (st: number[]) => {
    const order = front.map((e, k) => ({ e, st: st[k] })).sort((a, b) => a.st - b.st)
    let end = 0
    order.forEach(({ e, st }, k) => { updateElement(e.id, { slotOrder: k, gapBefore: st - end || undefined }); end = st + size(e) })
  }
  const move = (d: -1 | 1) => {
    const st = [...starts]
    if (d === 1) {
      const nx = i + 1 < front.length ? i + 1 : -1
      if (nx < 0 || st[i] + size(el) < st[nx]) { if (st[i] + size(el) >= total) return; st[i] += 1 }
      else { st[nx] = st[i]; st[i] = st[i] + size(front[nx]) }
    } else {
      const pv = i > 0 ? i - 1 : -1
      if (pv < 0 || st[pv] + size(front[pv]) < st[i]) { if (st[i] <= 0) return; st[i] -= 1 }
      else { const ps = st[pv]; st[pv] = ps + size(el); st[i] = ps }
    }
    apply(st)
  }
  const canRight = starts[i] + size(el) < total
  return (
    <div className="field-row slot-row">
      <label>Mjesto u okviru <span className="btns"><button className="mini" onClick={() => move(-1)} disabled={starts[i] <= 0} title="Modul ulijevo" aria-label="Modul ulijevo">◀</button><b>{starts[i] + 1}{size(el) > 1 ? `–${starts[i] + size(el)}` : ''} / {total}</b><button className="mini" onClick={() => move(1)} disabled={!canRight} title="Modul udesno" aria-label="Modul udesno">▶</button></span></label>
      <label>Praznih lijevo <input type="number" min={0} max={6} value={el.gapBefore ?? 0} onChange={(e) => updateElement(el.id, { gapBefore: Math.max(0, +e.target.value || 0) || undefined })} /></label>
    </div>
  )
}
