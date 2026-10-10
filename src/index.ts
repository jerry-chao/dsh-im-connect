/**
 * dsh-im-connect Host：IM 助理。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { ChannelManager } from './manager.js'
import { ImConnectSendService } from './engine/typert-send.js'
import { registerBoardNotify, BOARD_NOTIFY_SERVICE_NAME } from './engine/board-notify.js'
import type { EngineConfig } from './engine/types.js'
import { createRotatingFileAppender } from './engine/file-log.js'
import { registerPluginUpdater } from './plugin-updater.js'

export const name = 'dsh-im-connect'
export const inject = [
  'webServer',
  'credentials',
  'agents',
  'agentPresets',
  'agentDefaultModel',
  'llm',
  'permissionPresets',
]

export interface PluginConfig {
  stateDir: string
  cwd: string
  provider: string
  model: string
  agentPreset: string
  mergeTimeoutSecs: number
}

export const Config: Schema<PluginConfig> = Schema.object({
  stateDir: Schema.string().default(''),
  cwd: Schema.string().default(process.cwd()),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  agentPreset: Schema.string().default('standard'),
  mergeTimeoutSecs: Schema.number().default(5),
})

export function apply(ctx: Context, config: PluginConfig): void {
  ctx.effect(() => registerPluginUpdater(ctx, {
    endpoint: '/api/michengai/dsh-im-connect/update',
    packageName: '@michengai/dsh-im-connect',
    manifestUrl: new URL('../package.json', import.meta.url),
  }), 'im-connect.plugin-updater')
  const permissionPresets = (ctx as Context & { permissionPresets: { defaultPreset: string } }).permissionPresets
  const stateDir = config.stateDir !== ''
    ? config.stateDir
    : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-im-connect')
  mkdirSync(stateDir, { recursive: true })
  const logFile = join(stateDir, 'gateway.log')
  const fileLog = createRotatingFileAppender(logFile)
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`
    ctx.logger(name).info(line)
    fileLog.append(`${stamped}\n`)
  }

  const engineConfig: EngineConfig = {
    cwd: config.cwd || process.cwd(),
    provider: config.provider,
    model: config.model,
    agentPreset: config.agentPreset || 'standard',
    mergeTimeoutSecs: config.mergeTimeoutSecs || 5,
    permissionPreset: permissionPresets.defaultPreset,
  }

  const applyStarted = Date.now()
  const manager = new ChannelManager({ ctx, stateDir, log, engineConfig })
  log(`[boot] ChannelManager 构造 ${Date.now() - applyStarted}ms`)
  // Typert 内部调用入口（namespace im-connect / method send），随插件上下文释放。
  new ImConnectSendService(ctx, manager)
  // task-board 扩展：任务落定后按 prompt 标记自动投递。
  // board 可能晚于本插件发布服务，用 inject 等它出现；无 inject 的旧宿主走直接注册。
  let boardNotifyDispose: (() => void) | undefined
  const registerBoard = (): void => {
    try {
      boardNotifyDispose?.()
    } catch {
      // 忽略旧注册释放异常。
    }
    boardNotifyDispose = registerBoardNotify(ctx, manager, log)
  }
  const scopedInject = (ctx as unknown as {
    inject?: (names: readonly string[], callback: () => unknown) => unknown
  }).inject
  if (typeof scopedInject === 'function') {
    scopedInject.call(ctx, [BOARD_NOTIFY_SERVICE_NAME], () => {
      registerBoard()
    })
  } else {
    registerBoard()
  }
  ctx.effect(() => {
    manager.registerApi(ctx)
    // 卸载或初始化失败后不再恢复会话；保留一个完整异常链，避免后台拒绝终止宿主。
    void manager.initEnabled().then(() => manager.attachMappedSessions()).catch(error => {
      fileLog.append(`${new Date().toISOString()} [boot] 初始化失败: ${error instanceof Error ? error.message : String(error)}\n`)
    })
    log(`[boot] apply 完成 ${Date.now() - applyStarted}ms`)
    return () => {
      try {
        boardNotifyDispose?.()
      } catch {
        // 忽略扩展注销异常。
      }
      manager.disposeApi(); void fileLog.flush()
    }
  }, 'im-connect.serve')
}

export { CHANNEL_META, CHANNEL_ORDER, listChannelMeta } from './channels/meta.js'
export {
  IM_ORIGIN,
  IM_SESSION_PREFIX,
  createImSessionId,
  isImOrigin,
  isImSessionId,
  isTaskSession,
  sessionKeyOf,
} from './engine/session-id.js'
export { splitText } from './engine/split.js'
export {
  PROACTIVE_SEND_TYPERT_NAMESPACE,
  PROACTIVE_SEND_TYPERT_METHOD,
  PROACTIVE_SEND_MAX_TEXT_LENGTH,
  validateProactiveSendInput,
  deliverProactiveSend,
  proactiveSendErrorStatus,
  type ProactiveSendArgs,
  type ProactiveSendRequest,
  type ProactiveSendResult,
  type ProactiveSendTarget,
} from './engine/proactive-send.js'
export { ImConnectSendService } from './engine/typert-send.js'
export {
  BOARD_NOTIFY_API_VERSION,
  BOARD_NOTIFY_EXTENSION_ID,
  BOARD_NOTIFY_SERVICE_NAME,
  parseNotifyMarker,
  registerBoardNotify,
} from './engine/board-notify.js'
