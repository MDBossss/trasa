import { useStore } from '../store'
import { ELEMENT_META, type ElementType, type WallTool } from '../types'
import { Icon, type IconName } from './Icons'

export interface WallToolDef { id: WallTool; type?: ElementType; switchKind?: 'tipkalo'; label: string; key: string; icon: IconName; hint: string }

export const WALL_TOOLS: WallToolDef[] = [
  { id: 'select', label: 'Odaberi', key: 'V', icon: 'cursor', hint: 'Klik označi · vuci element, izlaz bužira ili točku kabela · Alt = bez snapa · Delete briše' },
  { id: 'pan', label: 'Pomakni', key: 'H', icon: 'hand', hint: 'Vuci platno · kotačić / dva prsta pomiču · Ctrl/⌘ + kotačić ili pinch zumira · Space ili srednja tipka + vuci iz bilo kojeg alata' },
  { id: 'cable', label: 'Kabel', key: 'C', icon: 'cable', hint: 'Klik na izlaz bužira ili element počinje · klikovi dodaju lomove · klik na element završi · klik na rub zida = kut, nastavak na susjednom zidu · Enter = slobodan kraj' },
  { id: 'element', type: 'box', label: ELEMENT_META.box.label, key: 'K', icon: 'box', hint: 'Klik postavi kutiju · Esc natrag na Odaberi' },
  { id: 'element', type: 'socket', label: ELEMENT_META.socket.label, key: 'U', icon: 'socket', hint: 'Klik postavi utičnicu · klik na modularnu dozu stavi je u nju' },
  { id: 'element', type: 'switch', label: ELEMENT_META.switch.label, key: 'P', icon: 'switch', hint: 'Klik postavi prekidač · klik na modularnu dozu stavi ga u nju' },
  { id: 'element', type: 'switch', switchKind: 'tipkalo', label: 'Tipkalo', key: 'T', icon: 'button', hint: 'Klik postavi tipkalo (za relej) · klik na modularnu dozu stavi ga u nju' },
  { id: 'element', type: 'light', label: ELEMENT_META.light.label, key: 'L', icon: 'light', hint: 'Klik postavi svjetlo' },
  { id: 'element', type: 'panel', label: ELEMENT_META.panel.label, key: 'O', icon: 'panel', hint: 'Klik postavi razvodni ormar' },
  { id: 'element', type: 'modbox', label: ELEMENT_META.modbox.label, key: 'M', icon: 'modbox', hint: 'Klik postavi modularnu dozu (okvir za tipkala i releje)' },
  { id: 'element', type: 'relay', label: ELEMENT_META.relay.label, key: 'R', icon: 'relay', hint: 'Klik na kutiju, dozu ili LED nišu stavi relej (Shelly) u nju' },
  { id: 'element', type: 'ledpsu', label: ELEMENT_META.ledpsu.label, key: 'N', icon: 'led', hint: 'Klik postavi LED nišu (traka 24 V + napajanje)' },
  { id: 'element', type: 'motor', label: ELEMENT_META.motor.label, key: 'D', icon: 'motor', hint: 'Klik postavi upravljačku jedinicu vrata (rolo / sekcijska): L N PE + impuls sa Shellyja' },
  { id: 'element', type: 'boiler', label: ELEMENT_META.boiler.label, key: 'B', icon: 'boiler', hint: 'Klik postavi bojler: fiksni priključak L N PE, kabel 3×2,5 na vlastiti krug' },
  { id: 'element', type: 'kip', label: ELEMENT_META.kip.label, key: 'Z', icon: 'earth', hint: 'Klik postavi KIP (glavno uzemljenje): traka iz temelja, Cu 16 do ormara, Cu 6 izjednačenje' },
]

const GROUPS: number[][] = [[0, 1], [2, 3, 4, 5, 6, 7], [8, 9, 10, 11], [12]]

export function WallToolRail() {
  const tool = useStore((s) => s.wallTool)
  const elementType = useStore((s) => s.elementType)
  const setWallTool = useStore((s) => s.setWallTool)
  const placeKind = useStore((s) => s.placeSwitchKind)
  return (
    <nav className="tool-rail" aria-label="Alati zida">
      {GROUPS.map((g, gi) => (
        <div className="tool-group" key={gi}>
          {g.map((idx) => {
            const t = WALL_TOOLS[idx]
            const Ic = Icon[t.icon]
            const active = tool === t.id && (t.id !== 'element' || (elementType === t.type && (t.switchKind ?? null) === (placeKind ?? null)))
            return (
              <button key={idx} className={`tool ${active ? 'active' : ''}`} onClick={() => setWallTool(t.id, t.type, t.switchKind)} title={`${t.label} (${t.key}) — ${t.hint}`} aria-label={t.label} aria-pressed={active} data-tool={t.type ?? t.id}>
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

export function activeWallTool(tool: WallTool, type: ElementType, placeKind?: 'tipkalo') {
  return WALL_TOOLS.find((t) => t.id === tool && (t.id !== 'element' || (t.type === type && (t.switchKind ?? null) === (placeKind ?? null)))) ?? WALL_TOOLS[0]
}
