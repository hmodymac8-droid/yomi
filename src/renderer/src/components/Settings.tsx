import { useEffect, useState } from 'react'
import type { AniListImportResult, AniListStatus, AppSettings, AppUpdateState, SourceInfo } from '../../../preload/index.d'

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
            Ready-made sites that come with your Yomi account: their titles and genres are already
            loaded, so you can search and read straight away. Sites you add yourself are always
            shown.
          </p>
          <p className="sub">
            {library.length > 0
              ? `${library.length} Library ${library.length === 1 ? 'site' : 'sites'} · ${titles.toLocaleString()} titles on this computer.`
              : 'No Library sites on this computer yet. They arrive when you sign in to your Yomi account.'}{' '}
            Hiding them keeps everything saved; turn this back on to see them again.
          </p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings?.showLibrary ?? true}
            disabled={!settings}
            onChange={() => void toggle()}
          />
          <span className="track" aria-hidden="true" />
          <span>Show the Yomi Library</span>
        </label>
      </section>

      <AutoDownloadSetting />
      <TrackingSetting />
      <AppUpdateSetting />
    </div>
  )
}

/** Yomi's own updates: the version you have, a "Check for updates" button and what the check found. */
function AppUpdateSetting(): React.JSX.Element {
  const [s, setS] = useState<AppUpdateState | null>(null)
  useEffect(() => {
    void window.api.appUpdateState().then(setS)
    return window.api.onAppUpdateState(setS)
  }, [])

  const when = s?.checkedAt
    ? new Date(s.checkedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : null
  let line = 'Yomi looks for updates when it starts and every few hours.'
  if (s?.state === 'checking') line = 'Looking for a newer version…'
  else if (s?.state === 'none') line = `You have the newest version.${when ? ` Last checked ${when}.` : ''}`
  else if (s?.state === 'downloading')
    line = `Downloading Yomi ${s.version}… ${s.percent}%`
  else if (s?.state === 'ready') line = `Yomi ${s.version} is downloaded and ready to install.`
  else if (s?.state === 'error') line = `Couldn't check for updates: ${s.error}`
  else if (s?.state === 'dev') line = 'Updates are only checked in the installed app.'

  const busy = s?.state === 'checking' || s?.state === 'downloading'
  return (
    <section className="setting">
      <div className="settext">
        <h2>Updates</h2>
        <p>
          New versions download by themselves in the background. When one is ready you can restart
          now to install it, or it installs the next time you close Yomi. Your library and settings
          are kept.
        </p>
        <p className="sub">
          {s ? `Version ${s.current}. ` : ''}
          {line}
        </p>
        {s?.state === 'downloading' && (
          <div className="updbar" aria-hidden="true">
            <span style={{ width: `${s.percent}%` }} />
          </div>
        )}
      </div>
      {s?.state === 'ready' ? (
        <button className="primary" onClick={() => void window.api.updateInstall()}>
          Restart and update
        </button>
      ) : (
        <button
          className="primary"
          disabled={!s || busy || s.state === 'dev'}
          onClick={() => void window.api.appUpdateCheck().then(setS)}
        >
          {s?.state === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      )}
    </section>
  )
}

/** Download new chapters of followed series by themselves (each series can still be switched on its own card). */
function AutoDownloadSetting(): React.JSX.Element {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    void window.api.updatesStatus().then((s) => setOn(s.autoDownload))
    return window.api.onUpdates((s) => setOn(s.autoDownload))
  }, [])
  return (
    <section className="setting">
      <div className="settext">
        <h2>Auto-download new chapters</h2>
        <p>
          When a series you follow gets a new chapter, Yomi downloads it for you so it is ready to
          read, even offline. You can also turn this on or off for each series on its card in
          Following.
        </p>
      </div>
      <label className="switch">
        <input
          type="checkbox"
          checked={on ?? false}
          disabled={on === null}
          onChange={(e) => {
            setOn(e.target.checked)
            void window.api.updatesSetAutoDownload(e.target.checked)
          }}
        />
        <span className="track" aria-hidden="true" />
        <span>For all followed series</span>
      </label>
    </section>
  )
}

/** Opt-in AniList tracking: off until you add a client ID and connect an account. */
function TrackingSetting(): React.JSX.Element {
  const [s, setS] = useState<AniListStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [imported, setImported] = useState<AniListImportResult | null>(null)

  useEffect(() => {
    void window.api.anilistStatus().then((st) => {
      setS(st)
      setClientId(st.clientId)
    })
  }, [])

  const saveId = async (id: string): Promise<AniListStatus> => {
    const next = await window.api.anilistSetClientId(id.trim())
    setS(next)
    setClientId(next.clientId)
    return next
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setImported(null)
    try {
      await saveId(clientId)
      setS(await window.api.anilistConnect())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setS(await window.api.anilistDisconnect())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setImported(null)
    try {
      setImported(await window.api.anilistImport())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const connected = s?.connected ?? false
  return (
    <section className="setting">
      <div className="settext">
        <h2>Tracking</h2>
        <p>
          Connect AniList to update your reading progress when you finish a chapter. This stays off
          until you add a client ID and sign in. Linked series, and how to register a client, are
          explained in the README.
        </p>
        <p className="sub">
          {connected
            ? `Connected${s?.name ? ` as ${s.name}` : ''}.`
            : s?.hasClientId
              ? 'Client ID saved. Press Connect AniList to sign in.'
              : 'No client ID yet. Register an AniList API client and paste the ID below.'}
        </p>
        <label className="setfieldwrap">
          <span>Client ID</span>
          <input
            className="setfield"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={clientId}
            disabled={busy}
            placeholder="AniList client ID"
            onChange={(e) => setClientId(e.target.value)}
            onBlur={() => {
              if (clientId.trim() !== (s?.clientId ?? '')) void saveId(clientId)
            }}
          />
        </label>
        {error && <p className="sub">{error}</p>}
        {imported && (
          <p className="sub">
            Import finished: {imported.updated} updated, {imported.skipped} already ahead or equal,{' '}
            {imported.failed} failed. Local progress never moved backward.
          </p>
        )}
      </div>
      <div className="settingcol">
        {connected ? (
          <button className="primary" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </button>
        ) : (
          <button className="primary" disabled={busy || !clientId.trim()} onClick={() => void connect()}>
            {busy ? 'Connecting…' : 'Connect AniList'}
          </button>
        )}
        {connected && (
          <button className="mini" disabled={busy} onClick={() => void doImport()}>
            Import progress from AniList
          </button>
        )}
      </div>
    </section>
  )
}
