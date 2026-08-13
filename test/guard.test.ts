import test from 'node:test'
import assert from 'node:assert/strict'
import { DcgBlockedError, commandFromArgs, createGuard } from '../src/guard.ts'
import { configFromEnv } from '../src/config.ts'
import { decisionRun, fakeRunner } from './helpers/fake-runner.ts'
import { collectReports } from './helpers/collect.ts'

const config = (env: NodeJS.ProcessEnv = {}) => configFromEnv(env).config

test('an allowed command runs and nothing is thrown', async () => {
  const runner = fakeRunner(decisionRun({ decision: 'allow' }))
  const check = createGuard({ config: config(), runner })

  await check('bash', { command: 'ls -la' })

  assert.equal(runner.calls.length, 1)
})

test('a denied command aborts with dcg reason, rule and suggestion', async () => {
  const runner = fakeRunner(
    decisionRun({
      decision: 'deny',
      reason: 'recursive delete of a root path',
      rule: 'fs.rm.root',
      suggestion: 'scope the path',
    }, 1),
  )
  const check = createGuard({ config: config(), runner })

  await assert.rejects(
    () => check('bash', { command: 'rm -rf /' }),
    (error: unknown) => {
      assert.ok(error instanceof DcgBlockedError)
      assert.equal(error.decision, 'deny')
      assert.match(error.message, /rm -rf \//)
      assert.match(error.message, /recursive delete of a root path/)
      assert.match(error.message, /fs\.rm\.root/)
      assert.match(error.message, /scope the path/)
      return true
    },
  )
})

test('tools outside the configured set are never checked', async () => {
  const runner = fakeRunner(decisionRun({ decision: 'deny' }, 1))
  const check = createGuard({ config: config(), runner })

  await check('read', { command: 'rm -rf /' })

  assert.deepEqual(runner.calls, [])
})

test('DCG_PLUGIN_TOOLS widens what gets checked', async () => {
  const runner = fakeRunner(decisionRun({ decision: 'deny' }, 1))
  const check = createGuard({ config: config({ DCG_PLUGIN_TOOLS: 'bash,task' }), runner })

  await assert.rejects(() => check('task', { command: 'rm -rf /' }), DcgBlockedError)
})

test('disabled means the binary is never consulted', async () => {
  const runner = fakeRunner(decisionRun({ decision: 'deny' }, 1))
  const check = createGuard({ config: config({ DCG_PLUGIN_ENABLED: 'false' }), runner })

  await check('bash', { command: 'rm -rf /' })

  assert.deepEqual(runner.calls, [])
})

// A tool with no string command has nothing to check; blocking it would break
// unrelated tools that happen to be listed in DCG_PLUGIN_TOOLS.
test('a call with no shell command passes through untouched', async () => {
  const runner = fakeRunner(decisionRun({ decision: 'deny' }, 1))
  const check = createGuard({ config: config(), runner })

  for (const args of [undefined, null, {}, { command: '' }, { command: 42 }, 'string']) {
    await check('bash', args)
  }

  assert.deepEqual(runner.calls, [])
  assert.equal(commandFromArgs({ command: 'ls' }), 'ls')
})

test('fail-open lets commands run when dcg cannot be consulted', async () => {
  for (const run of [
    { error: { code: 'ENOENT' }, code: null },
    { timedOut: true, code: null },
    { stdout: 'garbage', code: 2 },
  ]) {
    const check = createGuard({ config: config(), runner: fakeRunner(run) })
    await check('bash', { command: 'rm -rf /' })
  }
})

test('fail-closed blocks when dcg cannot be consulted', async () => {
  for (const run of [
    { error: { code: 'ENOENT' }, code: null },
    { timedOut: true, code: null },
    { stdout: 'garbage', code: 2 },
  ]) {
    const check = createGuard({
      config: config({ DCG_PLUGIN_FAIL_MODE: 'closed' }),
      runner: fakeRunner(run),
    })
    await assert.rejects(() => check('bash', { command: 'ls' }), DcgBlockedError)
  }
})

// The user must never believe they are guarded while they are not.
test('a missing binary warns once, not once per command', async () => {
  const { report, messages } = collectReports()
  const check = createGuard({
    config: config(),
    runner: fakeRunner({ error: { code: 'ENOENT' }, code: null }),
    report,
  })

  await check('bash', { command: 'ls' })
  await check('bash', { command: 'pwd' })

  const warnings = messages.filter((m) => m.includes('is not on PATH'))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /NOT being checked/)
})

test('the missing-binary warning states which way it resolves under fail-closed', async () => {
  const { report, messages } = collectReports()
  const check = createGuard({
    config: config({ DCG_PLUGIN_FAIL_MODE: 'closed' }),
    runner: fakeRunner({ error: { code: 'ENOENT' }, code: null }),
    report,
  })

  await assert.rejects(() => check('bash', { command: 'ls' }), DcgBlockedError)

  assert.match(messages.find((m) => m.includes('is not on PATH')) ?? '', /being blocked/)
})

test('the configured binary path is the one spawned', async () => {
  const runner = fakeRunner(decisionRun({ decision: 'allow' }))
  const check = createGuard({
    config: config({ DCG_PLUGIN_BINARY: '/opt/bin/dcg', DCG_PLUGIN_TIMEOUT_MS: '250' }),
    runner,
  })

  await check('bash', { command: 'ls' })

  assert.equal(runner.calls[0]?.binary, '/opt/bin/dcg')
  assert.equal(runner.calls[0]?.timeoutMs, 250)
})
