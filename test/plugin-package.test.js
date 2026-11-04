// Contract tests for the dsh-notice plugin package.
//
// These verify the public boundaries the plugin depends on, not adapter internals:
//   A. the package the DSH plugin manager installs (manifest, bundle patch, shipped files),
//   B. the browser module contract consumed by DSH client-modules
//      (`window.__ModuleLoader__.load` -> factory -> inject -> apply -> engine chunk).
//
// The notification decision engine is unit-tested at its own seam in
// test/client-engine.test.js. The thin adapter (DSH state source, notification
// sender, locale) is covered by the real-machine checklist in docs/, as decided in
// docs/spec.md "Testing Decisions", so nothing here reaches inside it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { coveredByFiles, exists, manifest, read } from './helpers.js'

const runtimeFiles = ['index.js', 'client.js', 'client.engine.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']

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
  // dsh.client.inject is module load order (packages this bundle require()s); the
  // Cordis services are injected by the factory's own `inject` list in client.js.
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

test('the engine chunk obeys the package-local client chunk contract', () => {
  // dsh-client-modules only serves /plugins/<id>/client.<name>.js and only accepts
  // `chunk: "client.<name>.js"` registrations; the adapter fetches it with
  // require.async. All three halves of that contract must agree on one file name.
  assert.ok(exists('client.engine.js'), 'the chunk file must exist next to client.js')
  assert.match(read('client.js'), /ENGINE_CHUNK = '\.\/client\.engine\.js'/, 'the adapter requests the chunk by this name')
  assert.match(read('client.js'), /require\.async\(ENGINE_CHUNK\)/, 'the chunk travels through require.async')
  assert.match(read('client.engine.js'), /chunk:\s*'client\.engine\.js'/, 'the chunk registers under this name')
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

test('client half follows the module loader contract and injects the DSH services it observes', async () => {
  let registration
  const window = {
    __ModuleLoader__: {
      load(definition) {
        registration = definition
      },
    },
  }
  vm.runInContext(read('client.js'), vm.createContext({ window }), { filename: 'client.js' })

  assert.equal(registration?.id, manifest().name, 'factory id must equal the package name')

  const requestedChunks = []
  const fakeEngine = {
    EVENT_KINDS: [],
    DEFAULT_CONFIG: {},
    classifyPending: () => undefined,
    normalizeEvent: () => null,
    decideEvent: () => [],
  }
  const plugin = registration.factory({
    async async(specifier) {
      requestedChunks.push(specifier)
      return fakeEngine
    },
  })

  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual([...plugin.inject].sort(), ['locale', 'sessions', 'uiSession'], 'the Cordis services this plugin depends on')

  const ctx = {
    uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    locale: { getSnapshot: () => ({ active: 'zh' }) },
    effect(callback) {
      callback()
    },
  }

  plugin.apply(ctx)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(requestedChunks, ['./client.engine.js'], 'the pure engine travels as a package-local chunk')
})
