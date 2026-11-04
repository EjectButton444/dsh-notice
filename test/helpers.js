// Shared helpers for the dsh-notice test files. This is not a test file itself:
// the npm test glob only picks up `test/*.test.js`.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import vm from 'node:vm'

export const root = fileURLToPath(new URL('..', import.meta.url))
export const read = (relative) => readFileSync(join(root, relative), 'utf8')
export const exists = (relative) => existsSync(join(root, relative))
export const manifest = () => JSON.parse(read('package.json'))

/** Match one package.json `files` pattern (only `*` wildcards are used here). */
export function coveredByFiles(relative) {
  return manifest().files.some((pattern) => {
    const source = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*')
    return new RegExp(`^${source}$`).test(relative)
  })
}

/**
 * Load client.engine.js the way the DSH client module loader does: execute the
 * classic script in a vm with a fake `window.__ModuleLoader__`, then take the
 * registered chunk factory's exports.
 */
export function loadEngine() {
  const registrations = []
  const window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
      },
    },
  }
  vm.runInContext(read('client.engine.js'), vm.createContext({ window }), { filename: 'client.engine.js' })

  assert.equal(registrations.length, 1, 'the engine chunk must register exactly one factory')
  const [registration] = registrations
  assert.equal(registration.id, manifest().name, 'chunk id must equal the package name')
  assert.equal(registration.chunk, 'client.engine.js', 'chunk file name is part of the module table contract')
  assert.equal(typeof registration.factory, 'function')
  return registration.factory()
}
