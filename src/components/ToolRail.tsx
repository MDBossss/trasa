import { useStore } from '../store'
import type { Tool } from '../types'
import { Icon, type IconName } from './Icons'

export const TOOLS: { id: Tool; label: string; key: string; icon: IconName; hint: string }[] = [
  { id: 'select', label: 'Odaberi', key: 'V', icon: 'cursor', hint: 'Klik označi · vuci liniju ili točke · Alt = bez snapa · Delete briše' },
  { id: 'pan', label: 'Pomakni', key: 'H', icon: 'hand', hint: 'Vuci platno · ili drži Space · kotačić zumira' },
  { id: 'conduit', label: 'Bužir', key: 'B', icon: 'route', hint: 'Klik dodaje točke · Enter ili dupli klik završi · Alt = bez snapa · Esc odustani' },
  { id: 'room', label: 'Soba', key: 'R', icon: 'room', hint: 'Klikaj kutove · klik na prvi kut ili Enter zatvori' },
  { id: 'calibrate', label: 'Mjerilo', key: 'C', icon: 'ruler', hint: 'Dva klika na poznatu udaljenost, pa upiši metre' },
  { id: 'align', label: 'Poravnaj', key: 'A', icon: 'align', hint: 'Dva klika duž zida koji treba biti ravan' },
  { id: 'origin', label: 'Ishodište', key: 'O', icon: 'origin', hint: 'Klik na kut zida: grid prolazi kroz tu točku' },
]

const GROUPS: Tool[][] = [['select', 'pan'], ['conduit', 'room'], ['calibrate', 'align', 'origin']]

export function ToolRail() {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  return (
    <nav className="tool-rail" aria-label="Alati">
      {GROUPS.map((g, i) => (
        <div className="tool-group" key={i}>
          {g.map((id) => {
            const t = TOOLS.find((x) => x.id === id)!
            const Ic = Icon[t.icon]
            return (
              <button
                key={id}
                className={`tool ${tool === id ? 'active' : ''}`}
                onClick={() => setTool(id)}
                title={`${t.label} (${t.key}) — ${t.hint}`}
                aria-label={t.label}
                aria-pressed={tool === id}
                data-tool={id}
              >
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
