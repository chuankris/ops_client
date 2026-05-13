# 运维 MQ 客户端设计文档

## 目标

做一个可打包安装的桌面客户端，帮助研发和运维连接 RabbitMQ、Kafka、ActiveMQ，完成消息订阅、消息查看、消息发送和历史回放。后续扩展数据库连接与表复制能力。

## 当前技术方向

- 当前版本：Vite + TypeScript 前端项目，先把交互和页面状态跑起来。
- 本地后端：当前使用 Node/Express 搭了一个轻量 API 骨架，用 Mock 数据模拟 MQ 能力。
- 客户端打包：后续推荐接 Tauri，复用当前前端构建产物。
- MQ/DB 内核：后续用 Java 或 Rust 后端封装 RabbitMQ、Kafka、ActiveMQ、数据库连接。
- 本地通信：前端通过本地 HTTP 调接口，实时消息通过 WebSocket 推送。
- 本地存储：SQLite 保存连接配置、历史消息和发送模板。

## 为什么需要本地后端

这个工具需要连接 MQ、保持订阅、推送实时消息、保存本地历史，后续还会连接数据库做表复制。浏览器前端不适合直接承担这些能力，所以需要一个随客户端一起启动的本地后端。它不一定部署到服务器，更像桌面客户端的内核。

当前后端先提供 Mock API：

- `GET /api/health`
- `GET /api/connections`
- `POST /api/connections/test`
- `GET /api/resources`
- `GET /api/messages`
- `POST /api/messages/send`

## 核心模块

### 连接中心

用于维护连接配置，支持 RabbitMQ、Kafka、ActiveMQ。连接信息包括主机、端口、用户名、密码、协议专属参数等。

### 订阅台

用于选择 exchange、topic 或 queue 后开始订阅消息。中间区域展示消息列表，右侧展示选中消息的完整详情，包括 JSON、Raw、Headers 和元信息。

### 资源选择

exchange/topic/queue 不只支持手工输入。用户点击资源输入框时，会出现当前连接下已存在资源的下拉面板。

交互规则：

- 点击输入框或下拉按钮后展示资源面板。
- 面板内展示当前连接已加载的 exchange、topic、queue。
- 支持关键字搜索过滤。
- 点击候选项后回填输入框。
- 保留手工输入能力，方便临时目标或未加载资源。
- 资源面板支持刷新，后续由后端重新拉取当前 MQ 资源。

### 消息发送

支持不同 MQ 类型的发送目标：

- RabbitMQ：Exchange + RoutingKey。
- RabbitMQ：直接 Queue。
- Kafka：Topic + Key，可选 Partition。
- ActiveMQ：Queue。
- ActiveMQ：Topic。

消息体支持 JSON、Raw、文本模式。支持格式化、压缩、从历史消息填充、保存模板。

### 历史记录

保存近期订阅到的消息和发送记录，支持按连接、来源、关键字、时间范围查询。历史消息可以回放到发送页。

### 数据库任务

二期能力，先预留入口。目标包括数据库连接、表结构复制、数据复制、字段映射、批量执行和执行日志。

## 当前交互稿

当前项目已经从单文件 HTML 升级为 Vite + TypeScript 项目：

- `src/main.ts`：页面渲染、状态管理、资源选择、页面切换。
- `src/data.ts`：Mock 连接、资源、消息数据。
- `src/styles.css`：页面样式。
- `index.html`：应用入口。

当前版本用于评审和前端交互验证，不包含真实 MQ 后端连接逻辑。

## 下一步实现边界

- 定义后端接口：连接测试、资源加载、开始订阅、停止订阅、发送消息。
- 接入 WebSocket：将真实订阅消息推到前端消息列表。
- 加入本地存储：保存连接配置、历史消息和发送模板。
