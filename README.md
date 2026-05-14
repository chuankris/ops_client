# 运维 MQ 客户端

这是一个面向 MQ 联调、排障和运维的小工具项目。

当前模块：

- 连接中心
- 订阅台
- 消息发送
- 历史记录
- 数据库任务占位

## 本地开发

```bash
npm install
```

同时启动前端和本地 API：

```bash
npm run dev:all
```

前端地址：

- `http://127.0.0.1:5173/`

本地 API 地址：

- `http://127.0.0.1:4317/`

## 分开启动

只启动本地 API：

```bash
npm run dev:api
```

只启动前端：

```bash
npm run dev
```

## 构建

```bash
npm run build
```
