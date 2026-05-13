import "./styles.css";
import { connections, messages, resources } from "./data";
import type { BrokerResource, MessageRecord } from "./types";

type Page = "subscribe" | "send" | "history" | "database";

interface AppState {
  page: Page;
  activeConnectionId: string;
  selectedMessageId: string;
  selectedResource: string;
  sendProtocol: string;
  sendTarget: string;
  sendBody: string;
  resourcePicker: null | "subscribe" | "send";
  resourceKeyword: string;
}

const state: AppState = {
  page: "subscribe",
  activeConnectionId: "rabbit-test",
  selectedMessageId: "msg-1",
  selectedResource: "pdms.topic.model.data.tb_fire_tool",
  sendProtocol: "rabbit-exchange",
  sendTarget: "amq.topic",
  sendBody: messages[0].payload,
  resourcePicker: null,
  resourceKeyword: ""
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const root = app;

function activeConnection() {
  return connections.find(item => item.id === state.activeConnectionId) ?? connections[0];
}

function selectedMessage() {
  return messages.find(item => item.id === state.selectedMessageId) ?? messages[0];
}

function filteredResources(): BrokerResource[] {
  const keyword = state.resourceKeyword.trim().toLowerCase();
  if (!keyword) return resources;
  return resources.filter(item => `${item.kind} ${item.broker} ${item.name}`.toLowerCase().includes(keyword));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTabs() {
  const tabs: Array<[Page, string]> = [
    ["subscribe", "订阅台"],
    ["send", "消息发送"],
    ["history", "历史记录"],
    ["database", "数据库任务"]
  ];

  return tabs.map(([page, label]) => `
    <button class="tab ${state.page === page ? "active" : ""}" data-action="page" data-page="${page}">${label}</button>
  `).join("");
}

function renderConnectionPanel() {
  const current = activeConnection();
  return `
    <aside class="panel">
      <div class="panel-head">
        <div class="panel-title">连接中心</div>
        <div class="panel-extra"><button class="btn small">新建</button></div>
      </div>
      <div class="panel-body">
        <div class="field"><label>连接名称</label><input value="${current.name}" /></div>
        <div class="field">
          <label>中间件类型</label>
          <select>
            <option>${current.kind}</option>
            <option>RabbitMQ</option>
            <option>Kafka</option>
            <option>ActiveMQ</option>
          </select>
        </div>
        <div class="inline">
          <div class="field"><label>主机</label><input value="${current.host}" /></div>
          <div class="field"><label>端口</label><input value="${current.port}" /></div>
        </div>
        <div class="inline">
          <div class="field"><label>用户名</label><input value="${current.username}" /></div>
          <div class="field"><label>密码</label><input type="password" value="${current.password}" /></div>
        </div>
        <div class="row">
          <button class="btn">测试连接</button>
          <button class="btn ghost">保存</button>
          <button class="btn soft">断开</button>
        </div>
        <div class="connection-list">
          ${connections.map(item => `
            <div class="connection-card ${item.id === current.id ? "active" : ""}" data-action="select-connection" data-id="${item.id}">
              <div class="card-name">${item.name}</div>
              <div class="card-meta">${item.kind} · ${item.host}:${item.port} · ${item.meta}</div>
              <div class="row"><button class="btn ghost small">连接</button><button class="btn soft small">编辑</button></div>
            </div>
          `).join("")}
        </div>
        <div class="field"><label>资源搜索</label><input placeholder="搜索 exchange/topic/queue" /></div>
        <div class="resource-tree">
          ${resources.slice(0, 5).map(item => `
            <div class="tree-item ${item.name === state.selectedResource ? "active" : ""}" data-action="select-resource" data-name="${item.name}">
              <span class="type-pill">${item.kind}</span>${item.name}
            </div>
          `).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderResourcePicker(scope: "subscribe" | "send", value: string, placeholder: string) {
  const open = state.resourcePicker === scope;
  return `
    <div class="resource-picker">
      <input class="resource-input" data-scope="${scope}" value="${escapeHtml(value)}" placeholder="${placeholder}" />
      <button class="picker-trigger" data-action="open-picker" data-scope="${scope}" title="选择资源">⌄</button>
      <div class="resource-popover ${open ? "open" : ""}">
        <div class="popover-head">
          <input class="popover-search" data-action="search-resource" value="${escapeHtml(state.resourceKeyword)}" placeholder="搜索当前连接已存在资源" />
          <button class="btn ghost small">刷新</button>
        </div>
        <div class="resource-list">
          ${filteredResources().map(item => `
            <div class="resource-option" data-action="pick-resource" data-scope="${scope}" data-name="${item.name}">
              <span class="type-pill">${item.kind}</span>
              <span class="path">${item.name}</span>
              <span class="count">${item.broker} · ${item.detail}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
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
          <div class="panel-extra"><span class="status"><span class="dot ok"></span>消费中</span></div>
        </div>
        <div class="panel-body">
          <div class="toolbar">
            <select><option>资源类型：全部</option><option>exchange</option><option>topic</option><option>queue</option></select>
            ${renderResourcePicker("subscribe", state.selectedResource, "点击选择 exchange/topic/queue")}
            <input placeholder="关键字 / JSONPath / Header 过滤" />
            <button class="btn">开始</button>
            <button class="btn ghost">暂停</button>
            <button class="btn soft">清屏</button>
            <button class="btn warn">仅错误</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>时间</th><th>中间件</th><th>来源</th><th>Key/RoutingKey</th><th>分区</th><th>Offset</th><th>大小</th><th>状态</th></tr>
              </thead>
              <tbody>
                ${messages.map(item => renderMessageRow(item)).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <aside class="panel">
        <div class="panel-head">
          <div class="panel-title">消息详情</div>
          <div class="panel-extra"><button class="btn ghost small" data-action="fill-send">重发</button></div>
        </div>
        <div class="panel-body">
          <div class="segmented"><button class="active">Pretty JSON</button><button>Raw</button><button>Headers</button><button>元信息</button></div>
          <pre>${escapeHtml(message.payload)}</pre>
          <div class="meta-list">
            <div class="meta-line"><span>连接</span><b>${activeConnection().name}</b></div>
            <div class="meta-line"><span>来源</span><b>${message.source}</b></div>
            <div class="meta-line"><span>Key</span><b>${message.key}</b></div>
            <div class="meta-line"><span>MessageId</span><b>${message.id}</b></div>
          </div>
          <div class="row detail-actions">
            <button class="btn ghost">复制</button>
            <button class="btn ghost">导出</button>
            <button class="btn" data-action="fill-send">填入发送页</button>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function renderMessageRow(item: MessageRecord) {
  return `
    <tr class="${item.id === state.selectedMessageId ? "selected" : ""}" data-action="select-message" data-id="${item.id}">
      <td>${item.time}</td>
      <td>${item.broker}</td>
      <td>${item.source}</td>
      <td>${item.key}</td>
      <td>${item.partition}</td>
      <td>${item.offset}</td>
      <td>${item.size}</td>
      <td>${item.status}</td>
    </tr>
  `;
}

function renderSendTargetFields() {
  const targetPicker = renderResourcePicker("send", state.sendTarget, "点击选择 exchange/topic/queue");
  if (state.sendProtocol === "rabbit-exchange") {
    return `
      <div class="field"><label>Exchange</label>${targetPicker}</div>
      <div class="field"><label>RoutingKey</label><input data-action="update-routing-key" value="${state.sendTarget === "amq.topic" ? "plan.created" : ""}" /></div>
    `;
  }
  if (state.sendProtocol === "kafka-topic") {
    return `
      <div class="field"><label>Topic</label>${targetPicker}</div>
      <div class="field"><label>Key</label><input value="evt-778" /></div>
      <div class="field"><label>Partition</label><input placeholder="可选" /></div>
    `;
  }
  if (state.sendProtocol === "activemq-topic") {
    return `
      <div class="field"><label>Topic</label>${targetPicker}</div>
      <div class="field"><label>ClientId</label><input placeholder="可选" /></div>
    `;
  }
  return `
    <div class="field"><label>Queue</label>${targetPicker}</div>
    <div class="field"><label>Delivery Mode</label><select><option>PERSISTENT</option><option>NON_PERSISTENT</option></select></div>
  `;
}

function renderSendPage() {
  return `
    <div class="layout-send">
      <aside class="panel">
        <div class="panel-head"><div class="panel-title">发送目标</div></div>
        <div class="panel-body">
          <div class="field"><label>连接</label><select>${connections.map(item => `<option>${item.name}</option>`).join("")}</select></div>
          <div class="field">
            <label>发送协议</label>
            <select data-action="change-send-protocol">
              <option value="rabbit-exchange" ${state.sendProtocol === "rabbit-exchange" ? "selected" : ""}>RabbitMQ：Exchange + RoutingKey</option>
              <option value="rabbit-queue" ${state.sendProtocol === "rabbit-queue" ? "selected" : ""}>RabbitMQ：直接 Queue</option>
              <option value="kafka-topic" ${state.sendProtocol === "kafka-topic" ? "selected" : ""}>Kafka：Topic + Key</option>
              <option value="activemq-queue" ${state.sendProtocol === "activemq-queue" ? "selected" : ""}>ActiveMQ：Queue</option>
              <option value="activemq-topic" ${state.sendProtocol === "activemq-topic" ? "selected" : ""}>ActiveMQ：Topic</option>
            </select>
          </div>
          ${renderSendTargetFields()}
          <div class="hint">资源输入框点击后展示当前连接已存在的 exchange、topic 或 queue，支持搜索选择，也保留手工输入能力。</div>
          <div class="row"><button class="btn">发送</button><button class="btn ghost">测试发送</button><button class="btn soft">保存模板</button></div>
        </div>
      </aside>
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">消息体</div>
          <div class="panel-extra"><button class="btn ghost small">格式化</button><button class="btn ghost small">压缩</button><button class="btn soft small">从历史填充</button></div>
        </div>
        <div class="panel-body">
          <div class="segmented"><button class="active">JSON</button><button>Raw</button><button>文本</button></div>
          <textarea class="editor" data-action="update-send-body">${escapeHtml(state.sendBody)}</textarea>
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
              <div class="meta-line"><span>状态</span><b class="success">等待发送</b></div>
              <div class="meta-line"><span>目标</span><b>${state.sendTarget}</b></div>
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
          <div class="field"><label>连接</label><select><option>全部连接</option>${connections.map(item => `<option>${item.name}</option>`).join("")}</select></div>
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
        <div class="panel-head"><div class="panel-title">历史消息</div><div class="panel-extra"><button class="btn ghost small" data-action="fill-send">填入发送页</button></div></div>
        <div class="panel-body">
          <div class="table-wrap full">
            <table>
              <thead><tr><th>时间</th><th>中间件</th><th>来源</th><th>Key/RoutingKey</th><th>MessageId</th><th>大小</th><th>操作</th></tr></thead>
              <tbody>
                ${messages.map(item => `<tr data-action="select-message" data-id="${item.id}"><td>2026-05-13 ${item.time}</td><td>${item.broker}</td><td>${item.source}</td><td>${item.key}</td><td>${item.id}</td><td>${item.size}</td><td>回放</td></tr>`).join("")}
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
  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div class="brand">运维 MQ 客户端</div>
        <nav class="tabs">${renderTabs()}</nav>
        <div class="top-actions">
          <span class="status"><span class="dot ok"></span>${activeConnection().name} 已连接</span>
          <button class="btn ghost small">导入配置</button>
          <button class="btn ghost small">导出配置</button>
        </div>
      </header>
      <main class="workspace">${renderPage()}</main>
    </div>
  `;
}

function closePicker() {
  state.resourcePicker = null;
  state.resourceKeyword = "";
}

root.addEventListener("click", event => {
  const target = event.target as HTMLElement;
  const actionTarget = target.closest<HTMLElement>("[data-action]");
  if (!actionTarget) {
    if (!target.closest(".resource-picker")) {
      closePicker();
      render();
    }
    return;
  }

  const action = actionTarget.dataset.action;
  if (action === "page") {
    state.page = actionTarget.dataset.page as Page;
    closePicker();
  }
  if (action === "select-connection") {
    state.activeConnectionId = actionTarget.dataset.id ?? state.activeConnectionId;
  }
  if (action === "select-message") {
    state.selectedMessageId = actionTarget.dataset.id ?? state.selectedMessageId;
  }
  if (action === "select-resource") {
    state.selectedResource = actionTarget.dataset.name ?? state.selectedResource;
  }
  if (action === "open-picker") {
    state.resourcePicker = actionTarget.dataset.scope as "subscribe" | "send";
    state.resourceKeyword = "";
  }
  if (action === "pick-resource") {
    const name = actionTarget.dataset.name ?? "";
    const scope = actionTarget.dataset.scope;
    if (scope === "send") {
      state.sendTarget = name;
    } else {
      state.selectedResource = name;
    }
    closePicker();
  }
  if (action === "fill-send") {
    state.sendBody = selectedMessage().payload;
    state.sendTarget = selectedMessage().source;
    state.page = "send";
    closePicker();
  }
  render();
});

root.addEventListener("input", event => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  const action = target.dataset.action;
  if (action === "search-resource") {
    state.resourceKeyword = target.value;
    render();
    const search = document.querySelector<HTMLInputElement>(".popover-search");
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  }
  if (action === "update-send-body") {
    state.sendBody = target.value;
  }
});

root.addEventListener("change", event => {
  const target = event.target as HTMLSelectElement;
  if (target.dataset.action === "change-send-protocol") {
    state.sendProtocol = target.value;
    state.sendTarget = state.sendProtocol === "kafka-topic" ? "pemc.notify.event1" : "amq.topic";
    render();
  }
});

render();
