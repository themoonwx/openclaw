// src/multi-agent/adapters/llm-client.ts

import type { LLMClient } from "../agents/lightweight.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import type { RunEmbeddedPiAgentParams } from "../../agents/pi-embedded-runner/run/params.js";
import { randomUUID } from "node:crypto";

/**
 * LLM Client implementation
 * Reuses existing OpenClaw LLM API calling logic
 */
export class OpenClawLLMClient implements LLMClient {
  private defaultProvider?: string;
  private defaultModel?: string;
  private config?: any;

  constructor(options?: {
    defaultProvider?: string;
    defaultModel?: string;
    config?: any;
  }) {
    this.defaultProvider = options?.defaultProvider;
    this.defaultModel = options?.defaultModel;
    this.config = options?.config;
  }

  async chat(params: {
    messages: { role: "system" | "user"; content: string }[];
    model?: string;
    provider?: string;
  }): Promise<{ content: string }> {
    const sessionId = `llm-${randomUUID()}`;
    const runId = randomUUID();

    // Convert messages to OpenAI format
    const userMessages = params.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n\n");

    const systemMessage = params.messages.find((m) => m.role === "system")?.content ?? "";

    try {
      const result = await runEmbeddedPiAgent({
        sessionId,
        sessionFile: "", // Would be resolved internally
        workspaceDir: process.cwd(),
        config: this.config,
        prompt: userMessages,
        provider: params.provider ?? this.defaultProvider,
        model: params.model ?? this.defaultModel,
        // Add extra system prompt if provided
        ...(systemMessage ? { extraSystemPrompt: systemMessage } : {}),
      } as RunEmbeddedPiAgentParams);

      if (result.error) {
        throw new Error(result.error);
      }

      return {
        content: result.message ?? "",
      };
    } catch (err) {
      throw new Error(
        `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
