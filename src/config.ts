// Environment-variable configuration.
//
// Variable names match the ones the earlier community plugin used, so a setup
// carried over from it keeps working unchanged.
//
// Every unrecognised value produces a warning rather than being silently
// coerced. A guard that quietly ignores `DCG_PLUGIN_FAIL_MODE=close` (a typo
// for `closed`) and runs fail-open is exactly the failure this plugin exists
// to prevent.

import type { DcgPluginConfig, FailMode } from './types.ts'

export const DEFAULT_TIMEOUT_MS = 5000
export const DEFAULT_BINARY = 'dcg'
export const DEFAULT_TOOL = 'bash'

const TRUE_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off'])

export interface ConfigResult {
  config: DcgPluginConfig
  /** Non-fatal complaints about the environment, surfaced once at load. */
  warnings: string[]
}

function parseBoolean(
  raw: string | undefined,
  fallback: boolean,
  name: string,
  warnings: string[],
): boolean {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = raw.trim().toLowerCase()
  if (TRUE_VALUES.has(value)) return true
  if (FALSE_VALUES.has(value)) return false
  warnings.push(
    `${name}="${raw}" is not a boolean — expected one of ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')}. Using ${fallback}.`,
  )
  return fallback
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const warnings: string[] = []

  const enabled = parseBoolean(env.DCG_PLUGIN_ENABLED, true, 'DCG_PLUGIN_ENABLED', warnings)

  let failMode: FailMode = 'open'
  const rawFailMode = env.DCG_PLUGIN_FAIL_MODE?.trim().toLowerCase()
  if (rawFailMode === 'closed' || rawFailMode === 'open') {
    failMode = rawFailMode
  } else if (rawFailMode) {
    warnings.push(
      `DCG_PLUGIN_FAIL_MODE="${env.DCG_PLUGIN_FAIL_MODE}" is not "open" or "closed". Using open — commands will run when dcg cannot be consulted.`,
    )
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS
  const rawTimeout = env.DCG_PLUGIN_TIMEOUT_MS?.trim()
  if (rawTimeout) {
    const parsed = Number(rawTimeout)
    if (Number.isInteger(parsed) && parsed > 0) {
      timeoutMs = parsed
    } else {
      warnings.push(
        `DCG_PLUGIN_TIMEOUT_MS="${rawTimeout}" is not a positive integer. Using ${DEFAULT_TIMEOUT_MS}.`,
      )
    }
  }

  // An empty tool list would disable the guard while looking configured, so an
  // all-blank value falls back to the default rather than checking nothing.
  let tools: ReadonlySet<string> = new Set([DEFAULT_TOOL])
  const rawTools = env.DCG_PLUGIN_TOOLS?.trim()
  if (rawTools) {
    const names = rawTools
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '')
    if (names.length > 0) tools = new Set(names)
    else warnings.push(`DCG_PLUGIN_TOOLS="${rawTools}" lists no tool names. Checking "${DEFAULT_TOOL}".`)
  }

  const binary = env.DCG_PLUGIN_BINARY?.trim() || DEFAULT_BINARY

  return { config: { enabled, failMode, timeoutMs, tools, binary }, warnings }
}
