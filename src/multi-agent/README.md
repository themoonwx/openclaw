# OpenClaw Multi-Agent System

OpenClaw 的多 Agent 协作系统，支持产品经理、架构师、测试工程师、前端、后端、运维等多种角色的智能协作。

## 系统架构

### Agent 类型

| Agent | 类型 | 说明 |
|-------|------|------|
| 产品经理 (Product Manager) | lightweight | 需求分析，输出 PRD |
| 架构师 (Architect) | lightweight | 技术方案设计 |
| 测试工程师 (Tester) | lightweight | 测试用例编写 |
| 前端 (Frontend) | heavy | 前端开发（Claude Code） |
| 后端 (Backend) | heavy | 后端开发（Claude Code） |
| 运维 (DevOps) | heavy | 部署配置（Claude Code） |

- **Lightweight Agent**: 直接调用 LLM API，响应快速
- **Heavy Agent**: 通过调度器调用 Claude Code，适合复杂开发任务

### 目录结构

```
src/multi-agent/
├── agents/               # Agent 实现
│   ├── base-agent.ts    # 基础 Agent 类
│   ├── lightweight.ts   # 轻量级 Agent (PM/架构师/测试)
│   └── heavy.ts         # 重型 Agent (前端/后端/运维)
├── adapters/            # 外部集成
│   ├── llm-client.ts    # LLM 客户端 (MiniMax/Kimi)
│   └── claude-code.ts   # Claude Code 集成
├── orchestrator.ts      # 项目编排器
├── scheduler.ts         # 任务调度器
├── trigger.ts           # 消息路由触发器
├── gateway-integration.ts # Gateway 集成
├── single-agent-handler.ts # 单 Agent 调用处理器
├── event-bus.ts         # 事件总线
├── memory-guard.ts      # 内存监控
└── health-monitor.ts    # 健康检查
```

## 快速开始

### 1. 配置 Agent 人设

人设文件位于 `~/.openclaw/agents/personas/`:

```yaml
# product_manager.yaml
role: product_manager
name: "Product Manager"
type: lightweight

system_prompt: |
  你是一位资深产品经理...

constraints:
  - 不涉及技术实现细节
  - 不编写代码
```

### 2. 配置触发关键词

编辑 `config/multi-agent.yaml`:

```yaml
enabled: true

triggers:
  # 项目模式关键词
  keywords:
    - "开发一个"
    - "帮我写一个项目"
    - "build a"
    - "create a"

  # Agent 调用命令
  agent_commands:
    - "/产品"
    - "/架构"
    - "/测试"
    - "/前端"
    - "/后端"
    - "/运维"
```

### 3. 启动服务

```bash
sudo systemctl restart openclaw
```

## 使用方法

### 模式一：多 Agent 协作（完整项目）

```
开发一个 Todo 应用
```

系统会自动按顺序调用：产品经理 → 架构师 → 前端/后端 → 运维

### 模式二：单 Agent 调用

```
/产品 帮我写一个PRD
/测试 审查这段代码
/架构 设计一个社交系统
```

或自然语言（需要分隔符）：

```
产品 帮我写PRD
测试 你好
```

### 模式三：Claude Code 任务

```
/cc 优化数据库查询性能
```

## API 接口

### Gateway 集成

```typescript
import { initMultiAgentGateway, getMultiAgentSystem } from "./multi-agent/gateway-hook.js";

await initMultiAgentGateway({
  workspaceDir: "~/.openclaw/workspace",
  configPath: "./config/multi-agent.yaml",
  dbPath: "~/.openclaw/data/multi-agent-events.db",
  defaultProvider: "minimax",
  defaultModel: "MiniMax-M2.5",
});
```

### 直接调用

```typescript
import { MultiAgentSystem } from "./multi-agent/index.js";

const system = new MultiAgentSystem(workspaceDir, dbPath, ccRunner, llmClient);
await system.initialize("~/.openclaw/agents/personas");

const orchestrator = system.getOrchestrator();
const result = await orchestrator.runProject("开发一个博客系统", "proj_001");
```

## 配置参考

### multi-agent.yaml

```yaml
enabled: true

# 调度器配置
scheduler:
  max_concurrent_claude_code: 1  # 并发 Claude Code 数量
  task_timeout_seconds: 300       # 任务超时时间
  max_retry: 2                    # 最大重试次数

# 内存保护
memory_guard:
  critical_mb: 200   # 临界值
  warning_mb: 500     # 警告值

# 人机交互检查点
human_checkpoints:
  after_requirement: true   # 需求分析后
  after_architecture: true   # 架构设计后
  before_deploy: true        # 部署前
```

### Persona YAML 字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| role | Agent 角色标识 | product_manager |
| name | 显示名称 | Product Manager |
| type | 类型 | lightweight / heavy |
| system_prompt | 系统提示词 | 详见下文 |
| constraints | 约束条件 | ["不写代码"] |

### system_prompt 最佳实践

1. **明确定义角色职责**
2. **列出核心能力**
3. **指定输出格式**
4. **添加约束条件**

示例：
```yaml
system_prompt: |
  你是[角色名]，专注于[领域]。

  ## 核心能力
  1. 能力一
  2. 能力二

  ## 输出格式
  - 格式一
  - 格式二

  ## 约束
  - 约束一
  - 约束二
```

## 故障排查

### 查看日志

```bash
sudo journalctl -u openclaw -n 50 --no-pager | grep -E "(Trigger|Agent|handler)"
```

### 常见问题

1. **Agent 无响应**
   - 检查 persona 文件是否存在于 `~/.openclaw/agents/personas/`
   - 检查 LLM API 配置

2. **内存占用过高**
   - 调整 `memory_guard` 配置
   - 重启服务释放内存

3. **Claude Code 任务卡住**
   - 检查调度器并发配置
   - 查看 Claude Code 进程状态

## 技术细节

### 消息路由流程

```
用户消息
    ↓
trigger.ts (routeMessage)
    ↓
┌─────────────────────────────────────┐
│  multi_agent  → 完整项目流程        │
│  single_agent → 单 Agent 调用       │
│  cc_task      → Claude Code 队列   │
│  single_llm   → 普通 LLM 回复      │
└─────────────────────────────────────┘
```

### Lightweight vs Heavy Agent

| 特性 | Lightweight | Heavy |
|------|-------------|-------|
| 实现方式 | 直接 LLM API | 调度器 + Claude Code |
| 响应速度 | 快 | 慢 |
| 适用场景 | 分析、规划、写文档 | 编码、部署 |
| 资源消耗 | 低 | 高 |

## 贡献指南

1. 创建新 Agent：在 `agents/` 目录添加实现
2. 添加新触发词：在 `trigger.ts` 修改 `AGENT_ALIASES`
3. 自定义 Persona：在 `personas/` 目录添加 YAML 文件
