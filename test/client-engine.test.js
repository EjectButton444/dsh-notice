// Unit tests for the dsh-notice decision engine — the only automated seam in v1
// (docs/spec.md "Testing Decisions"). Ticket #5 makes the engine a pure reducer:
// each observation (attention event / pending resolved / session viewed) advances
// a serializable state and yields notification actions (show / replace / close).
// The DSH state source, the notification sender, the config route and the locale
// adapter are covered by the real-machine checklist instead.
//
// `client.engine.js` is a classic browser script (a package-local client chunk),
// so these tests load it the way DSH loads it: see test/helpers.js.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEngine } from './helpers.js'

const engine = loadEngine()
const ZH = { locale: 'zh' }

const UNFOCUSED = { focused: false, viewedSessionId: undefined }

/** Cross-realm comparisons: engine objects come from the vm context. */
const plain = (value) => JSON.parse(JSON.stringify(value))

function attention(overrides = {}) {
  return { type: 'attention', event: { sessionId: 's-1', title: 'Refactor the parser', locale: 'zh', ...overrides } }
}

/** Reduce a list of steps; each step is { observation, now?, runtime?, config? }. */
function reduceAll(steps, defaults = {}) {
  let state = engine.emptyState()
  const actions = []
  let runtime = defaults.runtime ?? UNFOCUSED
  let config = defaults.config ?? engine.DEFAULT_CONFIG
  for (const step of steps) {
    if (step.runtime !== undefined) runtime = step.runtime
    if (step.config !== undefined) config = step.config
    const result = engine.reduce(state, step.observation, runtime, config, step.now ?? 0)
    state = result.state
    actions.push(...result.actions)
  }
  return { state, actions }
}

function one(step, defaults) {
  return reduceAll([step], defaults)
}

test('engine exposes the pure reducer pipeline and documented config defaults', () => {
  assert.equal(typeof engine.reduce, 'function')
  assert.equal(typeof engine.emptyState, 'function')
  assert.equal(typeof engine.normalizeConfig, 'function')
  assert.equal(typeof engine.normalizeEvent, 'function')
  assert.equal(typeof engine.classifyPending, 'function')
  assert.equal(typeof engine.classifyTurnEnd, 'function')
  assert.equal(typeof engine.normalizeTurnEndFrame, 'function')
  assert.deepEqual(plain(engine.emptyState()), { sessions: {} })

  const defaults = engine.normalizeConfig(undefined)
  assert.deepEqual(plain(defaults), {
    events: { approval: true, question: true, turnComplete: true },
    condition: 'unfocused',
    sound: true,
    mute: false,
  })
  assert.deepEqual(plain(engine.DEFAULT_CONFIG), plain(defaults))

  const custom = engine.normalizeConfig({ events: { question: false }, condition: 'always', sound: false, mute: true })
  assert.deepEqual(plain(custom.events), { approval: true, question: false, turnComplete: true })
  assert.equal(custom.condition, 'always')
  assert.equal(custom.sound, false)
  assert.equal(custom.mute, true)

  const invalid = engine.normalizeConfig({ condition: 'sometimes', events: null, sound: 'no' })
  assert.equal(invalid.condition, 'unfocused', 'unknown condition falls back to the default')
  assert.deepEqual(plain(invalid.events), { approval: true, question: true, turnComplete: true })
  assert.equal(invalid.sound, true)
})

// --- Event mapping --------------------------------------------------------
// One attention event becomes one notification; content is only "session title +
// event type" (docs/spec.md: never tool names, question text or user messages).

test('approval / question / completion map to one show action each', () => {
  const approval = one({ observation: attention({ kind: 'approval' }), now: 0 })
  assert.equal(approval.actions.length, 1)
  assert.deepEqual(
    plain({ kind: approval.actions[0].kind, event: approval.actions[0].event, body: approval.actions[0].body, tag: approval.actions[0].tag, silent: approval.actions[0].silent }),
    { kind: 'show', event: 'approval', body: '需要你确认权限', tag: 's-1', silent: false },
  )
  assert.equal(approval.actions[0].title, 'Refactor the parser')

  const question = one({ observation: attention({ kind: 'question' }), now: 0 })
  assert.equal(question.actions[0].body, '在等你回答')

  const completion = one({ observation: attention({ kind: 'turnComplete' }), now: 0 })
  assert.equal(completion.actions[0].body, '本轮已完成')
})

test('wording follows the DSH interface language (zh / en)', () => {
  const cases = [
    ['approval', '需要你确认权限', 'Waiting for your approval'],
    ['question', '在等你回答', 'Waiting for your answer'],
    ['turnComplete', '本轮已完成', 'Turn completed'],
  ]
  for (const [kind, zh, en] of cases) {
    assert.equal(one({ observation: attention({ kind, ...ZH }) }).actions[0].body, zh)
    assert.equal(one({ observation: attention({ kind, locale: 'en' }) }).actions[0].body, en)
  }
})

test('an empty session title falls back to the unnamed-session wording with its workspace', () => {
  const zh = one({ observation: attention({ kind: 'question', title: '', workspace: 'notice' }) }).actions[0]
  assert.equal(zh.title, '未命名会话（notice）')
  const en = one({ observation: attention({ kind: 'question', locale: 'en', title: '   ', workspace: 'notice' }) }).actions[0]
  assert.equal(en.title, 'Untitled session (notice)')
})

// --- Foreground suppression + config --------------------------------------

test('no notification while DSH is focused on the event session', () => {
  const { actions } = one({ observation: attention({ kind: 'approval' }), runtime: { focused: true, viewedSessionId: 's-1' } })
  assert.equal(actions.length, 0)
})

test('still notifies while DSH is focused on a different session', () => {
  const { actions } = one({ observation: attention({ kind: 'approval' }), runtime: { focused: true, viewedSessionId: 's-2' } })
  assert.equal(actions.length, 1)
})

test('condition: always overrides foreground suppression', () => {
  const config = engine.normalizeConfig({ condition: 'always' })
  const { actions } = one({ observation: attention({ kind: 'question' }), runtime: { focused: true, viewedSessionId: 's-1' }, config })
  assert.equal(actions.length, 1)
})

test('per-event toggles silence one event type only', () => {
  const config = engine.normalizeConfig({ events: { approval: false } })
  assert.equal(one({ observation: attention({ kind: 'approval' }), config }).actions.length, 0)
  assert.equal(one({ observation: attention({ kind: 'question' }), config }).actions.length, 1)
  assert.equal(one({ observation: attention({ kind: 'turnComplete' }), config }).actions.length, 1)
})

test('mute suppresses every notification', () => {
  const config = engine.normalizeConfig({ mute: true })
  for (const kind of ['approval', 'question', 'turnComplete']) {
    assert.equal(one({ observation: attention({ kind }), config }).actions.length, 0)
  }
})

test('sound: false marks the action silent without changing its content', () => {
  const config = engine.normalizeConfig({ sound: false })
  const { actions } = one({ observation: attention({ kind: 'approval' }), config })
  assert.equal(actions[0].silent, true)
  assert.equal(actions[0].body, '需要你确认权限')
})

// --- One notification per session, in-place replacement, merge window -----

test('five events in the same session keep one notification whose content is the latest event', () => {
  const kinds = ['approval', 'question', 'approval', 'question', 'approval']
  const steps = kinds.map((kind, index) => ({ observation: attention({ kind }), now: index * 5000 }))
  const { state, actions } = reduceAll(steps)

  const showActions = actions.filter((action) => action.kind === 'show')
  assert.equal(showActions.length, 1, 'only the first event opens a notification')
  assert.equal(actions.filter((action) => action.kind === 'replace').length, 4, 'later events replace in place')
  assert.ok(actions.every((action) => action.tag === 's-1'), 'one stable tag per session')
  assert.equal(actions[actions.length - 1].event, 'approval', 'content is the latest event')
  assert.equal(actions[actions.length - 1].body, '需要你确认权限')
  assert.equal(Object.keys(state.sessions).length, 1, 'one session entry')
})

test('same-kind events inside the 3s window merge into the wave that is already on screen', () => {
  const first = reduceAll([{ observation: attention({ kind: 'approval' }), now: 0 }])
  const second = engine.reduce(first.state, attention({ kind: 'approval' }), UNFOCUSED, engine.DEFAULT_CONFIG, 2000)
  assert.equal(second.actions.length, 0, 'a repeated approval inside the window does not re-alert')
  const third = engine.reduce(second.state, attention({ kind: 'approval' }), UNFOCUSED, engine.DEFAULT_CONFIG, 2000 + engine.WINDOW_MS + 1)
  assert.equal(third.actions.length, 1, 'a gap longer than the window starts a new notification wave')
  assert.equal(third.actions[0].kind, 'replace')
})

test('a second same-kind event from another source inside the window updates the count', () => {
  const config = engine.DEFAULT_CONFIG
  const first = reduceAll(
    [{ observation: attention({ kind: 'approval', sessionId: 'main-1', title: 'Main session' }), now: 0 }],
    { config },
  )
  const second = engine.reduce(
    first.state,
    attention({
      kind: 'approval',
      sessionId: 'sub-1',
      mainSessionId: 'main-1',
      isSubagent: true,
      title: 'Main session',
    }),
    UNFOCUSED,
    config,
    1000,
  )
  assert.equal(second.actions.length, 1, 'the wave still shows a single notification')
  assert.equal(second.actions[0].kind, 'replace')
  assert.equal(second.actions[0].body, '需要你确认权限（来自子代理，另有 1 项）')
})

test('a different event kind inside the window still replaces the notification', () => {
  const { state } = reduceAll([{ observation: attention({ kind: 'approval' }), now: 0 }])
  const next = engine.reduce(state, attention({ kind: 'question' }), UNFOCUSED, engine.DEFAULT_CONFIG, 1000)
  assert.equal(next.actions.length, 1)
  assert.equal(next.actions[0].kind, 'replace')
  assert.equal(next.actions[0].event, 'question')
})

// --- "另有 N 项" -----------------------------------------------------------

test('multiple pending items append the pending count, latest event first', () => {
  const config = engine.DEFAULT_CONFIG
  // main session question, then a subagent approval merged into the same session
  const steps = [
    { observation: attention({ kind: 'question', sessionId: 'main-1', title: 'Main session' }), now: 0 },
    {
      observation: attention({
        kind: 'approval',
        sessionId: 'sub-1',
        mainSessionId: 'main-1',
        isSubagent: true,
        title: 'Main session',
      }),
      now: 5000,
    },
    {
      observation: attention({
        kind: 'question',
        sessionId: 'sub-2',
        mainSessionId: 'main-1',
        isSubagent: true,
        title: 'Main session',
      }),
      now: 10000,
    },
  ]
  const { state, actions } = reduceAll(steps, { config })

  const last = actions[actions.length - 1]
  assert.equal(last.tag, 'main-1', 'subagent events are attributed to the main session')
  assert.equal(last.body, '在等你回答（来自子代理，另有 2 项）')
  assert.equal(Object.keys(state.sessions['main-1'].items).length, 3)
})

test('the pending count in english uses the english suffix', () => {
  const steps = [
    { observation: attention({ kind: 'question', sessionId: 'main-1', locale: 'en', title: 'Main session' }), now: 0 },
    { observation: attention({ kind: 'question', sessionId: 'sub-1', mainSessionId: 'main-1', isSubagent: true, locale: 'en', title: 'Main session' }), now: 5000 },
  ]
  const { actions } = reduceAll(steps)
  assert.equal(actions[actions.length - 1].body, 'Waiting for your answer (from subagent, +1 more pending)')
})

test('a completion reminder is not counted as another pending item', () => {
  const steps = [
    { observation: attention({ kind: 'question', sessionId: 'main-1', title: 'Main session' }), now: 0 },
    { observation: attention({ kind: 'turnComplete', sessionId: 'main-1', title: 'Main session' }), now: 5000 },
  ]
  const { actions } = reduceAll(steps)
  assert.equal(actions[actions.length - 1].body, '本轮已完成', 'one pending item must not add 另有 N 项 to a completion reminder')

  // Resolving the pending item keeps only the completion reminder: still no count suffix.
  const resolved = engine.reduce(
    reduceAll(steps).state,
    { type: 'pendingResolved', sessionId: 'main-1', mainSessionId: 'main-1' },
    UNFOCUSED,
    engine.DEFAULT_CONFIG,
    6000,
  )
  assert.equal(resolved.actions.length, 1)
  assert.equal(resolved.actions[0].body, '本轮已完成')
})

// --- Close on resolve -----------------------------------------------------

test('resolving the pending interaction closes the notification', () => {
  const shown = reduceAll([{ observation: attention({ kind: 'approval' }), now: 0 }])
  const resolved = engine.reduce(shown.state, { type: 'pendingResolved', sessionId: 's-1', mainSessionId: 's-1' }, UNFOCUSED, engine.DEFAULT_CONFIG, 2000)
  assert.deepEqual(plain(resolved.actions), [{ kind: 'close', tag: 's-1' }])
  assert.deepEqual(plain(resolved.state), { sessions: {} })
})

test('resolving one of several pending items updates the count instead of closing', () => {
  const steps = [
    { observation: attention({ kind: 'question', sessionId: 'main-1', title: 'Main session' }), now: 0 },
    {
      observation: attention({ kind: 'approval', sessionId: 'sub-1', mainSessionId: 'main-1', isSubagent: true, title: 'Main session' }),
      now: 5000,
    },
  ]
  const shown = reduceAll(steps)
  const resolved = engine.reduce(
    shown.state,
    { type: 'pendingResolved', sessionId: 'sub-1', mainSessionId: 'main-1' },
    UNFOCUSED,
    engine.DEFAULT_CONFIG,
    6000,
  )
  assert.equal(resolved.actions.length, 1)
  assert.equal(resolved.actions[0].kind, 'replace')
  assert.equal(resolved.actions[0].body, '在等你回答')
  assert.deepEqual(Object.keys(resolved.state.sessions['main-1'].items), ['main-1'])
})

test('resolving an untracked session is a no-op', () => {
  const shown = reduceAll([{ observation: attention({ kind: 'approval' }) }])
  const resolved = engine.reduce(shown.state, { type: 'pendingResolved', sessionId: 'nope' }, UNFOCUSED, engine.DEFAULT_CONFIG, 0)
  assert.deepEqual(plain(resolved.actions), [])
})

// --- Close completion when the session is opened --------------------------

test('viewing the session closes its turn-completion notification', () => {
  const shown = reduceAll([{ observation: attention({ kind: 'turnComplete' }) }])
  assert.equal(shown.actions[0].body, '本轮已完成')
  const viewed = engine.reduce(shown.state, { type: 'viewed', sessionId: 's-1' }, { focused: true, viewedSessionId: 's-1' }, engine.DEFAULT_CONFIG, 0)
  assert.deepEqual(plain(viewed.actions), [{ kind: 'close', tag: 's-1' }])
  assert.deepEqual(plain(viewed.state), { sessions: {} })
})

test('viewing closes only the completion item, keeping pending items alive', () => {
  const steps = [
    { observation: attention({ kind: 'question' }), now: 0 },
    { observation: attention({ kind: 'turnComplete' }), now: 5000 },
  ]
  const shown = reduceAll(steps)
  const viewed = engine.reduce(shown.state, { type: 'viewed', sessionId: 's-1' }, UNFOCUSED, engine.DEFAULT_CONFIG, 6000)
  assert.equal(viewed.actions.length, 1)
  assert.equal(viewed.actions[0].kind, 'replace')
  assert.equal(viewed.actions[0].body, '在等你回答')
})

test('viewing a session without a completion notification is a no-op', () => {
  const shown = reduceAll([{ observation: attention({ kind: 'approval' }) }])
  const viewed = engine.reduce(shown.state, { type: 'viewed', sessionId: 's-1' }, UNFOCUSED, engine.DEFAULT_CONFIG, 0)
  assert.deepEqual(plain(viewed.actions), [])
})

// --- Subagent rules -------------------------------------------------------

test('subagent pending interactions are attributed to the main session', () => {
  const { actions } = reduceAll([
    {
      observation: attention({
        kind: 'approval',
        sessionId: 'sub-1',
        mainSessionId: 'main-1',
        isSubagent: true,
        title: 'Main session',
      }),
      now: 0,
    },
  ])
  assert.equal(actions.length, 1)
  assert.equal(actions[0].tag, 'main-1')
  assert.equal(actions[0].title, 'Main session')
  assert.equal(actions[0].body, '需要你确认权限（来自子代理）')
})

test('subagent turn completion never notifies', () => {
  const { actions } = reduceAll([
    { observation: attention({ kind: 'turnComplete', sessionId: 'sub-1', mainSessionId: 'main-1', isSubagent: true }), now: 0 },
  ])
  assert.equal(actions.length, 0)
})

test('an unattributable subagent event is dropped', () => {
  const { actions } = reduceAll([{ observation: attention({ kind: 'question', isSubagent: true }), now: 0 }])
  assert.equal(actions.length, 0)
})

// --- Independent sessions -------------------------------------------------

test('different sessions keep independent notifications', () => {
  const { state, actions } = reduceAll([
    { observation: attention({ kind: 'question', sessionId: 's-1' }), now: 0 },
    { observation: attention({ kind: 'approval', sessionId: 's-2', title: 'Other session' }), now: 1000 },
  ])
  assert.equal(actions.length, 2)
  assert.deepEqual(actions.map((action) => action.tag).sort(), ['s-1', 's-2'])
  const resolved = engine.reduce(state, { type: 'pendingResolved', sessionId: 's-1', mainSessionId: 's-1' }, UNFOCUSED, engine.DEFAULT_CONFIG, 2000)
  assert.deepEqual(plain(resolved.actions), [{ kind: 'close', tag: 's-1' }])
  assert.ok(resolved.state.sessions['s-2'], 'the other session keeps its notification')
})

// --- Normalization edges --------------------------------------------------

test('normalizeEvent keeps identity fields and trims the title', () => {
  const event = engine.normalizeEvent({
    sessionId: ' s-1 ',
    kind: 'approval',
    title: '  Refactor the parser  ',
    locale: 'zh-CN',
    mainSessionId: 'ignored-for-main-sessions',
  })
  assert.equal(event.sessionId, 's-1')
  assert.equal(event.title, 'Refactor the parser')
  assert.equal(event.locale, 'zh')
  assert.equal(event.isSubagent, false)
  assert.equal(event.mainSessionId, undefined)
})

test('normalizeEvent rejects observations that are not attention events', () => {
  assert.equal(engine.normalizeEvent(null), null)
  assert.equal(engine.normalizeEvent({ kind: 'approval' }), null, 'a session id is required')
  assert.equal(engine.normalizeEvent({ sessionId: 's-1', kind: 'plan-review' }), null, 'plan approval is out of scope in v1')
})

test('classifyPending maps only the attention pending kinds', () => {
  assert.equal(engine.classifyPending('approval'), 'approval')
  assert.equal(engine.classifyPending('question'), 'question')
  assert.equal(engine.classifyPending('plan-review'), undefined, 'plan approval is out of scope in v1')
  assert.equal(engine.classifyPending(undefined), undefined)
  assert.equal(engine.classifyPending(null), undefined)
})

// --- Precise turn completion from the host (#7) ---------------------------
// The host half forwards `session/event` `turn/end` frames over SSE. Only
// `reason.kind === 'completed'` (the host's flat `reasonKind` wire field) means the
// turn really finished; aborted / error / interrupted / forked / blocked /
// max-tokens must never look like a completion.

test('classifyTurnEnd maps only a completed host turn end reason', () => {
  assert.equal(engine.classifyTurnEnd('completed'), 'turnComplete')

  for (const kind of ['aborted', 'blocked', 'error', 'interrupted', 'forked', 'max-tokens', 'unknown']) {
    assert.equal(engine.classifyTurnEnd(kind), undefined, `the ${kind} reason is not a completion`)
  }

  assert.equal(engine.classifyTurnEnd(undefined), undefined)
  assert.equal(engine.classifyTurnEnd(null), undefined)
  assert.equal(engine.classifyTurnEnd(''), undefined)
  assert.equal(engine.classifyTurnEnd(42), undefined)
  assert.equal(engine.classifyTurnEnd({ kind: 'completed' }), undefined, 'the classification is over the wire field, not an object')
})

test('normalizeTurnEndFrame normalizes a completed frame into reducer attention input', () => {
  const frame = engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 's-1', reasonKind: 'completed', turn: 2 })
  assert.deepEqual(plain(frame), { sessionId: 's-1', kind: 'turnComplete', isSubagent: false })
  assert.equal(frame.mainSessionId, undefined, 'a main-session frame has no mainSessionId')

  const trimmed = engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: ' s-1 ', reasonKind: 'completed' })
  assert.equal(trimmed.sessionId, 's-1')
})

test('normalizeTurnEndFrame rejects frames that are not precise completions', () => {
  assert.equal(engine.normalizeTurnEndFrame(null), null)
  assert.equal(engine.normalizeTurnEndFrame(undefined), null)
  assert.equal(engine.normalizeTurnEndFrame('turn/end'), null)
  assert.equal(engine.normalizeTurnEndFrame(42), null)
  assert.equal(engine.normalizeTurnEndFrame({}), null)
  assert.equal(engine.normalizeTurnEndFrame({ type: 'turn/start', sessionId: 's-1', reasonKind: 'completed' }), null)
  assert.equal(engine.normalizeTurnEndFrame({ type: 'turn/end', reasonKind: 'completed' }), null, 'sessionId is required')
  assert.equal(engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: '   ', reasonKind: 'completed' }), null, 'blank sessionId is rejected')
  assert.equal(engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 's-1', reasonKind: 'aborted' }), null)
  assert.equal(engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 's-1', reasonKind: 'error' }), null)
  assert.equal(engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 's-1' }), null, 'a frame without a reason is not a completion')
  assert.doesNotThrow(() => engine.normalizeTurnEndFrame(Object.create(null)))
})

test('normalizeTurnEndFrame attributes subagent frames to their parent session', () => {
  const origin = engine.normalizeTurnEndFrame({
    type: 'turn/end',
    sessionId: 'sub-1',
    origin: 'subagent',
    parentSession: 'main-1',
    reasonKind: 'completed',
  })
  assert.equal(origin.isSubagent, true)
  assert.equal(origin.mainSessionId, 'main-1')

  const parentOnly = engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 'sub-1', parentSession: 'main-1', reasonKind: 'completed' })
  assert.equal(parentOnly.isSubagent, true, 'a parentSession alone marks the frame as subagent work')
  assert.equal(parentOnly.mainSessionId, 'main-1')

  const originOnly = engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 'sub-1', origin: 'subagent', reasonKind: 'completed' })
  assert.equal(originOnly.isSubagent, true)
  assert.equal(originOnly.mainSessionId, undefined, 'a subagent frame without a parent session is unattributable')
})

test('a completed host frame drives the reducer to one completion notification', () => {
  const normalized = engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 's-1', reasonKind: 'completed' })
  const { actions } = one({
    observation: { type: 'attention', event: { ...normalized, title: 'Refactor the parser', locale: 'zh' } },
    now: 0,
  })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].kind, 'show')
  assert.equal(actions[0].event, 'turnComplete')
  assert.equal(actions[0].body, '本轮已完成')
  assert.equal(actions[0].title, 'Refactor the parser')
  assert.equal(actions[0].tag, 's-1')

  // An aborted host frame never normalizes, so the pipeline yields nothing at all.
  assert.equal(engine.normalizeTurnEndFrame({ type: 'turn/end', sessionId: 's-1', reasonKind: 'aborted' }), null)
})

test('a completed subagent frame produces no completion notification', () => {
  const normalized = engine.normalizeTurnEndFrame({
    type: 'turn/end',
    sessionId: 'sub-1',
    origin: 'subagent',
    parentSession: 'main-1',
    reasonKind: 'completed',
  })
  const { actions } = one({
    observation: { type: 'attention', event: { ...normalized, title: 'Main session', locale: 'zh' } },
    now: 0,
  })
  assert.equal(actions.length, 0, 'subagent completions are merged into the main session')
})
