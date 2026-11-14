import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  compareVersions,
  isSafeExtensionId,
  parseManifestJson,
  parseRepoIndexJson,
  sha256Hex,
  sourceDefFromManifest,
  validateManifest,
  verifySha256
} from '../src/main/extensionLogic.ts'
import { prepareSandbox, runExtensionScript } from '../src/main/extensionSandbox.ts'

// the QuickJS engine starts once, before any script runs
await prepareSandbox()

const examplePath = join(import.meta.dirname, '../examples/extensions/mangafreak.json')
const exampleText = readFileSync(examplePath, 'utf8')
const exampleSha = 'd41db80a1885ffcee228727b1c10172acda97696e62dc0cc72da9faeaa1d690a'

const valid = {
  manifestVersion: 1,
  id: 'demo-source',
  name: 'Demo',
  version: '1.2.0',
  lang: 'en' as const,
  source: {
    id: 'ext-demo-source',
    name: 'Demo',
    baseUrl: 'https://example.com/',
    listTemplate: 'https://example.com/list/{n}',
    seriesRe: '^https://example\\.com/series/[^/]+$',
    chapterRe: '/chapter-',
    maxPages: 10
  }
}

test('the bundled MangaFreak example is a valid manifest and matches its published SHA-256', () => {
  const parsed = parseManifestJson(exampleText)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.equal(parsed.manifest.id, 'mangafreak-example')
    assert.equal(parsed.manifest.source.baseUrl, 'https://ww3.mangafreak.me/')
    const def = sourceDefFromManifest(parsed.manifest)
    assert.equal(def.id, 'ext-mangafreak-example')
    assert.equal(def.extensionId, 'mangafreak-example')
    assert.equal(def.extensionEnabled, true)
    assert.notEqual(def.id, 'mangafreak') // does not replace the built-in id
  }
  assert.equal(sha256Hex(exampleText), exampleSha)
  assert.equal(verifySha256(exampleText, exampleSha), true)
  const index = parseRepoIndexJson(
    readFileSync(join(import.meta.dirname, '../examples/extensions/index.json'), 'utf8')
  )
  assert.equal(index.ok, true)
  if (index.ok) assert.equal(index.index.extensions[0].sha256, exampleSha)
})

test('verifySha256 rejects a wrong or malformed hash', () => {
  assert.equal(verifySha256(exampleText, '0'.repeat(64)), false)
  assert.equal(verifySha256(exampleText, 'not-a-hash'), false)
  assert.equal(verifySha256(exampleText, exampleSha.toUpperCase()), true)
})

test('validateManifest accepts a well-formed source and rejects missing fields', () => {
  const ok = validateManifest(valid)
  assert.equal(ok.ok, true)
  const bad = validateManifest({ manifestVersion: 1, id: 'demo-source' })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.ok(bad.issues.some((i) => i.path.includes('source') || i.path === 'name'))
})

test('validateManifest rejects path-like ids, bad URLs, and bad regexes', () => {
  assert.equal(isSafeExtensionId('../etc'), false)
  assert.equal(isSafeExtensionId('a/b'), false)
  assert.equal(isSafeExtensionId('good-id_1'), true)
  const sneak = validateManifest({
    ...valid,
    id: '../passwd',
    source: { ...valid.source, baseUrl: 'file:///etc/passwd', seriesRe: '(' }
  })
  assert.equal(sneak.ok, false)
  if (!sneak.ok) {
    assert.ok(sneak.issues.some((i) => i.path === 'id'))
    assert.ok(sneak.issues.some((i) => i.path === 'source.baseUrl'))
    assert.ok(sneak.issues.some((i) => i.path === 'source.seriesRe'))
  }
})

test('parseManifestJson reports invalid JSON', () => {
  const r = parseManifestJson('{not json')
  assert.equal(r.ok, false)
})

test('parseRepoIndexJson requires a 64-character SHA-256 and an http URL', () => {
  const bad = parseRepoIndexJson(
    JSON.stringify({ extensions: [{ id: 'demo-source', name: 'D', version: '1', lang: 'en', url: 'ftp://x', sha256: 'abc' }] })
  )
  assert.equal(bad.ok, false)
  const good = parseRepoIndexJson(
    JSON.stringify({
      name: 'Repo',
      extensions: [
        {
          id: 'demo-source',
          name: 'D',
          version: '1.0.0',
          lang: 'en',
          url: 'https://example.com/d.json',
          sha256: exampleSha
        }
      ]
    })
  )
  assert.equal(good.ok, true)
})

test('compareVersions orders dotted versions', () => {
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0)
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0)
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0)
})

test('sourceDefFromManifest keeps built-in sources from being overwritten by id', () => {
  const parsed = validateManifest(valid)
  assert.ok(parsed.ok)
  if (parsed.ok) {
    const def = sourceDefFromManifest(parsed.manifest)
    assert.equal(def.id, 'ext-demo-source')
    assert.equal(def.extensionId, 'demo-source')
  }
})

test('runExtensionScript reads module.exports as a manifest', () => {
  const r = runExtensionScript(`module.exports = ${JSON.stringify(valid)};`)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.manifest.id, 'demo-source')
})

test('runExtensionScript reads exports.field style too', () => {
  const r = runExtensionScript(`
    exports.manifestVersion = 1;
    exports.id = 'demo-source';
    exports.name = 'Demo';
    exports.version = '1.2.0';
    exports.lang = 'en';
    exports.source = ${JSON.stringify(valid.source)};
  `)
  assert.equal(r.ok, true)
})

test('the sandbox cannot require modules or touch process', () => {
  const req = runExtensionScript('module.exports = require("fs");')
  assert.equal(req.ok, false)
  if (!req.ok) assert.match(req.error ?? req.issues[0]?.message ?? '', /require|process|undefined|is not defined|failed/i)

  const proc = runExtensionScript('module.exports = { manifestVersion: 1, leak: typeof process, id: process && process.pid };')
  assert.equal(proc.ok, false)

  const ctor = runExtensionScript('module.exports = (function(){ return this.constructor.constructor("return process")() })();')
  assert.equal(ctor.ok, false)
})

test('the sandbox does not evaluate a script in the main context', () => {
  const marker = '__yomi_sandbox_marker__'
  // @ts-expect-error test-only global
  globalThis[marker] = false
  const r = runExtensionScript(`
    try { globalThis['${marker}'] = true } catch (e) {}
    try { global['${marker}'] = true } catch (e) {}
    module.exports = ${JSON.stringify(valid)};
  `)
  assert.equal(r.ok, true)
  // @ts-expect-error test-only global
  assert.equal(globalThis[marker], false)
  // @ts-expect-error test-only global
  delete globalThis[marker]
})

test('the sandbox times out a runaway script', () => {
  const r = runExtensionScript('while (true) {}', 50)
  assert.equal(r.ok, false)
})

test('the sandbox shares nothing with the app: module and exports cannot reach process', () => {
  // (module.constructor.constructor reached the app's process under the old node:vm sandbox)
  const viaModule = runExtensionScript(
    "module.exports = { manifestVersion: 1, id: 'x', leak: typeof module.constructor.constructor('return process')() }"
  )
  assert.equal(viaModule.ok, false)
  const viaExports = runExtensionScript(
    "var p = exports.constructor.constructor('return typeof process')(); if (p !== 'undefined') throw new Error('leak ' + p); module.exports = " +
      JSON.stringify(valid)
  )
  assert.equal(viaExports.ok, true)
  const viaGlobal = runExtensionScript(
    "if (typeof require !== 'undefined' || typeof globalThis.process !== 'undefined') throw new Error('leak'); module.exports = " +
      JSON.stringify(valid)
  )
  assert.equal(viaGlobal.ok, true)
})

test('the sandbox stops a script that eats memory', () => {
  const r = runExtensionScript('var a = []; while (true) a.push(new Array(100000).fill(1));', 5000)
  assert.equal(r.ok, false)
})
