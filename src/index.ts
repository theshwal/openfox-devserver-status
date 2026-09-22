import type {
  PluginContext,
  PluginRegistry,
  PluginUiBadgeDynamicState,
} from 'openfox/plugin'

type DevServerState = 'off' | 'running' | 'warning' | 'error'

interface TrackedStatus {
  state: DevServerState
  url?: string | null
  errorMessage?: string
}

const STORAGE_PID_KEY = 'runtimePid'
const STORAGE_STATES_KEY = 'states'
const VALID_STATES = new Set<DevServerState>(['off', 'running', 'warning', 'error'])

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asState(value: unknown): DevServerState | undefined {
  return typeof value === 'string' && VALID_STATES.has(value as DevServerState)
    ? (value as DevServerState)
    : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function runtimePid(): string {
  const pid = (globalThis as { process?: { pid?: unknown } }).process?.pid
  return typeof pid === 'number' ? String(pid) : 'unknown'
}

function parseTrackedStatus(value: unknown): TrackedStatus | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const state = asState(record.state)
  if (!state) return undefined

  const errorMessage = asString(record.errorMessage)
  return {
    state,
    url: asString(record.url) ?? null,
    ...(errorMessage ? { errorMessage } : {}),
  }
}

function loadRuntimeState(context: PluginContext): Map<string, TrackedStatus> {
  const currentPid = runtimePid()
  const storedPid = context.storage.get(STORAGE_PID_KEY)

  if (storedPid !== currentPid) {
    context.storage.set(STORAGE_PID_KEY, currentPid)
    context.storage.set(STORAGE_STATES_KEY, '{}')
    return new Map()
  }

  const raw = context.storage.get(STORAGE_STATES_KEY)
  if (typeof raw !== 'string') return new Map()

  try {
    const parsed = asRecord(JSON.parse(raw) as unknown)
    if (!parsed) return new Map()

    const states = new Map<string, TrackedStatus>()
    for (const [workdir, value] of Object.entries(parsed)) {
      const status = parseTrackedStatus(value)
      if (status) states.set(workdir, status)
    }
    return states
  } catch {
    return new Map()
  }
}

function persistRuntimeState(context: PluginContext, states: Map<string, TrackedStatus>): void {
  context.storage.set(STORAGE_STATES_KEY, JSON.stringify(Object.fromEntries(states)))
}

function toBadgeState(status: TrackedStatus | undefined): PluginUiBadgeDynamicState {
  if (!status || status.state === 'off') return { visible: false }

  if (status.state === 'running') {
    const suffix = status.url ? ` — ${status.url}` : ''
    return {
      visible: true,
      tone: 'success',
      tooltip: {
        en: `Dev server running${suffix}`,
        fr: `Serveur de développement actif${suffix}`,
      },
    }
  }

  if (status.state === 'warning') {
    const suffix = status.errorMessage ? ` — ${status.errorMessage}` : ''
    return {
      visible: true,
      tone: 'warning',
      tooltip: {
        en: `Dev server warning${suffix}`,
        fr: `Avertissement serveur de développement${suffix}`,
      },
    }
  }

  const suffix = status.errorMessage ? ` — ${status.errorMessage}` : ''
  return {
    visible: true,
    tone: 'danger',
    tooltip: {
      en: `Dev server error${suffix}`,
      fr: `Erreur serveur de développement${suffix}`,
    },
  }
}

export function register(registry: PluginRegistry): void {
  const { context } = registry
  const states = loadRuntimeState(context)

  const update = (workdir: string, status: TrackedStatus): void => {
    states.set(workdir, status)
    persistRuntimeState(context, states)
  }

  registry.registerUiBadge({
    id: 'devserver-status',
    slot: 'session.row.badges',
    label: { en: 'Dev server', fr: 'Serveur dev' },
    icon: 'M3 4h18v6H3z M3 14h18v6H3z M7 7h.01 M7 17h.01',
    appearance: 'icon',
    visibleWhen: { hasSession: true },
    source: {
      kind: 'rpc',
      method: 'status',
      refreshMs: 2000,
      cacheScope: 'workdir',
    },
  })

  registry.registerRpc('status', async (_params, rpcContext) => {
    const workdir = asString(rpcContext.workdir)
    if (!workdir) return { visible: false }
    return toBadgeState(states.get(workdir))
  })

  registry.registerHook('devserver.state.changed', (payload) => {
    const workdir = asString(payload.data.workdir)
    const state = asState(payload.data.state)
    if (!workdir || !state) return

    const errorMessage = asString(payload.data.errorMessage)
    update(workdir, {
      state,
      url: asString(payload.data.url) ?? null,
      ...(errorMessage ? { errorMessage } : {}),
    })
  })

  registry.registerHook('devserver.started', (payload) => {
    const workdir = asString(payload.data.workdir)
    if (!workdir) return

    update(workdir, {
      state: 'running',
      url: asString(payload.data.url) ?? null,
    })
  })

  registry.registerHook('devserver.stopped', (payload) => {
    const workdir = asString(payload.data.workdir)
    if (!workdir) return

    const reason = asString(payload.data.reason)
    if (reason === 'error') {
      const errorMessage = asString(payload.data.error)
      update(workdir, {
        state: 'error',
        url: asString(payload.data.url) ?? null,
        ...(errorMessage ? { errorMessage } : {}),
      })
      return
    }

    update(workdir, {
      state: 'off',
      url: asString(payload.data.url) ?? null,
    })
  })
}
