/**
 * Narrow compile-time mirror of the OpenFox Plugin API surface used here.
 *
 * The source imports from "openfox/plugin"; tsconfig maps that module to this
 * file until the #370/#374 contracts ship in a released OpenFox package.
 */
export type LocalizedString = { en: string; fr: string }
export type PluginBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export type PluginUiBadgeAppearance = 'badge' | 'icon'
export type PluginUiBadgeCacheScope = 'context' | 'session' | 'workdir' | 'project'

export interface PluginUiBadgeDynamicState {
  visible?: boolean
  value?: string | number
  label?: LocalizedString
  tone?: PluginBadgeTone
  tooltip?: LocalizedString
  icon?: string
}

export interface PluginUiBadgeRpcSource {
  kind: 'rpc'
  method: string
  refreshMs?: number
  cacheScope?: PluginUiBadgeCacheScope
}

export interface PluginUiBadge {
  id: string
  slot: string
  label: LocalizedString
  tone?: PluginBadgeTone
  tooltip?: LocalizedString
  icon?: string
  appearance?: PluginUiBadgeAppearance
  value?: string
  visibleWhen?: {
    hasSession?: boolean
    hasProject?: boolean
    hasMessage?: boolean
  }
  source?: PluginUiBadgeRpcSource
}

export type PluginHookEvent =
  | 'devserver.started'
  | 'devserver.stopped'
  | 'devserver.state.changed'

export interface PluginHookPayload {
  event?: PluginHookEvent
  sessionId?: string
  projectId?: string
  timestamp?: string
  data: Record<string, unknown>
}

export interface PluginStorage {
  get(key: string): string | number | boolean | undefined
  set(key: string, value: string | number | boolean): void
}

export interface PluginContext {
  readonly storage: PluginStorage
}

export interface PluginRpcContext {
  sessionId?: string
  projectId?: string
  workdir?: string
  [key: string]: unknown
}

export interface PluginRegistry {
  readonly context: PluginContext
  registerUiBadge(badge: PluginUiBadge): void
  registerRpc(
    method: string,
    handler: (params: Record<string, unknown>, context: PluginRpcContext) => unknown | Promise<unknown>,
  ): void
  registerHook(
    event: PluginHookEvent,
    handler: (payload: PluginHookPayload) => void | Promise<void>,
  ): void
}
