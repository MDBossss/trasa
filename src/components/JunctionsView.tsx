import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { allJunctions, allLeafJunctions, boxSizeLabel, wagoSlotLabel, wirePlan, type Junction, type Level, type PlanWire } from '../junction'
import { ELEMENT_META, WIRE_LABEL, isPlace, frameName } from '../types'
import { Icon } from './Icons'
import { CAP_COLOR, JunctionCanvas, wireSwatch } from './JunctionCanvas'
import { Sheet } from './Sheet'
import { ZoomPane } from './ZoomPane'
import { RoomScheme } from './RoomScheme'
import { useMobile } from '../mobile'

const LEVEL_ICON: Record<Level, string> = { ok: '✓', warn: '⚠', err: '✕' }

export function JunctionsView({ elementId }: { elementId: string | null }) {
  const project = useStore((s) => s.project)
  const { setView, select } = useStore.getState()
  const roomCtx = useStore((s) => s.roomId)
  const places = useMemo(() => allJunctions(project), [project])
  const leaves = useMemo(() => allLeafJunctions(project), [project])
  const junctions = useMemo(() => [...places, ...leaves], [places, leaves])
  const [mode, setModeState] = useState<'all' | 'steps'>(() => { try { return localStorage.getItem('trasa-jmode') === 'steps' ? 'steps' : 'all' } catch { return 'all' } })
  const setMode = (m: 'all' | 'steps') => { setModeState(m); try { localStorage.setItem('trasa-jmode', m) } catch { /* private mode */ } }
  const [step, setStep] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const mobile = useMobile()
  const [sheet, setSheet] = useState(false)
  const [splitNote, setSplitNote] = useState<string | null>(null)
  const [scheme, setSchemeState] = useState(() => { try { return localStorage.getItem('trasa-jscheme') !== '0' } catch { return true } }) // whole room on one board instead of one box; the default
  const setScheme = (v: boolean) => { setSchemeState(v); try { localStorage.setItem('trasa-jscheme', v ? '1' : '0') } catch { /* private mode */ } }
  const j: Junction | undefined = junctions.find((x) => x.box.id === elementId) ?? junctions[0]
  const plan = useMemo(() => (j ? wirePlan(j) : []), [j])

  useEffect(() => { setStep(0); setHover(null) }, [j?.box.id])
  // arriving with a specific box (from the wall panel, a check, or a list pick) shows that box, not the room board
  useEffect(() => { if (elementId) setScheme(false) }, [elementId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || mode !== 'steps') return
      if (e.key === 'ArrowRight') { e.preventDefault(); setStep((s) => Math.min(plan.length - 1, s + 1)) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setStep((s) => Math.max(0, s - 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, plan.length])

  const pick = (id: string) => { setScheme(false); setView({ kind: 'junctions', elementId: id }) }
  const openWall = (jx: Junction) => { setView({ kind: 'room', roomId: jx.room.id, wall: jx.box.wall }); select(jx.box.id) }
  const houseChecks = junctions.flatMap((x) => x.checks.filter((c) => c.level !== 'ok').map((c) => ({ ...c, j: x })))
  const cur = plan[step]
  const details = j && (
    <>
          <section>
            <h3>Spojevi po stezaljci <span className="count">{plan.length} žila</span></h3>
            <ul className="jsteps">
              {j.terminals.map((t) => (
                <li key={t.id} className="hdr">
                  <span>{t.label} · {t.wago ? `221-${t.wago}${t.chained > 1 ? ` ×${t.chained}` : ''}` : t.cap ? 'kapica' : 'izravno'} · {t.desc}</span>
                  <ul>
                    {t.wires.map((w, i) => {
                      const key = `${t.id}#${i}`
                      const n = plan.findIndex((p) => p.key === key)
                      const cls = mode === 'steps' ? (n === step ? 'cur' : n < step ? 'done' : '') : hover === key || hover === `term:${t.id}` ? 'cur' : ''
                      return (
                        <li key={key} className={cls} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onClick={() => { setMode('steps'); setStep(n) }}>
                          <span className="n">{n + 1}</span>
                          <span className="w" style={{ background: wireSwatch(w.color) }} />
                          <span>{w.kind === 'core' ? w.cableLabel : `${w.deviceLabel} · ${w.port}`}<small>{w.kind === 'core' ? `${WIRE_LABEL[w.color]} žila` : 'kratka žila'} → {t.wago ? wagoSlotLabel(t, i) : t.cap ? 'kapica' : 'izravno'}{w.note ? ` · ${w.note}` : ''}</small></span>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
              {j.cables.filter((c) => c.wires.every((w) => !w.terminal)).map((c) => (
                <li key={c.cable.id} className="hdr"><span>{c.label} · {c.wires[0]?.note ?? 'bez spoja u kutiji'}</span></li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Materijal za kutiju <button className="mini link" onClick={() => useStore.setState({ openSettings: true })} title="Rezervne žile: WAGO ili kapica">postavke</button></h3>
            <div className="bom">
              {j.bom.map((b) => <div key={b.item}><span>{b.item}</span><b>{b.qty} kom</b></div>)}
              {isPlace(j.box) && <div><span>{j.box.type === 'modbox' ? `Doza modularna ${frameName(j.box.modules ?? 3)}` : `Razvodna kutija ${boxSizeLabel(j.size.W, j.size.H)}`}{j.box.depth === 'duboka' ? ', duboka' : ''}</span><b>1 kom</b></div>}
              {[1, 2].map((m) => { const n = j.devices.filter((d) => d.kind === 'button' && (d.el.modules ?? 1) === m).length; return n ? <div key={m}><span>Tipkalo / prekidač {m}M</span><b>{n} kom</b></div> : null })}
              {j.devices.filter((d) => d.kind === 'socket' && (d.el.socketKind ?? 'schuko') === 'schuko').length > 0 && <div><span>Utičnica šuko 2M</span><b>{j.devices.filter((d) => d.kind === 'socket' && (d.el.socketKind ?? 'schuko') === 'schuko').length} kom</b></div>}
              {j.devices.filter((d) => d.kind === 'socket' && d.el.socketKind === 'euro').length > 0 && <div><span>Utičnica euro 1M</span><b>{j.devices.filter((d) => d.kind === 'socket' && d.el.socketKind === 'euro').length} kom</b></div>}
            </div>
          </section>
          <section>
            <h3>Provjere</h3>
            <div className="checks">
              {j.checks.map((c, i) => <div key={i} className={`check ${c.level}`}><span>{LEVEL_ICON[c.level]}</span><span>{c.text}</span></div>)}
            </div>
          </section>
    </>
  )

  if (mobile) return (
    <div className="junctions mobile">
      <div className="room-head">
        <select className="jpick" value={j?.box.id ?? ''} onChange={(e) => pick(e.target.value)} aria-label="Kutija">
          {!junctions.length && <option value="">Nema kutija</option>}
          {project.rooms.map((r) => { const list = junctions.filter((x) => x.room.id === r.id); return list.length ? <optgroup key={r.id} label={r.name}>{list.map((x) => <option key={x.box.id} value={x.box.id}>{x.box.label} · {x.box.type === 'modbox' ? `${frameName(x.box.modules ?? 3)}` : x.box.type === 'box' ? 'kutija' : ELEMENT_META[x.box.type].label.toLowerCase()} · zid {x.box.wall + 1}{x.level !== 'ok' ? ' ⚠' : ''}</option>)}</optgroup> : null })}
        </select>
        {j && (
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => { setMode('all'); setStep(0) }}>Sve</button>
            <button role="tab" aria-selected={mode === 'steps'} className={mode === 'steps' ? 'on' : ''} onClick={() => { setMode('steps'); setStep(0) }}>Koraci</button>
          </div>
        )}
      </div>
      {j ? (
        <div className="junction-main">
          <ZoomPane><JunctionCanvas j={j} plan={plan} mode={mode} step={step} hover={hover} onHover={setHover} onPick={(i) => { setMode('steps'); setStep(i) }} /></ZoomPane>
          {mode === 'steps' && cur && (
            <div className="stepbar">
              <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} aria-label="Natrag"><Icon.prev /></button>
              <span className="muted">{step + 1} / {plan.length}</span>
              <button className="primary" onClick={() => setStep((s) => Math.min(plan.length - 1, s + 1))} disabled={step === plan.length - 1}>Sljedeća <Icon.next /></button>
              <p>{stepText(cur)}</p>
            </div>
          )}
          <Sheet title={`Stezaljke · materijal · provjere${j.level !== 'ok' ? ' ⚠' : ''}`} open={sheet} onOpenChange={setSheet}>
            <div className="sidebar">
              <section><div className="field-row"><button onClick={() => openWall(j)}>Otvori na zidu</button><button onClick={() => setView({ kind: 'printbox', elementId: j.box.id })}><Icon.print /> Ispiši kutiju</button></div></section>
              {details}
            </div>
          </Sheet>
        </div>
      ) : (
        <div className="empty"><Icon.box width={40} height={40} /><div>Nacrtaj razvodnu kutiju na zidu neke sobe (na računalu)</div></div>
      )}
    </div>
  )

  return (
    <div className="junctions">
      <aside className="sidebar junctions-list">
        <section>
          <h3>Kutije i doze <span className="count">{junctions.length}</span></h3>
          {!junctions.length && <p className="muted">Nema razvodnih kutija. Otvori sobu, na fotki zida klikni gdje je kutija alatom Kutija (K), pa kabele (C) do nje.</p>}
          {[...project.rooms].sort((a, b) => (a.id === roomCtx ? -1 : b.id === roomCtx ? 1 : 0)).map((r) => {
            const list = places.filter((x) => x.room.id === r.id)
            const devs = leaves.filter((x) => x.room.id === r.id)
            if (!list.length && !devs.length) return null
            const row = (x: Junction, meta: string) => (
              <li key={x.box.id} className={j?.box.id === x.box.id ? 'sel' : ''} onClick={() => pick(x.box.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') pick(x.box.id) }}>
                <span className={`dot ${x.level}`} />
                <span className="name">{x.box.label}</span>
                <span className="meta">{meta}</span>
              </li>
            )
            return (
              <div key={r.id} className="jgroup">
                <div className={`jgroup-head ${r.id === roomCtx ? 'cur' : ''}`}>{r.name}</div>
                <ul className="list">
                  {list.map((x) => row(x, `${x.box.type === 'modbox' ? `${frameName(x.box.modules ?? 3)}` : 'kutija'} · zid ${x.box.wall + 1} · ${x.cables.length} kab.${x.devices.length ? ` · ${x.devices.length} ur.` : ''}`))}
                  {devs.map((x) => row(x, `${ELEMENT_META[x.box.type].label.toLowerCase()} · zid ${x.box.wall + 1} · ${x.cables.length} kab.`))}
                </ul>
              </div>
            )
          })}
        </section>
        {houseChecks.length > 0 && (
          <section>
            <h3>Provjere <span className="count">{houseChecks.length}</span></h3>
            <div className="checks">
              {houseChecks.map((c, i) => (
                <div key={i} className={`check ${c.level}`} onClick={() => pick(c.j.box.id)} role="button" tabIndex={0}>
                  <span>{LEVEL_ICON[c.level]}</span><span><b>{c.j.box.label}:</b> {c.text}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>

      <div className="junction-main">
        <div className="room-head">
          {j ? (
            <>
              <h2>{j.box.label} <span className="muted">· {ELEMENT_META[j.box.type].label.toLowerCase()}{j.box.type === 'modbox' ? ` ${frameName(j.box.modules ?? 3)}` : ''} · {j.room.name}, zid {j.box.wall + 1}{isPlace(j.box) && j.box.depth === 'duboka' ? ' · duboka' : ''}</span></h2>
              <button className="mini" onClick={() => openWall(j)}>Otvori na zidu</button>
              <button className="mini" onClick={() => setView({ kind: 'printbox', elementId: j.box.id })} title="A4 list s ovom kutijom"><Icon.print /> Ispiši kutiju</button>
              {j.box.type === 'box' && j.checks.some((c) => /podijel|podjel/i.test(c.text)) && (
                <button className="mini primary" onClick={() => { const r = useStore.getState().splitBox(j.box.id); if (r) { pick(r.id); if (!r.bothFit) setSplitNote('Ni u dvije ne stane sve: podijeli još jednom (na staroj ili novoj kutiji).'); else setSplitNote(null) } }} title="Preseli kabele u novu kutiju 35 cm pored, napajanu iz ove; bira najmanju podjelu u kojoj obje stanu. Undo vraća.">Podijeli na dvije</button>
              )}
              <div className="spacer" />
              <div className="segmented" role="tablist">
                <button role="tab" aria-selected={!scheme && mode === 'all'} className={!scheme && mode === 'all' ? 'on' : ''} onClick={() => { setScheme(false); setMode('all'); setStep(0) }}>Sve žile</button>
                <button role="tab" aria-selected={!scheme && mode === 'steps'} className={!scheme && mode === 'steps' ? 'on' : ''} onClick={() => { setScheme(false); setMode('steps'); setStep(0) }}>Korak po korak</button>
                <button role="tab" aria-selected={scheme} className={scheme ? 'on' : ''} onClick={() => setScheme(true)} title="Sve kutije i doze ove sobe na jednoj shemi">Cijela soba</button>
              </div>
            </>
          ) : <h2>Spojevi</h2>}
        </div>
        {splitNote && <div className="check warn split-note"><span>⚠</span><span>{splitNote}</span><button className="mini" onClick={() => setSplitNote(null)}>✕</button></div>}
        {j && scheme ? (
          <RoomScheme junctions={junctions} roomId={roomCtx && project.rooms.some((r) => r.id === roomCtx) ? roomCtx : j.room.id} onOpen={(id) => { setScheme(false); setMode('all'); setStep(0); pick(id) }} />
        ) : j ? (
          <div className="junction-stage">
            <JunctionCanvas j={j} plan={plan} mode={mode} step={step} hover={hover} onHover={setHover} onPick={(i) => { setMode('steps'); setStep(i) }} />
            {mode === 'all' && <p className="muted jc-hint">Drži <kbd>Shift</kbd> i prijeđi mišem preko WAGO-a ili žice: istaknu se sve žice spojene na taj WAGO.</p>}
            {mode === 'steps' && cur && (
              <div className="stepbar">
                <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><Icon.prev /> Natrag</button>
                <span className="muted">{step + 1} / {plan.length}</span>
                <button className="primary" onClick={() => setStep((s) => Math.min(plan.length - 1, s + 1))} disabled={step === plan.length - 1}>Sljedeća žila <Icon.next /></button>
                <p>{stepText(cur)}</p>
              </div>
            )}
            <div className="legend">
              <span><i style={{ background: wireSwatch('brown') }} />L smeđa</span>
              <span><i style={{ background: wireSwatch('blue') }} />N plava</span>
              <span><i style={{ background: wireSwatch('gnye') }} />PE žuto-zelena</span>
              <span><i style={{ background: wireSwatch('black') }} />povratna / putna</span>
              <span><i style={{ background: '#f28c28' }} />WAGO 221 polugica</span>
              <span><i style={{ background: '#c8803c' }} />ogoljeno 11 mm</span>
              {j.terminals.some((t) => t.cap) && <span><i style={{ background: CAP_COLOR }} />izolirana rezerva (kapica / traka)</span>}
            </div>
          </div>
        ) : (
          <div className="empty"><Icon.box width={40} height={40} /><div>Nacrtaj razvodnu kutiju na zidu neke sobe</div></div>
        )}
      </div>

      {j && !mobile && !scheme && <aside className="sidebar">{details}</aside>}
    </div>
  )
}

// 'smeđa' → 'Smeđu' (accusative for the instruction sentence)
const acc = (s: string) => (s[0].toUpperCase() + s.slice(1)).replace(/a( \d)?$/, 'u$1')
function stepText(w: PlanWire) {
  const t = w.terminal
  if (t.cap && w.member.kind === 'core') return `${acc(WIRE_LABEL[w.color])} žilu kabela ${w.member.cableLabel} ne spajaš: presavij je i izoliraj (kapica ili izolir traka).${w.note ? ` ${w.note[0].toUpperCase()}${w.note.slice(1)}.` : ''}`
  if (!t.wago) {
    const other = t.wires[1 - w.port] as PlanWire['member'] | undefined
    const o = !other ? '?' : other.kind === 'port' ? `${other.deviceLabel} ${other.port}` : other.cableLabel
    if (w.member.kind === 'core') return `${acc(WIRE_LABEL[w.color])} žilu kabela ${w.member.cableLabel} ogoli i utakni izravno u ${o} (${t.desc}), bez stezaljke.`
    return w.port === 0 ? `Kratkom ${WIRE_LABEL[w.color].replace(/a$/, 'om')} žilom spoji ${w.member.deviceLabel} ${w.member.port} izravno na ${o} (${t.desc}).` : `Druga strana iste žile: ${w.member.deviceLabel} ${w.member.port}.`
  }
  if (w.member.kind === 'core') return `${acc(WIRE_LABEL[w.color])} žilu kabela ${w.member.cableLabel} (${w.cable?.sub ?? ''}) ogoli 11 mm, podigni polugicu na stezaljci ${t.label} (221-${t.wago}${t.chained > 1 ? `, ${t.chained} spojena premosnicom` : ''}), utakni u ${wagoSlotLabel(t, w.port)}, spusti polugicu.${w.note ? ` Uloga: ${w.note}.` : ''}`
  return `Kratku ${WIRE_LABEL[w.color].replace(/a$/, 'u')} žilu (10–15 cm) s ${w.member.deviceLabel} stezaljke ${w.member.port} utakni u stezaljku ${t.label} (221-${t.wago}), ${wagoSlotLabel(t, w.port)}.${w.note ? ` ${w.note}.` : ''}`
}
