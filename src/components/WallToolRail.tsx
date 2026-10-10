import { useStore } from '../store'
import { ELEMENT_META, type ElementType, type WallTool } from '../types'
import { Icon, type IconName } from './Icons'

export interface WallToolDef { id: WallTool; type?: ElementType; label: string; key: string; icon: IconName; hint: string }

export const WALL_TOOLS: WallToolDef[] = [
  { id: 'select', label: 'Odaberi', key: 'V', icon: 'cursor', hint: 'Klik označi · vuci element, izlaz bužira ili točku kabela · Alt = bez snapa · Delete briše' },
  { id: 'pan', label: 'Pomakni', key: 'H', icon: 'hand', hint: 'Vuci platno · ili drži Space · kotačić zumira' },
  { id: 'element', type: 'box', label: ELEMENT_META.box.label, key: 'K', icon: 'box', hint: 'Klik postavi kutiju (snap na standardne visine) · Esc natrag na Odaberi' },
  { id: 'element', type: 'socket', label: ELEMENT_META.socket.label, key: 'U', icon: 'socket', hint: 'Klik postavi utičnicu · default 30 cm od poda' },
  { id: 'element', type: 'switch', label: ELEMENT_META.switch.label, key: 'P', icon: 'switch', hint: 'Klik postavi prekidač · default 105 cm od poda' },
  { id: 'element', type: 'light', label: ELEMENT_META.light.label, key: 'L', icon: 'light', hint: 'Klik postavi svjetlo' },
  { id: 'element', type: 'panel', label: ELEMENT_META.panel.label, key: 'O', icon: 'panel', hint: 'Klik postavi razvodni ormar' },
  { id: 'cable', label: 'Kabel', key: 'C', icon: 'cable', hint: 'Klik na izlaz bužira ili element počinje · klikovi dodaju lomove (vodoravno/okomito) · klik na element završi · Enter = slobodan kraj · Esc odustani' },
]

const GROUPS: number[][] = [[0, 1], [2, 3, 4, 5, 6], [7]]

export function WallToolRail() {
  const tool = useStore((s) => s.wallTool)
  const elementType = useStore((s) => s.elementType)
  const setWallTool = useStore((s) => s.setWallTool)
  return (
    <nav className="tool-rail" aria-label="Alati zida">
      {GROUPS.map((g, gi) => (
        <div className="tool-group" key={gi}>
          {g.map((idx) => {
            const t = WALL_TOOLS[idx]
            const Ic = Icon[t.icon]
            const active = tool === t.id && (t.id !== 'element' || elementType === t.type)
            return (
              <button key={idx} className={`tool ${active ? 'active' : ''}`} onClick={() => setWallTool(t.id, t.type)} title={`${t.label} (${t.key}) — ${t.hint}`} aria-label={t.label} aria-pressed={active} data-tool={t.type ?? t.id}>
                <Ic />
                <kbd>{t.key}</kbd>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function activeWallTool(tool: WallTool, type: ElementType) {
  return WALL_TOOLS.find((t) => t.id === tool && (t.id !== 'element' || t.type === type))!
}
