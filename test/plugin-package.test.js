// Contract tests for the dsh-notice plugin package.
//
// These verify the two public boundaries this spike depends on, not the internals:
//   A. the package the DSH plugin manager installs (manifest, bundle patch, shipped files),
//   B. the browser module contract consumed by DSH client-modules
//      (`window.__ModuleLoader__.load` -> factory -> apply -> Web Notification).
//
// The notification decision engine gets its own seam in a later ticket; this file
// only protects the packaging and the one-shot debug trigger from silent breakage.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => readFileSync(join(root, relative), 'utf8')
const exists = (relative) => existsSync(join(root, relative))
const manifest = () => JSON.parse(read('package.json'))

/** Match one package.json `files` pattern (only `*` wildcards are used here). */
function coveredByFiles(relative) {
  return manifest().files.some((pattern) => {
    const source = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*')
    return new RegExp(`^${source}$`).test(relative)
  })
}

const runtimeFiles = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']

test('manifest declares an installable dsh bundle with a browser half', () => {
  const pkg = manifest()

  assert.equal(pkg.name, 'dsh-notice')
  assert.equal(pkg.private, true)
  assert.equal(typeof pkg.version, 'string')
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.description, 'package description feeds the plugin list one-liner')

  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.equal(pkg.dsh?.client?.immediately, true, 'the notifier must load eagerly, not on demand')
  assert.ok(Array.isArray(pkg.dsh?.client?.inject), 'dsh.client.inject is part of the documented P0 shape')

  assert.ok(pkg.exports?.['.'], 'host half export')
  assert.equal(pkg.exports?.['./client'], './client.js')
  assert.ok(pkg.exports?.['./icon'], 'plugin list icon export')
  assert.ok(pkg.exports?.['./locale/*.json'], 'locale export')

  for (const file of ['package.json', ...runtimeFiles]) {
    assert.ok(exists(file), `${file} must ship with the bundle`)
    assert.ok(file === 'package.json' || coveredByFiles(file), `${file} must be listed in package.json files`)
  }

  for (const locale of ['locale/en.json', 'locale/zh.json']) {
    const meta = JSON.parse(read(locale)).meta
    assert.ok(meta?.title, `${locale} needs meta.title for the plugin list`)
    assert.ok(meta?.description, `${locale} needs meta.description for the plugin list`)
  }
})

test('bundle patch inserts exactly one loader row named after the package', () => {
  const patch = read('cordis.patch.yml')

  assert.match(patch, /^- insert:/m, 'top-level patch must be an insert list')
  const ids = [...patch.matchAll(/^\s+-\s+id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  const names = [...patch.matchAll(/^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map((match) => match[1])

  assert.deepEqual(ids, ['notice'], 'row id must match the documented config override id')
  assert.deepEqual(names, ['dsh-notice'])
})

test('host half is a no-op Cordis plugin', async () => {
  const host = await import('../index.js')

  assert.equal(typeof host.apply, 'function')
  assert.doesNotThrow(() => host.apply())
})

test('client half loads one debug toast through the module loader contract', () => {
  const sent = []
  class FakeNotification {
    static permission = 'granted'
    constructor(title, options) {
      this.title = title
      this.options = options
      this.closed = false
      sent.push(this)
    }
    close() {
      this.closed = true
    }
  }

  let registration
  const window = {
    __ModuleLoader__: {
      load(definition) {
        registration = definition
      },
    },
  }
  const sandbox = { window, Notification: FakeNotification }
  vm.createContext(sandbox)
  vm.runInContext(read('client.js'), sandbox, { filename: 'client.js' })

  assert.equal(registration?.id, manifest().name, 'factory id must equal the package name')

  const cleanups = []
  const plugin = registration.factory(() => {
    throw new Error('the debug toast must not require platform modules')
  })
  assert.equal(typeof plugin.apply, 'function')

  const ctx = {
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  plugin.apply(ctx)

  assert.equal(sent.length, 1, 'exactly one debug toast per load')
  const [toast] = sent
  assert.match(toast.title, /DSH Notice/)
  assert.equal(toast.options.tag, 'dsh-notice-spike', 'tag lets the toast replace instead of stack')
  assert.equal(toast.options.silent, false, 'sound stays on so its Windows behavior can be observed')
  assert.match(toast.options.body, /build=\S+/, 'body identifies the client build for the HMR check')
  assert.match(toast.options.body, /perm=granted/, 'body records the renderer notification permission')

  for (const cleanup of cleanups) cleanup()
  assert.equal(toast.closed, true, 'the effect must close its toast when the plugin unloads')
})
