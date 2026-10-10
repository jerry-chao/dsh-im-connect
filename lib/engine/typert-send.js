var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { PROACTIVE_SEND_TYPERT_NAMESPACE, } from './proactive-send.js';
/**
 * Typert 内部调用入口：namespace `im-connect` / method `send`。
 *
 * 与 HTTP 共用 `ChannelManager.sendProactive`（同一校验与发送路径），
 * 不走 cookie 鉴权；调用方身份由 Typert 连接层准入。
 * 供无头调用方（定时任务等）使用，浏览器仍可走 HTTP。
 */
let ImConnectSendService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _send_decorators;
    return class ImConnectSendService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _send_decorators = [Remote];
            __esDecorate(this, null, _send_decorators, { kind: "method", name: "send", static: false, private: false, access: { has: obj => "send" in obj, get: obj => obj.send }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        manager = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, manager) {
            super(ctx, 'imConnect', { namespace: PROACTIVE_SEND_TYPERT_NAMESPACE });
            this.manager = manager;
        }
        async send(args) {
            const { accountId, ...body } = args;
            const result = await this.manager.sendProactive(accountId, body);
            if (result.body['ok'] === true) {
                const chatId = result.body['chatId'];
                const chunks = result.body['chunks'];
                return {
                    ok: true,
                    accountId,
                    chatId: typeof chatId === 'string' ? chatId : undefined,
                    chunks: typeof chunks === 'number' ? chunks : undefined,
                };
            }
            const code = result.body['code'];
            const error = result.body['error'];
            return {
                ok: false,
                code: typeof code === 'string' ? code : undefined,
                error: typeof error === 'string' ? error : '发送失败',
            };
        }
    };
})();
export { ImConnectSendService };
//# sourceMappingURL=typert-send.js.map