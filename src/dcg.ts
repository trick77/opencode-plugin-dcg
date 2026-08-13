// Spawning dcg and reading a decision out of what it says.
//
// Two rules hold this together:
//
//  1. stdout is parsed regardless of exit code. dcg exits non-zero on a deny
//     and still prints its decision JSON, so branching on the exit code first
//     would throw away the reason text — and dcg's exit codes are overloaded
//     (a usage error also exits non-zero), so they cannot distinguish "this
//     command is dangerous" from "we called dcg wrong".
//  2. Only the `decision` field decides. Anything unrecognised becomes a
//     failure for the caller's fail-mode to resolve, never a silent allow.

import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import type { DcgOutcome, DcgRun, DcgRunner } from './types.ts'
import { PASSING_DECISIONS } from './types.ts'

/**
 * Robot mode forces JSON on stdout regardless of `--format`, and `test`
 * evaluates a command without executing it.
 *
 * The command is passed as its own argv element through `execFile`, so no
 * shell ever sees it — quoting, `$(…)`, backticks and newlines in the
 * candidate command are inert here.
 */
export function dcgArgs(command: string): readonly string[] {
  return ['--robot', 'test', command]
}

/** The real runner. Never used by the unit tests. */
export const spawnDcg: DcgRunner = (binary, args, timeoutMs) =>
  new Promise<DcgRun>((resolve) => {
    execFile(
      binary,
      [...args],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        const err = error as ExecFileException | null
        // A maxBuffer overflow is delivered as a kill too, so it has to be
        // ruled out before `killed` is read as "the timeout fired". Both
        // resolve through the same fail-mode, but mislabelling one as the
        // other sends a debugger after DCG_PLUGIN_TIMEOUT_MS, which cannot fix
        // output that was simply too large.
        const overflowed = err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        // execFile reports the timeout kill as a signal, not an error code.
        const timedOut = !overflowed && (err?.killed === true || err?.signal === 'SIGKILL')
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code: typeof err?.code === 'number' ? err.code : error ? null : 0,
          error: err ?? undefined,
          timedOut,
        })
      },
    )
  })

/**
 * Index just past the object that starts at `start`, or -1 if it never closes.
 *
 * Brace counting that knows about strings and escapes, so a `}` inside a
 * reason string does not end the object early.
 */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i + 1
  }
  return -1
}

/**
 * Pull dcg's decision object out of stdout.
 *
 * dcg is well-behaved in robot mode, but a subprocess's stdout is not ours
 * alone: a shell profile can prepend a banner, and a stray log line can follow
 * the JSON. Losing the whole verdict to either would fail the command open, so
 * every `{` is tried as a start and the object is closed by brace counting
 * rather than by assuming it runs to the end of the output.
 *
 * An object carrying a `decision` wins over one that does not, so a `{…}` in
 * the surrounding noise cannot shadow the real verdict.
 */
export function parseDecisionJSON(stdout: string): Record<string, unknown> | null {
  let fallback: Record<string, unknown> | null = null
  for (let i = stdout.indexOf('{'); i !== -1; i = stdout.indexOf('{', i + 1)) {
    const end = objectEnd(stdout, i)
    if (end === -1) break
    let parsed: unknown
    try {
      parsed = JSON.parse(stdout.slice(i, end))
    } catch {
      // Not JSON. Try the next `{` — an unparseable body is a failure, not an
      // allow, but a banner brace must not be what makes it one.
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const object = parsed as Record<string, unknown>
    if (typeof object.decision === 'string') return object
    fallback ??= object
    i = end - 1
  }
  return fallback
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** Longest failure detail quoted back. dcg's output can be megabytes. */
const MAX_DETAIL = 400

function clip(text: string): string {
  return text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL)}… (truncated)`
}

/** Turn one raw run into a verdict or a failure. */
export function interpret(run: DcgRun): DcgOutcome {
  // stdout is read BEFORE the spawn-level failures. A dcg that printed a
  // complete verdict and then hung — child holding the pipe, slow exit, tight
  // DCG_PLUGIN_TIMEOUT_MS — still answered. Discarding that answer and
  // resolving the kill through the fail-mode would run, under the default
  // fail-open, a command dcg had already denied.
  const payload = parseDecisionJSON(run.stdout)
  const rawDecision = payload?.decision
  if (payload && typeof rawDecision === 'string' && rawDecision.trim() !== '') {
    const decision = rawDecision.trim().toLowerCase()
    return {
      kind: 'verdict',
      decision,
      blocked: !PASSING_DECISIONS.has(decision),
      reason: firstString(payload, ['reason', 'message', 'explanation']),
      rule: firstString(payload, ['rule', 'rule_id', 'ruleId', 'pack']),
      suggestion: firstString(payload, ['suggestion', 'remediation', 'fix']),
    }
  }

  if (run.error?.code === 'ENOENT') {
    return { kind: 'failure', reason: 'missing-binary', detail: 'dcg is not on PATH' }
  }
  if (run.timedOut) {
    return { kind: 'failure', reason: 'timeout', detail: 'dcg did not answer before the timeout' }
  }

  if (payload) {
    return {
      kind: 'failure',
      reason: 'unparseable',
      detail: 'dcg returned JSON with no decision field',
    }
  }

  const detail = run.stderr.trim() || run.stdout.trim() || `dcg exited with code ${run.code}`
  return {
    kind: 'failure',
    reason: run.error && run.stdout.trim() === '' ? 'spawn-error' : 'unparseable',
    detail: clip(detail),
  }
}

/** Ask dcg about one command. */
export async function evaluate(
  command: string,
  options: { binary: string; timeoutMs: number },
  runner: DcgRunner = spawnDcg,
): Promise<DcgOutcome> {
  try {
    return interpret(await runner(options.binary, dcgArgs(command), options.timeoutMs))
  } catch (error) {
    return {
      kind: 'failure',
      reason: 'spawn-error',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
