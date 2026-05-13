import cors from "cors";
import express from "express";
import { connections, messages, resources } from "./mockData";

const app = express();
const port = Number(process.env.OPS_CLIENT_API_PORT ?? 4317);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ code: "0", data: { status: "ok" } });
});

app.get("/api/connections", (_req, res) => {
  res.json({ code: "0", data: connections });
});

app.post("/api/connections/test", (req, res) => {
  const { kind, host, port: brokerPort } = req.body ?? {};
  res.json({
    code: "0",
    data: {
      success: Boolean(kind && host && brokerPort),
      latencyMs: 36,
      message: "连接参数校验通过，真实连通性将在 MQ 适配器接入后执行"
    }
  });
});

app.get("/api/resources", (req, res) => {
  const keyword = String(req.query.keyword ?? "").toLowerCase();
  const broker = String(req.query.broker ?? "");
  const filtered = resources.filter(item => {
    const hitKeyword = !keyword || `${item.kind} ${item.broker} ${item.name}`.toLowerCase().includes(keyword);
    const hitBroker = !broker || item.broker === broker;
    return hitKeyword && hitBroker;
  });
  res.json({ code: "0", data: filtered });
});

app.get("/api/messages", (_req, res) => {
  res.json({ code: "0", data: messages });
});

app.post("/api/messages/send", (req, res) => {
  const { protocol, target, body } = req.body ?? {};
  if (!protocol || !target || !body) {
    res.status(400).json({ code: "400", msg: "protocol、target、body 必填" });
    return;
  }
  res.json({
    code: "0",
    data: {
      messageId: `local-${Date.now()}`,
      protocol,
      target,
      status: "SENT",
      latencyMs: 18
    }
  });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`ops-client local api listening on http://127.0.0.1:${port}`);
});
