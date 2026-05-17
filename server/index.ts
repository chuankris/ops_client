import cors from "cors";
import express from "express";
import { getAdapter } from "./adapters";
import { repository } from "./repository";
import { startSubscription, stopSubscription, streamSubscription } from "./subscriptions";
import type { ConnectionProfile, SendRequest } from "./types";

const app = express();
const port = Number(process.env.OPS_CLIENT_API_PORT ?? 4317);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ code: "0", data: { status: "ok" } });
});

app.get("/api/connections", (_req, res) => {
  res.json({ code: "0", data: repository.listConnections() });
});

app.post("/api/connections", (req, res) => {
  const profile = req.body as ConnectionProfile;
  if (!profile?.id || !profile?.kind || !profile.host || !profile.port) {
    res.status(400).json({ code: "400", msg: "id/kind/host/port required" });
    return;
  }
  repository.upsertConnection(profile);
  res.json({ code: "0", data: { id: profile.id } });
});

app.delete("/api/connections/:id", (req, res) => {
  const removed = repository.removeConnection(req.params.id);
  if (!removed) {
    res.status(404).json({ code: "404", msg: "connection not found" });
    return;
  }
  res.json({ code: "0", data: { id: req.params.id } });
});

app.post("/api/connections/test", async (req, res) => {
  const profile = req.body as ConnectionProfile;
  if (!profile?.kind || !profile.host || !profile.port) {
    res.status(400).json({ code: "400", msg: "kind、host、port 必填" });
    return;
  }
  const adapter = getAdapter(profile.kind);
  const result = await adapter.testConnection(profile);
  res.json({ code: "0", data: result });
});

app.get("/api/resources", async (req, res) => {
  const connectionId = String(req.query.connectionId ?? "");
  const keyword = String(req.query.keyword ?? "");
  if (!connectionId) {
    res.status(400).json({ code: "400", msg: "connectionId 必填" });
    return;
  }

  const connection = repository.getConnection(connectionId);
  if (!connection) {
    res.status(404).json({ code: "404", msg: "连接不存在" });
    return;
  }

  try {
    const adapter = getAdapter(connection.kind);
    const data = await adapter.listResources(connection, keyword);
    res.json({ code: "0", data });
  } catch (error) {
    res.status(500).json({ code: "500", msg: error instanceof Error ? error.message : "加载资源失败" });
  }
});

app.get("/api/messages", (_req, res) => {
  res.json({ code: "0", data: repository.listMessages() });
});

app.post("/api/messages/send", async (req, res) => {
  const request = req.body as SendRequest & { connectionId?: string };
  if (!request.connectionId) {
    res.status(400).json({ code: "400", msg: "connectionId 必填" });
    return;
  }

  const connection = repository.getConnection(request.connectionId);
  if (!connection) {
    res.status(404).json({ code: "404", msg: "连接不存在" });
    return;
  }
  if (!request.protocol || !request.target || !request.body) {
    res.status(400).json({ code: "400", msg: "protocol、target、body 必填" });
    return;
  }

  try {
    const adapter = getAdapter(connection.kind);
    const result = await adapter.send(connection, request);
    res.json({ code: "0", data: result });
  } catch (error) {
    res.status(500).json({ code: "500", msg: error instanceof Error ? error.message : "发送失败" });
  }
});

app.post("/api/subscriptions", (req, res) => {
  const { connectionId, source } = req.body ?? {};
  if (!connectionId) {
    res.status(400).json({ code: "400", msg: "connectionId 必填" });
    return;
  }
  if (!source) {
    res.status(400).json({ code: "400", msg: "source 必填" });
    return;
  }
  try {
    res.json({ code: "0", data: startSubscription(connectionId, source) });
  } catch (error) {
    res.status(404).json({ code: "404", msg: error instanceof Error ? error.message : "订阅失败" });
  }
});

app.delete("/api/subscriptions/:id", (req, res) => {
  res.json({ code: "0", data: stopSubscription(req.params.id) });
});

app.get("/api/subscriptions/:id/stream", (req, res) => {
  streamSubscription(req.params.id, res);
});

app.listen(port, "127.0.0.1", () => {
  console.log(`ops-client local api listening on http://127.0.0.1:${port}`);
});
