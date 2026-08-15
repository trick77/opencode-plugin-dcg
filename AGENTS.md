# AGENTS.md

opencode plugin that blocks destructive shell commands by asking the `dcg`
binary before each tool call.

## Build / test

- `npm run build` → `tsc --noEmit` (typecheck only; no `dist`).
- `npm test` → typecheck + `node --test test/*.test.ts`. Node 22+.
- Ships raw TS: `main` is `src/index.ts` (opencode/bun runs it). Every relative
  import MUST carry a `.ts` extension (`./types.ts`) — enabled by
  `allowImportingTsExtensions`. Extensionless imports break the node test runner.
- Entry module `src/index.ts`: EVERY runtime export must be a plugin function.
  opencode's loader iterates `Object.values(mod)` and throws "Plugin export is
  not a function" on anything else. Re-export types with `export type *`, NEVER
  `export *`. Keep `types.ts` type-only — a value there reaches the loader
  through the re-export; runtime constants live next to their reader.
- Helpers live in `test/helpers/` so the `test/*.test.ts` glob skips them.
- Harness runs on NODE; opencode runs BUN. Touching `src/index.ts` exports or
  anything transpiler-sensitive → also load for real: scratch dir with
  `"plugin": ["file:///<abs-path-to-checkout>"]`, `opencode models --print-logs`,
  confirm no `failed to load plugin`. Never `--pure` — skips external plugins.

## The one rule that matters

**A guard that silently stops guarding is worse than no guard.** Every path
where dcg cannot be consulted — missing binary, timeout, crash, unreadable
output — must be a named `DcgFailure`, reported to the user, and resolved by
`DCG_PLUGIN_FAIL_MODE`. Never allow-by-accident, never `catch {}` into a pass.

- Only the `decision` field decides. NEVER branch on dcg's exit code: it is
  non-zero for a deny AND for a usage error, so it cannot tell "dangerous" from
  "we called dcg wrong". Parse stdout regardless of exit code.
- Unrecognised decision value → failure, not allow.
- `ask` and `warn` BLOCK. No operator exists inside a hook to answer an `ask`.
- Missing binary is detected on FIRST USE, never by a startup probe — a probe
  races the first tool calls and lets them through unchecked.
- Warn once per session for a missing binary, not once per command.

## Configuration layers

Two layers, resolved in `src/config.ts`: `opencode.json` plugin options (the
`[spec, options]` tuple opencode passes as the plugin function's second
argument) are the base; `DCG_PLUGIN_*` env vars override them. Adding a setting
means adding it to BOTH layers and to the README table.

An invalid value in one layer warns and is SKIPPED — it must never discard a
valid value from the layer beneath, and the warning must name its origin
(`opencode.json failMode` vs `DCG_PLUGIN_FAIL_MODE`) or the user cannot find
what to fix.

Normalise in the PARSER, not at the call site: tool names are lowercased inside
`parseTools` so both layers agree, because `guard.ts` looks them up with
`tool.toLowerCase()`.

## Boundaries

- dcg owns all policy: rules, packs, severities, allowlists, `DCG_BYPASS`.
  Never reimplement any of it here. This plugin is an adapter.
- Never call it a security boundary in docs, comments or messages — env-var
  prefixes, `sh -c` and aliases slip past pattern matching. "Guardrail" only.
- No LLM review of blocked commands. Conversation context is agent-controlled,
  so a review model can be prompt-injected into approving the command it was
  asked to judge. Deliberately out of scope; do not add it back.
- Spawn without a shell (`execFile`, command as its own argv element). Never
  interpolate a candidate command into a shell string.

## Don't add

- Runtime dependencies. `@opencode-ai/plugin` is the only one.
- Install-time lifecycle scripts (`preinstall`/`postinstall`), floating version
  ranges in devDependencies, or tarball/git specifiers.
- Awaited opencode client calls during plugin load — the server cannot answer
  while a plugin blocks it.
- Auto-install or auto-update of the dcg binary. The user opts in.

## Release

Bump `version` in `package.json` → PR to `master` → tag `vX.Y.Z`. The tag
triggers `.github/workflows/release.yaml`: it verifies tag == package version,
verifies the version is not already on npm, publishes with `--provenance` via
OIDC trusted publishing, cuts a GitHub release, and deletes the tag if the
publish never happened. A published version is burned — npm rejects duplicates,
so a broken release rolls FORWARD to the next patch, never re-tags.
