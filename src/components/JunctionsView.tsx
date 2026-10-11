import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { allJunctions, wirePlan, type Junction, type Level, type PlanWire } from '../junction'
import { ELEMENT_META, WIRE_LABEL } from '../types'
import { Icon } from './Icons'
import { JunctionCanvas, wireSwatch } from './JunctionCanvas'

const LEVEL_ICON: Record<Level, string> = { ok: '✓', warn: '⚠', err: '✕' }

export function JunctionsView({ elementId }: { elementId: string | null }) {
  const project = useStore((s) => s.project)
  const { setView, select } = useStore.getState()
  const junctions = useMemo(() => allJunctions(project), [project])
  const [mode, setMode] = useState<'all' | 'steps'>('all')
  const [step, setStep] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const j: Junction | undefined = junctions.find((x) => x.box.id === elementId) ?? junctions[0]
  const plan = useMemo(() => (j ? wirePlan(j) : []), [j])

  useEffect(() => { setStep(0); setHover(null) }, [j?.box.id])
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

  const pick = (id: string) => setView({ kind: 'junctions', elementId: id })
  const openWall = (jx: Junction) => { setView({ kind: 'room', roomId: jx.room.id, wall: jx.box.wall }); select(jx.box.id) }
  const houseChecks = junctions.flatMap((x) => x.checks.filter((c) => c.level !== 'ok').map((c) => ({ ...c, j: x })))
  const cur = plan[step]

  return (
    <div className="junctions">
      <aside className="sidebar junctions-list">
        <section>
          <h3>Kutije i doze <span className="count">{junctions.length}</span></h3>
          {!junctions.length && <p className="muted">Nema razvodnih kutija. Otvori sobu, na fotki zida klikni gdje je kutija alatom Kutija (K), pa kabele (C) do nje.</p>}
          {project.rooms.map((r) => {
            const list = junctions.filter((x) => x.room.id === r.id)
            if (!list.length) return null
            return (
              <div key={r.id} className="jgroup">
                <div className="jgroup-head">{r.name}</div>
                <ul className="list">
                  {list.map((x) => (
                    <li key={x.box.id} className={j?.box.id === x.box.id ? 'sel' : ''} onClick={() => pick(x.box.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') pick(x.box.id) }}>
                      <span className={`dot ${x.level}`} />
                      <span className="name">{x.box.label}</span>
                      <span className="meta">{x.box.type === 'modbox' ? `${x.box.modules ?? 3}M` : 'kutija'} · zid {x.box.wall + 1} · {x.cables.length} kab.{x.devices.length ? ` · ${x.devices.length} ur.` : ''}</span>
                    </li>
                  ))}
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
          <button onClick={() => setView({ kind: 'plan' })}><Icon.back /> Tlocrt</button>
          {j ? (
            <>
              <h2>{j.box.label} <span className="muted">· {ELEMENT_META[j.box.type].label.toLowerCase()}{j.box.type === 'modbox' ? ` ${j.box.modules ?? 3}M` : ''} · {j.room.name}, zid {j.box.wall + 1}{j.box.depth ? ` · ${j.box.depth}` : ''}</span></h2>
              <button className="mini" onClick={() => openWall(j)}>Otvori na zidu</button>
              <div className="spacer" />
              <div className="segmented" role="tablist">
                <button role="tab" aria-selected={mode === 'all'} className={mode === 'all' ? 'on' : ''} onClick={() => { setMode('all'); setStep(0) }}>Sve žile</button>
                <button role="tab" aria-selected={mode === 'steps'} className={mode === 'steps' ? 'on' : ''} onClick={() => { setMode('steps'); setStep(0) }}>Korak po korak</button>
              </div>
            </>
          ) : <h2>Spojevi</h2>}
        </div>
        {j ? (
          <div className="junction-stage">
            <JunctionCanvas j={j} plan={plan} mode={mode} step={step} hover={hover} onHover={setHover} onPick={(i) => { setMode('steps'); setStep(i) }} />
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
            </div>
          </div>
        ) : (
          <div className="empty"><Icon.box width={40} height={40} /><div>Nacrtaj razvodnu kutiju na zidu neke sobe</div></div>
        )}
      </div>

      {j && (
        <aside className="sidebar">
          <section>
            <h3>Spojevi po stezaljci <span className="count">{plan.length} žila</span></h3>
            <ul className="jsteps">
              {j.terminals.map((t) => (
                <li key={t.id} className="hdr">
                  <span>{t.label} · {t.wago ? `221-${t.wago}${t.chained > 1 ? ` ×${t.chained}` : ''}` : 'izravno'} · {t.desc}</span>
                  <ul>
                    {t.wires.map((w, i) => {
                      const key = `${t.id}#${i}`
                      const n = plan.findIndex((p) => p.key === key)
                      const cls = mode === 'steps' ? (n === step ? 'cur' : n < step ? 'done' : '') : hover === key ? 'cur' : ''
                      return (
                        <li key={key} className={cls} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onClick={() => { setMode('steps'); setStep(n) }}>
                          <span className="n">{n + 1}</span>
                          <span className="w" style={{ background: wireSwatch(w.color) }} />
                          <span>{w.kind === 'core' ? w.cableLabel : `${w.deviceLabel} · ${w.port}`}<small>{w.kind === 'core' ? `${WIRE_LABEL[w.color]} žila` : 'kratka žila'} → {t.wago ? `port ${i + 1}` : 'izravno'}{w.note ? ` · ${w.note}` : ''}</small></span>
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
            <h3>Materijal za kutiju</h3>
            <div className="bom">
              {j.bom.map((b) => <div key={b.item}><span>{b.item}</span><b>{b.qty} kom</b></div>)}
              <div><span>{j.box.type === 'modbox' ? `Doza modularna ${j.box.modules ?? 3}M` : 'Razvodna kutija 100 × 100 mm'}{j.box.depth === 'duboka' ? ', duboka' : j.box.depth === 'plitka' ? ', plitka' : ''}</span><b>1 kom</b></div>
              {j.devices.filter((d) => d.kind === 'button').length > 0 && <div><span>Tipkalo / prekidač 1M</span><b>{j.devices.filter((d) => d.kind === 'button').length} kom</b></div>}
              {j.devices.filter((d) => d.kind === 'socket').length > 0 && <div><span>Utičnica 2M</span><b>{j.devices.filter((d) => d.kind === 'socket').length} kom</b></div>}
            </div>
          </section>
          <section>
            <h3>Provjere</h3>
            <div className="checks">
              {j.checks.map((c, i) => <div key={i} className={`check ${c.level}`}><span>{LEVEL_ICON[c.level]}</span><span>{c.text}</span></div>)}
            </div>
          </section>
        </aside>
      )}
    </div>
  )
}

// 'smeđa' → 'Smeđu' (accusative for the instruction sentence)
const acc = (s: string) => (s[0].toUpperCase() + s.slice(1)).replace(/a( \d)?$/, 'u$1')
function stepText(w: PlanWire) {
  const t = w.terminal
  if (w.member.kind === 'core') return `${acc(WIRE_LABEL[w.color])} žilu kabela ${w.member.cableLabel} (${w.cable?.sub ?? ''}) ogoli 11 mm, podigni polugicu na stezaljci ${t.label} (221-${t.wago}), utakni u port ${w.port + 1}, spusti polugicu.${w.note ? ` Uloga: ${w.note}.` : ''}`
  if (!t.wago) {
    const other = t.wires[1 - w.port]
    const o = other?.kind === 'port' ? `${other.deviceLabel} ${other.port}` : '?'
    return w.port === 0 ? `Kratkom ${WIRE_LABEL[w.color].replace(/a$/, 'om')} žilom spoji ${w.member.deviceLabel} ${w.member.port} izravno na ${o} (${t.desc}).` : `Druga strana iste žile: ${w.member.deviceLabel} ${w.member.port}.`
  }
  return `Kratku ${WIRE_LABEL[w.color].replace(/a$/, 'u')} žilu (10–15 cm) s ${w.member.deviceLabel} stezaljke ${w.member.port} utakni u stezaljku ${t.label} (221-${t.wago}), port ${w.port + 1}.${w.note ? ` ${w.note}.` : ''}`
}
