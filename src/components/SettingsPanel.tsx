import { useStore } from '../store'
import { POWER_TYPES, cableShort, cableStockOf, rulesOf, spareCoresOf, type CableRules, type SpareCores } from '../types'

// Project settings travel with the save file, so the electrician's sheets come out the same on every machine.
const RULES: { id: keyof CableRules; label: string; desc: string }[] = [
  { id: 'feed25', label: 'Dolazi 2,5 mm²', desc: 'Svaki kabel koji dolazi iz ormara (bužir kategorije Dolaz) mora biti 3×2,5.' },
  { id: 'socket25', label: 'Krug s utičnicama 2,5 mm²', desc: 'Utičnice su na B16, pa kabeli kroz koje teče struja do utičnica moraju biti 2,5 mm² (od dolaza do svake utičnice). Grane samo prema svjetlima i prekidačima smiju ostati 1,5. Iznimka su spavaće sobe (kvačica na sobi).' },
  { id: 'blueReturn', label: 'Plava u drugom kabelu kao povratna', desc: 'Drugi kabel u paru nema svoju nulu, pa plava smije nositi povratnu (HD 60364-5-51, 514.3.1), označena smeđom ili crnom trakom na oba kraja.' },
  { id: 'gnyeReturn', label: 'Žuto-zelena u drugom kabelu kao povratna', desc: 'Kad ni plava ne dosta, i žuto-zelena u drugom kabelu nosi povratnu, označena trakom na oba kraja; PE i dalje dolazi prvim kabelom.' },
  { id: 'flow', label: 'Presjek ne raste prema trošilu', desc: 'Javlja kad iza tanjeg kabela ide deblji, npr. 2,5 nakon 1,5: osigurač štiti tanji, deblji ne daje ništa.' },
]

const SPARE: { id: SpareCores; label: string; desc: string; tag?: string }[] = [
  { id: 'cap', label: 'Presavij i izoliraj', desc: 'Rezervna žila se presavije i dobije kapicu ili izolir traku. Bez stezaljke, kutija je preglednija. U materijalu se broje kapice.', tag: 'preporučeno' },
  { id: 'wago', label: 'Svaka u svoj WAGO', desc: 'Rezervna žila ide u prazan WAGO 221-412 ("parkirano"). Tako je radilo do sada; stariji projekti bez ove postavke ostaju na tome.' },
]

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)
  const { patchProject } = useStore.getState()
  const spare = spareCoresOf(project)
  const stock = cableStockOf(project), rules = rulesOf(project)
  const toggleStock = (t: string) => patchProject({ cableStock: stock.includes(t) ? stock.filter((x) => x !== t) : POWER_TYPES.filter((x) => x === t || stock.includes(x)) })
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Postavke projekta">
        <div className="modal-head"><h3>Postavke projekta</h3><button className="mini" onClick={onClose}>✕</button></div>
        <p className="muted">Vrijede za ovaj projekt i spremaju se s njim. Spojevi, koraci i materijal se odmah preračunaju.</p>
        <h4>Rezervne žile u kutiji</h4>
        <div className="choice" role="radiogroup" aria-label="Rezervne žile u kutiji">
          {SPARE.map((o) => (
            <label key={o.id} className={`choice-item ${spare === o.id ? 'on' : ''}`}>
              <input type="radio" name="spare" value={o.id} checked={spare === o.id} onChange={() => patchProject({ spareCores: o.id })} />
              <span>
                <b>{o.label}{o.tag && <em className="badge ok">{o.tag}</em>}</b>
                <small>{o.desc}</small>
              </span>
            </label>
          ))}
        </div>
        <h4>Kabeli koje koristim</h4>
        <p className="muted">Prijedlozi i popravci biraju samo ove. Kad treba više žila nego što ima najdeblji, predlaže se drugi kabel paralelno (npr. 5×1,5 + 3×1,5).</p>
        <div className="stock" role="group" aria-label="Kabeli koje koristim">
          {POWER_TYPES.map((t) => (
            <label key={t} className="inline"><input type="checkbox" checked={stock.includes(t)} onChange={() => toggleStock(t)} />{t.startsWith('NYM-O') ? 'NYM-O ' : ''}{cableShort(t)}</label>
          ))}
        </div>
        <h4>Pravila za presjek</h4>
        <div className="choice" role="group" aria-label="Pravila za presjek">
          {RULES.map((r) => (
            <label key={r.id} className={`choice-item ${rules[r.id] ? 'on' : ''}`}>
              <input type="checkbox" checked={rules[r.id]} onChange={() => patchProject({ rules: { ...project.rules, [r.id]: !rules[r.id] } })} />
              <span><b>{r.label}</b><small>{r.desc}</small></span>
            </label>
          ))}
        </div>
        <p className="muted">PE (žuto-zelena) iz kabela za prekidač uvijek ide na zajednički PE u kutiji, to nije rezerva: zaštitni vodič se u razvodu ne ostavlja slobodan.</p>
      </div>
    </div>
  )
}
