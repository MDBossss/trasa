// Save/open projects in a GitHub repo: projects/<slug>/project.json plus the
// images as separate files, referenced as "gh:<path>" so the JSON stays small.
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { bytesToDataUrl, dataUrlToBytes, GhError, ghGetBytes, ghList, ghPut, sha256Hex, type GhConfig } from './github'
import { applySaveFile, buildSaveFile, type SaveFile } from './persistence'
import { useStore } from './store'
import { decrypt, encrypt } from './crypto'
import type { Project } from './types'

export const slugify = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projekt'

const shas = new Map<string, string>()

// With a passphrase every file is stored encrypted under a ".enc" suffix.
const enc = (cfg: GhConfig, path: string) => (cfg.passphrase ? `${path}.enc` : path)
const seal = (cfg: GhConfig, bytes: Uint8Array) => (cfg.passphrase ? encrypt(bytes, cfg.passphrase) : Promise.resolve(bytes))
async function fetchFile(cfg: GhConfig, path: string) {
  const got = await ghGetBytes(cfg, enc(cfg, path))
  if (!got) return null
  return { sha: got.sha, bytes: cfg.passphrase ? await decrypt(got.bytes, cfg.passphrase) : got.bytes }
}

export async function listRemoteProjects(cfg: GhConfig) {
  const entries = await ghList(cfg, 'projects')
  return entries.filter((e) => e.type === 'dir').map((e) => e.name)
}

export async function saveRemote(cfg: GhConfig, onStatus: (s: string) => void) {
  const file = buildSaveFile()
  const slug = slugify(file.project.name)
  const dir = `projects/${slug}`
  const existing = new Set((await ghList(cfg, `${dir}/img`)).map((e) => e.name.replace(/\.enc$/, '')))
  const refs = new Map<string, string>()

  const upload = async (dataUrl: string) => {
    if (refs.has(dataUrl)) return refs.get(dataUrl)!
    const { mime, bytes } = dataUrlToBytes(dataUrl)
    const ext = mime === 'image/png' ? 'png' : 'jpg'
    const name = `${await sha256Hex(dataUrl)}.${ext}`
    const path = `${dir}/img/${name}`
    if (!existing.has(name)) {
      onStatus(`Šaljem sliku ${refs.size + 1}…`)
      await ghPut(cfg, enc(cfg, path), await seal(cfg, bytes), `trasa: ${slug} slika`)
      existing.add(name)
    }
    const ref = `gh:${path}`
    refs.set(dataUrl, ref)
    return ref
  }

  // Uploads run one after another: every PUT is a commit on the same branch
  // and GitHub answers 409 to concurrent ones.
  const p = file.project
  const rooms = []
  for (const r of p.rooms) {
    const walls: typeof r.walls = {}
    for (const [k, w] of Object.entries(r.walls)) walls[+k] = { ...w, photo: w.photo ? await upload(w.photo) : undefined }
    rooms.push({ ...r, walls })
  }
  const project: Project = { ...p, planImage: p.planImage ? await upload(p.planImage) : null, rooms }
  onStatus('Spremam projekt…')
  const path = `${dir}/project.json`
  const body = await seal(cfg, new TextEncoder().encode(JSON.stringify({ ...file, project } satisfies SaveFile, null, 1)))
  const freshSha = async () => (await ghGetBytes(cfg, enc(cfg, path)))?.sha
  let sha = shas.get(path) ?? (await freshSha())
  try {
    shas.set(path, await ghPut(cfg, enc(cfg, path), body, `trasa: ${slug}`, sha))
  } catch (e) {
    // stale sha (saved from another device, or a cached one): re-read and retry once
    if (!(e instanceof GhError) || e.status !== 409) throw e
    sha = await freshSha()
    shas.set(path, await ghPut(cfg, enc(cfg, path), body, `trasa: ${slug}`, sha))
  }
  useStore.getState().markSaved(`gh:${slug}`)
  onStatus('')
}

export async function openRemote(cfg: GhConfig, slug: string, onStatus: (s: string) => void) {
  const path = `projects/${slug}/project.json`
  onStatus('Učitavam projekt…')
  const got = await fetchFile(cfg, path)
  if (!got) throw new Error('Projekt ne postoji (ili je spremljen bez/s drugom lozinkom)')
  shas.set(path, got.sha)
  const file = JSON.parse(new TextDecoder().decode(got.bytes)) as SaveFile
  let n = 0
  const resolve = async (ref: string | null | undefined) => {
    if (!ref || !ref.startsWith('gh:')) return ref ?? undefined
    onStatus(`Učitavam sliku ${++n}…`)
    const p = ref.slice(3)
    const cached = (await idbGet(`img:${p}`)) as string | undefined
    if (cached && looksLikeImage(cached)) return cached
    const img = await fetchFile(cfg, p)
    if (!img) return undefined
    const url = bytesToDataUrl(p.endsWith('.png') ? 'image/png' : 'image/jpeg', img.bytes)
    if (!looksLikeImage(url)) throw new Error(`Datoteka ${p} nije slika`)
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

// base64 of JPEG starts with /9j/, PNG with iVBOR; anything else is not image data
function looksLikeImage(dataUrl: string) {
  const b = dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 6)
  return b.startsWith('/9j/') || b.startsWith('iVBOR')
}
