import test from 'node:test'
import assert from 'node:assert/strict'
import { dcgArgs, evaluate, interpret, parseDecisionJSON } from '../src/dcg.ts'
import { decisionRun, fakeRunner, throwingRunner } from './helpers/fake-runner.ts'

test('asks dcg in robot mode, passing the command as one argv element', async () => {
  const runner = fakeRunner(decisionRun({ decision: 'allow' }))

  await evaluate('rm -rf ./build; echo $(whoami)', { binary: 'dcg', timeoutMs: 1234 }, runner)

  assert.deepEqual(runner.calls, [
    {
      binary: 'dcg',
      args: ['--robot', 'test', 'rm -rf ./build; echo $(whoami)'],
      timeoutMs: 1234,
    },
  ])
})

test('dcgArgs keeps the command whole, never split on shell metacharacters', () => {
  assert.deepEqual(dcgArgs('a && b | c'), ['--robot', 'test', 'a && b | c'])
})

test('allow and log let the command through; everything else blocks', () => {
  for (const decision of ['allow', 'log', 'ALLOW']) {
    const outcome = interpret({ stdout: JSON.stringify({ decision }), stderr: '', code: 0 })
    assert.equal(outcome.kind, 'verdict')
    assert.equal(outcome.kind === 'verdict' && outcome.blocked, false, decision)
  }
  // ask blocks because no operator can answer inside a plugin hook; warn
  // blocks because a warning the agent can ignore is not a guard.
  for (const decision of ['deny', 'ask', 'warn']) {
    const outcome = interpret({ stdout: JSON.stringify({ decision }), stderr: '', code: 1 })
    assert.equal(outcome.kind === 'verdict' && outcome.blocked, true, decision)
  }
})

// dcg exits non-zero on a deny and still prints its decision, so the exit code
// must never short-circuit parsing.
test('reads the verdict out of stdout even when dcg exits non-zero', () => {
  const outcome = interpret({
    stdout: JSON.stringify({
      decision: 'deny',
      reason: 'recursive delete of a root path',
      rule: 'fs.rm.root',
      suggestion: 'scope the path, e.g. rm -rf ./build',
    }),
    stderr: 'dcg: blocked',
    code: 1,
  })

  assert.deepEqual(outcome, {
    kind: 'verdict',
    decision: 'deny',
    blocked: true,
    reason: 'recursive delete of a root path',
    rule: 'fs.rm.root',
    suggestion: 'scope the path, e.g. rm -rf ./build',
  })
})

test('survives a banner printed ahead of the JSON', () => {
  const parsed = parseDecisionJSON('welcome to the shell\n{"decision":"deny"}\n')
  assert.deepEqual(parsed, { decision: 'deny' })
})

test('a missing binary is a failure, not a decision', () => {
  const outcome = interpret({ stdout: '', stderr: '', code: null, error: { code: 'ENOENT' } })

  assert.deepEqual(outcome, {
    kind: 'failure',
    reason: 'missing-binary',
    detail: 'dcg is not on PATH',
  })
})

test('a timeout is a failure', () => {
  const outcome = interpret({ stdout: '', stderr: '', code: null, timedOut: true })

  assert.equal(outcome.kind, 'failure')
  assert.equal(outcome.kind === 'failure' && outcome.reason, 'timeout')
})

test('unreadable output is a failure, never an allow', () => {
  for (const stdout of ['', 'not json at all', '{"nope":1}', '{"decision":""}', '[]']) {
    const outcome = interpret({ stdout, stderr: 'boom', code: 2 })
    assert.equal(outcome.kind, 'failure', stdout)
  }
})

test('a runner that throws is a failure, not an escaped exception', async () => {
  const outcome = await evaluate('ls', { binary: 'dcg', timeoutMs: 10 }, throwingRunner('EPERM'))

  assert.equal(outcome.kind, 'failure')
  assert.equal(outcome.kind === 'failure' && outcome.reason, 'spawn-error')
})
