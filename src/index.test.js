import { describe, expect, it, vi } from 'vitest'
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
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    storage: {
      get: (key) => sharedStorage.get(key),
      set: (key, value) => sharedStorage.set(key, value),
    },
    settings: () => ({}),
    notify: vi.fn(),
    publish: vi.fn(),
  }

  const registry = {
    runtime: context.runtime,
    context,
    registerUiBadge: record('badge'),
    registerRpc: (method, handler) => record(`rpc:${method}`)(handler),
    registerHook: (event, handler) => record(`hook:${event}`)(handler),
  }

  return { registry, calls, context, sharedStorage }
}

function handler(calls, key) {
  const handlers = calls[key]
  if (!handlers?.[0]) throw new Error(`Missing handler: ${key}`)
  return handlers[0]
}

describe('openfox-devserver-status', () => {
  it('registers one workdir-scoped dynamic session-row badge', () => {
    const { registry, calls } = createRegistry()
    register(registry)

    expect(calls.badge).toHaveLength(1)
    expect(calls.badge[0]).toMatchObject({
      id: 'devserver-status',
      slot: 'session.row.badges',
      icon: 'server',
      appearance: 'icon',
      source: {
        kind: 'rpc',
        method: 'status',
        refreshMs: 2000,
        cacheScope: 'workdir',
      },
    })
    expect(calls['rpc:status']).toHaveLength(1)
    expect(calls['hook:devserver.state.changed']).toHaveLength(1)
    expect(calls['hook:devserver.started']).toHaveLength(1)
    expect(calls['hook:devserver.stopped']).toHaveLength(1)
  })

  it('is invisible while no state is known or the server is off', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    const status = handler(calls, 'rpc:status')
    await expect(status({}, { workdir: '/tmp/a' })).resolves.toEqual({ visible: false })

    await handler(calls, 'hook:devserver.stopped')({
      data: { workdir: '/tmp/a', reason: 'stop', url: 'http://localhost:3000' },
    })
    await expect(status({}, { workdir: '/tmp/a' })).resolves.toEqual({ visible: false })
  })

  it('maps a started event to a green running badge', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.started')({
      data: { workdir: '/tmp/a', url: 'http://localhost:4173' },
    })

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' })
    expect(result).toMatchObject({
      visible: true,
      tone: 'success',
      tooltip: {
        en: expect.stringContaining('http://localhost:4173'),
      },
    })
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
    await expect(status({}, { workdir: '/tmp/a' })).resolves.toMatchObject({
      visible: true,
      tone: 'warning',
      tooltip: { en: expect.stringContaining('Vite reported a problem') },
    })

    await stateChanged({
      data: {
        workdir: '/tmp/a',
        state: 'error',
        url: 'http://localhost:4173',
        errorMessage: 'Process exited',
      },
    })
    await expect(status({}, { workdir: '/tmp/a' })).resolves.toMatchObject({
      visible: true,
      tone: 'danger',
      tooltip: { en: expect.stringContaining('Process exited') },
    })
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

    await expect(handler(second.calls, 'rpc:status')({}, { workdir: '/tmp/a' })).resolves.toMatchObject({
      visible: true,
      tone: 'success',
    })
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

    await expect(handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' })).resolves.toMatchObject({
      visible: true,
      tone: 'danger',
      tooltip: { en: expect.stringContaining('spawn failed') },
    })
  })
})
