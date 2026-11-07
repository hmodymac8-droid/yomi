import { useState } from 'react'
import { Icon } from './Icon'

/** Dark is the default; the choice is kept under "yomi-theme" (index.html applies it before the first paint). */
export function ThemeToggle(): React.JSX.Element {
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'))
  const flip = (): void => {
    const next = light ? 'dark' : 'light'
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(next)
    try {
      localStorage.setItem('yomi-theme', next)
    } catch {
      /* the choice just won't stick */
    }
    setLight(!light)
  }
  return (
    <button className="iconbtn" onClick={flip} title={light ? 'Dark theme' : 'Light theme'} aria-label="Switch theme">
      <Icon name={light ? 'moon' : 'sun'} />
    </button>
  )
}
