import vm from 'node:vm'
import { validateManifest, type ExtensionManifest, type ManifestIssue } from './extensionLogic'

const ALLOWED_KEYS = new Set(['manifestVersion', 'id', 'name', 'version', 'lang', 'description', 'source'])

function sanitizeExport(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (ALLOWED_KEYS.has(k)) out[k] = v
  }
  return out
}

/**
 * Run a JS extension in an isolated vm context. No require, process, or Node bindings are
 * provided, eval/Function are disabled, and the script is timed out. The script must set
 * `module.exports` (or `exports`) to an extension manifest object. It is never evaluated in
 * the main context.
 */
export function runExtensionScript(
  code: string,
  timeoutMs = 1000
): { ok: true; manifest: ExtensionManifest } | { ok: false; issues: ManifestIssue[]; error?: string } {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, issues: [{ path: '', message: 'script is empty' }] }
  }
  if (code.length > 1_000_000) {
    return { ok: false, issues: [{ path: '', message: 'script is too large' }] }
  }
  const moduleObj = { exports: {} as unknown }
  const exportsObj = moduleObj.exports
  const context = vm.createContext(
    {
      module: moduleObj,
      exports: exportsObj,
      console: { log() {}, info() {}, warn() {}, error() {} }
    },
    { name: 'yomi-extension', codeGeneration: { strings: false, wasm: false } }
  )
  try {
    const script = new vm.Script(code, { filename: 'extension.js' })
    script.runInContext(context, { timeout: timeoutMs, displayErrors: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, issues: [{ path: '', message: `script failed: ${message}` }], error: message }
  }
  const exported =
    context.module && typeof context.module === 'object' && 'exports' in context.module
      ? (context.module as { exports: unknown }).exports
      : context.exports
  return validateManifest(sanitizeExport(exported))
}
