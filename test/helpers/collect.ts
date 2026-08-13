import type { Reporter } from '../../src/guard.ts'

export function collectReports(): { report: Reporter; messages: string[] } {
  const messages: string[] = []
  return { report: (level, message) => void messages.push(`${level}: ${message}`), messages }
}
