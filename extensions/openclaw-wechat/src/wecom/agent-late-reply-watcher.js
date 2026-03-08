import { stat } from "node:fs/promises";

function assertFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`createWecomLateReplyWatcher: ${name} is required`);
  }
}

export function createWecomLateReplyWatcher({
  resolveSessionTranscriptFilePath,
  readTranscriptAppendedChunk,
  parseLateAssistantReplyFromTranscriptLine,
  hasTranscriptReplyBeenDelivered,
  markTranscriptReplyDelivered,
  sleep,
  markdownToWecomText,
  now = () => Date.now(),
  statImpl = stat,
} = {}) {
  assertFunction("resolveSessionTranscriptFilePath", resolveSessionTranscriptFilePath);
  assertFunction("readTranscriptAppendedChunk", readTranscriptAppendedChunk);
  assertFunction("parseLateAssistantReplyFromTranscriptLine", parseLateAssistantReplyFromTranscriptLine);
  assertFunction("hasTranscriptReplyBeenDelivered", hasTranscriptReplyBeenDelivered);
  assertFunction("markTranscriptReplyDelivered", markTranscriptReplyDelivered);
  assertFunction("sleep", sleep);
  assertFunction("markdownToWecomText", markdownToWecomText);
  assertFunction("now", now);
  assertFunction("statImpl", statImpl);

  return async function runWecomLateReplyWatcher({
    watchId,
    reason = "pending-final",
    sessionId,
    sessionTranscriptId,
    accountId = "default",
    storePath,
    logger,
    watchStartedAt = now(),
    watchMs,
    pollMs,
    activeWatchers,
    isDelivered,
    markDelivered,
    sendText,
    onFailureFallback,
  } = {}) {
    assertFunction("isDelivered", isDelivered);
    assertFunction("markDelivered", markDelivered);
    assertFunction("sendText", sendText);
    assertFunction("onFailureFallback", onFailureFallback);

    const watcherMap = activeWatchers instanceof Map ? activeWatchers : null;
    if (watcherMap && watchId) {
      watcherMap.set(watchId, {
        sessionId,
        sessionKey: sessionId,
        accountId,
        startedAt: watchStartedAt,
        reason,
      });
    }

    try {
      const transcriptPath = await resolveSessionTranscriptFilePath({
        storePath,
        sessionKey: sessionId,
        sessionId: sessionTranscriptId,
        logger,
      });
      let offset = 0;
      let remainder = "";
      try {
        const fileStat = await statImpl(transcriptPath);
        offset = Number(fileStat.size ?? 0);
      } catch {
        offset = 0;
      }

      const timeoutMs = Math.max(1, Number(watchMs) || 1);
      const pollingMs = Math.max(0, Number(pollMs) || 0);
      const deadline = watchStartedAt + timeoutMs;
      logger?.info?.(`wecom: late reply watcher started session=${sessionId} reason=${reason} timeoutMs=${timeoutMs}`);

      while (now() < deadline) {
        // 不再检查 isDelivered()，允许发送多次回复（支持双接口模式）
        await sleep(pollingMs);

        const { nextOffset, chunk } = await readTranscriptAppendedChunk(transcriptPath, offset);
        offset = nextOffset;
        if (!chunk) continue;

        const combined = remainder + chunk;
        const lines = combined.split("\n");
        remainder = lines.pop() ?? "";

        for (const line of lines) {
          const parsed = parseLateAssistantReplyFromTranscriptLine(line, watchStartedAt);
          if (!parsed) continue;
          // 检查是否已经发送过这条消息
          const alreadyDelivered = hasTranscriptReplyBeenDelivered(sessionId, parsed.transcriptMessageId);
          logger?.info?.(`wecom: late reply check session=${sessionId} transcriptMessageId=${parsed.transcriptMessageId} alreadyDelivered=${alreadyDelivered}`);
          if (alreadyDelivered) continue;

          const formattedReply = markdownToWecomText(parsed.text);
          if (!formattedReply) continue;

          // 发送回复
          await sendText(formattedReply);
          markTranscriptReplyDelivered(sessionId, parsed.transcriptMessageId);
          logger?.info?.(
            `wecom: delivered async late reply session=${sessionId} transcriptMessageId=${parsed.transcriptMessageId}`,
          );
          // 不再 return，继续监控后续回复
        }
      }

      // 超时后不再发送 fallback，因为可能已经发送过回复了
      logger?.info?.(`wecom: late reply watcher finished session=${sessionId}`);
    } catch (err) {
      // 不再发送 fallback，因为可能已经通过其他渠道发送过回复了
      logger?.warn?.(`wecom: late reply watcher failed: ${String(err?.message || err)}`);
    } finally {
      if (watcherMap && watchId) {
        watcherMap.delete(watchId);
      }
    }
  };
}
