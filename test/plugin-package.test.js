// Contract tests for the dsh-notice plugin package.
//
// These verify the public boundaries the plugin depends on, not the notification
// decision rules:
//   A. the package the DSH plugin manager installs (manifest, bundle patch, shipped files),
//   B. the browser module contract consumed by DSH client-modules
//      (`window.__ModuleLoader__.load` -> factory -> inject -> apply -> engine chunk),
//   C. the click-bridge boundary: a renderer notification click POSTs the host route,
//      and the host spawns the shipped `focus.ps1` helper. The helper's Win32 behavior
//      itself only runs on a real Windows desktop and is covered by the real-machine
//      record in docs/spikes/06-click-bridge.md.
//
// The notification decision engine is unit-tested at its own seam in
// test/client-engine.test.js. The rest of the thin adapter (DSH state/locale sources,
// the toast sender's OS behavior) is covered by the real-machine checklist in docs/,
// as decided in docs/spec.md "Testing Decisions"; the two client tests below only
// exercise the adapter's package-level contracts with DSH and the host half.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { coveredByFiles, exists, manifest, read } from './helpers.js'

const runtimeFiles = ['index.js', 'client.js', 'client.engine.js', 'focus.ps1', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']

test('manifest declares a publishable dsh bundle with a browser half', () => {
  const pkg = manifest()

  assert.equal(pkg.name, 'dsh-notice')
  // v1.0.0 is the first public npm release; `private` must stay absent (or false)
  // or `npm publish` refuses the package.
  assert.ok(pkg.private === undefined || pkg.private === false, 'the package must be publishable to npm')
  assert.equal(pkg.publishConfig?.access, 'public', 'unscoped public package: publishConfig.access must stay public')
  assert.match(
    pkg.version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'the package version must be valid SemVer',
  )
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.description, 'package description feeds the plugin list one-liner and the npm page')
  assert.equal(pkg.license, 'MIT')

  // Repository metadata: the npm page and the plugin market link back to the source.
  assert.equal(pkg.author, 'EjectButton444')
  assert.equal(pkg.homepage, 'https://github.com/EjectButton444/dsh-notice')
  assert.equal(pkg.repository?.type, 'git')
  assert.equal(pkg.repository?.url, 'git+https://github.com/EjectButton444/dsh-notice.git')
  assert.equal(pkg.bugs?.url, 'https://github.com/EjectButton444/dsh-notice/issues')
  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.length >= 5,
    'keywords make the plugin findable on npm and in the plugin market',
  )
  for (const keyword of ['dsh', 'dsh-plugin', 'deepseek', 'notifications', 'windows']) {
    assert.ok(pkg.keywords.includes(keyword), `the ${keyword} keyword must stay advertised`)
  }

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

test('host half serves the profile config, the click bridge and the completion feed', async () => {
  const host = await import('../index.js')

  assert.equal(host.name, 'dsh-notice')
  assert.deepEqual(host.inject, ['webServer'], 'the host half needs the web-server route registry')
  assert.equal(typeof host.apply, 'function')

  const routes = []
  const settings = {
    events: { approval: false, question: true, turnComplete: true },
    condition: 'always',
    sound: false,
    mute: false,
  }
  host.apply(fakeCtx(routes), settings)

  assert.equal(routes.length, 3, 'the config route, the notification click bridge and the turn-completion feed are all mounted')
  const configRoute = routeAt(routes, '/dsh-notice/config')
  const focusRoute = routeAt(routes, '/dsh-notice/focus')
  const eventsRoute = routeAt(routes, '/dsh-notice/events')
  assert.equal(configRoute.kind, 'exact')
  assert.equal(focusRoute.kind, 'exact')
  assert.equal(eventsRoute.kind, 'exact')

  const response = fakeResponse()
  configRoute.handler({ method: 'GET' }, response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), settings, 'the browser half receives the effective profile config')
  assert.equal(response.headers['cache-control'], 'no-store')

  const rejected = fakeResponse()
  configRoute.handler({ method: 'POST' }, rejected)
  assert.equal(rejected.statusCode, 405, 'the config route is read-only')
})

test('click bridge spawns the shipped focus helper with an Electron-cleaned environment', async () => {
  const host = await import('../index.js')
  assert.equal(typeof host.createFocusBridge, 'function', 'the click bridge is testable without a DSH host')

  const spawnCalls = []
  const focusBridge = host.createFocusBridge({
    platform: 'win32',
    env: { PATH: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1', electron_no_attach_console: '1', SESSIONNAME: 'Console' },
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options })
      return { on() {}, unref() {} }
    },
  })

  const routes = []
  host.apply(fakeCtx(routes), {}, { focusBridge })

  const response = fakeResponse()
  routeAt(routes, '/dsh-notice/focus').handler({ method: 'POST', headers: { 'x-dsh-notice-focus': '1' } }, response)
  assert.equal(response.statusCode, 204, 'the renderer gets an immediate empty acknowledgement')
  assert.equal(response.body, undefined, '204 carries no body')

  assert.equal(spawnCalls.length, 1, 'one click spawns one focus helper')
  const [call] = spawnCalls
  assert.equal(call.command, 'powershell.exe', 'PowerShell ships with Windows; the helper ships as a script')
  assert.deepEqual(call.args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
  assert.equal(call.args[5], fileURLToPath(new URL('../focus.ps1', import.meta.url)), 'the shipped helper script is executed by path')
  assert.equal(call.args.length, 6, 'no diagnostic arguments leak into the production spawn')
  assert.ok(exists('focus.ps1'), 'the helper must exist in the package')
  // Node's detached spawn sets DETACHED_PROCESS, which makes powershell.exe with an
  // ignored stdio exit without running the script (measured during #6 verification);
  // the child is unref'ed below, so the host still does not wait for it.
  assert.equal(call.options.detached, false, 'the helper runs as a plain unref’ed child')
  assert.equal(call.options.stdio, 'ignore')
  assert.equal(call.options.windowsHide, true)
  assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, undefined, 'a Node-mode second instance exits without focusing (spike #3)')
  assert.equal(call.options.env.electron_no_attach_console, undefined, 'Electron-as-node switches are matched case-insensitively')
  assert.equal(call.options.env.PATH, 'C:\\Windows', 'the rest of the environment is inherited')
  assert.equal(call.options.env.SESSIONNAME, 'Console')
})

test('focus helper wakes the window through the app and keeps its fallbacks silent', () => {
  const helper = read('focus.ps1')

  // Primary path: run Electron's own tray-click handler so the app calls
  // focusPrimaryWindow() (external Win32 show leaves Chromium's renderer frozen).
  assert.match(helper, /Electron_NotifyIconHostWindow/, 'the helper finds Electron notify-icon host window')
  assert.match(helper, /TRAY_CLICK_MESSAGE = 0x8001/, 'the callback message is WM_APP+1 as in Electron 44')
  assert.match(helper, /TRAY_ICON_ID = 2/, 'Electron kBaseIconId is 2')
  assert.match(helper, /WM_LBUTTONDOWN/, 'Electron dispatches tray clicks on WM_LBUTTONDOWN')
  // Lock the actual posted message layout, not just the constants, so a drift in the
  // C# call (message/id/lParam order) fails the test instead of only real-machine checks.
  assert.match(
    helper,
    /PostMessage\(tray, TRAY_CLICK_MESSAGE, \(IntPtr\)iconId, \(IntPtr\)WM_LBUTTONDOWN\)/,
    'the tray click is posted as Electron expects',
  )
  assert.ok(
    helper.indexOf('[DshNoticeFocus]::TryTrayClick()') < helper.indexOf('[DshNoticeFocus]::Reveal()'),
    'the native tray path is attempted before the raw Win32 fallback',
  )
  assert.match(helper, /if \(\$state -ne 1\) \{ \$state = \[DshNoticeFocus\]::Reveal\(\) \}/, 'the Win32 fallback only runs when the tray path did not focus the window')

  // Fallback 1: raw Win32 wake/focus.
  assert.match(helper, /WM_SYSCOMMAND/, 'the helper can restore the window through taskbar-class messages')
  assert.match(helper, /SC_RESTORE/, 'a tray-hidden or minimized window is woken with SC_RESTORE')
  assert.match(helper, /SetForegroundWindow/, 'the helper then brings the window to the foreground')
  // Regression: a just-hidden window can still be GetForegroundWindow(), so "focused"
  // must require the window to be on screen too, otherwise clicks become no-ops.
  assert.match(helper, /alreadyThere && GetForegroundWindow\(\) == h/, 'focus is only assumed for a shown window')
  assert.match(helper, /OnScreen\(h\) && GetForegroundWindow\(\) == h/, 'FocusedNow uses the same on-screen guard')
  assert.match(helper, /ShowWindow\(h, SW_RESTORE\)/, 'a posted SC_RESTORE that is ignored falls back to ShowWindow')
  assert.match(helper, /AttachThreadInput/, 'the helper has a foreground-lock workaround for the background case')

  // Fallback 2: the #3 baseline protocol path, only when the window exists but could not be raised.
  assert.match(helper, /Start-Process 'dsh:\/\/open'/, 'the dsh:// protocol remains the last-resort path')
  assert.match(helper, /if \(\$state -eq 2\)/, 'the protocol fallback is gated on "window found but could not be raised"')
  assert.match(helper, /Chrome_WidgetWin_1/, 'the window is located by Chromium class + product title')

  // Side-channel rule: a helper failure must never raise into DSH.
  assert.match(helper, /\$ErrorActionPreference = 'SilentlyContinue'/)
  // Windows PowerShell 5.1 decodes BOM-less script files as ANSI; non-ASCII text in
  // the helper would be corrupted (measured during #6 verification).
  assert.match(helper, /^[\x00-\x7F]*$/, 'focus.ps1 must stay pure ASCII')
})

test('click bridge and its endpoint stay silent when the focus path fails', async () => {
  const host = await import('../index.js')

  // v1 supports Windows Desktop only; other platforms are a silent no-op.
  const unsupported = host.createFocusBridge({
    platform: 'linux',
    env: {},
    spawn() {
      throw new Error('must not spawn outside Windows')
    },
  })
  assert.equal(unsupported(), false)

  // A synchronous spawn failure is reported as false, never thrown.
  const broken = host.createFocusBridge({
    platform: 'win32',
    env: {},
    spawn() {
      throw new Error('spawn EPERM')
    },
  })
  assert.equal(broken(), false)

  // A child-process 'error' event must be swallowed: an unhandled one would crash the DSH host.
  let errorListener
  const flaky = host.createFocusBridge({
    platform: 'win32',
    env: {},
    spawn() {
      return {
        on(event, listener) {
          if (event === 'error') errorListener = listener
        },
        unref() {},
      }
    },
  })
  assert.equal(flaky(), true)
  assert.equal(typeof errorListener, 'function', 'the child error event is subscribed')
  assert.doesNotThrow(() => errorListener(new Error('spawn failed')), 'the side channel never propagates')

  // The route refuses anything but a marked renderer POST and never leaks a bridge failure.
  let bridgeCalls = 0
  const routes = []
  host.apply(fakeCtx(routes), {}, { focusBridge: () => { bridgeCalls += 1 } })
  const route = routeAt(routes, '/dsh-notice/focus')

  const unmarked = fakeResponse()
  route.handler({ method: 'POST', headers: {} }, unmarked)
  assert.equal(unmarked.statusCode, 403, 'a request without the renderer header is refused')
  assert.equal(bridgeCalls, 0)

  const wrongMethod = fakeResponse()
  route.handler({ method: 'GET', headers: { 'x-dsh-notice-focus': '1' } }, wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(bridgeCalls, 0)

  const throwingRoutes = []
  host.apply(fakeCtx(throwingRoutes), {}, {
    focusBridge() {
      throw new Error('bridge exploded')
    },
  })
  const failing = fakeResponse()
  routeAt(throwingRoutes, '/dsh-notice/focus').handler({ method: 'POST', headers: { 'x-dsh-notice-focus': '1' } }, failing)
  assert.equal(failing.statusCode, 204, 'a failing bridge still acknowledges silently; the renderer never waits on it')
})

/** Minimal host plugin context double that records mounted routes. */
function fakeCtx(routes) {
  return {
    effect(callback) {
      const dispose = callback()
      assert.equal(typeof dispose, 'function', 'the route registration must be disposable')
      return dispose
    },
    on(event, listener) {
      assert.equal(event, 'session/event', 'the host half only subscribes the session log')
      assert.equal(typeof listener, 'function')
      return () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
}

/** One mounted route by exact path. */
function routeAt(routes, path) {
  const route = routes.find((candidate) => candidate.path === path)
  assert.ok(route, `route ${path} must be mounted`)
  return route
}

/** A `window` double that records `__ModuleLoader__.load` registrations, like DSH does. */
function moduleLoaderWindow(extra = {}) {
  return {
    __ModuleLoader__: {
      registrations: [],
      load(definition) {
        this.registrations.push(definition)
      },
    },
    ...extra,
  }
}

/** Execute client.js in a vm the way DSH client-modules does; returns the module registration. */
function runClientScript(sandbox) {
  vm.runInContext(read('client.js'), vm.createContext(sandbox), { filename: 'client.js' })
  const registrations = sandbox.window.__ModuleLoader__.registrations
  assert.equal(registrations.length, 1, 'client.js registers exactly one module')
  return registrations[0]
}

/** Minimal Node response double for the host route handler. */
function fakeResponse() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
    destroy() {},
  }
}

test('client half follows the module loader contract, fetches the profile config and injects its DSH services', async () => {
  const window = moduleLoaderWindow()
  const configFetches = []
  const sandbox = {
    window,
    fetch: async (path, options) => {
      configFetches.push({ path, method: options !== undefined ? options.method : undefined })
      return { ok: true, json: async () => ({ mute: true }) }
    },
  }
  const registration = runClientScript(sandbox)

  assert.equal(registration.id, manifest().name, 'factory id must equal the package name')

  const requestedChunks = []
  const normalizedConfigs = []
  const fakeEngine = {
    EVENT_KINDS: [],
    DEFAULT_CONFIG: {},
    normalizeConfig(raw) {
      normalizedConfigs.push(raw)
      return { events: {}, condition: 'unfocused', sound: true, mute: false }
    },
    classifyPending: () => undefined,
    normalizeEvent: () => null,
    emptyState: () => ({ sessions: {} }),
    reduce: () => ({ state: { sessions: {} }, actions: [] }),
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
  assert.equal(configFetches.length, 1, 'the profile config is fetched once per client load')
  assert.equal(configFetches[0].path, 'dsh-notice/config', 'document-relative, served by the host half')
  assert.equal(configFetches[0].method, 'GET')
  assert.deepEqual(normalizedConfigs[normalizedConfigs.length - 1], { mute: true }, 'the raw route payload goes through engine normalization')
})

test('notification clicks call the host focus bridge and swallow an unreachable endpoint', async () => {
  const window = moduleLoaderWindow({
    focusCalls: 0,
    focus() {
      this.focusCalls += 1
    },
  })
  const fetches = []
  const warnings = []
  const notifications = []
  class FakeNotification {
    static permission = 'granted'
    constructor(title, options) {
      this.title = title
      this.options = options
      notifications.push(this)
    }
    close() {}
  }
  const sandbox = {
    window,
    // The vm context has no timers; client.js's config-fetch guard needs them.
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (timer) => clearTimeout(timer),
    console: {
      warn(...args) {
        warnings.push(args)
      },
    },
    Notification: FakeNotification,
    fetch(path, options) {
      fetches.push({ path, method: options !== undefined ? options.method : undefined, headers: options !== undefined ? options.headers : undefined })
      // The click bridge must be best effort: a dead host endpoint only warns.
      if (path === 'dsh-notice/focus') return Promise.reject(new Error('host endpoint down'))
      return Promise.resolve({ ok: true, json: async () => ({}) })
    },
  }
  const registration = runClientScript(sandbox)

  let statusListener
  let statuses = new Map()
  let rows = {}
  const openedSessions = []
  let failOpenSession = false
  let serviceAvailable = true
  const uiWorkspace = {
    openSession(sessionId) {
      if (failOpenSession) throw new Error('navigation failed')
      openedSessions.push(sessionId)
    },
  }
  const fakeEngine = {
    normalizeConfig: () => ({ events: { approval: true, question: true, turnComplete: true }, condition: 'unfocused', sound: true, mute: false }),
    classifyPending: () => undefined,
    emptyState: () => ({ sessions: {} }),
    reduce: (state, observation) =>
      observation.type === 'attention'
        ? { state, actions: [{ kind: 'show', event: 'turnComplete', title: 'Session A', body: 'Turn completed', tag: 's1', silent: false }] }
        : { state, actions: [] },
  }
  const plugin = registration.factory({
    async async() {
      return fakeEngine
    },
  })
  plugin.apply({
    uiSession: {
      sessionStatus: {
        getSnapshot: () => statuses,
        subscribe(listener) {
          statusListener = listener
          return () => {}
        },
      },
    },
    sessions: { list: { getSnapshot: () => ({ byId: rows }), subscribe: () => () => {} } },
    locale: { getSnapshot: () => ({ active: 'en' }) },
    // Cordis client-service lookup used to select the notification's session.
    get(name) {
      if (name !== 'uiWorkspace' || !serviceAvailable) return undefined
      return uiWorkspace
    },
    effect(callback) {
      callback()
    },
  })
  await new Promise((resolve) => setImmediate(resolve))

  // `running: true -> false` edge -> the P0 turn-completion toast (ticket #5 rules).
  statuses = new Map([['s1', { running: true }]])
  statusListener()
  statuses = new Map([['s1', { running: false }]])
  rows = { s1: { displayTitle: 'Session A', retainedBy: {} } }
  statusListener()

  assert.equal(notifications.length, 1, 'the adapter renders the engine action as a notification')
  const [toast] = notifications
  assert.equal(typeof toast.onclick, 'function')

  toast.onclick()
  await new Promise((resolve) => setImmediate(resolve))

  const focusRequest = fetches.find((call) => call.path === 'dsh-notice/focus')
  assert.ok(focusRequest, 'clicking the notification calls the host click bridge')
  assert.equal(focusRequest.method, 'POST')
  assert.equal(focusRequest.headers['x-dsh-notice-focus'], '1', 'the renderer marks the click-bridge intent header')
  assert.deepEqual(openedSessions, ['s1'], 'clicking the notification selects its session through the public uiWorkspace service')
  assert.equal(window.focusCalls, 1, 'the renderer keeps its P0 best-effort focus as a fallback')
  assert.ok(
    warnings.some((args) => String(args[0]).includes('host focus request failed')),
    'an unreachable host endpoint is only warned about, never thrown into DSH',
  )

  // A session that cannot be opened must not break the click bridge.
  failOpenSession = true
  const focusRequestsBefore = fetches.filter((call) => call.path === 'dsh-notice/focus').length
  assert.doesNotThrow(() => toast.onclick(), 'a failed session selection never throws into DSH')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fetches.filter((call) => call.path === 'dsh-notice/focus').length, focusRequestsBefore + 1, 'the click bridge still runs')
  assert.ok(
    warnings.some((args) => String(args[0]).includes('open session on click failed')),
    'a failed session selection is only warned about',
  )

  // A trimmed UI without the uiWorkspace service keeps the old behavior: focus only.
  serviceAvailable = false
  failOpenSession = false
  const focusRequestsWithoutService = fetches.filter((call) => call.path === 'dsh-notice/focus').length
  const openFailuresBefore = warnings.filter((args) => String(args[0]).includes('open session on click failed')).length
  assert.doesNotThrow(() => toast.onclick(), 'a missing session service never throws into DSH')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fetches.filter((call) => call.path === 'dsh-notice/focus').length, focusRequestsWithoutService + 1, 'the click bridge still runs')
  assert.equal(
    warnings.filter((args) => String(args[0]).includes('open session on click failed')).length,
    openFailuresBefore,
    'an absent service is not a failure',
  )
  assert.deepEqual(openedSessions, ['s1'], 'no session selection happens when the service is absent')
})
