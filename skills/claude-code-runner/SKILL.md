---
name: claude-code-runner
description: 使用 Claude Code 执行编程任务。当用户要求用 Claude Code (cc) 完成任务、代码审查、修复 bug、编写测试、重构等功能时使用此 skill。
metadata: { "openclaw": { "emoji": "🤖", "requires": { "anyBins": ["claude"] } } }
---

# Claude Code Runner

使用 Claude Code (cc) 在终端中执行编程和开发任务。

## 核心原则

1. **必须使用 pty:true** - Claude Code 是交互式终端应用，需要伪终端
2. **Git 仓库要求** - Claude Code 需要在 git 目录中运行
3. **工作目录** - 使用 workdir 指定项目目录

## 使用模式

### 快速任务（单次执行）

```bash
# 在指定目录执行任务
bash pty:true workdir:~/项目目录 command:"claude '你的任务描述'"

# 快速测试/审查
bash pty:true workdir:/home/ubuntu/.openclaw/workspace command:"claude '审查代码并给出建议'"
```

### 后台任务（长时间运行）

```bash
# 后台运行
bash pty:true workdir:~/project background:true command:"claude --yolo '完成复杂任务'"

# 监控进度
process action:log sessionId:XXX
process action:poll sessionId:XXX
```

### Claude Code 常用命令

| 命令                 | 说明                     |
| -------------------- | ------------------------ |
| `claude "任务"`      | 执行单次任务             |
| `claude --yolo`      | 无沙箱模式（危险但最快） |
| `claude --full-auto` | 沙箱模式但自动批准       |

## 执行流程

1. **解析任务** - 理解用户要 CC 完成什么
2. **初始化 git** - 如果目录不是 git 仓库，先执行 `git init`
3. **构建命令** - 组装完整的 claude 命令
4. **执行并监控** - 使用 pty 模式执行，必要时监控输出
5. **返回结果** - 任务完成后向用户汇报

## 注意事项

- Claude Code 需要登录认证 -长时间任务可能导致资源占用过高被系统终止
- 可在任务结束时添加系统事件通知：
  ```
  ... 任务完成后执行:
  openclaw system event --text "完成: xxx" --mode now
  ```

## 示例

```
用户: 让 CC 帮我审查 10秒通知的代码
执行: bash pty:true workdir:/home/ubuntu/.openclaw/workspace command:"claude '审查 docs/10秒未读提醒需求文档.md 中的技术方案，给出安全性和架构优化建议'"
```

---
