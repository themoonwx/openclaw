function assertFunction(name, value) {
  if (typeof value !== "function") {
    throw new Error(`handleWecomAgentPostDispatchFallback: ${name} is required`);
  }
}

export async function handleWecomAgentPostDispatchFallback({
  api,
  state,
  streamingEnabled = false,
  flushStreamingBuffer,
  sendTextToUser,
  markdownToWecomText,
  sendProgressNotice,
  startLateReplyWatcher,
  processingNoticeText = "",
  queuedNoticeText = "",
  dispatchResult = null,
} = {}) {
  if (!state || typeof state !== "object") {
    throw new Error("handleWecomAgentPostDispatchFallback: state is required");
  }
  assertFunction("flushStreamingBuffer", flushStreamingBuffer);
  assertFunction("sendTextToUser", sendTextToUser);
  assertFunction("markdownToWecomText", markdownToWecomText);
  assertFunction("sendProgressNotice", sendProgressNotice);
  assertFunction("startLateReplyWatcher", startLateReplyWatcher);

  const logger = api?.logger;

  if (streamingEnabled) {
    await flushStreamingBuffer({ force: true, reason: "post-dispatch" });
    await state.streamChunkSendChain;
  }

  // 双接口模式下，即使已经发送过回复，也要尝试从 transcript 获取最新回复
  // 因为 bot 发送第一次回复后，可能还有后续回复
  const blockText = String(state.blockTextFallback || "").trim();
  if (blockText && !state.hasDeliveredReply) {
    await sendTextToUser(markdownToWecomText(blockText));
    state.hasDeliveredReply = true;
    logger?.info?.("wecom: delivered accumulated block reply as final fallback");
  }

  // 不再直接 return，继续尝试从 transcript 获取回复
  // 如果已经发送过回复，不再启动 late reply watcher
  if (state.hasDeliveredReply) {
    logger?.info?.("wecom: reply already delivered, skipping late watcher");
    return;
  }

  // if (state.hasDeliveredReply || state.hasDeliveredPartialReply) return;

  const counts = dispatchResult?.counts ?? {};
  const queuedFinal = dispatchResult?.queuedFinal === true;
  const deliveredCount = Number(counts.final ?? 0) + Number(counts.block ?? 0) + Number(counts.tool ?? 0);
  if (!queuedFinal && deliveredCount === 0) {
    logger?.warn?.("wecom: no immediate deliverable reply (likely queued behind active run)");
    await sendProgressNotice(queuedNoticeText);
    await startLateReplyWatcher("queued-no-final");
    return;
  }
  // 如果已经发送过回复，不再启动 late reply watcher
  if (state.hasDeliveredReply) {
    logger?.info?.("wecom: reply already delivered, skipping late watcher");
    return;
  }


  logger?.warn?.("wecom: dispatch finished without direct final delivery; waiting via late watcher");
  await sendProgressNotice(processingNoticeText);
  await startLateReplyWatcher("dispatch-finished-without-final");
}
