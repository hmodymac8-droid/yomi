import '@fontsource-variable/dm-sans'
import '@fontsource-variable/newsreader/opsz.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MiniApp from './MiniApp'

const mini =
  window.api.isMini || new URLSearchParams(window.location.search).get('mini') === '1'

// While a page scrolls, the cards under the mouse stop reacting to it (hover lift, cover zoom, title prefetch):
// each card passing the cursor otherwise restyles and repaints mid-scroll, which makes scrolling feel rough.
let scrollIdle = 0
window.addEventListener(
  'scroll',
  () => {
    document.documentElement.classList.add('scrolling')
    window.clearTimeout(scrollIdle)
    scrollIdle = window.setTimeout(() => document.documentElement.classList.remove('scrolling'), 150)
  },
  { capture: true, passive: true }
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{mini ? <MiniApp /> : <App />}</StrictMode>
)
