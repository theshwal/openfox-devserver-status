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

  it('packs tooltip as a single dot-separated line including state, URL and relative age (CA-1, CA-4)', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.started')({
      data: {
        workdir: '/tmp/a',
        url: 'http://localhost:4173',
        command: 'vite',
      },
    })

    const status = handler(calls, 'rpc:status')
    const result = await status({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      tone: string
      tooltip: { en: string; fr: string }
    }
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'success')
    assert.ok(!result.tooltip.en.includes('\n'), 'English tooltip must be single-line')
    assert.ok(!result.tooltip.fr.includes('\n'), 'French tooltip must be single-line')
    assert.match(result.tooltip.en, /Running · http:\/\/localhost:4173 · Updated \d+s ago/)
    assert.match(result.tooltip.fr, /En cours · http:\/\/localhost:4173 · Maj : il y a \d+s/)
  })

  it('refreshes the relative age on each RPC call without re-emitting a hook (CA-4)', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    const startedAt = Date.now()
    await handler(calls, 'hook:devserver.started')({
      data: { workdir: '/tmp/a', url: 'http://localhost:4173' },
    })

    const status = handler(calls, 'rpc:status')

    const first = await status({}, { workdir: '/tmp/a' }) as {
      tooltip: { fr: string }
    }
    assert.match(first.tooltip.fr, /Maj : il y a 0s/)

    await new Promise((resolve) => setTimeout(resolve, 1100))

    const second = await status({}, { workdir: '/tmp/a' }) as {
      tooltip: { fr: string }
    }
    const ageMatch = second.tooltip.fr.match(/Maj : il y a (\d+)s/)
    assert.ok(ageMatch, 'should still include a relative age segment')
    assert.ok(Number(ageMatch![1]) >= 1, `expected at least 1s elapsed, got ${ageMatch![1]}`)
    void startedAt
  })

  it('surfaces the configured port as the badge value when running (CA-3)', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.started')({
      data: { workdir: '/tmp/a', url: 'http://localhost:5173' },
    })

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      value?: string | number
    }
    assert.equal(result.visible, true)
    assert.equal(result.value, '5173')
  })

  it('omits the badge value when the URL has no explicit port (CA-3)', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.started')({
      data: { workdir: '/tmp/a', url: 'http://localhost/' },
    })

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      value?: string | number
    }
    assert.equal(result.visible, true)
    assert.equal(result.value, undefined)
  })

  it('flags the URL as potentially unreachable on error and exposes the last command (CA-2, CA-5)', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.started')({
      data: {
        workdir: '/tmp/a',
        url: 'http://localhost:8000',
        command: 'uvicorn app:app --port 8000',
      },
    })

    await handler(calls, 'hook:devserver.stopped')({
      data: {
        workdir: '/tmp/a',
        reason: 'error',
        url: 'http://localhost:8000',
        error: 'spawn failed',
      },
    })

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' }) as {
      visible: boolean
      tone: string
      tooltip: { en: string; fr: string }
    }
    assert.equal(result.visible, true)
    assert.equal(result.tone, 'danger')
    assert.match(result.tooltip.en, /URL may not be reachable/)
    assert.match(result.tooltip.fr, /URL peut ne pas être joignable/)
    assert.match(result.tooltip.en, /uvicorn app:app --port 8000/)
    assert.match(result.tooltip.en, /spawn failed/)
  })

  it('localizes the age segment in the French error tooltip (regression for CA-1/CA-2)', async () => {
    const { registry, calls } = createRegistry()
    register(registry)

    await handler(calls, 'hook:devserver.started')({
      data: {
        workdir: '/tmp/a',
        url: 'http://localhost:8000',
        command: 'uvicorn app:app --port 8000',
      },
    })

    await handler(calls, 'hook:devserver.stopped')({
      data: {
        workdir: '/tmp/a',
        reason: 'error',
        url: 'http://localhost:8000',
        error: 'spawn failed',
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 1100))

    const result = await handler(calls, 'rpc:status')({}, { workdir: '/tmp/a' }) as {
      tooltip: { en: string; fr: string }
    }
    assert.match(result.tooltip.fr, /Maj : il y a \d+s/)
    assert.doesNotMatch(result.tooltip.fr, /Updated/)
    assert.match(result.tooltip.en, /Updated \d+s ago/)
  })
})
