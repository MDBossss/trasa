import { useEffect, useState } from 'react'
import { loadGhConfig, saveGhConfig, type GhConfig } from '../github'
import { listRemoteProjects, openRemote, saveRemote, slugify } from '../remote'
import { useStore } from '../store'

export function GitHubPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<GhConfig>(() => loadGhConfig() ?? { token: '', repo: '', branch: 'main' })
  const [connected, setConnected] = useState(!!loadGhConfig())
  const [projects, setProjects] = useState<string[] | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const name = useStore((s) => s.project.name)
  const dirty = useStore((s) => s.dirty)

  const refresh = async (c: GhConfig) => {
    setError('')
    try {
      setProjects(await listRemoteProjects(c))
    } catch (e) {
      setError(String((e as Error).message))
      setProjects(null)
    }
  }

  useEffect(() => { if (connected) void refresh(cfg) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = () => {
    const c = { ...cfg, repo: cfg.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''), token: cfg.token.trim() }
    saveGhConfig(c)
    setCfg(c)
    setConnected(true)
    void refresh(c)
  }

  const run = async (fn: () => Promise<void>) => {
    setError('')
    try {
      await fn()
      await refresh(cfg)
    } catch (e) {
      setStatus('')
      setError(String((e as Error).message))
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>GitHub projekti</h3><button className="mini" onClick={onClose}>✕</button></div>
        {!connected ? (
          <div className="form">
            <p className="muted">Projekti se spremaju u tvoj (privatni) repo pa ih otvoriš s bilo kojeg uređaja. Treba fine-grained token s pravom <b>Contents: Read and write</b> samo za taj repo.</p>
            <label>Repo <input placeholder="mislavvv/trasa-projects" value={cfg.repo} onChange={(e) => setCfg({ ...cfg, repo: e.target.value })} /></label>
            <label>Grana <input value={cfg.branch} onChange={(e) => setCfg({ ...cfg, branch: e.target.value })} /></label>
            <label>Token <input type="password" placeholder="github_pat_…" value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} /></label>
            <button onClick={connect} disabled={!cfg.repo || !cfg.token}>Poveži</button>
          </div>
        ) : (
          <>
            <div className="row">
              <span className="muted">{cfg.repo} @ {cfg.branch}</span>
              <button className="mini" onClick={() => { saveGhConfig(null); setConnected(false); setProjects(null) }}>Odspoji</button>
            </div>
            <div className="form">
              <button onClick={() => void run(() => saveRemote(cfg, setStatus))} disabled={!!status}>
                Spremi "{name}" u repo {dirty ? '•' : ''} <span className="muted">→ projects/{slugify(name)}</span>
              </button>
            </div>
            <h4>Projekti u repou</h4>
            {projects === null && !error && <p className="muted">Učitavam…</p>}
            {projects?.length === 0 && <p className="muted">Još nema projekata.</p>}
            <ul className="list">
              {projects?.map((slug) => (
                <li key={slug}>
                  <span className="name">{slug}</span>
                  <button className="mini" disabled={!!status} onClick={() => void run(async () => { await openRemote(cfg, slug, setStatus); onClose() })}>Otvori</button>
                </li>
              ))}
            </ul>
            {status && <p className="status">{status}</p>}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
