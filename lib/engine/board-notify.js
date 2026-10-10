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
export const BOARD_NOTIFY_EXTENSION_ID = 'im-connect-notify';
export const BOARD_NOTIFY_API_VERSION = 1;
export const BOARD_NOTIFY_SERVICE_NAME = 'taskBoard';
const MARKER_PATTERN = /<!--\s*im-notify:\s*(\{.*?\})\s*-->/s;
export function parseNotifyMarker(prompt) {
    const match = MARKER_PATTERN.exec(prompt);
    if (!match)
        return undefined;
    const raw = match[1];
    if (raw === undefined)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return undefined;
    const record = parsed;
    const accountId = record['accountId'];
    const chatId = record['chatId'];
    const text = record['text'];
    if (typeof accountId !== 'string' || !accountId.trim())
        return undefined;
    if (typeof chatId !== 'string' || !chatId.trim())
        return undefined;
    if (typeof text !== 'string' || !text.trim())
        return undefined;
    return { accountId: accountId.trim(), chatId: chatId.trim(), text };
}
async function audit(host, log, taskId, payload) {
    try {
        host.integration.write(taskId, {
            provider: BOARD_NOTIFY_EXTENSION_ID,
            sentAt: new Date().toISOString(),
            ...payload,
        });
    }
    catch (error) {
        log(`[board-notify] 写回留痕失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function handleSettled(host, manager, log, event) {
    let prompt;
    try {
        prompt = host.tasks.get(event.taskId)?.prompt;
    }
    catch {
        return;
    }
    if (typeof prompt !== 'string')
        return;
    const config = parseNotifyMarker(prompt);
    if (!config)
        return;
    if (event.outcome !== 'succeeded') {
        await audit(host, log, event.taskId, { ok: false, error: `本轮执行结果为 ${event.outcome}，未投递` });
        return;
    }
    let text = config.text;
    // 超长等校验交给 sendProactive，失败同样写回留痕。
    let result;
    try {
        result = await manager.sendProactive(config.accountId, { chatId: config.chatId, text });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await audit(host, log, event.taskId, { ok: false, error: detail });
        log(`[board-notify] ${event.taskId} 发送异常: ${detail}`);
        return;
    }
    if (result.body['ok'] === true) {
        const chunks = result.body['chunks'];
        await audit(host, log, event.taskId, {
            ok: true,
            accountId: config.accountId,
            chatId: config.chatId,
            chunks: typeof chunks === 'number' ? chunks : undefined,
        });
        log(`[board-notify] ${event.taskId} -> ${config.chatId} 已投递`);
    }
    else {
        const error = result.body['error'];
        await audit(host, log, event.taskId, {
            ok: false,
            error: typeof error === 'string' ? error : '发送失败',
        });
        log(`[board-notify] ${event.taskId} 发送失败: ${typeof error === 'string' ? error : '发送失败'}`);
    }
}
/**
 * 向 board 注册本扩展；board 缺席/拒绝时返回 undefined（仅日志，不影响插件其它功能）。
 */
export function registerBoardNotify(ctx, manager, log) {
    // 注意：禁止无保护地直读 ctx.taskBoard。Cordis 里未声明进 inject 的服务，
    // 连读属性都会抛 `cannot get property "taskBoard" without inject`，
    // 导致插件激活失败（2026-10-10 本地安装启动失败即因此）。
    // 优先用 ctx.get() 做可选查找（缺席返回 undefined）；测试替身等没有 get
    // 的普通对象才回退到属性直读，且同样包住异常走降级。
    let face;
    try {
        const get = ctx.get;
        if (typeof get === 'function') {
            face = get.call(ctx, BOARD_NOTIFY_SERVICE_NAME);
        }
        else {
            face = ctx.taskBoard;
        }
    }
    catch {
        face = undefined;
    }
    if (!face || typeof face.registerExtension !== 'function') {
        log('[board-notify] 未发现 taskBoard 服务，跳过扩展注册');
        return undefined;
    }
    let disposeSettled;
    const extension = {
        id: BOARD_NOTIFY_EXTENSION_ID,
        apiVersion: BOARD_NOTIFY_API_VERSION,
        start(host) {
            try {
                disposeSettled?.();
            }
            catch {
                // 忽略旧订阅释放异常。
            }
            disposeSettled = host.events.onExecutionSettled((event) => {
                void handleSettled(host, manager, log, event).catch((error) => {
                    log(`[board-notify] settle 处理异常: ${error instanceof Error ? error.message : String(error)}`);
                });
            });
        },
        stop() {
            try {
                disposeSettled?.();
            }
            catch {
                // 忽略订阅释放异常。
            }
            disposeSettled = undefined;
        },
    };
    try {
        const dispose = face.registerExtension(extension);
        log('[board-notify] 已注册到 taskBoard');
        return dispose;
    }
    catch (error) {
        log(`[board-notify] 注册被 board 拒绝: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}
//# sourceMappingURL=board-notify.js.map