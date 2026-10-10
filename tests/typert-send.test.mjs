import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { isTypertRemoteSegment, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { ImConnectSendService } from '../lib/engine/typert-send.js'
import {
  PROACTIVE_SEND_TYPERT_METHOD,
  PROACTIVE_SEND_TYPERT_NAMESPACE,
} from '../lib/engine/proactive-send.js'

function stubManager(handler) {
  return { sendProactive: handler }
}

test('Typert 注册形态：namespace im-connect / method send', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const svc = new ImConnectSendService(ctx, stubManager(async () => ({ status: 200, body: { ok: true } })))
  assert.equal(svc.typertRemote.namespace, 'im-connect')
  assert.equal(svc.typertRemote.namespace, PROACTIVE_SEND_TYPERT_NAMESPACE)
  assert.equal(PROACTIVE_SEND_TYPERT_METHOD, 'send')
  assert.ok(isTypertRemoteSegment('im-connect'))
  assert.ok(isTypertRemoteSegment('send'))
  const markers = remoteMethods(svc)
  assert.equal(markers.length, 1)
  assert.equal(markers[0].method, 'send')
  assert.equal(markers[0].invocation.kind, 'direct')
})

test('Typert send 成功映射 accountId/chatId/chunks', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const seen = []
  const svc = new ImConnectSendService(ctx, stubManager(async (accountId, body) => {
    seen.push([accountId, body])
    return { status: 200, body: { ok: true, accountId, chatId: body.chatId, chunks: 2 } }
  }))
  const result = await svc.send({ accountId: 'wecom_1', chatId: 'user-1', text: 'hi' })
  assert.deepEqual(seen, [['wecom_1', { chatId: 'user-1', text: 'hi' }]])
  assert.deepEqual(result, { ok: true, accountId: 'wecom_1', chatId: 'user-1', chunks: 2 })
})

test('Typert send 失败透出 code 与 error', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const svc = new ImConnectSendService(ctx, stubManager(async () => (
    { status: 403, body: { ok: false, code: 'not_allowlisted', error: 'chatId 不在该账号白名单内' } }
  )))
  const result = await svc.send({ accountId: 'wecom_1', chatId: 'stranger', text: 'hi' })
  assert.deepEqual(result, { ok: false, code: 'not_allowlisted', error: 'chatId 不在该账号白名单内' })
})

test('Typert send 透传校验失败（缺 text）', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const svc = new ImConnectSendService(ctx, stubManager(async () => (
    { status: 400, body: { ok: false, code: 'missing_text', error: '缺少 text' } }
  )))
  const result = await svc.send({ accountId: 'wecom_1', chatId: 'user-1', text: '   ' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'missing_text')
})
