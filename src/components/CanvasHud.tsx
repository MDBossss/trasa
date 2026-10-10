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
  const { toggle, zoomBy, fitView } = useStore.getState()
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
    />
  )
}
