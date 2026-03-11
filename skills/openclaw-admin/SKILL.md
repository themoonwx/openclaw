---
name: openclaw-admin
description: >-
  OpenClaw 多用户权限管理系统。管理多个平台的用户（钉钉、飞书、Telegram 等），
  配置权限级别，控制用户对服务器配置的修改权限。支持用户管理、权限管理、限流配置、群组配置等功能。
  权限控制需要同时满足：群开关开启 + 管理员ID存在 + 修改服务端配置开关开启。
---

# OpenClaw Admin - 多用户权限管理系统

## 功能概述

管理 OpenClaw 多用户权限的后台系统，支持多平台接入和精细化权限控制。

## 支持平台

- 钉钉 (DingTalk)
- 飞书 (Feishu)
- Telegram
- Discord
- Slack
- 企业微信 (WeCom)
- LINE

## 核心功能

### 1. 用户管理

| 操作 | 说明 |
|------|------|
| 添加用户 | 选择平台，填写凭证信息 |
| 编辑用户 | 修改用户资料和凭证 |
| 删除用户 | 移除用户及其配置 |
| 同步配置 | 自动将凭证同步到 OpenClaw Gateway |

### 2. 权限管理（按分类）

#### 💬 消息权限
| 权限 | 说明 |
|------|------|
| 发送消息 | 用户可以发送消息 |
| 接收消息 | 用户可以接收消息 |

#### 🤖 AI 能力
| 权限 | 说明 |
|------|------|
| 调用 Claude Code | 用户可以使用 AI 能力 |

#### ⚙️ 配置权限
| 权限 | 说明 |
|------|------|
| 修改服务端配置 | 用户可以修改 OpenClaw 配置（需同时开启群组配置） |

#### 📁 文件权限
| 权限 | 说明 |
|------|------|
| 上传文件 | 用户可以上传文件 |

#### 📋 日志权限
| 权限 | 说明 |
|------|------|
| 查看日志 | 用户可以查看操作日志 |

### 3. 限流配置

- 每日消息数限制
- 最大文件大小限制 (MB)
- 最大并发数

### 4. 群组配置

- 启用群组设置
- 配置管理员 ID（多个用逗号分隔）
- 权限控制开关

## 权限控制机制

修改服务端配置需要**同时满足**以下三个条件：

| 条件 | 说明 |
|------|------|
| 群开关开启 | 在"群组配置"中启用 |
| 有管理员 ID | 输入管理员的用户 ID |
| 修改配置开关开启 | 在"权限配置"中开启"修改服务端配置" |

只有满足以上条件，用户才能：
1. 修改 OpenClaw 配置
2. 查看敏感信息（API keys、tokens 等）
3. 执行命令

## 启动管理后台

```bash
cd /home/ubuntu/workspace/openclaw-admin/backend
node server.js
```

管理后台地址：http://localhost:3002

## 配置文件

权限配置存储在：`/home/ubuntu/.openclaw/permissions.json`

```json
{
  "groupSettings": {
    "enabled": true,
    "adminIds": "用户ID1,用户ID2",
    "modifyServerEnabled": true
  }
}
```

OpenClaw 配置：`/home/ubuntu/.openclaw/openclaw.json`

## 常见问题

### Q: 修改权限后需要重启 Gateway 吗？
A: 不需要。权限配置放在 `/home/ubuntu/.openclaw/permissions.json`，Gateway 会自动热加载。

### Q: 为什么非管理员也能修改配置？
A: 检查权限配置是否正确：
1. 群开关是否开启
2. 管理员 ID 是否正确
3. 修改配置开关是否开启

### Q: 权限不生效怎么办？
A: 检查日志：
```bash
tail -f /tmp/gateway.log | grep "权限"
```

## 注意事项

- 管理后台默认账号：admin
- 首次使用请修改默认密码
- 敏感操作会记录到日志
- 权限配置更改后即时生效

## 相关文件

- 后端: `/home/ubuntu/workspace/openclaw-admin/backend/server.js`
- 前端: `/home/ubuntu/workspace/openclaw-admin/frontend/index.html`
- 权限文件: `/home/ubuntu/.openclaw/permissions.json`
- Gateway 配置: `/home/ubuntu/.openclaw/openclaw.json`

## 遗留问题

1. exec 执行命令权限可能不生效（某些命令执行不通过标准接口）
2. 飞书长链接模式可能需要额外配置
3. sessionKey 提取依赖特定格式，不同平台可能不同
