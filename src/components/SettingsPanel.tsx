import { useStore } from '../store'
import { spareCoresOf, type SpareCores } from '../types'

// Project settings travel with the save file, so the electrician's sheets come out the same on every machine.
const SPARE: { id: SpareCores; label: string; desc: string; tag?: string }[] = [
  { id: 'cap', label: 'Presavij i izoliraj', desc: 'Rezervna žila se presavije i dobije kapicu ili izolir traku. Bez stezaljke, kutija je preglednija. U materijalu se broje kapice.', tag: 'preporučeno' },
  { id: 'wago', label: 'Svaka u svoj WAGO', desc: 'Rezervna žila ide u prazan WAGO 221-412 ("parkirano"). Tako je radilo do sada; stariji projekti bez ove postavke ostaju na tome.' },
]

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)
  const { patchProject } = useStore.getState()
  const spare = spareCoresOf(project)
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
        <p className="muted">PE (žuto-zelena) iz kabela za prekidač uvijek ide na zajednički PE u kutiji, to nije rezerva: zaštitni vodič se u razvodu ne ostavlja slobodan.</p>
      </div>
    </div>
  )
}
