import { redo, undo, useStore } from '../store'
import { Icon } from './Icons'
import { TOOLS } from './ToolRail'

export function CanvasHud({ size }: { size: { w: number; h: number } }) {
  const scale = useStore((s) => s.camera.scale)
  const tool = useStore((s) => s.tool)
  const showGrid = useStore((s) => s.showGrid)
  const snapGrid = useStore((s) => s.snapGrid)
  const snapAngle = useStore((s) => s.snapAngle)
  const hasPlan = useStore((s) => !!s.project.planImage)
  const { toggle, zoomBy, fitView } = useStore.getState()
  const center = { x: size.w / 2, y: size.h / 2 }
  const t = TOOLS.find((x) => x.id === tool)!

  return (
    <>
      <div className="hud hud-bl">
        <div className="hud-group">
          <button className="icon-btn" onClick={() => zoomBy(1 / 1.2, center)} title="Umanji (−)" aria-label="Umanji"><Icon.zoomOut /></button>
          <button className="hud-zoom" onClick={fitView} title="Uklopi tlocrt u ekran (0)">{Math.round(scale * 100)}%</button>
          <button className="icon-btn" onClick={() => zoomBy(1.2, center)} title="Uvećaj (+)" aria-label="Uvećaj"><Icon.zoomIn /></button>
          <button className="icon-btn" onClick={fitView} title="Uklopi (0)" aria-label="Uklopi"><Icon.fit /></button>
        </div>
        <div className="hud-group">
          <button className="icon-btn" onClick={undo} title="Undo (⌘Z)" aria-label="Undo"><Icon.undo /></button>
          <button className="icon-btn" onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon.redo /></button>
        </div>
      </div>
      <div className="hud hud-br">
        <div className="hud-group">
          <button className={`icon-btn ${showGrid ? 'on' : ''}`} onClick={() => toggle('showGrid')} title="Grid (G)" aria-label="Grid" aria-pressed={showGrid}><Icon.grid /></button>
          <button className={`icon-btn ${snapGrid ? 'on' : ''}`} onClick={() => toggle('snapGrid')} title="Snap na grid" aria-label="Snap na grid" aria-pressed={snapGrid}><Icon.magnet /></button>
          <button className={`icon-btn ${snapAngle ? 'on' : ''}`} onClick={() => toggle('snapAngle')} title="Snap na 45°" aria-label="Snap na 45°" aria-pressed={snapAngle}><Icon.angle /></button>
        </div>
      </div>
      <div className="hud hud-hint">
        <b>{t.label}</b> · {hasPlan ? t.hint : 'Učitaj tlocrt: meni ☰ → Učitaj tlocrt, ili ispusti sliku na platno'}
      </div>
    </>
  )
}
