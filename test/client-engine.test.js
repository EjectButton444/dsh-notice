// Unit tests for the dsh-notice decision engine — the only automated seam in v1
// (docs/spec.md "Testing Decisions": normalize -> decide is a pure function; the
// DSH state source, the notification sender and the locale adapter are covered by
// the real-machine checklist instead).
//
// `client.engine.js` is a classic browser script (a package-local client chunk),
// so these tests load it the way DSH loads it: a fresh vm context with a fake
// `window.__ModuleLoader__`, then take the registered factory's exports. That
// also pins the chunk registration contract the client half depends on.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEngine } from './helpers.js'

const engine = loadEngine()

test('engine is the pure decision pipeline, not a DSH or Notification adapter', () => {
  assert.equal(typeof engine.decide, 'function')
  assert.equal(typeof engine.decideEvent, 'function')
  assert.equal(typeof engine.normalizeEvent, 'function')
  assert.equal(typeof engine.classifyPending, 'function')
  assert.ok(engine.EVENT_KINDS.includes('approval'))
  assert.ok(engine.EVENT_KINDS.includes('question'))
  assert.ok(engine.EVENT_KINDS.includes('turnComplete'))
  assert.equal(engine.DEFAULT_CONFIG.condition, 'unfocused')
  assert.equal(engine.DEFAULT_CONFIG.sound, true)
  assert.equal(engine.DEFAULT_CONFIG.mute, false)
  assert.deepEqual({ ...engine.DEFAULT_CONFIG.events }, { approval: true, question: true, turnComplete: true })
})

// --- Event mapping --------------------------------------------------------
// Each attention event becomes one system notification action whose content is
// only "session title + event type" (docs/spec.md: never tool names, question
// text or user messages).

const WINDOW_UNFOCUSED = { focused: false, viewedSessionId: undefined }

function decideOne(event, overrides = {}) {
  const actions = engine.decide({
    event: { sessionId: 's-1', title: 'Refactor the parser', ...event },
    runtime: WINDOW_UNFOCUSED,
    config: engine.DEFAULT_CONFIG,
    ...overrides,
  })
  assert.equal(actions.length, 1, 'one attention event yields one show action')
  return actions[0]
}

test('approval request maps to the approval wording', () => {
  const action = decideOne({ kind: 'approval', locale: 'zh' })
  assert.equal(action.kind, 'show')
  assert.equal(action.event, 'approval')
  assert.equal(action.title, 'Refactor the parser')
  assert.equal(action.body, '需要你确认权限')
  assert.equal(action.tag, 's-1', 'tag is the session id so Windows replaces instead of stacking')
  assert.equal(action.silent, false, 'default config keeps the system notification sound on')
})

test('question request maps to the question wording', () => {
  assert.equal(decideOne({ kind: 'question', locale: 'zh' }).body, '在等你回答')
})

test('turn completion maps to the completion wording', () => {
  assert.equal(decideOne({ kind: 'turnComplete', locale: 'zh' }).body, '本轮已完成')
})

test('wording follows the DSH interface language (zh / en)', () => {
  const cases = [
    ['approval', '需要你确认权限', 'Waiting for your approval'],
    ['question', '在等你回答', 'Waiting for your answer'],
    ['turnComplete', '本轮已完成', 'Turn completed'],
  ]
  for (const [kind, zh, en] of cases) {
    assert.equal(decideOne({ kind, locale: 'zh' }).body, zh)
    assert.equal(decideOne({ kind, locale: 'en' }).body, en)
  }
})

test('an empty session title falls back to the unnamed-session wording with its workspace', () => {
  const zh = decideOne({ kind: 'question', locale: 'zh', title: '', workspace: 'notice' })
  assert.equal(zh.title, '未命名会话（notice）')

  const en = decideOne({ kind: 'question', locale: 'en', title: undefined, workspace: 'notice' })
  assert.equal(en.title, 'Untitled session (notice)')

  const bare = decideOne({ kind: 'question', locale: 'zh', title: '   ' })
  assert.equal(bare.title, '未命名会话')
})

// --- Per-session foreground suppression ----------------------------------
// The default `unfocused` condition: notify whenever the human is not looking at
// the exact session the event belongs to. It is per session, not per window
// (docs/design-notes.md §3.2, acceptance criterion "DSH 前台且正在看该会话时不弹；
// 在看别的会话时仍然弹").

function decideWith(event, runtime) {
  return engine.decide({
    event: { sessionId: 's-1', title: 'Refactor the parser', ...event },
    runtime,
    config: engine.DEFAULT_CONFIG,
  })
}

test('no notification while DSH is focused on the event session', () => {
  const actions = decideWith({ kind: 'approval', locale: 'zh' }, { focused: true, viewedSessionId: 's-1' })
  assert.equal(actions.length, 0)
})

test('still notifies while DSH is focused on a different session', () => {
  const actions = decideWith({ kind: 'approval', locale: 'zh' }, { focused: true, viewedSessionId: 's-2' })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].tag, 's-1')
})

test('notifies when DSH is not focused, even if the event session is the retained main view', () => {
  const actions = decideWith({ kind: 'turnComplete', locale: 'zh' }, { focused: false, viewedSessionId: 's-1' })
  assert.equal(actions.length, 1)
})

test('notifies while DSH is focused but no main-view session is resolvable', () => {
  const actions = decideWith({ kind: 'question', locale: 'zh' }, { focused: true, viewedSessionId: undefined })
  assert.equal(actions.length, 1)
})

test('a subagent event is attributed to its main session for tag and suppression', () => {
  const subagentEvent = { sessionId: 'sub-1', isSubagent: true, mainSessionId: 'main-1', kind: 'question', locale: 'zh' }

  const viewedMain = engine.decide({
    event: { ...subagentEvent, title: 'Main session' },
    runtime: { focused: true, viewedSessionId: 'main-1' },
    config: engine.DEFAULT_CONFIG,
  })
  assert.equal(viewedMain.length, 0, 'the main session is on screen: the subagent question is visible there')

  const viewedSubagent = engine.decide({
    event: { ...subagentEvent, title: 'Main session' },
    runtime: { focused: true, viewedSessionId: 'sub-1' },
    config: engine.DEFAULT_CONFIG,
  })
  assert.equal(viewedSubagent.length, 0, 'the subagent view itself is on screen')

  const viewedElsewhere = engine.decide({
    event: { ...subagentEvent, title: 'Main session' },
    runtime: { focused: true, viewedSessionId: 's-2' },
    config: engine.DEFAULT_CONFIG,
  })
  assert.equal(viewedElsewhere.length, 1)
  assert.equal(viewedElsewhere[0].tag, 'main-1', 'one notification per main session, not per subagent session')
  assert.equal(viewedElsewhere[0].title, 'Main session')
})

test('an unattributable subagent event is dropped instead of guessing a session', () => {
  const actions = decideWith({ kind: 'question', isSubagent: true }, { focused: false })
  assert.equal(actions.length, 0)
})

// --- Normalization edges --------------------------------------------------

test('normalizeEvent rejects observations that are not attention events', () => {
  assert.equal(engine.normalizeEvent(null), null)
  assert.equal(engine.normalizeEvent({ kind: 'approval' }), null, 'a session id is required')
  assert.equal(engine.normalizeEvent({ sessionId: 's-1', kind: 'plan-review' }), null, 'plan approval is out of scope in v1')
  assert.equal(engine.normalizeEvent({ sessionId: '  ', kind: 'question' }), null)
})

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
  assert.equal(event.locale, 'zh', 'regional variants resolve to the shipped dictionary')
  assert.equal(event.isSubagent, false)
  assert.equal(event.mainSessionId, undefined, 'main sessions never carry a main-session id')
})

test('an unknown locale falls back to english', () => {
  assert.equal(decideOne({ kind: 'approval', locale: 'fr' }).body, 'Waiting for your approval')
})

test('the sound setting only changes the silence flag, not content', () => {
  const quiet = engine.decide({
    event: { sessionId: 's-1', kind: 'approval', locale: 'zh', title: 'T' },
    runtime: WINDOW_UNFOCUSED,
    config: { ...engine.DEFAULT_CONFIG, sound: false },
  })
  assert.equal(quiet[0].silent, true)
  assert.equal(quiet[0].body, '需要你确认权限')
})

// --- Adapter-facing input side --------------------------------------------
// The DSH adapter maps `pendingInteraction.kind` and hands the normalized event
// straight to decideEvent: one classification table in the engine, so adding an
// event kind never requires editing the adapter.

test('classifyPending maps only the attention pending kinds', () => {
  assert.equal(engine.classifyPending('approval'), 'approval')
  assert.equal(engine.classifyPending('question'), 'question')
  assert.equal(engine.classifyPending('plan-review'), undefined, 'plan approval is out of scope in v1')
  assert.equal(engine.classifyPending(undefined), undefined)
  assert.equal(engine.classifyPending(null), undefined)
})

test('decideEvent consumes an already-normalized event', () => {
  const event = engine.normalizeEvent({ sessionId: 's-1', kind: 'question', title: 'T', locale: 'zh' })
  assert.equal(event.kind, 'question')
  const actions = engine.decideEvent(event, { runtime: WINDOW_UNFOCUSED, config: engine.DEFAULT_CONFIG })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].body, '在等你回答')
  assert.equal(engine.decideEvent(null, {}).length, 0, 'a dropped observation yields no action')
})
