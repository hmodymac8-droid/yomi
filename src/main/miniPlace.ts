import { app, screen } from 'electron'
import { join } from 'path'
import { readJson, writeAtomic } from './safefile'

/** Where the mini reader was, how big, and whether it stayed on top (mini-window.json). */
export interface MiniPlace {
  x?: number
  y?: number
  width: number
  height: number
  onTop: boolean
}

const file = (): string => join(app.getPath('userData'), 'mini-window.json')

export function loadMiniPlace(): MiniPlace {
  const p = readJson<Partial<MiniPlace>>(file(), 2)
  const place: MiniPlace = {
    width: Math.max(280, Math.min(2400, Math.round(p?.width ?? 420))),
    height: Math.max(420, Math.min(2400, Math.round(p?.height ?? 760))),
    onTop: p?.onTop ?? true,
    x: typeof p?.x === 'number' ? Math.round(p.x) : undefined,
    y: typeof p?.y === 'number' ? Math.round(p.y) : undefined
  }
  // a saved place that is no longer on any screen (a monitor was unplugged) is forgotten
  if (place.x !== undefined && place.y !== undefined) {
    const { x, y } = place
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return x + 80 > a.x && x < a.x + a.width - 80 && y >= a.y - 10 && y < a.y + a.height - 60
    })
    if (!onScreen) place.x = place.y = undefined
  }
  return place
}

export function saveMiniPlace(
  b: { x: number; y: number; width: number; height: number },
  onTop: boolean
): void {
  try {
    writeAtomic(file(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, onTop }))
  } catch {
    /* not critical: it opens at the default size next time */
  }
}
