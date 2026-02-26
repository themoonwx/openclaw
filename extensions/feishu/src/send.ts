import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import {
  isCronSessionKey,
  isSubagentSessionKey,
  isAcpSessionKey,
  isCronRunSessionKey,
} from "../../../../src/sessions/session-key-utils.ts";
import { resolveFeishuAccount } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import type { MentionTarget } from "./mention.js";
import { buildMentionedMessage, buildMentionedCardContent } from "./mention.js";
import { getMessageTracker } from "./message-tracker.js";
import { getFeishuRuntime } from "./runtime.js";
import { assertFeishuMessageApiSuccess, toFeishuSendResult } from "./send-result.js";
import { resolveFeishuSendTarget } from "./send-target.js";
import { FeishuStreamingSession } from "./streaming-card.js";
import { resolveReceiveIdType, normalizeFeishuTarget } from "./targets.js";
import type { FeishuSendResult, ResolvedFeishuAccount } from "./types.js";

// ============ 消息来源过滤系统 ============

/**
 * 根据 sessionKey 判断消息来源类型
 * sessionKey 从 Gateway 层通过 outbound handler 传入
 */
function getMessageSource(sessionKey?: string): "user" | "cron" | "subagent" | "acp" | "unknown" {
  if (!sessionKey) return "unknown";
  if (isCronSessionKey(sessionKey) || isCronRunSessionKey(sessionKey)) return "cron";
  if (isSubagentSessionKey(sessionKey)) return "subagent";
  if (isAcpSessionKey(sessionKey)) return "acp";
  return "user";
}

/**
 * 根据消息来源判断是否应该跟踪
 * - user: 用户主动对话 -> 跟踪
 * - cron: Cron 任务 -> 跟踪
 * - unknown: API 外部调用 -> 跟踪（默认）
 * - subagent: Subagent 子任务过程 -> 不跟踪
 * - acp: ACP 会话 -> 不跟踪
 */
function shouldTrackBySource(source: string): boolean {
  switch (source) {
    case "user":
    case "cron":
    case "unknown": // API调用默认跟踪
      return true;
    case "subagent":
    case "acp":
      return false;
    default:
      return true;
  }
}

// ============ 智能加急系统 ============

// 紧急消息判断模式（与 standalone_reminder_service.js 保持一致）
const URGENT_PATTERNS = [
  /\[URGENT\]/i,
  /\[紧急\]/i,
  /\[重要\]/i,
  /\[加急\]/i,
  /^紧急[：:]/,
  /^重要[：:]/,
  /^加急[：:]/,
];

/**
 * 判断消息是否为紧急消息（用于智能提醒）
 * 与 standalone_reminder_service.js 保持一致
 */
function isUrgentMessage(text: string): boolean {
  if (!text) return false;

  // 检查消息开头标记
  if (
    text.startsWith("[URGENT]") ||
    text.startsWith("[紧急]") ||
    text.startsWith("[重要]") ||
    text.startsWith("[加急]")
  ) {
    return true;
  }

  // 检查正则模式（与 standalone 保持一致）
  return URGENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 从卡片对象中提取文本内容
 */
function extractTextFromCard(card: Record<string, unknown>): string {
  try {
    // 尝试从常见卡片格式中提取文本
    const cardStr = JSON.stringify(card);

    // 简单提取：查找文本字段
    const textMatch = cardStr.match(/"text"\s*:\s*"([^"]+)"/);
    if (textMatch && textMatch[1]) {
      return textMatch[1];
    }

    // 查找content字段
    const contentMatch = cardStr.match(/"content"\s*:\s*"([^"]+)"/);
    if (contentMatch && contentMatch[1]) {
      return contentMatch[1];
    }

    // 查找title字段
    const titleMatch = cardStr.match(/"title"\s*:\s*"([^"]+)"/);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1];
    }

    return cardStr.substring(0, 200); // 返回前200字符作为文本
  } catch (error) {
    return "";
  }
}

/**
 * 调用urgent_app API加急消息
 */
// 加急功能已完全禁用

export type FeishuMessageInfo = {
  messageId: string;
  chatId: string;
  senderId?: string;
  senderOpenId?: string;
  content: string;
  contentType: string;
  createTime?: number;
};

/**
 * Get a message by its ID.
 * Useful for fetching quoted/replied message content.
 */
export async function getMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  accountId?: string;
}): Promise<FeishuMessageInfo | null> {
  const { cfg, messageId, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);

  try {
    const response = (await client.im.message.get({
      path: { message_id: messageId },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        items?: Array<{
          message_id?: string;
          chat_id?: string;
          msg_type?: string;
          body?: { content?: string };
          sender?: {
            id?: string;
            id_type?: string;
            sender_type?: string;
          };
          create_time?: string;
        }>;
      };
    };

    if (response.code !== 0) {
      return null;
    }

    const item = response.data?.items?.[0];
    if (!item) {
      return null;
    }

    // Parse content based on message type
    let content = item.body?.content ?? "";
    try {
      const parsed = JSON.parse(content);
      if (item.msg_type === "text" && parsed.text) {
        content = parsed.text;
      }
    } catch {
      // Keep raw content if parsing fails
    }

    return {
      messageId: item.message_id ?? messageId,
      chatId: item.chat_id ?? "",
      senderId: item.sender?.id,
      senderOpenId: item.sender?.id_type === "open_id" ? item.sender?.id : undefined,
      content,
      contentType: item.msg_type ?? "text",
      createTime: item.create_time ? parseInt(item.create_time, 10) : undefined,
    };
  } catch {
    return null;
  }
}

export type SendFeishuMessageParams = {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
  /** Mention target users */
  mentions?: MentionTarget[];
  /** Account ID (optional, uses default if not specified) */
  accountId?: string;
  /** Session key to identify message source */
  sessionKey?: string;
};

function buildFeishuPostMessagePayload(params: { messageText: string }): {
  content: string;
  msgType: string;
} {
  const { messageText } = params;
  return {
    content: JSON.stringify({
      zh_cn: {
        content: [
          [
            {
              tag: "md",
              text: messageText,
            },
          ],
        ],
      },
    }),
    msgType: "post",
  };
}

export async function sendMessageFeishu(
  params: SendFeishuMessageParams,
): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId, mentions, accountId, sessionKey } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });

  // Build message content (with @mention support)
  let rawText = text ?? "";
  if (mentions && mentions.length > 0) {
    rawText = buildMentionedMessage(mentions, rawText);
  }
  const messageText = getFeishuRuntime().channel.text.convertMarkdownTables(rawText, tableMode);

  const { content, msgType } = buildFeishuPostMessagePayload({ messageText });

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: msgType,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: msgType,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu send failed: ${response.msg || `code ${response.code}`}`);
  }

  const messageId = response.data?.message_id ?? "unknown";
  const result = {
    messageId,
    chatId: receiveId,
  };

  // 判断是否为紧急消息
  const isUrgent = isUrgentMessage(text || "");
  console.log(`[智能提醒] 消息是否为紧急: ${isUrgent}`);

  // 如果不是紧急消息，记录到跟踪系统（用于10秒未读提醒）
  // 根据消息来源过滤：subagent 和 acp 不跟踪
  if (!isUrgent) {
    const source = getMessageSource(sessionKey); // 使用传入的 sessionKey 判断消息来源
    if (shouldTrackBySource(source)) {
      try {
        const tracker = getMessageTracker();

        console.log(`[智能提醒] 消息来源: ${source}，准备跟踪消息`);
        // 使用 async/await 确保错误正确传播
        await tracker.trackMessage({
          messageId: messageId,
          userId: receiveId,
          text: text || "",
          isUrgent: false,
        });
        console.log("[智能提醒] 消息跟踪成功，提醒将由 reminder-service 独立处理");
      } catch (error) {
        console.warn("[消息跟踪失败]:", error);
      }
    } else {
      console.log(`[智能提醒] 消息来源为 ${source}，跳过跟踪`);
    }
  } else {
    console.log(`[智能提醒] 紧急消息不需要未读提醒`);
  }

  return result;
}

export type SendFeishuCardParams = {
  cfg: ClawdbotConfig;
  to: string;
  card: Record<string, unknown>;
  replyToMessageId?: string;
  accountId?: string;
  /** Session key to identify message source */
  sessionKey?: string;
};

export async function sendCardFeishu(params: SendFeishuCardParams): Promise<FeishuSendResult> {
  const { cfg, to, card, replyToMessageId, accountId, sessionKey } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify(card);

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "interactive",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu card reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "interactive",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu card send failed: ${response.msg || `code ${response.code}`}`);
  }

  const messageId = response.data?.message_id ?? "unknown";
  const result = {
    messageId,
    chatId: receiveId,
  };

  // 智能加急：检查卡片消息是否需要加急
  const cardText = extractTextFromCard(card);
  console.log(`[智能加急] 卡片文本提取: ${cardText.substring(0, 100)}...`);

  // 判断卡片消息是否为紧急
  const isUrgentCard = isUrgentMessage(cardText);
  console.log(`[智能提醒] 卡片消息是否为紧急: ${isUrgentCard}`);

  // 如果不是紧急消息，记录到跟踪系统
  // 根据消息来源过滤：subagent 和 acp 不跟踪
  if (!isUrgentCard) {
    const source = getMessageSource(sessionKey); // 使用传入的 sessionKey 判断消息来源
    if (shouldTrackBySource(source)) {
      try {
        const tracker = getMessageTracker();
        console.log(`[智能提醒] 卡片消息来源: ${source}，准备跟踪消息`);
        tracker
          .trackMessage({
            messageId,
            userId: receiveId,
            text: cardText || "",
            isUrgent: false,
          })
          .catch((error) => {
            console.warn("卡片消息跟踪失败:", error);
          });
      } catch (error) {
        console.warn("获取跟踪器失败:", error);
      }
    } else {
      console.log(`[智能提醒] 卡片消息来源为 ${source}，跳过跟踪`);
    }
  } else {
    console.log(`[智能提醒] 紧急卡片消息不需要未读提醒`);
  }

  return result;
}

export async function updateCardFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  card: Record<string, unknown>;
  accountId?: string;
}): Promise<void> {
  const { cfg, messageId, card, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
  const content = JSON.stringify(card);

  const response = await client.im.message.patch({
    path: { message_id: messageId },
    data: { content },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu card update failed: ${response.msg || `code ${response.code}`}`);
  }
}

/**
 * Build a Feishu interactive card with markdown content.
 * Cards render markdown properly (code blocks, tables, links, etc.)
 * Uses schema 2.0 format for proper markdown rendering.
 */
export function buildMarkdownCard(text: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: text,
        },
      ],
    },
  };
}

/**
 * Send a message as a markdown card (interactive message).
 * This renders markdown properly in Feishu (code blocks, tables, bold/italic, etc.)
 */
export async function sendMarkdownCardFeishu(params: {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
  /** Mention target users */
  mentions?: MentionTarget[];
  accountId?: string;
}): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId, mentions, accountId } = params;
  // Build message content (with @mention support)
  let cardText = text;
  if (mentions && mentions.length > 0) {
    cardText = buildMentionedCardContent(mentions, text);
  }
  const card = buildMarkdownCard(cardText);
  return sendCardFeishu({ cfg, to, card, replyToMessageId, accountId });
}

/**
 * Edit an existing text message.
 * Note: Feishu only allows editing messages within 24 hours.
 */
export async function editMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  text: string;
  accountId?: string;
}): Promise<void> {
  const { cfg, messageId, text, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
  const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });
  const messageText = getFeishuRuntime().channel.text.convertMarkdownTables(text ?? "", tableMode);

  const { content, msgType } = buildFeishuPostMessagePayload({ messageText });

  const response = await client.im.message.update({
    path: { message_id: messageId },
    data: {
      msg_type: msgType,
      content,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu message edit failed: ${response.msg || `code ${response.code}`}`);
  }
}

// ============ 流式卡片消息系统 ============

export type FeishuStreamingCardParams = {
  cfg: ClawdbotConfig;
  to: string;
  /** 初始内容（可选） */
  initialText?: string;
  /** 流式内容更新回调 */
  onChunk?: (text: string) => void | Promise<void>;
  /** Account ID (optional, uses default if not specified) */
  accountId?: string;
  /** 是否自动关闭流式（默认true） */
  autoClose?: boolean;
};

/**
 * 流式卡片消息结果
 */
export type FeishuStreamingCardResult = {
  messageId: string;
  chatId: string;
  /** 关闭流式并显示最终内容 */
  close: (finalText?: string) => Promise<void>;
  /** 更新内容 */
  update: (text: string) => Promise<void>;
  /** 检查是否活跃 */
  isActive: () => boolean;
};

/**
 * 发送流式卡片消息（打字机效果）
 *
 * 使用飞书 CardKit 流式更新 API 实现实时打字机效果
 *
 * @example
 * ```typescript
 * const stream = await sendStreamingCardFeishu({
 *   cfg,
 *   to: userId,
 *   initialText: "正在思考...",
 *   onChunk: async (text) => {
 *     // 可以在这里处理每个chunk
 *     console.log("Received chunk:", text);
 *   }
 * });
 *
 * // 模拟 AI 生成过程
 * for await (const chunk of generateAIResponse()) {
 *   await stream.update(chunk);
 * }
 *
 * // 完成时关闭流式
 * await stream.close(finalResponse);
 * ```
 */
export async function sendStreamingCardFeishu(
  params: FeishuStreamingCardParams,
): Promise<FeishuStreamingCardResult> {
  const { cfg, to, initialText, onChunk, accountId, autoClose = true } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);

  // 创建流式会话
  const client = createFeishuClient(account);
  const streaming = new FeishuStreamingSession(
    client,
    { appId: account.appId!, appSecret: account.appSecret!, domain: account.domain },
    (msg) => console.log(`[FeishuStreaming] ${msg}`),
  );

  // 启动流式卡片
  await streaming.start(receiveId, receiveIdType);

  // 初始内容更新
  if (initialText) {
    await streaming.update(initialText);
    if (onChunk) {
      await onChunk(initialText);
    }
  }

  // 返回控制句柄
  const result: FeishuStreamingCardResult = {
    messageId: streaming.getMessageId() ?? "",
    chatId: receiveId,
    close: async (finalText?: string) => {
      await streaming.close(finalText);
      if (onChunk && finalText) {
        await onChunk(finalText);
      }
    },
    update: async (text: string) => {
      await streaming.update(text);
      if (onChunk) {
        await onChunk(text);
      }
    },
    isActive: () => streaming.isActive(),
  };

  return result;
}

/**
 * 便捷函数：发送带流式输出的 markdown 卡片
 *
 * @example
 * ```typescript
 * const stream = await sendStreamingMarkdownFeishu({
 *   cfg,
 *   to: userId,
 *   initialText: "⏳ 正在生成回复..."
 * });
 *
 * // 模拟流式输出
 * const words = "Hello, this is a streaming message!".split(" ");
 * for (const word of words) {
 *   currentText += word + " ";
 *   await stream.update(currentText);
 *   await new Promise(r => setTimeout(r, 100));
 * }
 *
 * await stream.close();
 * ```
 */
export type SendStreamingMarkdownParams = {
  cfg: ClawdbotConfig;
  to: string;
  initialText?: string;
  accountId?: string;
  autoClose?: boolean;
};

export async function sendStreamingMarkdownFeishu(params: SendStreamingMarkdownParams) {
  const { cfg, to, initialText, accountId, autoClose } = params;

  return sendStreamingCardFeishu({
    cfg,
    to,
    initialText: initialText || "⏳ Thinking...",
    accountId,
    autoClose,
  });
}
