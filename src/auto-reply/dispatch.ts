import type { OpenClawConfig } from "../config/config.js";
import type { DispatchFromConfigResult } from "./reply/dispatch-from-config.js";
import { dispatchReplyFromConfig } from "./reply/dispatch-from-config.js";
import { finalizeInboundContext } from "./reply/inbound-context.js";
import {
  createReplyDispatcher,
  createReplyDispatcherWithTyping,
  type ReplyDispatcher,
  type ReplyDispatcherOptions,
  type ReplyDispatcherWithTypingOptions,
} from "./reply/reply-dispatcher.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";
import type { GetReplyOptions } from "./types.js";
import {
  isMultiAgentRequest,
  runMultiAgentProject,
  getMultiAgentSystem,
  type RouteResult,
} from "../multi-agent/gateway-integration.js";
import { routeMessage } from "../multi-agent/trigger.js";

export type DispatchInboundResult = DispatchFromConfigResult;

export async function withReplyDispatcher<T>(params: {
  dispatcher: ReplyDispatcher;
  run: () => Promise<T>;
  onSettled?: () => void | Promise<void>;
}): Promise<T> {
  try {
    return await params.run();
  } finally {
    // Ensure dispatcher reservations are always released on every exit path.
    params.dispatcher.markComplete();
    try {
      await params.dispatcher.waitForIdle();
    } finally {
      await params.onSettled?.();
    }
  }
}

export async function dispatchInboundMessage(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const messageBody = params.ctx.Body?.trim() ?? "";

  // Check if multi-agent system is enabled and if this is a multi-agent request
  const multiAgentSystem = getMultiAgentSystem();
  console.log("[Trigger] MultiAgent check - system exists:", !!multiAgentSystem, "enabled:", multiAgentSystem?.isEnabled());

  if (multiAgentSystem && multiAgentSystem.isEnabled()) {
    // Use three-layer trigger to determine message routing
    const route = routeMessage(messageBody);
    console.log("[Trigger] Route result:", route.mode, "content:", messageBody.substring(0, 30));

    if (route.mode === "multi_agent") {
      // Full multi-agent project flow
      console.log("[Trigger] Routing to multi-agent mode:", route.content.substring(0, 50));
      try {
        const result = await runMultiAgentProject(route.content);
        // Send the result back to the user
        await params.dispatcher.send(result);
        return {
          ok: true,
          final: result,
          toolResults: [],
          agentErrors: [],
        };
      } catch (err) {
        console.error("[Trigger] Multi-agent error:", err);
        await params.dispatcher.send("❌ 多 Agent 执行失败，请检查日志");
        return {
          ok: false,
          final: "多 Agent 执行失败",
          toolResults: [],
          agentErrors: [String(err)],
        };
      }
    } else if (route.mode === "single_agent") {
      // Single agent mode - handled separately
      console.log("[Trigger] Single agent mode:", route.targetAgent);
      // For now, fall through to normal flow (single agent handling needs more integration)
    }
    // For suggest_project and single_llm modes, continue with normal flow
  }

  const finalized = finalizeInboundContext(params.ctx);
  return await withReplyDispatcher({
    dispatcher: params.dispatcher,
    run: () =>
      dispatchReplyFromConfig({
        ctx: finalized,
        cfg: params.cfg,
        dispatcher: params.dispatcher,
        replyOptions: params.replyOptions,
        replyResolver: params.replyResolver,
      }),
  });
}

export async function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const { dispatcher, replyOptions, markDispatchIdle } = createReplyDispatcherWithTyping(
    params.dispatcherOptions,
  );
  try {
    return await dispatchInboundMessage({
      ctx: params.ctx,
      cfg: params.cfg,
      dispatcher,
      replyResolver: params.replyResolver,
      replyOptions: {
        ...params.replyOptions,
        ...replyOptions,
      },
    });
  } finally {
    markDispatchIdle();
  }
}

export async function dispatchInboundMessageWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const dispatcher = createReplyDispatcher(params.dispatcherOptions);
  return await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
}
