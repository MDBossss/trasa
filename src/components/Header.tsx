import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { fileToDataUrl } from '../images'
import { emptyProject } from '../types'
import { open, save } from '../persistence'
import { GitHubPanel } from './GitHubPanel'
import { Icon } from './Icons'

export function Header() {
  const project = useStore((s) => s.project)
  const dirty = useStore((s) => s.dirty)
  const fileName = useStore((s) => s.fileName)
  const { patchProject, replaceProject } = useStore.getState()
  const [menu, setMenu] = useState(false)
  const openGitHub = useStore((s) => s.openGitHub)
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
            {item('Otvori…', 'folder', () => (hasPicker ? void open() : jsonInput.current?.click()), '⌘O')}
            {item('Spremi', 'save', () => void save(), '⌘S')}
            {hasPicker && item('Spremi kao…', 'save', () => void save(true), '⇧⌘S')}
            <div className="menu-sep" />
            {item('GitHub projekti…', 'cloud', () => setGh(true))}
            <div className="menu-sep" />
            {item(project.planImage ? 'Zamijeni tlocrt…' : 'Učitaj tlocrt…', 'image', () => planInput.current?.click())}
          </div>
        )}
      </div>
      <div className="brand">Trasa</div>
      <input className="project-name" value={project.name} onChange={(e) => patchProject({ name: e.target.value })} aria-label="Naziv projekta" />
      <span className={`save-state ${dirty ? 'dirty' : ''}`} title={fileName ?? 'nije spremljeno u datoteku'}>
        {dirty ? 'Nespremljeno' : 'Spremljeno'}{fileName ? ` · ${fileName.replace(/^gh:/, 'GitHub/')}` : ''}
      </span>
      <div className="spacer" />
      <button className="primary" onClick={() => void save()} title="Spremi (⌘S)"><Icon.save /> Spremi</button>
      <button onClick={() => setGh(true)} title="Projekti u GitHub repou"><Icon.cloud /> GitHub</button>
      <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Svijetla / tamna tema" aria-label="Tema">
        {theme === 'dark' ? <Icon.sun /> : <Icon.moon />}
      </button>
      <input ref={planInput} type="file" accept="image/*" hidden onChange={(e) => void onPlan(e.target.files?.[0])} />
      <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => void open(e.target.files?.[0])} />
      {ghOpen && <GitHubPanel onClose={() => setGh(false)} />}
    </header>
  )
}
