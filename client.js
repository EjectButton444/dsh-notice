/**
 * Browser half of dsh-notice — the thin adapter around the decision engine.
 *
 * Attention sources (docs/design-notes.md §2), all observed, never hijacked:
 *   - `uiSession.sessionStatus` — `pendingInteraction.kind` for authorization and
 *     question requests, and the `running: true -> false` edge used as the P0
 *     turn-completion approximation;
 *   - `sessions.list` — `displayTitle` / `cwd` for the toast, `parentId` / `origin`
 *     for subagent attribution, `retainedBy.mainView` for per-session foreground
 *     suppression.
 *
 * The pure decision pipeline lives in ./client.engine.js and is loaded as a
 * package-local client chunk (`require.async`). This file only feeds DSH state in
 * and Web Notifications out: no notification rules live here. It is a read-only
 * side channel: every callback is wrapped so an exception can never disturb DSH
 * (ADR-0002).
 *
 * Everything stays inside one IIFE: HMR re-executes client scripts, so a
 * top-level `const`/`let` would throw "already declared" on the second execution
 * and silently break every hot update.
 */
;(function () {
  'use strict'

  const ENGINE_CHUNK = './client.engine.js'
  const LOG_PREFIX = '[dsh-notice]'

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
              .then((engine) => {
                if (cancelled) return
                dispose = watchAttention(ctx, engine)
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

  /**
   * Subscribe to the attention sources and turn observed transitions into
   * notifications. Returns a disposer that unsubscribes and closes live toasts.
   */
  function watchAttention(ctx, engine) {
    const previousRunning = new Map()
    const previousPending = new Map()
    const notifications = new Map()
    let primed = false

    /** Normalized observation -> engine decision -> Web Notification. */
    function notifyAttention(sessionId, kind, row, rows, runtime) {
      try {
        const subagent = isSubagentSession(row)
        const mainSessionId = subagent ? mainSessionIdOf(sessionId, rows) : undefined
        const labelRow = mainSessionId !== undefined ? rows[mainSessionId] : row

        const event = engine.normalizeEvent({
          sessionId,
          kind,
          isSubagent: subagent,
          mainSessionId,
          title: labelRow !== undefined && labelRow !== null ? labelRow.displayTitle : undefined,
          workspace: workspaceOf(labelRow !== undefined && labelRow !== null ? labelRow.cwd : undefined),
          locale: currentLocale(ctx),
        })
        if (event === null) return

        for (const action of engine.decideEvent(event, { runtime, config: engine.DEFAULT_CONFIG })) {
          if (action !== null && action.kind === 'show') showToast(action)
        }
      } catch (error) {
        warn('notification decision failed', error)
      }
    }

    /** Send one Web Notification; `tag = main session id` is what de-duplicates per session. */
    function showToast(action) {
      try {
        if (typeof Notification === 'undefined' || Notification === undefined) return
        if (Notification.permission === 'denied') return

        const toast = new Notification(action.title, {
          body: action.body,
          tag: action.tag,
          silent: action.silent,
        })
        toast.onclick = () => {
          // P0 best effort only: the renderer cannot wake a tray-hidden window;
          // ticket #6 adds the host click bridge.
          try {
            window.focus()
          } catch (error) {
            warn('focus on click failed', error)
          }
        }
        toast.onclose = () => {
          if (notifications.get(action.tag) === toast) notifications.delete(action.tag)
        }
        notifications.set(action.tag, toast)
      } catch (error) {
        warn('toast send failed', error)
      }
    }

    function reconcile() {
      try {
        const statuses = ctx.uiSession.sessionStatus.getSnapshot()
        const rows = sessionRows(ctx)
        const runtime = readRuntime(rows)

        for (const [sessionId, status] of statuses) {
          const row = rows[sessionId]

          // Pending interaction appears or changes kind -> authorization / question request.
          const pendingKind = engine.classifyPending(status.pendingInteraction !== undefined && status.pendingInteraction !== null ? status.pendingInteraction.kind : undefined)
          if (previousPending.get(sessionId) !== pendingKind) {
            previousPending.set(sessionId, pendingKind)
            if (primed && pendingKind !== undefined) notifyAttention(sessionId, pendingKind, row, rows, runtime)
          }

          // `running` true -> false edge -> P0 turn completion (approximation: Stop
          // and failures also end a turn this way; ticket #7 replaces this feed).
          // Completion only for a session whose list row is present and main: an
          // unknown row must not leak a subagent completion (spec: only main
          // sessions notify on turn completion), and sessions.list keeps in sync
          // with the status stream.
          const running = status.running === true
          const wasRunning = previousRunning.get(sessionId) === true
          previousRunning.set(sessionId, running)
          const knownMainSession = row !== undefined && row !== null && !isSubagentSession(row)
          if (primed && wasRunning && !running && knownMainSession) {
            notifyAttention(sessionId, 'turnComplete', row, rows, runtime)
          }
        }

        // Drop sessions that left the snapshot so a later reappearance cannot look
        // like a `running` transition, and the maps stay bounded by live sessions.
        for (const sessionId of previousRunning.keys()) {
          if (!statuses.has(sessionId)) previousRunning.delete(sessionId)
        }
        for (const sessionId of previousPending.keys()) {
          if (!statuses.has(sessionId)) previousPending.delete(sessionId)
        }

        primed = true
      } catch (error) {
        warn('attention reconcile failed', error)
      }
    }

    const disposeStatus = ctx.uiSession.sessionStatus.subscribe(reconcile)
    const disposeList = ctx.sessions.list.subscribe(reconcile)

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
