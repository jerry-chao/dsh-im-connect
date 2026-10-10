import { readFile } from 'node:fs/promises'
import type { ChannelManager } from '../manager.js'

/**
 * task-board 扩展：在任务执行落定后，把任务 prompt 里声明的投递文件
 * 经 dsh-im-connect 已有账号连接发出（复用 ChannelManager.sendProactive）。
 *
 * 只消费 board 扩展契约，不修改 board：
 * - 服务名 `taskBoard`，契约版本锁 1（board 0.4.5 实测）；
 * - board 缺席/禁用/拒绝时降级为日志，一切照常；
 * - 收件人仍受账号 allowlist 约束（sendProactive 内校验）。
 *
 * 任务 prompt 标记（静态文本，由任务作者写入）：
 *   <!-- im-notify: {"accountId":"wecom_xxx","chatId":"yyy","file":"/abs/report.md"} -->
 * agent 写完文件即收工；settle 回调读文件发送，结果写回 integration 留痕。
 */
export const BOARD_NOTIFY_EXTENSION_ID = 'im-connect-notify'
export const BOARD_NOTIFY_API_VERSION = 1
export const BOARD_NOTIFY_SERVICE_NAME = 'taskBoard'
export const BOARD_NOTIFY_MAX_TEXT_LENGTH = 4000

const MARKER_PATTERN = /<!--\s*im-notify:\s*(\{.*?\})\s*-->/s

export interface BoardNotifyConfig {
  accountId: string
  chatId: string
  file: string
}

export function parseNotifyMarker(prompt: string): BoardNotifyConfig | undefined {
  const match = MARKER_PATTERN.exec(prompt)
  if (!match) return undefined
  const raw = match[1]
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const accountId = record['accountId']
  const chatId = record['chatId']
  const file = record['file']
  if (typeof accountId !== 'string' || !accountId.trim()) return undefined
  if (typeof chatId !== 'string' || !chatId.trim()) return undefined
  if (typeof file !== 'string' || !file.trim()) return undefined
  return { accountId: accountId.trim(), chatId: chatId.trim(), file: file.trim() }
}

/** board 侧最小能力面（按 board 0.4.5 / apiVersion 1 锁定，只读所需子集）。 */
export interface BoardNotifyTask {
  prompt?: unknown
}
export interface BoardNotifyTasksFace {
  get(taskId: string): BoardNotifyTask | undefined
}
export interface BoardNotifySettledEvent {
  taskId: string
  outcome: string
}
export interface BoardNotifyEventsFace {
  onExecutionSettled(callback: (event: BoardNotifySettledEvent) => void): () => void
}
export interface BoardNotifyIntegrationFace {
  write(taskId: string, payload: Record<string, unknown>): void
}
export interface BoardNotifyHost {
  tasks: BoardNotifyTasksFace
  integration: BoardNotifyIntegrationFace
  events: BoardNotifyEventsFace
}
export interface BoardNotifyService {
  registerExtension(extension: {
    id: string
    apiVersion: number
    start?(host: BoardNotifyHost): void
    stop?(): void
  }): () => void
}

export type BoardNotifyLogger = (line: string) => void

async function audit(
  host: BoardNotifyHost,
  log: BoardNotifyLogger,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    host.integration.write(taskId, {
      provider: BOARD_NOTIFY_EXTENSION_ID,
      sentAt: new Date().toISOString(),
      ...payload,
    })
  } catch (error) {
    log(`[board-notify] 写回留痕失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleSettled(
  host: BoardNotifyHost,
  manager: ChannelManager,
  log: BoardNotifyLogger,
  event: BoardNotifySettledEvent,
): Promise<void> {
  let prompt: unknown
  try {
    prompt = host.tasks.get(event.taskId)?.prompt
  } catch {
    return
  }
  if (typeof prompt !== 'string') return
  const config = parseNotifyMarker(prompt)
  if (!config) return
  if (event.outcome !== 'succeeded') {
    await audit(host, log, event.taskId, { ok: false, error: `本轮执行结果为 ${event.outcome}，未投递` })
    return
  }
  let text: string
  try {
    text = await readFile(config.file, 'utf8')
  } catch {
    await audit(host, log, event.taskId, { ok: false, error: `读不到投递文件 ${config.file}` })
    log(`[board-notify] ${event.taskId} 读不到投递文件 ${config.file}`)
    return
  }
  if (!text.trim()) {
    await audit(host, log, event.taskId, { ok: false, error: '投递文件为空' })
    return
  }
  if (text.length > BOARD_NOTIFY_MAX_TEXT_LENGTH) {
    await audit(host, log, event.taskId, { ok: false, error: `正文超过 ${BOARD_NOTIFY_MAX_TEXT_LENGTH} 字上限` })
    return
  }
  let result: Awaited<ReturnType<ChannelManager['sendProactive']>>
  try {
    result = await manager.sendProactive(config.accountId, { chatId: config.chatId, text })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await audit(host, log, event.taskId, { ok: false, error: detail })
    log(`[board-notify] ${event.taskId} 发送异常: ${detail}`)
    return
  }
  if (result.body['ok'] === true) {
    const chunks = result.body['chunks']
    await audit(host, log, event.taskId, {
      ok: true,
      accountId: config.accountId,
      chatId: config.chatId,
      chunks: typeof chunks === 'number' ? chunks : undefined,
    })
    log(`[board-notify] ${event.taskId} -> ${config.chatId} 已投递`)
  } else {
    const error = result.body['error']
    await audit(host, log, event.taskId, {
      ok: false,
      error: typeof error === 'string' ? error : '发送失败',
    })
    log(`[board-notify] ${event.taskId} 发送失败: ${typeof error === 'string' ? error : '发送失败'}`)
  }
}

/**
 * 向 board 注册本扩展；board 缺席/拒绝时返回 undefined（仅日志，不影响插件其它功能）。
 */
export function registerBoardNotify(
  ctx: unknown,
  manager: ChannelManager,
  log: BoardNotifyLogger,
): (() => void) | undefined {
  const face = (ctx as { taskBoard?: unknown }).taskBoard
  if (!face || typeof (face as BoardNotifyService).registerExtension !== 'function') {
    log('[board-notify] 未发现 taskBoard 服务，跳过扩展注册')
    return undefined
  }
  let disposeSettled: (() => void) | undefined
  const extension = {
    id: BOARD_NOTIFY_EXTENSION_ID,
    apiVersion: BOARD_NOTIFY_API_VERSION,
    start(host: BoardNotifyHost) {
      try {
        disposeSettled?.()
      } catch {
        // 忽略旧订阅释放异常。
      }
      disposeSettled = host.events.onExecutionSettled((event) => {
        void handleSettled(host, manager, log, event).catch((error) => {
          log(`[board-notify] settle 处理异常: ${error instanceof Error ? error.message : String(error)}`)
        })
      })
    },
    stop() {
      try {
        disposeSettled?.()
      } catch {
        // 忽略订阅释放异常。
      }
      disposeSettled = undefined
    },
  }
  try {
    return (face as BoardNotifyService).registerExtension(extension)
  } catch (error) {
    log(`[board-notify] 注册被 board 拒绝: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}
