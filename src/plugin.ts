// opencode-plugin-dcg
//
// Routes every shell command an agent runs through the dcg (destructive
// command guard) binary before it executes, and aborts the tool call when dcg
// flags it.
//
// The plugin is a thin adapter. Every rule, pack and allowlist lives in dcg's
// own config (`~/.config/dcg/config.toml`, or a project-level `.dcg.toml`),
// and dcg's `DCG_BYPASS=1` is honoured by simply letting dcg answer — no
// bypass logic is reimplemented here.
//
// This is a guardrail, NOT a security boundary. dcg matches command patterns;
// env-var prefixes, `sh -c` wrappers and shell aliases can slip past it. Treat
// it as a way to catch mistakes, never as containment for a hostile agent.
//
// Requires the dcg binary — the plugin does not install it:
//   https://github.com/Dicklesworthstone/destructive_command_guard#installation
//
// Configure in opencode.json:
//
//   { "plugin": ["opencode-plugin-dcg@0.1.0"] }
//
// Behaviour is set through the environment: DCG_PLUGIN_ENABLED,
// DCG_PLUGIN_FAIL_MODE, DCG_PLUGIN_TIMEOUT_MS, DCG_PLUGIN_TOOLS,
// DCG_PLUGIN_BINARY. See the README.

import type { Plugin } from '@opencode-ai/plugin'
import { configFromEnv } from './config.ts'
import { createGuard } from './guard.ts'

export const DcgPlugin: Plugin = async () => {
  const { config, warnings } = configFromEnv()

  // console is the only sink used on purpose: it reaches whoever is attached
  // to the opencode server's stdout without touching the plugin client, and a
  // client call awaited during load can stall startup.
  const report = (level: 'info' | 'warn', message: string) => {
    try {
      if (level === 'warn') console.warn(message)
      else console.log(message)
    } catch {
      // A failed log must never be able to break the guard.
    }
  }

  for (const warning of warnings) report('warn', `opencode-plugin-dcg: ${warning}`)

  if (!config.enabled) {
    report('warn', 'opencode-plugin-dcg: disabled via DCG_PLUGIN_ENABLED — commands are NOT being checked.')
    return {}
  }

  const check = createGuard({ config, report })

  return {
    'tool.execute.before': async (input, output) => {
      await check(input.tool, output.args)
    },
  }
}
