// src/multi-agent/adapters/llm-client.ts

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { LLMClient } from "../agents/lightweight.js";

// Load API key from auth-profiles.json
function loadApiKeyFromAuthProfiles(agentDir?: string): string | undefined {
  if (!agentDir) return undefined;

  const authProfilesPath = path.join(agentDir, "auth-profiles.json");
  try {
    if (fs.existsSync(authProfilesPath)) {
      const content = fs.readFileSync(authProfilesPath, "utf-8");
      const store = JSON.parse(content);

      // New format: store.profiles["profile-id"].key
      if (store.profiles && typeof store.profiles === "object") {
        for (const [profileId, profile] of Object.entries(store.profiles)) {
          if (
            profile &&
            typeof profile === "object" &&
            (profile as any).type === "api_key" &&
            (profile as any).provider === "minimax" &&
            (profile as any).key
          ) {
            console.log(`[DirectLLM] Loaded MINIMAX_API_KEY from auth-profiles.json (profile: ${profileId})`);
            return (profile as any).key;
          }
        }
      }

      // Legacy format: store.providers.minimax.apiKey
      if (store.providers?.minimax?.apiKey) {
        console.log("[DirectLLM] Loaded MINIMAX_API_KEY from auth-profiles.json (legacy format)");
        return store.providers.minimax.apiKey;
      }
    }
  } catch (e) {
    console.warn("[DirectLLM] Failed to load auth-profiles.json:", e);
  }
  return undefined;
}

/**
 * Direct LLM Client - bypasses runEmbeddedPiAgent to have full control over system prompt
 * This ensures persona system_prompt is used as-is, without being appended to default OpenClaw prompt
 */
export class DirectLLMClient implements LLMClient {
  private defaultProvider?: string;
  private defaultModel?: string;
  private config?: any;
  private agentDir?: string;
  private apiKey?: string;

  constructor(options?: {
    defaultProvider?: string;
    defaultModel?: string;
    config?: any;
    agentDir?: string;
  }) {
    this.defaultProvider = options?.defaultProvider;
    this.defaultModel = options?.defaultModel;
    this.config = options?.config;
    this.agentDir = options?.agentDir;
    this.apiKey = loadApiKeyFromAuthProfiles(this.agentDir);
  }

  async chat(params: {
    messages: { role: "system" | "user"; content: string }[];
    model?: string;
    provider?: string;
  }): Promise<{ content: string }> {
    // Extract system message - this is the ONLY system prompt we'll use
    const systemMessage = params.messages.find((m) => m.role === "system")?.content ?? "";
    const userMessages = params.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n\n");

    console.log("[DirectLLM] Using system prompt:", systemMessage.substring(0, 100));

    const provider = params.provider ?? this.defaultProvider ?? "minimax";
    const model = params.model ?? this.defaultModel ?? "MiniMax-M2.5";

    try {
      let endpoint = "https://api.minimaxi.com/v1/chat/completions";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (provider === "minimax") {
        endpoint = "https://api.minimaxi.com/v1/chat/completions";
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      } else if (provider === "kimi") {
        endpoint = "https://api.moonshot.cn/v1/chat/completions";
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessages },
          ],
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error: ${response.status} ${errorText}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content ?? "";

      return { content };
    } catch (err) {
      throw new Error(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
