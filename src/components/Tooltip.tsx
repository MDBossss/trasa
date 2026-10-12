import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// One tooltip layer for the whole app. Any element with a `title` keeps writing it as before;
// on hover the text moves to `data-tip` (so the browser's slow native bubble never shows) and
// this layer renders it fast, next to the element. Touch devices never see it.

const DELAY = 120, LINGER = 250
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null)
  const timer = useRef<number | null>(null)
  const lastHide = useRef(0)
  const target = useRef<Element | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(0)
  // keep the whole bubble on screen once its width is known
  useLayoutEffect(() => { if (tip && box.current) { const w = box.current.offsetWidth; setLeft(Math.min(Math.max(tip.x, w / 2 + 8), innerWidth - w / 2 - 8)) } }, [tip])

  useEffect(() => {
    if (matchMedia('(hover: none)').matches) return
    const textOf = (el: Element) => {
      const t = el.getAttribute('title')
      if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title') }
      return el.getAttribute('data-tip')
    }
    const place = (el: Element, text: string) => {
      const r = el.getBoundingClientRect()
      const above = r.bottom + 44 > innerHeight
      setTip({ text, x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above })
    }
    const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; target.current = null; setTip((t) => { if (t) lastHide.current = performance.now(); return null }) }
    const over = (e: Event) => {
      const el = (e.target as Element).closest?.('[title], [data-tip]')
      if (!el || el === target.current) return
      if (timer.current) clearTimeout(timer.current)
      target.current = el
      const text = textOf(el)
      if (!text) { setTip(null); return }
      // moving straight from one tooltip to the next shows it at once
      const wait = performance.now() - lastHide.current < LINGER ? 0 : DELAY
      timer.current = window.setTimeout(() => place(el, text), wait)
    }
    const out = (e: Event) => {
      const to = (e as MouseEvent).relatedTarget as Element | null
      if (target.current && to && target.current.contains(to)) return
      hide()
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out)
      document.removeEventListener('mousedown', hide, true); document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true); window.removeEventListener('blur', hide)
    }
  }, [])

  if (!tip) return null
  return (
    <div ref={box} className={`tip ${tip.above ? 'above' : ''}`} role="tooltip" style={{ left, top: tip.y }}>{tip.text}</div>
  )
}
