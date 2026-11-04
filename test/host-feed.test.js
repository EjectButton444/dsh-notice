// Contract tests for the host half of ticket #7: the precise turn-completion feed.
//
// The host half observes DSH `session/event` `turn/end` events, keeps only
// `reason.kind === 'completed'`, and pushes the normalized frame over a
// document-relative SSE route (`GET /dsh-notice/events`). These tests pin:
//   A. the pure normalization seam (`toCompletionFrame`), which decides what a
//      "completed turn" is and never throws,
//   B. the SSE broadcaster (`createCompletionFeed`), including the rule that one
//      broken client never breaks the feed or the session,
//   C. the host wiring in `apply`: route registration and the `session/event`
//      subscription, both disposable.
//
// The browser half is covered separately by its own tests; the host half only
// normalizes and transports, it repeats no notification rules.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as host from '../index.js'

/** One `turn/end` session log event, shaped like the event DSH appends. */
function turnEndEvent(kind, turn = 1) {
  return { type: 'turn/end', data: { turn, reason: { kind } } }
}

/** One session as the `session/event` listener receives it. */
function session(id = 'session-1', header) {
  return header === undefined ? { id } : { id, header }
}

test('toCompletionFrame returns a completed frame and preserves session identity', () => {
  assert.deepEqual(host.toCompletionFrame(session(), turnEndEvent('completed', 3)), {
    type: 'turn/end',
    sessionId: 'session-1',
    reasonKind: 'completed',
    turn: 3,
  })
})

test('toCompletionFrame drops every turn end reason that is not a completion', () => {
  // Everything except `completed` ends the turn without the assistant waiting on
  // the user: Stop (`aborted`), approvals/plan gating (`blocked`), model failures
  // (`error`), crash recovery (`interrupted`), fork seeds (`forked`) and token caps
  // (`max-tokens`). None of them may become a completion notification.
  for (const kind of ['aborted', 'blocked', 'error', 'interrupted', 'forked', 'max-tokens', 'unknown']) {
    assert.equal(
      host.toCompletionFrame(session(), turnEndEvent(kind)),
      null,
      `reason.kind ${JSON.stringify(kind)} must not be normalized into a completion frame`,
    )
  }
})

test('toCompletionFrame drops every other session event type', () => {
  for (const type of ['turn/start', 'step/start', 'step/end', 'assistant/message', 'session/end']) {
    assert.equal(
      host.toCompletionFrame(session(), { type, data: { turn: 1, reason: { kind: 'completed' } } }),
      null,
      `a ${type} event is not a turn end`,
    )
  }
})

test('toCompletionFrame returns null for malformed sessions and events without throwing', () => {
  const cases = [
    [undefined, turnEndEvent('completed')],
    [null, turnEndEvent('completed')],
    [session(), undefined],
    [session(), null],
    [session(), {}],
    [session(), { type: 'turn/end' }],
    [session(), { type: 'turn/end', data: null }],
    [session(), { type: 'turn/end', data: {} }],
    [session(), { type: 'turn/end', data: { turn: 1, reason: null } }],
    [session(), { type: 'turn/end', data: { turn: 1, reason: {} } }],
    [{}, turnEndEvent('completed')],
    [{ id: '' }, turnEndEvent('completed')],
    [{ id: 42 }, turnEndEvent('completed')],
    [{ id: null }, turnEndEvent('completed')],
  ]

  for (const [invalidSession, invalidEvent] of cases) {
    assert.equal(host.toCompletionFrame(invalidSession, invalidEvent), null)
  }
})

test('toCompletionFrame carries only the fields the frame contract declares', () => {
  const unrelatedHeader = host.toCompletionFrame({ id: 's1', header: { cwd: 'C:\\work' }, extra: true }, turnEndEvent('completed', 2))
  assert.deepEqual(unrelatedHeader, { type: 'turn/end', sessionId: 's1', reasonKind: 'completed', turn: 2 })

  const withoutTurn = host.toCompletionFrame(session(), {
    type: 'turn/end',
    data: { turn: 'not-a-number', reason: { kind: 'completed' } },
  })
  assert.equal(Object.hasOwn(withoutTurn, 'turn'), false, 'turn is only reported when the event carries a number')

  const primary = host.toCompletionFrame({ id: 'root', header: { origin: 'primary', parentSession: '' } }, turnEndEvent('completed'))
  assert.equal(Object.hasOwn(primary, 'origin'), false, 'a primary session is not reported as a subagent')
  assert.equal(Object.hasOwn(primary, 'parentSession'), false, 'an empty parentSession is not reported')

  const subagent = host.toCompletionFrame({ id: 'sub', header: { origin: 'subagent', parentSession: 'root' } }, turnEndEvent('completed'))
  assert.deepEqual(subagent, {
    type: 'turn/end',
    sessionId: 'sub',
    reasonKind: 'completed',
    turn: 1,
    origin: 'subagent',
    parentSession: 'root',
  })
})

test('toCompletionFrame never throws on hostile accessors', () => {
  const hostileSession = {}
  Object.defineProperty(hostileSession, 'id', {
    get() {
      throw new Error('session id exploded')
    },
  })
  assert.equal(host.toCompletionFrame(hostileSession, turnEndEvent('completed')), null, 'an unreadable session is not a completion')

  const hostileEvent = { type: 'turn/end' }
  Object.defineProperty(hostileEvent, 'data', {
    get() {
      throw new Error('event data exploded')
    },
  })
  assert.equal(host.toCompletionFrame(session(), hostileEvent), null, 'an unreadable event is not a completion')
})

test('createCompletionFeed connect writes the SSE handshake and tracks the client', () => {
  const feed = host.createCompletionFeed()
  const response = sseResponse()

  feed.connect(response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream')
  assert.equal(response.headers['cache-control'], 'no-cache')
  assert.equal(response.headers.connection, 'keep-alive')
  assert.deepEqual(response.writes, [': connected\n\n'], 'the browser half gets an immediate handshake comment')
  assert.equal(response.ended, false, 'the stream stays open')
  assert.equal(response.closeListeners.length, 1, 'the feed watches the client go away')
})

test('createCompletionFeed publish broadcasts completed frames to every connected client', () => {
  const feed = host.createCompletionFeed()
  const first = sseResponse()
  const second = sseResponse()
  feed.connect(first)
  feed.connect(second)

  feed.publish(session(), turnEndEvent('aborted', 1))
  feed.publish(session(), turnEndEvent('completed', 2))

  const frame = { type: 'turn/end', sessionId: 'session-1', reasonKind: 'completed', turn: 2 }
  const line = `data: ${JSON.stringify(frame)}\n\n`
  assert.deepEqual(first.writes, [': connected\n\n', line], 'a non-completed reason is never written')
  assert.deepEqual(second.writes, [': connected\n\n', line], 'every client receives the completion')
})

test('createCompletionFeed forgets a client whose connection closed', () => {
  const feed = host.createCompletionFeed()
  const response = sseResponse()
  feed.connect(response)

  response.emitClose()
  feed.publish(session(), turnEndEvent('completed'))

  assert.deepEqual(response.writes, [': connected\n\n'], 'a closed stream is not written to')
})

test('createCompletionFeed survives an async response error and drops only that stream', () => {
  const feed = host.createCompletionFeed()
  const dying = sseResponse()
  const healthy = sseResponse()
  feed.connect(dying)
  feed.connect(healthy)

  // A socket can fail asynchronously after the synchronous writes; an unhandled
  // response 'error' would crash the host, so the feed drops that stream only.
  assert.doesNotThrow(() => dying.emitError(new Error('socket reset')), 'an async socket error never escapes the feed')
  assert.equal(dying.destroyed, true, 'the failed stream is dropped')

  feed.publish(session(), turnEndEvent('completed', 9))
  assert.equal(dying.writes.length, 1, 'a dropped stream is not written to')
  assert.equal(healthy.writes.length, 2, 'the healthy client still receives the frame')
})

test('createCompletionFeed drops a broken client without disturbing the others', () => {
  const feed = host.createCompletionFeed()
  const broken = sseResponse()
  const healthy = sseResponse()
  feed.connect(broken)
  feed.connect(healthy)
  broken.failWrites = true

  assert.doesNotThrow(() => feed.publish(session(), turnEndEvent('completed', 4)), 'a write failure never escapes the feed')
  assert.equal(broken.writes.length, 1, 'the failed frame is not delivered')
  assert.equal(healthy.writes.length, 2, 'the healthy client still receives the frame')
  assert.equal(broken.destroyed, true, 'a broken connection is dropped')

  feed.publish(session(), turnEndEvent('completed', 5))
  assert.equal(broken.writes.length, 1, 'a dropped connection is not retried')
  assert.equal(healthy.writes.length, 3, 'the feed keeps serving healthy clients')
})

test('createCompletionFeed swallows a hostile session accessor and keeps working', () => {
  const feed = host.createCompletionFeed()
  const response = sseResponse()
  feed.connect(response)
  const hostileSession = {}
  Object.defineProperty(hostileSession, 'id', {
    get() {
      throw new Error('session exploded')
    },
  })

  assert.doesNotThrow(() => feed.publish(hostileSession, turnEndEvent('completed')), 'a session getter failure never escapes the feed')
  assert.deepEqual(response.writes, [': connected\n\n'], 'an unreadable session produces no frame')

  feed.publish(session(), turnEndEvent('completed', 6))
  assert.equal(response.writes.length, 2, 'the feed still works after a hostile event')
})

test('createCompletionFeed swallows a client that cannot even be connected', () => {
  const feed = host.createCompletionFeed()
  const response = sseResponse()
  response.failWrites = true

  assert.doesNotThrow(() => feed.connect(response))
  assert.equal(response.destroyed, true, 'an unusable stream is destroyed')

  response.failWrites = false
  feed.publish(session(), turnEndEvent('completed'))
  assert.equal(response.writes.length, 0, 'an unusable stream is never tracked')
})

test('createCompletionFeed close destroys every stream and forgets it', () => {
  const feed = host.createCompletionFeed()
  const first = sseResponse()
  const second = sseResponse()
  feed.connect(first)
  feed.connect(second)

  feed.close()

  assert.equal(first.destroyed, true)
  assert.equal(second.destroyed, true)
  feed.publish(session(), turnEndEvent('completed'))
  assert.equal(first.writes.length, 1, 'nothing is written after close')
  assert.equal(second.writes.length, 1, 'nothing is written after close')
})

test('apply mounts the events route: GET streams, HEAD announces, other methods are refused', () => {
  const { ctx, state } = fakeHost()
  host.apply(ctx, {})

  assert.equal(state.routes.length, 3, 'config, focus and events routes are all mounted')
  const eventsRoute = routeAt(state.routes, '/dsh-notice/events')
  assert.equal(eventsRoute.kind, 'exact')

  const streamed = sseResponse()
  eventsRoute.handler({ method: 'GET' }, streamed)
  assert.equal(streamed.statusCode, 200)
  assert.equal(streamed.headers['content-type'], 'text/event-stream')
  assert.equal(streamed.headers['cache-control'], 'no-cache')
  assert.equal(streamed.headers.connection, 'keep-alive')
  assert.deepEqual(streamed.writes, [': connected\n\n'], 'GET opens the stream with a handshake comment')
  assert.equal(streamed.ended, false)

  const head = sseResponse()
  eventsRoute.handler({ method: 'HEAD' }, head)
  assert.equal(head.statusCode, 200)
  assert.equal(head.headers['content-type'], 'text/event-stream')
  assert.deepEqual(head.writes, [], 'HEAD announces the stream but does not open one')
  assert.equal(head.ended, true)

  for (const method of ['POST', 'PUT', 'DELETE']) {
    const rejected = sseResponse()
    eventsRoute.handler({ method }, rejected)
    assert.equal(rejected.statusCode, 405, `${method} is not an SSE verb`)
    assert.equal(rejected.headers.allow, 'GET, HEAD')
    assert.deepEqual(rejected.writes, [], `${method} never opens a stream`)
    assert.equal(rejected.ended, true)
  }
})

test('a broken events route response is swallowed and destroyed', () => {
  const { ctx, state } = fakeHost()
  host.apply(ctx, {})

  const response = sseResponse()
  response.writeHead = () => {
    throw new Error('headers already sent')
  }
  assert.doesNotThrow(
    () => routeAt(state.routes, '/dsh-notice/events').handler({ method: 'GET' }, response),
    'a route handler failure never escapes into the host',
  )
  assert.equal(response.destroyed, true, 'the unusable response is destroyed')
})

test('apply forwards completed session/event turns to connected clients and drops the rest', () => {
  const { ctx, state } = fakeHost()
  host.apply(ctx, {})

  assert.equal(state.subscriptions.length, 1, 'the host half subscribes exactly one session/event listener')
  assert.equal(state.subscriptions[0].event, 'session/event')

  const response = sseResponse()
  routeAt(state.routes, '/dsh-notice/events').handler({ method: 'GET' }, response)

  state.emit('session/event', session(), turnEndEvent('aborted', 1))
  state.emit('session/event', session(), turnEndEvent('error', 2))
  state.emit('session/event', session(), turnEndEvent('completed', 8))

  const frame = { type: 'turn/end', sessionId: 'session-1', reasonKind: 'completed', turn: 8 }
  assert.deepEqual(response.writes, [': connected\n\n', `data: ${JSON.stringify(frame)}\n\n`])
})

test('apply disposal unsubscribes the session/event listener and closes open streams', () => {
  const { ctx, state } = fakeHost()
  host.apply(ctx, {})

  const response = sseResponse()
  routeAt(state.routes, '/dsh-notice/events').handler({ method: 'GET' }, response)

  for (const dispose of state.disposers) dispose()

  assert.equal(state.subscriptions.length, 0, 'the session/event listener is unsubscribed')
  assert.equal(response.destroyed, true, 'an open stream is closed with the plugin')
  assert.equal(state.routes.length, 0, 'every route registration is disposed')

  state.emit('session/event', session(), turnEndEvent('completed'))
  assert.deepEqual(response.writes, [': connected\n\n'], 'a disposed feed never writes again')
})

test('apply tolerates a missing or throwing session/event bus and still mounts every route', () => {
  const brokenBuses = [
    ['missing', (ctx) => delete ctx.on],
    [
      'throwing',
      (ctx) => {
        ctx.on = () => {
          throw new Error('no event bus')
        }
      },
    ],
  ]

  for (const [label, breakBus] of brokenBuses) {
    const { ctx, state } = fakeHost()
    breakBus(ctx)

    const warnings = captureWarnings(() => {
      assert.doesNotThrow(() => host.apply(ctx, {}), `apply tolerates a ${label} ctx.on`)
    })
    assert.equal(state.routes.length, 3, `every route still mounts with a ${label} ctx.on`)
    assert.ok(
      warnings.some((args) => String(args[0]).includes('session/event')),
      `a ${label} session/event bus is logged, never thrown`,
    )

    const response = sseResponse()
    routeAt(state.routes, '/dsh-notice/events').handler({ method: 'GET' }, response)
    assert.equal(response.statusCode, 200, 'the feed still serves with a broken event bus')

    for (const dispose of state.disposers) dispose()
    assert.equal(response.destroyed, true, `disposal still closes streams with a ${label} ctx.on`)
  }
})

/** Minimal host plugin context double that records routes, effect disposers and event listeners. */
function fakeHost() {
  const state = {
    routes: [],
    subscriptions: [],
    disposers: [],
  }
  const ctx = {
    effect(callback) {
      const dispose = callback()
      assert.equal(typeof dispose, 'function', 'every mounted effect must be disposable')
      state.disposers.push(dispose)
      return dispose
    },
    on(event, listener) {
      const subscription = { event, listener }
      state.subscriptions.push(subscription)
      return () => {
        const index = state.subscriptions.indexOf(subscription)
        if (index >= 0) state.subscriptions.splice(index, 1)
      }
    },
    webServer: {
      register(route) {
        state.routes.push(route)
        return () => {
          const index = state.routes.indexOf(route)
          if (index >= 0) state.routes.splice(index, 1)
        }
      },
    },
  }
  state.emit = (event, ...args) => {
    for (const subscription of [...state.subscriptions]) {
      if (subscription.event === event) subscription.listener(...args)
    }
  }
  return { ctx, state }
}

/** One mounted route by exact path. */
function routeAt(routes, path) {
  const route = routes.find((candidate) => candidate.path === path)
  assert.ok(route, `route ${path} must be mounted`)
  return route
}

/** Run `callback` with console.warn captured, returning the recorded warning argument lists. */
function captureWarnings(callback) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => {
    warnings.push(args)
  }
  try {
    callback()
  } finally {
    console.warn = original
  }
  return warnings
}

/** Minimal Node response double for the SSE feed and route tests. */
function sseResponse() {
  const response = {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    ended: false,
    destroyed: false,
    failWrites: false,
    writes: [],
    closeListeners: [],
    errorListeners: [],
    writeHead(statusCode, headers) {
      response.statusCode = statusCode
      response.headers = headers
    },
    write(chunk) {
      if (response.failWrites) throw new Error('write failed')
      response.writes.push(chunk)
    },
    end(body) {
      response.body = body
      response.ended = true
    },
    destroy() {
      response.destroyed = true
    },
    on(event, listener) {
      if (event === 'close') response.closeListeners.push(listener)
      if (event === 'error') response.errorListeners.push(listener)
      return response
    },
    emitClose() {
      for (const listener of response.closeListeners) listener()
    },
    emitError(error) {
      assert.ok(response.errorListeners.length > 0, 'the stream subscribes an error listener')
      for (const listener of response.errorListeners) listener(error)
    },
  }
  return response
}

