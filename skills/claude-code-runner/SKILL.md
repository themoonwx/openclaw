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
3. **构建命令** - 使用 `claude -p --permission-mode bypassPermissions`
4. **执行并监控** - 非交互模式执行
5. **等待完成** - 命令返回后读取结果
6. **返回结果** - 向用户汇报
7. **清理文件** - 删除临时文件

## 结果通知机制（自动唤醒）

配置Claude Code的SessionEnd Hook，在任务完成后自动：

1. 保存结果到 `~/.claude/results/latest.json`
2. 发送wake事件唤醒OpenClaw

### 配置步骤

#### 1. 创建Hook脚本

```bash
mkdir -p ~/.claude/hooks
```

创建 `~/.claude/hooks/notify-openclaw.sh`：

```bash
#!/bin/bash
INPUT_JSON=$(cat)
mkdir -p ~/.claude/results
echo "$INPUT_JSON" > ~/.claude/results/latest.json

TASK_RESULT=$(echo "$INPUT_JSON" | jq -r '.result // "unknown"' 2>/dev/null | head -c 200)

curl -s -X POST "http://127.0.0.1:18789/api/cron/wake" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"CC任务完成: ${TASK_RESULT}\", \"mode\": \"now\"}" \
  || true
exit 0
```

#### 2. 配置CC Hooks

在 `~/.claude/settings.json` 添加：

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/hooks/notify-openclaw.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

#### 3. 添加执行权限

```bash
chmod +x ~/.claude/hooks/notify-openclaw.sh
```

#### 4. 启用OpenClaw Hooks配置

在 `openclaw.json` 中添加：

```json
{
  "hooks": {}
}
```

#### 5. 重启Gateway

```bash
pkill -f "openclaw-gateway"
cd /home/ubuntu/openclaw && nohup node scripts/run-node.mjs gateway &
```

**备选方案**：如果Hook API不工作，可以：

1. 使用cron wake工具手动触发：`cron action:wake`
2. 或定期检查 `~/.claude/results/latest.json`

**注意**：CC需要重启才能加载新配置

## 执行步骤

1. **派发任务** - 添加结果文件写入指令
2. **监控状态** - 每分钟检查 cc_status 文件
3. **读取结果** - 状态为 "done" 时读取结果
4. **通知用户** - 向用户汇报完成情况
5. **清理文件** - 删除临时文件

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
执行: bash pty:true workdir:/home/ubuntu/.openclaw/workspace command:"claude '审查 docs/10秒未读提醒需求文档.md 中的技术方案，给出安全性和架构优化建议，完成后将完整结果写入 /tmp/cc_result.txt'"
```

**监控结果：**

- 每分钟检查进程是否存在
- 进程消失后读取 /tmp/cc_result.txt
- 向用户汇报结果

---
