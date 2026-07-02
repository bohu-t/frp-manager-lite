const app = document.querySelector('#app');
const nav = document.querySelector('#nav');
const flash = document.querySelector('#flash');
let currentUser = null;
let softwareLicense = null;
let currentAdminSection = 'users';
let adminDashboardTimer = null;
let csrfToken = null;
let colorMode = localStorage.getItem('fml_color_mode') || 'system';
let adminPages = {users:1, keys:1, nodes:1, risk:1};
let adminProxyPage = 1;
let adminProxyPageSize = 20;
let adminProxyUserFilter = '';
let nodeHealthPage = 1;
let tunnelModalOpen = false;
let adminFrpcModalOpen = false;
let tunnelFormDraft = {};
let adminFrpcUsers = [];
let adminFrpcDraftRows = [{name:'web', proxy_type:'tcp', local_ip:'127.0.0.1', local_port:'80', remote_port:'', custom_domains:'', secret_key:''}];
const ADMIN_PAGE_SIZE = 10;
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
  const onSystemThemeChange = () => { if(colorMode === 'system') applyColorMode('system'); };
  if(systemDarkQuery.addEventListener) systemDarkQuery.addEventListener('change', onSystemThemeChange);
  else if(systemDarkQuery.addListener) systemDarkQuery.addListener(onSystemThemeChange);
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

function absoluteUrl(path){
  return new URL(path, window.location.origin).toString();
}

function userDeployScriptUrl(user){
  if(!user || !user.token) return '';
  return absoluteUrl(`/config/deploy-frpc.sh?token=${encodeURIComponent(user.token)}`);
}

function userDeployScriptCommand(user){
  const url = userDeployScriptUrl(user);
  return url ? `curl -fsSL '${url}' | sudo bash` : '';
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
          <div><b>服务器授权</b><span>安装时鉴权一次</span></div>
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

function tunnelMappingStatusHtml(t){
  const status = t.mapping_status || (t.enabled ? 'unknown' : 'disabled');
  const cls = status === 'online' ? 'ok' : (status === 'registered' ? 'warn' : (status === 'disabled' ? 'muted' : 'bad'));
  const label = status === 'online' ? '已映射' : (status === 'registered' ? '已注册' : (status === 'disabled' ? '已停用' : '未连接'));
  const message = t.mapping_message || '';
  return `<span class="${cls}">${label}</span>${message ? `<div class="muted small status-note">${esc(message)}</div>` : ''}`;
}

function fmtBytes(n){
  n = Number(n || 0);
  if(n < 1024) return `${n} B`;
  if(n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if(n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function userDeployScriptAddressHtml(user, opts={}){
  const url = userDeployScriptUrl(user);
  const cmd = userDeployScriptCommand(user);
  if(!url) return '';
  const scope = opts.scope || 'current';
  const copyUrl = scope === 'admin' ? `copyText(userDeployScriptUrl(selectedAdminFrpcUser()))` : `copyText(userDeployScriptUrl(currentUser))`;
  const copyCmd = scope === 'admin' ? `copyText(userDeployScriptCommand(selectedAdminFrpcUser()))` : `copyText(userDeployScriptCommand(currentUser))`;
  const title = opts.title || '部署脚本地址（可选）';
  const desc = opts.desc || '适合在客户服务器上直接拉取部署；这个地址包含账号令牌，请不要公开转发。';
  return `<section class="card deploy-script-card">
    <div class="section-title"><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>
    <div class="deploy-script-grid">
      <div class="deploy-script-item"><div class="label">脚本地址</div><div class="copy-line"><code class="token deploy-token">${esc(url)}</code><button type="button" class="secondary" onclick="${copyUrl}">复制地址</button></div></div>
      <div class="deploy-script-item"><div class="label">一键部署命令</div><div class="copy-line"><code class="token deploy-token">${esc(cmd)}</code><button type="button" class="secondary" onclick="${copyCmd}">复制命令</button></div></div>
    </div>
  </section>`;
}

function adminDeployScriptAddressHtml(){
  const user = selectedAdminFrpcUser();
  if(!user) return '<p class="muted small">请选择普通用户后显示部署脚本地址。</p>';
  return userDeployScriptAddressHtml(user, {
    scope: 'admin',
    title: `用户 ${user.username || ''} 的部署脚本地址`,
    desc: '给该普通用户复制脚本地址或一键命令；地址包含用户令牌，请只发给对应客户。',
  });
}

function renderAdminDeployScriptAddress(){
  const box = document.querySelector('#adminDeployScriptAddress');
  if(box) box.innerHTML = adminDeployScriptAddressHtml();
}

function userFrpsDashboardHtml(dash){
  if(!dash || !dash.enabled){
    return `<section class="card"><div class="section-title"><h2>我的映射监控</h2><p>${esc(dash?.error || '暂未接入 frps dashboard')}</p></div><p class="muted small">当前仍可通过“映射状态”列查看端口连通性。</p></section>`;
  }
  const rows = (dash.proxies || []).map(p => `
    <tr>
      <td>${esc(p.name)}</td><td>${esc(p.type)}</td><td>${p.status === 'online' ? '<span class="ok">online</span>' : `<span class="bad">${esc(p.status || 'unknown')}</span>`}</td>
      <td>${esc(p.remote_port || (Array.isArray(p.custom_domains) ? p.custom_domains.join(', ') : p.custom_domains) || '-')}</td>
      <td>${esc(p.cur_conns || 0)}</td><td>${fmtBytes(p.today_traffic_in)} / ${fmtBytes(p.today_traffic_out)}</td>
      <td>${esc(p.client_version || '-')}</td><td>${esc(p.last_start_time || '-')}</td>
    </tr>`).join('') || emptyRow(8, '当前没有在线映射');
  return `<section class="card"><div class="section-title"><h2>我的映射监控</h2><p>只显示当前账号的 frps 代理，不会看到其他用户。</p></div><table class="compact-table"><thead><tr><th>名称</th><th>类型</th><th>状态</th><th>公网端口/域名</th><th>连接数</th><th>今日入/出</th><th>客户端</th><th>启动时间</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function clampPage(page, total, pageSize){
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  return Math.min(Math.max(1, Number(page || 1)), pages);
}

function pageItems(items, page, pageSize){
  const p = clampPage(page, items.length, pageSize);
  return items.slice((p - 1) * pageSize, p * pageSize);
}

function paginationHtml(target, page, total, pageSize){
  const pages = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  if(total <= pageSize) return `<div class="pager muted small">共 ${total} 条</div>`;
  const current = clampPage(page, total, pageSize);
  return `
    <div class="pager">
      <button class="secondary" ${current <= 1 ? 'disabled' : ''} onclick="setPage('${target}', ${current - 1})">上一页</button>
      <span class="muted small">第 ${current} / ${pages} 页 · 共 ${total} 条</span>
      <button class="secondary" ${current >= pages ? 'disabled' : ''} onclick="setPage('${target}', ${current + 1})">下一页</button>
    </div>`;
}

function setPage(target, page){
  if(target === 'health'){
    nodeHealthPage = page;
    return loadAdminDashboard();
  }
  adminPages[target] = page;
  return loadAdmin(target);
}

function nodeHealthPageSize(){
  const h = window.innerHeight || 760;
  if(h >= 1050) return 12;
  if(h >= 860) return 9;
  if(h >= 700) return 7;
  return 5;
}

function fmtTs(ts){
  if(!ts) return '-';
  return new Date(ts * 1000).toLocaleString();
}

function navButton(label, action, cls='secondary', section=''){
  const active = section && currentAdminSection === section ? ' primary' : '';
  const sectionAttr = section ? ` data-section="${section}"` : '';
  return `<button type="button" class="${cls}${active}" data-nav="${action}"${sectionAttr}>${label}</button>`;
}

function setNav(){
  const themeBtn = navButton(`${colorMode === 'dark' ? '浅色' : '深色'}模式`, 'theme');
  if(!currentUser){ nav.innerHTML = themeBtn; return; }
  const licenseRequired = !!(softwareLicense && softwareLicense.required && !softwareLicense.licensed);
  const isAdmin = currentUser.role === 'admin';
  const adminNav = isAdmin && !licenseRequired ? [
    navButton('用户', 'admin', 'secondary', 'users'),
    navButton('密钥', 'admin', 'secondary', 'keys'),
    navButton('节点', 'admin', 'secondary', 'nodes'),
    navButton('映射监控', 'admin-proxies', 'secondary', 'proxies'),
    navButton('风控', 'admin', 'secondary', 'risk'),
  ].join('') : '';
  const mainNav = licenseRequired && isAdmin ? navButton('软件授权', 'license') : (
    licenseRequired ? '' : (isAdmin ? navButton('仪表盘', 'admin-dashboard') : navButton('概览', 'dashboard'))
  );
  nav.innerHTML = `
    ${mainNav}
    ${adminNav}
    ${licenseRequired || isAdmin ? '' : '<a class="btn" href="/config/frpc.toml">frpc 配置</a><a class="btn secondary" href="/config/deploy-frpc.sh">部署脚本</a>'}
    ${themeBtn}
    ${navButton('退出', 'logout', 'danger')}
  `;
}

function closestNavElement(target){
  let el = target;
  while(el && el !== nav){
    if(el.getAttribute && el.getAttribute('data-nav')) return el;
    el = el.parentNode;
  }
  return null;
}

nav.addEventListener('click', async (e) => {
  const el = closestNavElement(e.target);
  if(!el) return;
  e.preventDefault();
  const action = el.getAttribute('data-nav');
  const section = el.getAttribute('data-section') || 'users';
  try{
    if(action === 'theme') return toggleColorMode();
    if(action === 'logout') return logout();
    if(action === 'license') return renderLicenseActivate();
    if(action === 'dashboard') return loadDashboard();
    if(action === 'admin-dashboard') return loadAdminDashboard();
    if(action === 'admin-proxies') return loadAdminProxies();
    if(action === 'admin') return loadAdmin(section);
  }catch(err){
    show(err.message || '操作失败', true);
  }
});

async function renderLogin(){
  clearAdminDashboardTimer();
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
  clearAdminDashboardTimer();
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
        <p>请联系卖家获取<strong>鉴权密钥</strong>。只在安装/首次部署时鉴权一次，成功后会在本机保存授权文件；重装后机器指纹一致会自动通过。</p>
        <div class="feature-grid">
          <div><b>首次验证</b><span>安装时向鉴权服务器验证</span></div>
          <div><b>本机授权文件</b><span>重装后自动读取校验</span></div>
          <div><b>防篡改</b><span>签名与机器指纹校验</span></div>
        </div>
        <div class="hero-label">服务器指纹</div>
        <div class="hero-points"><span><code style="word-break:break-all">${esc(machineId)}</code></span></div>
      </section>
      <section class="auth-card card">
        <div class="section-title"><h2>激活授权</h2><p>${esc(lic.message || '请填写卖家提供的以下信息')}</p></div>
        <form id="licenseActivateForm" class="stack-form">
          <label>鉴权密钥</label>
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
  clearAdminDashboardTimer();
  hideFlash();
  setNav();
  const lic = softwareLicense || {};
  app.innerHTML = `
    <section class="card">
      <div class="section-title"><h2>软件授权激活</h2><p>输入卖家给你的鉴权密钥；只在安装时鉴权一次，成功后生成本机授权文件，重装后自动读取并校验机器指纹。</p></div>
      <div class="grid">
        <div><div class="label">授权状态</div><p>${esc(lic.message || '待激活')}</p></div>
        <div><div class="label">当前机器指纹</div><p><code class="token">${esc(lic.machine_id || '-')}</code></p><p class="muted small">仅用于本机授权文件校验，客户不需要复制给卖家。</p></div>
        <div><div class="label">授权文件</div><p><code class="token">${esc(lic.license_file || '-')}</code></p><p class="muted small">请随部署数据一起保留；机器指纹一致时重装无需重新鉴权。</p></div>
      </div>
      <form id="licenseActivateForm" class="stack-form">
        <label>鉴权密钥</label><input name="license_key" placeholder="FMLD-..." required>
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
  clearAdminDashboardTimer();
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
  const isAdmin = data.user.role === 'admin';
  if(isAdmin){ loadAdminDashboard(); return; }
  const used = new Set(data.tunnels.map(t => t.remote_port));
  const ps = data.port_stats || {};
  
  // Port summary — show all known ports only when under 200; otherwise summary card
  let portsHtml;
  if (data.ports.length > 0 && data.ports.length <= 200) {
    portsHtml = data.ports.map(p => `<span class="${used.has(p) ? 'used' : ''}">${p}</span>`).join('');
  } else {
    const usedPorts = data.tunnels.filter(t => t.remote_port).map(t => `<span class="used">${t.remote_port} (${t.name})</span>`).join('');
    portsHtml = `<div class="ports-summary"><strong>端口池</strong>：${ps.total || 0} 个 · 已用 ${ps.used || 0} 个 · 可用 ${ps.free || 0} 个</div>
      ${usedPorts ? `<div><strong>已用的端口：</strong>${usedPorts}</div>` : '<p class="muted small">暂无已使用的端口</p>'}`;
  }
  const tunnelRows = data.tunnels.map(t => {
    const endpoint = ['tcp','udp'].includes(t.proxy_type) ? esc(t.remote_port || '-') : (t.custom_domains ? esc(t.custom_domains) : (t.secret_key ? `secretKey: ${esc(t.secret_key)}` : '-'));
    return `
    <tr>
      <td>${esc(t.name)}</td><td>${esc(t.proxy_type)}</td><td>${esc(t.local_ip)}:${esc(t.local_port)}</td><td>${endpoint}</td>
      <td>${t.enabled ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td>${tunnelMappingStatusHtml(t)}</td>
      <td class="actions"><button onclick="loadDashboard()">刷新</button><button onclick="toggleTunnel(${t.id})">切换</button><button class="danger" onclick="deleteTunnel(${t.id})">删除</button></td>
    </tr>`;
  }).join('') || emptyRow(7, '还没有隧道');
  const portOptions = data.ports.map(p => `<option value="${p}">${p}${used.has(p) ? '（已用）' : ''}</option>`).join('');
  // Dropdown only for non-admin with reasonable port count; admin or huge lists get number input
  const portCount = ps.total || data.ports.length;
  const remotePortField = (portCount > 500)
    ? `<input name="remote_port" type="number" min="1" max="65535" placeholder="输入端口号">`
    : `<select name="remote_port">${portOptions}</select>`;
  const proxyTypeOptions = (data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux']).map(t => `<option value="${t}">${t}</option>`).join('');
  app.innerHTML = `
    <div class="grid">
      <section class="card stat"><div class="label">当前账号</div><div class="num">${esc(data.user.username)}</div><p>地区节点：<b>${esc(data.node?.region || '-')} / ${esc(data.node?.name || '-')}</b></p><p>端口上限：${esc(data.user.max_ports)} · 到期：<b>${esc(data.user.expires_text)}</b></p></section>
      <section class="card stat"><div class="label">FRPS 接入点</div><div class="num" style="font-size:20px">${esc(data.frps.addr)}</div><p>端口：<code>${esc(data.frps.port)}</code></p><p class="row"><a class="btn" href="/config/frpc.toml">下载 frpc.toml</a><a class="btn secondary" href="/config/deploy-frpc.sh">下载部署脚本</a></p><p class="muted small">全协议：${(data.allowed_proxy_types || []).join(' / ')}</p></section>
    </div>
    ${isAdmin ? '' : userDeployScriptAddressHtml(data.user)}
    ${isAdmin ? '' : userFrpsDashboardHtml(data.frps_user_dashboard)}
    ${isAdmin ? '' : `<section class="card"><div class="section-title"><h2>已分配端口</h2><p>绿色表示已经创建隧道</p></div><div class="ports">${portsHtml}</div></section>`}
    <section class="card tunnel-config-entry"><div class="section-title"><h2>隧道配置</h2><p>在页面内弹出配置页，填写后创建新隧道。</p></div><button onclick="openTunnelModal()">新建隧道</button><p class="muted small">TCP/UDP 使用分配端口；HTTP/HTTPS/TCPMUX 使用自定义域名；STCP/XTCP 使用密钥。</p></section>
    <div id="tunnelModal" class="modal-backdrop${tunnelModalOpen ? '' : ' hidden'}" role="dialog" aria-modal="true" aria-labelledby="tunnelModalTitle">
      <section class="modal-page card">
        <div class="section-title modal-title"><div><h2 id="tunnelModalTitle">新建隧道</h2><p>填写本地服务和公网访问方式。</p></div><button type="button" class="secondary modal-close" onclick="closeTunnelModal()" aria-label="关闭隧道配置">关闭 ×</button></div>
        <form id="tunnelForm" class="grid">
          <div><label>名称</label><input name="name" value="${esc(tunnelFormDraft.name || '')}" placeholder="web" required></div>
          <div><label>类型</label><select name="proxy_type" id="proxyTypeSelect">${proxyTypeOptions}</select></div>
          <div><label>本地 IP</label><input name="local_ip" value="${esc(tunnelFormDraft.local_ip || '127.0.0.1')}" required></div>
          <div><label>本地端口</label><input name="local_port" type="number" min="1" max="65535" value="${esc(tunnelFormDraft.local_port || '80')}" required></div>
          <div class="remote-port-field"><label>公网端口</label>${remotePortField}</div>
          <div class="domain-field hidden"><label>自定义域名</label><input name="custom_domains" value="${esc(tunnelFormDraft.custom_domains || '')}" placeholder="app.example.com,api.example.com"></div>
          <div class="secret-field hidden"><label>访问密钥</label><input name="secret_key" value="${esc(tunnelFormDraft.secret_key || '')}" placeholder="留空自动生成"></div>
          <div class="form-actions"><button>创建</button></div>
        </form>
        <p class="muted small">HTTP/HTTPS/TCPMUX 需要 frps 已配置 vhostHTTPPort / vhostHTTPSPort / tcpmuxHTTPConnectPort 等对应能力。</p>
      </section>
    </div>
    <section class="card"><div class="section-title"><h2>隧道列表</h2><p>“映射状态”会检测公网端口或 frpc 注册状态；修改后请重新下载 frpc.toml 并重启 frpc。</p></div><table><thead><tr><th>名称</th><th>类型</th><th>本地服务</th><th>公网端口/域名/密钥</th><th>配置状态</th><th>映射状态</th><th>操作</th></tr></thead><tbody>${tunnelRows}</tbody></table></section>`;
  const proxyTypeSelect = document.querySelector('#proxyTypeSelect');
  if(tunnelFormDraft.proxy_type) proxyTypeSelect.value = tunnelFormDraft.proxy_type;
  const tunnelForm = document.querySelector('#tunnelForm');
  if(tunnelForm && tunnelFormDraft.remote_port && tunnelForm.elements.remote_port) tunnelForm.elements.remote_port.value = tunnelFormDraft.remote_port;
  const saveTunnelDraft = () => {
    const form = document.querySelector('#tunnelForm');
    if(form) tunnelFormDraft = Object.fromEntries(new FormData(form));
  };
  if(tunnelForm) tunnelForm.oninput = saveTunnelDraft;
  const syncProxyFields = () => {
    saveTunnelDraft();
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
      tunnelFormDraft = {};
      closeTunnelModal();
      show('隧道已创建，重新下载 frpc.toml 后重启 frpc 生效');
      await loadDashboard();
    }catch(err){ show(err.message, true); }
  };
}

function openTunnelModal(){
  tunnelModalOpen = true;
  const modal = document.querySelector('#tunnelModal');
  if(modal) modal.classList.remove('hidden');
}
function closeTunnelModal(){
  tunnelModalOpen = false;
  const modal = document.querySelector('#tunnelModal');
  if(modal) modal.classList.add('hidden');
}

async function toggleTunnel(id){ await api('/api/tunnels/toggle', {method:'POST', body:{id}}).then(loadDashboard).catch(e=>show(e.message,true)); }
async function deleteTunnel(id){ if(confirm('删除这个隧道？')) await api('/api/tunnels/delete', {method:'POST', body:{id}}).then(loadDashboard).catch(e=>show(e.message,true)); }

async function loadAdminProxies(page=adminProxyPage){
  clearAdminDashboardTimer();
  hideFlash();
  currentAdminSection = 'proxies';
  adminProxyPage = Math.max(1, Number(page || 1));
  setNav();
  let data;
  try{
    const qs = new URLSearchParams({page:String(adminProxyPage), page_size:String(adminProxyPageSize)});
    if(adminProxyUserFilter) qs.set('username', adminProxyUserFilter);
    data = await api('/api/admin/frps-proxies?' + qs.toString());
  }catch(err){ show(err.message, true); return; }
  const dash = data.dashboard || {};
  const total = Number(dash.total || 0);
  const pageSize = Number(dash.page_size || adminProxyPageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  adminProxyPage = Math.min(Math.max(1, Number(dash.page || adminProxyPage)), pages);
  const rows = (dash.proxies || []).map(p => `
    <tr>
      <td>${esc(p.username || '-')}</td><td>${esc(p.name || '-')}</td><td>${esc(p.type || '-')}</td>
      <td>${p.status === 'online' ? '<span class="ok">online</span>' : `<span class="bad">${esc(p.status || 'unknown')}</span>`}</td>
      <td>${esc(p.remote_port || (Array.isArray(p.custom_domains) ? p.custom_domains.join(', ') : p.custom_domains) || '-')}</td>
      <td>${esc(p.cur_conns || 0)}</td><td>${fmtBytes(p.today_traffic_in)} / ${fmtBytes(p.today_traffic_out)}</td>
      <td>${esc(p.client_version || '-')}</td><td>${esc(p.last_start_time || '-')}</td><td>${esc(p.last_close_time || '-')}</td>
    </tr>`).join('') || emptyRow(10, dash.enabled ? '暂无映射数据' : (dash.error || 'frps dashboard 未接入'));
  app.innerHTML = `
    <section class="card dashboard-hero"><div><div class="eyebrow">FRPS MONITOR</div><h2>映射监控</h2><p>管理员全局视图；普通用户页面仍只显示自己的映射。</p></div><div class="hero-actions"><button onclick="loadAdminProxies(${adminProxyPage})">刷新</button><button class="secondary" onclick="loadAdminDashboard()">返回仪表盘</button></div></section>
    <section class="card admin-toolbar row">
      <label>用户筛选 <input id="adminProxyUserFilter" value="${esc(adminProxyUserFilter)}" placeholder="留空显示全部"></label>
      <label>每页显示 <select id="adminProxyPageSize"><option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
      <button id="adminProxyApply">应用</button>
      <button class="secondary" id="adminProxyClear">清空</button>
      <span class="muted small">共 ${total} 条 · 第 ${adminProxyPage} / ${pages} 页</span>
    </section>
    <section class="card"><table><thead><tr><th>用户</th><th>名称</th><th>类型</th><th>状态</th><th>公网端口/域名</th><th>连接数</th><th>今日入/出</th><th>客户端</th><th>启动时间</th><th>关闭时间</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="pager"><button class="secondary" ${adminProxyPage <= 1 ? 'disabled' : ''} onclick="loadAdminProxies(${adminProxyPage - 1})">上一页</button><span class="muted small">第 ${adminProxyPage} / ${pages} 页</span><button class="secondary" ${adminProxyPage >= pages ? 'disabled' : ''} onclick="loadAdminProxies(${adminProxyPage + 1})">下一页</button></div>
    </section>`;
  const sizeSel = document.querySelector('#adminProxyPageSize');
  if(sizeSel) sizeSel.value = String(adminProxyPageSize);
  document.querySelector('#adminProxyApply').onclick = () => {
    adminProxyUserFilter = document.querySelector('#adminProxyUserFilter').value.trim();
    adminProxyPageSize = Number(document.querySelector('#adminProxyPageSize').value || 20);
    adminProxyPage = 1;
    loadAdminProxies(1);
  };
  document.querySelector('#adminProxyClear').onclick = () => {
    adminProxyUserFilter = '';
    adminProxyPage = 1;
    loadAdminProxies(1);
  };
}

async function loadAdmin(section=currentAdminSection){
  clearAdminDashboardTimer();
  hideFlash();
  currentAdminSection = ['users','keys','nodes','risk'].includes(section) ? section : currentAdminSection;
  setNav();
  let data;
  try{ data = await api('/api/admin/overview'); }
  catch(err){ show(err.message, true); return; }
  softwareLicense = data.software_license || softwareLicense;
  setNav();
  adminPages[currentAdminSection] = adminPages[currentAdminSection] || 1;
  const usersPage = clampPage(adminPages.users, (data.users || []).length, ADMIN_PAGE_SIZE);
  const keysPage = clampPage(adminPages.keys, (data.invite_keys || []).length, ADMIN_PAGE_SIZE);
  const nodesPage = clampPage(adminPages.nodes, (data.nodes || []).length, ADMIN_PAGE_SIZE);
  const riskPage = clampPage(adminPages.risk, (data.logs || []).length, ADMIN_PAGE_SIZE);
  adminPages.users = usersPage; adminPages.keys = keysPage; adminPages.nodes = nodesPage; adminPages.risk = riskPage;
  const usersSlice = pageItems(data.users || [], usersPage, ADMIN_PAGE_SIZE);
  const keysSlice = pageItems(data.invite_keys || [], keysPage, ADMIN_PAGE_SIZE);
  const nodesSlice = pageItems(data.nodes || [], nodesPage, ADMIN_PAGE_SIZE);
  const logsSlice = pageItems(data.logs || [], riskPage, ADMIN_PAGE_SIZE);
  const rows = usersSlice.map(u => `
    <tr>
      <td>${u.id}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(u.node_region || '-')} / ${esc(u.node_name || '-')}</td><td>${u.port_count}/${u.max_ports}</td><td>${u.tunnel_count}</td>
      <td>${esc(u.expires_text)} ${u.expired ? '<span class="bad">已到期</span>' : ''}</td>
      <td>${u.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td><code class="token" title="${esc(u.invite_key_used || '')}">${esc(u.invite_key_used || '后台创建')}</code></td>
      <td class="actions">
        <button onclick="adminToggle(${u.id})">${u.active ? '停用' : '启用'}</button>
        <button onclick="adminExtend(${u.id})">续30天</button>
        <button onclick="adminReset(${u.id})">重置密码</button>
        <button class="danger" onclick="adminDelete(${u.id})">删除</button>
      </td>
    </tr>`).join('');
  const nodeRows = nodesSlice.map(n => `
    <tr>
      <td>${n.id}</td><td>${esc(n.region)}</td><td>${esc(n.name)}</td><td>${esc(n.server_addr)}:${n.server_port}</td>
      <td>${n.port_start}-${n.port_end}</td><td>${n.free_count}/${n.port_count}</td>
      <td>${n.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td>${esc(n.note)}</td>
      <td class="actions"><button onclick='editNode(${JSON.stringify(n)})'>编辑</button><button onclick="nodeToggle(${n.id})">${n.active ? '停用' : '启用'}</button><a class="btn" href="/config/frps.example.toml?node_id=${n.id}">frps配置</a><button class="danger" onclick="nodeDelete(${n.id})">删除</button></td>
    </tr>`).join('') || emptyRow(9, '还没有节点');
  const keyRows = keysSlice.map(k => `
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
  const logRows = logsSlice.map(l => `
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
    <section class="card" id="nodes"><div class="section-title"><h2>地区节点列表</h2><p>启用节点优先，剩余端口多的排前面</p></div><table><thead><tr><th>ID</th><th>地区</th><th>节点</th><th>frps</th><th>端口池</th><th>剩余</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>${nodeRows}</tbody></table>${paginationHtml('nodes', nodesPage, (data.nodes || []).length, ADMIN_PAGE_SIZE)}</section>`;
  const keysHtml = `
    <section class="card" id="keys"><div class="section-title"><h2>生成注册密钥</h2><p>注册密钥固定单次使用，适合批量发货</p></div><form id="inviteForm" class="grid">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/套餐名"></div>
      <div><label>每枚可用次数</label><input name="max_uses" type="number" value="1" min="1" max="1" disabled><span class="muted small">固定 1 次</span></div>
      <div><label>注册后端口数</label><input name="max_ports" type="number" value="5" min="1" max="100"></div>
      <div><label>注册后账号有效期天数</label><input name="user_expires_days" type="number" value="30" min="0" max="3650"></div>
      <div><label>密钥有效期天数</label><input name="key_expires_days" type="number" value="30" min="0" max="3650"></div>
      <div style="align-self:end"><button>生成密钥</button></div>
    </form><p><a class="btn" href="/admin/export/invite-keys.csv">导出未使用可用密钥 CSV</a></p><p class="panel-note small">批量生成后会自动复制并下载本次生成的 txt。CSV 导出只包含未使用、启用中、未过期的密钥。</p></section>
    <section class="card"><div class="section-title"><h2>注册密钥列表</h2><p>已使用密钥不会出现在 CSV 导出里</p></div><table><thead><tr><th>ID</th><th>密钥</th><th>备注</th><th>使用</th><th>端口</th><th>账号有效期</th><th>密钥到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${keyRows}</tbody></table>${paginationHtml('keys', keysPage, (data.invite_keys || []).length, ADMIN_PAGE_SIZE)}</section>
    ${data.software_license_authority ? `<section class="card" id="software-licenses"><div class="section-title"><h2>服务器软件授权码</h2><p>卖家后台使用：先批量生成授权码发给客户；客户输入授权码后自动绑定他的部署服务器。</p></div><form id="softwareLicenseForm" class="grid">
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
    <section class="card" id="users"><div class="section-title"><h2>用户列表</h2><p>管理状态、续期、注册密钥和删除账号</p></div><table><thead><tr><th>ID</th><th>用户</th><th>角色</th><th>地区节点</th><th>端口</th><th>隧道</th><th>到期</th><th>状态</th><th>注册密钥</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>${paginationHtml('users', usersPage, (data.users || []).length, ADMIN_PAGE_SIZE)}</section>`;
  const riskHtml = `
    <section class="card" id="risk"><div class="section-title"><h2>投诉处理 / 风控</h2><p>按端口定位用户并快速封禁</p></div>
      <form id="lookupPortForm" class="grid">
        <div><label>被投诉端口</label><input name="remote_port" type="number" min="1" max="65535" placeholder="例如 20088" required></div>
        <div><label>节点（可选）</label><select name="node_id"><option value="0">全部节点</option>${nodeOptions(data.nodes || [])}</select></div>
        <div style="align-self:end"><button>查询</button></div>
      </form>
      <div id="riskResult" class="risk-result"></div>
    </section>
    <section class="card"><div class="section-title"><h2>审计日志</h2><p>最近 80 条关键操作和风控事件</p></div><table><thead><tr><th>ID</th><th>事件</th><th>用户</th><th>端口</th><th>协议</th><th>详情</th><th>时间</th></tr></thead><tbody>${logRows}</tbody></table>${paginationHtml('risk', riskPage, (data.logs || []).length, ADMIN_PAGE_SIZE)}</section>`;
  const sectionHtml = {users: usersHtml, keys: keysHtml, nodes: nodeHtml, risk: riskHtml}[currentAdminSection] || usersHtml;
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
    loadAdminDashboard();
  }).catch(e=>show(e.message,true));
}

async function saveR2Config(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  try{
    const r = await api('/api/admin/r2/config', {method:'POST', body:Object.fromEntries(fd)});
    show(r.message || 'R2 配置已保存');
    await loadAdminDashboard();
  }catch(err){ show(err.message, true); }
}


function openAdminFrpcModal(){
  adminFrpcModalOpen = true;
  const modal = document.querySelector('#adminFrpcModal');
  if(modal) modal.classList.remove('hidden');
}
function closeAdminFrpcModal(){
  adminFrpcModalOpen = false;
  const modal = document.querySelector('#adminFrpcModal');
  if(modal) modal.classList.add('hidden');
}
function selectedAdminFrpcUser(){
  const form = document.querySelector('#adminFrpcForm');
  const userId = Number(form && form.user_id ? form.user_id.value : 0);
  return adminFrpcUsers.find(u => Number(u.id) === userId) || adminFrpcUsers[0] || null;
}
function adminFrpcPortOptions(value=''){
  const user = selectedAdminFrpcUser();
  const assigned = user && Array.isArray(user.assigned_ports) ? user.assigned_ports : [];
  const used = new Set(user && Array.isArray(user.used_remote_ports) ? user.used_remote_ports.map(Number) : []);
  const valueNum = Number(value || 0);
  const options = assigned.map(p => {
    const n = Number(p);
    const disabled = used.has(n) && n !== valueNum;
    return `<option value="${esc(n)}" ${String(n)===String(value)?'selected':''} ${disabled?'disabled':''}>${esc(n)}${disabled?'（已用）':''}</option>`;
  }).join('');
  return `<option value="">自动选择可用端口</option>${options}`;
}
function saveAdminFrpcDraft(){
  const form = document.querySelector('#adminFrpcForm');
  if(!form) return;
  adminFrpcDraftRows = [...form.querySelectorAll('.admin-frpc-row')].map(row => ({
    name: row.querySelector('[name="name"]')?.value || '',
    proxy_type: row.querySelector('[name="proxy_type"]')?.value || 'tcp',
    local_ip: row.querySelector('[name="local_ip"]')?.value || '127.0.0.1',
    local_port: row.querySelector('[name="local_port"]')?.value || '80',
    remote_port: row.querySelector('[name="remote_port"]')?.value || '',
    custom_domains: row.querySelector('[name="custom_domains"]')?.value || '',
    secret_key: row.querySelector('[name="secret_key"]')?.value || '',
  }));
}
function adminFrpcRowHtml(row={}, idx=0){
  const type = row.proxy_type || 'tcp';
  return `<div class="admin-frpc-row" data-index="${idx}">
    <div class="section-title mini-title"><h3>隧道 ${idx + 1}</h3><p>${idx === 0 ? '默认第一条，可继续添加更多隧道' : `<button type="button" class="secondary" onclick="removeAdminFrpcRow(${idx})">删除</button>`}</p></div>
    <div class="grid">
      <div><label>隧道名称</label><input name="name" value="${esc(row.name || `web${idx ? idx + 1 : ''}`)}" required></div>
      <div><label>类型</label><select name="proxy_type" onchange="syncAdminFrpcFields()">${(window.adminProxyTypeOptions || ['tcp','udp','http','https','stcp','xtcp','tcpmux']).map(t => `<option value="${esc(t)}" ${t===type?'selected':''}>${esc(t)}</option>`).join('')}</select></div>
      <div><label>本地 IP</label><input name="local_ip" value="${esc(row.local_ip || '127.0.0.1')}" required></div>
      <div><label>本地端口</label><input name="local_port" type="number" min="1" max="65535" value="${esc(row.local_port || '80')}" required></div>
      <div class="admin-remote-port-field"><label>公网端口</label><select name="remote_port">${adminFrpcPortOptions(row.remote_port || '')}</select></div>
      <div class="admin-domain-field hidden"><label>自定义域名</label><input name="custom_domains" value="${esc(row.custom_domains || '')}" placeholder="app.example.com"></div>
      <div class="admin-secret-field hidden"><label>访问密钥</label><input name="secret_key" value="${esc(row.secret_key || '')}" placeholder="留空自动生成"></div>
    </div>
  </div>`;
}
function renderAdminFrpcRows(){
  const box = document.querySelector('#adminFrpcRows');
  if(!box) return;
  box.innerHTML = adminFrpcDraftRows.map(adminFrpcRowHtml).join('');
  syncAdminFrpcFields();
}
function addAdminFrpcRow(){
  saveAdminFrpcDraft();
  adminFrpcDraftRows.push({name:`web${adminFrpcDraftRows.length + 1}`, proxy_type:'tcp', local_ip:'127.0.0.1', local_port:'80', remote_port:'', custom_domains:'', secret_key:''});
  renderAdminFrpcRows();
}
function removeAdminFrpcRow(idx){
  saveAdminFrpcDraft();
  if(adminFrpcDraftRows.length <= 1) return;
  adminFrpcDraftRows.splice(idx, 1);
  renderAdminFrpcRows();
}
function syncAdminFrpcFields(){
  const form = document.querySelector('#adminFrpcForm');
  if(!form) return;
  form.querySelectorAll('.admin-frpc-row').forEach(row => {
    const type = row.querySelector('[name="proxy_type"]').value;
    row.querySelector('.admin-remote-port-field').classList.toggle('hidden', !['tcp','udp'].includes(type));
    row.querySelector('.admin-domain-field').classList.toggle('hidden', !['http','https','tcpmux'].includes(type));
    row.querySelector('.admin-secret-field').classList.toggle('hidden', !['stcp','xtcp'].includes(type));
  });
}
async function downloadAdminFrpc(userId){
  const r = await api('/api/admin/frpc-config', {method:'POST', body:{user_id:userId}});
  downloadText(r.filename || 'frpc.toml', r.config || '');
  if(r.deploy_script) downloadText(r.script_filename || 'deploy-frpc.sh', r.deploy_script || '');
  show('frpc 配置和部署脚本已生成，请交给用户部署');
}
async function downloadAdminFrpcOnly(){
  const form = document.querySelector('#adminFrpcForm');
  if(!form) return;
  await downloadAdminFrpc(Number(form.user_id.value || 0));
}
async function submitAdminFrpc(e){
  e.preventDefault();
  const form = e.target;
  saveAdminFrpcDraft();
  const body = {user_id: Number(form.user_id.value || 0), tunnels: adminFrpcDraftRows};
  try{
    const r = await api('/api/admin/tunnels/create-for-user', {method:'POST', body});
    if(r.config) downloadText(r.filename || 'frpc.toml', r.config || '');
    if(r.deploy_script) downloadText(r.script_filename || 'deploy-frpc.sh', r.deploy_script || '');
    show(r.message || '隧道已创建并下载 frpc 配置和部署脚本');
    adminFrpcDraftRows = [{name:'web', proxy_type:'tcp', local_ip:'127.0.0.1', local_port:'80', remote_port:'', custom_domains:'', secret_key:''}];
    closeAdminFrpcModal();
    await loadAdminDashboard();
  }catch(err){ show(err.message, true); }
}
function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
async function restoreFullBackup(){
  const input = document.querySelector('#restoreBackupFile');
  const file = input && input.files && input.files[0];
  if(!file){ show('请先选择全量备份 zip 文件', true); return; }
  const confirmText = prompt('恢复会替换当前数据库。请输入 RESTORE 确认：');
  if(confirmText !== 'RESTORE') return;
  try{
    const dataUrl = await fileToDataUrl(file);
    const r = await api('/api/admin/backup/restore', {method:'POST', body:{filename:file.name, content_base64:dataUrl, confirm:'RESTORE'}});
    show(`${r.message}；恢复前备份：${r.restore && r.restore.pre_restore_backup ? r.restore.pre_restore_backup : '已保存'}`);
    await loadAdminDashboard();
  }catch(err){ show(err.message, true); }
}

async function adminToggle(id){ await api('/api/admin/users/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function adminExtend(id){ await api('/api/admin/users/extend', {method:'POST', body:{id, days:30}}).then(r=>{show(r.message||'已续期'); loadAdmin();}).catch(e=>show(e.message,true)); }
async function adminReset(id){ if(confirm('重置该用户密码？')) await api('/api/admin/users/reset-password', {method:'POST', body:{id}}).then(r=>{show(r.message); loadAdmin();}).catch(e=>show(e.message,true)); }
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

function clearAdminDashboardTimer(){
  if(adminDashboardTimer){ clearTimeout(adminDashboardTimer); adminDashboardTimer = null; }
}

function fmtBytes(bytes){
  bytes = Number(bytes || 0);
  if(!bytes) return '-';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while(bytes >= 1024 && i < units.length - 1){ bytes /= 1024; i++; }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function nodeStatusBadge(n){
  if(!n.active) return '<span class="muted">已停用</span>';
  if(n.auth_status === 'online') return '<span class="ok">正常</span>';
  if(n.auth_status === 'checking') return '<span class="muted">检查中…</span>';
  return '<span class="bad">异常</span>';
}


function copySetupKey(){
  const el = document.querySelector('#setupKeyValue');
  if(!el){ show('没有可复制的密钥', true); return; }
  copyText(el.textContent || '');
}

async function loadAdminDashboard(auto=false){
  hideFlash();
  clearAdminDashboardTimer();
  let data;
  try{ data = await api('/api/admin/dashboard'); }
  catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    if(!auto) show(err.message, true);
    return;
  }
  setNav();
  const refreshSeconds = Math.max(10, Number(data.refresh_seconds || 30));
  const nowText = new Date().toLocaleTimeString();
  const portStats = data.port_stats || {};
  const userStats = data.user_stats || {};
  const host = data.host || {};
  const r2 = data.r2 || {};
  const usedPorts = Number(portStats.used || 0);
  const totalPorts = Number(portStats.total || 0);
  const freePorts = Number(portStats.free || Math.max(0, totalPorts - usedPorts));
  const portUsage = totalPorts > 0 ? ((usedPorts / totalPorts) * 100).toFixed(1) : '0.0';
  const healthPageSize = nodeHealthPageSize();
  nodeHealthPage = clampPage(nodeHealthPage, (data.nodes || []).length, healthPageSize);
  const healthNodes = pageItems(data.nodes || [], nodeHealthPage, healthPageSize);
  const nodeRows = healthNodes.map(n => `
    <tr>
      <td><b>${esc(n.name)}</b><span class="muted small">${esc(n.server_addr || '')}:${esc(n.server_port || '')}</span></td>
      <td>${nodeStatusBadge(n)}<span class="muted small">${esc(n.auth_message || '')}</span></td>
      <td>${Number(n.port_count || 0) - Number(n.free_count || 0)} / ${n.port_count || 0}</td>
    </tr>`).join('') || emptyRow(3, '暂无节点');
  const setupHtml = data.has_setup_key ? `
    <div class="ops-item"><div class="label">一键添加节点密钥</div><div class="row"><code class="token" id="setupKeyValue">${esc(data.setup_key)}</code><button class="secondary" onclick="copySetupKey()">复制</button></div><p class="muted small">在新机器运行添加节点脚本时输入此密钥。</p></div>` :
    '<div class="ops-item"><div class="label">一键添加节点密钥</div><p class="muted small">未设置 FML_SETUP_KEY；需要一键添加节点时可在服务端配置。</p></div>';
  const r2Source = r2.source === 'database' ? '面板配置' : (r2.source === 'env' ? '环境变量兼容' : '未配置');
  const r2Status = r2.configured ? '<span class="ok">已配置</span>' : '<span class="bad">未配置</span>';
  const frpcUsers = data.frpc_users || [];
  adminFrpcUsers = frpcUsers;
  window.adminProxyTypeOptions = data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux'];
  const frpcUserOptions = frpcUsers.map(u => `<option value="${u.id}">${esc(u.username)} · ${esc(u.node_region || '-')} / ${esc(u.node_name || '-')} · 端口 ${u.port_count || 0} · 可用 ${(u.available_ports || []).length} · 隧道 ${u.tunnel_count || 0}</option>`).join('');
  const proxyTypeOptions = (data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux']).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  app.innerHTML = `
    <section class="dashboard-hero card">
      <div>
        <div class="eyebrow">ADMIN DASHBOARD</div>
        <h2>运行总览</h2>
        <p>节点健康、主机资源、备份和运维入口集中在这里。最后检查：${esc(nowText)}</p>
      </div>
      <div class="hero-actions">
        <button onclick="loadAdminDashboard()">立即刷新</button>
        <button class="secondary" onclick="loadAdmin('nodes')">节点管理</button>
      </div>
    </section>

    <div class="metric-grid">
      <section class="card stat"><div class="label">面板版本</div><div class="num">${esc(data.panel_version || data.version || '-')}</div><div class="sub">frp-manager-lite</div></section>
      <section class="card stat"><div class="label">节点在线</div><div class="num">${data.active_node_count}/${data.node_count}</div><div class="sub">每 ${refreshSeconds} 秒自动检查认证端口</div></section>
      <section class="card stat"><div class="label">端口使用率</div><div class="num">${portUsage}%</div><div class="sub">已用 ${usedPorts} · 空闲 ${freePorts} · 总数 ${totalPorts}</div></section>
      <section class="card stat"><div class="label">用户</div><div class="num">${userStats.active}/${userStats.total}</div><div class="sub">活跃用户 / 总用户</div></section>
      <section class="card stat"><div class="label">CPU</div><div class="num">${host.cpu_percent == null ? '-' : `${host.cpu_percent}%`}</div><div class="sub">${host.cpu_count || 0} 核 · load ${esc(host.load1 ?? '-')} / ${esc(host.load5 ?? '-')} / ${esc(host.load15 ?? '-')}</div></section>
      <section class="card stat"><div class="label">内存</div><div class="num">${host.memory_percent == null ? '-' : `${host.memory_percent}%`}</div><div class="sub">${fmtBytes(host.memory_used)} / ${fmtBytes(host.memory_total)}</div></section>
    </div>

    <section class="card"><div class="section-title"><h2>运维入口</h2><p>常用下载和备份操作</p></div>
      <div class="ops-list ops-grid">
        ${setupHtml}
        <div class="ops-item"><div class="label">下载模块</div><p class="row"><button onclick="openAdminFrpcModal()">下载 frpc 配置/部署脚本</button><a class="btn" href="/admin/backup/full.zip">下载全量备份</a></p><p class="muted small">管理员可先为普通用户配置隧道，再下载 frpc.toml 和 deploy-frpc.sh 给用户。</p></div>
        <div class="ops-item"><div class="label">恢复全量备份</div><p class="row"><input id="restoreBackupFile" type="file" accept=".zip,application/zip"><button class="danger" onclick="restoreFullBackup()">恢复备份</button></p><p class="muted small">会要求输入 RESTORE，并在恢复前自动保存当前备份。</p></div>
        <div class="ops-item"><div class="label">业务概况</div><p class="muted small">隧道 ${data.tunnel_count || 0} · 注册密钥 ${data.invite_key_count || 0} · 封禁记录 ${data.ban_count || 0}</p></div>
      </div>
    </section>

    <div id="adminFrpcModal" class="modal-backdrop${adminFrpcModalOpen ? '' : ' hidden'}" role="dialog" aria-modal="true" aria-labelledby="adminFrpcModalTitle">
      <section class="modal-page card admin-frpc-modal">
        <div class="section-title modal-title"><div><h2 id="adminFrpcModalTitle">为用户配置并下载 frpc</h2><p>选择普通用户，可一次添加多条隧道；TCP/UDP 公网端口从该用户已分配端口中选择。</p></div><button type="button" class="secondary modal-close" onclick="closeAdminFrpcModal()" aria-label="关闭 frpc 配置">关闭 ×</button></div>
        ${frpcUserOptions ? `<form id="adminFrpcForm">
          <div class="grid"><div><label>用户</label><select name="user_id" required onchange="saveAdminFrpcDraft(); renderAdminFrpcRows(); renderAdminDeployScriptAddress();">${frpcUserOptions}</select></div></div>
          <div id="adminDeployScriptAddress">${adminDeployScriptAddressHtml()}</div>
          <div id="adminFrpcRows" class="admin-frpc-rows"></div>
          <div class="form-actions"><button>创建隧道并下载</button><button type="button" class="secondary" onclick="addAdminFrpcRow()">添加一条隧道</button><button type="button" class="secondary" onclick="downloadAdminFrpcOnly()">只下载现有配置</button></div>
        </form>` : '<p class="muted">暂无普通用户，先创建用户后再下载 frpc 配置。</p>'}
      </section>
    </div>

    <section class="card node-health-card"><div class="section-title"><h2>节点健康</h2><p>检查 frps bind/auth 端口连通性 · 每页 ${healthPageSize} 条</p></div>
      <table class="compact-table"><thead><tr><th>节点</th><th>状态</th><th>端口使用</th></tr></thead><tbody>${nodeRows}</tbody></table>
      ${paginationHtml('health', nodeHealthPage, (data.nodes || []).length, healthPageSize)}
    </section>

    <section class="card"><div class="section-title"><h2>Cloudflare R2 备份配置</h2><p>${r2Status} · ${esc(r2Source)}</p></div>
      <form id="r2ConfigForm" class="grid r2-form">
        <div><label>Account ID</label><input name="account_id" value="${esc(r2.account_id || '')}" placeholder="Cloudflare Account ID"></div>
        <div><label>Access Key ID</label><input name="access_key_id" value="${esc(r2.access_key_id || '')}" placeholder="R2 API Token Access Key ID"></div>
        <div><label>Secret Access Key</label><input name="secret_access_key" type="password" placeholder="${r2.secret_set ? '已设置，留空则不修改' : 'R2 Secret Access Key'}"></div>
        <div><label>Bucket</label><input name="bucket" value="${esc(r2.bucket || '')}" placeholder="bucket-name"></div>
        <div><label>备份目录 Prefix</label><input name="prefix" value="${esc(r2.prefix || 'frp-manager-lite/backups')}" placeholder="frp-manager-lite/backups"></div>
        <div class="form-actions"><button>保存 R2 配置</button><button type="button" class="secondary" onclick="backupToR2()">保存后上传备份</button></div>
      </form>
      <p class="muted small">配置保存在本面板数据库中；Secret 不会明文回显。已有环境变量配置仍可作为兼容兜底。</p>
    </section>`;
  const r2Form = document.querySelector('#r2ConfigForm');
  if(r2Form) r2Form.onsubmit = saveR2Config;
  const adminFrpcForm = document.querySelector('#adminFrpcForm');
  if(adminFrpcForm){ adminFrpcForm.onsubmit = submitAdminFrpc; renderAdminDeployScriptAddress(); renderAdminFrpcRows(); }
  adminDashboardTimer = setTimeout(() => loadAdminDashboard(true), refreshSeconds * 1000);
}

loadMe();
