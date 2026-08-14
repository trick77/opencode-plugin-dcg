// The decision layer: given a tool call, decide whether to let it run.
//
// Kept free of opencode types and of process spawning so the whole policy is
// unit-testable without a plugin host or a real binary.

import type { DcgOutcome, DcgPluginConfig, DcgRunner } from './types.ts'
import { clip, evaluate } from './dcg.ts'

export type Reporter = (level: 'info' | 'warn', message: string) => void

export interface GuardDeps {
  config: DcgPluginConfig
  runner?: DcgRunner
  report?: Reporter
}

/** Thrown to abort a tool call. The message is what the agent reads. */
export class DcgBlockedError extends Error {
  readonly decision: string
  constructor(message: string, decision: string) {
    super(message)
    this.name = 'DcgBlockedError'
    this.decision = decision
  }
}

export function blockMessage(command: string, outcome: DcgOutcome): string {
  const lines: string[] = []
  if (outcome.kind === 'verdict') {
    // The command goes in whole — the agent has to see what was blocked — but
    // everything dcg wrote is clipped, same as a failure detail: these fields
    // come straight out of dcg's JSON and are not bounded at the source.
    lines.push(`Blocked by dcg (decision: ${outcome.decision}): ${command}`)
    if (outcome.reason) lines.push(`Reason: ${clip(outcome.reason)}`)
    if (outcome.rule) lines.push(`Rule: ${clip(outcome.rule)}`)
    if (outcome.suggestion) lines.push(`Suggestion: ${clip(outcome.suggestion)}`)
  } else {
    lines.push(`Blocked: dcg could not check this command (${outcome.reason}): ${command}`)
    lines.push(`Detail: ${outcome.detail}`)
    // This branch is only ever reached from the fail-closed path, so the note
    // states why the block happened. Advertising DCG_PLUGIN_FAIL_MODE=closed
    // here would tell the user to switch on what is already switched on.
    lines.push('Blocked because DCG_PLUGIN_FAIL_MODE=closed. Fix dcg, or set it to open to run unchecked.')
  }
  return lines.join('\n')
}

/**
 * Read the shell command out of a tool call's arguments.
 *
 * `args` is typed `any` by the plugin API, so nothing about its shape is
 * guaranteed. A call with no string command is left alone — there is nothing
 * to check, and inventing a block would break unrelated tools that happen to
 * be listed in DCG_PLUGIN_TOOLS.
 */
export function commandFromArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const command = (args as Record<string, unknown>).command
  if (typeof command !== 'string' || command.trim() === '') return null
  return command
}

export function createGuard(deps: GuardDeps) {
  const { config, runner } = deps
  const report: Reporter = deps.report ?? (() => {})

  // A missing binary is reported once, not once per command: the agent would
  // otherwise get the same warning on every call for the rest of the session.
  //
  // Detected on first use rather than by a probe at plugin init. An init probe
  // races the first tool calls — whichever commands arrive before it resolves
  // go unchecked, which is the one outcome a guard must not have.
  let warnedMissingBinary = false

  return async function check(tool: string, args: unknown): Promise<void> {
    if (!config.enabled) return
    // Config lowercases the configured names; lowercase the incoming one too
    // so the two sides can never drift apart on casing alone.
    if (!config.tools.has(tool.toLowerCase())) return

    const command = commandFromArgs(args)
    if (command === null) return

    const outcome = await evaluate(
      command,
      { binary: config.binary, timeoutMs: config.timeoutMs },
      runner,
    )

    if (outcome.kind === 'verdict') {
      if (outcome.blocked) {
        const message = blockMessage(command, outcome)
        report('warn', message)
        throw new DcgBlockedError(message, outcome.decision)
      }
      return
    }

    // dcg could not be consulted.
    if (outcome.reason === 'missing-binary') {
      if (!warnedMissingBinary) {
        warnedMissingBinary = true
        report(
          'warn',
          `opencode-plugin-dcg: "${config.binary}" is not on PATH — commands are ${
            config.failMode === 'closed' ? 'being blocked' : 'NOT being checked'
          }. Install dcg (https://github.com/Dicklesworthstone/destructive_command_guard) or set DCG_PLUGIN_ENABLED=false.`,
        )
      }
    } else {
      report('warn', `opencode-plugin-dcg: ${outcome.reason} — ${outcome.detail}`)
    }

    if (config.failMode === 'closed') {
      throw new DcgBlockedError(blockMessage(command, outcome), outcome.reason)
    }
  }
}
