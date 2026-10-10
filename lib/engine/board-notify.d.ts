import type { ChannelManager } from '../manager.js';
/**
 * task-board 扩展：任务执行落定后，把 prompt 标记里的短通知
 * 经 dsh-im-connect 已有账号连接发出（复用 ChannelManager.sendProactive）。
 *
 * 只消费 board 扩展契约，不修改 board：
 * - 服务名 `taskBoard`，契约版本锁 1（board 0.4.5 实测）；
 * - board 缺席/禁用/拒绝时降级为日志，一切照常；
 * - 收件人仍受账号 allowlist 约束（sendProactive 内校验）。
 *
 * 任务 prompt 标记（静态文本，由任务作者写入，仅短通知）：
 *   <!-- im-notify: {"accountId":"wecom_xxx","chatId":"yyy","text":"构建挂了，速看"} -->
 * settle 回调取标记原文发送，结果写回 integration 留痕。
 */
export declare const BOARD_NOTIFY_EXTENSION_ID = "im-connect-notify";
export declare const BOARD_NOTIFY_API_VERSION = 1;
export declare const BOARD_NOTIFY_SERVICE_NAME = "taskBoard";
export interface BoardNotifyConfig {
    accountId: string;
    chatId: string;
    text: string;
}
export declare function parseNotifyMarker(prompt: string): BoardNotifyConfig | undefined;
/** board 侧最小能力面（按 board 0.4.5 / apiVersion 1 锁定，只读所需子集）。 */
export interface BoardNotifyTask {
    prompt?: unknown;
}
export interface BoardNotifyTasksFace {
    get(taskId: string): BoardNotifyTask | undefined;
}
export interface BoardNotifySettledEvent {
    taskId: string;
    outcome: string;
}
export interface BoardNotifyEventsFace {
    onExecutionSettled(callback: (event: BoardNotifySettledEvent) => void): () => void;
}
export interface BoardNotifyIntegrationFace {
    write(taskId: string, payload: Record<string, unknown>): void;
}
export interface BoardNotifyHost {
    tasks: BoardNotifyTasksFace;
    integration: BoardNotifyIntegrationFace;
    events: BoardNotifyEventsFace;
}
export interface BoardNotifyService {
    registerExtension(extension: {
        id: string;
        apiVersion: number;
        start?(host: BoardNotifyHost): void;
        stop?(): void;
    }): () => void;
}
export type BoardNotifyLogger = (line: string) => void;
/**
 * 向 board 注册本扩展；board 缺席/拒绝时返回 undefined（仅日志，不影响插件其它功能）。
 */
export declare function registerBoardNotify(ctx: unknown, manager: ChannelManager, log: BoardNotifyLogger): (() => void) | undefined;
//# sourceMappingURL=board-notify.d.ts.map