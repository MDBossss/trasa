import { useStore } from '../store'
import { Hud } from './Hud'
import { TOOLS } from './ToolRail'

export function CanvasHud({ size }: { size: { w: number; h: number } }) {
  const scale = useStore((s) => s.camera.scale)
  const tool = useStore((s) => s.tool)
  const showGrid = useStore((s) => s.showGrid)
  const snapGrid = useStore((s) => s.snapGrid)
  const snapAngle = useStore((s) => s.snapAngle)
  const hasPlan = useStore((s) => !!s.project.planImage)
  const focusRoom = useStore((s) => s.project.rooms.find((r) => r.id === s.focusRoomId))
  const hiddenCount = useStore((s) => s.hiddenCategories.length + s.hiddenConduits.length)
  const { toggle, zoomBy, fitView, setFocusRoom } = useStore.getState()
  const center = { x: size.w / 2, y: size.h / 2 }
  const t = TOOLS.find((x) => x.id === tool)!
  return (
    <Hud
      scale={scale}
      onZoomIn={() => zoomBy(1.2, center)}
      onZoomOut={() => zoomBy(1 / 1.2, center)}
      onFit={fitView}
      toggles={[
        { icon: 'grid', on: showGrid, title: 'Grid (G)', onClick: () => toggle('showGrid') },
        { icon: 'magnet', on: snapGrid, title: 'Snap na grid', onClick: () => toggle('snapGrid') },
        { icon: 'angle', on: snapAngle, title: 'Snap na 45°', onClick: () => toggle('snapAngle') },
      ]}
      hint={<><b>{t.label}</b> · {hasPlan ? t.hint : 'Učitaj tlocrt: meni ☰ → Učitaj tlocrt, ili ispusti sliku na platno'}</>}
      chips={
        <>
          {focusRoom && <button className="chip" onClick={() => setFocusRoom(null)} title="Prikaži sve (Esc)">Fokus: {focusRoom.name} · samo bužiri te sobe ✕</button>}
          {hiddenCount > 0 && <span className="chip muted">{hiddenCount} skriveno</span>}
        </>
      }
    />
  )
}
