import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import type { ChannelManager } from '../manager.js';
import { type ProactiveSendArgs, type ProactiveSendResult } from './proactive-send.js';
/**
 * Typert 内部调用入口：namespace `im-connect` / method `send`。
 *
 * 与 HTTP 共用 `ChannelManager.sendProactive`（同一校验与发送路径），
 * 不走 cookie 鉴权；调用方身份由 Typert 连接层准入。
 * 供无头调用方（定时任务等）使用，浏览器仍可走 HTTP。
 */
export declare class ImConnectSendService extends TypertRemoteService {
    private readonly manager;
    constructor(ctx: Context, manager: ChannelManager);
    send(args: ProactiveSendArgs): Promise<ProactiveSendResult>;
}
//# sourceMappingURL=typert-send.d.ts.map