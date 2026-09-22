import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PluginRegistry, PluginUiBadge } from 'openfox/plugin'
import { register } from '../src/index.js'

type RegisteredHandler = (...args: any[]) => any
type Calls = Record<string, unknown[]>

function createRegistry(sharedStorage = new Map<string, string | number | boolean>()) {
  const calls: Calls = {}

  const record =
    <T>(key: string) =>
    (value: T): void => {
      calls[key] = [...(calls[key] ?? []), value]
    }

  const context = {
    id: 'openfox-devserver-status',
    version: '0.2.0',
    runtime: { mode: 'production', configDirectory: '/tmp' },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: {
      get: (key: string) => sharedStorage.get(key),
      set: (key: string, value: string | number | boolean) => sharedStorage.set(key, value),
    },
    settings: () => ({}),
    notify() {},
    publish() {},
  }

  const registry = {
    runtime: context.runtime,
    context,
    registerUiBadge: record<PluginUiBadge>('badge'),
    registerRpc: (method: string, handler: RegisteredHandler) => record<RegisteredHandler>(`rpc:${method}`)(handler),
    registerHook: (event: string, handler: RegisteredHandler) => record<RegisteredHandler>(`hook:${event}`)(handler),
  }

  return {
    registry: registry as unknown as PluginRegistry,
    calls,
    sharedStorage,
  }
}

function handler(calls: Calls, key: string): RegisteredHandler {
  const candidate = calls[key]?.[0]
  assert.equal(typeof candidate, 'function', `Missing handler: ${key}`)
  return candidate as RegisteredHandler
}

describe('openfox-devserver-status', () => {
  it('registers one workdir-scoped dynamic session-row badge', () => {
    const { registry, calls } = createRegistry()
    register(registry)

    assert.equal(calls.badge?.length, 1)
    const badge = calls.badge?.[0] as PluginUiBadge
    assert.equal(badge.id, 'devserver-status')
    assert.equal(badge.slot, 'session.row.badges')
    assert.equal(badge.appearance, 'icon')
    assert.equal(badge.source?.kind, 'rpc')
    assert.equal(badge.source?.method, 'status')
    assert.equal(badge.source?.refreshMs, 2000)
    assert.equal(badge.source?.cacheScope, 'workdir')
    assert.equal(calls['rpc:status']?.length, 1)
    assert.equal(calls['hook:devserver.state.changed']?.length, 1)
    assert.equal(calls['hook:devserver.started']?.length, 1)
    assert.equal(calls['hook:devserver.stopped']?.length, 1)
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

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      tone: string
      tooltip: { en: string }
    }
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
    let result = await status({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      tone: string
      tooltip: { en: string }
    }
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
    result = await status({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      tone: string
      tooltip: { en: string }
    }
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'danger')
    assert.match(result.tooltip.en, /Process exited/)
  })

  it('keeps state across plugin re-enable in the same OpenFox process', async () => {
    const storage = new Map<string, string | number | boolean>()
    const first = createRegistry(storage)
    register(first.registry)

    await handler(first.calls, 'hook:devserver.started')({
      data: { workdir: '/tmp/a', url: 'http://localhost:4173' },
    })

    const second = createRegistry(storage)
    register(second.registry)
    const result = await handler(second.calls, 'rpc:status')({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      tone: string
    }
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

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      tone: string
      tooltip: { en: string }
    }
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'danger')
    assert.match(result.tooltip.en, /spawn failed/)
  })
})
