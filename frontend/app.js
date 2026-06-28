const app = document.querySelector('#app');
const nav = document.querySelector('#nav');
const flash = document.querySelector('#flash');
let currentUser = null;
let softwareLicense = null;
let currentAdminSection = 'settings';
let csrfToken = null;
let colorMode = localStorage.getItem('fml_color_mode') || 'system';
const systemDarkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolvedColorMode(){
  if(colorMode === 'system') return systemDarkQuery && systemDarkQuery.matches ? 'dark' : 'light';
  return colorMode === 'light' ? 'light' : 'dark';
}

function applyColorMode(mode){
  colorMode = ['system', 'light', 'dark'].includes(mode) ? mode : 'system';
  document.documentElement.dataset.theme = resolvedColorMode();
  document.documentElement.dataset.themeMode = colorMode;
  localStorage.setItem('fml_color_mode', colorMode);
}

function colorModeLabel(){
  if(colorMode === 'system') return '跟随系统';
  return colorMode === 'dark' ? '深色模式' : '浅色模式';
}

function nextColorMode(){
  return colorMode === 'system' ? 'dark' : (colorMode === 'dark' ? 'light' : 'system');
}

function toggleColorMode(){
  applyColorMode(nextColorMode());
  setNav();
}

if(systemDarkQuery){
  systemDarkQuery.addEventListener('change', () => {
    if(colorMode === 'system') applyColorMode('system');
  });
}

applyColorMode(colorMode);

const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const show = (msg, err=false) => { flash.textContent = msg; flash.className = 'flash' + (err ? ' err' : ''); setTimeout(()=>flash.classList.add('hidden'), 8000); };
const hideFlash = () => flash.classList.add('hidden');

async function ensureCsrf(){
  if(csrfToken) return csrfToken;
  const res = await fetch('/api/csrf', {credentials:'same-origin'});
  const data = await res.json();
  csrfToken = data.csrf_token;
  return csrfToken;
}

async function api(path, opts={}){
  const method = (opts.method || 'GET').toUpperCase();
  const headers = {'Content-Type':'application/json', ...(opts.headers || {})};
  if(method !== 'GET' && method !== 'HEAD'){
    headers['X-CSRF-Token'] = await ensureCsrf();
  }
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers,
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
  });
  const data = await res.json().catch(()=>({ok:false,error:'响应不是 JSON'}));
  if(!res.ok || data.ok === false){
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function loadNodes(){
  const data = await api('/api/nodes');
  return data.nodes || [];
}

function nodeOptions(nodes, selected=''){
  return nodes.map(n => `<option value="${n.id}" ${String(n.id)===String(selected)?'selected':''}>${esc(n.region)} / ${esc(n.name)} · ${esc(n.server_addr)} · 剩余${n.free_count}/${n.port_count}</option>`).join('');
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    show('已复制');
  }catch(e){
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); show('已复制');
  }
}

function downloadText(filename, text){
  const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function regionBadges(nodes){
  const regions = [...new Set((nodes || []).filter(n => n.active).map(n => n.region).filter(Boolean))].slice(0, 8);
  if(!regions.length) return '<span>多地区节点</span>';
  return regions.map(r => `<span>${esc(r)}</span>`).join('');
}

function authShell(title, subtitle, formHtml, footHtml='', nodes=[]){
  return `
    <div class="auth-layout">
      <section class="auth-hero card">
        <div class="brand-mark">FRP</div>
        <h2>稳定、快速的内网穿透服务</h2>
        <p>就近选择地区节点，独立端口配额，支持 TCP / UDP / HTTP / HTTPS / STCP / XTCP / TCPMUX 全协议场景。</p>
        <div class="feature-grid">
          <div><b>高速线路</b><span>按地区节点接入</span></div>
          <div><b>全协议</b><span>覆盖 frp 常用代理类型</span></div>
          <div><b>独立授权</b><span>一机一绑防滥用</span></div>
          <div><b>配置简单</b><span>一键下载 frpc</span></div>
        </div>
        <div class="hero-label">可选地区</div>
        <div class="hero-points">${regionBadges(nodes)}</div>
      </section>
      <section class="auth-card card">
        <div class="section-title"><h2>${title}</h2><p>${subtitle}</p></div>
        ${formHtml}
        ${footHtml}
      </section>
    </div>`;
}

function emptyRow(cols, text){
  return `<tr><td colspan="${cols}" class="empty-state">${esc(text)}</td></tr>`;
}

function fmtTs(ts){
  if(!ts) return '-';
  return new Date(ts * 1000).toLocaleString();
}

function setNav(){
  const themeBtn = `<button class="secondary" onclick="toggleColorMode()">${colorMode === 'dark' ? '浅色' : '深色'}模式</button>`;
  if(!currentUser){ nav.innerHTML = themeBtn; return; }
  const licenseRequired = !!(softwareLicense && softwareLicense.required && !softwareLicense.licensed);
  const isAdmin = currentUser.role === 'admin';
  const adminNav = isAdmin && !licenseRequired ? `
    <button class="secondary" onclick="loadAdmin('users')">用户</button>
    <button class="secondary" onclick="loadAdmin('keys')">密钥</button>
    <button class="secondary" onclick="loadAdmin('nodes')">节点</button>
    <button class="secondary" onclick="loadAdmin('risk')">风控</button>
    <button class="secondary" onclick="loadAdmin('settings')">设置</button>
  ` : '';
  nav.innerHTML = `
    ${licenseRequired && isAdmin ? '<button class="secondary" onclick="renderLicenseActivate()">软件授权</button>' : (licenseRequired ? '' : '<button class="secondary" onclick="loadDashboard()">概览</button>')}
    ${adminNav}
    ${licenseRequired ? '' : '<a class="btn" href="/config/frpc.toml">frpc 配置</a>'}
    ${themeBtn}
    <button onclick="logout()" class="danger">退出</button>
  `;
}

async function renderLogin(){
  currentUser = null; setNav(); hideFlash();
  let nodes = [];
  try { nodes = await loadNodes(); } catch(e) {}
  app.innerHTML = authShell('登录', '登录后管理隧道和下载配置', `
      <form id="loginForm" class="stack-form">
        <label>用户名</label><input name="username" autocomplete="username" required>
        <label>密码</label><input name="password" type="password" autocomplete="current-password" required>
        <p><button class="wide">登录</button></p>
      </form>`,
      `<div class="auth-switch"><span>没有账号？</span><button class="secondary" onclick="renderRegister()">使用密钥注册</button></div>`, nodes);
  document.querySelector('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      const data = await api('/api/login', {method:'POST', body:{username:fd.get('username'), password:fd.get('password')}});
      currentUser = data.user; setNav(); await loadDashboard();
    }catch(err){
      if(err.message === 'software_license_required'){
        softwareLicense = err.data?.license || softwareLicense;
        setNav();
        return renderLicenseActivate();
      }
      show(err.message, true);
    }
  };
}

async function renderRegister(){
  currentUser = null; setNav(); hideFlash();
  let nodes = [];
  try { nodes = await loadNodes(); } catch(e) { show('加载地区节点失败：' + e.message, true); }
  app.innerHTML = authShell('密钥注册', '输入密钥并选择适合你的地区', `
      <form id="registerForm" class="stack-form">
        <label>用户名</label><input name="username" autocomplete="username" required>
        <label>密码</label><input name="password" type="password" autocomplete="new-password" minlength="6" required>
        <label>地区节点</label><select name="node_id" required>${nodeOptions(nodes)}</select>
        <label>注册密钥</label><input name="invite_key" placeholder="FML-..." required>
        <p class="row"><button>注册</button><button type="button" class="secondary" onclick="renderLogin()">返回登录</button></p>
      </form>`, '', nodes);
  document.querySelector('#registerForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      const r = await api('/api/register', {method:'POST', body:Object.fromEntries(fd)});
      show(r.message || '注册成功，请登录');
      renderLogin();
    }catch(err){ show(err.message, true); }
  };
}

async function loadMe(){
  // 先检查软件授权状态 — 未激活时不需要登录就直接显示激活页
  try{
    const licRes = await fetch('/api/license/status', {credentials:'same-origin'});
    const licData = await licRes.json();
    if(licData.ok && licData.license){
      softwareLicense = licData.license;
      if(softwareLicense.required && !softwareLicense.licensed){
        renderLicenseActivatePublic();
        return;
      }
    }
  }catch(e){}
  try{
    await ensureCsrf();
    const data = await api('/api/me');
    currentUser = data.user;
    softwareLicense = data.software_license || null;
    setNav();
    if(currentUser){
      if(softwareLicense && softwareLicense.required && !softwareLicense.licensed && currentUser.role === 'admin') renderLicenseActivate();
      else await loadDashboard();
    }else renderLogin();
  }catch{ renderLogin(); }
}

function renderLicenseActivatePublic(){
  hideFlash();
  currentUser = null;
  setNav();
  const lic = softwareLicense || {};
  const machineId = lic.machine_id || '-';
  app.innerHTML = `
    <div class="auth-layout">
      <section class="auth-hero card">
        <div class="brand-mark">🔑</div>
        <h2>需要软件授权激活</h2>
        <p>请联系卖家获取<strong>鉴权服务器地址</strong>和<strong>软件授权码</strong>。激活后自动绑定当前服务器，一机一码。</p>
        <div class="feature-grid">
          <div><b>远程验证</b><span>授权码由卖家鉴权服务器签发</span></div>
          <div><b>一机一绑</b><span>激活后授权码与服务器指纹绑定</span></div>
          <div><b>防篡改</b><span>签名验证防止伪造授权</span></div>
        </div>
        <div class="hero-label">服务器指纹</div>
        <div class="hero-points"><span><code style="word-break:break-all">${esc(machineId)}</code></span></div>
      </section>
      <section class="auth-card card">
        <div class="section-title"><h2>激活授权</h2><p>${esc(lic.message || '请填写卖家提供的以下信息')}</p></div>
        <form id="licenseActivateForm" class="stack-form">
          <label>鉴权服务器地址</label>
          <input name="server_url" placeholder="https://license.你的卖家域名.com" required>
          <label>软件授权码</label>
          <input name="license_key" placeholder="FMLD-..." required>
          <p class="row"><button class="wide">激活并绑定</button></p>
        </form>
      </section>
    </div>`;
  document.querySelector('#licenseActivateForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      const r = await api('/api/license/activate', {method:'POST', body:Object.fromEntries(fd)});
      softwareLicense = r.license || softwareLicense;
      show(r.message || '授权已激活，请登录');
      currentUser = null;
      renderLogin();
    }catch(err){
      softwareLicense = err.data?.license || softwareLicense;
      show(err.message || '激活失败', true);
    }
  };
}

function renderLicenseActivate(){
  hideFlash();
  setNav();
  const lic = softwareLicense || {};
  app.innerHTML = `
    <section class="card">
      <div class="section-title"><h2>软件授权激活</h2><p>输入卖家给你的部署版授权码；系统会自动绑定当前服务器，无需手动生成机器码。</p></div>
      <div class="grid">
        <div><div class="label">授权状态</div><p>${esc(lic.message || '待激活')}</p></div>
        <div><div class="label">当前机器指纹</div><p><code class="token">${esc(lic.machine_id || '-')}</code></p><p class="muted small">仅用于自动绑定，客户不需要复制给卖家。</p></div>
      </div>
      <form id="licenseActivateForm" class="stack-form">
        <label>鉴权服务器地址</label>
        <input name="server_url" placeholder="${esc(lic.server_url || 'https://license.你的卖家域名.com')}">
        <label>软件授权码</label><input name="license_key" placeholder="FMLD-..." required>
        <p class="row"><button>激活授权</button><button type="button" class="secondary" onclick="loadMe()">刷新状态</button></p>
      </form>
    </section>`;
  document.querySelector('#licenseActivateForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      const r = await api('/api/license/activate', {method:'POST', body:Object.fromEntries(fd)});
      softwareLicense = r.license || softwareLicense;
      show(r.message || '授权已激活');
      await loadDashboard();
    }catch(err){ softwareLicense = err.data?.license || softwareLicense; show(err.message, true); }
  };
}

async function logout(){
  await api('/api/logout', {method:'POST', body:{}}).catch(()=>{});
  renderLogin();
}

async function loadDashboard(){
  hideFlash();
  let data;
  try{ data = await api('/api/dashboard'); }
  catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    if(err.message === 'software_license_required'){
      softwareLicense = err.data?.license || softwareLicense;
      setNav();
      return renderLicenseActivate();
    }
    show(err.message, true); return;
  }
  currentUser = data.user; softwareLicense = data.software_license || softwareLicense; setNav();
  const used = new Set(data.tunnels.map(t => t.remote_port));
  const ports = data.ports.map(p => `<span class="${used.has(p) ? 'used' : ''}">${p}</span>`).join('');
  const tunnelRows = data.tunnels.map(t => {
    const endpoint = ['tcp','udp'].includes(t.proxy_type) ? esc(t.remote_port || '-') : (t.custom_domains ? esc(t.custom_domains) : (t.secret_key ? `secretKey: ${esc(t.secret_key)}` : '-'));
    return `
    <tr>
      <td>${esc(t.name)}</td><td>${esc(t.proxy_type)}</td><td>${esc(t.local_ip)}:${esc(t.local_port)}</td><td>${endpoint}</td>
      <td>${t.enabled ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td class="actions"><button onclick="toggleTunnel(${t.id})">切换</button><button class="danger" onclick="deleteTunnel(${t.id})">删除</button></td>
    </tr>`;
  }).join('') || emptyRow(6, '还没有隧道');
  const portOptions = data.ports.map(p => `<option value="${p}">${p}${used.has(p) ? '（已用）' : ''}</option>`).join('');
  const proxyTypeOptions = (data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux']).map(t => `<option value="${t}">${t}</option>`).join('');
  app.innerHTML = `
    <div class="grid">
      <section class="card stat"><div class="label">当前账号</div><div class="num">${esc(data.user.username)}</div><p>地区节点：<b>${esc(data.node?.region || '-')} / ${esc(data.node?.name || '-')}</b></p><p>端口上限：${esc(data.user.max_ports)} · 到期：<b>${esc(data.user.expires_text)}</b></p><p class="muted small">Token：<code>${esc(data.user.token)}</code></p><p class="muted small">授权码：<code>${esc(data.user.license_key)}</code></p><p class="muted small">绑定机器：${data.user.machine_id ? `<code>${esc(data.user.machine_id)}</code>` : '首次 frpc 鉴权时绑定'}</p></section>
      <section class="card stat"><div class="label">FRPS 接入点</div><div class="num" style="font-size:20px">${esc(data.frps.addr)}</div><p>端口：<code>${esc(data.frps.port)}</code></p><p><a class="btn" href="/config/frpc.toml">下载 frpc.toml</a></p><p class="muted small">全协议：${(data.allowed_proxy_types || []).join(' / ')}</p></section>
    </div>
    <section class="card"><div class="section-title"><h2>已分配端口</h2><p>绿色表示已经创建隧道</p></div><p class="ports">${ports}</p></section>
    <section class="card"><div class="section-title"><h2>新建隧道</h2><p>TCP/UDP 使用分配端口；HTTP/HTTPS/TCPMUX 使用自定义域名；STCP/XTCP 使用密钥。</p></div><form id="tunnelForm" class="grid">
      <div><label>名称</label><input name="name" placeholder="web" required></div>
      <div><label>类型</label><select name="proxy_type" id="proxyTypeSelect">${proxyTypeOptions}</select></div>
      <div><label>本地 IP</label><input name="local_ip" value="127.0.0.1" required></div>
      <div><label>本地端口</label><input name="local_port" type="number" min="1" max="65535" value="80" required></div>
      <div class="remote-port-field"><label>公网端口</label><select name="remote_port">${portOptions}</select></div>
      <div class="domain-field hidden"><label>自定义域名</label><input name="custom_domains" placeholder="app.example.com,api.example.com"></div>
      <div class="secret-field hidden"><label>访问密钥</label><input name="secret_key" placeholder="留空自动生成"></div>
      <div style="align-self:end"><button>创建</button></div>
    </form><p class="muted small">HTTP/HTTPS/TCPMUX 需要 frps 已配置 vhostHTTPPort / vhostHTTPSPort / tcpmuxHTTPConnectPort 等对应能力。</p></section>
    <section class="card"><div class="section-title"><h2>隧道列表</h2><p>修改后请重新下载 frpc.toml</p></div><table><thead><tr><th>名称</th><th>类型</th><th>本地服务</th><th>公网端口/域名/密钥</th><th>状态</th><th>操作</th></tr></thead><tbody>${tunnelRows}</tbody></table></section>`;
  const proxyTypeSelect = document.querySelector('#proxyTypeSelect');
  const syncProxyFields = () => {
    const type = proxyTypeSelect.value;
    document.querySelector('.remote-port-field').classList.toggle('hidden', !['tcp','udp'].includes(type));
    document.querySelector('.domain-field').classList.toggle('hidden', !['http','https','tcpmux'].includes(type));
    document.querySelector('.secret-field').classList.toggle('hidden', !['stcp','xtcp'].includes(type));
  };
  proxyTypeSelect.onchange = syncProxyFields;
  syncProxyFields();
  document.querySelector('#tunnelForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      await api('/api/tunnels/create', {method:'POST', body:Object.fromEntries(fd)});
      show('隧道已创建，重新下载 frpc.toml 后重启 frpc 生效');
      await loadDashboard();
    }catch(err){ show(err.message, true); }
  };
}

async function toggleTunnel(id){ await api('/api/tunnels/toggle', {method:'POST', body:{id}}).then(loadDashboard).catch(e=>show(e.message,true)); }
async function deleteTunnel(id){ if(confirm('删除这个隧道？')) await api('/api/tunnels/delete', {method:'POST', body:{id}}).then(loadDashboard).catch(e=>show(e.message,true)); }

async function loadAdmin(section=currentAdminSection){
  hideFlash();
  currentAdminSection = ['settings','users','keys','nodes','risk'].includes(section) ? section : currentAdminSection;
  setNav();
  let data;
  try{ data = await api('/api/admin/overview'); }
  catch(err){ show(err.message, true); return; }
  softwareLicense = data.software_license || softwareLicense;
  setNav();
  const rows = data.users.map(u => `
    <tr>
      <td>${u.id}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(u.node_region || '-')} / ${esc(u.node_name || '-')}</td><td>${u.port_count}/${u.max_ports}</td><td>${u.tunnel_count}</td>
      <td>${esc(u.expires_text)} ${u.expired ? '<span class="bad">已到期</span>' : ''}</td>
      <td>${u.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td><code class="token" title="${esc(u.license_key || '')}">${esc(u.license_key || '-')}</code><br><span class="muted small">${u.machine_id ? `已绑：${esc(u.machine_id)}` : '未绑定'}</span></td>
      <td class="actions">
        <button onclick="adminToggle(${u.id})">${u.active ? '停用' : '启用'}</button>
        <button onclick="adminExtend(${u.id})">续30天</button>
        <button onclick="adminReset(${u.id})">重置密码</button>
        <button onclick="adminUnbind(${u.id})">解绑机器</button>
        <button onclick="adminResetLicense(${u.id})">重置授权</button>
        <button class="danger" onclick="adminDelete(${u.id})">删除</button>
      </td>
    </tr>`).join('');
  const nodeRows = (data.nodes || []).map(n => `
    <tr>
      <td>${n.id}</td><td>${esc(n.region)}</td><td>${esc(n.name)}</td><td>${esc(n.server_addr)}:${n.server_port}</td>
      <td>${n.port_start}-${n.port_end}</td><td>${n.free_count}/${n.port_count}</td>
      <td>${n.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td>${esc(n.note)}</td>
      <td class="actions"><button onclick='editNode(${JSON.stringify(n)})'>编辑</button><button onclick="nodeToggle(${n.id})">${n.active ? '停用' : '启用'}</button><a class="btn" href="/config/frps.example.toml?node_id=${n.id}">frps配置</a><button class="danger" onclick="nodeDelete(${n.id})">删除</button></td>
    </tr>`).join('') || emptyRow(9, '还没有节点');
  const keyRows = (data.invite_keys || []).map(k => `
    <tr>
      <td>${k.id}</td>
      <td><code class="token" title="${esc(k.key)}">${esc(k.key)}</code></td>
      <td>${esc(k.note)}</td>
      <td>${k.used_count}/${k.max_uses}</td>
      <td>${k.max_ports}</td>
      <td>${k.user_expires_days === 0 ? '永不过期' : `${k.user_expires_days} 天`}</td>
      <td>${esc(k.expires_text)} ${k.expired ? '<span class="bad">已过期</span>' : ''}</td>
      <td>${k.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td class="actions"><button onclick="copyText('${k.key}')">复制</button><button onclick="inviteToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button class="danger" onclick="inviteDelete(${k.id})">删除</button></td>
    </tr>`).join('') || emptyRow(9, '还没有注册密钥');
  const logRows = (data.logs || []).map(l => `
    <tr><td>${l.id}</td><td>${esc(l.event)}</td><td>${esc(l.username || '-')}</td><td>${esc(l.remote_port || '-')}</td><td>${esc(l.proxy_type || '-')}</td><td>${esc(l.detail || '')}</td><td>${fmtTs(l.created_at)}</td></tr>
  `).join('') || emptyRow(7, '暂无审计日志');
  const softwareKeyRows = (data.software_license_keys || []).map(k => `
    <tr>
      <td>${k.id}</td><td><code class="token" title="${esc(k.license_key)}">${esc(k.license_key)}</code></td><td>${esc(k.note)}</td><td>${esc(k.plan)}</td>
      <td>${k.machine_id ? `<code class="token">${esc(k.machine_id)}</code>` : '未绑定'}</td>
      <td>${esc(k.expires_text)} ${k.expired ? '<span class="bad">已过期</span>' : ''}</td>
      <td>${k.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td class="actions"><button onclick="copyText('${k.license_key}')">复制</button><button onclick="softwareLicenseToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button onclick="softwareLicenseUnbind(${k.id})">解绑</button></td>
    </tr>`).join('') || emptyRow(8, '还没有软件授权码');
  const adminNodeOptions = nodeOptions((data.nodes || []).filter(n => n.active));
  const summaryHtml = `
    <div class="grid">
      <section class="card stat"><div class="label">端口池</div><div class="num">${data.stats.free_ports}</div><div class="sub">剩余 / 总数 ${data.stats.total_ports} · 默认范围 ${data.stats.port_start}-${data.stats.port_end}</div></section>
      <section class="card stat"><div class="label">隧道</div><div class="num">${data.stats.tunnel_count}</div><div class="sub">已登记隧道</div><p><a class="btn secondary" href="/config/frps.example.toml">下载默认 frps 配置</a></p></section>
      <section class="card stat"><div class="label">注册密钥</div><div class="num">${data.stats.invite_key_count || 0}</div><div class="sub">封禁记录 ${data.stats.ban_count || 0} · 用户注册必须持有效密钥</div><p class="row"><a class="btn secondary" href="/admin/backup/full.zip">下载全量备份</a><button class="secondary" onclick="backupToR2()">备份到 R2</button></p></section>
    </div>`;
  const nodeHtml = `
    <section class="card hidden" id="editNodeCard"><div class="section-title"><h2>编辑地区节点</h2><p>建议使用稳定域名，方便后期更换 VPS</p></div><form id="editNodeForm" class="grid">
      <input type="hidden" name="id">
      <div><label>地区</label><input name="region" required></div>
      <div><label>节点名</label><input name="name" required></div>
      <div><label>frps 域名/地址</label><input name="server_addr" required></div>
      <div><label>frps bindPort</label><input name="server_port" type="number" min="1" max="65535"></div>
      <div><label>frps token</label><input name="auth_token" required></div>
      <div><label>状态</label><select name="active"><option value="1">启用</option><option value="0">停用</option></select></div>
      <div><label>备注</label><input name="note"></div>
      <div style="align-self:end"><button>保存修改</button><button type="button" class="secondary" onclick="document.querySelector('#editNodeCard').classList.add('hidden')">取消</button></div>
    </form><p class="muted small">建议 frps 地址填写域名，例如 <code>hk.example.com</code>。后期更换 VPS 时优先改 DNS，用户的 frpc 配置可保持不变。</p></section>
    <section class="card"><div class="section-title"><h2>新增地区节点</h2><p>每个节点独立端口池和 token</p></div><form id="nodeForm" class="grid">
      <div><label>地区</label><input name="region" placeholder="香港 / 日本 / 美国" required></div>
      <div><label>节点名</label><input name="name" placeholder="hk-1" required></div>
      <div><label>frps 域名/地址</label><input name="server_addr" placeholder="hk.example.com" required></div>
      <div><label>frps bindPort</label><input name="server_port" type="number" value="7000" min="1" max="65535"></div>
      <div><label>frps token</label><input name="auth_token" placeholder="CHANGE_ME" required></div>
      <div><label>端口起始</label><input name="port_start" type="number" value="20000" min="1" max="65535"></div>
      <div><label>端口结束</label><input name="port_end" type="number" value="20199" min="1" max="65535"></div>
      <div><label>备注</label><input name="note" placeholder="线路/机房说明"></div>
      <div style="align-self:end"><button>创建节点</button></div>
    </form></section>
    <section class="card" id="nodes"><div class="section-title"><h2>地区节点列表</h2><p>启用节点优先，剩余端口多的排前面</p></div><table><thead><tr><th>ID</th><th>地区</th><th>节点</th><th>frps</th><th>端口池</th><th>剩余</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>${nodeRows}</tbody></table></section>`;
  const keysHtml = `
    <section class="card" id="keys"><div class="section-title"><h2>生成注册密钥</h2><p>适合批量发货，一次最多 500 枚</p></div><form id="inviteForm" class="grid">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="闲鱼订单号/套餐名"></div>
      <div><label>每枚可用次数</label><input name="max_uses" type="number" value="1" min="1" max="10000"></div>
      <div><label>注册后端口数</label><input name="max_ports" type="number" value="5" min="1" max="100"></div>
      <div><label>注册后账号有效期天数</label><input name="user_expires_days" type="number" value="30" min="0" max="3650"></div>
      <div><label>密钥有效期天数</label><input name="key_expires_days" type="number" value="30" min="0" max="3650"></div>
      <div style="align-self:end"><button>生成密钥</button></div>
    </form><p><a class="btn" href="/admin/export/invite-keys.csv">导出未使用可用密钥 CSV</a></p><p class="panel-note small">批量生成后会自动复制并下载本次生成的 txt。CSV 导出只包含未使用、启用中、未过期的密钥。</p></section>
    <section class="card"><div class="section-title"><h2>注册密钥列表</h2><p>已使用密钥不会出现在 CSV 导出里</p></div><table><thead><tr><th>ID</th><th>密钥</th><th>备注</th><th>使用</th><th>端口</th><th>账号有效期</th><th>密钥到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${keyRows}</tbody></table></section>
    ${data.software_license_authority ? `<section class="card" id="software-licenses"><div class="section-title"><h2>部署版软件授权码</h2><p>卖家后台使用：先批量生成授权码发给客户；客户输入授权码后自动绑定他的部署服务器。</p></div><form id="softwareLicenseForm" class="grid">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/客户名"></div>
      <div><label>套餐</label><input name="plan" value="deploy"></div>
      <div><label>有效期天数</label><input name="expires_days" type="number" value="0" min="0" max="3650"><span class="muted small">0 表示永不过期</span></div>
      <div style="align-self:end"><button>生成软件授权码</button></div>
    </form><p class="panel-note small">客户不需要提供机器码；首次激活时授权服务器会自动绑定机器。批量生成后会自动复制并下载 txt。</p>
    <table><thead><tr><th>ID</th><th>授权码</th><th>备注</th><th>套餐</th><th>绑定机器</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${softwareKeyRows}</tbody></table></section>` : ''}`;
  const usersHtml = `
    <section class="card"><div class="section-title"><h2>创建用户</h2><p>管理员直开账号，可指定地区节点</p></div><form id="createUserForm" class="grid">
      <div><label>用户名</label><input name="username" required></div>
      <div><label>初始密码</label><input name="password" type="password" required></div>
      <div><label>地区节点</label><select name="node_id" required>${adminNodeOptions}</select></div>
      <div><label>端口数量</label><input name="max_ports" type="number" value="5" min="1" max="100"></div>
      <div><label>有效期天数</label><input name="expires_days" type="number" value="30" min="0" max="3650"><span class="muted small">0 表示永不过期</span></div>
      <div style="align-self:end"><button>创建</button></div>
    </form></section>
    <section class="card" id="users"><div class="section-title"><h2>用户列表</h2><p>管理状态、续期、授权码、机器绑定和删除账号</p></div><table><thead><tr><th>ID</th><th>用户</th><th>角色</th><th>地区节点</th><th>端口</th><th>隧道</th><th>到期</th><th>状态</th><th>授权/机器</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  const riskHtml = `
    <section class="card" id="risk"><div class="section-title"><h2>投诉处理 / 风控</h2><p>按端口定位用户并快速封禁</p></div>
      <form id="lookupPortForm" class="grid">
        <div><label>被投诉端口</label><input name="remote_port" type="number" min="1" max="65535" placeholder="例如 20088" required></div>
        <div><label>节点（可选）</label><select name="node_id"><option value="0">全部节点</option>${nodeOptions(data.nodes || [])}</select></div>
        <div style="align-self:end"><button>查询</button></div>
      </form>
      <div id="riskResult" class="risk-result"></div>
    </section>
    <section class="card"><div class="section-title"><h2>审计日志</h2><p>最近 80 条关键操作和风控事件</p></div><table><thead><tr><th>ID</th><th>事件</th><th>用户</th><th>端口</th><th>协议</th><th>详情</th><th>时间</th></tr></thead><tbody>${logRows}</tbody></table></section>`;
  const settingsHtml = summaryHtml + `
    <section class="card"><div class="section-title"><h2>管理设置</h2><p>常用运维入口和系统概览。用户、密钥、节点、风控已拆到顶部独立导航。</p></div>
      ${data.has_setup_key ? `<div class="grid"><div><div class="label">🔑 一键添加节点密钥</div><p><code class="token" style="user-select:all">FML_SETUP_KEY=${esc(data.setup_key)}</code></p><p class="muted small">在"添加 frps 节点"脚本中会用到。密钥完整值在 .env 文件中。</p></div></div>` : '<div class="grid"><div><div class="label">⚠️ 未设置 FML_SETUP_KEY</div><p class="muted small">在 .env 中添加 FML_SETUP_KEY=*** 即可启用一键添加节点功能。</p></div></div>'}
      <p class="row"><a class="btn secondary" href="/config/frps.example.toml">下载默认 frps 配置</a><a class="btn" href="/admin/backup/full.zip">下载全量备份</a><button class="secondary" onclick="backupToR2()">备份到 R2</button></p>
    </section>`;
  const sectionHtml = {settings: settingsHtml, users: usersHtml, keys: keysHtml, nodes: nodeHtml, risk: riskHtml}[currentAdminSection] || settingsHtml;
  app.innerHTML = sectionHtml;
  const softwareLicenseForm = document.querySelector('#softwareLicenseForm');
  if(softwareLicenseForm){
    softwareLicenseForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/software-licenses/create', {method:'POST', body:Object.fromEntries(fd)});
        const keys = r.keys || (r.key ? [r.key] : []);
        show(r.message || '软件授权码已生成');
        if(keys.length){
          const text = keys.join('\n');
          await copyText(text);
          downloadText('software-license-keys.txt', text + '\n');
        }
        await loadAdmin();
      }catch(err){ show(err.message, true); }
    };
  }
  const nodeForm = document.querySelector('#nodeForm');
  if(nodeForm){
    nodeForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/nodes/create', {method:'POST', body:Object.fromEntries(fd)});
        show(r.message || '节点已创建');
        await loadAdmin();
      }catch(err){ show(err.message, true); }
    };
  }
  const editNodeForm = document.querySelector('#editNodeForm');
  if(editNodeForm){
    editNodeForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/nodes/update', {method:'POST', body:Object.fromEntries(fd)});
        show(r.message || '节点已更新');
        await loadAdmin();
      }catch(err){ show(err.message, true); }
    };
  }
  const createUserForm = document.querySelector('#createUserForm');
  if(createUserForm){
    createUserForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/users/create', {method:'POST', body:Object.fromEntries(fd)});
        show(r.message || '用户已创建');
        await loadAdmin();
      }catch(err){ show(err.message, true); }
    };
  }
  const inviteForm = document.querySelector('#inviteForm');
  if(inviteForm){
    inviteForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/invite-keys/create', {method:'POST', body:Object.fromEntries(fd)});
        const keys = r.keys || (r.key ? [r.key] : []);
        show(r.message || '密钥已生成');
        if(keys.length){
          const text = keys.join('\n');
          await copyText(text);
          downloadText('invite-keys.txt', text + '\n');
        }
        await loadAdmin();
      }catch(err){ show(err.message, true); }
    };
  }
  const lookupPortForm = document.querySelector('#lookupPortForm');
  if(lookupPortForm){
    lookupPortForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/risk/lookup-port', {method:'POST', body:Object.fromEntries(fd)});
        renderRiskResult(r);
      }catch(err){ show(err.message, true); }
    };
  }
}
function renderRiskResult(data){
  const box = document.querySelector('#riskResult');
  const matches = data.matches || [];
  const logs = data.logs || [];
  const rows = matches.map(m => `
    <tr>
      <td>${esc(m.region || '-')} / ${esc(m.node_name || '-')}</td><td>${esc(m.port)}</td><td>${esc(m.username || '未分配')}</td>
      <td>${m.active === 1 ? '<span class="ok">启用</span>' : (m.username ? '<span class="bad">停用</span>' : '-')}</td>
      <td>${esc(m.tunnel_name || '-')}</td><td>${esc(m.proxy_type || '-')}</td><td>${m.local_ip ? `${esc(m.local_ip)}:${esc(m.local_port)}` : '-'}</td>
      <td>${m.user_id ? `<button class="danger" onclick="banUser(${m.user_id})">封禁用户</button>` : '-'}</td>
    </tr>`).join('') || emptyRow(8, '没有查到该端口');
  const logRows = logs.map(l => `<tr><td>${esc(l.event)}</td><td>${esc(l.username || '-')}</td><td>${esc(l.detail || '')}</td><td>${fmtTs(l.created_at)}</td></tr>`).join('') || emptyRow(4, '该端口暂无日志');
  box.innerHTML = `
    <div class="section-title"><h3>查询结果</h3><p>如确认违规，可直接封禁用户</p></div>
    <table><thead><tr><th>节点</th><th>端口</th><th>用户</th><th>账号状态</th><th>隧道</th><th>协议</th><th>本地服务</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="section-title"><h3>端口相关日志</h3><p>最近 30 条</p></div>
    <table><thead><tr><th>事件</th><th>用户</th><th>详情</th><th>时间</th></tr></thead><tbody>${logRows}</tbody></table>`;
}

async function banUser(id){
  const reason = prompt('请输入封禁原因', '违法/违规内容投诉');
  if(reason === null) return;
  await api('/api/admin/users/ban', {method:'POST', body:{id, reason}}).then(r=>{show(r.message || '已封禁'); loadAdmin();}).catch(e=>show(e.message,true));
}

async function backupToR2(){
  if(!confirm('现在生成全量备份并上传到 Cloudflare R2？')) return;
  await api('/api/admin/backup/r2', {method:'POST', body:{}}).then(r=>{
    show(`${r.message}：${r.object_key}`);
    loadAdmin();
  }).catch(e=>show(e.message,true));
}

async function adminToggle(id){ await api('/api/admin/users/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function adminExtend(id){ await api('/api/admin/users/extend', {method:'POST', body:{id, days:30}}).then(r=>{show(r.message||'已续期'); loadAdmin();}).catch(e=>show(e.message,true)); }
async function adminReset(id){ if(confirm('重置该用户密码？')) await api('/api/admin/users/reset-password', {method:'POST', body:{id}}).then(r=>{show(r.message); loadAdmin();}).catch(e=>show(e.message,true)); }
async function adminResetLicense(id){ if(confirm('重置授权码会同时解绑机器，旧授权立即失效，确定？')) await api('/api/admin/users/reset-license', {method:'POST', body:{id}}).then(r=>{show(r.message); if(r.license_key) copyText(r.license_key); loadAdmin();}).catch(e=>show(e.message,true)); }
async function adminUnbind(id){ if(confirm('解绑后该授权会在下一台机器首次连接时重新绑定，确定？')) await api('/api/admin/users/unbind-machine', {method:'POST', body:{id}}).then(r=>{show(r.message || '已解绑'); loadAdmin();}).catch(e=>show(e.message,true)); }
async function adminDelete(id){ if(confirm('删除用户会释放端口并删除隧道，确定？')) await api('/api/admin/users/delete', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function inviteToggle(id){ await api('/api/admin/invite-keys/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function inviteDelete(id){ if(confirm('删除这个注册密钥？')) await api('/api/admin/invite-keys/delete', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function softwareLicenseToggle(id){ await api('/api/admin/software-licenses/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function softwareLicenseUnbind(id){ if(confirm('解绑后该授权码可被下一台客户服务器重新激活，确定？')) await api('/api/admin/software-licenses/unbind', {method:'POST', body:{id}}).then(r=>{show(r.message || '已解绑'); loadAdmin();}).catch(e=>show(e.message,true)); }
function editNode(n){
  const card = document.querySelector('#editNodeCard');
  const f = document.querySelector('#editNodeForm');
  card.classList.remove('hidden');
  for(const k of ['id','region','name','server_addr','server_port','auth_token','note']) f.elements[k].value = n[k] ?? '';
  f.elements.active.value = n.active ? '1' : '0';
  card.scrollIntoView({behavior:'smooth', block:'start'});
}
async function nodeToggle(id){ await api('/api/admin/nodes/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function nodeDelete(id){ if(confirm('删除节点会删除空端口池；节点下有用户/隧道时会被拒绝。确定？')) await api('/api/admin/nodes/delete', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }

loadMe();
