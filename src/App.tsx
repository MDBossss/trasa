import { useEffect } from 'react'
import { loadPersisted, redo, undo, useStore } from './store'
import { Header } from './components/Header'
import { ToolRail } from './components/ToolRail'
import { Sidebar } from './components/Sidebar'
import { PlanCanvas } from './components/PlanCanvas'
import { RoomView } from './components/RoomView'
import { fileToDataUrl } from './images'
import { open, save } from './persistence'
import { consumeLoginHash } from './github'

export default function App() {
  const view = useStore((s) => s.view)
  const loaded = useStore((s) => s.loaded)

  useEffect(() => {
    if (consumeLoginHash()) useStore.setState({ openGitHub: true })
    void loadPersisted()
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); void save(e.shiftKey) }
      if (k === 'o') { e.preventDefault(); void open() }
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    }
    const onUnload = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) e.preventDefault() }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload) }
  }, [])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (!f || !f.type.startsWith('image/') || view.kind !== 'plan') return
    const { url, w, h } = await fileToDataUrl(f, 3000)
    useStore.getState().patchProject({ planImage: url, planSize: { w, h }, planRotation: 0 })
  }

  if (!loaded) return null
  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onDrop(e)}>
      <Header />
      <div className="main">
        {view.kind === 'plan' ? (
          <>
            <ToolRail />
            <PlanCanvas />
            <Sidebar />
          </>
        ) : (
          <RoomView roomId={view.roomId} wall={view.wall} />
        )}
      </div>
    </div>
  )
}
