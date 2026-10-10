import { useStore } from './store'
import { download } from './images'
import type { Project, View } from './types'

// Save file = project + UI position, so opening it resumes where you stopped.
export interface SaveFile { app: 'trasa'; version: 1; savedAt: string; project: Project; ui: { view: View } }

type Handle = { name: string; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>; getFile(): Promise<File> }
type FsWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<Handle>
  showOpenFilePicker?: (o: unknown) => Promise<Handle[]>
}
const PICKER = { types: [{ description: 'Trasa projekt', accept: { 'application/json': ['.trasa.json', '.json'] } }] }

let handle: Handle | null = null

export function buildSaveFile(): SaveFile {
  const s = useStore.getState()
  return { app: 'trasa', version: 1, savedAt: new Date().toISOString(), project: s.project, ui: { view: s.view } }
}

export function parseSaveFile(text: string): SaveFile {
  const raw = JSON.parse(text)
  if (raw?.app === 'trasa' && raw.project) return raw as SaveFile
  if (raw?.version === 1 && Array.isArray(raw.conduits)) return { app: 'trasa', version: 1, savedAt: '', project: raw, ui: { view: { kind: 'plan' } } }
  throw new Error('Nepoznat format datoteke')
}

export function applySaveFile(f: SaveFile) {
  const st = useStore.getState()
  st.replaceProject(f.project)
  const v = f.ui?.view
  if (v?.kind === 'room' && useStore.getState().project.rooms.some((r) => r.id === v.roomId)) st.setView(v)
  st.markSaved()
}

export async function save(as = false) {
  const w = window as FsWindow
  const data = JSON.stringify(buildSaveFile())
  const fileName = `${useStore.getState().project.name.replace(/\s+/g, '_') || 'projekt'}.trasa.json`
  if (!w.showSaveFilePicker) {
    download(fileName, URL.createObjectURL(new Blob([data], { type: 'application/json' })))
    useStore.getState().markSaved()
    return
  }
  try {
    if (!handle || as) handle = await w.showSaveFilePicker({ ...PICKER, suggestedName: fileName })
    const wr = await handle.createWritable()
    await wr.write(data)
    await wr.close()
    useStore.getState().markSaved(handle.name)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e
  }
}

export async function open(file?: File) {
  const w = window as FsWindow
  if (!file && w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker(PICKER)
      handle = h
      file = await h.getFile()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
      return
    }
  }
  if (!file) return
  applySaveFile(parseSaveFile(await file.text()))
  if (handle) useStore.getState().markSaved(handle.name)
}
