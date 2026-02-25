/**
 * Message Tracker - 用于飞书消息的未读提醒功能
 * 跟踪消息并在用户未读时发送提醒
 * 
 * 核心功能:
 * 1. 发送消息时记录到 tracker 文件
 * 2. V3 reminder service 读取该文件并处理未读提醒
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import * as fs from "fs";
import * as path from "path";

// Tracker 文件路径（与 standalone_reminder_v3.js 保持一致）
const TRACKER_FILE = '/home/ubuntu/openclaw/message_tracker.json';

interface TrackMessageParams {
  messageId: string;
  userId: string;
  text: string;
  isUrgent: boolean;
}

interface TrackedMessage {
  id: string;
  messageId: string;
  userId: string;
  text: string;
  isUrgent: boolean;
  timestamp: number;
  sentTime: number;
  reminderSent?: boolean;
  checked?: boolean;
  readTime?: number;
  reminderMessageId?: string;
  reminderSentTime?: number;
}

interface MessageTrackerData {
  messages: Record<string, TrackedMessage>;
}

interface MessageTracker {
  trackMessage(params: TrackMessageParams): Promise<void>;
  getMessage(messageId: string): Promise<TrackedMessage | null>;
  updateMessage(messageId: string, updates: Partial<TrackedMessage>): Promise<void>;
}

let runtime: RuntimeEnv | null = null;

function getRuntime(): RuntimeEnv {
  if (!runtime) {
    runtime = getFeishuRuntime();
  }
  return runtime;
}

/**
 * 读取 tracker 文件
 */
function loadTrackerData(): MessageTrackerData {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      const data = fs.readFileSync(TRACKER_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[MessageTracker] 读取tracker文件失败:', e.message);
  }
  return { messages: {} };
}

/**
 * 保存 tracker 文件
 */
function saveTrackerData(data: MessageTrackerData): boolean {
  try {
    const dir = path.dirname(TRACKER_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('[MessageTracker] 保存tracker文件失败:', e.message);
    return false;
  }
}

/**
 * 获取消息跟踪器实例
 */
export function getMessageTracker(): MessageTracker {
  const log = getRuntime()?.log ?? console.log;

  return {
    async trackMessage(params: TrackMessageParams): Promise<void> {
      const { messageId, userId, text, isUrgent } = params;
      const now = Date.now();

      log(`[MessageTracker] Tracking message: ${messageId} for user: ${userId}, urgent: ${isUrgent}`);

      // 加载现有数据
      const trackerData = loadTrackerData();

      // 创建跟踪消息记录（与 V3 reminder service 期望的格式一致）
      const trackedMessage: TrackedMessage = {
        id: messageId,
        messageId: messageId,
        userId: userId,
        text: text,
        isUrgent: isUrgent,
        timestamp: now,
        sentTime: now,
        reminderSent: false,
        checked: false
      };

      // 保存到 tracker 文件
      trackerData.messages[messageId] = trackedMessage;
      
      if (saveTrackerData(trackerData)) {
        log(`[MessageTracker] 消息已记录到 tracker: ${messageId.slice(-8)}`);
      } else {
        log(`[MessageTracker] 消息记录保存失败: ${messageId.slice(-8)}`);
      }

      return Promise.resolve();
    },

    async getMessage(messageId: string): Promise<TrackedMessage | null> {
      const trackerData = loadTrackerData();
      return trackerData.messages[messageId] || null;
    },

    async updateMessage(messageId: string, updates: Partial<TrackedMessage>): Promise<void> {
      const trackerData = loadTrackerData();
      if (trackerData.messages[messageId]) {
        Object.assign(trackerData.messages[messageId], updates);
        saveTrackerData(trackerData);
      }
    }
  };
}
