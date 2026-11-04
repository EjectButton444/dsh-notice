/**
 * Host half of dsh-notice.
 *
 * Three jobs, all side channels (ADR-0002):
 *
 * 1. Config (#5): expose the profile config (`cordis.patch.yml` loader-row `config`)
 *    as one read-only document-relative JSON route, `GET /dsh-notice/config` (served
 *    by `ctx.webServer`, the same mechanism the HMR package uses for `/plugins/events`).
 *    The browser half fetches it once per load.
 * 2. Click bridge (#6): `POST /dsh-notice/focus` restores, shows and focuses the
 *    Desktop window when a notification is clicked. The renderer cannot do this
 *    itself — a tray-hidden window is unreachable from the page, and `dsh://` navigations
 *    are swallowed — so the browser half asks the host, which spawns the shipped
 *    `focus.ps1` helper. The helper's primary path posts Electron's own tray-click
 *    message to `Electron_NotifyIconHostWindow` (`WM_APP+1` / icon id 2 /
 *    `WM_LBUTTONDOWN`), so the app itself runs `focusPrimaryWindow()` and performs a
 *    native restore + show + focus (the only path that leaves the renderer interactive;
 *    measured in docs/spikes/06-click-bridge.md). Raw Win32 wake-up messages are the
 *    fallback, and `Start-Process 'dsh://open'` is the last resort.
 * 3. Precise turn completion (#7): subscribe to the session log's `turn/end` events and
 *    broadcast only `reason.kind === 'completed'` as frames over a document-relative
 *    SSE route, `GET /dsh-notice/events`. The browser half needs the exact reason: its
 *    own `running` edge cannot tell a real completion from Stop, an error, a crash
 *    recovery or a token cap. The notification rules stay in the browser half; the
 *    host only normalizes and transports.
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

/** `webServer` owns the HTTP route registry; without it no host route can exist. */
export const inject = ['webServer']

/** Route owned by this plugin; the browser half fetches it document-relative as `dsh-notice/config`. */
const CONFIG_ENDPOINT = '/dsh-notice/config'

/** Click bridge route; the browser half POSTs it document-relative as `dsh-notice/focus`. */
const FOCUS_ENDPOINT = '/dsh-notice/focus'

/** Completion-feed route; the browser half consumes it document-relative as `dsh-notice/events`. */
const EVENTS_ENDPOINT = '/dsh-notice/events'

/**
 * The only `turn/end` reason that reaches the browser half (ticket #7). It is both the
 * accepted DSH reason kind and the wire value of the frame's `reasonKind` field.
 */
const TURN_END_COMPLETED = 'completed'

/**
 * Renderer-only marker header. A plain form post from a web page cannot set custom
 * headers, so the "restore and focus a window" side effect cannot be triggered
 * cross-origin without a CORS-preflighted request.
 */
const FOCUS_HEADER = 'x-dsh-notice-focus'
const FOCUS_HEADER_VALUE = '1'

/**
 * The window/focus helper shipped next to this file. Its primary stage posts Electron's
 * tray-click message to the app's `Electron_NotifyIconHostWindow` so the application
 * itself runs `focusPrimaryWindow()` (a native restore + show + focus; external Win32
 * display leaves Chromium's renderer frozen). Raw Win32 wake-up messages are the
 * first fallback and `dsh://open` the last resort. Resolved through `import.meta.url`
 * so a `link:` install and a copied install behave the same.
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
 * Convert one DSH session event into a turn-completion feed frame.
 *
 * Only a `turn/end` whose `reason.kind` is `completed` counts: `aborted` (Stop),
 * `blocked`, `error`, `interrupted` (crash recovery), `forked` (fork seed) and
 * `max-tokens` all end a turn without the assistant handing control back to the
 * user, so they must never become a completion notification. This is the pure
 * decision seam for that rule and it never throws: a malformed or hostile
 * session/event shape is simply not a completion (ticket #7 red line, risk R4).
 *
 * @param session - the session the event was appended to (carries `id` and `header`).
 * @param event - the session log event as appended by DSH.
 * @returns a `{ type, sessionId, reasonKind, turn?, origin?, parentSession? }` frame,
 *   or `null` when the event is not a completed turn end.
 */
export function toCompletionFrame(session, event) {
  try {
    if (event === null || typeof event !== 'object') return null
    if (event.type !== 'turn/end') return null
    const data = event.data
    if (data === null || typeof data !== 'object') return null
    const reason = data.reason
    if (reason === null || typeof reason !== 'object' || reason.kind !== TURN_END_COMPLETED) return null
    const sessionId = session === null || typeof session !== 'object' ? undefined : session.id
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null

    const frame = { type: 'turn/end', sessionId, reasonKind: TURN_END_COMPLETED }
    // `turn` is observational only (reading the raw feed is easier for a human);
    // neither half's decision depends on it.
    if (typeof data.turn === 'number') frame.turn = data.turn
    const delegation = sessionDelegation(session)
    if (delegation.origin !== undefined) frame.origin = delegation.origin
    if (delegation.parentSession !== undefined) frame.parentSession = delegation.parentSession
    return frame
  } catch (error) {
    // A hostile session/event shape must never surface as a host-hook exception.
    warn('turn/end normalization failed', error)
    return null
  }
}

/**
 * Read the optional delegation metadata off a session header.
 *
 * The header is decoration on the frame, not the decision: a failing header read
 * still yields a completion frame, just without `origin` / `parentSession`.
 *
 * @param session - a session that already passed the id check.
 * @returns `{ origin?, parentSession? }`, both absent for a primary session.
 */
function sessionDelegation(session) {
  try {
    const header = session.header
    if (header === null || typeof header !== 'object') return {}
    const delegation = {}
    if (header.origin === 'subagent') delegation.origin = 'subagent'
    if (typeof header.parentSession === 'string' && header.parentSession.length > 0) {
      delegation.parentSession = header.parentSession
    }
    return delegation
  } catch (_) {
    // Optional metadata only; never drop the completion frame over it.
    return {}
  }
}

/** SSE response headers for the completion feed; consumed with a document-relative request. */
const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
}

/** Serialize one feed frame as an SSE data line (the same wire format `dsh-client-hmr` uses). */
function sseFrame(frame) {
  return `data: ${JSON.stringify(frame)}\n\n`
}

/**
 * Create the completion-feed broadcaster: the set of connected SSE responses plus the
 * publish step that the `session/event` hook drives.
 *
 * A stream belongs to the plugin instance, not to one session: every connected
 * browser tab receives every completed turn and the browser half decides which
 * session it cares about. Every write is guarded, so one dead or hostile response
 * can never break the feed or escape into the session/event dispatch (ticket #7
 * red line: host hooks must never throw).
 *
 * @returns `{ connect(res), publish(session, event), close() }`.
 */
export function createCompletionFeed() {
  const connections = new Set()

  /** Start one SSE stream: handshake, tracking, and close bookkeeping. */
  function connect(res) {
    try {
      res.writeHead(200, SSE_HEADERS)
      res.write(': connected\n\n')
      connections.add(res)
      try {
        res.on('close', () => connections.delete(res))
        // An async socket failure after these synchronous writes is outside publish's
        // try/catch, and an unhandled response 'error' event would crash the host:
        // drop that one stream here instead (ticket #7 red line).
        res.on('error', () => drop(res))
      } catch (error) {
        // Without the close signal the stream would leak; drop it right away.
        drop(res)
        warn('events stream close hook failed', error)
      }
    } catch (error) {
      drop(res)
      warn('events stream failed', error)
    }
  }

  /** Normalize one session event and broadcast it; non-completions are dropped. */
  function publish(session, event) {
    try {
      const frame = toCompletionFrame(session, event)
      if (frame === null) return
      const line = sseFrame(frame)
      for (const res of connections) {
        try {
          res.write(line)
        } catch (error) {
          // A write failure means the browser side is gone; drop that stream only.
          drop(res)
          warn('events stream write failed', error)
        }
      }
    } catch (error) {
      // The listener runs inside the host's session log dispatch; nothing escapes.
      warn('events broadcast failed', error)
    }
  }

  /** Forget and destroy one stream; idempotent and never throws. */
  function drop(res) {
    connections.delete(res)
    destroyQuietly(res)
  }

  /** Close the feed: destroy every stream and stop tracking it. */
  function close() {
    for (const res of connections) {
      try {
        res.destroy()
      } catch (error) {
        warn('events stream close failed', error)
      }
    }
    connections.clear()
  }

  return { connect, publish, close }
}

/** Destroy one response without letting its failure escape. */
function destroyQuietly(res) {
  try {
    res.destroy()
  } catch (_) {
    /* ignore */
  }
}

/**
 * Mount the read-only config route, the notification click bridge and the
 * precise turn-completion feed.
 *
 * @param ctx - host plugin context (carries `webServer` and the event bus).
 * @param config - the row config as validated by the loader, if any (else `undefined`).
 * @param overrides - test seam; `{ focusBridge }` replaces the real spawn with a double.
 */
export function apply(ctx, config, overrides = {}) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const focusBridge =
    overrides !== null && typeof overrides === 'object' && typeof overrides.focusBridge === 'function'
      ? overrides.focusBridge
      : createFocusBridge(overrides)
  const feed = createCompletionFeed()
  mountRoute(ctx, CONFIG_ENDPOINT, (req, res) => serveConfig(req, res, settings), 'config route')
  mountRoute(ctx, FOCUS_ENDPOINT, (req, res) => serveFocus(req, res, focusBridge), 'focus route')
  mountRoute(ctx, EVENTS_ENDPOINT, (req, res) => serveEvents(req, res, feed), 'events route')
  mountSessionEvents(ctx, feed)
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
 * Subscribe the completion feed to the session log inside one disposable effect.
 *
 * The listener runs inside the host's `session/event` dispatch; it must never throw,
 * because an exception there is exactly the "worse than no plugin" case from ticket
 * #7. `feed.publish` already swallows everything, and a missing or throwing event
 * bus is only logged, so the routes still mount and the plugin stays inert.
 */
function mountSessionEvents(ctx, feed) {
  try {
    ctx.effect(() => {
      let unsubscribe
      try {
        if (typeof ctx.on === 'function') {
          unsubscribe = ctx.on('session/event', (session, event) => feed.publish(session, event))
        } else {
          warn('session/event subscription unavailable')
        }
      } catch (error) {
        warn('session/event subscription failed', error)
      }
      return () => {
        try {
          if (typeof unsubscribe === 'function') unsubscribe()
        } catch (error) {
          warn('session/event unsubscribe failed', error)
        }
        feed.close()
      }
    }, 'dsh-notice: turn/end feed')
  } catch (error) {
    warn('events feed unavailable', error)
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

/**
 * Serve the completion feed: `GET` opens an SSE stream, `HEAD` announces the stream
 * headers without opening one, every other method is refused. A failing response is
 * destroyed and logged; nothing escapes into the host.
 */
function serveEvents(req, res, feed) {
  try {
    if (req.method === 'HEAD') {
      res.writeHead(200, SSE_HEADERS)
      res.end()
      return
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    feed.connect(res)
  } catch (error) {
    destroyQuietly(res)
    warn('events route failed', error)
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
