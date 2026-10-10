import { useEffect, useRef, useState } from 'react'
import { redo, undo, useStore } from '../store'
import { fileToDataUrl } from '../images'
import { emptyProject, type Tool } from '../types'
import { open, save } from '../persistence'
import { GitHubPanel } from './GitHubPanel'

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Odaberi', key: 'V', hint: 'klik označi, Delete briše, vuci točke' },
  { id: 'pan', label: 'Pomakni', key: 'H', hint: 'ili drži Space; kotačić zumira' },
  { id: 'conduit', label: 'Bužir', key: 'B', hint: 'klik dodaje točke, Enter/dupli klik završi, Esc odustani' },
  { id: 'room', label: 'Soba', key: 'R', hint: 'klik dodaje kutove, klik na prvi ili Enter zatvori' },
  { id: 'calibrate', label: 'Mjerilo', key: 'C', hint: 'dva klika na poznatu udaljenost' },
  { id: 'align', label: 'Poravnaj', key: 'A', hint: 'dva klika duž zida koji treba biti ravan; slika se zakrene na grid' },
  { id: 'origin', label: 'Ishodište', key: 'O', hint: 'klik na kut zida: grid linije prolaze kroz tu točku' },
]

export function Toolbar() {
  const tool = useStore((s) => s.tool)
  const project = useStore((s) => s.project)
  const { setTool, patchProject, replaceProject, toggle, rotatePlan } = useStore.getState()
  const showGrid = useStore((s) => s.showGrid)
  const snapGrid = useStore((s) => s.snapGrid)
  const snapAngle = useStore((s) => s.snapAngle)
  const dirty = useStore((s) => s.dirty)
  const fileName = useStore((s) => s.fileName)
  const hasPicker = 'showSaveFilePicker' in window
  const [gh, setGh] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('trasa-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' } })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('trasa-theme', theme) } catch { /* private mode */ }
  }, [theme])
  const planInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)

  const onPlan = async (f: File | undefined) => {
    if (!f) return
    const { url, w, h } = await fileToDataUrl(f, 3000)
    patchProject({ planImage: url, planSize: { w, h }, planRotation: 0 })
  }

  const reset = () => {
    if (confirm('Obrisati cijeli projekt? (spremi prije ako treba)')) replaceProject(emptyProject())
  }

  return (
    <div className="toolbar">
      <div className="brand">Trasa</div>
      <div className="group">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.hint} (${t.key})`}>
            {t.label} <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <div className="group">
        <label><input type="checkbox" checked={showGrid} onChange={() => toggle('showGrid')} /> Grid <kbd>G</kbd></label>
        <label><input type="checkbox" checked={snapGrid} onChange={() => toggle('snapGrid')} /> Snap grid</label>
        <label><input type="checkbox" checked={snapAngle} onChange={() => toggle('snapAngle')} /> Snap 45°</label>
      </div>
      <div className="group">
        <button onClick={undo} title="Cmd+Z">Undo</button>
        <button onClick={redo} title="Cmd+Shift+Z">Redo</button>
      </div>
      <div className="spacer" />
      <div className="group">
        <button onClick={() => planInput.current?.click()}>Učitaj tlocrt</button>
        {project.planImage && (
          <>
            <button onClick={() => rotatePlan(-1)} title="Rotiraj tlocrt ulijevo">↺ 90°</button>
            <button onClick={() => rotatePlan(1)} title="Rotiraj tlocrt udesno">↻ 90°</button>
          </>
        )}
        <input ref={planInput} type="file" accept="image/*" hidden onChange={(e) => void onPlan(e.target.files?.[0])} />
        <button onClick={() => void save()} className={dirty ? 'dirty' : ''} title="Cmd+S">
          Spremi{dirty ? ' •' : ''}
        </button>
        {hasPicker && <button onClick={() => void save(true)} title="Spremi u novu datoteku">Spremi kao</button>}
        <button onClick={() => (hasPicker ? void open() : jsonInput.current?.click())}>Otvori</button>
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => void open(e.target.files?.[0])} />
        <button onClick={() => setGh(true)} title="Spremi/otvori projekte iz GitHub repoa">GitHub</button>
        {fileName && <span className="muted file">{fileName}</span>}
        {gh && <GitHubPanel onClose={() => setGh(false)} />}
        <button className="danger" onClick={reset}>Novi</button>
        <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Svijetla / tamna tema">{theme === 'dark' ? '☀︎' : '☾'}</button>
      </div>
    </div>
  )
}
