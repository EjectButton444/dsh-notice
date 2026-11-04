/**
 * Browser half of dsh-notice — the thin adapter around the decision engine.
 *
 * Attention sources (docs/design-notes.md §2), all observed, never hijacked:
 *   - `uiSession.sessionStatus` — `pendingInteraction.kind` for authorization and
 *     question requests, the `running: true -> false` edge used as the P0
 *     turn-completion approximation, and `completionUnread` for "completion seen";
 *   - `sessions.list` — `displayTitle` / `cwd` for the toast, `parentId` / `origin`
 *     for subagent attribution, `retainedBy.mainView` for per-session foreground
 *     suppression.
 *
 * The pure reducer lives in ./client.engine.js (package-local client chunk). This
 * file only turns DSH state changes into engine observations (attention /
 * pendingResolved / viewed), applies the returned actions to Web Notifications,
 * fetches the profile config from the host half (`GET /dsh-notice/config`), and asks
 * the host click bridge to focus the window on notification click
 * (`POST /dsh-notice/focus`, ticket #6). It is a read-only side channel: every
 * callback is wrapped so an exception can never disturb DSH (ADR-0002).
 *
 * Everything stays inside one IIFE: HMR re-executes client scripts, so a
 * top-level `const`/`let` would throw "already declared" on the second execution
 * and silently break every hot update.
 */
;(function () {
  'use strict'

  const ENGINE_CHUNK = './client.engine.js'
  /** Document-relative route served by the host half (index.js). */
  const CONFIG_PATH = 'dsh-notice/config'
  /**
   * Host click bridge (#6). The renderer cannot wake a tray-hidden window
   * (`window.focus()` is a no-op there and `dsh://` navigations are swallowed), so a
   * notification click asks the host to restore + show + focus the window.
   */
  const FOCUS_PATH = 'dsh-notice/focus'
  /** Renderer-only marker; the host refuses unmarked requests. */
  const FOCUS_HEADER = 'x-dsh-notice-focus'
  const LOG_PREFIX = '[dsh-notice]'
  /** A hung config fetch must not leave notifications silently disabled forever. */
  const CONFIG_TIMEOUT_MS = 3000
  /**
   * Electron/Windows quirk (measured during #5 acceptance): creating a toast while
   * another toast with the same `tag` still exists makes the platform deliver
   * `close` to the new object immediately, and its later `close()` becomes a
   * no-op, which leaks entries into the notification center. The adapter therefore
   * uses engine tags as the *state key* and a unique renderer toast tag per wave
   * (`<tag>#<n>`), closing the previous toast explicitly when a session's
   * notification must be replaced or resolved.
   */
  let toastSequence = 0

  window.__ModuleLoader__.load({
    id: 'dsh-notice',
    factory(require) {
      return {
        // Cordis service dependencies; resolved before apply() runs.
        inject: ['uiSession', 'sessions', 'locale'],
        apply(ctx) {
          ctx.effect(() => {
            let dispose = () => {}
            let cancelled = false

            loadEngine(require)
              .then((engine) => loadConfig(engine).then((config) => ({ engine, config })))
              .then(({ engine, config }) => {
                if (cancelled) return
                dispose = watchAttention(ctx, engine, config)
              })
              .catch((error) => warn('decision engine unavailable; notifications are off', error))

            return () => {
              cancelled = true
              try {
                dispose()
              } catch (error) {
                warn('cleanup failed', error)
              }
              dispose = () => {}
            }
          }, 'dsh-notice: attention events')
        },
      }
    },
  })

  /** Load the pure engine chunk; the module table contract is `require.async`. */
  function loadEngine(require) {
    if (require === undefined || require === null || typeof require.async !== 'function') {
      return Promise.reject(new Error('package-local client chunks unavailable (require.async missing)'))
    }
    return require.async(ENGINE_CHUNK)
  }

  /** Fetch the host-served profile config; defaults when it is unreachable. */
  function loadConfig(engine) {
    const fallback = engine.normalizeConfig(undefined)
    try {
      if (typeof fetch !== 'function') return Promise.resolve(fallback)
      const request = fetch(CONFIG_PATH, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' })
        .then((response) => (response !== undefined && response.ok === true ? response.json() : undefined))
        .then((raw) => engine.normalizeConfig(raw))
        .catch((error) => {
          warn('config fetch failed; using defaults', error)
          return fallback
        })
      return withTimeout(request, CONFIG_TIMEOUT_MS, fallback)
    } catch (error) {
      warn('config fetch failed; using defaults', error)
      return Promise.resolve(fallback)
    }
  }

  /** Resolve with `fallback` if `promise` does not settle within `ms` (cold-start safety). */
  function withTimeout(promise, ms, fallback) {
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  /**
   * Ask the host half to restore + show + focus the DSH window. Fire-and-forget: the
   * renderer never reads the response, and a broken host endpoint only warns — a click
   * must never surface an error into the session (ADR-0002).
   */
  function requestHostFocus() {
    try {
      if (typeof fetch !== 'function') return
      const request = fetch(FOCUS_PATH, { method: 'POST', headers: { [FOCUS_HEADER]: '1' } })
      if (request !== undefined && request !== null && typeof request.catch === 'function') {
        request.catch((error) => warn('host focus request failed (silent)', error))
      }
    } catch (error) {
      warn('host focus request failed (silent)', error)
    }
  }

  /**
   * Subscribe to the attention sources, translate transitions into observations for
   * the engine, and apply the returned notification actions. Returns a disposer
   * that unsubscribes and closes live toasts.
   */
  function watchAttention(ctx, engine, config) {
    const sessionStatus = ctx.uiSession.sessionStatus
    const sessions = ctx.sessions
    let state = engine.emptyState()
    const notifications = new Map()
    const previousRunning = new Map()
    const previousPending = new Map()
    const previousCompletionUnread = new Map()
    /** source session id -> notification target (main session id) while a pending item is tracked. */
    const pendingTargets = new Map()
    let previousViewedSessionId
    let previousFocused = false
    let primed = false

    function canNotify() {
      if (typeof Notification === 'undefined' || Notification === undefined) return false
      return Notification.permission !== 'denied'
    }

    function createToast(action) {
      try {
        if (!canNotify()) return
        toastSequence += 1
        const toast = new Notification(action.title, {
          body: action.body,
          tag: `${action.tag}#${toastSequence}`,
          silent: action.silent === true,
        })
        toast.onclick = () => {
          // P0 best effort first (visible-window focus), then the host click bridge,
          // which is the only path that can restore a tray-hidden window (#6).
          try {
            window.focus()
          } catch (error) {
            warn('focus on click failed', error)
          }
          requestHostFocus()
        }
        notifications.set(action.tag, toast)
      } catch (error) {
        warn('toast send failed', error)
      }
    }

    /** Show a toast; replacing the session's current one closes it first. */
    function showToast(action) {
      try {
        if (!canNotify()) return
        if (notifications.has(action.tag)) closeToast(action.tag)
        createToast(action)
      } catch (error) {
        warn('toast send failed', error)
      }
    }

    function closeToast(tag) {
      try {
        const toast = notifications.get(tag)
        if (toast === undefined) return
        notifications.delete(tag)
        toast.close?.()
      } catch (error) {
        warn('toast close failed', error)
      }
    }

    function dispatch(action) {
      try {
        if (action === null || typeof action !== 'object') return
        if (action.kind === 'show' || action.kind === 'replace') showToast(action)
        else if (action.kind === 'close') closeToast(action.tag)
      } catch (error) {
        warn('notification action failed', error)
      }
    }

    function observe(observation, rows) {
      const result = engine.reduce(state, observation, readRuntime(rows), config, Date.now())
      state = result.state
      for (const action of result.actions) dispatch(action)
    }

    function reconcile() {
      try {
        const statuses = sessionStatus.getSnapshot()
        const rows = sessionRows(ctx)
        const locale = currentLocale(ctx)
        const viewedSessionId = mainViewSessionId(rows)
        const focused = windowHasFocus()

        for (const [sessionId, status] of statuses) {
          const row = rows[sessionId]

          // Pending interaction appears or changes kind -> authorization / question request.
          const pendingKind =
            status.pendingInteraction !== undefined && status.pendingInteraction !== null
              ? engine.classifyPending(status.pendingInteraction.kind)
              : undefined
          const previousKind = previousPending.get(sessionId)
          previousPending.set(sessionId, pendingKind)
          if (primed && pendingKind !== undefined && pendingKind !== previousKind) {
            const attribution = attribute(ctx, sessionId, row, rows, locale)
            pendingTargets.set(sessionId, attribution.mainSessionId !== undefined ? attribution.mainSessionId : sessionId)
            observe({ type: 'attention', event: { sessionId, kind: pendingKind, ...attribution } }, rows)
          } else if (primed && pendingKind === undefined && previousKind !== undefined) {
            const target = pendingTargets.get(sessionId)
            pendingTargets.delete(sessionId)
            const mainSessionId = target !== undefined ? target : mainSessionIdOrSelf(sessionId, row, rows)
            observe({ type: 'pendingResolved', sessionId, mainSessionId }, rows)
          }

          // `running` true -> false edge -> P0 turn completion (Stop/error also end a
          // turn this way; ticket #7 replaces this feed with the host `turn/end` reason).
          // The engine drops subagent completions; the adapter only skips sessions it
          // has no list row for (attribution and title come from that row).
          const running = status.running === true
          const wasRunning = previousRunning.get(sessionId) === true
          previousRunning.set(sessionId, running)
          if (primed && wasRunning && !running && row !== undefined && row !== null) {
            observe(
              { type: 'attention', event: { sessionId, kind: 'turnComplete', ...attribute(ctx, sessionId, row, rows, locale) } },
              rows,
            )
          }

          // DSH clears completionUnread once the human has seen the finished session.
          const unread = status.completionUnread === true
          const wasUnread = previousCompletionUnread.get(sessionId) === true
          previousCompletionUnread.set(sessionId, unread)
          if (primed && wasUnread && !unread) observe({ type: 'viewed', sessionId }, rows)
        }

        if (primed) {
          // Opening a session (or coming back to the window on it) means its completion was seen.
          if (viewedSessionId !== undefined && viewedSessionId !== previousViewedSessionId) {
            observe({ type: 'viewed', sessionId: viewedSessionId }, rows)
          } else if (focused && !previousFocused && viewedSessionId !== undefined) {
            observe({ type: 'viewed', sessionId: viewedSessionId }, rows)
          }
        }
        previousViewedSessionId = viewedSessionId
        previousFocused = focused

        // A pending item whose session disappeared from the snapshot can never be
        // resolved by a later event; close it instead of leaking an orphan toast.
        for (const sessionId of previousPending.keys()) {
          if (statuses.has(sessionId)) continue
          const previousKind = previousPending.get(sessionId)
          const target = pendingTargets.get(sessionId)
          pendingTargets.delete(sessionId)
          if (previousKind !== undefined) observe({ type: 'pendingResolved', sessionId, mainSessionId: target !== undefined ? target : sessionId }, rows)
        }
        prune(previousRunning, statuses)
        prune(previousPending, statuses)
        prune(previousCompletionUnread, statuses)
        primed = true
      } catch (error) {
        warn('attention reconcile failed', error)
      }
    }

    const disposeStatus = sessionStatus.subscribe(reconcile)
    const disposeList = sessions.list.subscribe(reconcile)
    // Focus can change without any session status/list update; the `viewed` close
    // rule needs the edge, so listen for it explicitly.
    const onWindowFocus = () => reconcile()
    let listeningForFocus = false
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', onWindowFocus)
        listeningForFocus = true
      }
    } catch (error) {
      warn('focus listener unavailable', error)
    }

    // Prime the transition maps with the state that already exists at load time:
    // pre-existing pending interactions must not fire a toast just because the
    // plugin started. Real events arrive through the subscriptions from now on.
    reconcile()

    return () => {
      try {
        if (typeof disposeStatus === 'function') disposeStatus()
      } catch (error) {
        warn('status unsubscribe failed', error)
      }
      try {
        if (typeof disposeList === 'function') disposeList()
      } catch (error) {
        warn('session list unsubscribe failed', error)
      }
      if (listeningForFocus) {
        try {
          window.removeEventListener('focus', onWindowFocus)
        } catch (error) {
          warn('focus listener cleanup failed', error)
        }
      }
      for (const toast of notifications.values()) {
        try {
          toast.close?.()
        } catch (error) {
          warn('toast cleanup failed', error)
        }
      }
      notifications.clear()
    }
  }

  /** Identity + label inputs for one session (subagent work is attributed to its main session). */
  function attribute(ctx, sessionId, row, rows, locale) {
    const isSubagent = isSubagentSession(row)
    const mainSessionId = isSubagent ? mainSessionIdOf(sessionId, rows) : undefined
    const labelRow = mainSessionId !== undefined ? rows[mainSessionId] : row
    return {
      isSubagent,
      mainSessionId,
      title: labelRow !== undefined && labelRow !== null ? labelRow.displayTitle : undefined,
      workspace: workspaceOf(labelRow !== undefined && labelRow !== null ? labelRow.cwd : undefined),
      locale,
    }
  }

  function mainSessionIdOrSelf(sessionId, row, rows) {
    if (!isSubagentSession(row)) return sessionId
    return mainSessionIdOf(sessionId, rows)
  }

  function prune(map, statuses) {
    for (const sessionId of map.keys()) {
      if (!statuses.has(sessionId)) map.delete(sessionId)
    }
  }

  function sessionRows(ctx) {
    try {
      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot !== undefined && snapshot !== null && typeof snapshot.byId === 'object' && snapshot.byId !== null) {
        return snapshot.byId
      }
    } catch (error) {
      warn('session list read failed', error)
    }
    return {}
  }

  /** Window focus + the session currently on the main view: the per-session suppression inputs. */
  function readRuntime(rows) {
    return { focused: windowHasFocus(), viewedSessionId: mainViewSessionId(rows) }
  }

  function windowHasFocus() {
    try {
      return typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus() === true
    } catch (error) {
      return false
    }
  }

  /** The main view retains exactly one session; first match wins if DSH ever reports several. */
  function mainViewSessionId(rows) {
    try {
      for (const sessionId of Object.keys(rows)) {
        const retainedBy = rows[sessionId].retainedBy
        if (retainedBy !== undefined && retainedBy !== null && (retainedBy.mainView || 0) > 0) return sessionId
      }
    } catch (error) {
      warn('main view read failed', error)
    }
    return undefined
  }

  function isSubagentSession(row) {
    if (row === undefined || row === null) return false
    // `parentId` is absent on main rows; treat an explicit null like absent so a
    // malformed row cannot silently drop its main-session notification.
    return row.origin === 'subagent' || (row.parentId !== undefined && row.parentId !== null)
  }

  /** Walk parentId up to the main session; undefined when the chain is incomplete. */
  function mainSessionIdOf(sessionId, rows) {
    const seen = new Set([sessionId])
    let mainSessionId = sessionId
    let cursor = rows[sessionId]
    while (cursor !== undefined && cursor !== null) {
      const parentId = cursor.parentId
      if (parentId === undefined || parentId === null) {
        return mainSessionId === sessionId ? undefined : mainSessionId
      }
      if (seen.has(parentId)) return undefined
      const parent = rows[parentId]
      if (parent === undefined || parent === null) return undefined
      seen.add(parentId)
      mainSessionId = parentId
      cursor = parent
    }
    return undefined
  }

  /** Last path segment of the session cwd, used only by the unnamed-session title fallback. */
  function workspaceOf(cwd) {
    if (typeof cwd !== 'string' || cwd.trim() === '') return undefined
    const parts = cwd.split(/[\\/]+/).filter((part) => part !== '')
    return parts.length === 0 ? undefined : parts[parts.length - 1]
  }

  /** Active DSH interface locale (zh / en); the engine resolves fallbacks. */
  function currentLocale(ctx) {
    try {
      const localeService = ctx !== undefined && ctx !== null ? ctx.locale : undefined
      if (localeService === undefined || localeService === null) return undefined
      if (typeof localeService.getSnapshot !== 'function') return undefined
      const snapshot = localeService.getSnapshot()
      const active = snapshot !== undefined && snapshot !== null ? snapshot.active : undefined
      return typeof active === 'string' ? active : undefined
    } catch (error) {
      return undefined
    }
  }

  function warn(message, error) {
    try {
      console.warn(`${LOG_PREFIX} ${message}`, error)
    } catch (_) {
      /* the console itself must never break the plugin */
    }
  }
})()
