import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icons'

const MIN = 1, MAX = 5

// Scrollable pane whose content scales by width: pinch or the +/− buttons zoom, the finger scrolls.
export function ZoomPane({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [z, setZ] = useState(1)
  const zRef = useRef(1)
  const apply = (next: number, cx?: number, cy?: number) => {
    const el = ref.current
    const nz = Math.max(MIN, Math.min(MAX, next))
    if (!el || nz === zRef.current) return
    // keep the point under the fingers (or the centre) where it is
    const fx = cx ?? el.clientWidth / 2, fy = cy ?? el.clientHeight / 2
    const k = nz / zRef.current
    const sl = (el.scrollLeft + fx) * k - fx, st = (el.scrollTop + fy) * k - fy
    zRef.current = nz
    setZ(nz)
    requestAnimationFrame(() => { el.scrollLeft = sl; el.scrollTop = st })
  }
  useEffect(() => {
    const el = ref.current!
    let d0 = 0, z0 = 1
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const start = (e: TouchEvent) => { if (e.touches.length === 2) { d0 = dist(e.touches); z0 = zRef.current } }
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return
      e.preventDefault()
      const box = el.getBoundingClientRect()
      apply((z0 * dist(e.touches)) / d0, (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top)
    }
    const end = () => { d0 = 0 }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end) }
  }, [])
  return (
    <div className="zoom-wrap">
      <div className="zoom-pane" ref={ref}>
        <div className="zoom-inner" style={{ width: `${z * 100}%` }}>{children}</div>
      </div>
      <div className="hud-group zoom-ctl">
        <button className="icon-btn" onClick={() => apply(zRef.current / 1.4)} aria-label="Umanji"><Icon.zoomOut /></button>
        <button className="hud-zoom" onClick={() => apply(1)}>{Math.round(z * 100)}%</button>
        <button className="icon-btn" onClick={() => apply(zRef.current * 1.4)} aria-label="Uvećaj"><Icon.zoomIn /></button>
      </div>
    </div>
  )
}
