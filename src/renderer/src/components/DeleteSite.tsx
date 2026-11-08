import { useEffect } from 'react'
import type { SourceInfo } from '../../../preload/index.d'

/**
 * Asks before a site is deleted: "Delete site" or "Keep it". Deleting removes the site and its saved title list from
 * Yomi; your reading progress, follows and downloaded chapters are not touched, and the site can be added again.
 */
export default function DeleteSite({
  site,
  onDelete,
  onKeep
}: {
  site: SourceInfo
  onDelete: () => void
  onKeep: () => void
}): React.JSX.Element {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onKeep()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onKeep])

  return (
    <div className="modalback" onClick={onKeep}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="delsite-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="delsite-title">Delete {site.name}?</h2>
        <p>
          Yomi removes this site and its {site.count.toLocaleString()} saved {site.count === 1 ? 'title' : 'titles'}. Your
          reading progress, the series you follow and your downloaded chapters stay. You can add the site again later.
        </p>
        {site.library && (
          <p className="sub">
            This site came from the Yomi Library. To take every Library site off your screens without deleting anything, turn
            off &quot;Show the Yomi Library&quot; in Settings.
          </p>
        )}
        <div className="modalact">
          <button className="primary" autoFocus onClick={onKeep}>
            Keep it
          </button>
          <button className="mini danger big" onClick={onDelete}>
            Delete site
          </button>
        </div>
      </div>
    </div>
  )
}
