import "./styles.css";
import type { BrokerResource, ConnectionProfile, MessageRecord } from "./types";

type BrokerKind = ConnectionProfile["kind"];
type ResourceFilter = "all" | "queue" | "topic";
type SubscriptionStatus = "未订阅" | "连接中" | "接收中" | "已停止" | "异常";

interface AppState {
  activeConnectionId: string;
  selectedMessageId: string;
  selectedResource: string;
  resourceKeyword: string;
  resourceFilter: ResourceFilter;
  messageKeyword: string;
  sendTarget: string;
  sendBody: string;
  sendResult: string;
  toast: string;
  apiOnline: boolean;
  subscriptionStatus: SubscriptionStatus;
  connections: ConnectionProfile[];
  resources: BrokerResource[];
  messages: MessageRecord[];
}

interface ConnectionDraft {
  name: string;
  kind: BrokerKind;
  host: string;
  port: number;
  managementPort?: number;
  vhost?: string;
  username: string;
  password: string;
}

const API_BASE = "http://127.0.0.1:4317/api";
const STORAGE_CONNECTIONS = "ops-client.connections";

const EMPTY_CONNECTION: ConnectionProfile = {
  id: "",
  name: "未选择连接",
  kind: "RabbitMQ",
  host: "",
  port: 0,
  managementPort: 0,
  vhost: "",
  username: "",
  password: "",
  meta: "-",
  connected: false
};

const EMPTY_MESSAGE: MessageRecord = {
  id: "",
  time: "",
  broker: "RabbitMQ",
  source: "",
  key: "",
  partition: "",
  offset: "",
  size: "",
  status: "",
  payload: ""
};

const state: AppState = {
  activeConnectionId: "",
  selectedMessageId: "",
  selectedResource: "",
  resourceKeyword: "",
  resourceFilter: "all",
  messageKeyword: "",
  sendTarget: "",
  sendBody: "",
  sendResult: "等待发送",
  toast: "",
  apiOnline: false,
  subscriptionStatus: "未订阅",
  connections: loadConnections(),
  resources: [],
  messages: []
};

let editingConnectionId = state.activeConnectionId || `conn-${Date.now()}`;
let connectionDraft: ConnectionDraft = toDraft(activeConnection());
let subscriptionStream: EventSource | null = null;
let currentSubscriptionId = "";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root not found");
const root = app;

function loadConnections(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_CONNECTIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ConnectionProfile[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function persistConnections() {
  localStorage.setItem(STORAGE_CONNECTIONS, JSON.stringify(state.connections));
}

function activeConnection(): ConnectionProfile {
  return state.connections.find(item => item.id === state.activeConnectionId) ?? EMPTY_CONNECTION;
}

function selectedMessage(): MessageRecord {
  return state.messages.find(item => item.id === state.selectedMessageId) ?? EMPTY_MESSAGE;
}

function toDraft(profile: ConnectionProfile): ConnectionDraft {
  return {
    name: profile.name,
    kind: profile.kind,
    host: profile.host,
    port: profile.port,
    managementPort: profile.managementPort,
    vhost: profile.vhost,
    username: profile.username,
    password: profile.password
  };
}

function draftMeta(draft: ConnectionDraft) {
  if (draft.kind === "RabbitMQ") {
    return `vhost=${draft.vhost || "/"}`;
  }
  if (draft.kind === "Kafka") {
    return "topic";
  }
  return "queue/topic";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setToast(text: string) {
  state.toast = text;
  render();
  setTimeout(() => {
    if (state.toast === text) {
      state.toast = "";
      render();
    }
  }, 2200);
}

function connectionName() {
  const trimmed = connectionDraft.name.trim();
  if (trimmed) return trimmed;
  const host = connectionDraft.host.trim() || "new";
  return `${connectionDraft.kind}-${host}`;
}

function applyDraftToActive(): ConnectionProfile {
  const existing = state.connections.find(item => item.id === editingConnectionId);
  const payload: ConnectionProfile = {
    id: editingConnectionId,
    name: connectionName(),
    kind: connectionDraft.kind,
    host: connectionDraft.host.trim(),
    port: connectionDraft.port,
    managementPort: connectionDraft.managementPort,
    vhost: connectionDraft.vhost?.trim(),
    username: connectionDraft.username.trim(),
    password: connectionDraft.password,
    meta: draftMeta(connectionDraft),
    connected: existing?.connected ?? false
  };

  const index = state.connections.findIndex(item => item.id === editingConnectionId);
  if (index >= 0) {
    state.connections[index] = payload;
  } else {
    state.connections.unshift(payload);
  }

  state.activeConnectionId = payload.id;
  persistConnections();
  return payload;
}

function visibleResources() {
  const keyword = state.resourceKeyword.trim().toLowerCase();
  return state.resources.filter(item => {
    if (item.kind === "exchange") return false;
    if (state.resourceFilter !== "all" && item.kind !== state.resourceFilter) return false;
    if (!keyword) return true;
    return `${item.kind} ${item.name} ${item.detail}`.toLowerCase().includes(keyword);
  });
}

function visibleMessages() {
  const keyword = state.messageKeyword.trim().toLowerCase();
  if (!keyword) return state.messages;
  return state.messages.filter(item =>
    `${item.time} ${item.broker} ${item.source} ${item.key} ${item.status} ${item.payload}`.toLowerCase().includes(keyword)
  );
}

function subscriptionActionLabel() {
  return state.subscriptionStatus === "接收中" || state.subscriptionStatus === "连接中" ? "停止接收" : "开始接收";
}

function renderConnectionFields() {
  const extra =
    connectionDraft.kind === "RabbitMQ"
      ? `
        <div class="split-2">
          <div class="field">
            <label>Management</label>
            <input data-field="managementPort" value="${connectionDraft.managementPort || ""}" />
          </div>
          <div class="field">
            <label>Vhost</label>
            <input data-field="vhost" value="${escapeHtml(connectionDraft.vhost || "")}" />
          </div>
        </div>
      `
      : connectionDraft.kind === "ActiveMQ"
        ? `
          <div class="field">
            <label><span>管理端口</span><span>用于加载真实 queue / topic</span></label>
            <input data-field="managementPort" value="${connectionDraft.managementPort || ""}" />
          </div>
        `
      : "";

  return `
    <div class="field">
      <label><span>连接名称</span><span>${state.activeConnectionId === editingConnectionId ? "当前编辑" : "新建中"}</span></label>
      <input data-field="name" value="${escapeHtml(connectionDraft.name)}" />
    </div>
    <div class="field">
      <label><span>中间件类型</span><span>V1 统一入口</span></label>
      <select data-field="kind" data-preserve-focus="connection-kind">
        ${["RabbitMQ", "Kafka", "ActiveMQ"]
          .map(kind => `<option value="${kind}" ${connectionDraft.kind === kind ? "selected" : ""}>${kind}</option>`)
          .join("")}
      </select>
    </div>
    <div class="split-2">
      <div class="field">
        <label>Host</label>
        <input data-field="host" value="${escapeHtml(connectionDraft.host)}" />
      </div>
      <div class="field">
        <label>Port</label>
        <input data-field="port" value="${connectionDraft.port || ""}" />
      </div>
    </div>
    ${extra}
    <div class="split-2">
      <div class="field">
        <label>Username</label>
        <input data-field="username" value="${escapeHtml(connectionDraft.username)}" />
      </div>
      <div class="field">
        <label>Password</label>
        <input data-field="password" type="password" value="${escapeHtml(connectionDraft.password)}" />
      </div>
    </div>
  `;
}

function renderConnectionList() {
  if (state.connections.length === 0) {
    return `<div class="empty-card">还没有保存的连接。先填一条连接信息，再点“保存连接”。</div>`;
  }

  return state.connections
    .map(item => {
      const active = item.id === state.activeConnectionId ? "active" : "";
      const badge = item.connected ? "在线" : "未测试";
      return `
        <div class="connection-card ${active}">
          <div class="card-title">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="type-pill">${escapeHtml(item.kind)}</span>
            <span class="tiny-pill">${badge}</span>
          </div>
          <div class="subtle">${escapeHtml(item.host)}:${item.port} | ${escapeHtml(item.meta)}</div>
          <div class="stack card-actions">
            <button class="btn-ghost small" data-action="select-connection" data-id="${item.id}">编辑</button>
            <button class="btn-ghost small" data-action="use-connection" data-id="${item.id}">使用</button>
            <button class="btn-ghost small danger" data-action="delete-connection" data-id="${item.id}">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderResourceList() {
  const resources = visibleResources();
  if (!activeConnection().id) {
    return `<div class="empty-card">先保存并选择一条连接，再加载该连接下真实存在的 queue / topic。</div>`;
  }
  if (resources.length === 0) {
    return `<div class="empty-card">当前没有可展示的 queue / topic。可以先测试连接，再点“刷新资源”。</div>`;
  }

  return resources
    .map(item => {
      const active = item.name === state.selectedResource ? "active" : "";
      return `
        <button class="resource-card ${active}" data-action="select-resource" data-name="${escapeHtml(item.name)}">
          <span class="type-pill">${escapeHtml(item.kind)}</span>
          <span class="resource-name">${escapeHtml(item.name)}</span>
          <span class="resource-detail">${escapeHtml(item.detail)}</span>
        </button>
      `;
    })
    .join("");
}

function renderMessageTable() {
  const messages = visibleMessages();
  if (messages.length === 0) {
    return `
      <tbody>
        <tr>
          <td colspan="5" class="empty-row">还没有收到消息，或者当前过滤条件下没有命中结果。</td>
        </tr>
      </tbody>
    `;
  }

  return `
    <tbody>
      ${messages
        .map(
          item => `
            <tr class="${item.id === state.selectedMessageId ? "active" : ""}" data-action="select-message" data-id="${item.id}">
              <td>${escapeHtml(item.time)}</td>
              <td>${escapeHtml(item.source)}</td>
              <td>${escapeHtml(item.key || "-")}</td>
              <td>${escapeHtml(item.size)}</td>
              <td>${escapeHtml(item.status)}</td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;
}

function renderMessageDetail() {
  const message = selectedMessage();
  if (!message.id) {
    return `
      <div class="empty-detail">
        <h4>还没有选中消息</h4>
        <p>开始接收后，点击一条消息，这里再展示 payload、key 和快速发送。</p>
      </div>
    `;
  }

  return `
    <div class="stack" style="margin-bottom: 12px">
      <button class="btn-soft small" data-action="copy-message">复制消息</button>
      <button class="btn-ghost small" data-action="copy-key">复制 Key</button>
      <button class="btn-ghost small" data-action="use-message-body">带入发送区</button>
    </div>
    <pre class="code-block">${escapeHtml(message.payload)}</pre>
    <div class="meta-list">
      <div class="meta-line"><span>连接</span><strong>${escapeHtml(activeConnection().name)}</strong></div>
      <div class="meta-line"><span>来源</span><strong>${escapeHtml(message.source)}</strong></div>
      <div class="meta-line"><span>Key</span><strong>${escapeHtml(message.key || "-")}</strong></div>
      <div class="meta-line"><span>状态</span><strong>${escapeHtml(message.status)}</strong></div>
    </div>
  `;
}

function renderQuickSend() {
  return `
    <div class="send-card">
      <h4>快速发送</h4>
      <p>V1 只保留最简单的发送动作：选目标，填消息体，点发送。</p>
      <div class="field">
        <label><span>发送目标</span><span>可手填，也可沿用当前资源</span></label>
        <input
          data-action="update-send-target"
          data-preserve-focus="send-target"
          value="${escapeHtml(state.sendTarget)}"
          placeholder="queue 或 topic 名称"
        />
      </div>
      <div class="field">
        <label><span>消息体</span><span>不会前端造假数据</span></label>
        <textarea data-action="update-send-body" data-preserve-focus="send-body">${escapeHtml(state.sendBody)}</textarea>
      </div>
      <div class="stack">
        <button class="btn" data-action="send-message">发送</button>
        <button class="btn-ghost small" data-action="use-selected-resource">使用当前资源</button>
      </div>
      <div class="send-result">${escapeHtml(state.sendResult)}</div>
    </div>
  `;
}

function render() {
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  const preserveKey = active?.dataset?.preserveFocus;
  const cursor =
    active && "selectionStart" in active && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const resources = visibleResources();
  const messages = visibleMessages();

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <h1>MQ Test Tool</h1>
          <p>只做连接、收消息、查消息和简单发送。</p>
        </div>
        <div class="status-pill">
          <span class="status-dot ${state.apiOnline ? "ok" : ""}"></span>
          ${state.apiOnline ? "本地 API 在线" : "本地 API 离线"}
        </div>
        <div class="top-actions">
          <button class="btn-ghost small" data-action="new-connection">新建连接</button>
        </div>
      </header>

      <section class="hero">
        <div class="hero-card">
          <div class="hero-kicker">V1 Scope</div>
          <div class="hero-title">少一点协议细节，多一点联调效率。</div>
          <div class="hero-copy">
            左边只负责连接和真实资源，中间只负责接收和过滤，右边只负责详情和简单发送。没有前端 mock 数据，空就空着，只有接口真返回才展示。
          </div>
          <div class="hero-metrics">
            <div class="metric"><span>当前连接</span><strong>${escapeHtml(activeConnection().name)}</strong></div>
            <div class="metric"><span>资源数量</span><strong>${resources.length}</strong></div>
            <div class="metric"><span>接收状态</span><strong>${escapeHtml(state.subscriptionStatus)}</strong></div>
            <div class="metric"><span>消息命中</span><strong>${messages.length}</strong></div>
          </div>
        </div>
        <div class="hero-note">
          <h3>当前原则</h3>
          <p>Kafka、RabbitMQ、ActiveMQ 都只在连接和资源层面区分。发送区不展开复杂协议参数，接收区只关心你选中的 queue 或 topic，以及关键字过滤。</p>
        </div>
      </section>

      <main class="workspace">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>连接和资源</h3>
              <small>先连上，再拉真实资源</small>
            </div>
            <div class="panel-extra"><span class="tiny-pill">${escapeHtml(state.subscriptionStatus)}</span></div>
          </div>
          <div class="panel-body">
            ${renderConnectionFields()}
            <div class="stack section-actions">
              <button class="btn" data-action="test-connection">测试连接</button>
              <button class="btn-soft" data-action="save-connection">保存连接</button>
              <button class="btn-ghost" data-action="reload-resources">刷新资源</button>
            </div>

            <div class="section-title">已保存连接</div>
            <div class="connection-list">${renderConnectionList()}</div>

            <div class="section-title">当前连接资源</div>
            <div class="field">
              <label><span>资源搜索</span><span>只看 queue / topic</span></label>
              <input
                data-action="search-resource"
                data-preserve-focus="resource-search"
                value="${escapeHtml(state.resourceKeyword)}"
                placeholder="搜索当前连接下的资源"
              />
            </div>
            <div class="filter-pills">
              <button class="filter-pill ${state.resourceFilter === "all" ? "active" : ""}" data-action="set-resource-filter" data-filter="all">全部</button>
              <button class="filter-pill ${state.resourceFilter === "queue" ? "active" : ""}" data-action="set-resource-filter" data-filter="queue">Queue</button>
              <button class="filter-pill ${state.resourceFilter === "topic" ? "active" : ""}" data-action="set-resource-filter" data-filter="topic">Topic</button>
            </div>
            <div class="resource-list">${renderResourceList()}</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>消息接收和过滤</h3>
              <small>只过滤已经收到的消息</small>
            </div>
            <div class="panel-extra"><span class="tiny-pill">${escapeHtml(state.selectedResource || "未选择资源")}</span></div>
          </div>
          <div class="panel-body">
            <div class="toolbar">
              <select data-action="set-resource-filter" data-preserve-focus="resource-filter">
                <option value="all" ${state.resourceFilter === "all" ? "selected" : ""}>资源类型: 全部</option>
                <option value="queue" ${state.resourceFilter === "queue" ? "selected" : ""}>资源类型: Queue</option>
                <option value="topic" ${state.resourceFilter === "topic" ? "selected" : ""}>资源类型: Topic</option>
              </select>
              <input value="${escapeHtml(state.selectedResource)}" placeholder="从左侧选择资源" readonly />
              <input
                data-action="search-message"
                data-preserve-focus="message-search"
                value="${escapeHtml(state.messageKeyword)}"
                placeholder="关键字 / key / traceId"
              />
              <button class="btn" data-action="toggle-subscription">${subscriptionActionLabel()}</button>
              <button class="btn-ghost" data-action="clear-messages">清空消息</button>
            </div>

            <div class="filter-strip">
              <div class="filter-card"><b>当前连接</b>${escapeHtml(activeConnection().name)}</div>
              <div class="filter-card"><b>接收资源</b>${escapeHtml(state.selectedResource || "未选择")}</div>
              <div class="filter-card"><b>过滤条件</b>${escapeHtml(state.messageKeyword || "无")}</div>
            </div>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>来源</th>
                    <th>Key</th>
                    <th>大小</th>
                    <th>状态</th>
                  </tr>
                </thead>
                ${renderMessageTable()}
              </table>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>详情和简单发送</h3>
              <small>收到后能看，必要时能发</small>
            </div>
          </div>
          <div class="panel-body">
            ${renderMessageDetail()}
            ${renderQuickSend()}
          </div>
        </section>
      </main>

      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;

  if (preserveKey) {
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-preserve-focus="${preserveKey}"]`
    );
    input?.focus();
    if (input && "setSelectionRange" in input && cursor !== null) {
      (input as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(cursor, cursor);
    }
  }
}

async function saveConnectionToApi(profile: ConnectionProfile) {
  const response = await fetch(`${API_BASE}/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.msg ?? "保存连接失败");
  }
}

async function fetchMessages() {
  if (!state.apiOnline) return;
  try {
    const response = await fetch(`${API_BASE}/messages`);
    if (!response.ok) return;
    const payload = await response.json();
    state.messages = Array.isArray(payload.data) ? payload.data : [];
    if (!state.messages.find(item => item.id === state.selectedMessageId)) {
      state.selectedMessageId = state.messages[0]?.id ?? "";
    }
  } catch {
    // Ignore message refresh failures and keep current UI state.
  }
}

async function reloadResources() {
  const connection = activeConnection();
  if (!connection.id) {
    state.resources = [];
    state.selectedResource = "";
    render();
    return;
  }

  try {
    const url = new URL(`${API_BASE}/resources`);
    url.searchParams.set("connectionId", connection.id);
    if (state.resourceKeyword.trim()) {
      url.searchParams.set("keyword", state.resourceKeyword.trim());
    }

    const response = await fetch(url.toString());
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.msg ?? "加载资源失败");
    }

    state.resources = Array.isArray(payload.data) ? payload.data : [];
    const allowed = visibleResources();
    if (!allowed.find(item => item.name === state.selectedResource)) {
      state.selectedResource = allowed[0]?.name ?? "";
    }
    if (!state.sendTarget && state.selectedResource) {
      state.sendTarget = state.selectedResource;
    }
    state.apiOnline = true;
  } catch (error) {
    state.resources = [];
    state.selectedResource = "";
    state.apiOnline = false;
    setToast(error instanceof Error ? error.message : "加载资源失败");
  }

  render();
}

async function saveConnection() {
  const profile = applyDraftToActive();
  try {
    await saveConnectionToApi(profile);
    setToast("连接已保存");
  } catch (error) {
    setToast(error instanceof Error ? error.message : "保存连接失败");
  }
  render();
}

async function testConnection() {
  const profile = applyDraftToActive();
  render();

  try {
    const response = await fetch(`${API_BASE}/connections/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    });
    const payload = await response.json().catch(() => ({}));
    const current = state.connections.find(item => item.id === profile.id);
    if (response.ok && payload?.data?.success) {
      if (current) current.connected = true;
      await saveConnectionToApi(profile);
      state.apiOnline = true;
      persistConnections();
      setToast(`连接成功，耗时 ${payload.data.latencyMs} ms`);
      await reloadResources();
      return;
    }

    if (current) current.connected = false;
    persistConnections();
    setToast(`连接失败：${payload?.data?.message ?? payload?.msg ?? "未知错误"}`);
  } catch {
    state.apiOnline = false;
    setToast("连接失败：本地 API 不可达");
  }

  render();
}

async function deleteConnection(id: string) {
  if (!id) return;

  if (currentSubscriptionId && state.activeConnectionId === id) {
    await stopSubscription();
  }

  state.connections = state.connections.filter(item => item.id !== id);
  persistConnections();

  try {
    await fetch(`${API_BASE}/connections/${id}`, { method: "DELETE" });
  } catch {
    // Keep local state even when API delete fails.
  }

  if (state.activeConnectionId === id) {
    state.activeConnectionId = state.connections[0]?.id ?? "";
    editingConnectionId = state.activeConnectionId || `conn-${Date.now()}`;
    connectionDraft = toDraft(activeConnection());
    state.resources = [];
    state.selectedResource = "";
    state.sendTarget = "";
  }

  render();
  setToast("连接已删除");
}

function stopSubscriptionStream() {
  if (subscriptionStream) {
    subscriptionStream.close();
    subscriptionStream = null;
  }
  currentSubscriptionId = "";
}

async function startSubscription() {
  if (!state.activeConnectionId) {
    setToast("请先选择连接");
    return;
  }
  if (!state.selectedResource) {
    setToast("请先选择一个 queue 或 topic");
    return;
  }

  stopSubscriptionStream();
  state.subscriptionStatus = "连接中";
  render();

  try {
    const response = await fetch(`${API_BASE}/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: state.activeConnectionId, source: state.selectedResource })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.msg ?? "启动订阅失败");
    }

    currentSubscriptionId = payload?.data?.id ?? "";
    if (!currentSubscriptionId) {
      throw new Error("订阅启动失败");
    }

    subscriptionStream = new EventSource(`${API_BASE}/subscriptions/${currentSubscriptionId}/stream`);
    subscriptionStream.addEventListener("message", event => {
      const record = JSON.parse((event as MessageEvent).data) as MessageRecord;
      state.messages.unshift(record);
      state.selectedMessageId = state.selectedMessageId || record.id;
      render();
    });
    subscriptionStream.addEventListener("error", () => {
      state.subscriptionStatus = "异常";
      render();
    });

    state.subscriptionStatus = "接收中";
    state.apiOnline = true;
  } catch (error) {
    state.subscriptionStatus = "异常";
    setToast(error instanceof Error ? error.message : "启动订阅失败");
  }

  render();
}

async function stopSubscription() {
  if (currentSubscriptionId) {
    await fetch(`${API_BASE}/subscriptions/${currentSubscriptionId}`, { method: "DELETE" }).catch(() => undefined);
  }
  stopSubscriptionStream();
  state.subscriptionStatus = "已停止";
  render();
}

function inferSendProtocol(connection: ConnectionProfile, target: string) {
  if (connection.kind === "Kafka") return "kafka-topic";
  if (connection.kind === "ActiveMQ") {
    const resource = state.resources.find(item => item.name === target);
    return resource?.kind === "topic" ? "activemq-topic" : "activemq-queue";
  }
  return "rabbit-queue";
}

async function sendMessage() {
  const connection = activeConnection();
  if (!connection.id) {
    setToast("请先选择连接");
    return;
  }
  if (!state.sendTarget.trim()) {
    setToast("请先填写发送目标");
    return;
  }
  if (!state.sendBody.trim()) {
    setToast("请先填写消息体");
    return;
  }

  state.sendResult = "发送中";
  render();

  try {
    const response = await fetch(`${API_BASE}/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: connection.id,
        protocol: inferSendProtocol(connection, state.sendTarget.trim()),
        target: state.sendTarget.trim(),
        body: state.sendBody
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.msg ?? "发送失败");
    }

    state.sendResult = `已发送：${payload.data.messageId}`;
    setToast("消息已发送");
  } catch (error) {
    state.sendResult = "发送失败";
    setToast(error instanceof Error ? error.message : "发送失败");
  }

  render();
}

function copyText(text: string, successText: string) {
  void navigator.clipboard.writeText(text).then(
    () => setToast(successText),
    () => setToast("复制失败")
  );
}

root.addEventListener("click", async event => {
  const target = event.target as HTMLElement;
  const actionTarget = target.closest<HTMLElement>("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;

  if (action === "new-connection") {
    editingConnectionId = `conn-${Date.now()}`;
    connectionDraft = {
      name: "",
      kind: "RabbitMQ",
      host: "",
      port: 0,
      managementPort: 0,
      vhost: "",
      username: "",
      password: ""
    };
    render();
    return;
  }

  if (action === "select-connection" || action === "use-connection") {
    state.activeConnectionId = actionTarget.dataset.id ?? "";
    editingConnectionId = state.activeConnectionId;
    connectionDraft = toDraft(activeConnection());
    state.selectedResource = "";
    state.sendTarget = "";
    await reloadResources();
    await fetchMessages();
    render();
    return;
  }

  if (action === "delete-connection") {
    await deleteConnection(actionTarget.dataset.id ?? "");
    return;
  }

  if (action === "save-connection") {
    await saveConnection();
    return;
  }

  if (action === "test-connection") {
    await testConnection();
    return;
  }

  if (action === "reload-resources") {
    await reloadResources();
    return;
  }

  if (action === "set-resource-filter") {
    const filterTarget = actionTarget as HTMLButtonElement | HTMLSelectElement;
    state.resourceFilter = (filterTarget.dataset.filter ?? filterTarget.value) as ResourceFilter;
    render();
    return;
  }

  if (action === "select-resource") {
    state.selectedResource = actionTarget.dataset.name ?? "";
    if (!state.sendTarget) {
      state.sendTarget = state.selectedResource;
    }
    render();
    return;
  }

  if (action === "toggle-subscription") {
    if (state.subscriptionStatus === "接收中" || state.subscriptionStatus === "连接中") {
      await stopSubscription();
    } else {
      await startSubscription();
    }
    return;
  }

  if (action === "clear-messages") {
    state.messages = [];
    state.selectedMessageId = "";
    render();
    return;
  }

  if (action === "select-message") {
    state.selectedMessageId = actionTarget.dataset.id ?? "";
    render();
    return;
  }

  if (action === "copy-message") {
    copyText(selectedMessage().payload, "消息已复制");
    return;
  }

  if (action === "copy-key") {
    copyText(selectedMessage().key || "", "Key 已复制");
    return;
  }

  if (action === "use-message-body") {
    if (!selectedMessage().id) {
      setToast("当前没有可带入的消息");
      return;
    }
    state.sendBody = selectedMessage().payload;
    if (!state.sendTarget) {
      state.sendTarget = selectedMessage().source;
    }
    render();
    return;
  }

  if (action === "use-selected-resource") {
    if (state.selectedResource) {
      state.sendTarget = state.selectedResource;
      render();
    }
    return;
  }

  if (action === "send-message") {
    await sendMessage();
  }
});

root.addEventListener("input", event => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const field = target.dataset.field as keyof ConnectionDraft | undefined;
  const action = target.dataset.action;

  if (field) {
    if (field === "port" || field === "managementPort") {
      const next = Number(target.value);
      (connectionDraft as ConnectionDraft)[field] = Number.isFinite(next) ? next : 0;
    } else if (field === "kind") {
      connectionDraft.kind = target.value as BrokerKind;
      if (connectionDraft.kind === "Kafka") {
        connectionDraft.managementPort = 0;
        connectionDraft.vhost = "";
      }
    } else {
      (connectionDraft as ConnectionDraft)[field] = target.value;
    }
  }

  if (action === "search-resource") {
    state.resourceKeyword = target.value;
  }

  if (action === "search-message") {
    state.messageKeyword = target.value;
  }

  if (action === "update-send-target") {
    state.sendTarget = target.value;
  }

  if (action === "update-send-body") {
    state.sendBody = target.value;
  }

  render();
});

root.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (target.dataset.action === "set-resource-filter") {
    state.resourceFilter = target.value as ResourceFilter;
    render();
  }
});

async function syncStoredConnectionsToApi() {
  for (const connection of state.connections) {
    try {
      await saveConnectionToApi(connection);
    } catch {
      // Ignore sync errors for individual connections during boot.
    }
  }
}

async function loadApp() {
  if (state.connections.length > 0) {
    state.activeConnectionId = state.connections[0].id;
    editingConnectionId = state.activeConnectionId;
    connectionDraft = toDraft(activeConnection());
  }

  render();

  try {
    const healthRes = await fetch(`${API_BASE}/health`);
    if (!healthRes.ok) throw new Error("health check failed");
    state.apiOnline = true;

    await syncStoredConnectionsToApi();

    const connectionsRes = await fetch(`${API_BASE}/connections`);
    if (connectionsRes.ok) {
      const payload = await connectionsRes.json();
      state.connections = Array.isArray(payload.data) ? payload.data : state.connections;
      persistConnections();
      if (!state.connections.find(item => item.id === state.activeConnectionId)) {
        state.activeConnectionId = state.connections[0]?.id ?? "";
      }
      editingConnectionId = state.activeConnectionId || `conn-${Date.now()}`;
      connectionDraft = toDraft(activeConnection());
    }

    await reloadResources();
    await fetchMessages();
  } catch {
    state.apiOnline = false;
  }

  render();
}

void loadApp();
