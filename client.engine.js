/**
 * dsh-notice decision engine — the only automated seam in v1.
 *
 * Pure reducer over notification state: it normalizes one observation into an
 * attention event (or a resolution / view event), advances serializable state and
 * returns notification actions (`show` / `replace` / `close`). It must never import
 * the DSH runtime and never touch `Notification` (docs/spec.md "通知决策引擎（唯一
 * 自动化测试 seam）").
 *
 * Rules owned here (ticket #5): event mapping + wording (zh/en), per-session
 * foreground suppression, `condition` / `events` / `mute` / `sound` config, one
 * notification per session with in-place replacement, the 3s same-kind merge
 * window, "另有 N 项", close-on-resolve, close-completion-on-view, subagent
 * attribution, title fallback, tag.
 *
 * P1 input normalization (ticket #7): `classifyTurnEnd` / `normalizeTurnEndFrame`
 * turn the host's `turn/end` reason and SSE frame into the same attention-event
 * input, so the precise-completion rules stay inside this tested seam.
 *
 * How it loads:
 *   - In the renderer it is a package-local client chunk served next to client.js
 *     and fetched with `require.async('./client.engine.js')`; the registration at
 *     the bottom of this file is the module-table contract.
 *   - test/client-engine.test.js executes it in a vm with a fake
 *     `window.__ModuleLoader__` and takes the factory exports.
 *
 * The whole file is one IIFE because HMR re-executes client scripts: a top-level
 * `const` would throw "already declared" on the second execution.
 */
;(function () {
  'use strict'

  const EVENT_APPROVAL = 'approval'
  const EVENT_QUESTION = 'question'
  const EVENT_TURN_COMPLETE = 'turnComplete'
  const EVENT_KINDS = Object.freeze([EVENT_APPROVAL, EVENT_QUESTION, EVENT_TURN_COMPLETE])

  /** Notification body per attention event, in the DSH interface language (docs/design-notes.md §3.3). */
  const MESSAGES = Object.freeze({
    approval: Object.freeze({ zh: '需要你确认权限', en: 'Waiting for your approval' }),
    question: Object.freeze({ zh: '在等你回答', en: 'Waiting for your answer' }),
    turnComplete: Object.freeze({ zh: '本轮已完成', en: 'Turn completed' }),
  })

  /** DSH `pendingInteraction.kind` -> attention event; plan review is out of scope in v1. */
  const PENDING_KIND_MAP = Object.freeze({
    approval: EVENT_APPROVAL,
    question: EVENT_QUESTION,
  })

  /** The only host `turn/end.reason.kind` that means the turn really finished (ticket #7). */
  const TURN_END_COMPLETED = 'completed'

  const UNTITLED = Object.freeze({ zh: '未命名会话', en: 'Untitled session' })
  const FALLBACK_LOCALE = 'en'
  /** Same-kind events closer than this belong to the wave already on screen (docs/design-notes.md §3.4). */
  const WINDOW_MS = 3000
  /** State key of the turn-completion item inside one session (pending items are keyed by source session id). */
  const COMPLETION_ITEM = '__turnComplete__'

  /** Defaults from docs/spec.md ("配置"); the profile override replaces them wholesale. */
  const DEFAULT_CONFIG = Object.freeze({
    events: Object.freeze({ approval: true, question: true, turnComplete: true }),
    condition: 'unfocused',
    sound: true,
    mute: false,
  })

  /** Classify one `pendingInteraction.kind` value from DSH state. */
  function classifyPending(kind) {
    if (typeof kind !== 'string') return undefined
    return PENDING_KIND_MAP[kind]
  }

  /**
   * Classify one host completion frame field (`reasonKind`) into the attention
   * event kind. Only a normal completion notifies: Stop (`aborted`), errors,
   * interruptions, forks, blocks and token limits all end a turn too and must never
   * look like one (ticket #7).
   *
   * @param {unknown} kind
   * @returns {'turnComplete' | undefined}
   */
  function classifyTurnEnd(kind) {
    return kind === TURN_END_COMPLETED ? EVENT_TURN_COMPLETE : undefined
  }

  /** Map any DSH locale identifier onto one of the two shipped dictionaries. */
  function localeOf(value) {
    if (typeof value !== 'string') return FALLBACK_LOCALE
    const tag = value.trim().toLowerCase()
    if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh'
    return 'en'
  }

  /** Normalize the profile config into the documented shape, filling defaults. */
  function normalizeConfig(raw) {
    const input = raw !== null && typeof raw === 'object' ? raw : {}
    const events = input.events !== null && typeof input.events === 'object' ? input.events : {}
    const defaults = DEFAULT_CONFIG
    return {
      events: {
        approval: events.approval === undefined ? defaults.events.approval : events.approval !== false,
        question: events.question === undefined ? defaults.events.question : events.question !== false,
        turnComplete: events.turnComplete === undefined ? defaults.events.turnComplete : events.turnComplete !== false,
      },
      condition: input.condition === 'always' ? 'always' : defaults.condition,
      sound: input.sound === undefined ? defaults.sound : input.sound !== false,
      mute: input.mute === undefined ? defaults.mute : input.mute === true,
    }
  }

  /** Session title, falling back to "unnamed session" plus the workspace when DSH has no title. */
  function titleOf(title, workspace, locale) {
    const named = typeof title === 'string' ? title.trim() : ''
    if (named !== '') return named
    const unnamed = UNTITLED[locale]
    const where = typeof workspace === 'string' ? workspace.trim() : ''
    if (where === '') return unnamed
    return locale === 'zh' ? `${unnamed}（${where}）` : `${unnamed} (${where})`
  }

  /**
   * Normalize one observation into an attention event, or null when the
   * observation cannot be attributed.
   *
   * @param {{
   *   sessionId: string,
   *   kind: 'approval' | 'question' | 'turnComplete',
   *   title?: string,
   *   workspace?: string,
   *   locale?: string,
   *   isSubagent?: boolean,
   *   mainSessionId?: string,
   * }} raw
   * @returns {{sessionId: string, kind: string, isSubagent: boolean,
   *   mainSessionId: string | undefined, title: string, locale: 'zh' | 'en'} | null}
   */
  function normalizeEvent(raw) {
    if (raw === null || typeof raw !== 'object') return null
    const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : ''
    if (sessionId === '') return null
    if (!EVENT_KINDS.includes(raw.kind)) return null

    const isSubagent = raw.isSubagent === true
    const rawMain = typeof raw.mainSessionId === 'string' ? raw.mainSessionId.trim() : ''
    const mainSessionId = isSubagent && rawMain !== '' ? rawMain : undefined
    // A subagent event that lost its main session cannot be attributed or
    // suppressed correctly; dropping it is the read-only-side-channel safe choice.
    if (isSubagent && mainSessionId === undefined) return null

    const locale = localeOf(raw.locale)
    return {
      sessionId,
      kind: raw.kind,
      isSubagent,
      mainSessionId,
      title: titleOf(raw.title, raw.workspace, locale),
      locale,
    }
  }

  /**
   * Normalize one parsed host SSE frame into the reducer's attention-event input
   * (ticket #7). The host half forwards `{ type: 'turn/end', sessionId, reasonKind,
   * origin?, parentSession? }` (it may also carry an observational `turn`, which the
   * decision ignores); only a completed reason survives, and the session must be
   * identifiable.
   *
   * `parentSession` marks subagent work and is used as `mainSessionId` only then.
   * Never throws.
   *
   * @param {object} frame parsed SSE payload
   * @returns {{sessionId: string, kind: 'turnComplete',
   *   isSubagent: boolean, mainSessionId?: string} | null}
   */
  function normalizeTurnEndFrame(frame) {
    try {
      if (frame === null || typeof frame !== 'object') return null
      if (frame.type !== 'turn/end') return null
      if (classifyTurnEnd(frame.reasonKind) !== EVENT_TURN_COMPLETE) return null

      const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId.trim() : ''
      if (sessionId === '') return null

      const origin = typeof frame.origin === 'string' ? frame.origin.trim() : ''
      const parentSession = typeof frame.parentSession === 'string' ? frame.parentSession.trim() : ''
      const isSubagent = origin === 'subagent' || parentSession !== ''

      return {
        sessionId,
        kind: EVENT_TURN_COMPLETE,
        isSubagent,
        mainSessionId: isSubagent && parentSession !== '' ? parentSession : undefined,
      }
    } catch (error) {
      return null
    }
  }

  /** Session identity used for the notification tag and for per-session suppression. */
  function eventSessionId(event) {
    return event.mainSessionId !== undefined ? event.mainSessionId : event.sessionId
  }

  /**
   * Foreground suppression (docs/design-notes.md §3.2): only the session the human
   * is actually looking at is silent. A subagent event is suppressed when either
   * the subagent's own view or its main session is the main view.
   */
  function isSuppressed(event, runtime) {
    if (runtime.focused !== true) return false
    const viewed = typeof runtime.viewedSessionId === 'string' ? runtime.viewedSessionId : undefined
    if (viewed === undefined) return false
    if (viewed === event.sessionId) return true
    return event.mainSessionId !== undefined && viewed === event.mainSessionId
  }

  /** Fresh, serializable notification state. */
  function emptyState() {
    return { sessions: {} }
  }

  function unchanged(state) {
    return { state, actions: [] }
  }

  /** Item of the session whose event is the most recent — the notification headline. */
  function latestItem(items) {
    let headline
    for (const item of Object.values(items)) {
      if (headline === undefined || item.at >= headline.at) headline = item
    }
    return headline
  }

  /** Unresolved pending interactions of one session ("另有 N 项" counts these, not the completion sentinel). */
  function pendingCount(items) {
    return Object.keys(items).filter((key) => key !== COMPLETION_ITEM).length
  }

  /** Body text: headline wording + subagent origin + pending count. */
  function composeBody(session) {
    const headline = latestItem(session.items)
    const locale = session.locale
    const base = MESSAGES[headline.kind][locale]
    const parts = []
    if (headline.isSubagent) parts.push(locale === 'zh' ? '来自子代理' : 'from subagent')
    // Only other *pending* items count: a completion reminder next to a pending
    // item is not a second "待处理项" (docs/spec.md "另有 N 项").
    const others = pendingCount(session.items) - (headline.kind === EVENT_TURN_COMPLETE ? 0 : 1)
    if (headline.kind !== EVENT_TURN_COMPLETE && others > 0) {
      parts.push(locale === 'zh' ? `另有 ${others} 项` : `+${others} more pending`)
    }
    if (parts.length === 0) return base
    return locale === 'zh' ? `${base}（${parts.join('，')}）` : `${base} (${parts.join(', ')})`
  }

  function actionFor(session, tag, kind) {
    const headline = latestItem(session.items)
    return {
      kind,
      event: headline.kind,
      title: session.title,
      body: composeBody(session),
      tag,
      silent: session.silent === true,
    }
  }

  /** Fresh per-session notification state (kept JSON-serializable: `lastAt` is -1 until the first event). */
  function newSession() {
    return { title: '', locale: FALLBACK_LOCALE, silent: false, items: {}, lastKind: undefined, lastAt: -1, notified: false, notificationBody: undefined }
  }

  /** One attention event -> one notification action; updates the session state. */
  function applyAttention(state, rawEvent, runtime, config, now) {
    const event = normalizeEvent(rawEvent)
    if (event === null) return unchanged(state)
    // Subagent turns never remind (spec user story 20): their work is merged into
    // the main session, whose completion is the one worth interrupting for.
    if (event.isSubagent && event.kind === EVENT_TURN_COMPLETE) return unchanged(state)
    if (!config.events[event.kind]) return unchanged(state)
    if (config.mute) return unchanged(state)
    // Suppressed events are not tracked either: the human already sees them in DSH.
    if (config.condition !== 'always' && isSuppressed(event, runtime)) return unchanged(state)

    const target = eventSessionId(event)
    const sessions = { ...state.sessions }
    const previous = sessions[target]
    const session = previous !== undefined ? { ...previous, items: { ...previous.items } } : newSession()
    session.title = event.title
    session.locale = event.locale
    session.silent = config.sound === false

    const itemKey = event.kind === EVENT_TURN_COMPLETE ? COMPLETION_ITEM : event.sessionId
    // Same kind inside the rolling window = the wave already on screen; no re-alert.
    const withinWave = session.notified && session.lastKind === event.kind && now - session.lastAt < WINDOW_MS

    session.items[itemKey] = { kind: event.kind, isSubagent: event.isSubagent, at: now }
    session.lastKind = event.kind
    session.lastAt = now

    if (withinWave && composeBody(session) === session.notificationBody) {
      // Same wave and the visible content did not change: one reminder, no re-alert.
      sessions[target] = session
      return { state: { sessions }, actions: [] }
    }

    // A changed wave (e.g. a second pending item joined) must not re-banner, but it
    // does have to show the new count; the engine still reports one notification.
    const actionKind = session.notified ? 'replace' : 'show'
    const action = actionFor(session, target, actionKind)
    session.notified = true
    session.notificationBody = action.body
    sessions[target] = session
    return { state: { sessions }, actions: [action] }
  }

  /** Drop one item from a session; close when nothing is left, otherwise re-render. */
  function dropItem(state, mainSessionId, itemKey) {
    const previous = state.sessions[mainSessionId]
    if (previous === undefined || previous.items[itemKey] === undefined) return unchanged(state)

    const items = { ...previous.items }
    delete items[itemKey]
    const sessions = { ...state.sessions }
    if (Object.keys(items).length === 0) {
      delete sessions[mainSessionId]
      return { state: { sessions }, actions: previous.notified ? [{ kind: 'close', tag: mainSessionId }] : [] }
    }

    const session = { ...previous, items }
    sessions[mainSessionId] = session
    if (!session.notified) return { state: { sessions }, actions: [] }
    const action = actionFor(session, mainSessionId, 'replace')
    session.notificationBody = action.body
    return { state: { sessions }, actions: [action] }
  }

  /** A pending interaction disappeared (approval answered / question answered). */
  function applyPendingResolved(state, observation) {
    const sessionId = typeof observation.sessionId === 'string' ? observation.sessionId : undefined
    if (sessionId === undefined) return unchanged(state)
    const mainSessionId = typeof observation.mainSessionId === 'string' && observation.mainSessionId !== '' ? observation.mainSessionId : sessionId
    return dropItem(state, mainSessionId, sessionId)
  }

  /** The session was opened / its completion was seen: drop the completion reminder. */
  function applyViewed(state, observation) {
    const sessionId = typeof observation.sessionId === 'string' ? observation.sessionId : undefined
    if (sessionId === undefined) return unchanged(state)
    return dropItem(state, sessionId, COMPLETION_ITEM)
  }

  /**
   * Advance notification state by one observation.
   *
   * @param {{ sessions: object }} state previously returned state (or `emptyState()`)
   * @param {{type: 'attention', event: object} | {type: 'pendingResolved', sessionId: string, mainSessionId?: string}
   *   | {type: 'viewed', sessionId: string}} observation
   * @param {{ focused?: boolean, viewedSessionId?: string }} [runtime]
   * @param {object} [config] profile config (raw or normalized)
   * @param {number} [now] milliseconds timestamp used for the 3s merge window
   * @returns {{state: {sessions: object}, actions: Array<{kind: 'show'|'replace'|'close',
   *   tag: string, event?: string, title?: string, body?: string, silent?: boolean}>}}
   */
  function reduce(state, observation, runtime, config, now) {
    const settings = normalizeConfig(config)
    const safeState = state !== null && typeof state === 'object' && state.sessions !== null && typeof state.sessions === 'object' ? state : emptyState()
    const safeRuntime = runtime !== null && typeof runtime === 'object' ? runtime : {}
    const at = typeof now === 'number' ? now : 0
    if (observation === null || typeof observation !== 'object') return unchanged(safeState)
    switch (observation.type) {
      case 'attention':
        return applyAttention(safeState, observation.event, safeRuntime, settings, at)
      case 'pendingResolved':
        return applyPendingResolved(safeState, observation)
      case 'viewed':
        return applyViewed(safeState, observation)
      default:
        return unchanged(safeState)
    }
  }

  const exports = Object.freeze({
    EVENT_KINDS,
    DEFAULT_CONFIG,
    WINDOW_MS,
    classifyPending,
    classifyTurnEnd,
    normalizeConfig,
    normalizeEvent,
    normalizeTurnEndFrame,
    emptyState,
    reduce,
  })

  // Package-local client chunk registration: dsh-client-modules serves this file
  // next to client.js and `require.async('./client.engine.js')` materializes it.
  if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
    window.__ModuleLoader__.load({
      id: 'dsh-notice',
      chunk: 'client.engine.js',
      factory: () => exports,
    })
  }
})()
