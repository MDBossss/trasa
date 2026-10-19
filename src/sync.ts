import { loadGhConfig } from './github'
import { saveRemote, slugify } from './remote'
import { useStore } from './store'

// The project remembers where it lives: "gh:<slug>" means Cmd+S and the Spremi button go to GitHub.
export const linkedSlug = () => { const f = useStore.getState().fileName; return f?.startsWith('gh:') ? f.slice(3) : null }
export const ghConnected = () => { const c = loadGhConfig(); return !!c && (!!c.token || !!c.auth) }

export async function saveToGitHub() {
  const cfg = loadGhConfig()
  if (!cfg) throw new Error('GitHub nije povezan')
  const set = (p: Partial<ReturnType<typeof useStore.getState>['sync']>) => useStore.setState((s) => ({ sync: { ...s.sync, ...p } }))
  set({ busy: true, text: 'Spremam na GitHub…', error: null })
  try {
    await saveRemote(cfg, (t) => set({ text: t || 'Spremam na GitHub…' }))
    set({ busy: false, text: '', at: Date.now() })
  } catch (e) {
    set({ busy: false, text: '', error: String((e as Error).message) })
    throw e
  }
}
export const currentSlug = () => slugify(useStore.getState().project.name)
