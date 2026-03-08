# 任务失败重试与错误处理机制

## 概述

在 OpenClaw 核心代码中实现的智能任务失败处理机制，解决子任务失败后盲目重试、无限循环的问题。

## 核心功能

1. **错误分类** - 8 种错误类型：authentication、network、permission、dependency、not_found、timeout、rate_limit、unknown
2. **错误指纹** - 归一化错误消息，生成唯一指纹识别相同错误
3. **双重限制** - 连续同样错误 3 次、累计失败 5 次
4. **重试策略** - 可配置是否可重试、是否需要先修复
5. **强制报告** - 超过限制后标记 `forceHumanReport: true`

## 文件结构

```
src/agents/
├── error-classifier.ts      # 错误分类与指纹生成
├── task-retry-state.ts      # 重试状态管理
└── tools/
    └── sessions-spawn-tool.ts  # 集成重试逻辑
```

## 核心模块

### 1. error-classifier.ts

```typescript
// 错误消息归一化（去除动态内容）
normalizeErrorMessage(errorMessage: string): string

// 错误类型分类
classifyError(errorMessage: string): ErrorType

// 生成错误指纹
generateErrorFingerprint(errorType: ErrorType, errorMessage: string): string

// 获取重试策略
getRetryPolicy(errorType: ErrorType): RetryPolicy
isErrorRetryable(errorType: ErrorType): boolean
requiresFixBeforeRetry(errorType: ErrorType): boolean
```

#### 错误类型与重试策略

| 错误类型       | 可重试 | 需修复 | 说明                 |
| -------------- | ------ | ------ | -------------------- |
| authentication | ✓      | ✓      | 需先登录/配置凭据    |
| network        | ✓      | ✗      | 网络问题通常暂时性   |
| permission     | ✓      | ✓      | 需修复权限           |
| dependency     | ✓      | ✓      | 需安装依赖           |
| not_found      | ✗      | ✗      | 资源不存在，重试无效 |
| timeout        | ✓      | ✗      | 超时可能暂时性       |
| rate_limit     | ✓      | ✗      | 需等待后重试         |
| unknown        | ✓      | ✗      | 未知错误可能暂时性   |

### 2. task-retry-state.ts

```typescript
// 记录任务失败
recordTaskFailure(
  taskId: string,
  taskDescription: string,
  errorMessage: string,
  errorType: ErrorType
): TaskRetryState

// 检查是否应该重试
shouldRetry(taskId: string): { allowed: boolean; reason: string }

// 成功后清除状态
clearTaskState(taskId: string): void

// 重试组功能（跨任务追踪）
createRetryGroupId(): string
recordTaskFailureWithGroup(...): TaskRetryState
shouldRetryByGroup(retryGroupId: string): { allowed: boolean; reason: string }
```

#### 常量

```typescript
MAX_CONSECUTIVE_SAME_ERROR = 3; // 连续同样错误次数限制
MAX_TOTAL_FAILURES = 5; // 累计失败次数限制
```

## 集成到 sessions-spawn-tool

在任务派发时自动应用重试逻辑：

```typescript
// sessions-spawn-tool.ts 中的逻辑
1. 创建任务ID和重试组ID
2. 执行任务（最多 MAX_RETRY_ATTEMPTS=3 次）
3. 每次失败：
   - 分类错误类型
   - 记录失败状态
   - 检查重试限制
4. 超过限制返回 forceHumanReport: true
5. 成功则清除状态
```

## 返回结果格式

失败时返回：

```json
{
  "status": "error",
  "error": "错误消息",
  "errorType": "dependency",
  "retryInfo": {
    "reason": "Consecutive same error limit reached (3/3)",
    "consecutiveErrorCount": 3,
    "totalFailureCount": 3,
    "forceHumanReport": true,
    "retryGroupId": "rg:1234567890:abc"
  }
}
```

## 错误消息归一化示例

| 原始错误                                                                 | 归一化后                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `Error: connect ECONNREFUSED 127.0.0.1:3000 at 2024-01-15T10:30:00.000Z` | `error: connect econnrefused 127.0.0.1:<port> at <timestamp>` |
| `Error: permission denied for /tmp/file-1234567890.txt`                  | `error: permission denied for /tmp/<temp><timestamp>.txt`     |
| `Request ID: req-abc123-xyz 访问被拒绝`                                  | `<request_id>-abc123-xyz 访问被拒绝`                          |

## 闭环流程

```
子任务失败
    ↓
错误消息归一化 → 生成错误指纹
    ↓
错误类型分类
    ↓
记录失败 (连续同样错误+1, 累计失败+1)
    ↓
检查限制 ←────────────┐
    │                  │
 允许重试           超过限制
    ↓                  ↓
 尝试修复        强制人工报告
 重新执行        (forceHumanReport: true)
    ↓
 成功? → 清除状态
```

## 测试验证

运行测试脚本验证核心功能：

```bash
bun test-retry.ts
```

测试覆盖：

- 错误消息归一化
- 错误类型分类
- 错误指纹生成
- 重试策略
- 任务状态跟踪
- 重试组功能

## 修改记录

- 2026-03-08: 初始实现
  - 新增 error-classifier.ts
  - 新增 task-retry-state.ts
  - 修改 sessions-spawn-tool.ts 集成重试逻辑
  - 修复分类顺序问题（not_found vs dependency）
