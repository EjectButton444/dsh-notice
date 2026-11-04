/**
 * Host half of dsh-notice.
 *
 * Two jobs, both read-only side channels (ADR-0002):
 *
 * 1. Config (#5): expose the profile config (`cordis.patch.yml` loader-row `config`)
 *    as one read-only document-relative JSON route, `GET /dsh-notice/config` (served
 *    by `ctx.webServer`, the same mechanism the HMR package uses for `/plugins/events`).
 *    The browser half fetches it once per load.
 * 2. Click bridge (#6): `POST /dsh-notice/focus` restores, shows and focuses the
 *    Desktop window when a notification is clicked. The renderer cannot do this
 *    itself — a tray-hidden window is unreachable from the page, and `dsh://` navigations
 *    are swallowed — so the browser half asks the host, which spawns the shipped
 *    `focus.ps1` helper. The helper first wakes the window directly with
 *    `WM_SYSCOMMAND / SC_RESTORE` + `SetForegroundWindow` (this works even from the
 *    sandboxed low-integrity host, measured in docs/spikes/06-click-bridge.md) and
 *    falls back to `Start-Process 'dsh://open'`, the #3 baseline path where a second
 *    Desktop instance exits on the single-instance lock and the primary calls
 *    `focusPrimaryWindow()`.
 *
 * Config normalization/validation lives in the pure decision engine
 * (`client.engine.js`): a third-party host bundle cannot resolve the DSH-internal
 * `@deepseek-ai/schemastery` shared package at runtime (measured: ERR_MODULE_NOT_FOUND
 * from both the DSH Electron node and system node), so the loader passes the row
 * config through and the engine fills defaults / rejects unknown values. See
 * docs/spikes/05-notification-rules.md for the evidence and
 * docs/spikes/06-click-bridge.md for the click bridge evidence.
 *
 * The host half is a side channel only: no notification rules, every failure is only
 * logged, and the click bridge is fire-and-forget — it must never disturb DSH.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-notice'

/** `webServer` owns the HTTP route registry; without it neither route can exist. */
export const inject = ['webServer']

/** Route owned by this plugin; the browser half fetches it document-relative as `dsh-notice/config`. */
const CONFIG_ENDPOINT = '/dsh-notice/config'

/** Click bridge route; the browser half POSTs it document-relative as `dsh-notice/focus`. */
const FOCUS_ENDPOINT = '/dsh-notice/focus'

/**
 * Renderer-only marker header. A plain form post from a web page cannot set custom
 * headers, so the "restore and focus a window" side effect cannot be triggered
 * cross-origin without a CORS-preflighted request.
 */
const FOCUS_HEADER = 'x-dsh-notice-focus'
const FOCUS_HEADER_VALUE = '1'

/**
 * The window/focus helper shipped next to this file. Its first stage is the direct
 * Win32 path (posted `WM_SYSCOMMAND / SC_RESTORE` + `SetForegroundWindow`), which
 * works from the sandboxed low-integrity host; its fallback launches the registered
 * `dsh://open` protocol so the already running Desktop instance focuses itself via
 * `second-instance` -> `focusPrimaryWindow()` (the #3 baseline path).
 * Resolved through `import.meta.url` so a `link:` install and a copied install behave
 * the same.
 */
const FOCUS_HELPER = fileURLToPath(new URL('./focus.ps1', import.meta.url))

/** `powershell.exe` ships with Windows; `-ExecutionPolicy Bypass` avoids a machine/user Restricted policy for this process (a GPO-enforced policy still wins). */
const POWERSHELL_EXE = 'powershell.exe'
const FOCUS_ARGV = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FOCUS_HELPER]

/**
 * Switches that must not reach the helper. `ELECTRON_RUN_AS_NODE` is the critical one:
 * the DSH host runs with it set, and if the helper inherited it, the `dsh://open`
 * fallback would launch `DeepSeek Harness.exe` in Node mode, where it exits in
 * ~50–140ms without triggering `second-instance` (spike #3). `ELECTRON_NO_ATTACH_CONSOLE`
 * is the companion Electron-as-Node switch and is stripped for the same reason.
 * Environment names on Windows are case-insensitive, hence the uppercase comparison.
 */
const STRIPPED_HELPER_ENV = ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE']

/**
 * Mount the read-only config route and the notification click bridge.
 *
 * @param ctx - host plugin context (carries `webServer`).
 * @param config - the row config as validated by the loader, if any (else `undefined`).
 * @param overrides - test seam; `{ focusBridge }` replaces the real spawn with a double.
 */
export function apply(ctx, config, overrides = {}) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const focusBridge =
    overrides !== null && typeof overrides === 'object' && typeof overrides.focusBridge === 'function'
      ? overrides.focusBridge
      : createFocusBridge(overrides)
  mountRoute(ctx, CONFIG_ENDPOINT, (req, res) => serveConfig(req, res, settings), 'config route')
  mountRoute(ctx, FOCUS_ENDPOINT, (req, res) => serveFocus(req, res, focusBridge), 'focus route')
}

/** Register one route; a failure is logged and never escapes into DSH. */
function mountRoute(ctx, path, handler, label) {
  try {
    ctx.effect(() => {
      try {
        return ctx.webServer.register({ kind: 'exact', path, handler })
      } catch (error) {
        // Route registration failing must not take the plugin (or the session) down.
        console.warn(`[dsh-notice] ${label} registration failed`, error)
        return () => {}
      }
    }, `dsh-notice: ${label}`)
  } catch (error) {
    console.warn(`[dsh-notice] ${label} unavailable`, error)
  }
}

/**
 * Build the click bridge: spawn the shipped focus helper with an Electron-cleaned
 * environment. Returns `false` when it could not even try (unsupported platform or a
 * synchronous spawn failure); callers treat the result as advisory only.
 *
 * @param {{ spawn?: Function, platform?: string, env?: object }} [options] - test seam.
 * @returns {() => boolean}
 */
export function createFocusBridge(options = {}) {
  const spawnImpl = typeof options.spawn === 'function' ? options.spawn : spawn
  const platform = typeof options.platform === 'string' ? options.platform : process.platform
  const env = options.env !== null && typeof options.env === 'object' ? options.env : process.env

  return function requestFocus() {
    // v1 supports Windows Desktop only; elsewhere the renderer's best-effort focus stays.
    if (platform !== 'win32') return false
    try {
      const child = spawnImpl(POWERSHELL_EXE, FOCUS_ARGV, {
        // Do NOT use Node's `detached: true` here: it sets DETACHED_PROCESS, and together
        // with `stdio: 'ignore'` powershell.exe then exits immediately (code 0) without
        // running the helper (measured while verifying #6). A plain child is unref'ed
        // below, so the host never waits for it and still owns no shared stdio.
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        env: sanitizedEnvironment(env),
      })
      // An unhandled 'error' event would be an uncaught exception inside the DSH host;
      // the bridge is a side channel, so it is swallowed here.
      child?.on?.('error', (error) => warn('focus helper failed', error))
      child?.unref?.()
      return true
    } catch (error) {
      warn('focus helper failed', error)
      return false
    }
  }
}

/** Copy the environment without the Electron-as-Node switches. */
function sanitizedEnvironment(env) {
  const source = env !== null && typeof env === 'object' ? env : {}
  const sanitized = {}
  for (const key of Object.keys(source)) {
    if (STRIPPED_HELPER_ENV.includes(key.toUpperCase())) continue
    sanitized[key] = source[key]
  }
  return sanitized
}

/** Serve the row config; GET/HEAD only, never cached. */
function serveConfig(req, res, settings) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(JSON.stringify(settings))
  } catch (error) {
    // Best effort only: a broken config read must never break the session.
    try {
      res.destroy()
    } catch (_) {
      /* ignore */
    }
    console.warn('[dsh-notice] config route failed', error)
  }
}

/**
 * Serve the click bridge: only a marked renderer POST, acknowledged before the window
 * has even come back (the renderer never waits on it). Bridge failures are logged and
 * still acknowledged, so a click can never surface an error into the session.
 */
function serveFocus(req, res, focusBridge) {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    if (readHeader(req, FOCUS_HEADER) !== FOCUS_HEADER_VALUE) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      focusBridge()
    } catch (error) {
      // e.g. a failing spawn: the click stays silent, the session is unaffected.
      warn('focus bridge failed', error)
    }
    res.writeHead(204, { 'cache-control': 'no-store' })
    res.end()
  } catch (error) {
    try {
      res.destroy()
    } catch (_) {
      /* ignore */
    }
    warn('focus route failed', error)
  }
}

/** First value of one lowercase request header, if any. */
function readHeader(req, name) {
  const headers = req !== null && typeof req === 'object' ? req.headers : undefined
  if (headers === null || typeof headers !== 'object') return undefined
  const value = headers[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

/** Log one side-channel failure; console trouble must never break the plugin. */
function warn(message, error) {
  try {
    console.warn(`[dsh-notice] ${message}`, error)
  } catch (_) {
    /* ignore */
  }
}
