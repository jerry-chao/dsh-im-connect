import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { ChannelManager } from '../manager.js'
import {
  PROACTIVE_SEND_TYPERT_NAMESPACE,
  type ProactiveSendArgs,
  type ProactiveSendErrorCode,
  type ProactiveSendResult,
} from './proactive-send.js'

/**
 * Typert 内部调用入口：namespace `im-connect` / method `send`。
 *
 * 与 HTTP 共用 `ChannelManager.sendProactive`（同一校验与发送路径），
 * 不走 cookie 鉴权；调用方身份由 Typert 连接层准入。
 * 供无头调用方（定时任务等）使用，浏览器仍可走 HTTP。
 */
export class ImConnectSendService extends TypertRemoteService {
  private readonly manager: ChannelManager

  constructor(ctx: Context, manager: ChannelManager) {
    super(ctx, 'imConnect', { namespace: PROACTIVE_SEND_TYPERT_NAMESPACE })
    this.manager = manager
  }

  @Remote
  async send(args: ProactiveSendArgs): Promise<ProactiveSendResult> {
    const { accountId, ...body } = args
    const result = await this.manager.sendProactive(accountId, body)
    if (result.body['ok'] === true) {
      const chatId = result.body['chatId']
      const chunks = result.body['chunks']
      return {
        ok: true,
        accountId,
        chatId: typeof chatId === 'string' ? chatId : undefined,
        chunks: typeof chunks === 'number' ? chunks : undefined,
      }
    }
    const code = result.body['code']
    const error = result.body['error']
    return {
      ok: false,
      code: typeof code === 'string' ? (code as ProactiveSendErrorCode) : undefined,
      error: typeof error === 'string' ? error : '发送失败',
    }
  }
}
