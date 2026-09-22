/**
 * OpenFox dev-server status plugin.
 *
 * The plugin owns all feature-specific state and presentation decisions.
 * OpenFox core only provides generic plugin hooks and a dynamic session-row
 * badge surface.
 *
 * @typedef {'off'|'running'|'warning'|'error'} DevServerState
 * @typedef {{
 *   state: DevServerState,
 *   url?: string | null,
 *   errorMessage?: string
 * }} TrackedStatus
 */

const STORAGE_PID_KEY = 'runtimePid'
const STORAGE_STATES_KEY = 'states'
const VALID_STATES = new Set(['off', 'running', 'warning', 'error'])

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * @param {unknown} value
 * @returns {DevServerState | undefined}
 */
function asState(value) {
  return typeof value === 'string' && VALID_STATES.has(value) ? /** @type {DevServerState} */ (value) : undefined
}

/**
 * Keep state across plugin disable/re-enable in the same OpenFox process,
 * while refusing to carry "running" state across an OpenFox restart.
 *
 * @param {import('openfox/plugin').PluginRegistry['context']} context
 * @returns {Map<string, TrackedStatus>}
 */
function loadRuntimeState(context) {
  const currentPid = String(process.pid)
  const storedPid = context.storage.get(STORAGE_PID_KEY)

  if (storedPid !== currentPid) {
    context.storage.set(STORAGE_PID_KEY, currentPid)
    context.storage.set(STORAGE_STATES_KEY, '{}')
    return new Map()
  }

  const raw = context.storage.get(STORAGE_STATES_KEY)
  if (typeof raw !== 'string') return new Map()

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()

    const entries = Object.entries(parsed).filter(([, status]) => {
      if (!status || typeof status !== 'object' || Array.isArray(status)) return false
      return asState(status.state) !== undefined
    })
    return new Map(entries)
  } catch {
    return new Map()
  }
}

/**
 * @param {import('openfox/plugin').PluginRegistry['context']} context
 * @param {Map<string, TrackedStatus>} states
 */
function persistRuntimeState(context, states) {
  context.storage.set(STORAGE_STATES_KEY, JSON.stringify(Object.fromEntries(states)))
}

/**
 * @param {TrackedStatus | undefined} status
 */
function toBadgeState(status) {
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

/**
 * @param {import('openfox/plugin').PluginRegistry} registry
 */
export function register(registry) {
  const { context } = registry
  const states = loadRuntimeState(context)

  /**
   * @param {string} workdir
   * @param {TrackedStatus} status
   */
  const update = (workdir, status) => {
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

  // Full-fidelity state hook. This is the canonical source when available.
  registry.registerHook('devserver.state.changed', (payload) => {
    const data = payload.data ?? {}
    const workdir = asString(data.workdir)
    const state = asState(data.state)
    if (!workdir || !state) return

    update(workdir, {
      state,
      url: asString(data.url) ?? null,
      errorMessage: asString(data.errorMessage),
    })
  })

  // Lifecycle hooks keep the plugin useful with the narrower dev-server hook
  // contract too, and provide richer start/stop semantics.
  registry.registerHook('devserver.started', (payload) => {
    const data = payload.data ?? {}
    const workdir = asString(data.workdir)
    if (!workdir) return

    update(workdir, {
      state: 'running',
      url: asString(data.url) ?? null,
    })
  })

  registry.registerHook('devserver.stopped', (payload) => {
    const data = payload.data ?? {}
    const workdir = asString(data.workdir)
    if (!workdir) return

    const reason = asString(data.reason)
    if (reason === 'error') {
      update(workdir, {
        state: 'error',
        url: asString(data.url) ?? null,
        errorMessage: asString(data.error),
      })
      return
    }

    update(workdir, { state: 'off', url: asString(data.url) ?? null })
  })
}
