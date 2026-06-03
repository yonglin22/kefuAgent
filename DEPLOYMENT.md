# 电商客服 Agent 部署上线指南（交付 Codex）

> 本文档用于将 `customer-service-agent` 项目**真实部署上线**，可直接交付 Codex 或运维团队执行。

---

## 一、部署架构

```
用户（App/Web/小程序）
    ↓ HTTPS (443)
Nginx（反向代理 + SSL 终止）
    ↓
Node.js (server.js) — 运行在 0.0.0.0:3000
    ↓
├── DeepSeek API（https://api.deepseek.com）
├── MySQL 8.0（对话记录、用户数据）
└── Redis 7（会话缓存、限流）
```

---

## 二、服务器环境要求

| 组件 | 版本 | 说明 |
|------|------|------|
| OS | Ubuntu 22.04 LTS | 推荐 |
| Node.js | v18+ | `apt install nodejs npm` |
| MySQL | 8.0+ | `apt install mysql-server` |
| Redis | 7.0+ | `apt install redis-server` |
| Nginx | 1.24+ | `apt install nginx` |
| pm2 | latest | `npm install -g pm2` |

---

## 三、服务器部署步骤

### 3.1 上传代码

```bash
# 将 customer-service-agent.tar.gz 上传到服务器
scp customer-service-agent.tar.gz user@your-server:/opt/

# 解压
cd /opt/
tar -xzf customer-service-agent.tar.gz
cd customer-service-agent
```

### 3.2 安装依赖

```bash
npm install --production
```

### 3.3 创建环境变量文件

```bash
cat > .env << 'EOF'
# 服务配置
PORT=3000
NODE_ENV=production

# DeepSeek LLM 配置
DEEPSEEK_API_KEY=__YOUR_DEEPSEEK_API_KEY__
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat

# 数据库配置（替换为真实数据库）
DB_HOST=localhost
DB_PORT=3306
DB_USER=cs_agent
DB_PASS=__YOUR_DB_PASSWORD__
DB_NAME=cs_agent_db

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASS=__YOUR_REDIS_PASSWORD__

# 护栏配置
MAX_AUTO_REFUND=50
FORCE_HUMAN_REFUND=200
MAX_CONVERSATION_ROUNDS=10
EOF
```

### 3.4 初始化数据库

```bash
mysql -u root -p < schema.sql
```
（schema.sql 见下一节）

### 3.5 用 pm2 启动服务

```bash
# 启动（命名为 cs-agent）
pm2 start server.js --name cs-agent

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status
pm2 logs cs-agent
```

---

## 四、数据库建表 SQL（schema.sql）

```sql
CREATE DATABASE IF NOT EXISTS `cs_agent_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `cs_agent_db`;

-- 用户表
CREATE TABLE `users` (
  `user_id` VARCHAR(64) PRIMARY KEY,
  `phone` VARCHAR(20) UNIQUE,
  `nickname` VARCHAR(64),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 会话表
CREATE TABLE `sessions` (
  `session_id` VARCHAR(128) PRIMARY KEY,
  `user_id` VARCHAR(64) NOT NULL,
  `status` ENUM('active','closed','escalated') DEFAULT 'active',
  `round_count` INT DEFAULT 0,
  `unresolved_count` INT DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 消息表
CREATE TABLE `messages` (
  `message_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(128) NOT NULL,
  `role` ENUM('user','assistant','system','tool') NOT NULL,
  `content` TEXT NOT NULL,
  `intent` VARCHAR(64),
  `latency_ms` INT,
  `token_usage` INT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_session_id` (`session_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 人工工单表
CREATE TABLE `tickets` (
  `ticket_id` VARCHAR(32) PRIMARY KEY,
  `session_id` VARCHAR(128) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `reason` TEXT NOT NULL,
  `conversation_summary` TEXT,
  `priority` ENUM('low','normal','high','urgent') DEFAULT 'normal',
  `status` ENUM('pending','processing','resolved') DEFAULT 'pending',
  `agent_id` VARCHAR(64),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 五、Nginx 配置（/etc/nginx/sites-available/cs-agent）

```nginx
server {
    listen 80;
    server_name cs-agent.yourdomain.com;  # 替换为真实域名

    # 强制 HTTPS（可选，有证书时开启）
    # return 301 https://$host$request_uri;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        # 超时设置
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
```

```bash
# 启用配置
ln -s /etc/nginx/sites-available/cs-agent /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

---

## 六、验证部署

```bash
# 1. 健康检查
curl http://localhost:3000/api/health

# 2. 测试聊天接口
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"我的订单到哪了？","sessionId":"test_001","userId":"user_001"}'

# 3. 查看 pm2 日志
pm2 logs cs-agent --lines 50
```

---

## 七、Codex 交付清单

### 7.1 代码文件（已打包）

| 文件 | 说明 |
|------|------|
| `server.js` | Node.js 后端主文件（含 DeepSeek LLM 集成） |
| `public/index.html` | 前端 UI（单页应用，可直接打开） |
| `package.json` | 依赖配置 |
| `.env.example` | 环境变量示例（需复制为 .env 并填写真实值） |
| `schema.sql` | 数据库建表 SQL |

### 7.2 飞书文档

| 文档 | 链接 |
|------|------|
| 电商客服 Agent 知识库 v1.0 | https://www.feishu.cn/docx/BR7Sd9RpWoBWfGxFapRcLUKPn9g |
| **可部署 PRD v1.1（含接口/数据表/组件树/状态机）** | https://www.feishu.cn/docx/BjUAdAdceo0Yqdx2MSnckJd2n9f |
| 本部署指南（上线用） | 本文档 |

### 7.3 在线 Demo

| 地址 | 说明 |
|------|------|
| https://cs-agent-demo.localtunnel.me | 公网 Demo（localtunnel，仅测试用） |
| 待填写 | 生产环境地址（部署后填写） |

---

## 八、常见问题排查

| 问题 | 排查命令 |
|------|---------|
| 服务无法启动 | `pm2 logs cs-agent` 查看错误日志 |
| 端口被占用 | `lsof -i:3000` 查看占用进程 |
| DeepSeek 调用失败 | 检查 `.env` 中的 `DEEPSEEK_API_KEY` 是否正确 |
| 数据库连不上 | `mysql -u cs_agent -p` 测试连接 |
| Nginx 502 错误 | `systemctl status nginx` + `pm2 status` |

---

*交付给 Codex / 运维团队，按步骤执行即可完成真实部署上线。*
