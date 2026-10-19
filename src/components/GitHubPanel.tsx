import { useEffect, useMemo, useState } from 'react'
import { appInstallUrl, loadGhConfig, saveGhConfig, startLogin, type GhConfig } from '../github'
import { listRemoteProjects, openRemote, slugify } from '../remote'
import { useStore } from '../store'
import { saveToGitHub } from '../sync'
import { Icon } from './Icons'
import { kbd } from '../keys'

const DEFAULT: GhConfig = { token: '', repo: 'mdbossss/trasa', branch: 'main', passphrase: '' }
const cleanRepo = (r: string) => r.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'upravo' : s < 3600 ? `prije ${Math.round(s / 60)} min` : new Date(t).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' }) }

export function GitHubPanel({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<GhConfig>(() => { const c = loadGhConfig(); return c ? { ...c, passphrase: c.passphrase ?? '' } : DEFAULT })
  const [connected, setConnected] = useState(() => { const c = loadGhConfig(); return !!c && (!!c.token || !!c.auth) })
  const [advanced, setAdvanced] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [editPass, setEditPass] = useState(false)
  const [projects, setProjects] = useState<string[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [confirmOpen, setConfirmOpen] = useState<string | null>(null)
  const name = useStore((s) => s.project.name)
  const dirty = useStore((s) => s.dirty)
  const fileName = useStore((s) => s.fileName)
  const sync = useStore((s) => s.sync)
  const slug = slugify(name)
  const linked = fileName === `gh:${slug}`
  const working = !!busy || sync.busy

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])

  const refresh = async (c: GhConfig) => {
    setError('')
    try { setProjects(await listRemoteProjects(c)) } catch (e) { setError(String((e as Error).message)); setProjects(null) }
  }
  useEffect(() => { if (connected) void refresh(cfg) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = async (e: unknown) => {
    const msg = String((e as Error).message)
    setError(msg)
    if (msg.includes('nije instaliran')) setInstallUrl(await appInstallUrl())
  }
  const save = async () => {
    setError('')
    try { await saveToGitHub(); await refresh(cfg) } catch (e) { await fail(e) }
  }
  const open = async (s: string) => {
    setError(''); setConfirmOpen(null)
    try { await openRemote(cfg, s, setBusy); onClose() } catch (e) { setBusy(''); await fail(e) }
  }
  const updateCfg = (c: GhConfig) => { setCfg(c); if (connected) saveGhConfig(c) }
  const login = () => { saveGhConfig({ ...cfg, repo: cleanRepo(cfg.repo), token: '', auth: null }); startLogin() }
  const connectToken = () => { const c = { ...cfg, repo: cleanRepo(cfg.repo), token: cfg.token.trim() }; saveGhConfig(c); setCfg(c); setConnected(true); void refresh(c) }
  const logout = () => { const c = { ...cfg, token: '', auth: null }; saveGhConfig(c); setCfg(c); setConnected(false); setProjects(null) }

  const shown = useMemo(() => (projects ?? []).filter((p) => !query.trim() || p.includes(slugify(query))).sort((a, b) => (a === slug ? -1 : b === slug ? 1 : a.localeCompare(b))), [projects, query, slug])
  const encrypted = !!cfg.passphrase

  const passField = (
    <div className="gh-field">
      <span className="gh-label">Lozinka šifriranja</span>
      <div className="gh-input-row">
        <input type={showPass ? 'text' : 'password'} placeholder="obavezno ako je repo javan" value={cfg.passphrase} onChange={(e) => updateCfg({ ...cfg, passphrase: e.target.value })} autoComplete="new-password" />
        <button className="icon-btn" type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? 'Sakrij lozinku' : 'Prikaži lozinku'} title={showPass ? 'Sakrij' : 'Prikaži'}>{showPass ? <Icon.eyeOff /> : <Icon.eye />}</button>
      </div>
      <span className="gh-help">Šifrira se na ovom uređaju (AES-GCM) prije slanja. Istu lozinku upišeš na svakom uređaju; bez nje se projekt ne može otvoriti.</span>
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gh" role="dialog" aria-modal="true" aria-labelledby="gh-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head gh-head">
          <div className="gh-mark"><Icon.github width={20} height={20} /></div>
          <div className="gh-titles">
            <h3 id="gh-title">GitHub projekti</h3>
            <span className="muted">{connected ? `${cfg.repo} · ${cfg.branch}` : 'Spremi projekt u svoj repo i otvori ga s bilo kojeg uređaja'}</span>
          </div>
          <button className="icon-btn gh-close" onClick={onClose} aria-label="Zatvori" title="Zatvori (Esc)"><Icon.x /></button>
        </div>

        {!connected ? (
          <div className="gh-body">
            <div className="gh-field">
              <span className="gh-label">Repozitorij</span>
              <div className="gh-prefixed"><span>github.com/</span><input placeholder="mdbossss/trasa" value={cfg.repo} onChange={(e) => setCfg({ ...cfg, repo: e.target.value })} /></div>
            </div>
            {passField}
            {!encrypted && <div className="gh-callout warn"><Icon.alert /><span>Bez lozinke tlocrt i fotke zidova idu u repo <b>nešifrirani</b>. Ako je repo javan, svatko ih može vidjeti.</span></div>}
            <button className="primary gh-cta" onClick={login} disabled={!cleanRepo(cfg.repo)}><Icon.github /> Prijavi se GitHubom</button>
            <button className="gh-disclosure" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}><Icon.chevron className={advanced ? 'open' : ''} /> Napredno</button>
            {advanced && (
              <div className="gh-advanced">
                <div className="gh-field"><span className="gh-label">Grana</span><input value={cfg.branch} onChange={(e) => setCfg({ ...cfg, branch: e.target.value })} /></div>
                <div className="gh-field">
                  <span className="gh-label">Ručni token</span>
                  <input type="password" placeholder="github_pat_…" value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
                  <span className="gh-help">Fine-grained token s pravom <b>Contents: Read and write</b> za taj repo.</span>
                </div>
                <button onClick={connectToken} disabled={!cleanRepo(cfg.repo) || !cfg.token.trim()}>Poveži tokenom</button>
              </div>
            )}
          </div>
        ) : (
          <div className="gh-body">
            <div className="gh-chips">
              <span className="chip ok"><span className="dot" />{cfg.auth ? 'GitHub prijava' : 'Token'}</span>
              <button className={`chip ${encrypted ? 'ok' : 'warn'}`} onClick={() => setEditPass((v) => !v)} title="Promijeni lozinku šifriranja">
                {encrypted ? <Icon.lock width={13} height={13} /> : <Icon.unlock width={13} height={13} />}{encrypted ? 'Šifrirano' : 'Nešifrirano'}
              </button>
              <span className="spacer" />
              <button className="gh-link" onClick={logout}><Icon.logout width={14} height={14} /> Odjavi</button>
            </div>
            {(editPass || !encrypted) && (
              <div className={`gh-callout ${encrypted ? '' : 'warn'}`}>
                {!encrypted && <Icon.alert />}
                <div className="gh-callout-body">
                  {!encrypted && <span>Projekti se spremaju <b>nešifrirani</b>. Postavi lozinku pa spremi ponovno; stare datoteke ostaju u povijesti repoa.</span>}
                  {passField}
                </div>
              </div>
            )}

            <section className="gh-card">
              <div className="gh-card-main">
                <div className="gh-card-title">{name || 'Bez naziva'}</div>
                <div className="gh-card-sub"><code>projects/{slug}/</code></div>
                <div className={`gh-state ${sync.error ? 'err' : dirty || !linked ? 'warn' : 'ok'}`}>
                  {sync.busy ? <><span className="spinner" />{sync.text}</>
                    : sync.error ? <><Icon.alert width={14} height={14} />Spremanje nije uspjelo</>
                    : !linked && projects?.includes(slug) ? 'Na GitHubu postoji, spremi da se poveže'
                    : !linked ? 'Još nije spremljen na GitHub'
                    : dirty ? 'Nespremljene promjene'
                    : <><Icon.check width={14} height={14} />Spremljeno{sync.at ? ` · ${ago(sync.at)}` : ''}</>}
                </div>
              </div>
              <button className="primary" onClick={() => void save()} disabled={working}>
                <Icon.cloud /> {linked ? 'Spremi' : 'Spremi na GitHub'}{linked && <kbd className="btn-kbd">{kbd('S')}</kbd>}
              </button>
            </section>
            {sync.busy && <div className="gh-progress"><span /></div>}
            {linked && <span className="gh-help">Projekt je vezan uz GitHub: <kbd>{kbd('S')}</kbd> i gumb Spremi u zaglavlju spremaju ovdje, a "Spremi kao datoteku…" ({kbd('S', true)}) sprema lokalno.</span>}
            {!linked && <span className="gh-help">Nakon prvog spremanja projekt ostaje vezan uz GitHub, pa ga dalje spremaš s <kbd>{kbd('S')}</kbd>.</span>}

            <div className="gh-list-head">
              <h4>Projekti u repou {projects && <span className="count">{projects.length}</span>}</h4>
              {(projects?.length ?? 0) > 5 && (
                <label className="gh-search"><Icon.search width={14} height={14} /><input placeholder="Traži" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Traži projekt" /></label>
              )}
            </div>
            {projects === null && !error && <div className="gh-skeleton"><span /><span /><span /></div>}
            {projects?.length === 0 && <div className="gh-empty"><Icon.folder width={22} height={22} /><span>Još nema projekata. Spremi ovaj i pojavit će se ovdje.</span></div>}
            {projects && projects.length > 0 && (
              <ul className="gh-list">
                {shown.map((p) => (
                  <li key={p} className={p === slug ? 'current' : ''}>
                    <Icon.folder width={16} height={16} />
                    <span className="name">{p}</span>
                    {p === slug && <span className="badge">ovaj projekt</span>}
                    <span className="spacer" />
                    {confirmOpen === p ? (
                      <span className="gh-confirm">
                        <span className="muted" title="Nespremljene promjene trenutnog projekta će se izgubiti">Odbaciti promjene?</span>
                        <button className="mini" onClick={() => setConfirmOpen(null)}>Odustani</button>
                        <button className="mini danger" onClick={() => void open(p)}>Otvori svejedno</button>
                      </span>
                    ) : (
                      <button className="mini" disabled={working} onClick={() => (dirty ? setConfirmOpen(p) : void open(p))}>Otvori</button>
                    )}
                  </li>
                ))}
                {shown.length === 0 && <li className="muted">Nema projekta "{query}".</li>}
              </ul>
            )}
            {busy && <div className="gh-state"><span className="spinner" />{busy}</div>}
          </div>
        )}

        {(error || sync.error) && (
          <div className="gh-callout err" role="alert">
            <Icon.alert />
            <div className="gh-callout-body">
              <span>{error || sync.error}</span>
              <span className="gh-actions">
                {/istekla|401|Bad credentials/.test(error || sync.error || '') && connected && <button className="mini" onClick={startLogin}>Prijavi se ponovno</button>}
                {installUrl && <a className="mini-link" href={installUrl} target="_blank" rel="noreferrer">Instaliraj app na repo</a>}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
