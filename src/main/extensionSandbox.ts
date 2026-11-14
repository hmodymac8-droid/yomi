import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import { validateManifest, type ExtensionManifest, type ManifestIssue } from './extensionLogic'

/*
 * JS extensions run in QuickJS, a separate JavaScript engine compiled to WebAssembly. Nothing from the app is
 * shared with it: no Node, no `process`, no `require`, no host objects or functions at all, so there is no
 * constructor chain or prototype that leads back to the app (Node's own `vm` module cannot promise that; its
 * documentation says it is not a security mechanism). The script gets an empty `module` / `exports` made inside
 * QuickJS, has a time and memory limit, and the only thing that comes out is its `module.exports` as JSON text,
 * which is then checked like a JSON extension.
 */

const ALLOWED_KEYS = new Set(['manifestVersion', 'id', 'name', 'version', 'lang', 'description', 'source'])
const MEMORY_LIMIT = 32 * 1024 * 1024
const STACK_LIMIT = 512 * 1024

let engine: QuickJSWASMModule | null = null
let loading: Promise<void> | null = null

/** Starts the sandbox engine (a few milliseconds). Scripts can run once this has finished. */
export function prepareSandbox(): Promise<void> {
  loading ??= newQuickJSWASMModuleFromVariant(variant).then((m) => {
    engine = m
  })
  return loading
}

function sanitizeExport(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (ALLOWED_KEYS.has(k)) out[k] = v
  }
  return out
}

type Result =
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; issues: ManifestIssue[]; error?: string }

const fail = (message: string): Result => ({
  ok: false,
  issues: [{ path: '', message }],
  error: message
})

/**
 * Runs a JS extension in the QuickJS sandbox. The script must set `module.exports` (or fields of `exports`) to an
 * extension manifest. `prepareSandbox()` must have finished first.
 */
export function runExtensionScript(code: string, timeoutMs = 1000): Result {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, issues: [{ path: '', message: 'script is empty' }] }
  }
  if (code.length > 1_000_000) {
    return { ok: false, issues: [{ path: '', message: 'script is too large' }] }
  }
  if (!engine) return fail('the extension sandbox is still starting; try again in a moment')

  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(MEMORY_LIMIT)
  runtime.setMaxStackSize(STACK_LIMIT)
  const deadline = Date.now() + timeoutMs
  runtime.setInterruptHandler(() => Date.now() > deadline)
  const vm = runtime.newContext()
  try {
    // module / exports are created inside the sandbox; the script's result leaves it only as JSON text
    const wrapped =
      'var module = { exports: {} }; var exports = module.exports;\n' +
      '(function (module, exports) {\n' +
      code +
      '\n})(module, exports);\n' +
      'JSON.stringify(module.exports === undefined ? exports : module.exports)'
    const res = vm.evalCode(wrapped, 'extension.js')
    if (res.error) {
      const err = vm.dump(res.error) as { message?: string } | string
      res.error.dispose()
      const message =
        Date.now() > deadline
          ? 'took too long'
          : typeof err === 'string'
            ? err
            : String(err?.message ?? err)
      return fail(`script failed: ${message}`)
    }
    const text = vm.dump(res.value)
    res.value.dispose()
    if (typeof text !== 'string') return fail('script did not export a manifest')
    let exported: unknown
    try {
      exported = JSON.parse(text)
    } catch {
      return fail('script did not export a manifest')
    }
    return validateManifest(sanitizeExport(exported))
  } finally {
    vm.dispose()
    runtime.dispose()
  }
}
