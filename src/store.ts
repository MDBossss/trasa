import { create } from 'zustand'
import { temporal } from 'zundo'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { conduitTouchesRoom } from './walls'
import { emptyProject, PALETTE, ELEMENT_META, DEFAULT_CATEGORIES, matchCategory, type Category, type Cable, type Conduit, type ElementType, type Project, type Pt, type Room, type Tool, type View, type WallElement, type WallTool, relayModelOf } from './types'

const IDB_KEY = 'trasa-project'

// Fills fields added after a project was saved.
export const normalize = (p: Project): Project => ({ ...emptyProject(), ...p, planRotation: p.planRotation ?? 0, planTilt: p.planTilt ?? 0, gridOrigin: p.gridOrigin ?? { x: 0, y: 0 }, planOpacity: p.planOpacity ?? 1, elements: (p.elements ?? []).map((e) => (e.type === 'relay' ? { ...e, relayModel: relayModelOf(e) } : e)), cables: p.cables ?? [], categories: p.categories ?? DEFAULT_CATEGORIES.map((c) => ({ ...c, keywords: [...c.keywords] })) })

export const uid = () => Math.random().toString(36).slice(2, 10)

interface State {
  project: Project
  tool: Tool
  wallTool: WallTool
  elementType: ElementType
  placeSwitchKind?: 'tipkalo'
  wallCamera: { x: number; y: number; scale: number }
  wallFitNonce: number
  selectedId: string | null
  view: View
  showGrid: boolean
  focusRoomId: string | null
  hiddenCategories: string[]
  hiddenConduits: string[]
  soloCategory: string | null
  snapGrid: boolean
  snapAngle: boolean
  loaded: boolean
  openGitHub: boolean
  openSettings: boolean
  camera: { x: number; y: number; scale: number }
  fitNonce: number
  dirty: boolean
  fileName: string | null

  setTool: (t: Tool) => void
  setWallTool: (t: WallTool, type?: ElementType, placeSwitchKind?: 'tipkalo') => void
  setWallCamera: (c: { x: number; y: number; scale: number }) => void
  wallZoomBy: (factor: number, center?: Pt) => void
  wallFitView: () => void
  addElement: (e: Omit<WallElement, 'id' | 'label'> & { label?: string }) => string
  updateElement: (id: string, p: Partial<WallElement>) => void
  addCable: (c: Omit<Cable, 'id'>) => string
  updateCable: (id: string, p: Partial<Cable>) => void
  select: (id: string | null) => void
  setView: (v: View) => void
  toggle: (k: 'showGrid' | 'snapGrid' | 'snapAngle') => void
  setFocusRoom: (id: string | null) => void
  toggleHiddenCategory: (id: string) => void
  toggleHiddenConduit: (id: string) => void
  setSoloCategory: (id: string | null) => void
  patchProject: (p: Partial<Project>) => void
  replaceProject: (p: Project) => void
  addConduit: (points: Pt[]) => string
  updateConduit: (id: string, p: Partial<Conduit>) => void
  setCategories: (c: Category[]) => void
  addRoom: (points: Pt[], name: string) => string
  updateRoom: (id: string, p: Partial<Room>) => void
  setWallPhoto: (roomId: string, wall: number, photo: string | undefined) => void
  removeSelected: () => void
  rotatePlan: (dir: 1 | -1) => void
  setTilt: (deg: number) => void
  markSaved: (fileName?: string) => void
  setCamera: (c: { x: number; y: number; scale: number }) => void
  zoomBy: (factor: number, center?: Pt) => void
  fitView: () => void
}

export const useStore = create<State>()(
  temporal(
    (set, get) => ({
      project: emptyProject(),
      tool: 'select',
      wallTool: 'select',
      elementType: 'box',
      wallCamera: { x: 0, y: 0, scale: 1 },
      wallFitNonce: 0,
      selectedId: null,
      view: { kind: 'plan' },
      showGrid: true,
      focusRoomId: null,
      hiddenCategories: [],
      hiddenConduits: [],
      soloCategory: null,
      snapGrid: true,
      snapAngle: true,
      loaded: false,
      openGitHub: false,
      openSettings: false,
      camera: { x: 0, y: 0, scale: 1 },
      fitNonce: 0,
      dirty: false,
      fileName: null,

      setTool: (tool) => set({ tool, selectedId: null }),
      setWallTool: (wallTool, type, placeSwitchKind) => set((s) => ({ wallTool, elementType: type ?? s.elementType, placeSwitchKind: type ? placeSwitchKind : s.placeSwitchKind, selectedId: null })),
      setWallCamera: (wallCamera) => set({ wallCamera }),
      wallZoomBy: (factor, center) =>
        set((s) => {
          const c = s.wallCamera
          const scale = Math.max(0.1, Math.min(30, c.scale * factor))
          const cx = center?.x ?? 0
          const cy = center?.y ?? 0
          return { wallCamera: { scale, x: cx - ((cx - c.x) / c.scale) * scale, y: cy - ((cy - c.y) / c.scale) * scale } }
        }),
      wallFitView: () => set((s) => ({ wallFitNonce: s.wallFitNonce + 1 })),
      addElement: (e) => {
        const id = uid()
        set((s) => {
          const n = s.project.elements.filter((x) => x.type === e.type).length + 1
          const label = e.label ?? `${ELEMENT_META[e.type].prefix}${n}`
          return { project: { ...s.project, elements: [...s.project.elements, { ...e, id, label }] }, selectedId: id }
        })
        return id
      },
      updateElement: (id, p) =>
        set((s) => ({ project: { ...s.project, elements: s.project.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) } })),
      addCable: (c) => {
        const id = uid()
        set((s) => ({ project: { ...s.project, cables: [...s.project.cables, { ...c, id }] }, selectedId: id }))
        return id
      },
      updateCable: (id, p) =>
        set((s) => ({ project: { ...s.project, cables: s.project.cables.map((c) => (c.id === id ? { ...c, ...p } : c)) } })),
      select: (selectedId) => set({ selectedId }),
      setView: (view) => set({ view }),
      toggle: (k) => set((s) => ({ [k]: !s[k] })),
      setFocusRoom: (focusRoomId) => set({ focusRoomId }),
      toggleHiddenCategory: (id) => set((s) => ({ hiddenCategories: s.hiddenCategories.includes(id) ? s.hiddenCategories.filter((x) => x !== id) : [...s.hiddenCategories, id] })),
      setSoloCategory: (soloCategory) => set({ soloCategory }),
      toggleHiddenConduit: (id) => set((s) => ({ hiddenConduits: s.hiddenConduits.includes(id) ? s.hiddenConduits.filter((x) => x !== id) : [...s.hiddenConduits, id] })),
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
      // Renaming re-matches the category by keywords; picking a category sets its colour.
      updateConduit: (id, p) =>
        set((s) => ({
          project: {
            ...s.project,
            conduits: s.project.conduits.map((c) => {
              if (c.id !== id) return c
              let next = { ...c, ...p }
              if (p.name !== undefined && p.categoryId === undefined) {
                const cat = matchCategory(p.name, s.project.categories)
                if (cat) next = { ...next, categoryId: cat.id, color: cat.color }
              }
              if (p.categoryId !== undefined) {
                const cat = s.project.categories.find((x) => x.id === p.categoryId)
                if (cat) next = { ...next, color: cat.color }
              }
              return next
            }),
          },
        })),
      setCategories: (categories) =>
        set((s) => ({
          project: {
            ...s.project,
            categories,
            // conduits follow their category's colour
            conduits: s.project.conduits.map((c) => {
              const cat = categories.find((x) => x.id === c.categoryId)
              return cat ? { ...c, color: cat.color } : c
            }),
          },
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
      setCamera: (camera) => set({ camera }),
      // zoom around a screen point (defaults to the current camera origin)
      zoomBy: (factor, center) =>
        set((s) => {
          const c = s.camera
          const scale = Math.max(0.05, Math.min(20, c.scale * factor))
          const cx = center?.x ?? 0
          const cy = center?.y ?? 0
          return { camera: { scale, x: cx - ((cx - c.x) / c.scale) * scale, y: cy - ((cy - c.y) / c.scale) * scale } }
        }),
      fitView: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
      markSaved: (fileName) => set((s) => ({ dirty: false, fileName: fileName ?? s.fileName })),
      removeSelected: () =>
        set((s) => {
          const id = s.selectedId
          if (!id) return {}
          const p = s.project
          // cables bound to a removed element/conduit end keep a free end at its last spot
          const el = p.elements.find((e) => e.id === id)
          const freeEnd = (end: Cable['from']): Cable['from'] => {
            if (end.kind === 'element' && end.id === id && el) return { kind: 'free', xM: el.xM, zM: el.zM }
            if (end.kind === 'exit' && end.conduitId === id) return { kind: 'free', xM: 0, zM: p.ceilingM }
            return end
          }
          const rooms = p.rooms.filter((r) => r.id !== id)
          const roomGone = rooms.length !== p.rooms.length
          const gone = new Set([id, ...p.elements.filter((e) => e.host === id).map((e) => e.id)])
          const unref = (e: WallElement): WallElement => ({
            ...e,
            controls: e.controls?.filter((x) => !gone.has(x)),
            relayId: e.relayId && gone.has(e.relayId) ? undefined : e.relayId,
            feedRelayId: e.feedRelayId && gone.has(e.feedRelayId) ? undefined : e.feedRelayId,
          })
          return {
            selectedId: null,
            project: {
              ...p,
              conduits: p.conduits.filter((c) => c.id !== id),
              rooms,
              elements: p.elements.filter((e) => !gone.has(e.id) && !(roomGone && e.roomId === id)).map(unref),
              cables: p.cables.filter((c) => c.id !== id && !(roomGone && c.roomId === id)).map((c) => ({ ...c, from: freeEnd(c.from), to: freeEnd(c.to) })),
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

// Visibility on the plan: eye toggles and room focus; the selected conduit always shows.
export function conduitVisible(c: Conduit, s: Pick<State, 'project' | 'focusRoomId' | 'hiddenCategories' | 'hiddenConduits' | 'selectedId' | 'soloCategory'>) {
  if (c.id === s.selectedId) return true
  if (s.soloCategory && (c.categoryId ?? '') !== s.soloCategory) return false
  if (s.hiddenConduits.includes(c.id)) return false
  if (c.categoryId && s.hiddenCategories.includes(c.categoryId)) return false
  if (s.focusRoomId) {
    const room = s.project.rooms.find((r) => r.id === s.focusRoomId)
    if (room && !conduitTouchesRoom(c, room, s.project.pxPerMeter)) return false
  }
  return true
}
