// Minimal GitHub Contents API client; projects live in a (private) repo so
// the same project opens from any device.
export const AUTH_URL = 'https://trasa-auth.trasa-auth.workers.dev'

export interface GhAuth { access_token: string; refresh_token: string | null; expires_at: number | null }
// token = manual fine-grained PAT (fallback); auth = OAuth tokens from the worker
export interface GhConfig { token: string; repo: string; branch: string; passphrase: string; auth?: GhAuth | null }

const KEY = 'trasa-github'

export function loadGhConfig(): GhConfig | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as GhConfig) : null
  } catch {
    return null
  }
}

export function saveGhConfig(c: GhConfig | null) {
  try {
    c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY)
  } catch { /* private mode */ }
}

export class GhError extends Error {
  constructor(public status: number, msg: string) { super(msg) }
}

export async function appInstallUrl(): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_URL}/app`)
    return res.ok ? ((await res.json()) as { install_url: string }).install_url : null
  } catch {
    return null
  }
}

// OAuth user tokens from a GitHub App expire (8 h); refresh through the worker when close.
// Parallel requests share one refresh: GitHub rotates refresh tokens, so a
// second concurrent refresh with the same token would fail.
let inflight: Promise<GhAuth> | null = null
export async function bearer(cfg: GhConfig): Promise<string> {
  const a = cfg.auth
  if (!a) return cfg.token
  if (!a.expires_at || a.expires_at - Date.now() > 60_000 || !a.refresh_token) return a.access_token
  inflight ??= (async () => {
    try {
      const res = await fetch(`${AUTH_URL}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: a.refresh_token }) })
      if (!res.ok) throw new GhError(401, 'GitHub prijava je istekla, prijavi se ponovno')
      const fresh = (await res.json()) as GhAuth
      saveGhConfig({ ...(loadGhConfig() ?? cfg), auth: fresh })
      return fresh
    } finally {
      inflight = null
    }
  })()
  const fresh = await inflight
  cfg.auth = fresh
  return fresh.access_token
}

export function startLogin() {
  const ret = new URL(window.location.href)
  ret.hash = ''
  window.location.href = `${AUTH_URL}/login?return=${encodeURIComponent(ret.toString())}`
}

// After the worker redirects back with #gh=<base64 json>, store the tokens.
export function consumeLoginHash(): boolean {
  const m = /[#&]gh=([^&]+)/.exec(window.location.hash)
  if (!m) return false
  try {
    const auth = JSON.parse(atob(decodeURIComponent(m[1]))) as GhAuth
    const cfg = loadGhConfig() ?? { token: '', repo: 'mislavvv/trasa', branch: 'main', passphrase: '' }
    saveGhConfig({ ...cfg, auth })
  } finally {
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  return true
}

async function api(cfg: GhConfig, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await bearer(cfg)}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 403 && text.includes('not accessible by integration')) throw new GhError(403, 'GitHub App nije instaliran na ovaj repo (čitanje javnog repoa radi, pisanje ne).')
    throw new GhError(res.status, `GitHub ${res.status}: ${text.slice(0, 200)}`)
  }
  return res
}

export interface GhEntry { name: string; path: string; sha: string; type: 'file' | 'dir'; size: number }

export async function ghList(cfg: GhConfig, dir: string): Promise<GhEntry[]> {
  const res = await api(cfg, `${dir}?ref=${cfg.branch}`)
  if (!res) return []
  const j = (await res.json()) as GhEntry[] | GhEntry
  return Array.isArray(j) ? j : []
}

export async function ghGetBytes(cfg: GhConfig, path: string): Promise<{ sha: string; bytes: Uint8Array } | null> {
  const meta = await api(cfg, `${path}?ref=${cfg.branch}`)
  if (!meta) return null
  const j = (await meta.json()) as { sha: string; content?: string; encoding?: string }
  if (j.encoding === 'base64' && j.content) return { sha: j.sha, bytes: b64ToBytes(j.content.replace(/\n/g, '')) }
  // files over 1 MB come back without content; fetch raw
  const raw = await api(cfg, `${path}?ref=${cfg.branch}`, {}, 'application/vnd.github.raw+json')
  if (!raw) return null
  return { sha: j.sha, bytes: new Uint8Array(await raw.arrayBuffer()) }
}

export async function ghPut(cfg: GhConfig, path: string, bytes: Uint8Array, message: string, sha?: string): Promise<string> {
  const res = await api(cfg, path, {
    method: 'PUT',
    body: JSON.stringify({ message, content: bytesToB64(bytes), branch: cfg.branch, ...(sha ? { sha } : {}) }),
  })
  if (!res) throw new GhError(404, 'Repo ili grana ne postoji')
  const j = (await res.json()) as { content: { sha: string } }
  return j.content.sha
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function dataUrlToBytes(url: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url)
  if (!m) throw new Error('Nije data URL')
  return { mime: m[1], bytes: b64ToBytes(m[2]) }
}

export function bytesToDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToB64(bytes)}`
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
