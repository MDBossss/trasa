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
