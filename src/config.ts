// Configuration, resolved from two layers.
//
// `opencode.json` is the durable layer — opencode passes a plugin's options
// object straight through:
//
//   { "plugin": [["opencode-plugin-dcg@0.1.0", { "failMode": "closed" }]] }
//
// Environment variables override it, so a session can be re-pointed without
// editing config. Their names match the ones the earlier community plugin
// used, so a setup carried over from it keeps working.
//
// Every unusable value produces a warning naming BOTH what was wrong and where
// it came from, then falls back. A guard that quietly ignores
// `failMode: "close"` (a typo) and runs fail-open is exactly the failure this
// plugin exists to prevent.

import type { DcgPluginConfig, FailMode } from './types.ts'

export const DEFAULT_TIMEOUT_MS = 5000
export const DEFAULT_BINARY = 'dcg'
export const DEFAULT_TOOL = 'bash'

const TRUE_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES: ReadonlySet<string> = new Set(['0', 'false', 'no', 'off'])

export interface ConfigResult {
  config: DcgPluginConfig
  /** Non-fatal complaints about the configuration, surfaced once at load. */
  warnings: string[]
}

/** One candidate value and where it came from, for warning messages. */
interface Source {
  value: unknown
  origin: string
}

function sources(options: Record<string, unknown>, key: string, env: NodeJS.ProcessEnv, envKey: string): Source[] {
  const layers: Source[] = []
  if (options[key] !== undefined) layers.push({ value: options[key], origin: `opencode.json ${key}` })
  // Env last: it overrides opencode.json.
  const raw = env[envKey]
  if (raw !== undefined && raw.trim() !== '') layers.push({ value: raw, origin: envKey })
  return layers
}

/**
 * Fold the layers, last valid value winning. An invalid value warns and is
 * skipped rather than aborting — a broken override must not also discard a
 * good base value.
 */
function resolve<T>(
  layers: Source[],
  parse: (value: unknown) => T | undefined,
  fallback: T,
  expectation: string,
  warnings: string[],
): T {
  let result = fallback
  for (const layer of layers) {
    const parsed = parse(layer.value)
    if (parsed === undefined) {
      warnings.push(`${layer.origin}=${JSON.stringify(layer.value)} is not ${expectation}. Ignoring it.`)
      continue
    }
    result = parsed
  }
  return result
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return undefined
}

function parseFailMode(value: unknown): FailMode | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized === 'open' || normalized === 'closed' ? normalized : undefined
}

function parseTimeout(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Accepts a JSON array (`["bash", "task"]`) or a comma-separated string, since
 * the two layers spell it differently. An empty list is rejected rather than
 * accepted: it would disable the guard while looking configured.
 *
 * Names are lowercased here, in the parser, so BOTH layers normalise the same
 * way: opencode hands the hook a lowercase tool id and `guard.ts` looks it up
 * with `tool.toLowerCase()`, so a stored "Bash" would never compare equal and
 * would silently guard nothing — the exact quiet-misconfiguration failure this
 * module exists to prevent.
 */
function parseTools(value: unknown): ReadonlySet<string> | undefined {
  const names = Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : typeof value === 'string'
      ? value.split(',')
      : null
  if (names === null) return undefined
  if (Array.isArray(value) && names.length !== value.length) return undefined
  const cleaned = names.map((name) => name.trim().toLowerCase()).filter((name) => name !== '')
  return cleaned.length > 0 ? new Set(cleaned) : undefined
}

function parseBinary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function resolveConfig(
  options: unknown = {},
  env: NodeJS.ProcessEnv = process.env,
): ConfigResult {
  const warnings: string[] = []

  let opts: Record<string, unknown> = {}
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    opts = options as Record<string, unknown>
  } else if (options !== undefined && options !== null) {
    warnings.push(`opencode.json plugin options must be an object, got ${JSON.stringify(options)}. Ignoring them.`)
  }

  const config: DcgPluginConfig = {
    enabled: resolve(
      sources(opts, 'enabled', env, 'DCG_PLUGIN_ENABLED'),
      parseBoolean,
      true,
      'a boolean',
      warnings,
    ),
    failMode: resolve(
      sources(opts, 'failMode', env, 'DCG_PLUGIN_FAIL_MODE'),
      parseFailMode,
      'open',
      '"open" or "closed"',
      warnings,
    ),
    timeoutMs: resolve(
      sources(opts, 'timeoutMs', env, 'DCG_PLUGIN_TIMEOUT_MS'),
      parseTimeout,
      DEFAULT_TIMEOUT_MS,
      'a positive integer',
      warnings,
    ),
    tools: resolve(
      sources(opts, 'tools', env, 'DCG_PLUGIN_TOOLS'),
      parseTools,
      new Set([DEFAULT_TOOL]),
      'a non-empty list of tool names',
      warnings,
    ),
    binary: resolve(
      sources(opts, 'binary', env, 'DCG_PLUGIN_BINARY'),
      parseBinary,
      DEFAULT_BINARY,
      'a non-empty string',
      warnings,
    ),
  }

  // Say it out loud rather than leaving it to be inferred from a missing
  // block: fail-open means dcg not answering lets the command run.
  if (config.enabled && config.failMode === 'open' && warnings.length > 0) {
    warnings.push('Running fail-open: commands run when dcg cannot be consulted. Set failMode "closed" to block instead.')
  }

  return { config, warnings }
}

/** Env-only resolution. Retained for callers that have no plugin options. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  return resolveConfig({}, env)
}
