import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { wallExits, type Exit } from '../walls'
import { signedArea } from '../geometry'
import type { Pt } from '../types'
import { Icon } from './Icons'
import { WallCanvas } from './WallCanvas'
import { WallSidebar } from './WallSidebar'
import { WallToolRail } from './WallToolRail'
import { Sheet } from './Sheet'
import { useMobile } from '../mobile'
import { fileToDataUrl } from '../images'

export function RoomView({ roomId, wall }: { roomId: string; wall: number | null }) {
  const project = useStore((s) => s.project)
  const { setView, updateConduit, setWallPhoto } = useStore.getState()
  const mobile = useMobile()
  const selectedId = useStore((s) => s.selectedId)
  const [sheet, setSheet] = useState(false)
  const camRef = useRef<HTMLInputElement>(null)
  // tapping an element or cable of this wall on the phone opens its details in the sheet
  const selOnWall = !!selectedId && wall !== null && (project.elements.some((e) => e.id === selectedId && e.roomId === roomId && e.wall === wall) || project.cables.some((c) => c.id === selectedId && c.roomId === roomId && c.wall === wall))
  useEffect(() => { if (mobile && selOnWall) setSheet(true) }, [mobile, selOnWall, selectedId])
  useEffect(() => { setSheet(false) }, [roomId, wall])
  const room = project.rooms.find((r) => r.id === roomId)
  const ppm = project.pxPerMeter ?? 100
  const walls = useMemo(() => (room ? wallExits(room, project.conduits, ppm) : []), [room, project.conduits, ppm])
  const cw = room ? signedArea(room.points) > 0 : true
  // opening a room lands on its first wall right away
  useEffect(() => {
    if (room && wall === null && walls.length) setView({ kind: 'room', roomId, wall: 0 })
  }, [room, wall, walls.length, roomId, setView])
  if (!room) return <div className="room-view"><p>Soba ne postoji.</p></div>
  const current = wall !== null ? walls[wall] : null

  // Vertical moves only change the stored exit height; horizontal moves slide the plan point.
  const moveExit = (e: Exit, posM: number, zM: number) => {
    if (!current) return
    const t = cw ? posM / current.lengthM : 1 - posM / current.lengthM
    const p: Pt = { x: current.a.x + (current.b.x - current.a.x) * t + e.offset.x, y: current.a.y + (current.b.y - current.a.y) * t + e.offset.y }
    const pts = e.conduit.points.map((q, i) => (i === (e.end === 'start' ? 0 : e.conduit.points.length - 1) ? p : q))
    const atCeiling = Math.abs(zM - project.ceilingM) < 0.005
    updateConduit(e.conduit.id, { points: pts, exitZ: { ...e.conduit.exitZ, [e.end]: atCeiling ? undefined : zM } })
  }
  const go = (d: number) => setView({ kind: 'room', roomId, wall: ((wall ?? 0) + d + walls.length) % walls.length })
  const onPhoto = async (f: File | undefined) => {
    if (!f || wall === null) return
    const { url } = await fileToDataUrl(f, 2000)
    setWallPhoto(room.id, wall, url)
  }

  // ← / → switch walls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !walls.length) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const sidebar = <WallSidebar room={room} walls={walls} wall={wall} />
  return (
    <>
      {current && !mobile && <WallToolRail />}
      <div className="room-view">
        <div className="room-head">
          <h2>{room.name}</h2>
          {current && (
            <div className="wall-nav">
              <button className="icon-btn" onClick={() => go(-1)} title="Prethodni zid" aria-label="Prethodni zid"><Icon.prev /></button>
              <span><b>Zid {current.i + 1}</b> / {walls.length}{!mobile && <> · {current.lengthM.toFixed(2)} × {project.ceilingM} m</>}</span>
              <button className="icon-btn" onClick={() => go(1)} title="Sljedeći zid" aria-label="Sljedeći zid"><Icon.next /></button>
            </div>
          )}
          {mobile && current && (
            <>
              <button className="icon-btn primary" onClick={() => camRef.current?.click()} title="Slikaj zid" aria-label="Slikaj zid"><Icon.camera /></button>
              <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
            </>
          )}
          {!project.pxPerMeter && !mobile && <span className="warn">Mjerilo nije postavljeno, duljine su procjena.</span>}
        </div>
        {current ? (
          <WallCanvas key={`${roomId}:${current.i}`} roomId={roomId} wall={current} photo={room.walls[current.i]?.photo} onMoveExit={moveExit} />
        ) : (
          <div className="empty"><Icon.room width={40} height={40} /><div>Odaberi zid u desnom panelu</div></div>
        )}
        {mobile && <Sheet title={selOnWall ? 'Detalji' : `${room.name} · zidovi`} open={sheet} onOpenChange={setSheet}>{sidebar}</Sheet>}
      </div>
      {!mobile && sidebar}
    </>
  )
}
