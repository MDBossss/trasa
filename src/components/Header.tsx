import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { fileToDataUrl } from '../images'
import { emptyProject } from '../types'
import { open, save } from '../persistence'
import { GitHubPanel } from './GitHubPanel'
import { ghConnected } from '../sync'
import { kbd } from '../keys'
import { SettingsPanel } from './SettingsPanel'
import { Icon } from './Icons'

export function Header() {
  const project = useStore((s) => s.project)
  const dirty = useStore((s) => s.dirty)
  const fileName = useStore((s) => s.fileName)
  const sync = useStore((s) => s.sync)
  const toGitHub = !!fileName?.startsWith('gh:') && ghConnected()
  const { patchProject, replaceProject, setView } = useStore.getState()
  const view = useStore((s) => s.view)
  const roomId = useStore((s) => s.roomId)
  const { setRoom } = useStore.getState()
  const [menu, setMenu] = useState(false)
  const openGitHub = useStore((s) => s.openGitHub)
  const openSettings = useStore((s) => s.openSettings)
  const [gh, setGhState] = useState(false)
  const setGh = (v: boolean) => { setGhState(v); if (!v) useStore.setState({ openGitHub: false }) }
  const ghOpen = gh || openGitHub
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('trasa-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' } })
  const planInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hasPicker = 'showSaveFilePicker' in window

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('trasa-theme', theme) } catch { /* private mode */ }
  }, [theme])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const onPlan = async (f: File | undefined) => {
    if (!f) return
    const { url, w, h } = await fileToDataUrl(f, 3000)
    patchProject({ planImage: url, planSize: { w, h }, planRotation: 0 })
  }
  const reset = () => {
    if (!dirty || confirm('Obrisati cijeli projekt? (spremi prije ako treba)')) replaceProject(emptyProject())
  }
  const item = (label: string, icon: keyof typeof Icon, fn: () => void, hint?: string) => {
    const Ic = Icon[icon]
    return (
      <button className="menu-item" onClick={() => { setMenu(false); fn() }}>
        <Ic /> <span>{label}</span> {hint && <kbd>{hint}</kbd>}
      </button>
    )
  }

  return (
    <header className="header">
      <div className="menu-wrap" ref={menuRef}>
        <button className={`icon-btn ${menu ? 'active' : ''}`} onClick={() => setMenu((m) => !m)} title="Datoteka" aria-label="Datoteka"><Icon.menu /></button>
        {menu && (
          <div className="menu">
            {item('Novi projekt', 'file', reset)}
            {item('Otvori…', 'folder', () => (hasPicker ? void open() : jsonInput.current?.click()), kbd('O'))}
            {item(toGitHub ? 'Spremi na GitHub' : 'Spremi', toGitHub ? 'cloud' : 'save', () => void save(), kbd('S'))}
            {hasPicker && item(toGitHub ? 'Spremi kao datoteku…' : 'Spremi kao…', 'save', () => void save(true), kbd('S', true))}
            <div className="menu-sep" />
            {item('GitHub projekti…', 'cloud', () => setGh(true))}
            <div className="menu-sep" />
            {item('Postavke projekta…', 'settings', () => useStore.setState({ openSettings: true }))}
            <div className="menu-sep" />
            {item(project.planImage ? 'Zamijeni tlocrt…' : 'Učitaj tlocrt…', 'image', () => planInput.current?.click())}
          </div>
        )}
      </div>
      <div className="brand">Trasa</div>
      <input className="project-name" value={project.name} onChange={(e) => patchProject({ name: e.target.value })} aria-label="Naziv projekta" />
      {sync.busy ? <span className="save-state busy"><span className="spinner" /> {sync.text}</span>
        : sync.error ? <button className="save-state err" onClick={() => setGh(true)} title={sync.error}>Spremanje nije uspjelo · detalji</button>
        : <span className={`save-state ${dirty ? 'dirty' : ''}`} title={fileName ?? 'nije spremljeno u datoteku'}>
            {dirty ? 'Nespremljeno' : 'Spremljeno'}{fileName ? ` · ${fileName.replace(/^gh:/, 'GitHub/')}` : ''}
          </span>}
      <div className="spacer" />
      <nav className="segmented view-nav" aria-label="Pogled">
        <button className={view.kind === 'plan' ? 'on' : ''} aria-pressed={view.kind === 'plan'} onClick={() => setView({ kind: 'plan' })}>Tlocrt</button>
        <button className={view.kind === 'room' ? 'on' : ''} aria-pressed={view.kind === 'room'} disabled={!project.rooms.length} title={project.rooms.length ? 'Zidovi sobe' : 'Nacrtaj sobu na tlocrtu'} onClick={() => { if (view.kind !== 'room') setView({ kind: 'room', roomId: project.rooms[0].id, wall: 0 }) }}>Sobe</button>
        <button className={view.kind === 'junctions' || view.kind === 'printbox' ? 'on' : ''} aria-pressed={view.kind === 'junctions' || view.kind === 'printbox'} onClick={() => setView({ kind: 'junctions', elementId: null })}>Spojevi</button>
        <button className={view.kind === 'bom' || view.kind === 'print' ? 'on' : ''} aria-pressed={view.kind === 'bom' || view.kind === 'print'} onClick={() => setView({ kind: 'bom' })}>Materijal</button>
      </nav>
      {view.kind !== 'plan' && project.rooms.length > 0 && (
        <select className="room-pick" aria-label="Soba" value={roomId ?? ''} onChange={(e) => {
          const id = e.target.value || null
          setRoom(id)
          if (view.kind === 'room' && id) setView({ kind: 'room', roomId: id, wall: 0 })
          if ((view.kind === 'junctions' || view.kind === 'printbox') && id) setView({ kind: 'junctions', elementId: null })
        }}>
          {(view.kind === 'bom' || view.kind === 'print') && <option value="">Cijela kuća</option>}
          {project.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      <div className="spacer" />
      <button className="primary" onClick={() => void save()} disabled={sync.busy} title={toGitHub ? `Spremi na GitHub (${kbd('S')}) · ${fileName?.slice(3)}` : `Spremi u datoteku (${kbd('S')})`} aria-label="Spremi">{toGitHub ? <Icon.cloud /> : <Icon.save />}<span className="lbl">Spremi</span></button>
      <button onClick={() => setGh(true)} title="Projekti u GitHub repou" aria-label="GitHub"><Icon.cloud /><span className="lbl">GitHub</span></button>
      <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Svijetla / tamna tema" aria-label="Tema">
        {theme === 'dark' ? <Icon.sun /> : <Icon.moon />}
      </button>
      <input ref={planInput} type="file" accept="image/*" hidden onChange={(e) => void onPlan(e.target.files?.[0])} />
      <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => void open(e.target.files?.[0])} />
      {ghOpen && <GitHubPanel onClose={() => setGh(false)} />}
      {openSettings && <SettingsPanel onClose={() => useStore.setState({ openSettings: false })} />}
    </header>
  )
}
