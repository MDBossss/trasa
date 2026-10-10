import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  import('./store').then((m) => ((window as unknown as { __trasa: unknown }).__trasa = m.useStore))
  import('./images').then((m) => ((window as unknown as { __trasaDetect: unknown }).__trasaDetect = m.detectSkew))
}
