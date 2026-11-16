import { useEffect, useRef, useState } from 'react'

const MIN = 1.2
const MAX = 5
const START = 2.2
const W = 340
const H = 240

interface Spot {
  src: string
  x: number
  y: number
  /** where the pointer is on the page picture, in screen pixels from its top-left corner */
  px: number
  py: number
  w: number
  h: number
}

/**
 * A magnifying glass: a window that follows the pointer and shows the page under it bigger. The reader underneath keeps
 * scrolling as usual. + / - (or Ctrl + scroll on the glass) change the strength; Z or Esc put it away.
 */
export default function ZoomLens({
  root,
  start,
  filter,
  onClose
}: {
  root: HTMLElement
  start: { x: number; y: number }
  filter?: string
  onClose: () => void
}): React.JSX.Element | null {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [mag, setMag] = useState(START)
  const pos = useRef(start)

  useEffect(() => {
    let raf = 0
    const update = (): void => {
      raf = 0
      const { x, y } = pos.current
      const img = document
        .elementsFromPoint(x, y)
        .find(
          (el) =>
            el instanceof HTMLImageElement && el.classList.contains('page') && root.contains(el)
        ) as HTMLImageElement | undefined
      if (!img || !img.complete || img.naturalWidth === 0) return setSpot(null)
      const r = img.getBoundingClientRect()
      setSpot({
        src: img.currentSrc || img.src,
        x,
        y,
        px: x - r.left,
        py: y - r.top,
        w: r.width,
        h: r.height
      })
    }
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    const onMove = (e: MouseEvent): void => {
      pos.current = { x: e.clientX, y: e.clientY }
      schedule()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        e.stopPropagation()
        return onClose()
      }
      if (e.key === '+' || e.key === '=') setMag((m) => Math.min(MAX, m * 1.2))
      else if (e.key === '-' || e.key === '_') setMag((m) => Math.max(MIN, m / 1.2))
      else if (e.key === '0') setMag(START)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('scroll', schedule, true) // the page moves under a still pointer
    window.addEventListener('wheel', schedule, { passive: true })
    // Shift + scroll changes the strength (plain scroll still moves the page)
    const onWheelZoom = (e: WheelEvent): void => {
      if (!e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      const d = e.deltaY || e.deltaX
      setMag((m) => Math.max(MIN, Math.min(MAX, m * Math.exp(-d * 0.002))))
    }
    window.addEventListener('wheel', onWheelZoom, { passive: false, capture: true })
    window.addEventListener('keydown', onKey, true)
    schedule()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('wheel', schedule)
      window.removeEventListener('wheel', onWheelZoom, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [root, onClose])

  const out = (m: number): void => setMag(Math.max(MIN, Math.min(MAX, m)))
  const panel = (
    <div className="zlctl">
      <button onClick={() => out(mag / 1.2)} disabled={mag <= MIN} title="Zoom out (-)">
        −
      </button>
      <b>{Math.round(mag * 100)}%</b>
      <button onClick={() => out(mag * 1.2)} disabled={mag >= MAX} title="Zoom in (+)">
        +
      </button>
      <button onClick={onClose} title="Close (Esc)">
        ✕
      </button>
    </div>
  )
  if (!spot) return panel
  // keep the glass on screen: it sits on the pointer, but slides back near the edges
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, spot.x - W / 2))
  const top = Math.max(8, Math.min(window.innerHeight - H - 8, spot.y - H / 2))
  // the spot of the picture under the pointer is shown at the pointer, so it lines up with what you point at
  const bx = -(spot.px * mag - (spot.x - left))
  const by = -(spot.py * mag - (spot.y - top))
  return (
    <>
      {panel}
      <div className="zoomlens" style={{ left, top, width: W, height: H }}>
        <div
          className="zlimg"
          style={{
            backgroundImage: `url("${spot.src}")`,
            backgroundSize: `${spot.w * mag}px ${spot.h * mag}px`,
            backgroundPosition: `${bx}px ${by}px`,
            ['--pagefilter' as string]: filter ?? 'none'
          }}
        />
      </div>
    </>
  )
}
