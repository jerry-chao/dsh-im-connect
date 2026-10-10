import type { ChannelAdapter } from './types.js';
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
export declare const PROACTIVE_SEND_TYPERT_NAMESPACE = "im-connect";
export declare const PROACTIVE_SEND_TYPERT_METHOD = "send";
/** 单次正文上限：防误传大文本撑爆 IM 配额；分片仍按各 adapter 的 maxMessageLength 切。 */
export declare const PROACTIVE_SEND_MAX_TEXT_LENGTH = 4000;
export interface ProactiveSendRequest {
    chatId: string;
    text: string;
    /** 仅支持 chat_id；open_id/email 预留，后续按平台扩展。 */
    receiveIdType?: string;
    /** 仅支持 text；post/image 预留。 */
    msgType?: string;
}
export type ProactiveSendErrorCode = 'missing_chat' | 'missing_text' | 'too_long' | 'unsupported_receive_type' | 'unsupported_msg_type' | 'unknown_account' | 'account_disabled' | 'not_allowlisted' | 'not_connected' | 'send_failed';
export interface ProactiveSendTarget {
    accountId: string;
    allowlist: string[];
    adapter: ChannelAdapter | undefined;
    maxMessageLength: number;
}
export interface ProactiveSendResult {
    ok: boolean;
    accountId?: string;
    chatId?: string;
    /** 实际切分发送的片数；adapter.send 返回 void，无 messageId，字段预留。 */
    chunks?: number;
    messageId?: string;
    code?: ProactiveSendErrorCode;
    error?: string;
}
export declare function validateProactiveSendInput(body: Record<string, unknown>): {
    value?: ProactiveSendRequest;
    code?: ProactiveSendErrorCode;
    error?: string;
};
export declare function deliverProactiveSend(target: ProactiveSendTarget, input: ProactiveSendRequest): Promise<ProactiveSendResult>;
/** Typert 预留：未来注册时的参数形态（accountId + 请求体拍平）。 */
export interface ProactiveSendArgs extends ProactiveSendRequest {
    accountId: string;
}
export declare function proactiveSendErrorStatus(code: ProactiveSendErrorCode | undefined): number;
//# sourceMappingURL=proactive-send.d.ts.map