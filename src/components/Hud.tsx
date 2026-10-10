import type { ReactNode } from 'react'
import { redo, undo } from '../store'
import { Icon, type IconName } from './Icons'

export interface HudToggle { icon: IconName; on: boolean; title: string; onClick: () => void }

export function Hud({ scale, onZoomIn, onZoomOut, onFit, toggles, hint, extra }: {
  scale: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; toggles: HudToggle[]; hint: ReactNode; extra?: ReactNode
}) {
  return (
    <>
      <div className="hud hud-bl">
        <div className="hud-group">
          <button className="icon-btn" onClick={onZoomOut} title="Umanji (−)" aria-label="Umanji"><Icon.zoomOut /></button>
          <button className="hud-zoom" onClick={onFit} title="Uklopi u ekran (0)">{Math.round(scale * 100)}%</button>
          <button className="icon-btn" onClick={onZoomIn} title="Uvećaj (+)" aria-label="Uvećaj"><Icon.zoomIn /></button>
          <button className="icon-btn" onClick={onFit} title="Uklopi (0)" aria-label="Uklopi"><Icon.fit /></button>
        </div>
        <div className="hud-group">
          <button className="icon-btn" onClick={undo} title="Undo (⌘Z)" aria-label="Undo"><Icon.undo /></button>
          <button className="icon-btn" onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon.redo /></button>
        </div>
        {extra}
      </div>
      <div className="hud hud-br">
        <div className="hud-group">
          {toggles.map((t) => {
            const Ic = Icon[t.icon]
            return <button key={t.title} className={`icon-btn ${t.on ? 'on' : ''}`} onClick={t.onClick} title={t.title} aria-label={t.title} aria-pressed={t.on}><Ic /></button>
          })}
        </div>
      </div>
      <div className="hud hud-hint">{hint}</div>
    </>
  )
}
