// Canned dcg runs, so no test ever spawns a real binary.

import type { DcgRun, DcgRunner } from '../../src/types.ts'

export interface RecordedCall {
  binary: string
  args: readonly string[]
  timeoutMs: number
}

/** A runner that always answers the same way, and records how it was called. */
export function fakeRunner(run: Partial<DcgRun>): DcgRunner & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const runner = async (binary: string, args: readonly string[], timeoutMs: number) => {
    calls.push({ binary, args, timeoutMs })
    return { stdout: '', stderr: '', code: 0, ...run }
  }
  return Object.assign(runner, { calls })
}

/** A runner that throws instead of resolving — a spawn that never started. */
export function throwingRunner(message: string): DcgRunner {
  return async () => {
    throw new Error(message)
  }
}

export function decisionRun(payload: Record<string, unknown>, code = 0): Partial<DcgRun> {
  return { stdout: JSON.stringify(payload), code }
}
