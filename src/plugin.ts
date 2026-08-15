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
// Configure in opencode.json, either bare or with options:
//
//   { "plugin": ["opencode-plugin-dcg@0.2.0"] }
//   { "plugin": [["opencode-plugin-dcg@0.2.0", { "failMode": "closed" }]] }
//
// Options: enabled, failMode, timeoutMs, tools, binary. The matching
// DCG_PLUGIN_* environment variables override them. See the README.

import type { Plugin, PluginOptions } from '@opencode-ai/plugin'
import { resolveConfig } from './config.ts'
import { createGuard } from './guard.ts'

export const DcgPlugin: Plugin = async (_input, options?: PluginOptions) => {
  const { config, warnings } = resolveConfig(options)

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
    report('warn', 'opencode-plugin-dcg: disabled by configuration — commands are NOT being checked.')
    return {}
  }

  const check = createGuard({ config, report })

  return {
    'tool.execute.before': async (input, output) => {
      await check(input.tool, output.args)
    },
  }
}
