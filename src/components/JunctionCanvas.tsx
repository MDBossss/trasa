import { useMemo } from 'react'
import { WIRE_HEX, WIRE_LABEL, type WireColor, RELAY_LOOK, relayBrand, relayModelOf } from '../types'
import type { BoxCable, Device, Junction, PlanWire, Side, Terminal } from '../junction'

// Top-down view into the open box, drawn to scale in millimetres: cables enter from the rim,
// each core bends to its WAGO 221 port; relays and buttons sit inside with short jumpers.
// Layout is automatic from the junction data.

const WAGO = { 412: { w: 13.0, n: 2 }, 413: { w: 18.7, n: 3 }, 415: { w: 30.0, n: 5 } } as const
const DEPTH = 18.6
const S = 4 // px per mm

type Item = { kind: 'wago'; t: Terminal; w: number; h: number } | { kind: 'cap'; t: Terminal; w: number; h: number } | { kind: 'device'; d: Device; w: number; h: number }
const CAP_W = 4, CAP_H = 12 // tape / small cap on a folded-back spare core: ~1 mm thicker than the core
export const CAP_COLOR = '#7c3aed'
type Placed = Item & { x: number; y: number; flip: boolean }

function wagoWidth(t: Terminal) { return WAGO[t.wago as 412 | 413 | 415].w * t.chained + (t.chained - 1) * 2 }

// Greedy packing into rows (top, bottom, middle); the box grows when they overflow.
function layout(j: Junction): { W: number; H: number; placed: Placed[]; overflow: boolean } {
  const items: Item[] = [
    ...j.terminals.filter((t) => t.wago).map((t): Item => ({ kind: 'wago', t, w: wagoWidth(t), h: DEPTH })),
    ...j.terminals.filter((t) => t.cap).map((t): Item => ({ kind: 'cap', t, w: CAP_W, h: CAP_H })),
    ...j.devices.map((d): Item => ({ kind: 'device', d, w: d.wMm, h: d.hMm })),
  ]
  const base = j.box.type === 'modbox' ? [(j.box.modules ?? 3) <= 3 ? [100, 70] : (j.box.modules ?? 3) <= 4 ? [120, 70] : [160, 70], [160, 100], [200, 120]] : [[100, 100], [150, 150], [200, 200]]
  for (const [W, H] of base) {
    const rows: { y: number; flip: boolean; x: number; items: Placed[]; h: number }[] = [
      { y: 5, flip: false, x: 5, items: [], h: DEPTH },
      { y: H - 5 - DEPTH, flip: true, x: 5, items: [], h: DEPTH },
    ]
    if (H >= 100) rows.push({ y: H / 2 - DEPTH / 2, flip: false, x: 5, items: [], h: DEPTH })
    let ok = true
    for (const it of items) {
      const pref = it.kind === 'device' && it.d.kind !== 'relay' ? [...rows].reverse() : rows
      const row = pref.find((r) => r.x + it.w <= W - 5)
      if (!row) { ok = false; break }
      row.items.push({ ...it, x: row.x, y: row.flip ? row.y + DEPTH - it.h : row.y, flip: row.flip })
      row.x += it.w + 4
    }
    if (ok) return { W, H, placed: rows.flatMap((r) => r.items), overflow: W > base[0][0] }
  }
  return { W: 200, H: 200, placed: [], overflow: true }
}

const entryOf = (side: Side, i: number, n: number, W: number, H: number) => {
  const t = (i + 1) / (n + 1)
  if (side === 'top') return { p: [W * t, 0], n: [0, 1] }
  if (side === 'bottom') return { p: [W * t, H], n: [0, -1] }
  if (side === 'left') return { p: [0, H * t], n: [1, 0] }
  return { p: [W, H * t], n: [-1, 0] }
}

export function JunctionCanvas({ j, plan, mode, step, hover, onHover, onPick, className }: {
  j: Junction; plan: PlanWire[]; mode: 'all' | 'steps'; step: number; hover: string | null
  onHover: (k: string | null) => void; onPick: (i: number) => void; className?: string
}) {
  const lay = useMemo(() => layout(j), [j])
  const { W, H } = lay
  const OX = 110, OY = 150
  const mm = (v: number) => v * S
  const px = (x: number, y: number): [number, number] => [OX + mm(x), OY + mm(y)]
  const sides: Record<Side, BoxCable[]> = { top: [], bottom: [], left: [], right: [] }
  for (const c of j.cables) sides[c.side].push(c)
  const entry = (c: BoxCable) => { const arr = sides[c.side]; return entryOf(c.side, arr.indexOf(c), arr.length, W, H) }
  const wagoPort = (pl: Placed & { kind: 'wago' }, i: number) => {
    const ports = WAGO[pl.t.wago as 412 | 413 | 415].n * pl.t.chained
    const pitch = pl.w / ports
    return { x: pl.x + pitch * (i + 0.5), y: pl.flip ? pl.y : pl.y + DEPTH, n: pl.flip ? [0, -1] : [0, 1] }
  }
  const devPort = (pl: Placed & { kind: 'device' }, port: string) => {
    const i = Math.max(0, pl.d.ports.indexOf(port))
    const pitch = pl.w / pl.d.ports.length
    return { x: pl.x + pitch * (i + 0.5), y: pl.flip ? pl.y : pl.y + pl.h, n: pl.flip ? [0, -1] : [0, 1] }
  }
  const placedWago = (t: Terminal) => lay.placed.find((p): p is Placed & { kind: 'wago' } => p.kind === 'wago' && p.t.id === t.id)
  const placedDev = (id: string) => lay.placed.find((p): p is Placed & { kind: 'device' } => p.kind === 'device' && p.d.el.id === id)
  const vbW = OX + mm(W) + 190
  const vbH = OY + mm(H) + (sides.bottom.length ? 200 : 60)
  const [bx, by] = px(0, 0)
  const idx = (k: string) => plan.findIndex((w) => w.key === k)
  const wireState = (k: string) => {
    const i = idx(k)
    if (mode === 'steps') return i > step ? 'dim' : i === step ? 'hl' : ''
    if (hover) { if (hover === k) return 'hl'; if (hover.startsWith('cable:')) return plan[i].cable?.cable.id === hover.slice(6) ? 'hl' : 'dim'; return 'dim' }
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
        const [lx, ly] = px(e.p[0] - e.n[0] * 36, e.p[1] - e.n[1] * 36)
        const anchor = c.side === 'left' ? 'end' : c.side === 'right' ? 'start' : 'middle'
        const dy = c.side === 'top' ? -6 : c.side === 'bottom' ? 14 : 4
        const dim = mode === 'all' && hover && hover !== `cable:${c.cable.id}` && !plan.some((w) => w.key === hover && w.cable?.cable.id === c.cable.id)
        return (
          <g key={c.cable.id} className={`jc-cable ${dim ? 'dim' : ''}`} onMouseEnter={() => onHover(`cable:${c.cable.id}`)} onMouseLeave={() => onHover(null)}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9a978f" strokeWidth={mm(od) + 2} strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d9d7cf" strokeWidth={mm(od)} strokeLinecap="round" />
            <text x={lx} y={ly + dy} textAnchor={anchor} fontSize={11} fontWeight={600} fill="currentColor">{c.label}</text>
            <text x={lx} y={ly + dy + 13} textAnchor={anchor} fontSize={10} fill="var(--muted)">{c.sub} · {roleShort(c)}</text>
          </g>
        )
      })}

      <g>
        {plan.map((w) => {
          const a = startOf(w), b = endOf(w)
          if (!a || !b) return null
          const k = 22
          const [x1, y1] = px(a.x, a.y), [c1x, c1y] = px(a.x + a.n[0] * k, a.y + a.n[1] * k), [c2x, c2y] = px(b.x + b.n[0] * k, b.y + b.n[1] * k), [x2, y2] = px(b.x, b.y)
          const d = `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`
          const sw = w.cable && /2[.,]5/.test(w.cable.sub) ? mm(3.4) : mm(2.8)
          const [ex, ey] = px(b.x - b.n[0] * 11, b.y - b.n[1] * 11)
          const [sx, sy] = px(a.x - a.n[0] * 7, a.y - a.n[1] * 7)
          return (
            <g key={w.key} className={`jc-wire ${wireState(w.key)}`} data-tip={`${w.cable ? w.cable.label : w.device?.label}: ${WIRE_LABEL[w.color]} → ${w.terminal.label}${w.note ? ` (${w.note})` : ''}`} onMouseEnter={() => onHover(w.key)} onMouseLeave={() => onHover(null)} onClick={() => onPick(idx(w.key))}>
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

      {lay.placed.map((pl, pi) => {
        const [x, y] = px(pl.x, pl.y)
        const rowIdx = lay.placed.filter((q, qi) => qi < pi && q.flip === pl.flip && Math.abs(q.y - pl.y) < 20).length
        const capDy = rowIdx % 2 ? 12 : 0
        if (pl.kind === 'wago') {
          const ports = WAGO[pl.t.wago as 412 | 413 | 415].n * pl.t.chained
          const pitch = pl.w / ports
          const cap = `${pl.w >= 25 ? `221-${pl.t.wago} · ` : ''}${pl.t.chained > 1 ? `×${pl.t.chained} ` : ''}${pl.t.desc}`
          return (
            <g key={pl.t.id}>
              <rect x={x + 2} y={y + 3} width={mm(pl.w)} height={mm(DEPTH)} rx={3} fill="rgba(0,0,0,.18)" />
              <rect x={x} y={y} width={mm(pl.w)} height={mm(DEPTH)} rx={3} fill="rgba(255,255,255,.62)" stroke="#4a4a4a" strokeWidth={1.2} />
              {Array.from({ length: ports }, (_, i) => {
                const lx = x + mm(pitch * i + 0.6), lw = mm(pitch - 1.2)
                const used = i < pl.t.wires.length
                return (
                  <g key={i}>
                    <rect x={lx} y={pl.flip ? y + mm(DEPTH - 7.5) : y + mm(1)} width={lw} height={mm(6.5)} rx={2} fill={used ? '#f28c28' : '#f7b377'} stroke="#b35a0c" strokeWidth={0.8} />
                    <rect x={lx + lw * 0.2} y={pl.flip ? y : y + mm(DEPTH) - mm(3)} width={lw * 0.6} height={mm(3)} fill={used ? '#2b2b2b' : '#777'} />
                  </g>
                )
              })}
              <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(5.5) : y + mm(DEPTH - 3.5)} textAnchor="middle" fontSize={10} fontWeight={600} fill="#222">{pl.t.label}</text>
              <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(DEPTH) + 12 + capDy : y - 5 - capDy} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{cap}</text>
            </g>
          )
        }
        if (pl.kind === 'cap') {
          const [cw, ch] = [mm(CAP_W), mm(CAP_H)]
          return (
            <g key={pl.t.id}>
              <rect x={x} y={y} width={cw} height={ch} rx={cw / 2} fill={CAP_COLOR} stroke="#4c1d95" strokeWidth={0.8} />
              {[0.3, 0.55, 0.8].map((f) => <line key={f} x1={x + 1} y1={y + ch * f} x2={x + cw - 1} y2={y + ch * f} stroke="rgba(255,255,255,.35)" strokeWidth={0.8} />)}
              <text x={x + cw / 2} y={pl.flip ? y + ch + 12 + capDy : y - 5 - capDy} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{pl.t.id.startsWith('PARK') ? 'izoliraj' : `${pl.t.label} · izoliraj`}</text>
            </g>
          )
        }
        const d = pl.d
        const isBtn = d.kind !== 'relay'
        const look = isBtn ? { fill: '#fafaf7', stroke: '#555', text: '#333' } : RELAY_LOOK[relayBrand(relayModelOf(d.el))]
        const pitch = pl.w / d.ports.length
        return (
          <g key={d.el.id}>
            <rect x={x + 2} y={y + 3} width={mm(pl.w)} height={mm(pl.h)} rx={4} fill="rgba(0,0,0,.18)" />
            <rect x={x} y={y} width={mm(pl.w)} height={mm(pl.h)} rx={4} fill={look.fill} stroke={look.stroke} strokeWidth={1.2} />
            {d.ports.map((p, i) => {
              const cx = x + mm(pitch * (i + 0.5))
              const py = pl.flip ? y : y + mm(pl.h) - mm(3)
              return (
                <g key={p}>
                  <rect x={cx - mm(1.6)} y={py} width={mm(3.2)} height={mm(3)} fill="#111" />
                  <text x={cx} y={pl.flip ? y + mm(6.5) : y + mm(pl.h) - mm(4)} textAnchor="middle" fontSize={7.5} fill={look.text}>{p}</text>
                </g>
              )
            })}
            <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(pl.h) - mm(2.5) : y + mm(5.5)} textAnchor="middle" fontSize={9} fontWeight={600} fill={look.text}>{d.el.label}</text>
            <text x={x + mm(pl.w) / 2} y={pl.flip ? y + mm(pl.h) + 12 + capDy : y - 5 - capDy} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{d.label}</text>
          </g>
        )
      })}

      <line x1={bx} y1={by + mm(H + 8) + 6} x2={bx + mm(20)} y2={by + mm(H + 8) + 6} stroke="currentColor" strokeWidth={1.5} />
      <text x={bx + mm(20) + 6} y={by + mm(H + 8) + 10} fontSize={10} fill="var(--muted)">20 mm · {W} × {H} mm{lay.overflow ? ' (standardna je premala)' : ''}</text>
    </svg>
  )
}

function roleShort(c: BoxCable) {
  return ({ feed: 'dolaz', pass: 'prolaz', socket: 'utičnica', light: 'svjetlo', motor: 'vrata', switch: 'prekidač', lowv: 'slaba struja', unknown: '?' } as Record<string, string>)[c.role]
}

export const wireSwatch = (c: WireColor) => (c === 'gnye' ? 'repeating-linear-gradient(90deg,#2e8b3a 0 3px,#f2d31b 3px 6px)' : WIRE_HEX[c])
