// Types for the opencode-plugin-dcg guard.
//
// The plugin is a thin adapter: dcg owns every rule, pack and allowlist
// (`~/.config/dcg/config.toml`, project-level `.dcg.toml`). Nothing here
// re-implements dcg policy — it only models what dcg answers with.
//
// Types ONLY, no runtime exports. `src/index.ts` re-exports this module and
// opencode's loader throws on any export of the entry module that is not a
// plugin function; with nothing but types here, that mistake cannot be made.
// The passing-decision set lives next to its only reader, in `dcg.ts`.

/**
 * The decision values dcg emits. `DCG_POLICY_DEFAULT_MODE` documents
 * `deny|ask|warn|log`, and `allow` is the pass verdict.
 *
 * Only `allow` and `log` let a command through. `ask` blocks because there is
 * no interactive operator inside a plugin hook — that is dcg's own "fails
 * closed on unsupported clients" case — and `warn` blocks because a warning
 * the agent can ignore is not a guard.
 */
export type DcgDecision = 'allow' | 'log' | 'warn' | 'ask' | 'deny'

/** What dcg said about one command. */
export interface DcgVerdict {
  kind: 'verdict'
  /** Verbatim from dcg, lowercased. Unrecognised values still land here. */
  decision: string
  blocked: boolean
  /** dcg's own explanation, quoted back to the agent when blocking. */
  reason?: string
  /** The rule id that matched, when dcg reports one. */
  rule?: string
  /** dcg's suggested safer alternative, when it offers one. */
  suggestion?: string
}

/**
 * dcg could not be consulted. Never conflated with a verdict: a failure to
 * ask is not an answer, and which way it resolves is the caller's fail-mode
 * decision, never a default buried in the parser.
 */
export interface DcgFailure {
  kind: 'failure'
  reason: 'missing-binary' | 'timeout' | 'unparseable' | 'spawn-error'
  detail: string
}

export type DcgOutcome = DcgVerdict | DcgFailure

/** How the plugin behaves when dcg cannot be consulted. */
export type FailMode = 'open' | 'closed'

export interface DcgPluginConfig {
  enabled: boolean
  failMode: FailMode
  timeoutMs: number
  /** Tool names to check. Anything else passes through untouched. */
  tools: ReadonlySet<string>
  /** Binary name (resolved on PATH) or an absolute path. */
  binary: string
}

/**
 * The shape of a failed spawn. Deliberately structural rather than Node's
 * ErrnoException: execFile widens `code` to string | number (an exit status or
 * an errno like ENOENT), which ErrnoException does not model.
 */
export interface DcgSpawnError {
  code?: string | number
  message?: string
  killed?: boolean
  signal?: NodeJS.Signals | null
}

/** Result of one raw dcg invocation, before any decision is read out of it. */
export interface DcgRun {
  stdout: string
  stderr: string
  /** null when the process died on a signal or never started. */
  code: number | null
  /** Set when the process could not be run or was killed by the timeout. */
  error?: DcgSpawnError
  timedOut?: boolean
}

/** Injectable so tests never spawn a real process. */
export type DcgRunner = (
  binary: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<DcgRun>
