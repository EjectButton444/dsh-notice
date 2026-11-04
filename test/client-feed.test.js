// Integration tests for the client half's precise turn-completion feed (ticket #7).
//
// The adapter opens a document-relative SSE `EventSource` to the host half, turns
// completed host `turn/end` frames into engine observations, and permanently gates
// the P0 `running: true -> false` approximation off once that feed has connected
// (so Stop / error / interrupted can never toast again). The normalization rules
// themselves are unit-tested in test/client-engine.test.js; this file covers the
// transport + adapter wiring.
//
// `client.js` and `client.engine.js` are classic browser scripts, so the tests run
// both in one vm context the way DSH's client module loader does. The minimal
// module-loader scaffolding mirrors the client script test in
// test/plugin-package.test.js but stays self-contained on purpose.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relative) => readFileSync(join(root, relative), 'utf8')
const manifest = () => JSON.parse(read('package.json'))

/** Document-relative route of the host half's SSE feed. */
const EVENTS_PATH = 'dsh-notice/events'

const flush = () => new Promise((resolve) => setImmediate(resolve))

/** JSON payload of one SSE message event. */
function frameEvent(payload) {
  return { data: JSON.stringify(payload) }
}

/** One parsed `turn/end` frame with a completed reason, shaped exactly like the host's wire frame. */
function completedFrame(overrides = {}) {
  return { type: 'turn/end', sessionId: 's-1', turn: 1, reasonKind: 'completed', ...overrides }
}

/**
 * Mount the client half in a vm context with the real decision engine chunk,
 * fake EventSource / Notification / fetch / timers and a replayable Cordis ctx.
 *
 * @param {{eventSource?: boolean, rows?: object, locale?: string}} [options]
 */
async function mount(options = {}) {
  const registrations = []
  const warnings = []
  const notifications = []
  const fetches = []
  const sources = []

  class FakeNotification {
    static permission = 'granted'
    constructor(title, notificationOptions) {
      this.title = title
      this.options = notificationOptions
      this.closed = false
      notifications.push(this)
    }
    close() {
      this.closed = true
    }
  }

  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.listeners = new Map()
      this.closed = false
      sources.push(this)
    }
    addEventListener(type, listener) {
      const bucket = this.listeners.get(type) ?? []
      bucket.push(listener)
      this.listeners.set(type, bucket)
    }
    removeEventListener(type, listener) {
      const bucket = this.listeners.get(type) ?? []
      this.listeners.set(type, bucket.filter((candidate) => candidate !== listener))
    }
    close() {
      this.closed = true
      this.listeners.clear()
    }
    /** Test hook: deliver one SSE event to every listener of `type`. */
    emit(type, event = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }

  const window = {
    __ModuleLoader__: {
      load(definition) {
        registrations.push(definition)
      },
    },
    focus() {},
    addEventListener() {},
    removeEventListener() {},
  }

  // The vm context has no timers; the config-fetch guard needs them. They never
  // fire because a fake fetch settles the race first, keeping every test synchronous.
  let timerId = 0
  const timers = new Map()
  const statusHub = { statuses: new Map(), listeners: [] }
  let rows = options.rows ?? { 's-1': { displayTitle: 'Session A', retainedBy: {} } }
  let locale = options.locale ?? 'zh'
  let effectDispose

  const sandbox = {
    window,
    console: {
      warn(...args) {
        warnings.push(args)
      },
    },
    setTimeout(callback) {
      timerId += 1
      timers.set(timerId, callback)
      return timerId
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    Notification: FakeNotification,
    fetch: async (path, requestOptions) => {
      fetches.push({ path, method: requestOptions !== undefined ? requestOptions.method : undefined })
      return { ok: true, json: async () => ({}) }
    },
  }
  if (options.eventSource !== false) sandbox.EventSource = FakeEventSource

  const context = vm.createContext(sandbox)

  // Load the real engine chunk in the same context first: `require.async` returns it.
  vm.runInContext(read('client.engine.js'), context, { filename: 'client.engine.js' })
  const engineRegistration = registrations.find((definition) => definition.chunk === 'client.engine.js')
  assert.ok(engineRegistration, 'client.engine.js must register its package-local chunk')
  const engine = engineRegistration.factory()

  vm.runInContext(read('client.js'), context, { filename: 'client.js' })
  const clientRegistration = registrations.find((definition) => definition.chunk === undefined)
  assert.ok(clientRegistration, 'client.js must register exactly one module')
  assert.equal(clientRegistration.id, manifest().name, 'factory id must equal the package name')

  const requestedChunks = []
  const plugin = clientRegistration.factory({
    async async(specifier) {
      requestedChunks.push(specifier)
      return engine
    },
  })

  const ctx = {
    uiSession: {
      sessionStatus: {
        getSnapshot: () => statusHub.statuses,
        subscribe(listener) {
          statusHub.listeners.push(listener)
          return () => {
            statusHub.listeners = statusHub.listeners.filter((candidate) => candidate !== listener)
          }
        },
      },
    },
    sessions: { list: { getSnapshot: () => ({ byId: rows }), subscribe: () => () => {} } },
    locale: { getSnapshot: () => ({ active: locale }) },
    get: () => undefined,
    effect(callback) {
      effectDispose = callback()
      return effectDispose
    },
  }

  plugin.apply(ctx)
  await flush()
  await flush()
  assert.deepEqual(requestedChunks, ['./client.engine.js'], 'the adapter loads the real engine chunk')

  let instances = 1
  if (options.doubleApply === true) {
    // Simulate a hot reload that forgets to dispose the previous module instance: the
    // plugin script runs again in the same page and applies a second copy.
    vm.runInContext(read('client.js'), context, { filename: 'client.js' })
    const registrationsAfterReload = registrations.filter((definition) => definition.chunk === undefined)
    assert.equal(registrationsAfterReload.length, 2, 'the reload registers a second module instance')
    const reloaded = registrationsAfterReload[1].factory({
      async async() {
        return engine
      },
    })
    reloaded.apply(ctx)
    await flush()
    await flush()
    instances = 2
  }

  return {
    engine,
    instances,
    notifications,
    warnings,
    fetches,
    sources,
    requestedChunks,
    get source() {
      return sources[0]
    },
    setRows(next) {
      rows = next
    },
    setLocale(next) {
      locale = next
    },
    setStatuses(next) {
      statusHub.statuses = next
    },
    fireStatuses() {
      for (const listener of [...statusHub.listeners]) listener()
    },
    dispose() {
      if (typeof effectDispose === 'function') effectDispose()
    },
  }
}

/** One `running: true -> false` edge on the given session (the P0 approximation). */
function runningEdge(mounted, sessionId = 's-1') {
  mounted.setStatuses(new Map([[sessionId, { running: true }]]))
  mounted.fireStatuses()
  mounted.setStatuses(new Map([[sessionId, { running: false }]]))
  mounted.fireStatuses()
}

test('the client opens a document-relative EventSource for the precise host feed', async () => {
  const mounted = await mount()
  assert.equal(mounted.sources.length, 1, 'exactly one SSE feed per client load')
  assert.equal(mounted.source.url, EVENTS_PATH, 'the route is document-relative, like dsh-client-hmr')
  assert.deepEqual(
    mounted.fetches.map((call) => call.path),
    ['dsh-notice/config'],
    'the feed is an EventSource, not another fetch',
  )
  mounted.dispose()
})

test('a hot-reloaded duplicate instance is disposed so one event yields one toast', async () => {
  const mounted = await mount({ doubleApply: true })
  assert.equal(mounted.instances, 2)
  assert.equal(mounted.sources.length, 2, 'each load opened its own SSE feed')
  assert.equal(mounted.sources[0].closed, true, 'the stale instance feed is closed by the singleton anchor')

  runningEdge(mounted)
  assert.equal(mounted.notifications.length, 1, 'the stale copy must not duplicate the notification')
  mounted.dispose()
})

test('before the feed connects the P0 running-edge fallback still notifies', async () => {
  const mounted = await mount()
  assert.equal(mounted.source.closed, false)
  runningEdge(mounted)

  assert.equal(mounted.notifications.length, 1, 'no precise signal yet, so the migration fallback applies')
  const [toast] = mounted.notifications
  assert.equal(toast.title, 'Session A')
  assert.equal(toast.options.body, '本轮已完成')
  mounted.dispose()
})

test('after the feed connects the running edge never notifies again', async () => {
  const mounted = await mount()
  mounted.source.emit('open')
  mounted.source.emit('error') // reconnect does not revert the switch
  runningEdge(mounted)
  assert.equal(mounted.notifications.length, 0, 'the approximation is gated off permanently after the first open')
  mounted.dispose()
})

test('a completed turn/end frame after open produces exactly one completion toast', async () => {
  const mounted = await mount()
  mounted.source.emit('open')
  mounted.source.emit('message', frameEvent(completedFrame()))

  assert.equal(mounted.notifications.length, 1)
  const [toast] = mounted.notifications
  assert.equal(toast.title, 'Session A', 'the title comes from the sessions.list row')
  assert.equal(toast.options.body, '本轮已完成')
  assert.equal(toast.options.tag, 's-1#1')

  // A repeated completion inside the engine's merge window stays one notification wave.
  mounted.source.emit('message', frameEvent(completedFrame()))
  assert.equal(mounted.notifications.filter((candidate) => candidate.closed === false).length, 1)
  mounted.dispose()
})

test('aborted / error / interrupted / forked / blocked / max-tokens frames never notify', async () => {
  const mounted = await mount()
  mounted.source.emit('open')

  for (const reason of ['aborted', 'error', 'interrupted', 'forked', 'blocked', 'max-tokens', 'unknown']) {
    mounted.source.emit('message', frameEvent({ type: 'turn/end', sessionId: 's-1', reasonKind: reason }))
  }
  assert.equal(mounted.notifications.length, 0, 'only a completed reason may notify')

  // A precise completion afterwards still goes through: only the bad reasons are dropped.
  mounted.source.emit('message', frameEvent(completedFrame()))
  assert.equal(mounted.notifications.length, 1)
  mounted.dispose()
})

test('a subagent turn completion is never shown as its own notification', async () => {
  const mounted = await mount({ rows: { 'main-1': { displayTitle: 'Main session', retainedBy: {} } } })
  mounted.source.emit('open')
  mounted.source.emit(
    'message',
    frameEvent(completedFrame({ sessionId: 'sub-1', origin: 'subagent', parentSession: 'main-1' })),
  )
  assert.equal(mounted.notifications.length, 0, 'subagent completions are merged into the main session')
  mounted.dispose()
})

test('unparseable frames only warn and the feed survives them', async () => {
  const mounted = await mount()
  mounted.source.emit('open')

  assert.doesNotThrow(() => mounted.source.emit('message', { data: '{not json' }))
  assert.ok(
    mounted.warnings.some((args) => String(args[0]).includes('unparseable')),
    'a bad frame is only warned about',
  )

  // Valid JSON that is not a completion frame is ignored quietly.
  assert.doesNotThrow(() => mounted.source.emit('message', frameEvent({ type: 'graph' })))
  assert.doesNotThrow(() => mounted.source.emit('message', frameEvent(completedFrame({ sessionId: '  ' }))))
  assert.equal(mounted.notifications.length, 0)

  // A reconnect error is native EventSource behavior: warn only, never throw.
  assert.doesNotThrow(() => mounted.source.emit('error'))
  assert.ok(mounted.warnings.some((args) => String(args[0]).includes('EventSource will retry')))

  // The feed keeps working after the error.
  mounted.source.emit('message', frameEvent(completedFrame()))
  assert.equal(mounted.notifications.length, 1)
  mounted.dispose()
})

test('dispose closes the feed and stops handling late frames', async () => {
  const mounted = await mount()
  mounted.source.emit('open')
  mounted.dispose()

  assert.equal(mounted.source.closed, true, 'the EventSource is closed on dispose')
  assert.equal((mounted.source.listeners.get('message') ?? []).length, 0, 'listeners are removed before closing')

  assert.doesNotThrow(() => mounted.source.emit('message', frameEvent(completedFrame())))
  assert.equal(mounted.notifications.length, 0, 'a disposed client must not react to late frames')
  assert.equal(
    mounted.warnings.filter((args) => String(args[0]).includes('cleanup failed')).length,
    0,
    'dispose never warns through DSH',
  )
})

test('a sandbox without EventSource keeps the P0 fallback and never crashes', async () => {
  const mounted = await mount({ eventSource: false })
  assert.equal(mounted.sources.length, 0, 'no EventSource means no feed')
  assert.equal(
    mounted.warnings.filter((args) => String(args[0]).includes('decision engine unavailable')).length,
    0,
    'a missing EventSource is not an engine failure',
  )

  runningEdge(mounted)
  assert.equal(mounted.notifications.length, 1, 'the P0 fallback stays available without a feed')
  mounted.dispose()
})
