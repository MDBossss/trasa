import { useEffect, useMemo, useRef } from 'react'
import { WIRE_HEX, WIRE_LABEL, type WireColor, RELAY_LOOK, relayBrand, relayModelOf } from '../types'
import { CAP_H, CAP_W, DEPTH, GAP, WAGO, boxLayout, boxSizeLabel, wagoSlot, type BoxCable, type Junction, type Placed, type PlanWire, type Side, type Terminal } from '../junction'

// Top-down view into the open box, drawn to scale in millimetres: cables enter from the rim,
// each core bends to its WAGO 221 port; relays and buttons sit inside with short jumpers.
// Layout is automatic from the junction data.

const S = 4 // px per mm
const OX = 150, OY = 150 // box origin inside the view box: room for a 30 mm tube and its caption on every side
// a caption inside a WAGO body: the short form, and only the part before the arrow when the unit is narrow
const innerCap = (cap: string, w: number) => { const t = cap.replace(' s premosnicom', ' most'); return t.length * 4.6 <= w ? t : t.split(/ [←→] /)[0] }
export const CAP_COLOR = '#7c3aed'

const entryOf = (side: Side, i: number, n: number, W: number, H: number) => {
  const t = (i + 1) / (n + 1)
  if (side === 'top') return { p: [W * t, 0], n: [0, 1] }
  if (side === 'bottom') return { p: [W * t, H], n: [0, -1] }
  if (side === 'left') return { p: [0, H * t], n: [1, 0] }
  return { p: [W, H * t], n: [-1, 0] }
}

// Size of the drawing's viewBox, for layouts that need the aspect ratio before rendering.
export function junctionViewBox(j: Junction): { w: number; h: number } {
  const lay = boxLayout(j)
  return { w: OX + lay.W * S + 150, h: OY + lay.H * S + (j.cables.some((c) => c.side === 'bottom') || j.box.type === 'kip' ? 200 : 60) }
}

// Where each cable's sheath leaves the drawing (svg coordinates) and the box centre, for the room board.
export function junctionAnchors(j: Junction): { stubs: Map<string, { x: number; y: number; n: [number, number]; cableId: string }>; cx: number; cy: number } {
  const lay = boxLayout(j)
  const sides: Record<Side, BoxCable[]> = { top: [], bottom: [], left: [], right: [] }
  for (const c of j.cables) sides[c.side].push(c)
  // keyed by the cable id and, for box-to-box cables, also by the far box's id (a cable round a corner is two segments)
  const stubs = new Map<string, { x: number; y: number; n: [number, number]; cableId: string }>()
  for (const c of j.cables) {
    const arr = sides[c.side]
    const e = entryOf(c.side, arr.indexOf(c), arr.length, lay.W, lay.H)
    const st = { x: OX + (e.p[0] - e.n[0] * 30) * S, y: OY + (e.p[1] - e.n[1] * 30) * S, n: [-e.n[0], -e.n[1]] as [number, number], cableId: c.cable.id }
    stubs.set(c.cable.id, st)
    const farId = c.far.place?.id ?? c.far.element?.id
    if (farId && !stubs.has(`to:${farId}`)) stubs.set(`to:${farId}`, st)
  }
  return { stubs, cx: OX + (lay.W / 2) * S, cy: OY + (lay.H / 2) * S }
}

export function JunctionCanvas({ j, plan, mode, step, hover, onHover, onPick, className, labels = true }: {
  j: Junction; plan: PlanWire[]; mode: 'all' | 'steps'; step: number; hover: string | null
  onHover: (k: string | null) => void; onPick: (i: number) => void; className?: string; labels?: boolean | ((c: BoxCable) => boolean)
}) {
  const lay = useMemo(() => boxLayout(j), [j])
  const { W, H } = lay
  const mm = (v: number) => v * S
  const px = (x: number, y: number): [number, number] => [OX + mm(x), OY + mm(y)]
  const sides: Record<Side, BoxCable[]> = { top: [], bottom: [], left: [], right: [] }
  for (const c of j.cables) sides[c.side].push(c)
  const entry = (c: BoxCable) => { const arr = sides[c.side]; return entryOf(c.side, arr.indexOf(c), arr.length, W, H) }
  const unitW = (t: Terminal) => WAGO[t.wago as 412 | 413 | 415].w
  const portXY = (pl: Placed & { kind: 'wago' }, unit: number, port: number) => {
    const pitch = unitW(pl.t) / WAGO[pl.t.wago as 412 | 413 | 415].n
    return { x: pl.x + unit * (unitW(pl.t) + GAP) + pitch * (port + 0.5), y: pl.flip ? pl.y : pl.y + DEPTH, n: pl.flip ? [0, -1] : [0, 1] }
  }
  const wagoPort = (pl: Placed & { kind: 'wago' }, i: number) => { const sl = wagoSlot(pl.t, i); return portXY(pl, sl.unit, sl.port) }
  const devPort = (pl: Placed & { kind: 'device' }, port: string) => {
    const i = Math.max(0, pl.d.ports.indexOf(port))
    const pitch = pl.w / pl.d.ports.length
    return { x: pl.x + pitch * (i + 0.5), y: pl.flip ? pl.y : pl.y + pl.h, n: pl.flip ? [0, -1] : [0, 1] }
  }
  const placedWago = (t: Terminal) => lay.placed.find((p): p is Placed & { kind: 'wago' } => p.kind === 'wago' && p.t.id === t.id)
  const placedDev = (id: string) => lay.placed.find((p): p is Placed & { kind: 'device' } => p.kind === 'device' && p.d.el.id === id)
  const vbW = OX + mm(W) + 150
  const vbH = OY + mm(H) + (sides.bottom.length || j.box.type === 'kip' ? 200 : 60)
  const [bx, by] = px(0, 0)
  const idx = (k: string) => plan.findIndex((w) => w.key === k)
  // with Shift held, hovering a WAGO, a device or one of their wires lights up every wire on it
  const shift = useRef(false), last = useRef<string | null>(null)
  const termOf = (k: string) => (k.startsWith('term:') ? k : plan.find((w) => w.key === k) ? `term:${plan.find((w) => w.key === k)!.terminal.id}` : k)
  const show = (k: string) => onHover(shift.current ? termOf(k) : k.startsWith('term:') || k.startsWith('dev:') ? null : k)
  const enter = (k: string, e: { shiftKey: boolean }) => { last.current = k; shift.current = e.shiftKey; show(k) }
  const leave = () => { last.current = null; onHover(null) }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key !== 'Shift' || shift.current === (e.type === 'keydown')) return; shift.current = e.type === 'keydown'; if (last.current) show(last.current) }
    window.addEventListener('keydown', key); window.addEventListener('keyup', key)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key) }
  })
  const wireState = (k: string) => {
    const i = idx(k)
    if (mode === 'steps') return i > step ? 'dim' : i === step ? 'hl' : ''
    if (hover) { if (hover === k) return 'hl'; if (hover.startsWith('term:')) return plan[i].terminal.id === hover.slice(5) ? 'hl' : 'dim'; if (hover.startsWith('dev:')) return touchesDevice(plan[i].terminal, plan[i].port, hover.slice(4)) ? 'hl' : 'dim'; if (hover.startsWith('cable:')) return plan[i].cable?.cable.id === hover.slice(6) ? 'hl' : 'dim'; return 'dim' }
    return ''
  }
  // where a plan wire starts: the cable's sheath end or the device port
  const startOf = (w: PlanWire) => {
    if (w.cable) { const e = entry(w.cable); return { x: e.p[0] + e.n[0] * 9, y: e.p[1] + e.n[1] * 9, n: e.n, copper: false } }
    const pd = w.device && placedDev(w.device.el.id)
    if (!pd || w.member.kind !== 'port') return null
    return { ...devPort(pd, w.member.port), copper: true }
  }
  const endOf = (w: PlanWire) => {
    if (w.terminal.wago) { const pw = placedWago(w.terminal); return pw ? wagoPort(pw, w.port) : null }
    if (w.terminal.cap) {
      const pc = lay.placed.find((q): q is Placed & { kind: 'cap' } => q.kind === 'cap' && q.t.id === w.terminal.id)
      return pc ? { x: pc.x + CAP_W / 2, y: pc.flip ? pc.y : pc.y + CAP_H, n: pc.flip ? [0, -1] : [0, 1], cap: true } : null
    }
    // direct connection: the wire goes from member 0 to member 1 (a device port); member 1 draws nothing
    const other = w.terminal.wires[1 - w.port]
    if (!other || w.port === 1) return null
    if (other.kind === 'port') { const pd = placedDev(other.deviceId); return pd ? devPort(pd, other.port) : null }
    return null
  }

  // cores a cable keeps whole through the box, grouped by the pair of cables (one physical cable)
  const runs = new Map<string, { a: BoxCable; b: BoxCable; wires: PlanWire[] }>()
  for (const w of plan) {
    const o = w.terminal.wires[1]
    if (!w.terminal.through || w.port !== 0 || !w.cable || o?.kind !== 'core') continue
    const b = j.cables.find((c) => c.cable.id === o.cableId)
    if (!b) continue
    const k = [w.cable.cable.id, b.cable.id].sort().join('|')
    if (!runs.has(k)) runs.set(k, { a: w.cable, b, wires: [] })
    runs.get(k)!.wires.push(w)
  }
  const tubeOd = (c: BoxCable) => (c.cores.length >= 5 ? 11 : /2[.,]5/.test(c.sub) ? 10 : 8.5)

  return (
    <svg className={className ?? 'junction-svg'} viewBox={`0 0 ${vbW} ${vbH}`} role="img" aria-label={`Otvorena kutija ${j.box.label}`}>
      <rect x={bx - mm(6)} y={by - mm(6)} width={mm(W + 12)} height={mm(H + 12)} rx={10} fill="#e4e1d8" stroke="#b9b5aa" />
      <rect x={bx} y={by} width={mm(W)} height={mm(H)} rx={6} fill="#f3f1ea" stroke="#8e8a80" strokeWidth={2} />
      {[[4, 4], [W - 4, 4], [4, H - 4], [W - 4, H - 4]].map(([cx, cy], i) => { const [x, y] = px(cx, cy); return <circle key={i} cx={x} cy={y} r={5} fill="#cfcbc0" stroke="#9a968c" /> })}

      {j.cables.map((c) => {
        const e = entry(c)
        const od = c.cores.length >= 5 ? 11 : /2[.,]5/.test(c.sub) ? 10 : 8.5
        const a = [e.p[0] - e.n[0] * 30, e.p[1] - e.n[1] * 30], b = [e.p[0] + e.n[0] * 9, e.p[1] + e.n[1] * 9]
        const [x1, y1] = px(a[0], a[1]), [x2, y2] = px(b[0], b[1])
        // crowded top/bottom sides stagger their captions inward along the tube so neighbours never overlap
        const arr = sides[c.side], vertical = c.side === 'top' || c.side === 'bottom'
        const est = Math.max(c.label.length * 7, (c.sub.length + roleShort(c).length + 3) * 5.6)
        const levels = vertical ? Math.min(3, Math.ceil(est / (mm(W) / (arr.length + 1)))) : 1
        const level = arr.indexOf(c) % levels
        const off = vertical ? (c.side === 'top' ? 30 : 36) - level * 7 : 29
        const [lx, ly] = px(e.p[0] - e.n[0] * off, e.p[1] - e.n[1] * off)
        const anchor = c.side === 'left' ? 'start' : c.side === 'right' ? 'end' : 'middle'
        const dy = c.side === 'top' ? -6 : c.side === 'bottom' ? 14 : -(mm(od) / 2 + 18)
        const dim = mode === 'all' && hover && hover !== `cable:${c.cable.id}` && !plan.some((w) => (w.key === hover || `term:${w.terminal.id}` === hover || (hover.startsWith('dev:') && touchesDevice(w.terminal, w.port, hover.slice(4)))) && w.cable?.cable.id === c.cable.id)
        return (
          <g key={c.cable.id} className={`jc-cable ${dim ? 'dim' : ''}`} onMouseEnter={() => onHover(`cable:${c.cable.id}`)} onMouseLeave={() => onHover(null)}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9a978f" strokeWidth={mm(od) + 2} strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d9d7cf" strokeWidth={mm(od)} strokeLinecap="round" />
            {(typeof labels === 'function' ? labels(c) : labels) && <text x={lx} y={ly + dy} textAnchor={anchor} fontSize={11} fontWeight={600} fill="currentColor">{c.label}</text>}
            {(typeof labels === 'function' ? labels(c) : labels) && <text x={lx} y={ly + dy + 13} textAnchor={anchor} fontSize={10} fill="var(--muted)">{c.sub} · {roleShort(c)}</text>}
          </g>
        )
      })}

      <g>
        {plan.map((w) => {
          if (w.terminal.through) return null
          const a = startOf(w), b = endOf(w)
          if (!a || !b) return null
          const k = 22
          const [x1, y1] = px(a.x, a.y), [c1x, c1y] = px(a.x + a.n[0] * k, a.y + a.n[1] * k), [c2x, c2y] = px(b.x + b.n[0] * k, b.y + b.n[1] * k), [x2, y2] = px(b.x, b.y)
          const d = `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`
          const sw = w.cable && /2[.,]5/.test(w.cable.sub) ? mm(3.4) : mm(2.8)
          const [ex, ey] = px(b.x - b.n[0] * 11, b.y - b.n[1] * 11)
          const [sx, sy] = px(a.x - a.n[0] * 7, a.y - a.n[1] * 7)
          return (
            <g key={w.key} className={`jc-wire ${wireState(w.key)}`} data-tip={`${w.cable ? w.cable.label : w.device?.label}: ${WIRE_LABEL[w.color]} → ${w.terminal.label}${w.note ? ` (${w.note})` : ''}`} onMouseEnter={(e) => enter(w.key, e)} onMouseLeave={leave} onClick={() => onPick(idx(w.key))}>
              <path d={d} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth={sw + 2} strokeLinecap="round" />
              <path d={d} fill="none" stroke={WIRE_HEX[w.color]} strokeWidth={sw} strokeLinecap="round" />
              {w.color === 'gnye' && <path d={d} fill="none" stroke="#f2d31b" strokeWidth={sw} strokeDasharray="7 9" />}
              {'cap' in b && b.cap ? null : (
                <line x1={x2} y1={y2} x2={ex} y2={ey} stroke="#c8803c" strokeWidth={sw * 0.55} strokeLinecap="round" />
              )}
              {a.copper && <line x1={x1} y1={y1} x2={sx} y2={sy} stroke="#c8803c" strokeWidth={sw * 0.55} strokeLinecap="round" />}
            </g>
          )
        })}
      </g>

      {[...runs.entries()].map(([key, r]) => {
        // a parallel offset of one bezier from sheath A to sheath B: left of the travel direction at each end
        const ea = entry(r.a), eb = entry(r.b), k = 30
        const dA = ea.n, dB = [-eb.n[0], -eb.n[1]], lA = [-dA[1], dA[0]], lB = [-dB[1], dB[0]]
        const S0 = [ea.p[0] + dA[0] * 9, ea.p[1] + dA[1] * 9], E0 = [eb.p[0] + eb.n[0] * 9, eb.p[1] + eb.n[1] * 9]
        const curve = (o: number) => {
          const p0 = [S0[0] + lA[0] * o, S0[1] + lA[1] * o], c1 = [p0[0] + dA[0] * k, p0[1] + dA[1] * k]
          const p3 = [E0[0] + lB[0] * o, E0[1] + lB[1] * o], c2 = [p3[0] + eb.n[0] * k, p3[1] + eb.n[1] * k]
          const [x1, y1] = px(p0[0], p0[1]), [a1, b1] = px(c1[0], c1[1]), [a2, b2] = px(c2[0], c2[1]), [x2, y2] = px(p3[0], p3[1])
          return { d: `M${x1},${y1} C${a1},${b1} ${a2},${b2} ${x2},${y2}`, mid: [(x1 + 3 * a1 + 3 * a2 + x2) / 8, (y1 + 3 * b1 + 3 * b2 + y2) / 8] }
        }
        const whole = r.wires.length === r.a.cores.length && r.a.cores.length === r.b.cores.length
        const cw = /2[.,]5/.test(r.a.sub) ? 3.4 : 2.8
        const band = whole ? tubeOd(r.a) : r.wires.length * cw + 3
        const c0 = curve(0)
        const state = mode === 'steps' ? (r.wires.some((w) => idx(w.key) === step) ? 'hl' : r.wires.every((w) => idx(w.key) > step) ? 'dim' : '') : hover ? (r.wires.some((w) => wireState(w.key) === 'hl') ? 'hl' : 'dim') : ''
        return (
          <g key={key} className={`jc-wire jc-run ${state}`} data-tip={`${r.a.label} → ${r.b.label}: ${whole ? 'kabel samo prolazi, ništa ne reži' : `provučeno, ne reži: ${r.wires.map((w) => WIRE_LABEL[w.color]).join(', ')}`}`} onMouseEnter={(e) => enter(r.wires[0].key, e)} onMouseLeave={leave} onClick={() => onPick(idx(r.wires[0].key))}>
            <path d={c0.d} fill="none" stroke="#9a978f" strokeWidth={mm(band) + 2} strokeLinecap="round" />
            <path d={c0.d} fill="none" stroke="#d9d7cf" strokeWidth={mm(band)} strokeLinecap="round" />
            {!whole && r.wires.map((w, i) => {
              const c = curve((i - (r.wires.length - 1) / 2) * cw)
              return (
                <g key={w.key}>
                  <path d={c.d} fill="none" stroke={WIRE_HEX[w.color]} strokeWidth={mm(cw) - 1} strokeLinecap="round" />
                  {w.color === 'gnye' && <path d={c.d} fill="none" stroke="#f2d31b" strokeWidth={mm(cw) - 1} strokeDasharray="7 9" />}
                </g>
              )
            })}
            <text x={c0.mid[0]} y={c0.mid[1] - mm(band) / 2 - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#333" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 5 }}>{whole ? 'prolazi, ne reži' : 'ne reži'}</text>
          </g>
        )
      })}


      {j.box.type === 'kip' && (() => {
        const pd = placedDev(j.box.id)
        if (!pd) return null
        const fe = devPort(pd, 'FeZn')
        const [fx, fy] = px(fe.x, fe.y)
        const [, by2] = px(0, H + 40)
        return (
          <g>
            <rect x={fx - mm(12.5)} y={fy} width={mm(25)} height={by2 - fy} fill="#9aa0a8" stroke="#5f6670" strokeWidth={1.2} />
            <rect x={fx - mm(12.5)} y={fy} width={mm(25)} height={mm(4)} fill="#c9a227" stroke="#8a6d10" strokeWidth={1} />
            <circle cx={fx} cy={fy + mm(2)} r={mm(1.6)} fill="#6b5410" />
            <text x={fx} y={by2 + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">traka FeZn 25 × 4 iz temelja</text>
            <text x={fx} y={by2 + 27} textAnchor="middle" fontSize={10} fill="var(--muted)">temeljni uzemljivač · vijak M10, mjedena podloška</text>
          </g>
        )
      })()}
      {lay.placed.map((pl, pi) => {
        const [x, y] = px(pl.x, pl.y)
        const rowIdx = lay.placed.filter((q, qi) => qi < pi && q.flip === pl.flip && Math.abs(q.y - pl.y) < 20).length
        const capDy = rowIdx % 2 ? 12 : 0
        // an inner row has no free margin: its caption goes inside the body (or beside a cap) instead of over the wires
        const inner = lay.placed.some((q) => q.flip === pl.flip && (pl.flip ? q.y > pl.y + 10 : q.y < pl.y - 10))
        if (pl.kind === 'wago') {
          const n = WAGO[pl.t.wago as 412 | 413 | 415].n, uw = unitW(pl.t), pitch = uw / n, k = pl.t.chained
          const cap = `${pl.w >= 25 ? `221-${pl.t.wago} · ` : ''}${k > 1 ? `×${k} s premosnicom · ` : ''}${pl.t.desc}`
          const usedPorts = new Set<string>()
          pl.t.wires.forEach((_, i) => { const sl = wagoSlot(pl.t, i); usedPorts.add(`${sl.unit}:${sl.port}`) })
          for (let u = 0; u < k - 1; u++) { usedPorts.add(`${u}:${n - 1}`); usedPorts.add(`${u + 1}:0`) }
          const bridgeColor = pl.t.id.startsWith('L') && /^L(@|$)/.test(pl.t.id) ? WIRE_HEX.brown : /^N(@|$)/.test(pl.t.id) ? WIRE_HEX.blue : pl.t.id === 'PE' ? WIRE_HEX.gnye : WIRE_HEX.black
          return (
            <g key={pl.t.id} className={`jc-wago ${hover?.startsWith('term:') || hover?.startsWith('dev:') ? (hover === `term:${pl.t.id}` || (hover.startsWith('dev:') && pl.t.wires.some((_, i) => touchesDevice(pl.t, i, hover.slice(4)))) ? 'hl' : 'dim') : ''}`} data-tip={`${pl.t.label} · ${pl.t.desc} · drži Shift za sve žice na ovom WAGO-u`} onMouseEnter={(e) => enter(`term:${pl.t.id}`, e)} onMouseLeave={leave}>
              {Array.from({ length: k }, (_, u) => {
                const ux = x + mm(u * (uw + GAP))
                return (
                  <g key={u}>
                    <rect x={ux + 2} y={y + 3} width={mm(uw)} height={mm(DEPTH)} rx={3} fill="rgba(0,0,0,.18)" />
                    <rect x={ux} y={y} width={mm(uw)} height={mm(DEPTH)} rx={3} fill="rgba(255,255,255,.62)" stroke="#4a4a4a" strokeWidth={1.2} />
                    {Array.from({ length: n }, (_, i) => {
                      const lx = ux + mm(pitch * i + 0.6), lw = mm(pitch - 1.2)
                      const used = usedPorts.has(`${u}:${i}`)
                      return (
                        <g key={i}>
                          <rect x={lx} y={pl.flip ? y + mm(DEPTH - 7.5) : y + mm(1)} width={lw} height={mm(6.5)} rx={2} fill={used ? '#f28c28' : '#f7b377'} stroke="#b35a0c" strokeWidth={0.8} />
                          <rect x={lx + lw * 0.2} y={pl.flip ? y : y + mm(DEPTH) - mm(3)} width={lw * 0.6} height={mm(3)} fill={used ? '#2b2b2b' : '#777'} />
                        </g>
                      )
                    })}
                    <text x={ux + mm(uw) / 2} y={pl.flip ? y + mm(5.5) : y + mm(DEPTH - 3.5)} textAnchor="middle" fontSize={10} fontWeight={600} fill="#222">{pl.t.label}</text>
                  </g>
                )
              })}
              {Array.from({ length: k - 1 }, (_, u) => {
                // bridge: last port of unit u to first port of unit u+1, looped out of the wire side
                const a = portXY(pl, u, n - 1), b = portXY(pl, u + 1, 0)
                const [ax, ay] = px(a.x, a.y), [bx2, by2] = px(b.x, b.y)
                const dy = (pl.flip ? -1 : 1) * mm(9)
                return <path key={u} d={`M${ax},${ay} C${ax},${ay + dy} ${bx2},${by2 + dy} ${bx2},${by2}`} fill="none" stroke={bridgeColor} strokeWidth={mm(2.8)} strokeLinecap="round" />
              })}
              {inner
                ? <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(9.2) : y + mm(10.8)} textAnchor="middle" fontSize={8} fill="#555">{innerCap(cap, mm(pl.w))}</text>
                : <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(DEPTH) + 12 + capDy : y - 5 - capDy} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{cap}</text>}
            </g>
          )
        }
        if (pl.kind === 'cap') {
          const [cw, ch] = [mm(CAP_W), mm(CAP_H)]
          return (
            <g key={pl.t.id}>
              <rect x={x} y={y} width={cw} height={ch} rx={cw / 2} fill={CAP_COLOR} stroke="#4c1d95" strokeWidth={0.8} />
              {[0.3, 0.55, 0.8].map((f) => <line key={f} x1={x + 1} y1={y + ch * f} x2={x + cw - 1} y2={y + ch * f} stroke="rgba(255,255,255,.35)" strokeWidth={0.8} />)}
              {inner
                ? <text x={x + cw + 4} y={y + ch / 2 + 3} textAnchor="start" fontSize={8.5} fill="var(--muted)">izoliraj</text>
                : <text x={x + cw / 2} y={pl.flip ? y + ch + 12 + capDy : y - 5 - capDy} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{pl.t.id.startsWith('PARK') ? 'izoliraj' : `${pl.t.label} · izoliraj`}</text>}
            </g>
          )
        }
        const d = pl.d
        const isBtn = d.kind !== 'relay'
        const look = isBtn ? { fill: '#fafaf7', stroke: '#555', text: '#333' } : RELAY_LOOK[relayBrand(relayModelOf(d.el))]
        const pitch = pl.w / d.ports.length
        const what = ({ relay: 'releju', socket: 'utičnici', button: 'prekidaču', terminal: 'stezaljci' } as const)[d.kind]
        return (
          <g key={d.el.id} className={`jc-wago ${hover?.startsWith('term:') || hover?.startsWith('dev:') ? (hover === `dev:${d.el.id}` ? 'hl' : 'dim') : ''}`} data-tip={`${d.el.label} · ${d.label} · drži Shift za sve žice na ${what}`} onMouseEnter={(e) => enter(`dev:${d.el.id}`, e)} onMouseLeave={leave}>
            <rect x={x + 2} y={y + 3} width={mm(pl.w)} height={mm(pl.h)} rx={4} fill="rgba(0,0,0,.18)" />
            <rect x={x} y={y} width={mm(pl.w)} height={mm(pl.h)} rx={4} fill={look.fill} stroke={look.stroke} strokeWidth={1.2} />
            {d.ports.map((p, i) => {
              const cx = x + mm(pitch * (i + 0.5))
              const py = pl.flip ? y : y + mm(pl.h) - mm(3)
              return (
                <g key={`${p}#${i}`}>
                  <rect x={cx - mm(1.6)} y={py} width={mm(3.2)} height={mm(3)} fill="#111" />
                  <text x={cx} y={pl.flip ? y + mm(6.5) : y + mm(pl.h) - mm(4)} textAnchor="middle" fontSize={7.5} fill={look.text}>{p}</text>
                </g>
              )
            })}
            <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(pl.h) - mm(2.5) : y + mm(5.5)} textAnchor="middle" fontSize={9} fontWeight={600} fill={look.text}>{d.el.label}</text>
            {inner
              ? <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(pl.h) - mm(2.5) - 10 : y + mm(5.5) + 10} textAnchor="middle" fontSize={8} fill={look.text}>{d.label.length * 4.6 <= mm(pl.w) ? d.label : d.label.split(' (')[0]}</text>
              : <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(pl.h) + 12 + capDy : y - 5 - capDy} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{d.label.length * 5.4 <= mm(pl.w) + 24 ? d.label : d.label.split(' (')[0]}</text>}
          </g>
        )
      })}

      <line x1={bx + (j.box.type === 'kip' ? mm(40) : 0)} y1={by + mm(H + 8) + 6} x2={bx + (j.box.type === 'kip' ? mm(40) : 0) + mm(20)} y2={by + mm(H + 8) + 6} stroke="currentColor" strokeWidth={1.5} />
      <text x={bx + (j.box.type === 'kip' ? mm(40) : 0) + mm(20) + 6} y={by + mm(H + 8) + 10} fontSize={10} fill="var(--muted)">20 mm · {j.box.type === 'box' ? `kutija ${boxSizeLabel(W, H)}` : `${W} × ${H} mm`}{lay.overflow ? (j.box.type === 'box' ? ` (${boxSizeLabel(...(j.boxSizes ?? [[90, 90]])[0])} je premala)` : ' (standardna je premala)') : ''}</text>
    </svg>
  )
}

// A wire belongs to a device when it lands on one of its ports, or on a direct (no WAGO) join with one.
export function touchesDevice(t: Terminal, i: number, id: string) {
  const w = t.wires[i]
  return (w?.kind === 'port' && w.deviceId === id) || (!t.wago && !t.cap && t.wires.some((x) => x.kind === 'port' && x.deviceId === id))
}

function roleShort(c: BoxCable) {
  if (c.role === 'lowv' && /utp|ftp|cat\s?[5-8]/i.test(c.sub)) return 'internet'
  if (c.role === 'lowv' && /koaks|coax|rg-?6/i.test(c.sub)) return 'antena'
  return ({ feed: 'dolaz', pass: 'prolaz', socket: 'utičnica', light: 'svjetlo', motor: 'vrata', switch: 'prekidač', lowv: 'slaba struja', earth: 'uzemljenje', unknown: '?' } as Record<string, string>)[c.role]
}

export const wireSwatch = (c: WireColor) => (c === 'gnye' ? 'repeating-linear-gradient(90deg,#2e8b3a 0 3px,#f2d31b 3px 6px)' : WIRE_HEX[c])
