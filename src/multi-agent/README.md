# Multi-Agent Integration Guide

## Quick Start

To integrate the multi-agent system with OpenClaw, add the following to your Gateway startup:

```typescript
// In your gateway startup file
import { initMultiAgentGateway, cleanupMultiAgentGateway } from "./multi-agent/gateway-hook.js";

// During startup
await initMultiAgentGateway({
  workspaceDir: "~/.openclaw/workspace",
  configPath: "./config/multi-agent.yaml",
  dbPath: "~/.openclaw/data/multi-agent-events.db",
  defaultProvider: "minimax",
  defaultModel: "MiniMax-M2.5",
});

// During shutdown
await cleanupMultiAgentGateway();
```

## Configuration

Edit `config/multi-agent.yaml`:

```yaml
enabled: true  # Set to false to disable

scheduler:
  max_concurrent_claude_code: 1
  task_timeout_seconds: 300
  max_retry: 2

memory_guard:
  critical_mb: 200
  warning_mb: 500

human_checkpoints:
  after_requirement: true
  after_architecture: true
  before_deploy: true

triggers:
  keywords:
    - "开发一个"
    - "帮我写一个项目"
    - "build a"
```

## Persona Configuration

Personas are defined in `config/personas/`:
- `orchestrator.yaml` - Project commander
- `product_manager.yaml` - Requirements analysis
- `architect.yaml` - Technical architecture
- `frontend.yaml` - Frontend orchestration
- `backend.yaml` - Backend orchestration
- `devops.yaml` - Deployment orchestration
- `tester.yaml` - Testing

## API

### Gateway Hook

```typescript
import { preprocessMessage, initMultiAgentGateway } from "./multi-agent/gateway-hook.js";

// Check if message should trigger multi-agent
const { shouldHandle, isMultiAgent, result } = await preprocessMessage(ctx, cfg);

// Initialize at startup
await initMultiAgentGateway({ ... });
```

### Direct Usage

```typescript
import { MultiAgentSystem } from "./multi-agent/index.js";
import { OpenClawClaudeCodeRunner } from "./multi-agent/adapters/claude-code.js";
import { OpenClawLLMClient } from "./multi-agent/adapters/llm-client.js";

const system = new MultiAgentSystem(
  workspaceDir,
  dbPath,
  new OpenClawClaudeCodeRunner(),
  new OpenClawLLMClient(),
);

await system.initialize("./config/personas");
const orchestrator = system.getOrchestrator();

if (orchestrator?.isProjectRequest("帮我写一个项目")) {
  await orchestrator.runProject("帮我写一个项目", "proj_001");
}
```
