# KeleAgent

> 本地优先的 AI 智能体平台 — 持久记忆 · 飞书原生支持 · 技能自动创建 · 自配置能力

## 核心特性

- **持久记忆系统** — SQLite 存储，重启/隔天不忘事，跨天上下文自动恢复
- **飞书通道** — 原生支持飞书长连接 WebSocket，无需公网 IP
- **技能自动创建** — 从重复成功经验中自动生成可复用技能
- **自配置能力** — Agent 可通过工具调用修改自身配置
- **永不卡死** — 多层超时保护 + 循环检测 + 连续错误上限
- **记忆增强** — 三阶段梦境整合 (Light/Deep/REM) + 知识声明 + 记忆图
- **多模型支持** — OpenAI / Anthropic / Google / Ollama
- **轻量级架构** — 约 5000 行代码，易于理解和二次开发

## 快速开始

### 方式一：一键安装（推荐）

```bash
# 克隆仓库
git clone https://github.com/fengzhifengsu/fzfs.git
cd fzfs

# 一键安装
bash scripts/install.sh

# 交互式配置
kele configure

# 启动
kele start
```

### 方式二：手动安装

```bash
# 克隆仓库
git clone https://github.com/fengzhifengsu/fzfs.git
cd fzfs

# 安装依赖
npm install

# 编译
npm run build

# 复制配置文件
cp kele-agent.json ./kele-agent.json

# 编辑配置，填入 API Key
nano kele-agent.json

# 启动
npm start
```

## 环境要求

| 依赖 | 最低版本 |
|------|---------|
| Node.js | 18.0+ |
| npm | 9.0+ |
| OS | Ubuntu/Debian/CentOS/Arch |

## 配置文件

编辑 `kele-agent.json`：

```json
{
  "agent": {
    "name": "KeleAgent",
    "model": {
      "provider": "openai",
      "name": "gpt-4",
      "apiKey": "your-api-key",
      "baseUrl": ""
    },
    "systemPrompt": "You are KeleAgent, a helpful AI assistant.",
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1"
  },
  "channels": {
    "feishu": {
      "enabled": false,
      "appId": "",
      "appSecret": "",
      "verificationToken": "",
      "host": "open.feishu.cn",
      "requireMention": true
    },
    "telegram": { "enabled": false, "botToken": "" },
    "discord": { "enabled": false, "botToken": "", "clientId": "" },
    "slack": { "enabled": false, "botToken": "", "signingSecret": "" }
  },
  "memory": {
    "enabled": true,
    "dbPath": "./data/memory.db",
    "maxContextLength": 50
  },
  "automation": { "enabled": true },
  "browser": { "enabled": true, "headless": true },
  "logging": { "level": "info", "filePath": "./logs/kele-agent.log" }
}
```

## 命令行工具

安装后可使用 `kele` 命令：

```bash
kele start          # 启动 KeleAgent
kele stop           # 停止 KeleAgent
kele status         # 查看运行状态
kele restart        # 重启
kele log            # 查看实时日志
kele config         # 查看当前配置
kele configure      # 运行交互式配置向导
kele message "你好"  # 发送消息测试
```

## 使用指南

### 1. 启动服务

```bash
kele start
# 或
npm start
```

启动后会看到类似输出：
```
[INFO] Initializing KeleAgent...
[INFO] KeleAgent is fully operational
[INFO] Gateway: ws://127.0.0.1:18789/ws
[INFO] API: http://127.0.0.1:18789
```

### 2. 发送消息

```bash
# 通过 CLI 发送
kele message "你好，介绍一下你自己"

# 通过 API 发送
curl -X POST http://127.0.0.1:18789/message \
  -H "Content-Type: application/json" \
  -d '{"content": "你好", "channel": "web"}'

# 通过 WebSocket 发送
wscat -c ws://127.0.0.1:18789/ws
> {"type": "message", "content": "你好"}
```

### 3. 接入飞书

1. 在[飞书开放平台](https://open.feishu.cn)创建应用
2. 开启「机器人」能力
3. 订阅事件：`im.message.receive_v1`
4. 配置长连接模式（无需公网 IP）
5. 将 App ID、App Secret、Verification Token 填入配置：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxxxx",
      "appSecret": "xxxxx",
      "verificationToken": "xxxxx",
      "host": "open.feishu.cn",
      "requireMention": true
    }
  }
}
```

### 4. 接入 Ollama（本地模型）

```json
{
  "agent": {
    "model": {
      "provider": "ollama",
      "name": "llama3",
      "apiKey": "ollama",
      "baseUrl": "http://localhost:11434/v1"
    }
  }
}
```

## 目录结构

```
├── scripts/
│   ├── install.sh          # 一键安装脚本
│   └── configure.sh        # 交互式配置向导
├── src/
│   ├── agent/              # AI 智能体核心
│   ├── automation/         # Cron + Webhook 自动化
│   ├── channels/           # 聊天通道
│   │   └── feishu/         # 飞书通道
│   ├── cli/                # 命令行工具
│   ├── config/             # 配置系统
│   ├── gateway/            # 网关层 (WebSocket + HTTP)
│   ├── memory/             # 记忆系统
│   ├── skills/             # 技能系统
│   │   └── auto-creator/   # 技能自动创建
│   ├── tools/              # 工具集
│   └── utils/              # 工具函数
├── data/                   # 数据目录 (运行时创建)
│   ├── memory.db           # 基础记忆数据库
│   ├── enhanced-memory.db  # 增强记忆数据库
│   ├── sessions.db         # 会话数据库
│   └── experiences.json    # 经验记录
├── logs/                   # 日志目录 (运行时创建)
├── skills/                 # 技能工作区
├── kele-agent.json         # 配置文件
├── package.json
└── tsconfig.json
```

## 内置工具

| 工具 | 功能 |
|------|------|
| `file_operations` | 文件读写、目录列表、删除、移动、复制 |
| `terminal` | 执行 Shell 命令 |
| `web_search` | 网络搜索 (DuckDuckGo) |
| `web_fetch` | 抓取网页内容 |
| `browser` | 浏览器自动化 (Playwright) |
| `memory` | 存储/检索持久记忆 |
| `self_config` | Agent 自配置 |

## 记忆系统

### 三层记忆架构

| 层级 | 说明 | 持久化 |
|------|------|--------|
| **短期记忆** | 活跃记忆，带重要度/置信度/过期时间 | SQLite |
| **长期记忆** | 会话历史 + 摘要，重启自动恢复 | SQLite |
| **增强记忆** | 梦境整合 + 知识声明 + 记忆图 + 用户画像 | SQLite |

### 跨天记忆恢复

- 会话自动持久化到 SQLite
- 重启时自动从数据库加载历史
- 超长对话自动生成摘要
- 摘要自动注入到新对话的 system prompt

## 稳定性保障

| 保护机制 | 说明 |
|---------|------|
| API 超时 | 120 秒超时 + 最多 2 次重试 |
| 工具超时 | 每个工具 60 秒超时，超时自动终止 |
| 循环检测 | 相同工具+相同参数重复调用自动终止 |
| 错误上限 | 连续 3 次工具错误后自动停止 |
| 消息裁剪 | 超过 100KB 自动裁剪旧消息 |
| maxTokens | 上限 4096，防止响应过长 |
| 会话清理 | 30 天不活跃会话自动清理 |

## API 参考

### REST API

```
GET  /health           # 健康检查
GET  /status           # 运行状态
POST /message          # 发送消息
GET  /sessions         # 会话列表
DELETE /sessions/:id   # 删除会话
```

### WebSocket

连接地址：`ws://127.0.0.1:18789/ws`

消息格式：
```json
// 发送消息
{"type": "message", "content": "你好", "sessionId": "optional-id"}

// 流式消息
{"type": "stream", "content": "你好"}

// 心跳
{"type": "ping"}
```

响应格式：
```json
// 连接成功
{"type": "connected", "clientId": "xxx"}

// 回复
{"type": "response", "content": "你好！我是 KeleAgent", "sessionId": "xxx"}

// 流式响应
{"type": "stream_chunk", "content": "你好"}
{"type": "stream_end"}

// 心跳响应
{"type": "pong", "timestamp": 1234567890}
```

## 自动化

### Cron 定时任务

Agent 支持定时执行任务，配置保存在 `data/cron.json`：

```json
[
  {
    "name": "每日简报",
    "schedule": "0 9 * * *",
    "prompt": "生成今日简报",
    "enabled": true
  }
]
```

### Webhook

外部系统可通过 Webhook 触发 Agent：

```bash
curl -X POST http://127.0.0.1:18789/webhook/your-webhook-path \
  -H "Content-Type: application/json" \
  -d '{"data": "event data"}'
```

## 常见问题

### Q: 重启后会话会丢失吗？

不会。所有会话自动持久化到 SQLite，重启时自动恢复。

### Q: 对话太长会卡死吗？

不会。对话超过 50 条时会自动摘要，消息总量超过 100KB 会自动裁剪。

### Q: 如何使用本地模型？

配置 Ollama 即可，无需 API Key：

```json
{
  "agent": {
    "model": {
      "provider": "ollama",
      "name": "llama3",
      "baseUrl": "http://localhost:11434/v1"
    }
  }
}
```

### Q: 飞书机器人不回复消息？

检查：
1. 事件订阅是否包含 `im.message.receive_v1`
2. 长连接是否已开启
3. 机器人是否已添加到群聊中
4. 如设置 `requireMention: true`，需要 @机器人

### Q: 如何修改配置？

- 方式一：编辑 `kele-agent.json` 后重启
- 方式二：运行 `kele configure` 交互式配置
- 方式三：Agent 可通过 `self_config` 工具自修改配置

## 开源协议

MIT License
