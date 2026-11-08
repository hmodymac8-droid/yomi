import { useEffect, useState } from 'react'
import type { AppSettings, SourceInfo } from '../../../preload/index.d'

/** The Settings screen. For now: the Yomi Library (ready-made sites from your Yomi account), shown or hidden. */
export default function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sources, setSources] = useState<SourceInfo[]>([])

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    void window.api.listSources().then(setSources)
  }, [])

  const library = sources.filter((s) => s.library)
  const titles = library.reduce((n, s) => n + s.count, 0)

  const toggle = async (): Promise<void> => {
    if (!settings) return
    setSettings(await window.api.setSettings({ showLibrary: !settings.showLibrary }))
    setSources(await window.api.listSources())
  }

  return (
    <div className="series">
      <div className="pagehead">
        <div>
          <div className="kicker">設定</div>
          <h1>Settings</h1>
          <p>How Yomi looks and what it shows you.</p>
        </div>
      </div>

      <section className="setting">
        <div className="settext">
          <h2>Yomi Library</h2>
          <p>
            Ready-made sites that come with your Yomi account: their titles and genres are already loaded, so you can search
            and read straight away. Sites you add yourself are always shown.
          </p>
          <p className="sub">
            {library.length > 0
              ? `${library.length} Library ${library.length === 1 ? 'site' : 'sites'} · ${titles.toLocaleString()} titles on this computer.`
              : 'No Library sites on this computer yet. They arrive when you sign in to your Yomi account.'}{' '}
            Hiding them keeps everything saved; turn this back on to see them again.
          </p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings?.showLibrary ?? true} disabled={!settings} onChange={() => void toggle()} />
          <span className="track" aria-hidden="true" />
          <span>Show the Yomi Library</span>
        </label>
      </section>
    </div>
  )
}
