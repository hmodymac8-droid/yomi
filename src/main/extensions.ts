import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { addSource, getSource, removeSource, sourceForHost, sourceDefs, updateSource } from './catalog'
import {
  compareVersions,
  isSafeExtensionId,
  parseManifestJson,
  parseRepoIndexJson,
  sha256Hex,
  sourceDefFromManifest,
  verifySha256,
  type ExtensionManifest,
  type RepoIndex
} from './extensionLogic'
import { runExtensionScript } from './extensionSandbox'
import { getSettings, setSettings } from './settings'
import type { SourceDef } from '../preload/index.d'

export interface InstalledExtension {
  id: string
  name: string
  version: string
  lang: 'ar' | 'en' | 'other'
  description?: string
  file: string
  kind: 'json' | 'js'
  sha256: string
  enabled: boolean
  sourceId: string
  baseUrl: string
  error?: string
}

export interface AvailableExtension {
  id: string
  name: string
  version: string
  lang: string
  url: string
  sha256: string
  repoUrl: string
  repoName?: string
  installedVersion?: string
  updateAvailable: boolean
}

export interface ExtensionsOverview {
  dir: string
  repos: string[]
  installed: InstalledExtension[]
  available: AvailableExtension[]
  errors: string[]
}

function extDir(): string {
  const dir = join(app.getPath('userData'), 'extensions')
  mkdirSync(dir, { recursive: true })
  return dir
}

function repos(): string[] {
  return (getSettings().extensionRepos ?? []).filter((u) => typeof u === 'string' && u.trim())
}

function parseFile(file: string, body: string): ReturnType<typeof parseManifestJson> {
  if (file.endsWith('.js')) return runExtensionScript(body)
  return parseManifestJson(body)
}

function fileFor(id: string, kind: 'json' | 'js'): string {
  return join(extDir(), `${id}.${kind}`)
}

function listFiles(): { file: string; kind: 'json' | 'js' }[] {
  if (!existsSync(extDir())) return []
  return readdirSync(extDir())
    .filter((n) => n.endsWith('.json') || n.endsWith('.js'))
    .filter((n) => n !== 'index.json')
    .map((n) => ({ file: join(extDir(), n), kind: n.endsWith('.js') ? 'js' : 'json' }))
}

export function readInstalled(): InstalledExtension[] {
  const out: InstalledExtension[] = []
  for (const { file, kind } of listFiles()) {
    const idFromName = basename(file).replace(/\.(json|js)$/, '')
    let body = ''
    try {
      body = readFileSync(file, 'utf8')
    } catch (e) {
      out.push({
        id: idFromName,
        name: idFromName,
        version: '',
        lang: 'other',
        file,
        kind,
        sha256: '',
        enabled: false,
        sourceId: '',
        baseUrl: '',
        error: e instanceof Error ? e.message : String(e)
      })
      continue
    }
    const parsed = parseFile(file, body)
    if (!parsed.ok) {
      out.push({
        id: isSafeExtensionId(idFromName) ? idFromName : 'invalid',
        name: idFromName,
        version: '',
        lang: 'other',
        file,
        kind,
        sha256: sha256Hex(body),
        enabled: false,
        sourceId: '',
        baseUrl: '',
        error: parsed.issues.map((i) => `${i.path} ${i.message}`.trim()).join('; ')
      })
      continue
    }
    const src = getSource(parsed.manifest.source.id)
    out.push({
      id: parsed.manifest.id,
      name: parsed.manifest.name,
      version: parsed.manifest.version,
      lang: parsed.manifest.lang,
      description: parsed.manifest.description,
      file,
      kind,
      sha256: sha256Hex(body),
      enabled: src ? src.extensionEnabled !== false : true,
      sourceId: parsed.manifest.source.id,
      baseUrl: parsed.manifest.source.baseUrl
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function conflict(def: SourceDef): string | null {
  const byId = getSource(def.id)
  if (byId && byId.extensionId !== def.extensionId) {
    return `A site named ${byId.name} already uses this id.`
  }
  const byHost = sourceForHost(def.baseUrl)
  if (byHost && byHost.extensionId !== def.extensionId) {
    return `A site for this address is already in your library (${byHost.name}).`
  }
  return null
}

export function registerManifest(manifest: ExtensionManifest, enabled = true): { ok: true; sourceId: string } | { ok: false; error: string } {
  const def = sourceDefFromManifest(manifest)
  def.extensionEnabled = enabled
  const problem = conflict(def)
  if (problem) return { ok: false, error: problem }
  const existing = getSource(def.id)
  if (existing && existing.extensionEnabled === false && enabled === true) def.extensionEnabled = true
  if (existing && existing.extensionEnabled === false && enabled === false) def.extensionEnabled = false
  addSource(def)
  // addSource may skip a non-structural assign; force extension flags
  updateSource(def.id, (src) => {
    src.extensionId = def.extensionId
    src.extensionVersion = def.extensionVersion
    src.extensionEnabled = def.extensionEnabled
    src.name = def.name
    src.baseUrl = def.baseUrl
    src.listTemplate = def.listTemplate
    src.seriesRe = def.seriesRe
    src.chapterRe = def.chapterRe
    src.maxPages = def.maxPages
    src.lang = def.lang
    src.listTemplates = def.listTemplates
    src.sitemaps = def.sitemaps
    src.api = def.api
  })
  return { ok: true, sourceId: def.id }
}

export function loadInstalledExtensions(): void {
  for (const row of readInstalled()) {
    if (row.error) continue
    const body = readFileSync(row.file, 'utf8')
    const parsed = parseFile(row.file, body)
    if (!parsed.ok) continue
    const already = getSource(parsed.manifest.source.id)
    const enabled = already ? already.extensionEnabled !== false : true
    const result = registerManifest(parsed.manifest, enabled)
    if (!result.ok && !already) {
      /* leave the file; the Settings list shows the error via a later read if we stash it — register conflict is shown when installing */
    }
  }
}

export function installExtensionFile(
  body: string,
  kind: 'json' | 'js',
  expectedSha256?: string
): { ok: true; id: string } | { ok: false; error: string } {
  if (expectedSha256 && !verifySha256(body, expectedSha256)) {
    return { ok: false, error: 'SHA-256 did not match. The file was not saved.' }
  }
  const parsed = kind === 'js' ? runExtensionScript(body) : parseManifestJson(body)
  if (!parsed.ok) return { ok: false, error: parsed.issues.map((i) => `${i.path} ${i.message}`.trim()).join('; ') }
  const registered = registerManifest(parsed.manifest, true)
  if (!registered.ok) return registered
  const dest = fileFor(parsed.manifest.id, kind)
  // remove the other kind if present
  const other = fileFor(parsed.manifest.id, kind === 'js' ? 'json' : 'js')
  try {
    if (existsSync(other)) unlinkSync(other)
  } catch {
    /* keep going */
  }
  writeFileSync(dest, body, 'utf8')
  return { ok: true, id: parsed.manifest.id }
}

export async function installFromUrl(
  url: string,
  expectedSha256: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json,text/javascript,*/*' } })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) return { ok: false, error: `Download failed (${res.status})` }
  const body = await res.text()
  const kind: 'json' | 'js' = /\.js(\?|$)/i.test(url) || /^\s*(\/\/|module\.exports|exports\.)/.test(body) ? 'js' : 'json'
  return installExtensionFile(body, kind, expectedSha256)
}

export function removeExtension(id: string): void {
  const row = readInstalled().find((e) => e.id === id)
  if (row?.sourceId) {
    const src = getSource(row.sourceId)
    if (src?.extensionId === id) removeSource(row.sourceId)
  }
  for (const kind of ['json', 'js'] as const) {
    const f = fileFor(id, kind)
    try {
      if (existsSync(f)) unlinkSync(f)
    } catch {
      /* ignore */
    }
  }
}

export function setExtensionEnabled(id: string, enabled: boolean): void {
  const row = readInstalled().find((e) => e.id === id)
  if (!row?.sourceId) return
  updateSource(row.sourceId, (src) => {
    if (src.extensionId === id) src.extensionEnabled = enabled
  })
}

export function addExtensionRepo(url: string): { ok: true; repos: string[] } | { ok: false; error: string } {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { ok: false, error: 'Enter a valid http(s) URL to an index.json' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'The repo URL must be http or https' }
  }
  const href = parsed.toString()
  const next = [...repos()]
  if (!next.includes(href)) next.push(href)
  setSettings({ extensionRepos: next })
  return { ok: true, repos: next }
}

export function removeExtensionRepo(url: string): string[] {
  const next = repos().filter((u) => u !== url)
  setSettings({ extensionRepos: next })
  return next
}

async function fetchRepo(url: string): Promise<{ ok: true; index: RepoIndex } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } })
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) return { ok: false, error: `${url}: ${res.status}` }
  const parsed = parseRepoIndexJson(await res.text())
  if (!parsed.ok) return { ok: false, error: `${url}: ${parsed.issues.map((i) => i.message).join('; ')}` }
  return { ok: true, index: parsed.index }
}

export async function extensionsOverview(): Promise<ExtensionsOverview> {
  const installed = readInstalled()
  const byId = new Map(installed.map((e) => [e.id, e]))
  const errors: string[] = []
  const available: AvailableExtension[] = []
  const repoUrls = repos()
  for (const repoUrl of repoUrls) {
    const r = await fetchRepo(repoUrl)
    if (!r.ok) {
      errors.push(r.error)
      continue
    }
    for (const e of r.index.extensions) {
      const have = byId.get(e.id)
      available.push({
        id: e.id,
        name: e.name,
        version: e.version,
        lang: e.lang,
        url: e.url,
        sha256: e.sha256,
        repoUrl,
        repoName: r.index.name,
        installedVersion: have?.version,
        updateAvailable: have ? compareVersions(have.version, e.version) < 0 : false
      })
    }
  }
  return { dir: extDir(), repos: repoUrls, installed, available, errors }
}

/** Used by health tooling and tests: currently active catalog sources, including enabled extensions. */
export function activeSourceIds(): string[] {
  return sourceDefs().map((s) => s.id)
}
