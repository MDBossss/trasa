import { useSyncExternalStore } from 'react'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Pt } from './types'

// "Terenski način": on a phone the app is a viewer with a few field actions (photo of a wall,
// box details), not an editor. Drawing stays on desktop / tablet with a mouse.
export const MOBILE_MQ = '(max-width: 760px)'
const mq = typeof matchMedia === 'function' ? matchMedia(MOBILE_MQ) : null
export function useMobile() {
  return useSyncExternalStore(
    (cb) => { mq?.addEventListener('change', cb); return () => mq?.removeEventListener('change', cb) },
    () => mq?.matches ?? false,
  )
}

// touchmove keeps firing while the stage is being dragged, so a second finger can take over
Konva.hitOnDragEnabled = true

export type Camera = { x: number; y: number; scale: number }

// Two-finger pinch zoom + pan for a Konva stage whose position/scale live in the store.
export function pinch(stage: () => Konva.Stage | null, get: () => Camera, set: (c: Camera) => void, limits: [number, number]) {
  let lastDist = 0
  let lastCenter: Pt | null = null
  const onTouchMove = (e: KonvaEventObject<TouchEvent>) => {
    const [t1, t2] = [e.evt.touches[0], e.evt.touches[1]]
    const st = stage()
    if (!t1 || !t2 || !st) return
    e.evt.preventDefault()
    if (st.isDragging()) st.stopDrag()
    const box = st.container().getBoundingClientRect()
    const p1 = { x: t1.clientX - box.left, y: t1.clientY - box.top }
    const p2 = { x: t2.clientX - box.left, y: t2.clientY - box.top }
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (!lastCenter) { lastCenter = center; lastDist = d; return }
    const c = get()
    const scale = Math.max(limits[0], Math.min(limits[1], (c.scale * d) / lastDist))
    const wx = (lastCenter.x - c.x) / c.scale
    const wy = (lastCenter.y - c.y) / c.scale
    set({ scale, x: center.x - wx * scale, y: center.y - wy * scale })
    lastDist = d
    lastCenter = center
  }
  const onTouchEnd = () => { lastDist = 0; lastCenter = null }
  return { onTouchMove, onTouchEnd }
}

// Desktop navigation as in Excalidraw / Figma: wheel or two-finger scroll pans (Shift = sideways),
// Ctrl/⌘ + wheel and trackpad pinch (which the browser reports as ctrl + wheel) zoom at the pointer.
export function wheelNav(e: WheelEvent, at: Pt, update: (f: (c: Camera) => Camera) => void, limits: [number, number]) {
  e.preventDefault()
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
  let dx = e.deltaX * k, dy = e.deltaY * k
  if (e.ctrlKey || e.metaKey) {
    const d = Math.max(-40, Math.min(40, dy))
    update((c) => {
      const scale = Math.max(limits[0], Math.min(limits[1], c.scale * Math.exp(-d * 0.01)))
      return { scale, x: at.x - ((at.x - c.x) / c.scale) * scale, y: at.y - ((at.y - c.y) / c.scale) * scale }
    })
    return
  }
  if (e.shiftKey && dx === 0) { dx = dy; dy = 0 }
  update((c) => ({ ...c, x: c.x - dx, y: c.y - dy }))
}

// Middle mouse button drags the canvas from any tool.
export function middlePan(e: MouseEvent, update: (f: (c: Camera) => Camera) => void) {
  if (e.button !== 1) return false
  e.preventDefault()
  let last = { x: e.clientX, y: e.clientY }
  const move = (m: MouseEvent) => { const dx = m.clientX - last.x, dy = m.clientY - last.y; last = { x: m.clientX, y: m.clientY }; update((c) => ({ ...c, x: c.x + dx, y: c.y + dy })) }
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  return true
}
