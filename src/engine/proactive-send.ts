import { splitText } from './split.js'
import type { ChannelAdapter } from './types.js'

/**
 * 主动发送共用核心（HTTP + Typert 共用）。
 *
 * - HTTP：`POST /api/dsh-im-connect/accounts/{accountId}/send` 薄薄一层鉴权 + 路由后调 `deliverProactiveSend`。
 * - Typert（预留）：宿主 contract 就绪后以 namespace `im-connect` / method `send`、
 *   参数 `ProactiveSendArgs` 注册，同样调 `deliverProactiveSend` 即可；
 *   不要在 HTTP handler 里写第二套发送逻辑。
 *
 * 目前仅 dsh 内部调用，后续可经其他传输复用同一核心。
 */
export const PROACTIVE_SEND_TYPERT_NAMESPACE = 'im-connect'
export const PROACTIVE_SEND_TYPERT_METHOD = 'send'

/** 单次正文上限：防误传大文本撑爆 IM 配额；分片仍按各 adapter 的 maxMessageLength 切。 */
export const PROACTIVE_SEND_MAX_TEXT_LENGTH = 4000

export interface ProactiveSendRequest {
  chatId: string
  text: string
  /** 仅支持 chat_id；open_id/email 预留，后续按平台扩展。 */
  receiveIdType?: string
  /** 仅支持 text；post/image 预留。 */
  msgType?: string
}

export type ProactiveSendErrorCode =
  | 'missing_chat'
  | 'missing_text'
  | 'too_long'
  | 'unsupported_receive_type'
  | 'unsupported_msg_type'
  | 'not_allowlisted'
  | 'not_connected'
  | 'send_failed'

export interface ProactiveSendTarget {
  accountId: string
  allowlist: string[]
  adapter: ChannelAdapter | undefined
  maxMessageLength: number
}

export interface ProactiveSendResult {
  ok: boolean
  accountId?: string
  chatId?: string
  /** 实际切分发送的片数；adapter.send 返回 void，无 messageId，字段预留。 */
  chunks?: number
  messageId?: string
  code?: ProactiveSendErrorCode
  error?: string
}

export function validateProactiveSendInput(body: Record<string, unknown>): { value?: ProactiveSendRequest; code?: ProactiveSendErrorCode; error?: string } {
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''
  const text = typeof body.text === 'string' ? body.text : ''
  const receiveIdType = body.receiveIdType === undefined ? 'chat_id' : String(body.receiveIdType)
  const msgType = body.msgType === undefined ? 'text' : String(body.msgType)
  if (!chatId) return { code: 'missing_chat', error: '缺少 chatId' }
  if (!text.trim()) return { code: 'missing_text', error: '缺少 text' }
  if (text.length > PROACTIVE_SEND_MAX_TEXT_LENGTH) {
    return { code: 'too_long', error: `正文超过 ${PROACTIVE_SEND_MAX_TEXT_LENGTH} 字上限` }
  }
  if (receiveIdType !== 'chat_id') return { code: 'unsupported_receive_type', error: `暂不支持 receiveIdType=${receiveIdType}，仅支持 chat_id` }
  if (msgType !== 'text') return { code: 'unsupported_msg_type', error: `暂不支持 msgType=${msgType}，仅支持 text` }
  return { value: { chatId, text, receiveIdType, msgType } }
}

export async function deliverProactiveSend(target: ProactiveSendTarget, input: ProactiveSendRequest): Promise<ProactiveSendResult> {
  if (!target.allowlist.includes(input.chatId)) {
    return { ok: false, code: 'not_allowlisted', error: 'chatId 不在该账号白名单内' }
  }
  if (!target.adapter) {
    return { ok: false, code: 'not_connected', error: '账号尚未连接' }
  }
  const max = Math.max(1, target.maxMessageLength || 2000)
  let chunks = 0
  try {
    for (const chunk of splitText(input.text, max)) {
      await target.adapter.send(input.chatId, chunk)
      chunks += 1
    }
  } catch (error) {
    return { ok: false, code: 'send_failed', error: error instanceof Error ? error.message : String(error ?? '发送失败') }
  }
  return { ok: true, accountId: target.accountId, chatId: input.chatId, chunks }
}

/** Typert 预留：未来注册时的参数形态（accountId + 请求体拍平）。 */
export interface ProactiveSendArgs extends ProactiveSendRequest {
  accountId: string
}

export function proactiveSendErrorStatus(code: ProactiveSendErrorCode | undefined): number {
  switch (code) {
    case 'not_allowlisted': return 403
    case 'not_connected': return 503
    case 'send_failed': return 502
    default: return 400
  }
}
