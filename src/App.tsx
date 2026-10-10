import { useEffect } from 'react'
import { loadPersisted, redo, undo, useStore } from './store'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { PlanCanvas } from './components/PlanCanvas'
import { RoomView } from './components/RoomView'
import { fileToDataUrl } from './images'

export default function App() {
  const view = useStore((s) => s.view)
  const loaded = useStore((s) => s.loaded)

  useEffect(() => {
    void loadPersisted()
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      e.shiftKey ? redo() : undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      <Toolbar />
      <div className="main">
        {view.kind === 'plan' ? <PlanCanvas /> : <RoomView roomId={view.roomId} wall={view.wall} />}
        <Sidebar />
      </div>
    </div>
  )
}
