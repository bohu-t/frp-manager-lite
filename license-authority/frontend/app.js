const app = document.querySelector('#app');
const flash = document.querySelector('#flash');

const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const show = (msg, err = false) => { flash.textContent = msg; flash.className = 'flash' + (err ? ' err' : ''); setTimeout(() => flash.classList.add('hidden'), 6000); };
const hideFlash = () => flash.classList.add('hidden');

function fmtTime(ts) {
  if (!ts) return '永久';
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const apiKey = localStorage.getItem('lca_api_key') || '';
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  const res = await fetch(path, {
    headers,
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({ ok: false, error: '响应不是 JSON' }));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    show('已复制');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    show('已复制');
  }
}

// ── renderers ────────────────────────────────

async function renderStats() {
  hideFlash();
  app.innerHTML = '<div class="card"><h2>📊 统计</h2><p class="muted">加载中…</p></div>';
  let data;
  try {
    data = await api('/api/admin/stats');
  } catch (err) {
    app.innerHTML = `<div class="card"><h2>📊 统计</h2><p class="bad">加载失败：${esc(err.message)}——请检查 API Key 是否已设置</p></div>`;
    return;
  }
  app.innerHTML = `
    <div class="card"><h2>📊 统计概览</h2>
      <div class="grid">
        <div><div class="label">授权码总数</div><div class="num">${data.total}</div></div>
        <div><div class="label">当前有效</div><div class="num">${data.active}</div></div>
        <div><div class="label">已激活</div><div class="num">${data.activated}</div></div>
        <div><div class="label">待激活</div><div class="num">${data.pending}</div></div>
        <div><div class="label">使用率</div><div class="num">${data.total ? Math.round(data.activated / data.total * 100) : 0}%</div></div>
      </div>
    </div>`;
}

async function renderGenerate() {
  hideFlash();
  app.innerHTML = `
    <div class="card"><h2>🔑 生成授权码</h2>
      <form id="genForm" class="stack-form">
        <div class="grid-fields">
          <div><label>备注</label><input name="note" placeholder="张三-企业版"></div>
          <div><label>套餐</label><input name="plan" value="deploy" placeholder="deploy"></div>
          <div><label>有效期（天）</label><input name="expires_days" type="number" value="365" min="0" max="3650"></div>
          <div><label>数量</label><input name="count" type="number" value="5" min="1" max="100"></div>
        </div>
        <p><button type="submit" class="primary wide">生成授权码</button></p>
      </form>
    </div>
    <div id="genResult"></div>`;
  document.querySelector('#genForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await api('/api/admin/keys/generate', {
        method: 'POST',
        body: {
          note: fd.get('note'),
          plan: fd.get('plan'),
          expires_days: parseInt(fd.get('expires_days')),
          count: parseInt(fd.get('count')),
        },
      });
      const keys = r.keys || [];
      document.querySelector('#genResult').innerHTML = `
        <div class="card">
          <h2>✅ ${r.message}</h2>
          ${keys.map(k => `
            <div style="display:flex;align-items:center;gap:8px;margin:6px 0">
              <code class="token" style="flex:1">${esc(k)}</code>
              <button onclick="copyText('${esc(k)}')">复制</button>
            </div>`).join('')}
          <p class="muted" style="margin-top:12px">把授权码发给客户，客户部署后填入激活页即可。</p>
        </div>`;
      show(r.message);
    } catch (err) { show(err.message, true); }
  };
}

async function renderKeys() {
  hideFlash();
  app.innerHTML = '<div class="card"><h2>📋 授权码列表</h2><p class="muted">加载中…</p></div>';
  let data;
  try { data = await api('/api/admin/keys'); }
  catch (err) {
    app.innerHTML = `<div class="card"><h2>📋 授权码列表</h2><p class="bad">加载失败：${esc(err.message)}</p></div>`;
    return;
  }
  const keys = data.keys || [];
  const rows = keys.map(k => `
    <tr>
      <td><code class="token">${esc(k.license_key)}</code></td>
      <td>${esc(k.note || '-')}</td>
      <td>${esc(k.plan)}</td>
      <td>${k.expired ? '<span class="bad">已过期</span>' : (k.expires_text === '永久有效' ? '<span class="ok">永久</span>' : k.expires_text)}</td>
      <td>${k.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td>${k.activated ? '<span class="ok">已绑定</span>' + (k.machine_id ? `<br><span class="muted">${esc(k.machine_id.substring(0,16))}…</span>` : '') : '<span class="muted">未激活</span>'}</td>
      <td class="actions">
        <button onclick="toggleKey(${k.id})">${k.active ? '停用' : '启用'}</button>
        ${k.activated ? `<button class="danger" onclick="unbindKey(${k.id})">解绑</button>` : ''}
        <button onclick="copyText('${esc(k.license_key)}')">复制</button>
      </td>
    </tr>`).join('');
  app.innerHTML = `
    <div class="card"><h2>📋 授权码列表 (${keys.length})</h2>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>授权码</th><th>备注</th><th>套餐</th><th>有效期</th><th>状态</th><th>激活</th><th>操作</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">暂无授权码</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

async function toggleKey(id) {
  try {
    const r = await api('/api/admin/keys/toggle', { method: 'POST', body: { id } });
    show(r.message);
    await renderKeys();
  } catch (err) { show(err.message, true); }
}

async function unbindKey(id) {
  if (!confirm('确认解绑？解绑后该授权码可用于另一台机器。')) return;
  try {
    const r = await api('/api/admin/keys/unbind', { method: 'POST', body: { id } });
    show(r.message);
    await renderKeys();
  } catch (err) { show(err.message, true); }
}

function renderSettings() {
  hideFlash();
  const savedKey = localStorage.getItem('lca_api_key') || '';
  app.innerHTML = `
    <div class="card"><h2>🛠️ 设置</h2>
      <form id="settingsForm" class="stack-form">
        <label>API Key（用于管理接口认证）</label>
        <input name="api_key" type="password" value="${esc(savedKey)}" placeholder="输入 LCA_API_KEY">
        <p class="muted">与服务器环境变量 LCA_API_KEY 一致。保存在浏览器 localStorage。</p>
        <p><button type="submit" class="primary">保存</button></p>
      </form>
    </div>
    <div class="card"><h2>📖 部署说明</h2>
      <div class="grid">
        <div>
          <div class="label">监听地址</div>
          <p>默认 <code>127.0.0.1:8200</code>，建议前面挂 Nginx/Caddy 做 HTTPS。</p>
        </div>
        <div>
          <div class="label">激活端点</div>
          <p>客户面板调用 <code>POST /api/license/activate</code></p>
        </div>
        <div>
          <div class="label">环境变量</div>
          <p><code>LCA_API_KEY</code> 管理接口密钥<br>
             <code>LCA_LICENSE_SECRET</code> 授权签名密钥（与客户面板 FML_SOFTWARE_LICENSE_SECRET 一致）<br>
             <code>LCA_PORT</code> 监听端口（默认 8200）<br>
             <code>LCA_ALLOWED_APPS</code> 允许的应用名（逗号分隔）</p>
        </div>
        <div>
          <div class="label">客户 .env 配置</div>
          <p>客户部署时在激活页填入本服务的 HTTPS 地址 + 授权码，或在 <code>.env</code> 预设：<br>
             <code>FML_LICENSE_SERVER_URL=https://license.你的域名.com</code><br>
             <code>FML_SOFTWARE_LICENSE_SECRET=与 LCA_LICENSE_SECRET 一致</code></p>
        </div>
      </div>
    </div>`;
  document.querySelector('#settingsForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    localStorage.setItem('lca_api_key', fd.get('api_key'));
    show('API Key 已保存');
  };
}

// ── init ────────────────────────────────────

(async function init() {
  try {
    await api('/api/health');
  } catch (err) {
    app.innerHTML = `<div class="card"><h2>⚠️ 无法连接到鉴权服务器</h2><p class="bad">${esc(err.message)}</p><p class="muted">请确认服务已启动：python3 server.py</p></div>`;
    return;
  }
  renderStats();
})();
