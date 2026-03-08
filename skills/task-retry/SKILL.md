# Task Retry - 智能任务失败重试机制

## 概述

为 AI Agent 任务执行提供智能失败处理与重试机制，解决子任务失败后盲目重试、无限循环的问题。

## 功能特性

- **错误分类** - 8 种错误类型自动识别
- **错误指纹** - 归一化错误消息，识别相同错误
- **双重限制** - 连续同样错误 3 次、累计失败 5 次
- **重试策略** - 可配置是否可重试、是否需要先修复
- **强制报告** - 超过限制后自动标记人工介入

## 快速开始

### 1. 安装

```bash
# 复制 skill 到你的项目
cp -r skills/task-retry ./your-project/
```

### 2. 引入模块

```typescript
import {
  classifyError,
  generateErrorFingerprint,
  getRetryPolicy,
  isErrorRetryable,
  requiresFixBeforeRetry,
} from "./task-retry/error-classifier.js";

import {
  recordTaskFailure,
  shouldRetry,
  clearTaskState,
  MAX_CONSECUTIVE_SAME_ERROR,
  MAX_TOTAL_FAILURES,
} from "./task-retry/task-retry-state.js";
```

### 3. 基本使用

```typescript
// 1. 任务失败时，分类错误类型
const errorType = classifyError(errorMessage);

// 2. 检查是否可重试
if (!isErrorRetryable(errorType)) {
  console.log("此错误不适合重试");
  return;
}

// 3. 记录失败
const state = recordTaskFailure(taskId, taskDescription, errorMessage, errorType);

// 4. 检查重试限制
const { allowed, reason } = shouldRetry(taskId);
if (!allowed) {
  console.log("达到重试限制，需要人工介入");
  // 返回 forceHumanReport: true
  return;
}

// 5. 如果需要修复，先修复再重试
if (requiresFixBeforeRetry(errorType)) {
  await fixError(errorType);
}

// 6. 重试任务
await retryTask();

// 7. 成功后清除状态
clearTaskState(taskId);
```

## 错误类型

| 类型           | 说明       | 可重试 | 需修复 |
| -------------- | ---------- | ------ | ------ |
| authentication | 认证失败   | ✓      | ✓      |
| network        | 网络问题   | ✓      | ✗      |
| permission     | 权限不足   | ✓      | ✓      |
| dependency     | 依赖缺失   | ✓      | ✓      |
| not_found      | 资源不存在 | ✗      | ✗      |
| timeout        | 操作超时   | ✓      | ✗      |
| rate_limit     | 频率限制   | ✓      | ✗      |
| unknown        | 未知错误   | ✓      | ✗      |

## API 参考

### error-classifier.ts

```typescript
// 归一化错误消息（去除动态内容）
normalizeErrorMessage(errorMessage: string): string

// 分类错误类型
classifyError(errorMessage: string): ErrorType

// 生成错误指纹
generateErrorFingerprint(errorType: ErrorType, errorMessage: string): string

// 获取重试策略
getRetryPolicy(errorType: ErrorType): RetryPolicy
isErrorRetryable(errorType: ErrorType): boolean
requiresFixBeforeRetry(errorType: ErrorType): boolean
```

### task-retry-state.ts

```typescript
// 常量
MAX_CONSECUTIVE_SAME_ERROR = 3
MAX_TOTAL_FAILURES = 5

// 记录任务失败
recordTaskFailure(
  taskId: string,
  taskDescription: string,
  errorMessage: string,
  errorType: ErrorType
): TaskRetryState

// 获取任务重试状态
getTaskRetryState(taskId: string): TaskRetryState | null

// 检查是否应该重试
shouldRetry(taskId: string): { allowed: boolean; reason: string }

// 成功后清除状态
clearTaskState(taskId: string): void

// 获取重试统计
getRetryStats(): { totalTrackedTasks: number, atRetryLimit: number, canRetry: number }

// 重试组功能（可选）
createRetryGroupId(): string
recordTaskFailureWithGroup(...): TaskRetryState
shouldRetryByGroup(retryGroupId: string): { allowed: boolean; reason: string }
```

## 集成示例

### 在 Agent 任务执行中集成

```typescript
async function executeWithRetry(taskId: string, task: string, executeFn: () => Promise<any>) {
  let attempts = 0;
  const maxAttempts = MAX_TOTAL_FAILURES;

  while (attempts < maxAttempts) {
    try {
      const result = await executeFn();
      clearTaskState(taskId);
      return result;
    } catch (error) {
      attempts++;
      const errorType = classifyError(error.message);
      const state = recordTaskFailure(taskId, task, error.message, errorType);
      const { allowed } = shouldRetry(taskId);

      if (!allowed) {
        return {
          error: error.message,
          errorType,
          retryInfo: {
            reason: "达到重试限制",
            forceHumanReport: true,
            ...state,
          },
        };
      }

      if (requiresFixBeforeRetry(errorType)) {
        await fixError(errorType);
      }
    }
  }
}
```

### 在 MCP/工具中集成

```typescript
const tool = {
  name: "execute_task",
  async execute(params) {
    const { taskId, task } = params;

    // 执行任务
    const result = await runTask(task);

    // 检查结果
    if (result.status === "error") {
      const errorType = classifyError(result.error);
      const state = recordTaskFailure(taskId, task, result.error, errorType);
      const { allowed, reason } = shouldRetry(taskId);

      return {
        ...result,
        errorType,
        retryInfo: {
          allowed,
          reason,
          forceHumanReport: !allowed,
          ...state,
        },
      };
    }

    clearTaskState(taskId);
    return result;
  },
};
```

## 错误指纹机制

错误消息在生成指纹前会进行归一化处理，去除以下动态内容：

- 时间戳 (ISO、Unix、常见日期格式)
- UUID 和 Request ID
- Session ID
- 临时路径
- 端口号
- 进程 ID
- 内存地址

示例：

```
原始: "Error: connect ECONNREFUSED 127.0.0.1:3000 at 2024-01-15T10:30:00.000Z"
归一化: "error: connect econnrefused 127.0.0.1:<port> at <timestamp>"
```

## 配置

### 修改限制值

```typescript
// 在 task-retry-state.ts 中修改常量
export const MAX_CONSECUTIVE_SAME_ERROR = 3; // 连续同样错误次数
export const MAX_TOTAL_FAILURES = 5; // 累计失败次数
```

### 添加自定义错误类型

```typescript
// 在 error-classifier.ts 中添加
export type ErrorType =
  | "authentication"
  | "network"
  // ... 现有类型
  | "custom_type"; // 添加新类型

// 在 classifyError 中添加分类逻辑
if (lowerMessage.includes("your_keyword")) {
  return "custom_type";
}

// 在 RETRY_POLICIES 中添加策略
export const RETRY_POLICIES: Record<ErrorType, RetryPolicy> = {
  // ... 现有策略
  custom_type: {
    retryable: true,
    requiresFixBeforeRetry: false,
    description: "自定义错误类型",
  },
};
```

## 测试

运行内置测试：

```bash
bun test-retry.ts
```

## 文件结构

```
skills/task-retry/
├── SKILL.md                    # 本文件
├── error-classifier.ts         # 错误分类与指纹
└── task-retry-state.ts         # 重试状态管理
```

## 相关文档

- 完整实现文档: `docs/retry-mechanism.md`
