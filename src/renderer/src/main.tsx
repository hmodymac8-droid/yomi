import '@fontsource-variable/dm-sans'
import '@fontsource-variable/newsreader/opsz.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MiniApp from './MiniApp'

const mini =
  window.api.isMini || new URLSearchParams(window.location.search).get('mini') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{mini ? <MiniApp /> : <App />}</StrictMode>
)
