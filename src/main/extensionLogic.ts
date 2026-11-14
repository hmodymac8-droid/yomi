import { createHash } from 'crypto'
import type { FeedApiDef, SourceDef } from '../preload/index.d'

export const EXTENSION_MANIFEST_VERSION = 1

export interface ExtensionSourceFields {
  id: string
  name: string
  baseUrl: string
  listTemplate: string
  listTemplates?: string[]
  seriesRe: string
  chapterRe: string
  maxPages: number
  lang?: 'ar' | 'en' | 'other'
  sitemaps?: string[]
  api?: FeedApiDef
}

export interface ExtensionManifest {
  manifestVersion: number
  id: string
  name: string
  version: string
  lang: 'ar' | 'en' | 'other'
  description?: string
  source: ExtensionSourceFields
}

export interface RepoExtensionEntry {
  id: string
  name: string
  version: string
  lang: 'ar' | 'en' | 'other' | string
  url: string
  sha256: string
}

export interface RepoIndex {
  name?: string
  extensions: RepoExtensionEntry[]
}

export type ManifestIssue = { path: string; message: string }

export class ManifestError extends Error {
  issues: ManifestIssue[]
  constructor(issues: ManifestIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; ') || 'Invalid extension manifest')
    this.issues = issues
  }
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/
const VERSION_RE = /^[A-Za-z0-9._+-]{1,40}$/

export function sha256Hex(data: string | Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function verifySha256(data: string | Uint8Array | Buffer, expected: string): boolean {
  const want = (expected ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(want)) return false
  return sha256Hex(data) === want
}

export function isSafeExtensionId(id: string): boolean {
  if (!ID_RE.test(id)) return false
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\\')) return false
  return true
}

function issue(issues: ManifestIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function asUrl(value: unknown): string | undefined {
  const s = asString(value)
  if (!s) return undefined
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return u.toString()
  } catch {
    return undefined
  }
}

function asRegex(value: unknown): string | undefined {
  const s = asString(value)
  if (!s) return undefined
  try {
    new RegExp(s)
    return s
  } catch {
    return undefined
  }
}

function asLang(value: unknown): 'ar' | 'en' | 'other' | undefined {
  return value === 'ar' || value === 'en' || value === 'other' ? value : undefined
}

function validateSource(raw: unknown, issues: ManifestIssue[], prefix = 'source'): ExtensionSourceFields | null {
  if (!raw || typeof raw !== 'object') {
    issue(issues, prefix, 'missing source definition')
    return null
  }
  const r = raw as Record<string, unknown>
  const id = asString(r.id)
  if (!id || !isSafeExtensionId(id)) issue(issues, `${prefix}.id`, 'must be a safe id (letters, digits, dot, dash, underscore)')
  const name = asString(r.name)
  if (!name) issue(issues, `${prefix}.name`, 'required')
  const baseUrl = asUrl(r.baseUrl)
  if (!baseUrl) issue(issues, `${prefix}.baseUrl`, 'must be an http(s) URL')
  const listTemplate = asString(r.listTemplate)
  if (!listTemplate) issue(issues, `${prefix}.listTemplate`, 'required')
  else if (!asUrl(listTemplate.replace(/\{n\}/g, '1'))) {
    issue(issues, `${prefix}.listTemplate`, 'must be an http(s) URL (use {n} for the page number)')
  }
  const seriesRe = asRegex(r.seriesRe)
  if (!seriesRe) issue(issues, `${prefix}.seriesRe`, 'must be a valid regular expression')
  const chapterRe = asRegex(r.chapterRe)
  if (!chapterRe) issue(issues, `${prefix}.chapterRe`, 'must be a valid regular expression')
  const maxPages = r.maxPages
  if (typeof maxPages !== 'number' || !Number.isInteger(maxPages) || maxPages < 0 || maxPages > 100000) {
    issue(issues, `${prefix}.maxPages`, 'must be an integer from 0 to 100000')
  }
  let listTemplates: string[] | undefined
  if (r.listTemplates !== undefined) {
    if (!Array.isArray(r.listTemplates) || r.listTemplates.some((t) => !asString(t) || !asUrl(String(t).replace(/\{n\}/g, '1')))) {
      issue(issues, `${prefix}.listTemplates`, 'must be an array of http(s) URL templates')
    } else listTemplates = (r.listTemplates as unknown[]).map((t) => String(t))
  }
  let sitemaps: string[] | undefined
  if (r.sitemaps !== undefined) {
    if (!Array.isArray(r.sitemaps) || r.sitemaps.some((t) => !asUrl(t))) {
      issue(issues, `${prefix}.sitemaps`, 'must be an array of http(s) URLs')
    } else sitemaps = (r.sitemaps as unknown[]).map((t) => String(t))
  }
  let api: FeedApiDef | undefined
  if (r.api !== undefined) {
    if (!r.api || typeof r.api !== 'object') issue(issues, `${prefix}.api`, 'must be an object')
    else {
      const a = r.api as Record<string, unknown>
      const base = asUrl(a.base)
      if (a.kind !== 'series-feed' || !base) issue(issues, `${prefix}.api`, 'must be { kind: "series-feed", base: http(s) URL }')
      else api = { kind: 'series-feed', base }
    }
  }
  const lang = r.lang !== undefined ? asLang(r.lang) : undefined
  if (r.lang !== undefined && !lang) issue(issues, `${prefix}.lang`, 'must be ar, en or other')
  if (issues.length) return null
  const out: ExtensionSourceFields = {
    id: id!,
    name: name!,
    baseUrl: baseUrl!,
    listTemplate: listTemplate!,
    seriesRe: seriesRe!,
    chapterRe: chapterRe!,
    maxPages: maxPages as number
  }
  if (listTemplates) out.listTemplates = listTemplates
  if (sitemaps) out.sitemaps = sitemaps
  if (api) out.api = api
  if (lang) out.lang = lang
  return out
}

export function validateManifest(raw: unknown): { ok: true; manifest: ExtensionManifest } | { ok: false; issues: ManifestIssue[] } {
  const issues: ManifestIssue[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, issues: [{ path: '', message: 'manifest must be an object' }] }
  const r = raw as Record<string, unknown>
  if (r.manifestVersion !== EXTENSION_MANIFEST_VERSION) {
    issue(issues, 'manifestVersion', `must be ${EXTENSION_MANIFEST_VERSION}`)
  }
  const id = asString(r.id)
  if (!id || !isSafeExtensionId(id)) issue(issues, 'id', 'must be a safe id (letters, digits, dot, dash, underscore)')
  const name = asString(r.name)
  if (!name) issue(issues, 'name', 'required')
  const version = asString(r.version)
  if (!version || !VERSION_RE.test(version)) issue(issues, 'version', 'required')
  const lang = asLang(r.lang)
  if (!lang) issue(issues, 'lang', 'must be ar, en or other')
  const description = r.description === undefined ? undefined : asString(r.description)
  if (r.description !== undefined && description === undefined) issue(issues, 'description', 'must be a string')
  const source = validateSource(r.source, issues)
  if (issues.length || !source || !id || !name || !version || !lang) return { ok: false, issues }
  const manifest: ExtensionManifest = { manifestVersion: EXTENSION_MANIFEST_VERSION, id, name, version, lang, source }
  if (description) manifest.description = description
  return { ok: true, manifest }
}

export function parseManifestJson(text: string): { ok: true; manifest: ExtensionManifest } | { ok: false; issues: ManifestIssue[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] }
  }
  return validateManifest(raw)
}

export function parseRepoIndex(raw: unknown): { ok: true; index: RepoIndex } | { ok: false; issues: ManifestIssue[] } {
  const issues: ManifestIssue[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, issues: [{ path: '', message: 'repo index must be an object' }] }
  const r = raw as Record<string, unknown>
  const name = r.name === undefined ? undefined : asString(r.name)
  if (r.name !== undefined && !name) issue(issues, 'name', 'must be a string')
  if (!Array.isArray(r.extensions)) {
    issue(issues, 'extensions', 'must be an array')
    return { ok: false, issues }
  }
  const extensions: RepoExtensionEntry[] = []
  r.extensions.forEach((item, i) => {
    const p = `extensions[${i}]`
    if (!item || typeof item !== 'object') {
      issue(issues, p, 'must be an object')
      return
    }
    const e = item as Record<string, unknown>
    const id = asString(e.id)
    if (!id || !isSafeExtensionId(id)) issue(issues, `${p}.id`, 'must be a safe id')
    const ename = asString(e.name)
    if (!ename) issue(issues, `${p}.name`, 'required')
    const version = asString(e.version)
    if (!version) issue(issues, `${p}.version`, 'required')
    const lang = asString(e.lang)
    if (!lang) issue(issues, `${p}.lang`, 'required')
    const url = asUrl(e.url)
    if (!url) issue(issues, `${p}.url`, 'must be an http(s) URL')
    const sha256 = asString(e.sha256)?.toLowerCase()
    if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) issue(issues, `${p}.sha256`, 'must be a 64-character hex SHA-256')
    if (id && ename && version && lang && url && sha256 && /^[0-9a-f]{64}$/.test(sha256)) {
      extensions.push({ id, name: ename, version, lang, url, sha256 })
    }
  })
  if (issues.length) return { ok: false, issues }
  const index: RepoIndex = { extensions }
  if (name) index.name = name
  return { ok: true, index }
}

export function parseRepoIndexJson(text: string): ReturnType<typeof parseRepoIndex> {
  try {
    return parseRepoIndex(JSON.parse(text))
  } catch {
    return { ok: false, issues: [{ path: '', message: 'repo index is not valid JSON' }] }
  }
}

/** Turn a valid manifest into a catalog SourceDef. Built-in sources are never produced here. */
export function sourceDefFromManifest(manifest: ExtensionManifest): SourceDef {
  const src = manifest.source
  const def: SourceDef = {
    id: src.id,
    name: src.name,
    baseUrl: src.baseUrl,
    listTemplate: src.listTemplate,
    seriesRe: src.seriesRe,
    chapterRe: src.chapterRe,
    maxPages: src.maxPages,
    extensionId: manifest.id,
    extensionVersion: manifest.version,
    extensionEnabled: true
  }
  if (src.listTemplates) def.listTemplates = src.listTemplates
  if (src.sitemaps) def.sitemaps = src.sitemaps
  if (src.api) def.api = src.api
  def.lang = src.lang ?? manifest.lang
  return def
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p))
  const pb = b.split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p))
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else {
      const sx = String(x)
      const sy = String(y)
      if (sx !== sy) return sx < sy ? -1 : 1
    }
  }
  return 0
}
