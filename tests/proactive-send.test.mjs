import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChannelManager } from '../lib/manager.js'
import {
  PROACTIVE_SEND_TYPERT_NAMESPACE,
  PROACTIVE_SEND_TYPERT_METHOD,
  deliverProactiveSend,
  validateProactiveSendInput,
} from '../lib/engine/proactive-send.js'

function makeManager(t) {
  const stateDir = mkdtempSync(join(tmpdir(), 'im-connect-proactive-send-'))
  const manager = new ChannelManager({
    ctx: {
      permissionPresets: { names: ['review'], defaultPreset: 'review', optionOf: (name) => ({ value: name, name }) },
      get: () => undefined,
    },
    stateDir,
    log: () => undefined,
    engineConfig: {
      cwd: stateDir, provider: 'p', model: 'm', agentPreset: 'standard', mergeTimeoutSecs: 5, permissionPreset: 'review',
    },
  })
  t.after(() => {
    manager.disposeApi()
    rmSync(stateDir, { recursive: true, force: true })
  })
  return manager
}

function seedAccount(manager, { connected = true, allowlist = ['chat-1'] } = {}) {
  const sent = []
  const adapter = {
    id: 'telegram', label: 'Telegram', maxMessageLength: 4,
    start: () => undefined, stop: () => undefined,
    status: () => 'connected',
    setMessageHandler: () => undefined,
    send: async (chatId, text) => { sent.push({ chatId, text }) },
  }
  manager.store.channels['telegram:test'] = { platform: 'telegram', enabled: true }
  manager.store.allowlist['telegram:test'] = [...allowlist]
  if (connected) manager.running.set('telegram:test', adapter)
  else manager.running.delete('telegram:test')
  return sent
}

test('主动发送成功：白名单内按 adapter 上限分片', async (t) => {
  const manager = makeManager(t)
  const sent = seedAccount(manager)
  const result = await manager.sendProactive('telegram:test', { chatId: 'chat-1', text: '123456' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true, accountId: 'telegram:test', chatId: 'chat-1', chunks: 2 })
  assert.deepEqual(sent, [{ chatId: 'chat-1', text: '1234' }, { chatId: 'chat-1', text: '56' }])
})

test('主动发送拒绝：白名单外 403、未连接 503', async (t) => {
  const manager = makeManager(t)
  seedAccount(manager)
  const forbidden = await manager.sendProactive('telegram:test', { chatId: 'stranger', text: 'hi' })
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.body.ok, false)

  seedAccount(manager, { connected: false })
  const offline = await manager.sendProactive('telegram:test', { chatId: 'chat-1', text: 'hi' })
  assert.equal(offline.status, 503)
  assert.match(offline.body.error, /尚未连接/)
})

test('主动发送校验：缺参/超长/未支持类型 400，账号不存在 404', async (t) => {
  const manager = makeManager(t)
  seedAccount(manager)
  assert.equal((await manager.sendProactive('missing', { chatId: 'x', text: 'y' })).status, 404)
  assert.equal((await manager.sendProactive('telegram:test', { text: 'y' })).status, 400)
  assert.equal((await manager.sendProactive('telegram:test', { chatId: 'chat-1', text: '  ' })).status, 400)
  assert.equal((await manager.sendProactive('telegram:test', { chatId: 'chat-1', text: 'a'.repeat(4001) })).status, 400)
  assert.equal((await manager.sendProactive('telegram:test', { chatId: 'chat-1', text: 'hi', receiveIdType: 'open_id' })).status, 400)
  assert.equal((await manager.sendProactive('telegram:test', { chatId: 'chat-1', text: 'hi', msgType: 'post' })).status, 400)
  manager.store.channels['telegram:test'].enabled = false
  assert.equal((await manager.sendProactive('telegram:test', { chatId: 'chat-1', text: 'hi' })).status, 400)
})

test('共用核心可被 Typert 复用：常量与函数形态稳定', () => {
  assert.equal(PROACTIVE_SEND_TYPERT_NAMESPACE, 'im-connect')
  assert.equal(PROACTIVE_SEND_TYPERT_METHOD, 'send')
  assert.deepEqual(validateProactiveSendInput({ chatId: ' c ', text: 'hi' }).value, {
    chatId: 'c', text: 'hi', receiveIdType: 'chat_id', msgType: 'text',
  })
})

test('deliverProactiveSend 发送失败回 send_failed', async () => {
  const result = await deliverProactiveSend(
    { accountId: 'a', allowlist: ['c'], maxMessageLength: 10, adapter: { send: async () => { throw new Error('boom') } } },
    { chatId: 'c', text: 'hi' },
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'send_failed')
  assert.equal(result.error, 'boom')
})
