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
        // execFile reports the timeout kill as a signal, not an error code.
        const timedOut = err?.killed === true || err?.signal === 'SIGKILL'
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
 * Pull the first JSON object out of dcg's stdout.
 *
 * dcg is well-behaved in robot mode, but a shell profile that prints a banner
 * can prepend noise to a subprocess's stdout, and losing the whole verdict to
 * a stray line would fail the command open. Scanning for the first `{` and
 * parsing from there is enough without pretending to be a JSON stream parser.
 */
export function parseDecisionJSON(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf('{')
  if (start === -1) return null
  const candidate = stdout.slice(start).trim()
  try {
    const parsed: unknown = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through: an unparseable body is a failure, not an allow.
  }
  return null
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** Turn one raw run into a verdict or a failure. */
export function interpret(run: DcgRun): DcgOutcome {
  if (run.error?.code === 'ENOENT') {
    return { kind: 'failure', reason: 'missing-binary', detail: 'dcg is not on PATH' }
  }
  if (run.timedOut) {
    return { kind: 'failure', reason: 'timeout', detail: 'dcg did not answer before the timeout' }
  }

  const payload = parseDecisionJSON(run.stdout)
  if (!payload) {
    const detail = run.stderr.trim() || run.stdout.trim() || `dcg exited with code ${run.code}`
    return {
      kind: 'failure',
      reason: run.error && run.stdout.trim() === '' ? 'spawn-error' : 'unparseable',
      detail,
    }
  }

  const rawDecision = payload.decision
  if (typeof rawDecision !== 'string' || rawDecision.trim() === '') {
    return {
      kind: 'failure',
      reason: 'unparseable',
      detail: 'dcg returned JSON with no decision field',
    }
  }

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
