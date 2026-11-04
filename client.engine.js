/**
 * dsh-notice decision engine — the only automated seam in v1.
 *
 * Pure functions only: it normalizes one attention observation into an attention
 * event, then decides whether that event becomes a system notification. It must
 * never import the DSH runtime and never touch `Notification` (docs/spec.md
 * "通知决策引擎（唯一自动化测试 seam）").
 *
 * How it loads:
 *   - In the renderer it is a package-local client chunk served next to client.js
 *     and fetched with `require.async('./client.engine.js')`; the registration at
 *     the bottom of this file is the module-table contract.
 *   - test/client-engine.test.js executes it in a vm with a fake
 *     `window.__ModuleLoader__` and takes the factory exports.
 *
 * Notification rules that live here in v1 live here only: event -> wording,
 * per-session foreground suppression, title fallback, tag, silent. Merging,
 * close-on-resolve, "N more pending", config keys and subagent rules are added by
 * ticket #5 on top of the same seam.
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

  /**
   * Classify one `pendingInteraction.kind` value from DSH state.
   * @param {string | undefined | null} kind
   * @returns {'approval' | 'question' | undefined} undefined for pending kinds that are not attention events
   */
  function classifyPending(kind) {
    if (typeof kind !== 'string') return undefined
    return PENDING_KIND_MAP[kind]
  }

  const UNTITLED = Object.freeze({ zh: '未命名会话', en: 'Untitled session' })
  const FALLBACK_LOCALE = 'en'

  /**
   * Defaults from docs/spec.md ("配置"). Ticket #4 only carries the shape forward;
   * ticket #5 wires the profile config into the adapter and implements the rules.
   */
  const DEFAULT_CONFIG = Object.freeze({
    events: Object.freeze({ approval: true, question: true, turnComplete: true }),
    condition: 'unfocused',
    sound: true,
    mute: false,
  })

  /** Map any DSH locale identifier onto one of the two shipped dictionaries. */
  function localeOf(value) {
    if (typeof value !== 'string') return FALLBACK_LOCALE
    const tag = value.trim().toLowerCase()
    if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh'
    return 'en'
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
   * observation cannot be attributed (the adapter drops those).
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

  /** Event identity used for the notification tag and for per-session suppression. */
  function eventSessionId(event) {
    return event.mainSessionId !== undefined ? event.mainSessionId : event.sessionId
  }

  /**
   * Foreground suppression (docs/design-notes.md §3.2): only the session the human
   * is actually looking at is silent. Focusing DSH while another session is on
   * screen still notifies. A subagent event is suppressed when either the
   * subagent's own view or its main session is the main view.
   */
  function isSuppressed(event, runtime) {
    if (runtime.focused !== true) return false
    const viewed = typeof runtime.viewedSessionId === 'string' ? runtime.viewedSessionId : undefined
    if (viewed === undefined) return false
    if (viewed === event.sessionId) return true
    return event.mainSessionId !== undefined && viewed === event.mainSessionId
  }

  /**
   * Decide the notification actions for one already-normalized attention event.
   * This is the function the DSH adapter calls after `normalizeEvent`.
   *
   * @param {object | null} event normalized attention event
   * @param {{ runtime?: { focused?: boolean, viewedSessionId?: string },
   *   config?: typeof DEFAULT_CONFIG }} input
   * @returns {Array<{kind: 'show', event: string, title: string, body: string,
   *   tag: string, silent: boolean}>} no action for suppressed events
   */
  function decideEvent(event, input) {
    if (event === null || typeof event !== 'object' || !EVENT_KINDS.includes(event.kind)) return []
    const settings = input !== null && typeof input === 'object' ? input : {}
    const config = settings.config !== null && typeof settings.config === 'object' ? settings.config : DEFAULT_CONFIG
    const runtime = settings.runtime !== null && typeof settings.runtime === 'object' ? settings.runtime : {}
    if (isSuppressed(event, runtime)) return []

    return [
      {
        kind: 'show',
        event: event.kind,
        title: event.title,
        body: MESSAGES[event.kind][event.locale],
        tag: eventSessionId(event),
        silent: config.sound === false,
      },
    ]
  }

  /**
   * Decide the notification actions for one observation (normalize + decide).
   *
   * @param {{
   *   event: object,
   *   runtime?: { focused?: boolean, viewedSessionId?: string },
   *   config?: typeof DEFAULT_CONFIG,
   * }} input
   * @returns {Array<{kind: 'show', event: string, title: string, body: string,
   *   tag: string, silent: boolean}>} no action for suppressed or unattributable events
   */
  function decide(input) {
    if (input === null || typeof input !== 'object') return []
    return decideEvent(normalizeEvent(input.event), input)
  }

  const exports = Object.freeze({
    EVENT_KINDS,
    DEFAULT_CONFIG,
    classifyPending,
    normalizeEvent,
    decideEvent,
    decide,
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
