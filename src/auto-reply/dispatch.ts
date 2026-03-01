import type { OpenClawConfig } from "../config/config.js";
import {
  runMultiAgentProject,
  getMultiAgentSystem,
  setNotifyUserFunction,
  getCCTaskQueueStatus,
  getCurrentTaskProgress,
  processMessageWithTrigger,
} from "../multi-agent/gateway-integration.js";
import { routeMessage } from "../multi-agent/trigger.js";
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

  // Set up notification function for CC task queue
  setNotifyUserFunction((text: string) => {
    params.dispatcher.send(text).catch(console.error);
  });

  // Check if multi-agent system is enabled and if this is a multi-agent request
  const multiAgentSystem = getMultiAgentSystem();
  console.log(
    "[Trigger] MultiAgent check - system exists:",
    !!multiAgentSystem,
    "enabled:",
    multiAgentSystem?.isEnabled(),
  );

  if (multiAgentSystem && multiAgentSystem.isEnabled()) {
    // Extract actual message content from envelope format (e.g., "[Discord user#1234] message")
    const envelopeMatch = messageBody.match(/^\[.+?\]\s*(.+)$/s);
    const triggerContent = envelopeMatch ? envelopeMatch[1].trim() : messageBody;

    // Use three-layer trigger to determine message routing
    const route = routeMessage(triggerContent);
    console.log("[Trigger] Route result:", route.mode, "content:", triggerContent.substring(0, 30));

    if (route.mode === "multi_agent") {
      // Full multi-agent project flow
      console.log("[Trigger] Routing to multi-agent mode:", route.content.substring(0, 50));
      try {
        const result = await runMultiAgentProject(route.content);
        // Send the result back to the user with project tag
        await params.dispatcher.send(`【项目】\n\n${result}`);
        return {
          ok: true,
          final: result,
          toolResults: [],
          agentErrors: [],
          queuedFinal: true,
          counts: { tool: 0, block: 0, final: 1 },
        };
      } catch (err) {
        console.error("[Trigger] Multi-agent error:", err);
        await params.dispatcher.send("❌ 多 Agent 执行失败，请检查日志");
        return {
          ok: false,
          final: "多 Agent 执行失败",
          toolResults: [],
          agentErrors: [String(err)],
          queuedFinal: true,
          counts: { tool: 0, block: 0, final: 1 },
        };
      }
    } else if (route.mode === "single_agent") {
      // Single agent mode - use processMessageWithTrigger
      console.log("[Trigger] Single agent mode:", route.targetAgent);
      // Pass original triggerContent to preserve agent info, not route.content
      const result = await processMessageWithTrigger(
        triggerContent,
        // 不再使用回调发送中间状态，避免标签丢失
        undefined,
      );
      console.log("[Trigger] Dispatch received result:", JSON.stringify(result).substring(0, 100));
      if (result.response) {
        console.log("[Trigger] Sending single_agent response with tag:", result.response.substring(0, 50));
        await params.dispatcher.send(result.response);
      } else {
        console.log("[Trigger] WARNING: single_agent returned no response!");
        console.log("[Trigger] Result keys:", Object.keys(result));
      }
      return {
        ok: true,
        final: result.response ?? "Single agent task completed",
        toolResults: [],
        agentErrors: [],
        queuedFinal: true,
        counts: { tool: 0, block: 0, final: 1 },
      };
    } else if (route.mode === "cc_task") {
      // Claude Code task queue mode
      console.log("[Trigger] CC task mode:", route.content.substring(0, 50));

      // Get queue status
      const queueStatus = getCCTaskQueueStatus();

      // Notify user that task is queued
      await params.dispatcher.send(
        `【CC】\n\n📋 任务已加入 CC 队列\n\n当前队列: ${queueStatus.pending} 个待处理, ${queueStatus.running} 个执行中`,
      );

      return {
        ok: true,
        final: "任务已加入队列",
        toolResults: [],
        agentErrors: [],
        queuedFinal: true,
        counts: { tool: 0, block: 0, final: 1 },
      };
    } else if (route.mode === "cc_progress") {
      // Query CC task progress
      console.log("[Trigger] CC progress query");

      const progress = getCurrentTaskProgress();
      const queueStatus = getCCTaskQueueStatus();

      if (!progress || queueStatus.running === 0) {
        await params.dispatcher.send(
          `【CC】\n\n📊 CC 任务状态\n\n队列: ${queueStatus.pending} 待处理, ${queueStatus.running} 执行中, ${queueStatus.completed} 已完成\n\n当前无任务在执行`,
        );
      } else {
        await params.dispatcher.send(
          `【CC】\n\n📊 **任务 #${progress.taskId} 进度**\n\n状态: ${progress.status}\n\n---\n${progress.output.slice(-2000)}`,
        );
      }

      return {
        ok: true,
        final: "已返回进度",
        toolResults: [],
        agentErrors: [],
        queuedFinal: true,
        counts: { tool: 0, block: 0, final: 1 },
      };
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
