import { useRef, type ReactNode } from 'react'
import { Icon } from './Icons'

// Bottom sheet for the phone layout: a peek bar that opens to ~60% of the screen on tap or swipe.
export function Sheet({ title, open, onOpenChange, children }: { title: ReactNode; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode }) {
  const y0 = useRef<number | null>(null)
  return (
    <div className={`sheet ${open ? 'open' : ''}`}>
      <div
        className="sheet-handle"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChange(!open) } }}
        onTouchStart={(e) => { y0.current = e.touches[0].clientY }}
        onTouchEnd={(e) => {
          const dy = (y0.current ?? 0) - e.changedTouches[0].clientY
          y0.current = null
          if (dy > 30) onOpenChange(true)
          else if (dy < -30) onOpenChange(false)
        }}
      >
        <span className="sheet-grip" />
        <span className="sheet-title">{title}</span>
        <Icon.chevron className={`chev ${open ? 'down' : 'up'}`} />
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  )
}
