import { useStore } from '../store'
import { Icon } from './Icons'

// Phone navigation: the four views as a bottom tab bar (the header nav is hidden there).
export function TabBar() {
  const view = useStore((s) => s.view)
  const rooms = useStore((s) => s.project.rooms)
  const { setView } = useStore.getState()
  const tabs = [
    { id: 'plan', label: 'Tlocrt', icon: Icon.image, on: view.kind === 'plan', go: () => setView({ kind: 'plan' }) },
    { id: 'room', label: 'Sobe', icon: Icon.room, on: view.kind === 'room', disabled: !rooms.length, go: () => { if (view.kind !== 'room') setView({ kind: 'room', roomId: rooms[0].id, wall: 0 }) } },
    { id: 'junctions', label: 'Spojevi', icon: Icon.box, on: view.kind === 'junctions' || view.kind === 'printbox', go: () => setView({ kind: 'junctions', elementId: null }) },
    { id: 'bom', label: 'Materijal', icon: Icon.print, on: view.kind === 'bom' || view.kind === 'print', go: () => setView({ kind: 'bom' }) },
  ]
  return (
    <nav className="tabbar" aria-label="Pogled">
      {tabs.map((t) => (
        <button key={t.id} className={t.on ? 'on' : ''} aria-pressed={t.on} disabled={t.disabled} onClick={t.go}>
          <t.icon /><span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
