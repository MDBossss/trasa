import { create } from 'zustand'
import { temporal } from 'zundo'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { emptyProject, PALETTE, type Conduit, type Project, type Pt, type Room, type Tool, type View } from './types'

const IDB_KEY = 'trasa-project'

// Fills fields added after a project was saved.
export const normalize = (p: Project): Project => ({ ...emptyProject(), ...p, planRotation: p.planRotation ?? 0, planTilt: p.planTilt ?? 0, gridOrigin: p.gridOrigin ?? { x: 0, y: 0 } })

export const uid = () => Math.random().toString(36).slice(2, 10)

interface State {
  project: Project
  tool: Tool
  selectedId: string | null
  view: View
  showGrid: boolean
  snapGrid: boolean
  snapAngle: boolean
  loaded: boolean
  dirty: boolean
  fileName: string | null

  setTool: (t: Tool) => void
  select: (id: string | null) => void
  setView: (v: View) => void
  toggle: (k: 'showGrid' | 'snapGrid' | 'snapAngle') => void
  patchProject: (p: Partial<Project>) => void
  replaceProject: (p: Project) => void
  addConduit: (points: Pt[]) => string
  updateConduit: (id: string, p: Partial<Conduit>) => void
  addRoom: (points: Pt[], name: string) => string
  updateRoom: (id: string, p: Partial<Room>) => void
  setWallPhoto: (roomId: string, wall: number, photo: string | undefined) => void
  removeSelected: () => void
  rotatePlan: (dir: 1 | -1) => void
  setTilt: (deg: number) => void
  markSaved: (fileName?: string) => void
}

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      tool: 'select',
      selectedId: null,
      view: { kind: 'plan' },
      showGrid: true,
      snapGrid: true,
      snapAngle: true,
      loaded: false,
      dirty: false,
      fileName: null,

      setTool: (tool) => set({ tool, selectedId: null }),
      select: (selectedId) => set({ selectedId }),
      setView: (view) => set({ view }),
      toggle: (k) => set((s) => ({ [k]: !s[k] })),
      patchProject: (p) => set((s) => ({ project: { ...s.project, ...p } })),
      replaceProject: (project) => set({ project: normalize(project), selectedId: null, view: { kind: 'plan' } }),

      addConduit: (points) => {
        const id = uid()
        set((s) => {
          const n = s.project.conduits.length
          const c: Conduit = {
            id, name: `B${n + 1}`, color: PALETTE[n % PALETTE.length], diameter: 20, points, from: '', to: '', note: '',
          }
          return { project: { ...s.project, conduits: [...s.project.conduits, c] }, selectedId: id }
        })
        return id
      },
      updateConduit: (id, p) =>
        set((s) => ({
          project: { ...s.project, conduits: s.project.conduits.map((c) => (c.id === id ? { ...c, ...p } : c)) },
        })),
      addRoom: (points, name) => {
        const id = uid()
        set((s) => ({ project: { ...s.project, rooms: [...s.project.rooms, { id, name, points, walls: {} }] }, selectedId: id }))
        return id
      },
      updateRoom: (id, p) =>
        set((s) => ({ project: { ...s.project, rooms: s.project.rooms.map((r) => (r.id === id ? { ...r, ...p } : r)) } })),
      setWallPhoto: (roomId, wall, photo) => {
        const r = get().project.rooms.find((r) => r.id === roomId)
        if (!r) return
        get().updateRoom(roomId, { walls: { ...r.walls, [wall]: { ...r.walls[wall], photo } } })
      },
      // Rotating the plan rotates the drawing with it, so points are remapped
      // into the new frame and only the image render needs the stored angle.
      rotatePlan: (dir) =>
        set((s) => {
          const p = s.project
          const size = planDims(p)
          if (!size) return {}
          const rot = (((p.planRotation + dir * 90) % 360) + 360) % 360 as Project['planRotation']
          const map = (q: Pt): Pt => (dir === 1 ? { x: size.h - q.y, y: q.x } : { x: q.y, y: size.w - q.x })
          return {
            project: {
              ...p,
              planRotation: rot,
              conduits: p.conduits.map((c) => ({ ...c, points: c.points.map(map) })),
              rooms: p.rooms.map((r) => ({ ...r, points: r.points.map(map) })),
            },
          }
        }),
      setTilt: (deg) => {
        const t = Math.max(-45, Math.min(45, Math.round(deg * 100) / 100))
        set((s) => ({ project: { ...s.project, planTilt: t } }))
      },
      markSaved: (fileName) => set((s) => ({ dirty: false, fileName: fileName ?? s.fileName })),
      removeSelected: () =>
        set((s) => {
          const id = s.selectedId
          if (!id) return {}
          return {
            selectedId: null,
            project: {
              ...s.project,
              conduits: s.project.conduits.filter((c) => c.id !== id),
              rooms: s.project.rooms.filter((r) => r.id !== id),
            },
          }
        }),
    }),
    {
      partialize: (s) => ({ project: s.project }),
      // without this every tool/selection change would push a no-op undo entry
      equality: (a, b) => a.project === b.project,
      limit: 100,
    },
  ),
)

export const undo = () => useStore.temporal.getState().undo()
export const redo = () => useStore.temporal.getState().redo()

export async function loadPersisted() {
  const p = (await idbGet(IDB_KEY)) as Project | undefined
  if (p && p.version === 1) useStore.setState({ project: normalize(p) })
  useStore.setState({ loaded: true })
  useStore.temporal.getState().clear()
}

let timer: number | undefined
useStore.subscribe((s, prev) => {
  if (!s.loaded || s.project === prev.project) return
  if (!s.dirty) useStore.setState({ dirty: true })
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void idbSet(IDB_KEY, s.project), 400)
})

export function gridStepPx(p: Project): number | null {
  if (!p.pxPerMeter) return 20
  return (p.pxPerMeter * p.gridCm) / 100
}

// Plan size in drawing coordinates (swapped for 90/270).
export function planDims(p: Project): { w: number; h: number } | null {
  if (!p.planSize) return null
  return p.planRotation % 180 ? { w: p.planSize.h, h: p.planSize.w } : p.planSize
}
