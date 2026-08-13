import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BINARY, DEFAULT_TIMEOUT_MS, configFromEnv } from '../src/config.ts'

test('defaults to enabled, fail-open, 5s, bash only, dcg on PATH', () => {
  const { config, warnings } = configFromEnv({})

  assert.equal(config.enabled, true)
  assert.equal(config.failMode, 'open')
  assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.deepEqual([...config.tools], ['bash'])
  assert.equal(config.binary, DEFAULT_BINARY)
  assert.deepEqual(warnings, [])
})

test('reads every documented variable', () => {
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

test('accepts the usual spellings of a boolean', () => {
  for (const value of ['0', 'false', 'no', 'off', 'FALSE', ' Off ']) {
    assert.equal(configFromEnv({ DCG_PLUGIN_ENABLED: value }).config.enabled, false, value)
  }
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
    assert.equal(configFromEnv({ DCG_PLUGIN_ENABLED: value }).config.enabled, true, value)
  }
})

// A typo that silently resolves to fail-open is the failure this guard exists
// to prevent, so every unusable value has to say so out loud.
test('warns instead of silently coercing an unusable value', () => {
  const failMode = configFromEnv({ DCG_PLUGIN_FAIL_MODE: 'close' })
  assert.equal(failMode.config.failMode, 'open')
  assert.match(failMode.warnings[0] ?? '', /DCG_PLUGIN_FAIL_MODE/)

  const enabled = configFromEnv({ DCG_PLUGIN_ENABLED: 'maybe' })
  assert.equal(enabled.config.enabled, true)
  assert.match(enabled.warnings[0] ?? '', /DCG_PLUGIN_ENABLED/)

  for (const bad of ['0', '-1', 'soon', '1.5']) {
    const timeout = configFromEnv({ DCG_PLUGIN_TIMEOUT_MS: bad })
    assert.equal(timeout.config.timeoutMs, DEFAULT_TIMEOUT_MS, bad)
    assert.match(timeout.warnings[0] ?? '', /DCG_PLUGIN_TIMEOUT_MS/)
  }
})

test('an all-blank tool list falls back to bash rather than checking nothing', () => {
  const { config, warnings } = configFromEnv({ DCG_PLUGIN_TOOLS: ' , , ' })

  assert.deepEqual([...config.tools], ['bash'])
  assert.match(warnings[0] ?? '', /DCG_PLUGIN_TOOLS/)
})

test('an empty string means unset, not invalid', () => {
  const { config, warnings } = configFromEnv({
    DCG_PLUGIN_ENABLED: '',
    DCG_PLUGIN_BINARY: '',
    DCG_PLUGIN_TIMEOUT_MS: '',
  })

  assert.equal(config.enabled, true)
  assert.equal(config.binary, DEFAULT_BINARY)
  assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.deepEqual(warnings, [])
})
