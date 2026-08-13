import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BINARY, DEFAULT_TIMEOUT_MS, configFromEnv, resolveConfig } from '../src/config.ts'

test('defaults to enabled, fail-open, 5s, bash only, dcg on PATH', () => {
  const { config, warnings } = resolveConfig({}, {})

  assert.equal(config.enabled, true)
  assert.equal(config.failMode, 'open')
  assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.deepEqual([...config.tools], ['bash'])
  assert.equal(config.binary, DEFAULT_BINARY)
  assert.deepEqual(warnings, [])
})

test('reads every option from opencode.json', () => {
  const { config, warnings } = resolveConfig(
    {
      enabled: true,
      failMode: 'closed',
      timeoutMs: 3000,
      tools: ['bash', 'task'],
      binary: '/opt/bin/dcg',
    },
    {},
  )

  assert.equal(config.failMode, 'closed')
  assert.equal(config.timeoutMs, 3000)
  assert.deepEqual([...config.tools], ['bash', 'task'])
  assert.equal(config.binary, '/opt/bin/dcg')
  assert.deepEqual(warnings, [])
})

test('reads every documented environment variable', () => {
  const { config, warnings } = configFromEnv({
    DCG_PLUGIN_ENABLED: 'false',
    DCG_PLUGIN_FAIL_MODE: 'closed',
    DCG_PLUGIN_TIMEOUT_MS: '3000',
    DCG_PLUGIN_TOOLS: 'bash, task',
    DCG_PLUGIN_BINARY: '/opt/bin/dcg',
  })

  assert.equal(config.enabled, false)
  assert.equal(config.failMode, 'closed')
  assert.equal(config.timeoutMs, 3000)
  assert.deepEqual([...config.tools], ['bash', 'task'])
  assert.equal(config.binary, '/opt/bin/dcg')
  assert.deepEqual(warnings, [])
})

// The durable layer is opencode.json; the environment is the ad-hoc override,
// so a session can be re-pointed without editing config.
test('the environment overrides opencode.json', () => {
  const { config } = resolveConfig(
    { failMode: 'open', timeoutMs: 9000, binary: '/from/config' },
    { DCG_PLUGIN_FAIL_MODE: 'closed', DCG_PLUGIN_BINARY: '/from/env' },
  )

  assert.equal(config.failMode, 'closed')
  assert.equal(config.binary, '/from/env')
  assert.equal(config.timeoutMs, 9000, 'untouched by the environment')
})

// A broken override must not also discard a good base value.
test('an invalid override warns and leaves the configured value standing', () => {
  const { config, warnings } = resolveConfig(
    { failMode: 'closed' },
    { DCG_PLUGIN_FAIL_MODE: 'close' },
  )

  assert.equal(config.failMode, 'closed')
  assert.match(warnings[0] ?? '', /DCG_PLUGIN_FAIL_MODE/)
})

test('a warning names where the bad value came from', () => {
  const fromConfig = resolveConfig({ timeoutMs: -1 }, {})
  assert.match(fromConfig.warnings[0] ?? '', /opencode\.json timeoutMs/)

  const fromEnv = resolveConfig({}, { DCG_PLUGIN_TIMEOUT_MS: 'soon' })
  assert.match(fromEnv.warnings[0] ?? '', /DCG_PLUGIN_TIMEOUT_MS/)
})

test('tools accept a JSON array or a comma-separated string', () => {
  assert.deepEqual([...resolveConfig({ tools: ['bash', 'task'] }, {}).config.tools], ['bash', 'task'])
  assert.deepEqual([...resolveConfig({ tools: 'bash,task' }, {}).config.tools], ['bash', 'task'])
})

// opencode hands the hook a lowercase tool id and guard.ts looks it up with
// tool.toLowerCase(), so a configured "Bash" that kept its capital would match
// nothing and guard nothing — silently.
test('tool names are lowercased in both layers', () => {
  assert.deepEqual([...resolveConfig({ tools: ['Bash', 'TASK'] }, {}).config.tools], ['bash', 'task'])
  assert.deepEqual([...resolveConfig({}, { DCG_PLUGIN_TOOLS: 'Bash, TASK' }).config.tools], ['bash', 'task'])
})

test('accepts the usual spellings of a boolean, in both layers', () => {
  for (const value of ['0', 'false', 'no', 'off', 'FALSE', ' Off ']) {
    assert.equal(resolveConfig({}, { DCG_PLUGIN_ENABLED: value }).config.enabled, false, value)
  }
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
    assert.equal(resolveConfig({}, { DCG_PLUGIN_ENABLED: value }).config.enabled, true, value)
  }
  assert.equal(resolveConfig({ enabled: false }, {}).config.enabled, false)
})

test('warns instead of silently coercing an unusable value', () => {
  for (const options of [{ failMode: 'close' }, { enabled: 'maybe' }, { binary: '   ' }, { tools: [] }]) {
    const { warnings } = resolveConfig(options, {})
    assert.ok(warnings.length > 0, JSON.stringify(options))
  }
  for (const bad of ['0', '-1', 'soon', '1.5']) {
    const { config, warnings } = resolveConfig({}, { DCG_PLUGIN_TIMEOUT_MS: bad })
    assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS, bad)
    assert.ok(warnings.length > 0, bad)
  }
})

// An empty tool list would disable the guard while looking configured.
test('an empty tool list is rejected, not obeyed', () => {
  for (const value of [[], ' , , ', ['']]) {
    const { config, warnings } = resolveConfig({ tools: value }, {})
    assert.deepEqual([...config.tools], ['bash'], JSON.stringify(value))
    assert.ok(warnings.length > 0)
  }
})

test('a non-object options value is reported, not crashed on', () => {
  for (const options of ['nope', 42, ['bash']]) {
    const { config, warnings } = resolveConfig(options, {})
    assert.equal(config.enabled, true)
    assert.match(warnings[0] ?? '', /must be an object/)
  }
})

test('an empty string means unset, not invalid', () => {
  const { config, warnings } = resolveConfig({}, {
    DCG_PLUGIN_ENABLED: '',
    DCG_PLUGIN_BINARY: '',
    DCG_PLUGIN_TIMEOUT_MS: '',
  })

  assert.equal(config.enabled, true)
  assert.equal(config.binary, DEFAULT_BINARY)
  assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.deepEqual(warnings, [])
})
