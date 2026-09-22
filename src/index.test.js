import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { register } from './index.js'

function createRegistry(sharedStorage = new Map()) {
  const calls = {}
  const record = (key) => (value) => {
    calls[key] = [...(calls[key] ?? []), value]
  }

  const context = {
    id: 'openfox-devserver-status',
    version: '0.1.0',
    runtime: { mode: 'production', configDirectory: '/tmp' },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: {
      get: (key) => sharedStorage.get(key),
      set: (key, value) => sharedStorage.set(key, value),
    },
    settings: () => ({}),
    notify() {},
    publish() {},
  }

  const registry = {
    runtime: context.runtime,
    context,
    registerUiBadge: record('badge'),
    registerRpc: (method, handler) => record(`rpc:${method}`)(handler),
    registerHook: (event, handler) => record(`hook:${event}`)(handler),
  }

  return { registry, calls, sharedStorage }
}

function handler(calls, key) {
  const handlers = calls[key]
  assert.ok(handlers?.[0], `Missing handler: ${key}`)
  return handlers[0]
}

describe('openfox-devserver-status', () => {
  it('registers one workdir-scoped dynamic session-row badge', () => {
    const { registry, calls } = createRegistry()
    register(registry)

    assert.equal(calls.badge.length, 1)
    const badge = calls.badge[0]
    assert.equal(badge.id, 'devserver-status')
    assert.equal(badge.slot, 'session.row.badges')
    assert.equal(badge.appearance, 'icon')
    assert.equal(badge.source.kind, 'rpc')
    assert.equal(badge.source.method, 'status')
    assert.equal(badge.source.refreshMs, 2000)
    assert.equal(badge.source.cacheScope, 'workdir')
    assert.equal(calls['rpc:status'].length, 1)
    assert.equal(calls['hook:devserver.state.changed'].length, 1)
    assert.equal(calls['hook:devserver.started'].length, 1)
    assert.equal(calls['hook:devserver.stopped'].length, 1)
  })

  it('is invisible while no state is known or the server is off', async () => {
    const { registry, calls } = createRegistry()
    register(registry)
    const status = handler(calls, 'rpc:status')

    assert.deepEqual(await status({}, { workdir: '/tmp/a' }), { visible: false })

    await handler(calls, 'hook:devserver.stopped')({
      data: { workdir: '/tmp/a', reason: 'stop', url: 'http://localhost:3000' },
    })
    assert.deepEqual(await status({}, { workdir: '/tmp/a' }), { visible: false })
  })

  it('maps a started event to a green running badge', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.started')({
      data: { workdir: '/tmp/a', url: 'http://localhost:4173' },
    })

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' })
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'success')
    assert.match(result.tooltip.en, /http:\/\/localhost:4173/)
  })

  it('maps the full state hook to warning and error presentations', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    const stateChanged = handler(calls, 'hook:devserver.state.changed')
    const status = handler(calls, 'rpc:status')

    await stateChanged({
      data: {
        workdir: '/tmp/a',
        state: 'warning',
        url: 'http://localhost:4173',
        errorMessage: 'Vite reported a problem',
      },
    })
    let result = await status({}, { workdir: '/tmp/a' })
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'warning')
    assert.match(result.tooltip.en, /Vite reported a problem/)

    await stateChanged({
      data: {
        workdir: '/tmp/a',
        state: 'error',
        url: 'http://localhost:4173',
        errorMessage: 'Process exited',
      },
    })
    result = await status({}, { workdir: '/tmp/a' })
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'danger')
    assert.match(result.tooltip.en, /Process exited/)
  })

  it('keeps state across plugin re-enable in the same OpenFox process', async () => {
    const storage = new Map()
    const first = createRegistry(storage)
    register(first.registry)

    await handler(first.calls, 'hook:devserver.started')({
      data: { workdir: '/tmp/a', url: 'http://localhost:4173' },
    })

    const second = createRegistry(storage)
    register(second.registry)
    const result = await handler(second.calls, 'rpc:status')({}, { workdir: '/tmp/a' })
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'success')
  })

  it('maps an error stop to a red error badge', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.stopped')({
      data: {
        workdir: '/tmp/a',
        reason: 'error',
        url: 'http://localhost:4173',
        error: 'spawn failed',
      },
    })

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' })
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'danger')
    assert.match(result.tooltip.en, /spawn failed/)
  })
})
