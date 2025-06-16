# 🤖 Telegram营销机器人

一个功能完整的Telegram营销机器人系统，支持商家绑定、预约管理、消息模板、触发词回复等功能。

## 📁 项目结构

```
xiaojidaniaoBOT/
├── admin/                    # 管理后台
│   ├── dashboard.html       # 现代化管理界面
│   ├── admin-legacy.html    # 旧版管理界面（备份）
│   ├── scripts/             # 前端脚本
│   │   ├── common.js        # 通用工具函数
│   │   └── dashboard.js     # 仪表盘逻辑
│   └── styles/              # 样式文件
│       ├── common.css       # 通用样式
│       └── dashboard.css    # 仪表盘样式
├── config/                  # 配置文件
│   └── database.js          # 数据库配置
├── data/                    # 数据存储
│   └── marketing_bot.db     # SQLite数据库
├── deployment/              # 部署相关
│   ├── ecosystem.config.js  # PM2配置
│   ├── start.sh            # Linux启动脚本
│   ├── quick-deploy.sh     # Linux一键部署
│   ├── quick-deploy.bat    # Windows一键部署
│   └── railway.json        # Railway部署配置
├── logs/                    # 日志文件
├── models/                  # 数据模型
│   └── databaseSchema.js    # 数据库架构
├── services/                # 业务服务
│   ├── appointment.js       # 预约服务
│   ├── merchantService.js   # 商家服务
│   ├── regionService.js     # 地区服务
│   └── bindCodeService.js   # 绑定码服务
├── utils/                   # 工具函数
│   └── initData.js          # 初始化数据
├── app.js                   # 主应用入口
├── package.json             # 项目依赖
└── env.example              # 环境变量示例
```

## 🚀 快速开始

### 1. 环境准备

- Node.js 16+ 
- npm 或 yarn
- Telegram Bot Token（从 @BotFather 获取）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制 `env.example` 为 `.env` 并填入你的配置：

```bash
cp env.example .env
```

编辑 `.env` 文件：
```
BOT_TOKEN=你的机器人令牌
PORT=3000
```

### 4. 启动应用

#### 开发模式
```bash
npm start
```

#### 生产模式（使用PM2）
```bash
cd deployment
pm2 start ecosystem.config.js
```

#### 一键部署
```bash
# Linux/Mac
cd deployment
./quick-deploy.sh

# Windows
cd deployment
quick-deploy.bat
```

## 📱 功能特性

### 核心功能
- ✅ 商家绑定系统
- ✅ 预约管理
- ✅ 消息模板管理
- ✅ 触发词自动回复
- ✅ 定时任务调度
- ✅ 按钮交互系统

### 管理后台
- 📊 数据统计仪表盘
- 👥 商家信息管理
- 🔑 绑定码管理
- 📍 地区配置
- 📝 消息模板编辑
- 🎯 触发词配置
- ⏰ 定时任务管理

### 数据管理
- 🗄️ SQLite数据库
- 📈 预约统计
- 💬 消息互动记录
- 🔘 按钮点击统计

## 🔧 配置说明

### 环境变量
- `BOT_TOKEN`: Telegram机器人令牌（必需）
- `PORT`: HTTP服务端口（默认3000）

### 数据库
项目使用SQLite数据库，文件位于 `data/marketing_bot.db`

### 管理后台
启动后访问：`http://localhost:3000/admin`

## 📝 更新日志

### v2.0.0 - 模块化重构
- 🔄 完全重构代码架构
- 📁 优化文件组织结构
- 🎨 现代化管理界面
- ⚡ 提升性能和稳定性
- 📊 增强数据统计功能

## 🤝 贡献

欢迎提交Issue和Pull Request来改进项目。

## �� 许可证

MIT License 