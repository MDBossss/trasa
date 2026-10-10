// Save/open projects in a GitHub repo: projects/<slug>/project.json plus the
// images as separate files, referenced as "gh:<path>" so the JSON stays small.
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { bytesToDataUrl, dataUrlToBytes, ghGetBytes, ghList, ghPut, sha256Hex, type GhConfig } from './github'
import { applySaveFile, buildSaveFile, type SaveFile } from './persistence'
import { useStore } from './store'
import type { Project } from './types'

export const slugify = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projekt'

const shas = new Map<string, string>()

export async function listRemoteProjects(cfg: GhConfig) {
  const entries = await ghList(cfg, 'projects')
  return entries.filter((e) => e.type === 'dir').map((e) => e.name)
}

export async function saveRemote(cfg: GhConfig, onStatus: (s: string) => void) {
  const file = buildSaveFile()
  const slug = slugify(file.project.name)
  const dir = `projects/${slug}`
  const existing = new Set((await ghList(cfg, `${dir}/img`)).map((e) => e.name))
  const refs = new Map<string, string>()

  const upload = async (dataUrl: string) => {
    if (refs.has(dataUrl)) return refs.get(dataUrl)!
    const { mime, bytes } = dataUrlToBytes(dataUrl)
    const ext = mime === 'image/png' ? 'png' : 'jpg'
    const name = `${await sha256Hex(dataUrl)}.${ext}`
    const path = `${dir}/img/${name}`
    if (!existing.has(name)) {
      onStatus(`Šaljem sliku ${refs.size + 1}…`)
      await ghPut(cfg, path, bytes, `trasa: ${slug} slika`)
      existing.add(name)
    }
    const ref = `gh:${path}`
    refs.set(dataUrl, ref)
    return ref
  }

  const p = file.project
  const project: Project = {
    ...p,
    planImage: p.planImage ? await upload(p.planImage) : null,
    rooms: await Promise.all(
      p.rooms.map(async (r) => ({
        ...r,
        walls: Object.fromEntries(
          await Promise.all(
            Object.entries(r.walls).map(async ([k, w]) => [k, { ...w, photo: w.photo ? await upload(w.photo) : undefined }]),
          ),
        ),
      })),
    ),
  }
  onStatus('Spremam projekt…')
  const path = `${dir}/project.json`
  let sha = shas.get(path)
  if (!sha) sha = (await ghGetBytes(cfg, path))?.sha
  const body = new TextEncoder().encode(JSON.stringify({ ...file, project } satisfies SaveFile, null, 1))
  shas.set(path, await ghPut(cfg, path, body, `trasa: ${slug}`, sha))
  useStore.getState().markSaved(`gh:${slug}`)
  onStatus('')
}

export async function openRemote(cfg: GhConfig, slug: string, onStatus: (s: string) => void) {
  const path = `projects/${slug}/project.json`
  onStatus('Učitavam projekt…')
  const got = await ghGetBytes(cfg, path)
  if (!got) throw new Error('Projekt ne postoji')
  shas.set(path, got.sha)
  const file = JSON.parse(new TextDecoder().decode(got.bytes)) as SaveFile
  let n = 0
  const resolve = async (ref: string | null | undefined) => {
    if (!ref || !ref.startsWith('gh:')) return ref ?? undefined
    onStatus(`Učitavam sliku ${++n}…`)
    const p = ref.slice(3)
    const cached = (await idbGet(`img:${p}`)) as string | undefined
    if (cached) return cached
    const img = await ghGetBytes(cfg, p)
    if (!img) return undefined
    const url = bytesToDataUrl(p.endsWith('.png') ? 'image/png' : 'image/jpeg', img.bytes)
    void idbSet(`img:${p}`, url)
    return url
  }
  const pr = file.project
  const project: Project = {
    ...pr,
    planImage: (await resolve(pr.planImage)) ?? null,
    rooms: await Promise.all(
      pr.rooms.map(async (r) => ({
        ...r,
        walls: Object.fromEntries(
          await Promise.all(Object.entries(r.walls).map(async ([k, w]) => [k, { ...w, photo: await resolve(w.photo) }])),
        ),
      })),
    ),
  }
  applySaveFile({ ...file, project })
  useStore.getState().markSaved(`gh:${slug}`)
  onStatus('')
}
