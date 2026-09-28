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
  command?: string
  updatedAt: number
}

const STORAGE_PID_KEY = 'runtimePid'
const STORAGE_STATES_KEY = 'states'
const VALID_STATES = new Set<DevServerState>(['off', 'running', 'warning', 'error'])

export const RPC_NAMESPACE = 'devserverStatus.'
export const RPC_METHOD = `${RPC_NAMESPACE}status`

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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

function extractPortFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.port ? parsed.port : undefined
  } catch {
    const match = url.match(/:(\d+)(?:\/|$)/)
    return match?.[1]
  }
}

function stateLabel(
  state: DevServerState,
  locale: 'en' | 'fr',
): string {
  if (locale === 'fr') {
    if (state === 'running') return 'En cours'
    if (state === 'warning') return 'Avertissement'
    return 'Erreur'
  }
  if (state === 'running') return 'Running'
  if (state === 'warning') return 'Warning'
  return 'Error'
}

function relativeAge(updatedAt: number, now: number, locale: 'en' | 'fr'): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (locale === 'fr') {
    if (seconds < 60) return `Maj : il y a ${seconds}s`
    const minutes = Math.round(seconds / 60)
    return `Maj : il y a ${minutes}min`
  }
  if (seconds < 60) return `Updated ${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return `Updated ${minutes}min ago`
}

function parseTrackedStatus(value: unknown): TrackedStatus | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const state = asState(record.state)
  if (!state) return undefined

  const updatedAt = asNumber(record.updatedAt)
  if (updatedAt === undefined) return undefined

  const errorMessage = asString(record.errorMessage)
  const command = asString(record.command)
  const url = asString(record.url) ?? null

  return {
    state,
    url,
    updatedAt,
    ...(errorMessage ? { errorMessage } : {}),
    ...(command ? { command } : {}),
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

function buildTooltip(segments: (string | undefined)[]): string {
  return segments.filter((s): s is string => typeof s === 'string' && s.length > 0).join(' · ')
}

function toBadgeState(
  status: TrackedStatus | undefined,
  now: number,
): PluginUiBadgeDynamicState {
  if (!status || status.state === 'off') return { visible: false }

  const port = extractPortFromUrl(status.url)
  const value = port

  if (status.state === 'running') {
    const urlSegment = status.url ?? undefined
    return {
      ...(value ? { value } : {}),
      visible: true,
      tone: 'success',
      tooltip: {
        en: buildTooltip([
          stateLabel('running', 'en'),
          urlSegment,
          relativeAge(status.updatedAt, now, 'en'),
        ]),
        fr: buildTooltip([
          stateLabel('running', 'fr'),
          urlSegment,
          relativeAge(status.updatedAt, now, 'fr'),
        ]),
      },
    }
  }

  if (status.state === 'warning') {
    const urlSegment = status.url ?? undefined
    const errorSegment = status.errorMessage
    return {
      ...(value ? { value } : {}),
      visible: true,
      tone: 'warning',
      tooltip: {
        en: buildTooltip([
          stateLabel('warning', 'en'),
          urlSegment,
          errorSegment,
          relativeAge(status.updatedAt, now, 'en'),
        ]),
        fr: buildTooltip([
          stateLabel('warning', 'fr'),
          urlSegment,
          errorSegment,
          relativeAge(status.updatedAt, now, 'fr'),
        ]),
      },
    }
  }

  const urlSegment = status.url ?? undefined
  const errorSegment = status.errorMessage
  const commandSegment = status.command
  return {
    ...(value ? { value } : {}),
    visible: true,
    tone: 'danger',
    tooltip: {
      en: buildTooltip([
        stateLabel('error', 'en'),
        urlSegment,
        errorSegment,
        commandSegment,
        'URL may not be reachable',
        relativeAge(status.updatedAt, now, 'en'),
      ]),
      fr: buildTooltip([
        stateLabel('error', 'fr'),
        urlSegment,
        errorSegment,
        commandSegment,
        'URL peut ne pas être joignable',
        relativeAge(status.updatedAt, now, 'fr'),
      ]),
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
      method: RPC_METHOD,
      refreshMs: 2000,
      cacheScope: 'workdir',
    },
  })

  registry.registerRpc(RPC_METHOD, async (_params, rpcContext) => {
    const workdir = asString(rpcContext.workdir)
    if (!workdir) return { visible: false }
    return toBadgeState(states.get(workdir), Date.now())
  })

  registry.registerHook('devserver.state.changed', (payload) => {
    const workdir = asString(payload.data.workdir)
    const state = asState(payload.data.state)
    if (!workdir || !state) return

    const errorMessage = asString(payload.data.errorMessage)
    const previous = states.get(workdir)
    update(workdir, {
      state,
      url: asString(payload.data.url) ?? null,
      updatedAt: Date.now(),
      ...(previous?.command ? { command: previous.command } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    })
  })

  registry.registerHook('devserver.started', (payload) => {
    const workdir = asString(payload.data.workdir)
    if (!workdir) return

    const command = asString(payload.data.command)
    update(workdir, {
      state: 'running',
      url: asString(payload.data.url) ?? null,
      updatedAt: Date.now(),
      ...(command ? { command } : {}),
    })
  })

  registry.registerHook('devserver.stopped', (payload) => {
    const workdir = asString(payload.data.workdir)
    if (!workdir) return

    const reason = asString(payload.data.reason)
    const previous = states.get(workdir)
    const command = previous?.command

    if (reason === 'error') {
      const errorMessage = asString(payload.data.error)
      update(workdir, {
        state: 'error',
        url: asString(payload.data.url) ?? null,
        updatedAt: Date.now(),
        ...(command ? { command } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      })
      return
    }

    update(workdir, {
      state: 'off',
      url: asString(payload.data.url) ?? null,
      updatedAt: Date.now(),
      ...(command ? { command } : {}),
    })
  })
}
