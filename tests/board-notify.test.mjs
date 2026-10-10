import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BOARD_NOTIFY_API_VERSION,
  BOARD_NOTIFY_EXTENSION_ID,
  parseNotifyMarker,
  registerBoardNotify,
} from '../lib/engine/board-notify.js'

function makeHost({ prompt, settledOutcome = 'succeeded' } = {}) {
  const audits = []
  const callbacks = []
  const host = {
    tasks: { get: (taskId) => (taskId === 't1' ? { prompt } : undefined) },
    integration: { write: (taskId, payload) => { audits.push([taskId, payload]) } },
    events: { onExecutionSettled: (cb) => { callbacks.push(cb); return () => {} } },
  }
  return { host, audits, callbacks, settledOutcome }
}

function makeManager(handler) {
  const calls = []
  return {
    calls,
    sendProactive: async (accountId, body) => { calls.push([accountId, body]); return handler(accountId, body) },
  }
}

async function waitFor(cond, timeoutMs = 3000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('等待回调超时')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

test('标记解析：合法/缺失/非法/缺字段', () => {
  const good = '正文\n<!-- im-notify: {"accountId":"wecom_1","chatId":"u1","file":"/tmp/x.md"} -->\n尾'
  assert.deepEqual(parseNotifyMarker(good), { accountId: 'wecom_1', chatId: 'u1', file: '/tmp/x.md' })
  assert.equal(parseNotifyMarker('没有标记'), undefined)
  assert.equal(parseNotifyMarker('<!-- im-notify: {oops} -->'), undefined)
  assert.equal(parseNotifyMarker('<!-- im-notify: {"accountId":"a"} -->'), undefined)
  assert.equal(parseNotifyMarker('<!-- im-notify: [] -->'), undefined)
})

test('无 board 服务时跳过注册', () => {
  const logs = []
  assert.equal(registerBoardNotify({}, {}, (line) => logs.push(line)), undefined)
  assert.ok(logs.some((line) => line.includes('跳过')))
  assert.equal(registerBoardNotify({ taskBoard: {} }, {}, () => {}), undefined)
})

test('扩展 id 与契约版本锁定', () => {
  assert.equal(BOARD_NOTIFY_EXTENSION_ID, 'im-connect-notify')
  assert.equal(BOARD_NOTIFY_API_VERSION, 1)
})

test('settle 成功：读文件发送并留痕', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'board-notify-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'report.md')
  writeFileSync(file, '# 早报\n- HIM-1 xxx')
  const prompt = `查\n<!-- im-notify: {"accountId":"wecom_1","chatId":"u1","file":"${file}"} -->`
  const { host, audits, callbacks } = makeHost({ prompt })
  const manager = makeManager(async (accountId, body) => (
    { status: 200, body: { ok: true, accountId, chatId: body.chatId, chunks: 1 } }
  ))
  const logs = []
  let released = false
  const fakeBoard = { registerExtension: (ext) => { ext.start(host); return () => { released = true } } }
  const dispose = registerBoardNotify({ taskBoard: fakeBoard }, manager, (line) => logs.push(line))
  assert.equal(typeof dispose, 'function')
  callbacks[0]({ taskId: 't1', outcome: 'succeeded' })
  await waitFor(() => audits.length > 0)
  assert.deepEqual(manager.calls, [['wecom_1', { chatId: 'u1', text: '# 早报\n- HIM-1 xxx' }]])
  assert.equal(audits[0][0], 't1')
  assert.equal(audits[0][1].ok, true)
  assert.equal(audits[0][1].chatId, 'u1')
  dispose()
  assert.equal(released, true)
})

test('无标记 / 任务不存在时不发送', async () => {
  const { host, callbacks } = makeHost({ prompt: '普通任务' })
  const manager = makeManager(async () => { throw new Error('不应被调用') })
  const fakeBoard = { registerExtension: (ext) => { ext.start(host); return () => {} } }
  registerBoardNotify({ taskBoard: fakeBoard }, manager, () => {})
  callbacks[0]({ taskId: 't1', outcome: 'succeeded' })
  callbacks[0]({ taskId: 'missing', outcome: 'succeeded' })
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(manager.calls.length, 0)
})

test('失败轮次跳过并留痕', async () => {
  const { host, audits, callbacks } = makeHost({ prompt: '<!-- im-notify: {"accountId":"w","chatId":"u","file":"/tmp/never.md"} -->' })
  const manager = makeManager(async () => { throw new Error('不应被调用') })
  const fakeBoard = { registerExtension: (ext) => { ext.start(host); return () => {} } }
  registerBoardNotify({ taskBoard: fakeBoard }, manager, () => {})
  callbacks[0]({ taskId: 't1', outcome: 'failed' })
  await waitFor(() => audits.length > 0)
  assert.equal(manager.calls.length, 0)
  assert.equal(audits[0][1].ok, false)
})

test('文件缺失与发送失败都留痕且不抛', async () => {
  const { host, audits, callbacks } = makeHost({ prompt: '<!-- im-notify: {"accountId":"w","chatId":"u","file":"/tmp/board-notify-nope.md"} -->' })
  const manager = makeManager(async () => ({ status: 502, body: { ok: false, error: 'boom' } }))
  const fakeBoard = { registerExtension: (ext) => { ext.start(host); return () => {} } }
  registerBoardNotify({ taskBoard: fakeBoard }, manager, () => {})
  callbacks[0]({ taskId: 't1', outcome: 'succeeded' })
  await waitFor(() => audits.length > 0)
  assert.match(audits[0][1].error, /读不到投递文件/)
  const { host: host2, audits: audits2, callbacks: callbacks2 } = makeHost({ prompt: '<!-- im-notify: {"accountId":"w","chatId":"u","file":"/tmp/board-notify-nope.md"} -->' })
  writeFileSync('/tmp/board-notify-sendfail.md', 'hi')
  host2.tasks.get = () => ({ prompt: `<!-- im-notify: {"accountId":"w","chatId":"u","file":"/tmp/board-notify-sendfail.md"} -->` })
  const fakeBoard2 = { registerExtension: (ext) => { ext.start(host2); return () => {} } }
  registerBoardNotify({ taskBoard: fakeBoard2 }, manager, () => {})
  callbacks2[0]({ taskId: 't1', outcome: 'succeeded' })
  await waitFor(() => audits2.length > 0)
  assert.equal(audits2[0][1].error, 'boom')
  rmSync('/tmp/board-notify-sendfail.md', { force: true })
})

test('board 拒绝注册时降级', () => {
  const logs = []
  const fakeBoard = { registerExtension: () => { throw new Error('版本不匹配') } }
  assert.equal(registerBoardNotify({ taskBoard: fakeBoard }, {}, (line) => logs.push(line)), undefined)
  assert.ok(logs.some((line) => line.includes('拒绝')))
})
