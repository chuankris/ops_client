import "./styles.css";
import type { BrokerResource, ConnectionProfile, MessageRecord } from "./types";

type Page = "subscribe" | "send" | "history" | "database";
type PickerScope = "subscribe" | "send";
type BrokerKind = ConnectionProfile["kind"];

interface AppState {
  page: Page;
  activeConnectionId: string;
  selectedMessageId: string;
  selectedResource: string;
  sendProtocol: string;
  sendTarget: string;
  sendRoutingKey: string;
  sendBody: string;
  resourcePicker: PickerScope | null;
  resourceKeyword: string;
  connections: ConnectionProfile[];
  resources: BrokerResource[];
  messages: MessageRecord[];
  apiOnline: boolean;
  subscriptionStatus: string;
  sendResult: string;
  toast: string;
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

const STORAGE_CONNECTIONS = "ops-client.connections";

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
  page: "subscribe",
  activeConnectionId: "",
  selectedMessageId: "",
  selectedResource: "",
  sendProtocol: "rabbit-exchange",
  sendTarget: "",
  sendRoutingKey: "",
  sendBody: "",
  resourcePicker: null,
  resourceKeyword: "",
  connections: loadConnections(),
  resources: [],
  messages: [],
  apiOnline: false,
  subscriptionStatus: "未订阅",
  sendResult: "等待发送",
  toast: ""
};

let editingConnectionId = state.activeConnectionId || `conn-${Date.now()}`;
let currentSubscriptionId = "";
let subscriptionStream: EventSource | null = null;
let connectionDraft: ConnectionDraft = toDraft(activeConnection());

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root not found");
const root = app;

function loadConnections(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_CONNECTIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ConnectionProfile[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => !["rabbit-test", "kafka-pre", "amq-dev"].includes(item.id));
  } catch {
    return [];
  }
}

function persistConnections() {
  localStorage.setItem(STORAGE_CONNECTIONS, JSON.stringify(state.connections));
}

function fallbackConnection(): ConnectionProfile {
  return {
    id: state.activeConnectionId,
    name: connectionDraft.name || "未保存连接",
    kind: connectionDraft.kind,
    host: connectionDraft.host,
    port: connectionDraft.port,
    managementPort: connectionDraft.managementPort,
    vhost: connectionDraft.vhost,
    username: connectionDraft.username,
    password: connectionDraft.password,
    meta: metaForDraft(connectionDraft),
    connected: false
  };
}

function activeConnection(): ConnectionProfile {
  const current = state.connections.find(item => item.id === state.activeConnectionId);
  if (current) return current;
  if (state.activeConnectionId && editingConnectionId === state.activeConnectionId) {
    return fallbackConnection();
  }
  return (
    state.connections[0] ?? {
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
    }
  );
}

function selectedMessage(): MessageRecord {
  return state.messages.find(item => item.id === state.selectedMessageId) ?? state.messages[0] ?? EMPTY_MESSAGE;
}

function metaForDraft(draft: ConnectionDraft) {
  if (draft.kind === "RabbitMQ") return `vhost=${draft.vhost || "/"}`;
  if (draft.kind === "Kafka") return "SASL_SSL";
  return "queue/topic";
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

function filteredResources(): BrokerResource[] {
  const keyword = state.resourceKeyword.trim().toLowerCase();
  if (!keyword) return state.resources;
  return state.resources.filter(item => `${item.kind} ${item.broker} ${item.name}`.toLowerCase().includes(keyword));
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

function applyDraftToActive() {
  const payload: ConnectionProfile = {
    id: editingConnectionId,
    name: connectionDraft.name,
    kind: connectionDraft.kind,
    host: connectionDraft.host,
    port: connectionDraft.port,
    managementPort: connectionDraft.managementPort,
    vhost: connectionDraft.vhost,
    username: connectionDraft.username,
    password: connectionDraft.password,
    meta: metaForDraft(connectionDraft),
    connected: false
  };

  const index = state.connections.findIndex(item => item.id === editingConnectionId);
  if (index >= 0) {
    state.connections[index] = payload;
  } else {
    state.connections.unshift(payload);
  }
  state.activeConnectionId = editingConnectionId;
}

function closePicker() {
  state.resourcePicker = null;
  state.resourceKeyword = "";
}

function stopSubscriptionStream() {
  if (subscriptionStream) {
    subscriptionStream.close();
    subscriptionStream = null;
  }
  currentSubscriptionId = "";
}

function renderTabs() {
  const tabs: Array<[Page, string]> = [
    ["subscribe", "订阅台"],
    ["send", "消息发送"],
    ["history", "历史记录"],
    ["database", "数据库任务"]
  ];
  return tabs
    .map(
      ([page, label]) =>
        `<button class="tab ${state.page === page ? "active" : ""}" data-action="page" data-page="${page}">${label}</button>`
    )
    .join("");
}

function renderResourcePicker(scope: PickerScope, value: string, placeholder: string) {
  const open = state.resourcePicker === scope;
  const resources = filteredResources();
  return `
    <div class="resource-picker">
      <input
        class="resource-input"
        data-action="open-picker"
        data-scope="${scope}"
        value="${escapeHtml(value)}"
        placeholder="${placeholder}"
      />
      <button class="picker-trigger" data-action="open-picker" data-scope="${scope}" title="选择资源">...</button>
      <div class="resource-popover ${open ? "open" : ""}">
        <div class="popover-head">
          <input
            class="popover-search"
            data-action="search-resource"
            data-preserve-focus="resource-search"
            value="${escapeHtml(state.resourceKeyword)}"
            placeholder="搜索当前连接的资源"
          />
          <button class="btn ghost small" data-action="reload-resources">刷新</button>
        </div>
        <div class="resource-list">
          ${
            resources.length === 0
              ? `<div class="resource-option"><span class="path">暂无资源</span><span class="count">请先保存并测试连接</span></div>`
              : resources
                  .map(
                    item => `
              <div class="resource-option" data-action="pick-resource" data-scope="${scope}" data-name="${item.name}">
                <span class="type-pill">${item.kind}</span>
                <span class="path">${item.name}</span>
                <span class="count">${item.broker} | ${item.detail}</span>
              </div>
            `
                  )
                  .join("")
          }
        </div>
      </div>
    </div>
  `;
}

function renderConnectionPanel() {
  return `
    <aside class="panel">
      <div class="panel-head">
        <div class="panel-title">连接中心</div>
        <div class="panel-extra"><button class="btn small" data-action="new-connection">新建</button></div>
      </div>
      <div class="panel-body">
        <div class="field"><label>连接名称</label><input data-field="name" value="${escapeHtml(connectionDraft.name)}" /></div>
        <div class="field">
          <label>中间件类型</label>
          <select data-field="kind" data-preserve-focus="connection-kind">
            ${["RabbitMQ", "Kafka", "ActiveMQ"]
              .map(kind => `<option ${connectionDraft.kind === kind ? "selected" : ""}>${kind}</option>`)
              .join("")}
          </select>
        </div>
        <div class="inline">
          <div class="field"><label>主机</label><input data-field="host" value="${escapeHtml(connectionDraft.host)}" /></div>
          <div class="field"><label>端口</label><input data-field="port" value="${connectionDraft.port || ""}" /></div>
        </div>
        <div class="inline">
          <div class="field"><label>管理端口</label><input data-field="managementPort" value="${connectionDraft.managementPort || ""}" /></div>
          <div class="field"><label>Vhost</label><input data-field="vhost" value="${escapeHtml(connectionDraft.vhost || "")}" /></div>
        </div>
        <div class="inline">
          <div class="field"><label>用户名</label><input data-field="username" value="${escapeHtml(connectionDraft.username)}" /></div>
          <div class="field"><label>密码</label><input data-field="password" type="password" value="${escapeHtml(connectionDraft.password)}" /></div>
        </div>
        <div class="row">
          <button class="btn" data-action="test-connection">测试连接</button>
          <button class="btn ghost" data-action="save-connection">保存</button>
          <button class="btn soft" data-action="disconnect-connection">断开</button>
        </div>
        <div class="connection-list">
          ${state.connections
            .map(
              item => `
            <div class="connection-card ${item.id === state.activeConnectionId ? "active" : ""}" data-action="select-connection" data-id="${item.id}">
              <div class="card-name">${escapeHtml(item.name)}</div>
              <div class="card-meta">${item.kind} | ${escapeHtml(item.host)}:${item.port} | ${escapeHtml(item.meta)}</div>
              <div class="row">
                <button class="btn ghost small" data-action="connect-connection" data-id="${item.id}">连接</button>
                <button class="btn soft small" data-action="select-connection" data-id="${item.id}">编辑</button>
                <button class="btn soft small danger" data-action="delete-connection" data-id="${item.id}">删除</button>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
        <div class="field">
          <label>资源搜索</label>
          <input
            data-action="search-resource"
            data-preserve-focus="resource-search"
            value="${escapeHtml(state.resourceKeyword)}"
            placeholder="搜索 exchange/topic/queue"
          />
        </div>
        <div class="resource-tree">
          ${filteredResources()
            .map(
              item => `
            <div class="tree-item ${item.name === state.selectedResource ? "active" : ""}" data-action="select-resource" data-name="${item.name}">
              <span class="type-pill">${item.kind}</span>${escapeHtml(item.name)}
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderMessageRow(item: MessageRecord) {
  return `
    <tr class="${item.id === state.selectedMessageId ? "selected" : ""}" data-action="select-message" data-id="${item.id}">
      <td>${escapeHtml(item.time)}</td>
      <td>${escapeHtml(item.broker)}</td>
      <td>${escapeHtml(item.source)}</td>
      <td>${escapeHtml(item.key)}</td>
      <td>${escapeHtml(item.partition)}</td>
      <td>${escapeHtml(item.offset)}</td>
      <td>${escapeHtml(item.size)}</td>
      <td>${escapeHtml(item.status)}</td>
    </tr>
  `;
}

function renderSendTargetFields() {
  const picker = renderResourcePicker("send", state.sendTarget, "点击选择资源");
  if (state.sendProtocol === "rabbit-exchange") {
    return `
      <div class="field"><label>Exchange</label>${picker}</div>
      <div class="field"><label>RoutingKey</label><input data-action="update-routing-key" data-preserve-focus="send-routing-key" value="${escapeHtml(state.sendRoutingKey)}" /></div>
    `;
  }
  if (state.sendProtocol === "kafka-topic") {
    return `
      <div class="field"><label>Topic</label>${picker}</div>
      <div class="field"><label>Key</label><input value="" placeholder="可选" /></div>
      <div class="field"><label>Partition</label><input placeholder="可选" /></div>
    `;
  }
  if (state.sendProtocol === "activemq-topic") {
    return `
      <div class="field"><label>Topic</label>${picker}</div>
      <div class="field"><label>ClientId</label><input placeholder="可选" /></div>
    `;
  }
  return `
    <div class="field"><label>Queue</label>${picker}</div>
    <div class="field"><label>Delivery Mode</label><select><option>PERSISTENT</option><option>NON_PERSISTENT</option></select></div>
  `;
}

function renderSubscribePage() {
  const message = selectedMessage();
  return `
    <div class="layout-subscribe">
      ${renderConnectionPanel()}
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">订阅台</div>
          <div class="panel-extra"><span class="status"><span class="dot ${state.subscriptionStatus === "消费中" ? "ok" : "warn"}"></span>${escapeHtml(state.subscriptionStatus)}</span></div>
        </div>
        <div class="panel-body">
          <div class="toolbar">
            <select><option>资源类型：全部</option><option>exchange</option><option>topic</option><option>queue</option></select>
            ${renderResourcePicker("subscribe", state.selectedResource, "点击选择 exchange/topic/queue")}
            <input placeholder="关键字 / JSONPath / Header 过滤" />
            <button class="btn" data-action="start-subscription">开始</button>
            <button class="btn ghost" data-action="pause-subscription">暂停</button>
            <button class="btn soft" data-action="clear-messages">清屏</button>
            <button class="btn warn">仅错误</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>时间</th><th>中间件</th><th>来源</th><th>Key/RoutingKey</th><th>分区</th><th>Offset</th><th>大小</th><th>状态</th></tr>
              </thead>
              <tbody>
                ${state.messages.map(item => renderMessageRow(item)).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <aside class="panel">
        <div class="panel-head">
          <div class="panel-title">消息详情</div>
          <div class="panel-extra"></div>
        </div>
        <div class="panel-body">
          <div class="segmented"><button class="active">Pretty JSON</button><button>Raw</button><button>Headers</button><button>元信息</button></div>
          <pre>${escapeHtml(message.payload || "")}</pre>
          <div class="meta-list">
            <div class="meta-line"><span>连接</span><b>${escapeHtml(activeConnection().name)}</b></div>
            <div class="meta-line"><span>来源</span><b>${escapeHtml(message.source)}</b></div>
            <div class="meta-line"><span>Key</span><b>${escapeHtml(message.key)}</b></div>
            <div class="meta-line"><span>MessageId</span><b>${escapeHtml(message.id)}</b></div>
          </div>
          <div class="field">
            <label>发送协议</label>
            <select data-action="change-send-protocol" data-preserve-focus="detail-send-protocol">
              <option value="rabbit-exchange" ${state.sendProtocol === "rabbit-exchange" ? "selected" : ""}>RabbitMQ：Exchange + RoutingKey</option>
              <option value="rabbit-queue" ${state.sendProtocol === "rabbit-queue" ? "selected" : ""}>RabbitMQ：Queue</option>
              <option value="kafka-topic" ${state.sendProtocol === "kafka-topic" ? "selected" : ""}>Kafka：Topic + Key</option>
              <option value="activemq-queue" ${state.sendProtocol === "activemq-queue" ? "selected" : ""}>ActiveMQ：Queue</option>
              <option value="activemq-topic" ${state.sendProtocol === "activemq-topic" ? "selected" : ""}>ActiveMQ：Topic</option>
            </select>
          </div>
          ${renderSendTargetFields()}
          <div class="row detail-actions">
            <button class="btn ghost">复制</button>
            <button class="btn ghost">导出</button>
            <button class="btn" data-action="send-from-detail">发送到目标</button>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function renderSendPage() {
  return `
    <div class="layout-send">
      <aside class="panel">
        <div class="panel-head"><div class="panel-title">发送目标</div></div>
        <div class="panel-body">
          <div class="field"><label>连接</label><select>${state.connections.map(item => `<option>${escapeHtml(item.name)}</option>`).join("")}</select></div>
          <div class="field">
            <label>发送协议</label>
            <select data-action="change-send-protocol" data-preserve-focus="page-send-protocol">
              <option value="rabbit-exchange" ${state.sendProtocol === "rabbit-exchange" ? "selected" : ""}>RabbitMQ：Exchange + RoutingKey</option>
              <option value="rabbit-queue" ${state.sendProtocol === "rabbit-queue" ? "selected" : ""}>RabbitMQ：Queue</option>
              <option value="kafka-topic" ${state.sendProtocol === "kafka-topic" ? "selected" : ""}>Kafka：Topic + Key</option>
              <option value="activemq-queue" ${state.sendProtocol === "activemq-queue" ? "selected" : ""}>ActiveMQ：Queue</option>
              <option value="activemq-topic" ${state.sendProtocol === "activemq-topic" ? "selected" : ""}>ActiveMQ：Topic</option>
            </select>
          </div>
          ${renderSendTargetFields()}
          <div class="hint">资源输入框点击后会展示当前连接已有的 exchange、topic 或 queue，支持搜索选择，也保留手工输入。</div>
          <div class="row"><button class="btn" data-action="send-message">发送</button><button class="btn ghost">测试发送</button><button class="btn soft">保存模板</button></div>
        </div>
      </aside>
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">消息体</div>
          <div class="panel-extra"><button class="btn ghost small">格式化</button><button class="btn ghost small">压缩</button><button class="btn soft small">从历史填充</button></div>
        </div>
        <div class="panel-body">
          <div class="segmented"><button class="active">JSON</button><button>Raw</button><button>文本</button></div>
          <textarea class="editor" data-action="update-send-body" data-preserve-focus="send-body">${escapeHtml(state.sendBody)}</textarea>
        </div>
      </section>
      <aside class="panel">
        <div class="panel-head"><div class="panel-title">Headers / Properties</div></div>
        <div class="panel-body">
          <div class="field"><label>contentType</label><input value="application/json" /></div>
          <div class="field"><label>messageId</label><input value="auto-generate" /></div>
          <div class="field"><label>correlationId</label><input placeholder="可选" /></div>
          <div class="field"><label>自定义 Header</label><textarea class="headers-editor">x-source: mq-tool
x-env: test</textarea></div>
          <div class="result-box">
            <div class="panel-head"><div class="panel-title">发送结果</div></div>
            <div class="panel-body">
              <div class="meta-line"><span>状态</span><b class="success">${escapeHtml(state.sendResult)}</b></div>
              <div class="meta-line"><span>目标</span><b>${escapeHtml(state.sendTarget)}</b></div>
              <div class="meta-line"><span>耗时</span><b>-</b></div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function renderHistoryPage() {
  return `
    <div class="layout-history">
      <aside class="panel">
        <div class="panel-head"><div class="panel-title">历史筛选</div></div>
        <div class="panel-body">
          <div class="field"><label>连接</label><select><option>全部连接</option>${state.connections.map(item => `<option>${escapeHtml(item.name)}</option>`).join("")}</select></div>
          <div class="field"><label>来源</label><input placeholder="topic / queue / exchange" /></div>
          <div class="field"><label>关键字</label><input placeholder="traceId / messageId / JSON字段" /></div>
          <div class="inline">
            <div class="field"><label>开始时间</label><input value="2026-05-13 00:00:00" /></div>
            <div class="field"><label>结束时间</label><input value="2026-05-13 23:59:59" /></div>
          </div>
          <div class="row"><button class="btn">查询</button><button class="btn ghost">导出</button><button class="btn soft">清理</button></div>
        </div>
      </aside>
      <section class="panel">
        <div class="panel-head"><div class="panel-title">历史消息</div></div>
        <div class="panel-body">
          <div class="table-wrap full">
            <table>
              <thead><tr><th>时间</th><th>中间件</th><th>来源</th><th>Key/RoutingKey</th><th>MessageId</th><th>大小</th><th>操作</th></tr></thead>
              <tbody>
                ${state.messages
                  .map(
                    item => `<tr data-action="select-message" data-id="${item.id}"><td>${escapeHtml(item.time)}</td><td>${escapeHtml(item.broker)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.key)}</td><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.size)}</td><td>回放</td></tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderDatabasePage() {
  return `
    <div class="layout-db">
      <aside class="panel">
        <div class="panel-head"><div class="panel-title">数据库连接</div></div>
        <div class="panel-body">
          <div class="field"><label>数据库类型</label><select><option>PostgreSQL</option><option>MySQL</option><option>Oracle</option></select></div>
          <div class="field"><label>JDBC URL</label><input value="jdbc:postgresql://10.19.158.37:5432/scas" /></div>
          <div class="inline">
            <div class="field"><label>用户名</label><input value="scas_user" /></div>
            <div class="field"><label>密码</label><input type="password" value="123456" /></div>
          </div>
          <div class="row"><button class="btn">测试连接</button><button class="btn ghost">保存</button></div>
        </div>
      </aside>
      <section class="panel">
        <div class="panel-head"><div class="panel-title">复制表任务（后续版本）</div></div>
        <div class="panel-body">
          <div class="empty">
            <div>
              <div class="empty-title">数据库能力作为二期模块预留</div>
              <div>目标是支持表结构复制、数据复制、字段映射、批量任务和执行日志。</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderPage() {
  if (state.page === "send") return renderSendPage();
  if (state.page === "history") return renderHistoryPage();
  if (state.page === "database") return renderDatabasePage();
  return renderSubscribePage();
}

function render() {
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  const preserveKey = active?.dataset?.preserveFocus;
  const preserveField = active?.dataset?.field;
  const cursor =
    active && "selectionStart" in active && typeof active.selectionStart === "number" ? active.selectionStart : null;

  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="brand">运维 MQ 客户端</div>
        <nav class="tabs">${renderTabs()}</nav>
        <div class="top-actions">
          <span class="status"><span class="dot ${state.apiOnline ? "ok" : "warn"}"></span>${escapeHtml(activeConnection().name)} | ${state.apiOnline ? "本地 API 在线" : "离线模式"}</span>
          <button class="btn ghost small">导入配置</button>
          <button class="btn ghost small">导出配置</button>
        </div>
      </header>
      <main class="workspace">${renderPage()}</main>
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
    return;
  }

  if (preserveField) {
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-field="${preserveField}"]`
    );
    input?.focus();
    if (input && "setSelectionRange" in input && cursor !== null) {
      (input as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(cursor, cursor);
    }
  }
}

async function reloadResources() {
  const connection = activeConnection();
  if (!connection.id || !connection.host || !connection.port) {
    state.resources = [];
    state.selectedResource = "";
    render();
    return;
  }

  try {
    const url = new URL("http://127.0.0.1:4317/api/resources");
    url.searchParams.set("connectionId", connection.id);
    if (state.resourceKeyword.trim()) {
      url.searchParams.set("keyword", state.resourceKeyword.trim());
    }
    const response = await fetch(url.toString());
    if (!response.ok) return;
    const payload = await response.json();
    state.resources = payload.data ?? [];
    state.selectedResource = state.resources[0]?.name ?? "";
    state.apiOnline = true;
    render();
  } catch {
    state.apiOnline = false;
    state.resources = [];
    state.selectedResource = "";
  }
}

async function saveConnection() {
  applyDraftToActive();
  persistConnections();
  const profile = activeConnection();
  try {
    await fetch("http://127.0.0.1:4317/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    });
  } catch {
    // Keep local save even when API is unavailable.
  }
  await reloadResources();
  setToast("连接配置已保存到本地");
}

async function testConnection() {
  applyDraftToActive();
  const profile = activeConnection();
  render();
  try {
    const response = await fetch("http://127.0.0.1:4317/api/connections/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    });
    const payload = await response.json();
    if (response.ok && payload?.data?.success) {
      state.apiOnline = true;
      setToast(`连接成功，耗时 ${payload.data.latencyMs} ms`);
    } else {
      setToast(`连接失败：${payload?.data?.message ?? payload?.msg ?? "未知错误"}`);
    }
  } catch {
    state.apiOnline = false;
    setToast("连接失败：本地 API 不可达");
  }
}

function disconnectConnection() {
  stopSubscriptionStream();
  state.subscriptionStatus = "未订阅";
  setToast("已断开（前端状态）");
}

async function deleteConnection(id: string) {
  if (!id) return;
  if (currentSubscriptionId && state.activeConnectionId === id) {
    await fetch(`http://127.0.0.1:4317/api/subscriptions/${currentSubscriptionId}`, { method: "DELETE" }).catch(() => undefined);
    stopSubscriptionStream();
  }

  state.connections = state.connections.filter(item => item.id !== id);
  persistConnections();

  try {
    await fetch(`http://127.0.0.1:4317/api/connections/${id}`, { method: "DELETE" });
  } catch {
    // Keep local delete even when API is unavailable.
  }

  if (state.activeConnectionId === id) {
    const next = state.connections[0];
    state.activeConnectionId = next?.id ?? "";
    editingConnectionId = state.activeConnectionId || `conn-${Date.now()}`;
    connectionDraft = toDraft(activeConnection());
    state.resources = [];
    state.messages = [];
    state.selectedResource = "";
    state.selectedMessageId = "";
    state.sendTarget = "";
    state.sendRoutingKey = "";
    if (next?.id) {
      await reloadResources();
    }
  }

  setToast("连接已删除");
}

async function startSubscription() {
  stopSubscriptionStream();
  state.subscriptionStatus = "启动中";
  render();
  try {
    const response = await fetch("http://127.0.0.1:4317/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: state.activeConnectionId, source: state.selectedResource })
    });
    if (!response.ok) {
      state.subscriptionStatus = "启动失败";
      state.apiOnline = false;
      return;
    }

    const payload = await response.json();
    currentSubscriptionId = payload?.data?.id ?? "";
    if (currentSubscriptionId) {
      subscriptionStream = new EventSource(`http://127.0.0.1:4317/api/subscriptions/${currentSubscriptionId}/stream`);
      subscriptionStream.addEventListener("message", event => {
        const record = JSON.parse((event as MessageEvent).data) as MessageRecord;
        state.messages.unshift(record);
        if (!state.selectedMessageId) {
          state.selectedMessageId = record.id;
        }
        render();
      });
      subscriptionStream.addEventListener("error", () => {
        state.subscriptionStatus = "订阅异常";
        render();
      });
    }
    state.subscriptionStatus = "消费中";
    state.apiOnline = true;
  } catch {
    state.subscriptionStatus = "未订阅";
    state.apiOnline = false;
  }
}

async function pauseSubscription() {
  if (currentSubscriptionId) {
    await fetch(`http://127.0.0.1:4317/api/subscriptions/${currentSubscriptionId}`, { method: "DELETE" }).catch(() => undefined);
  }
  stopSubscriptionStream();
  state.subscriptionStatus = "已暂停";
  setToast("订阅已暂停");
}

async function sendCurrentMessage() {
  if (!selectedMessage().id) {
    setToast("当前没有可发送的消息");
    return;
  }
  state.sendBody = selectedMessage().payload;
  try {
    const response = await fetch("http://127.0.0.1:4317/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectionId: state.activeConnectionId,
        protocol: state.sendProtocol,
        target: state.sendTarget,
        routingKey: state.sendRoutingKey,
        body: state.sendBody
      })
    });
    if (!response.ok) {
      setToast("发送失败");
      return;
    }
    const payload = await response.json();
    state.sendResult = `已发送：${payload.data.messageId}`;
    setToast("消息已发送");
  } catch {
    setToast("发送失败：本地 API 不可达");
  }
}

root.addEventListener("click", async event => {
  const target = event.target as HTMLElement;
  const actionTarget = target.closest<HTMLElement>("[data-action]");
  if (!actionTarget) {
    if (state.resourcePicker && !target.closest(".resource-picker")) {
      closePicker();
      render();
    }
    return;
  }

  const action = actionTarget.dataset.action;
  if (
    action === "change-send-protocol" ||
    action === "update-routing-key" ||
    action === "update-send-body" ||
    action === "search-resource"
  ) {
    return;
  }
  if (action === "page") {
    state.page = actionTarget.dataset.page as Page;
    closePicker();
  }
  if (action === "select-connection") {
    state.activeConnectionId = actionTarget.dataset.id ?? state.activeConnectionId;
    editingConnectionId = state.activeConnectionId;
    connectionDraft = toDraft(activeConnection());
    await reloadResources();
  }
  if (action === "connect-connection") {
    state.activeConnectionId = actionTarget.dataset.id ?? state.activeConnectionId;
    editingConnectionId = state.activeConnectionId;
    connectionDraft = toDraft(activeConnection());
    await testConnection();
    await reloadResources();
    return;
  }
  if (action === "delete-connection") {
    await deleteConnection(actionTarget.dataset.id ?? "");
    render();
    return;
  }
  if (action === "new-connection") {
    stopSubscriptionStream();
    closePicker();
    editingConnectionId = `conn-${Date.now()}`;
    state.activeConnectionId = editingConnectionId;
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
    state.resourceKeyword = "";
    state.selectedResource = "";
    state.selectedMessageId = "";
    state.sendTarget = "";
    state.sendRoutingKey = "";
    state.resources = [];
    state.messages = [];
    state.subscriptionStatus = "未订阅";
  }
  if (action === "select-message") {
    state.selectedMessageId = actionTarget.dataset.id ?? state.selectedMessageId;
  }
  if (action === "select-resource") {
    state.selectedResource = actionTarget.dataset.name ?? state.selectedResource;
  }
  if (action === "open-picker") {
    state.resourcePicker = actionTarget.dataset.scope as PickerScope;
    state.resourceKeyword = "";
  }
  if (action === "pick-resource") {
    const name = actionTarget.dataset.name ?? "";
    const scope = actionTarget.dataset.scope as PickerScope;
    if (scope === "send") state.sendTarget = name;
    if (scope === "subscribe") state.selectedResource = name;
    closePicker();
  }
  if (action === "test-connection") {
    await testConnection();
    return;
  }
  if (action === "save-connection") {
    await saveConnection();
    return;
  }
  if (action === "disconnect-connection") {
    disconnectConnection();
    return;
  }
  if (action === "reload-resources") {
    await reloadResources();
    return;
  }
  if (action === "start-subscription") {
    await startSubscription();
  }
  if (action === "pause-subscription") {
    await pauseSubscription();
    return;
  }
  if (action === "clear-messages") {
    state.messages = [];
    state.selectedMessageId = "";
    setToast("已清屏");
    return;
  }
  if (action === "send-from-detail") {
    await sendCurrentMessage();
    render();
    return;
  }
  if (action === "send-message") {
    state.sendResult = "发送中";
    render();
    try {
      const response = await fetch("http://127.0.0.1:4317/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: state.activeConnectionId,
          protocol: state.sendProtocol,
          target: state.sendTarget,
          routingKey: state.sendRoutingKey,
          body: state.sendBody
        })
      });
      const payload = await response.json();
      state.sendResult = response.ok ? `已发送：${payload.data.messageId}` : "发送失败";
      state.apiOnline = response.ok;
      if (!response.ok) {
        setToast(`发送失败：${payload.msg ?? "未知错误"}`);
      }
    } catch {
      state.sendResult = "发送失败";
      state.apiOnline = false;
      setToast("发送失败：本地 API 不可达");
    }
  }
  render();
});

root.addEventListener("input", event => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const action = target.dataset.action;
  const field = target.dataset.field as keyof ConnectionDraft | undefined;

  if (field) {
    if (field === "port" || field === "managementPort") {
      const num = Number(target.value);
      (connectionDraft as ConnectionDraft)[field] = Number.isFinite(num) ? num : 0;
    } else if (field === "kind") {
      connectionDraft.kind = target.value as BrokerKind;
    } else {
      (connectionDraft as ConnectionDraft)[field] = target.value;
    }
  }

  if (action === "search-resource") {
    state.resourceKeyword = target.value;
    render();
  }
  if (action === "update-send-body") {
    state.sendBody = target.value;
  }
  if (action === "update-routing-key") {
    state.sendRoutingKey = target.value;
  }
});

root.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (target.dataset.action === "change-send-protocol") {
    state.sendProtocol = target.value;
    state.sendTarget = "";
    state.sendRoutingKey = "";
    render();
  }
});

render();

async function loadFromApi() {
  try {
    const [healthRes, connectionsRes] = await Promise.all([
      fetch("http://127.0.0.1:4317/api/health"),
      fetch("http://127.0.0.1:4317/api/connections")
    ]);
    if (!healthRes.ok || !connectionsRes.ok) return;

    const connectionsPayload = await connectionsRes.json();
    state.connections = connectionsPayload.data ?? [];
    state.resources = [];
    state.messages = [];
    state.apiOnline = true;
    state.selectedMessageId = "";

    if (!state.connections.find(item => item.id === state.activeConnectionId)) {
      state.activeConnectionId = state.connections[0]?.id ?? "";
    }
    editingConnectionId = state.activeConnectionId || `conn-${Date.now()}`;
    connectionDraft = toDraft(activeConnection());
    await reloadResources();
    render();
  } catch {
    state.apiOnline = false;
    render();
  }
}

void loadFromApi();
