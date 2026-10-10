const app = document.querySelector('#app');
const nav = document.querySelector('#nav');
const flash = document.querySelector('#flash');
let currentUser = null;
let softwareLicense = null;
let currentAdminSection = 'users';
let adminDashboardTimer = null;
let tunnelPreviewTimer = null;
let csrfToken = null;
let colorMode = localStorage.getItem('fml_color_mode') || 'light';
let adminPages = {users:1, keys:1, nodes:1, risk:1};
let adminUserSearch = '';
let adminUserStatus = 'all';
let adminUserNode = '';
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

function iconSvg(name){
  const icons = {
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.7M6.2 6.8C3.9 8.4 2.5 12 2.5 12s3.5 6 9.5 6c1.1 0 2.1-.2 3-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
  };
  return icons[name] || '';
}

function togglePasswordVisibility(inputId, button){
  const input = document.getElementById(inputId);
  if(!input) return;
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  button.innerHTML = iconSvg(visible ? 'eye' : 'eyeOff');
  button.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
  button.title = visible ? '显示密码' : '隐藏密码';
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
  const regionText = (nodes || []).filter(n => n.active).map(n => n.region).filter(Boolean).slice(0, 3).join('、') || '多地区节点';
  return `
    <div class="auth-page">
      <header class="auth-topbar">
        <div class="auth-topbar-inner">
          <div class="auth-brand"><span class="auth-brand-mark">F</span><span>FRP 管理台</span></div>
          <div class="auth-topbar-tools"><span>安全、稳定、易用</span><button type="button" class="auth-theme-button" data-nav="theme" title="切换主题">◐</button></div>
        </div>
      </header>
      <main class="auth-main">
        <section class="auth-visual">
          <div class="auth-visual-glow auth-visual-glow-one"></div><div class="auth-visual-glow auth-visual-glow-two"></div>
          <div class="auth-visual-content">
            <div class="auth-visual-brand"><span class="auth-visual-mark">F</span><strong>FRP 管理台</strong></div>
            <h1>高效、专业的<br>内网穿透管理平台</h1>
            <p>统一管理隧道、端口和客户端配置，让每条映射都清晰可控。</p>
            <div class="auth-visual-points"><span>高速线路</span><span>全协议支持</span><span>${esc(regionText)}</span></div>
          </div>
        </section>
        <section class="auth-form-area">
          <div class="auth-form-wrap">
            <div class="auth-mobile-brand"><span class="auth-brand-mark">F</span><strong>FRP 管理台</strong></div>
            <div class="auth-form-card">
              <div class="auth-form-heading"><h2>${title}</h2><p>${subtitle || '欢迎回来，请登录您的账号'}</p></div>
              ${formHtml}
              ${footHtml}
            </div>
            <p class="auth-footer">© 2026 FRP 管理台</p>
          </div>
        </section>
      </main>
    </div>`;
}

function emptyRow(cols, text){
  return `<tr><td colspan="${cols}" class="empty-state">${esc(text)}</td></tr>`;
}

function tunnelEndpointText(t, frps={}){
  if(['tcp','udp'].includes(t.proxy_type)) return t.remote_port ? `${t.server_addr || frps.addr || ''}:${t.remote_port}` : '-';
  if(t.custom_domains) return String(t.custom_domains);
  if(t.secret_key) return `secretKey: ${t.secret_key}`;
  return '-';
}

function tunnelRuntimeStats(t, dashboard){
  const proxies = dashboard?.proxies || [];
  const proxy = proxies.find(p => p.name === t.name || p.full_name === t.name || String(p.full_name || '').endsWith(`.${t.name}`));
  return {
    trafficIn: Number(proxy?.today_traffic_in || 0),
    trafficOut: Number(proxy?.today_traffic_out || 0),
    connections: Number(proxy?.cur_conns || 0),
    available: !!proxy,
  };
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
  const cards = (dash.proxies || []).map(p => {
    const endpoint = p.remote_port || (Array.isArray(p.custom_domains) ? p.custom_domains.join(', ') : p.custom_domains) || '-';
    const online = p.status === 'online';
    return `<article class="proxy-card">
      <div class="proxy-card-head"><div class="proxy-symbol">${esc(String(p.type || 'tcp').slice(0, 1).toUpperCase())}</div><div class="proxy-title"><strong>${esc(p.name)}</strong><span>${esc(p.type || 'tcp')} · ${esc(p.client_version || '客户端版本未知')}</span></div><span class="status-dot ${online ? 'is-online' : 'is-offline'}">${online ? '在线' : esc(p.status || '未知')}</span></div>
      <div class="proxy-endpoint"><span>公网入口</span><strong>${esc(endpoint)}</strong></div>
      <div class="proxy-stats"><div><span>当前连接</span><strong>${esc(p.cur_conns || 0)}</strong></div><div><span>今日入站</span><strong>${fmtBytes(p.today_traffic_in)}</strong></div><div><span>今日出站</span><strong>${fmtBytes(p.today_traffic_out)}</strong></div></div>
      <p class="proxy-last-seen">最近启动：${esc(p.last_start_time || '-')}</p>
    </article>`;
  }).join('') || `<div class="empty-state"><strong>还没有在线映射</strong><p class="muted small">创建隧道并启动 frpc 客户端后，连接状态会显示在这里。</p></div>`;
  return `<section class="card"><div class="section-title"><div><h2>实时映射</h2><p>只显示当前账号的 frps 代理，不会看到其他用户。</p></div><span class="section-count">${(dash.proxies || []).length} 个代理</span></div><div class="proxy-card-grid">${cards}</div></section>`;
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
    return loadAdminHealth();
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

function appSidebarHtml(kind='dashboard'){
  const isAdmin = currentUser?.role === 'admin';
  const username = currentUser?.username || '用户';
  const items = isAdmin ? [
    ['admin-dashboard','⌂','运行总览'],['admin','♙','用户管理','users'],['admin','▦','注册密钥','keys'],['admin','⌁','新增节点','nodes'],['admin-health','♥','节点健康','health'],['admin-proxies','◌','映射监控','proxies'],['admin','⚠','风控审计','risk']
  ] : [
    ['dashboard','⌂','概览'],['dashboard-tunnels','⇄','隧道管理'],['dashboard-ports','#','端口资源'],['dashboard-config','↓','配置下载']
  ];
  const links = items.map(([action, icon, label, section]) => {
    const active = kind === action || (section && kind === section) ? ' active' : '';
    return `<button class="side-link${active}" data-nav="${action}"${section ? ` data-section="${section}"` : ''}><span class="side-icon">${icon}</span><span class="side-link-label">${label}</span><span class="side-link-arrow">›</span></button>`;
  }).join('');
  return `<aside class="app-sidebar">
    <div class="sidebar-brand"><div class="brand-mark-small">F</div><div><strong>FRP 管理台</strong><span>内网穿透管理平台</span></div></div>
    <div class="sidebar-section-label">工作空间</div>${links}
    ${isAdmin ? '' : `<div class="sidebar-section-label sidebar-tools-label">快速工具</div><a class="side-link sidebar-download-link" href="/config/deploy-frpc.sh"><span class="side-icon">⚙</span><span class="side-link-label">客户端部署</span><span class="side-link-arrow">↗</span></a>`}
    <div class="sidebar-spacer"></div>
    <div class="sidebar-service-status"><span class="sidebar-service-dot"></span><span><strong>服务运行中</strong><small>FRP 管理服务</small></span></div>
    <div class="sidebar-user-card"><span class="sidebar-user-avatar">${esc(String(username).slice(0,1).toUpperCase())}</span><span class="sidebar-user-copy"><strong>${esc(username)}</strong><small>${isAdmin ? '系统管理员' : '普通用户'}</small></span><button type="button" data-nav="logout" title="退出登录" aria-label="退出登录">↗</button></div>
  </aside>`;
}

function appLayoutHtml(content, kind='dashboard', topTitle='工作区'){
  const username = currentUser?.username || '用户';
  return `<div class="app-shell">${appSidebarHtml(kind)}<main class="workspace-main"><div class="workspace-topbar"><div class="topbar-welcome"><svg class="topbar-welcome-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M683.232 304.576c-51.52 52.992-103.072 105.76-154.624 158.304-37.76 38.496-74.944 77.376-112.96 115.36-5.76 5.76-14.976 11.392-22.528 11.264-13.824 0-20.288-16.768-13.824-31.168 16.864-36.992 34.624-73.504 50.624-110.72 4.992-11.36 7.584-23.68 7.68-36.128a34.528 34.528 0 0 0-16-28.864 32.96 32.96 0 0 0-32.352-1.6c-8.992 4-16.704 10.528-22.272 18.784-41.824 75.328-83.584 150.624-123.328 226.976-15.168 28.896-20.064 61.76-19.616 95.168 1.664 66.624 30.08 121.696 71.232 171.296 35.456 42.656 76.032 77.472 130.624 91.36 58.688 15.04 115.04 6.336 169.344-19.2a418.976 418.976 0 0 0 121.152-87.584c65.632-66.944 131.2-133.952 196.672-201.056 10.432-10.592 18.432-21.856 13.408-38.656-9.6-31.264-40.224-40.416-63.52-17.408-31.776 31.52-62.816 64-94.208 96-3.488 3.584-6.976 9.408-10.944 9.408-8.384 0.864-19.744 1.92-24.96-2.816-4.576-4.032-3.584-16.096-2.368-24.192 0.64-4.704 6.528-8.48 10.304-12.416 54.272-55.776 108.704-111.168 162.72-167.072 21.376-21.696 14.016-56-13.376-63.68-18.048-5.12-32.224 2.336-45.056 15.52-49.44 51.296-99.264 102.304-148.992 153.344a101.024 101.024 0 0 1-10.752 10.24 18.112 18.112 0 0 1-25.6-1.216 19.136 19.136 0 0 1-2.56-25.92c3.712-5.344 7.968-10.272 12.704-14.72 65.792-67.36 131.552-134.816 197.28-202.336 23.904-24.384 16.32-58.944-14.528-67.584-15.232-4.352-26.944 2.816-37.056 13.056a26194.304 26194.304 0 0 0-106.88 108.736c-31.648 32.48-63.136 65.184-94.784 97.504-4.16 4.256-8.576 10.368-13.536 11.104a33.28 33.28 0 0 1-22.496-3.2 16.544 16.544 0 0 1-3.392-24.096c3.424-4.864 7.264-9.44 11.488-13.632 51.52-52.896 103.072-105.536 154.368-158.528 21.6-22.304 15.392-55.584-11.968-64.224-17.952-5.664-32.224 1.28-45.12 14.592z m-410.496 15.744c-19.744 3.104-32 16.768-41.28 34.56-16.832 32-33.6 63.968-50.24 95.904l-33.152 64.16a1594.88 1594.88 0 0 1-17.056 31.744c-55.584 99.776-41.92 209.504 19.52 299.744 33.728 49.504 73.6 90.624 129.664 108.864 4.8 1.6 9.728 3.104 14.624 4.704a12.128 12.128 0 0 0 3.648-0.48c-18.368-22.784-37.408-44.16-53.856-67.616-39.584-56.256-64.064-118.976-62.176-191.232 1.408-53.28 16.384-102.88 40.448-149.12 29.696-57.056 59.584-113.92 89.696-170.56 7.616-14.112 11.424-27.04 1.216-41.504-9.12-14.464-25.152-21.824-41.056-18.816v-0.32z m267.52-85.888c-31.552 32.448-60.864 67.776-92.256 103.04 18.432 21.344 24.736 46.976 20.928 78.528 3.84-3.072 5.632-4.224 7.136-5.76 41.536-45.6 82.752-91.52 124.736-136.512 9.6-10.24 8.864-18.432 2.112-28.96-13.664-21.344-44.8-28.672-62.656-10.336zM403.456 64L352 85.44c21.248 24.768 41.44 48.16 64 74.56-4.48-33.856-8.32-63.744-12.448-96h-0.096z m184.256 0L576 158.688l3.616 1.312c19.52-23.232 38.976-46.592 60.384-72l-52.544-23.968 0.256-0.032zM448 32l30.144 96h3.264c9.984-31.296 19.968-62.784 30.592-96h-64z" fill="#FFDA00"></path></svg><span class="topbar-greeting">欢迎回来，${esc(username)}</span><span class="topbar-breadcrumb"><img class="topbar-breadcrumb-icon" src="/dashboard-icon.svg" alt="" aria-hidden="true"><span>/ ${esc(topTitle)}</span></span></div></div>${content}</main></div>`;
}

function setNav(){
  document.body.classList.toggle('is-app', !!currentUser);
  document.body.classList.toggle('is-auth', !currentUser);
  const themeBtn = navButton(`${colorMode === 'dark' ? '浅色' : '深色'}模式`, 'theme');
  if(!currentUser){ nav.innerHTML = themeBtn; return; }
  const licenseRequired = !!(softwareLicense && softwareLicense.required && !softwareLicense.licensed);
  const isAdmin = currentUser.role === 'admin';
  const adminNav = isAdmin && !licenseRequired ? [
    navButton('用户', 'admin', 'secondary', 'users'),
    navButton('密钥', 'admin', 'secondary', 'keys'),
    navButton('新增节点', 'admin', 'secondary', 'nodes'),
    navButton('节点健康', 'admin-health', 'secondary', 'health'),
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
    if(action === 'admin-health') return loadAdminHealth();
    if(action === 'admin') return loadAdmin(section);
  }catch(err){
    show(err.message || '操作失败', true);
  }
});

app.addEventListener('click', async (e) => {
  const copyEl = e.target.closest?.('[data-copy-address]');
  if(copyEl){
    e.preventDefault();
    return copyText(copyEl.getAttribute('data-copy-address') || '');
  }
  const el = e.target.closest?.('[data-nav]');
  if(!el || nav.contains(el)) return;
  const action = el.getAttribute('data-nav');
  const section = el.getAttribute('data-section') || 'users';
  try{
    if(action === 'theme') return toggleColorMode();
    if(action === 'logout') return logout();
    if(action === 'dashboard') return loadDashboard();
    if(action === 'dashboard-tunnels') return loadDashboard('tunnels');
    if(action === 'dashboard-ports') return loadDashboard('ports');
    if(action === 'dashboard-config') return window.location.href = '/config/frpc.toml';
    if(action === 'admin-dashboard') return loadAdminDashboard();
    if(action === 'admin-proxies') return loadAdminProxies();
    if(action === 'admin-health') return loadAdminHealth();
    if(action === 'admin') return loadAdmin(section);
  }catch(err){ show(err.message || '操作失败', true); }
});

async function renderLogin(){
  clearAdminDashboardTimer();
  currentUser = null; setNav(); hideFlash();
  let nodes = [];
  try { nodes = await loadNodes(); } catch(e) {}
  app.innerHTML = authShell('登录', '登录后管理隧道和下载配置', `
      <form id="loginForm" class="stack-form auth-login-form">
        <div class="input-group"><label class="input-label" for="loginUsername">用户名</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('user')}</span><input id="loginUsername" class="input-ios" name="username" autocomplete="username" placeholder="请输入用户名" required></div></div>
        <div class="input-group"><label class="input-label" for="loginPassword">密码</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('lock')}</span><input id="loginPassword" class="input-ios auth-password-input" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required><button type="button" class="auth-password-toggle" onclick="togglePasswordVisibility('loginPassword', this)" aria-label="显示密码" title="显示密码">${iconSvg('eye')}</button></div></div>
        <p><button class="wide auth-submit">登录</button></p>
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
  try { nodes = await loadNodes(); } catch(e) { show('加载节点失败：' + e.message, true); }
  app.innerHTML = authShell('密钥注册', '输入密钥并选择适合你的地区', `
      <form id="registerForm" class="stack-form auth-login-form">
        <div class="input-group"><label class="input-label" for="registerUsername">用户名</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('user')}</span><input id="registerUsername" class="input-ios" name="username" autocomplete="username" placeholder="请输入用户名" required></div></div>
        <div class="input-group"><label class="input-label" for="registerPassword">密码</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('lock')}</span><input id="registerPassword" class="input-ios auth-password-input" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="请输入密码（至少 6 位）" required><button type="button" class="auth-password-toggle" onclick="togglePasswordVisibility('registerPassword', this)" aria-label="显示密码" title="显示密码">${iconSvg('eye')}</button></div></div>
        <div class="input-group"><label class="input-label" for="registerNode">接入节点</label><select id="registerNode" class="input-ios" name="node_id" required>${nodeOptions(nodes)}</select></div>
        <div class="input-group"><label class="input-label" for="registerKey">注册密钥</label><input id="registerKey" class="input-ios" name="invite_key" placeholder="FML-..." required></div>
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
  try{
    await api('/api/logout', {method:'POST', body:{}});
  }catch(err){
    // CSRF token may have expired while the page stayed open; refresh it once before giving up.
    if(String(err.message || '').includes('CSRF')){
      csrfToken = null;
      try{ await api('/api/logout', {method:'POST', body:{}}); }catch(e){}
    }
  }
  currentUser = null;
  clearAdminDashboardTimer();
  await renderLogin();
}

function bindUserTunnelForm(){
  const proxyTypeSelect = document.querySelector('#proxyTypeSelect');
  if(!proxyTypeSelect) return;
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
    document.querySelector('.remote-port-field')?.classList.toggle('hidden', !['tcp','udp'].includes(type));
    document.querySelector('.domain-field')?.classList.toggle('hidden', !['http','https','tcpmux'].includes(type));
    document.querySelector('.secret-field')?.classList.toggle('hidden', !['stcp','xtcp'].includes(type));
  };
  proxyTypeSelect.onchange = syncProxyFields;
  syncProxyFields();
  if(tunnelForm) tunnelForm.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      await api('/api/tunnels/create', {method:'POST', body:Object.fromEntries(fd)});
      tunnelFormDraft = {};
      closeTunnelModal();
      show('隧道已创建，重新下载 frpc.toml 后重启 frpc 生效');
      await loadDashboard('tunnels');
    }catch(err){ show(err.message, true); }
  };
}

async function loadDashboard(view='overview'){
  clearAdminDashboardTimer();
  if(tunnelPreviewTimer){ clearInterval(tunnelPreviewTimer); tunnelPreviewTimer = null; }
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
  const todayTraffic = Number(data.frps_user_dashboard?.today_traffic_total || 0);
  const trafficLimit = Number(data.user.traffic_limit_bytes || 0);
  const trafficLine = trafficLimit ? `今日流量：<b>${fmtBytes(todayTraffic)}</b> / ${fmtBytes(trafficLimit)}` : `今日流量：<b>${fmtBytes(todayTraffic)}</b> / 不限`;
  
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
    const endpointRaw = tunnelEndpointText(t, data.frps);
    const endpoint = esc(endpointRaw);
    const runtime = tunnelRuntimeStats(t, data.frps_user_dashboard);
    return `<article class="tunnel-card">
      <div class="tunnel-card-head"><div class="tunnel-type-icon">${esc(String(t.proxy_type || 'tcp').slice(0, 1).toUpperCase())}</div><div class="tunnel-title"><strong title="${esc(t.name)}">${esc(t.name)}</strong><span>${esc(t.proxy_type)} 隧道 · #${esc(t.id)}</span></div><span class="status-dot ${t.enabled ? 'is-online' : 'is-offline'}">${t.enabled ? '已启用' : '已停用'}</span></div>
      <div class="tunnel-route"><div><span>本地服务</span><strong>${esc(t.local_ip)}:${esc(t.local_port)}</strong></div><div><span>公网入口</span><strong title="${endpoint}">${endpoint}</strong>${endpointRaw !== '-' ? `<button type="button" class="copy-inline" data-copy-address="${endpoint}">复制</button>` : ''}</div></div>
      <div class="tunnel-card-status"><span class="muted small">映射状态</span><div>${tunnelMappingStatusHtml(t)}</div></div>
      <div class="tunnel-traffic-row"><span>今日流量 <b>${fmtBytes(runtime.trafficIn + runtime.trafficOut)}</b></span><span>连接数 <b>${runtime.available ? runtime.connections : '-'}</b></span></div>
      <div class="tunnel-card-actions"><button class="secondary" onclick="loadDashboard('tunnels')">刷新状态</button><button class="secondary" onclick="toggleTunnel(${t.id})">${t.enabled ? '停用' : '启用'}</button><button class="danger" onclick="deleteTunnel(${t.id})">删除</button></div>
    </article>`;
  }).join('') || `<div class="empty-state"><strong>还没有隧道</strong><p class="muted small">创建第一个隧道后，就能在这里查看本地服务、公网入口和运行状态。</p><button onclick="loadDashboard('tunnels')">新建隧道</button></div>`;
  const tunnelPreviewRows = data.tunnels.map(t => {
    const endpointRaw = tunnelEndpointText(t, data.frps);
    const runtime = tunnelRuntimeStats(t, data.frps_user_dashboard);
    const status = t.mapping_status || (t.enabled ? 'unknown' : 'disabled');
    const statusLabel = status === 'online' ? '在线' : (status === 'registered' ? '已注册' : (status === 'disabled' ? '已停用' : '未连接'));
    const statusClass = status === 'online' ? 'ok' : (status === 'registered' ? 'warn' : (status === 'disabled' ? 'muted' : 'bad'));
    return `<article class="tunnel-preview-item">
      <div class="tunnel-preview-top"><strong title="${esc(t.name)}">${esc(t.name)}</strong><span class="status-dot ${t.enabled ? 'is-online' : 'is-offline'}">${t.enabled ? '已启用' : '已停用'}</span></div>
      <div class="tunnel-preview-grid">
        <div><span>状态</span><b class="${statusClass}">${statusLabel}</b></div>
        <div><span>本地服务</span><b title="${esc(t.local_ip)}:${esc(t.local_port)}">${esc(t.local_ip)}:${esc(t.local_port)}</b></div>
        <div><span>公网地址</span><b title="${esc(endpointRaw)}">${esc(endpointRaw)}</b></div>
        <div><span>今日流量</span><b>${fmtBytes(runtime.trafficIn + runtime.trafficOut)}</b></div>
        <div><span>连接数</span><b>${runtime.available ? runtime.connections : '-'}</b></div>
      </div>
    </article>`;
  }).join('') || `<div class="empty-state"><strong>还没有隧道</strong><p class="muted small">创建隧道后，这里会轮播展示隧道状态。</p></div>`;
  const portOptions = data.ports.map(p => `<option value="${p}">${p}${used.has(p) ? '（已用）' : ''}</option>`).join('');
  // Dropdown only for non-admin with reasonable port count; admin or huge lists get number input
  const portCount = ps.total || data.ports.length;
  const remotePortField = (portCount > 500)
    ? `<input name="remote_port" type="number" min="1" max="65535" placeholder="输入端口号">`
    : `<select name="remote_port">${portOptions}</select>`;
  const proxyTypeOptions = (data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux']).map(t => `<option value="${t}">${t}</option>`).join('');
  if(view === 'overview'){
    const node = data.node || {};
    currentDashboardNodeId = node.id ?? null;
    const nodeState = node.active ? '在线' : '离线';
    const nodeStateClass = node.active ? 'ok' : 'bad';
    const nodeLocation = node.region || '位置未设置';
    const nodeOwner = data.user?.username || '当前账号';
    const nodeLatency = Number.isFinite(Number(node.latency_ms)) && node.latency_ms !== null ? `${Math.round(Number(node.latency_ms))} ms` : '暂未测量';

    const tunnelCount = data.tunnels.length;
    const tunnelLimit = Number(data.user.max_ports || 0);
    const tunnelUsagePercent = tunnelLimit > 0 ? Math.min(100, Math.round(tunnelCount / tunnelLimit * 100)) : 0;
    const tunnelUsageLabel = tunnelLimit > 0 ? `已使用 ${tunnelCount} / ${tunnelLimit}` : `已使用 ${tunnelCount} 条隧道`;
    const portUsagePercent = tunnelLimit > 0 ? Math.min(100, Math.round(tunnelCount / tunnelLimit * 100)) : 0;
    const portUsageLabel = tunnelLimit > 0 ? `已使用 ${tunnelCount} / ${tunnelLimit}` : `已使用 ${tunnelCount} 个端口`;
    const accountExpired = !!data.user.expired;
    const expiryPercent = accountExpired ? 0 : 100;
    const expiryLabel = accountExpired ? '账号已到期' : '账号有效';

    app.innerHTML = appLayoutHtml(`
      <div class="workspace-stats user-overview-stats">
        <section class="workspace-stat highlight tunnel-count-stat">
          <div class="tunnel-count-main">
            <svg class="tunnel-count-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M1023.910943 511.999898c5.11911 317.794367-194.116663 516.825376-511.91103 511.911029-317.794367 4.914346-516.825376-194.116663-511.91103-511.911029C-4.825463 194.20553 194.205546-4.825478 511.999913 0.088868c317.794367-4.914346 516.825376 194.116663 511.91103 511.91103z" fill="#1296db"/>
              <path d="M1022.477592 566.671996C1006.915497 340.40732 852.318366 201.16752 614.382119 204.85328c-254.112635-4.095288-413.624112 155.416189-409.528824 409.528824-3.890524 237.936247 135.554041 392.533378 361.613952 408.095473 268.036615-16.381153 439.629192-187.97373 456.010345-455.805581z" fill="#1296db"/>
              <path d="M1015.515602 629.944199C985.824762 491.523456 876.480566 407.160519 716.764325 409.617692c-190.635668-3.071466-310.218084 116.51095-307.146618 307.146618-2.457173 159.716241 81.905765 269.060437 220.121743 298.751277 211.112109-34.400421 351.375731-174.664043 385.776152-385.571388z" fill="#1296db"/>
              <path d="M997.701098 705.707031C964.734028 646.734881 902.076118 613.153517 819.146531 614.382104c-127.1587-2.047644-206.812056 77.605712-204.764412 204.764412-1.433351 82.929587 32.352777 145.587497 91.120163 178.554567a431.233852 431.233852 0 0 0 292.198816-291.994052z" fill="#1296db"/>
              <path d="M380.745925 839.622957a196.369071 196.369071 0 0 1-139.035036-335.404107l87.434404-87.434404a31.738484 31.738484 0 0 1 44.843406 44.843406L286.75906 549.062256a133.096868 133.096868 0 0 0 188.383259 188.383259l87.434404-87.434404a31.738484 31.738484 0 0 1 44.843406 44.843406l-87.434404 87.434404a195.959542 195.959542 0 0 1-139.2398 57.334036zM672.330448 616.634512a31.738484 31.738484 0 0 1-22.319321-54.057805L737.240766 474.937539a133.096868 133.096868 0 0 0-188.383259-188.383259l-87.434404 87.434404a31.738484 31.738484 0 0 1-44.843406-44.843406l87.434404-87.434404a196.573835 196.573835 0 0 1 278.070071 278.070071l-87.434403 87.434404a31.533719 31.533719 0 0 1-22.319321 9.419163z" fill="#BDEFD1"/>
              <path d="M439.103782 637.725247a52.829218 52.829218 0 0 1-37.267123-90.096342l145.792262-145.792261a52.829218 52.829218 0 0 1 74.73901 74.73901l-145.792261 145.792262a52.624454 52.624454 0 0 1-37.471888 15.357331z" fill="#FFFFFF"/>
            </svg>
            <div class="tunnel-count-copy"><span>隧道数量</span><strong>${tunnelCount}</strong><small>${data.tunnels.filter(t => t.enabled).length} 条正在运行</small></div>
          </div>
          <div class="tunnel-usage">
            <div class="tunnel-usage-label"><span>${tunnelUsageLabel}</span><b>${tunnelLimit > 0 ? `${tunnelUsagePercent}%` : '—'}</b></div>
            <div class="tunnel-usage-track" role="progressbar" aria-label="隧道使用情况" aria-valuemin="0" aria-valuemax="${tunnelLimit || tunnelCount || 1}" aria-valuenow="${tunnelLimit > 0 ? Math.min(tunnelCount, tunnelLimit) : tunnelCount}"><span style="width:${tunnelUsagePercent}%"></span></div>
          </div>
        </section>
        <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M153.6 358.4h716.8v307.2H153.6z" fill="#20C997"/><path d="M845.824 614.4V409.6h-665.6v204.8h665.6z m0 102.4h-665.6v102.4a102.4 102.4 0 0 0 102.4 102.4h460.8a51.2 51.2 0 0 1 0 102.4h-460.8a204.8 204.8 0 0 1-204.8-204.8V204.8a204.8 204.8 0 0 1 204.8-204.8h460.8a204.8 204.8 0 0 1 204.8 204.8v614.4a51.2 51.2 0 0 1-102.4 0v-102.4z m0-409.6V204.8a102.4 102.4 0 0 0-102.4-102.4h-460.8a102.4 102.4 0 0 0-102.4 102.4v102.4h665.6z m-153.6 563.2a51.2 51.2 0 1 1 0-102.4 51.2 51.2 0 0 1 0 102.4z m-358.4-716.8h102.4a51.2 51.2 0 1 1 0 102.4h-102.4a51.2 51.2 0 1 1 0-102.4z m0 307.2h102.4a51.2 51.2 0 1 1 0 102.4h-102.4a51.2 51.2 0 0 1 0-102.4z" fill="#2C6DD2"/></svg><div class="overview-stat-copy"><span>当前节点</span><strong>\${esc(node.region || node.name || '-')}</strong><small>\${esc(node.name || '未分配节点')}</small></div></div></section>
        <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M924.834016 734.642305V249.382098c0-74.58746-61.33588-135.071453-136.964535-135.071452H328.3552c-75.723309 0-136.964536 60.483993-136.964536 135.071452v609.667293c0 74.619011 61.304329 135.071453 136.964536 135.071453h344.193991z" fill="#9353F9"/><path d="M647.749807 1023.968449H261.592482A175.204807 175.204807 0 0 1 86.387675 848.763642V175.204807A175.204807 175.204807 0 0 1 261.592482 0h500.815036a175.204807 175.204807 0 0 1 175.204807 175.204807v546.532984zM261.592482 51.902018a123.302788 123.302788 0 0 0-123.271237 123.302789v673.558835a123.302788 123.302788 0 0 0 123.271237 123.302788H625.600739l260.046465-271.341858V175.204807a123.302788 123.302788 0 0 0-123.239686-123.302789z" fill="#2E3138"/></svg><div class="overview-stat-copy"><span>今日流量</span><strong>\${fmtBytes(todayTraffic)}</strong><small>\${trafficLimit ? `上限 \${fmtBytes(trafficLimit)}` : '当前不限额；按今日统计'}</small></div></div></section>
        <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M512 514m-448 0a448 448 0 1 0 896 0 448 448 0 1 0-896 0Z" fill="#69B452"/><path d="M512 512m-253.15 0a253.15 253.15 0 1 0 506.3 0 253.15 253.15 0 1 0-506.3 0Z" fill="#FFFFFF"/><path d="M512 512m-203.07 0a203.07 203.07 0 1 0 406.14 0 203.07 203.07 0 1 0-406.14 0Z" fill="#D1F0C7"/><path d="M622.12 497h-91.31a24.09 24.09 0 0 0-11.46-7.92V360.22a6 6 0 0 0-6-6h-2.81a6 6 0 0 0-6 6v128.93a24.06 24.06 0 1 0 26.19 38.08h91.49a6 6 0 0 0 6-6V503a6 6 0 0 0-6.1-6z" fill="#69B452"/></svg><div class="overview-stat-copy"><span>账号有效期</span><strong>\${esc(data.user.expires_text || '-')}</strong><small>\${data.user.expired ? '账号已到期' : '到期日期'}</small></div></div><div class="tunnel-usage"><div class="tunnel-usage-label"><span>\${expiryLabel}</span><b>\${expiryPercent}%</b></div><div class="tunnel-usage-track" role="progressbar" aria-label="账号有效状态" aria-valuemin="0" aria-valuemax="100" aria-valuenow="\${expiryPercent}"><span class="expiry-usage-fill" style="width:\${expiryPercent}%"></span></div></div></section>
        <section class="workspace-stat port-limit-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M853.333333 201.984v469.333333H170.666667v-469.333333h682.666666z m-51.2 51.2H221.866667v366.933333h580.266666v-366.933333zM785.066667 802.304v51.2H238.933333v-51.2z" fill="#1296db"/></svg><div class="overview-stat-copy"><span>端口上限</span><strong>\${esc(data.user.max_ports ?? '-')}</strong><small>可分配端口总数</small></div></div><div class="tunnel-usage"><div class="tunnel-usage-label"><span>\${portUsageLabel}</span><b>\${tunnelLimit > 0 ? portUsagePercent + '%' : '—'}</b></div><div class="tunnel-usage-track" role="progressbar" aria-label="端口使用情况" aria-valuemin="0" aria-valuemax="\${tunnelLimit || tunnelCount || 1}" aria-valuenow="\${tunnelLimit > 0 ? Math.min(tunnelCount, tunnelLimit) : tunnelCount}"><span style="width:\${portUsagePercent}%"></span></div></div></section>
      </div>
      <div class="user-dashboard-grid">
        <section class="card node-status-card node-map-panel"><div class="node-map-backdrop" aria-hidden="true"><div class="node-map-grid"></div><svg viewBox="0 0 900 340" preserveAspectRatio="xMidYMid slice"><defs><filter id="nodeMapBlur"><feGaussianBlur stdDeviation="2.4"/></filter><linearGradient id="nodeMapFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#80b8ef"/><stop offset="100%" stop-color="#5e8bd9"/></linearGradient></defs><g fill="url(#nodeMapFill)" opacity=".28" filter="url(#nodeMapBlur)"><path d="M74 85l40-27 58 8 21 22 49-8 24 27-21 25-37 2-18 35-42 4-12 37-29-10-6-44-29-20z"/><path d="M214 193l39 12 28 45-8 38-21 18-18-43-25-26z"/><path d="M405 74l36-19 54 11 27 25 50-7 24 22 51-5 37 25-20 21-52-6-16 30-31-5-20 23-41-14-19-32-40-5-15-25-35-2z"/><path d="M459 166l43 1 30 31-8 51-27 47-25-18-11-52-18-24z"/><path d="M631 228l43-15 48 15 26 25-28 24-49-8-28 15-22-22z"/><path d="M748 65l42-13 39 20-6 26-42 9-30-17z"/></g><g fill="none" stroke="#5e9fe8" stroke-width="2" stroke-dasharray="5 7" opacity=".55"><path d="M170 118Q350 5 520 115T740 130"/><path d="M170 118Q250 240 430 210T740 130"/></g><g fill="#fff" stroke="#4388ec" stroke-width="3"><circle cx="170" cy="118" r="8"/><circle cx="430" cy="210" r="7"/><circle cx="740" cy="130" r="10"/></g><circle cx="740" cy="130" r="19" fill="#4388ec" opacity=".14"/></svg></div><div class="node-map-heading"><div><div class="section-kicker">CURRENT NODE · NODE OVERVIEW</div><h2>当前节点</h2></div><span class="status-badge ${nodeStateClass}"><i></i>${nodeState}</span></div><div class="node-map-content node-compact-content"><div class="node-server-art"><img src="/server-icon.svg" alt="服务器图标"></div><div class="node-compact-details"><div class="node-compact-title"><strong>${esc(node.name || '未分配节点')}</strong><span class="status-badge ${nodeStateClass}"><i></i>${nodeState}</span></div><div class="node-compact-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${esc(nodeLocation)}</span></div><div class="node-compact-meta"><span>延迟：${esc(nodeLatency)}</span><span class="node-meta-separator">|</span><span>带宽：${node.bandwidth_mbps || node.bandwidth || node.bandwidth_mbps === 0 ? esc(node.bandwidth_mbps ?? node.bandwidth) + ' Mbps' : '未设置'}</span></div></div><button type="button" class="node-switch-button" onclick="openNodeSwitch()">⇄ 切换节点</button></div><div id="nodeSwitchModal" class="node-switch-modal hidden" role="dialog" aria-modal="true" aria-labelledby="nodeSwitchTitle"><div class="node-switch-dialog"><div class="section-title"><div><div class="section-kicker">CHANGE NODE</div><h2 id="nodeSwitchTitle">切换接入节点</h2><p>切换后会影响当前账号新建隧道的默认节点。</p></div><button class="secondary" type="button" onclick="closeNodeSwitch()">关闭 ×</button></div><div id="nodeSwitchList" class="node-switch-list"><p class="muted">正在加载可用节点…</p></div></div></div></section>
        <section class="card quick-actions-card"><div class="section-title"><div><div class="section-kicker">QUICK ACTIONS</div><h2>快捷操作</h2></div></div><div class="quick-actions-grid"><button class="quick-action" onclick="loadDashboard('tunnels')"><span>↗</span><b>管理隧道</b><small>查看和控制映射</small></button><button class="quick-action" onclick="loadDashboard('ports')"><span>#</span><b>查看端口</b><small>查看端口资源</small></button><a class="quick-action" href="/config/frpc.toml"><span>↓</span><b>下载配置</b><small>获取 frpc.toml</small></a><a class="quick-action" href="/config/deploy-frpc.sh"><span>⚙</span><b>部署脚本</b><small>安装客户端</small></a></div></section>
      </div>
      <section class="card dashboard-tunnels-preview"><div class="section-title"><div><div class="section-kicker">MY TUNNELS</div><h2>我的隧道</h2></div><button class="secondary tunnel-preview-all" onclick="loadDashboard('tunnels')">查看全部隧道 ↗</button></div><div id="tunnelPreviewRotator" class="tunnel-preview-rotator">${tunnelPreviewRows}</div></section>`, 'dashboard', '概览');
    const previewItems = [...document.querySelectorAll('#tunnelPreviewRotator .tunnel-preview-item')];
    if(previewItems.length > 1){
      let previewIndex = 0;
      previewItems.forEach((item, index) => item.classList.toggle('is-active', index === 0));
      tunnelPreviewTimer = setInterval(() => {
        if(!document.querySelector('#tunnelPreviewRotator')){ clearInterval(tunnelPreviewTimer); tunnelPreviewTimer = null; return; }
        previewItems[previewIndex].classList.remove('is-active');
        previewIndex = (previewIndex + 1) % previewItems.length;
        previewItems[previewIndex].classList.add('is-active');
      }, 4000);
    } else if(previewItems.length === 1){ previewItems[0].classList.add('is-active'); }
    return;
  }
  if(view === 'ports'){
    app.innerHTML = appLayoutHtml(`
      <section class="card dashboard-hero"><div><div class="eyebrow">RESOURCE POOL</div><h2>端口资源</h2><p>查看当前节点端口池和已分配端口。</p></div><button onclick="loadDashboard('ports')">刷新</button></section>
      <section class="card ports-section"><div class="section-title"><div><div class="section-kicker">PORTS</div><h2>端口列表</h2></div><p>黄色表示已分配给隧道</p></div><div class="ports">${portsHtml}</div></section>`, 'dashboard-ports', '端口资源');
    return;
  }
  if(view === 'tunnels'){
    app.innerHTML = appLayoutHtml(`
      <section class="card dashboard-hero"><div><div class="eyebrow">MY TUNNELS</div><h2>我的隧道</h2><p>管理映射、查看状态并创建新的隧道。</p></div><button onclick="openTunnelModal()">＋ 新建隧道</button></section>
      <section class="card tunnel-config-entry"><div class="section-title"><div><div class="section-kicker">QUICK ACTION</div><h2>创建映射</h2></div><p>支持 TCP / UDP / HTTP / HTTPS 等协议</p></div><button onclick="openTunnelModal()">新建隧道</button><span class="muted small">填写本地服务和公网访问方式，创建后下载最新 frpc 配置。</span></section>
      <div id="tunnelModal" class="modal-backdrop${tunnelModalOpen ? '' : ' hidden'}" role="dialog" aria-modal="true" aria-labelledby="tunnelModalTitle">
        <section class="modal-page card"><div class="section-title modal-title"><div><h2 id="tunnelModalTitle">新建隧道</h2><p>填写本地服务和公网访问方式。</p></div><button type="button" class="secondary modal-close" onclick="closeTunnelModal()">关闭 ×</button></div>
          <form id="tunnelForm" class="grid"><div><label>名称</label><input name="name" value="${esc(tunnelFormDraft.name || '')}" placeholder="web" required></div><div><label>类型</label><select name="proxy_type" id="proxyTypeSelect">${proxyTypeOptions}</select></div><div><label>本地 IP</label><input name="local_ip" value="${esc(tunnelFormDraft.local_ip || '127.0.0.1')}" required></div><div><label>本地端口</label><input name="local_port" type="number" min="1" max="65535" value="${esc(tunnelFormDraft.local_port || '80')}" required></div><div class="remote-port-field"><label>公网端口</label>${remotePortField}</div><div class="domain-field hidden"><label>自定义域名</label><input name="custom_domains" value="${esc(tunnelFormDraft.custom_domains || '')}" placeholder="app.example.com,api.example.com"></div><div class="secret-field hidden"><label>访问密钥</label><input name="secret_key" value="${esc(tunnelFormDraft.secret_key || '')}" placeholder="留空自动生成"></div><div class="form-actions"><button>创建</button></div></form>
          <p class="muted small">HTTP/HTTPS/TCPMUX 需要 frps 已配置对应能力。</p></section>
      </div>
      <section class="card tunnel-list-section"><div class="section-title"><div><div class="section-kicker">TUNNELS</div><h2>隧道列表</h2></div><span class="section-count">${data.tunnels.length} 条隧道</span></div><div class="tunnel-card-grid">${tunnelRows}</div></section>`, 'dashboard-tunnels', '我的隧道');
    bindUserTunnelForm();
    return;
  }
  const sideNav = `<aside class="app-sidebar">
      <div class="sidebar-brand"><div class="brand-mark-small">鱼</div><div><strong>FRP 管理台</strong><span>工作台</span></div></div>
      <div class="sidebar-section-label">工作区</div>
      <button class="side-link active"><span class="side-icon">⌂</span>概览</button>
      <button class="side-link" onclick="document.querySelector('.tunnel-list-section')?.scrollIntoView({behavior:'smooth'})"><span class="side-icon">↗</span>我的隧道</button>
      <button class="side-link" onclick="document.querySelector('.ports-section')?.scrollIntoView({behavior:'smooth'})"><span class="side-icon">#</span>端口资源</button>
      <div class="sidebar-section-label">工具</div>
      <a class="side-link" href="/config/frpc.toml"><span class="side-icon">↓</span>下载配置</a>
      <a class="side-link" href="/config/deploy-frpc.sh"><span class="side-icon">⚙</span>部署脚本</a>
      <div class="sidebar-spacer"></div>
    </aside>`;
  app.innerHTML = appLayoutHtml(`
    <section class="workspace-hero"><div><div class="hero-overline">FRP WORKSPACE</div><h1>连接你的内网服务</h1><p>统一管理隧道、端口和客户端配置，让每条映射都清晰可控。</p></div><button onclick="openTunnelModal()">＋ 新建隧道</button></section>
    <div class="workspace-stats">
      <section class="workspace-stat highlight"><span>隧道总数</span><strong>${data.tunnels.length}</strong><small>${data.tunnels.filter(t => t.enabled).length} 条正在启用</small></section>
      <section class="workspace-stat"><span>端口资源</span><strong>${ps.free || 0}</strong><small>可用 / 共 ${ps.total || 0} 个</small></section>
      <section class="workspace-stat"><span>今日流量</span><strong>${fmtBytes(todayTraffic)}</strong><small>${trafficLimit ? `上限 ${fmtBytes(trafficLimit)}` : '当前不限额'}</small></section>
      <section class="workspace-stat"><span>接入节点</span><strong>${esc(data.node?.region || '-')}</strong><small>${esc(data.frps.addr)}:${esc(data.frps.port)}</small></section>
    </div>
    <div class="workspace-columns"><div class="workspace-primary">
    ${isAdmin ? '' : userFrpsDashboardHtml(data.frps_user_dashboard)}
    ${isAdmin ? '' : `<section class="card ports-section"><div class="section-title"><div><div class="section-kicker">RESOURCE POOL</div><h2>端口资源</h2></div><p>黄色表示已分配给隧道</p></div><div class="ports">${portsHtml}</div></section>`}
    <section class="card tunnel-config-entry"><div class="section-title"><div><div class="section-kicker">QUICK ACTION</div><h2>开始创建映射</h2></div><p>支持 TCP / UDP / HTTP / HTTPS 等协议</p></div><button onclick="openTunnelModal()">新建隧道</button><span class="muted small">填写本地服务和公网访问方式，创建后下载最新 frpc 配置。</span></section>
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
    <section class="card tunnel-list-section"><div class="section-title"><div><div class="section-kicker">MY TUNNELS</div><h2>我的隧道</h2><p>一张卡片对应一条映射。修改配置后，请重新下载 frpc.toml 并重启客户端。</p></div><span class="section-count">${data.tunnels.length} 条隧道</span></div><div class="tunnel-card-grid">${tunnelRows}</div></section>
    </div><aside class="workspace-aside">
      <section class="side-info-card"><div class="section-kicker">ACCOUNT</div><h3>账号信息</h3><div class="info-line"><span>当前账号</span><strong>${esc(data.user.username)}</strong></div><div class="info-line"><span>所在节点</span><strong>${esc(data.node?.region || '-')} / ${esc(data.node?.name || '-')}</strong></div><div class="info-line"><span>端口上限</span><strong>${esc(data.user.max_ports)}</strong></div><div class="info-line"><span>有效期</span><strong>${esc(data.user.expires_text)}</strong></div></section>
      <section class="side-info-card dark-side"><div class="section-kicker">ACCESS POINT</div><h3>FRPS 接入点</h3><div class="endpoint-big">${esc(data.frps.addr)}</div><code>${esc(data.frps.port)}</code><div class="side-actions"><a class="btn" href="/config/frpc.toml">下载配置</a><a class="btn secondary" href="/config/deploy-frpc.sh">部署脚本</a></div></section>
      ${userDeployScriptAddressHtml(data.user, {title:'部署地址', desc:'复制给需要安装客户端的服务器。'})}
    </aside></div>`, 'dashboard', '概览');
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

async function toggleTunnel(id){ await api('/api/tunnels/toggle', {method:'POST', body:{id}}).then(()=>loadDashboard('tunnels')).catch(e=>show(e.message,true)); }
async function deleteTunnel(id){ if(confirm('删除这个隧道？')) await api('/api/tunnels/delete', {method:'POST', body:{id}}).then(()=>loadDashboard('tunnels')).catch(e=>show(e.message,true)); }

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
  const monitorStats = {
    trafficIn: Number(dash.traffic_in || 0),
    trafficOut: Number(dash.traffic_out || 0),
    trafficTotal: Number(dash.traffic_total || 0),
    curConns: Number(dash.cur_conns || 0),
    online: Number(dash.online_count || 0),
  };
  const rows = (dash.proxies || []).map(p => `
    <tr>
      <td>${esc(p.username || '-')}</td><td>${esc(p.name || '-')}</td><td>${esc(p.type || '-')}</td>
      <td>${p.status === 'online' ? '<span class="ok">online</span>' : `<span class="bad">${esc(p.status || 'unknown')}</span>`}</td>
      <td>${esc(p.remote_port || (Array.isArray(p.custom_domains) ? p.custom_domains.join(', ') : p.custom_domains) || '-')}</td>
      <td>${esc(p.cur_conns || 0)}</td><td>${fmtBytes(p.today_traffic_in)} / ${fmtBytes(p.today_traffic_out)}<br><span class="muted small">总流量：${fmtBytes(Number(p.today_traffic_in || 0) + Number(p.today_traffic_out || 0))}</span></td>
      <td>${esc(p.client_version || '-')}</td><td>${esc(p.last_start_time || '-')}</td><td>${esc(p.last_close_time || '-')}</td>
    </tr>`).join('') || emptyRow(10, dash.enabled ? '暂无映射数据' : (dash.error || 'frps dashboard 未接入'));
  app.innerHTML = appLayoutHtml(`
    <section class="card dashboard-hero"><div><div class="eyebrow">FRPS MONITOR</div><h2>映射监控</h2><p>管理员全局视图；普通用户页面仍只显示自己的映射。</p></div><div class="hero-actions"><button onclick="loadAdminProxies(${adminProxyPage})">刷新</button><button class="secondary" onclick="loadAdminDashboard()">返回仪表盘</button></div></section>
    <section class="monitor-summary-grid">
      <section class="card monitor-summary-card monitor-summary-primary"><span>今日总流量</span><strong>${fmtBytes(monitorStats.trafficTotal)}</strong><small>入 ${fmtBytes(monitorStats.trafficIn)} · 出 ${fmtBytes(monitorStats.trafficOut)}</small></section>
      <section class="card monitor-summary-card"><span>今日入站</span><strong>${fmtBytes(monitorStats.trafficIn)}</strong><small>所有节点汇总</small></section>
      <section class="card monitor-summary-card"><span>今日出站</span><strong>${fmtBytes(monitorStats.trafficOut)}</strong><small>所有节点汇总</small></section>
      <section class="card monitor-summary-card"><span>当前连接</span><strong>${monitorStats.curConns}</strong><small>在线映射 ${monitorStats.online} / ${total}</small></section>
    </section>
    <section class="card admin-toolbar row">
      <label>用户筛选 <input id="adminProxyUserFilter" value="${esc(adminProxyUserFilter)}" placeholder="留空显示全部"></label>
      <label>每页显示 <select id="adminProxyPageSize"><option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
      <button id="adminProxyApply">应用</button>
      <button class="secondary" id="adminProxyClear">清空</button>
      <span class="muted small">共 ${total} 条 · 第 ${adminProxyPage} / ${pages} 页</span>
    </section>
    <section class="card"><table><thead><tr><th>用户</th><th>名称</th><th>类型</th><th>状态</th><th>公网端口/域名</th><th>连接数</th><th>今日入/出 / 总流量</th><th>客户端</th><th>启动时间</th><th>关闭时间</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="pager"><button class="secondary" ${adminProxyPage <= 1 ? 'disabled' : ''} onclick="loadAdminProxies(${adminProxyPage - 1})">上一页</button><span class="muted small">第 ${adminProxyPage} / ${pages} 页</span><button class="secondary" ${adminProxyPage >= pages ? 'disabled' : ''} onclick="loadAdminProxies(${adminProxyPage + 1})">下一页</button></div>
    </section>`, 'proxies', '映射监控');
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
  const allUsers = data.users || [];
  const userQuery = adminUserSearch.trim().toLocaleLowerCase();
  const filteredUsers = allUsers.filter(u => {
    const searchable = [u.username, u.invite_key_used, u.node_region, u.node_name, u.id].join(' ').toLocaleLowerCase();
    if(userQuery && !searchable.includes(userQuery)) return false;
    if(adminUserNode && String(u.node_id ?? '') !== String(adminUserNode)) return false;
    if(adminUserStatus === 'active' && (!u.active || u.expired)) return false;
    if(adminUserStatus === 'disabled' && u.active) return false;
    if(adminUserStatus === 'expired' && !u.expired) return false;
    return true;
  });
  const usersPage = clampPage(adminPages.users, filteredUsers.length, ADMIN_PAGE_SIZE);
  const keysPage = clampPage(adminPages.keys, (data.invite_keys || []).length, ADMIN_PAGE_SIZE);
  const nodesPage = clampPage(adminPages.nodes, (data.nodes || []).length, ADMIN_PAGE_SIZE);
  const riskPage = clampPage(adminPages.risk, (data.logs || []).length, ADMIN_PAGE_SIZE);
  adminPages.users = usersPage; adminPages.keys = keysPage; adminPages.nodes = nodesPage; adminPages.risk = riskPage;
  const usersSlice = pageItems(filteredUsers, usersPage, ADMIN_PAGE_SIZE);
  const keysSlice = pageItems(data.invite_keys || [], keysPage, ADMIN_PAGE_SIZE);
  const nodesSlice = pageItems(data.nodes || [], nodesPage, ADMIN_PAGE_SIZE);
  const logsSlice = pageItems(data.logs || [], riskPage, ADMIN_PAGE_SIZE);
  const rows = usersSlice.map(u => `
    <tr>
      <td>${u.id}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(u.node_region || '-')} / ${esc(u.node_name || '-')}</td><td>${u.port_count}/${u.max_ports}</td><td>${u.tunnel_count}</td>
      <td>${fmtBytes(u.traffic_limit_bytes)} / ${u.bandwidth_limit_kbps ? `${(Number(u.bandwidth_limit_kbps) / 1024).toFixed(1)} MB/s` : '不限'}</td>
      <td>${esc(u.expires_text)} ${u.expired ? '<span class="bad">已到期</span>' : ''}</td>
      <td>${u.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td><code class="token" title="${esc(u.invite_key_used || '')}">${esc(u.invite_key_used || '后台创建')}</code></td>
      <td class="actions node-actions user-actions">
        <button class="node-action" onclick="adminToggle(${u.id})">${u.active ? '停用' : '启用'}</button>
        <button class="node-action" onclick="adminExtend(${u.id})">续30天</button>
        <button class="node-action" onclick="adminLimits(${u.id}, ${Number(u.traffic_limit_bytes || 0)}, ${Number(u.bandwidth_limit_kbps || 0)})">改套餐</button>
        <button class="node-action" onclick="adminReset(${u.id})">重置密码</button>
        <button class="node-action node-action-danger" onclick="adminDelete(${u.id})">删除</button>
      </td>
    </tr>`).join('');
  const nodeRows = nodesSlice.map(n => `
    <tr>
      <td>${n.id}</td><td>${esc(n.region)}</td><td>${esc(n.name)}</td><td>${esc(n.server_addr)}:${n.server_port}</td>
      <td>${n.port_start}-${n.port_end}</td><td>${n.free_count}/${n.port_count}</td>
      <td>${n.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td>${esc(n.note)}</td>
      <td class="actions node-actions"><button class="node-action" onclick='editNode(${JSON.stringify(n)})'>编辑</button><button class="node-action" onclick="nodeToggle(${n.id})">${n.active ? '停用' : '启用'}</button><a class="btn node-action" href="/config/frps.example.toml?node_id=${n.id}">frps配置</a><button class="node-action node-action-danger" onclick="nodeDelete(${n.id})">删除</button></td>
    </tr>`).join('') || emptyRow(9, '还没有节点');
  const keyRows = keysSlice.map(k => `
    <tr>
      <td>${k.id}</td>
      <td><code class="token" title="${esc(k.key)}">${esc(k.key)}</code></td>
      <td>${esc(k.note)}</td>
      <td>${k.used_count}/${k.max_uses}</td>
      <td>${k.max_ports}</td>
      <td>${fmtBytes(k.traffic_limit_bytes)} / ${k.bandwidth_limit_kbps ? `${(Number(k.bandwidth_limit_kbps) / 1024).toFixed(1)} MB/s` : '不限'}</td>
      <td>${k.user_expires_days === 0 ? '永不过期' : `${k.user_expires_days} 天`}</td>
      <td>${esc(k.expires_text)} ${k.expired ? '<span class="bad">已过期</span>' : ''}</td>
      <td>${k.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td class="actions"><button onclick="copyText('${k.key}')">复制</button><button onclick="inviteToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button class="danger" onclick="inviteDelete(${k.id})">删除</button></td>
    </tr>`).join('') || emptyRow(10, '还没有注册密钥');
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
    <section class="card hidden" id="editNodeCard"><div class="section-title"><h2>编辑节点</h2><p>建议使用稳定域名，方便后期更换 VPS</p></div><form id="editNodeForm" class="grid">
      <input type="hidden" name="id">
      <div><label>地区</label><input name="region" required></div>
      <div><label>节点名</label><input name="name" required></div>
      <div><label>frps 域名/地址</label><input name="server_addr" required></div>
      <div><label>frps bindPort</label><input name="server_port" type="number" min="1" max="65535"></div>
      <div><label>frps token</label><input name="auth_token" required></div>
      <div><label>带宽（Mbps）</label><input name="bandwidth_mbps" type="number" min="0" step="1" placeholder="例如 100"><span class="muted small">填写节点带宽，0 表示不限</span></div>
      <div><label>状态</label><select name="active"><option value="1">启用</option><option value="0">停用</option></select></div>
      <div><label>备注</label><input name="note"></div>
      <div style="align-self:end"><button>保存修改</button><button type="button" class="secondary" onclick="document.querySelector('#editNodeCard').classList.add('hidden')">取消</button></div>
    </form><p class="muted small">建议 frps 地址填写域名，例如 <code>hk.example.com</code>。后期更换 VPS 时优先改 DNS，用户的 frpc 配置可保持不变。</p></section>
    <section class="card"><div class="section-title"><h2>新增节点</h2><p>每个节点独立端口池和 token</p></div><form id="nodeForm" class="grid">
      <div><label>地区</label><input name="region" placeholder="香港 / 日本 / 美国" required></div>
      <div><label>节点名</label><input name="name" placeholder="hk-1" required></div>
      <div><label>frps 域名/地址</label><input name="server_addr" placeholder="hk.example.com" required></div>
      <div><label>frps bindPort</label><input name="server_port" type="number" value="7000" min="1" max="65535"></div>
      <div><label>frps token</label><input name="auth_token" placeholder="CHANGE_ME" required></div>
      <div><label>带宽（Mbps）</label><input name="bandwidth_mbps" type="number" value="0" min="0" step="1"><span class="muted small">0 表示不限</span></div>
      <div><label>端口起始</label><input name="port_start" type="number" value="20000" min="1" max="65535"></div>
      <div><label>端口结束</label><input name="port_end" type="number" value="20199" min="1" max="65535"></div>
      <div><label>备注</label><input name="note" placeholder="线路/机房说明"></div>
      <div style="align-self:end"><button>创建节点</button></div>
    </form></section>
    <section class="card" id="nodes"><div class="section-title"><h2>节点列表</h2><p>启用节点优先，剩余端口多的排前面</p></div><table><thead><tr><th>ID</th><th>地区</th><th>节点</th><th>frps</th><th>端口池</th><th>剩余</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>${nodeRows}</tbody></table>${paginationHtml('nodes', nodesPage, (data.nodes || []).length, ADMIN_PAGE_SIZE)}</section>`;
  const keysHtml = `
    <section class="card" id="keys"><div class="section-title"><h2>生成注册密钥</h2><p>注册密钥固定单次使用，适合批量发货</p></div><form id="inviteForm" class="grid">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/套餐名"></div>
      <div><label>每枚可用次数</label><input name="max_uses" type="number" value="1" min="1" max="1" disabled><span class="muted small">固定 1 次</span></div>
      <div><label>注册后端口数</label><input name="max_ports" type="number" value="5" min="1" max="100"></div>
      <div><label>今日流量上限 GB</label><input name="traffic_limit_gb" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限</span></div>
      <div><label>速率策略 MB/s</label><input name="bandwidth_limit_mbs" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限；仅后台可见</span></div>
      <div><label>注册后账号有效期天数</label><input name="user_expires_days" type="number" value="30" min="0" max="3650"></div>
      <div><label>密钥有效期天数</label><input name="key_expires_days" type="number" value="30" min="0" max="3650"></div>
      <div style="align-self:end"><button>生成密钥</button></div>
    </form><p><a class="btn" href="/admin/export/invite-keys.csv">导出未使用可用密钥 CSV</a></p><p class="panel-note small">批量生成后会自动复制并下载本次生成的 txt。CSV 导出只包含未使用、启用中、未过期的密钥。</p></section>
    <section class="card"><div class="section-title"><h2>注册密钥列表</h2><p>已使用密钥不会出现在 CSV 导出里</p></div><table><thead><tr><th>ID</th><th>密钥</th><th>备注</th><th>使用</th><th>端口</th><th>流量/速率策略</th><th>账号有效期</th><th>密钥到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${keyRows}</tbody></table>${paginationHtml('keys', keysPage, (data.invite_keys || []).length, ADMIN_PAGE_SIZE)}</section>
    ${data.software_license_authority ? `<section class="card" id="software-licenses"><div class="section-title"><h2>服务器软件授权码</h2><p>卖家后台使用：先批量生成授权码发给客户；客户输入授权码后自动绑定他的部署服务器。</p></div><form id="softwareLicenseForm" class="grid">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/客户名"></div>
      <div><label>套餐</label><input name="plan" value="deploy"></div>
      <div><label>有效期天数</label><input name="expires_days" type="number" value="0" min="0" max="3650"><span class="muted small">0 表示永不过期</span></div>
      <div style="align-self:end"><button>生成软件授权码</button></div>
    </form><p class="panel-note small">客户不需要提供机器码；首次激活时授权服务器会自动绑定机器。批量生成后会自动复制并下载 txt。</p>
    <table><thead><tr><th>ID</th><th>授权码</th><th>备注</th><th>套餐</th><th>绑定机器</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${softwareKeyRows}</tbody></table></section>` : ''}`;
  const usersHtml = `
    <section class="card"><div class="section-title"><h2>创建用户</h2><p>管理员直开账号，可指定接入节点</p></div><form id="createUserForm" class="grid">
      <div><label>用户名</label><input name="username" required></div>
      <div><label>初始密码</label><input name="password" type="password" required></div>
      <div><label>接入节点</label><select name="node_id" required>${adminNodeOptions}</select></div>
      <div><label>端口数量</label><input name="max_ports" type="number" value="5" min="1" max="100"></div>
      <div><label>今日流量上限 GB</label><input name="traffic_limit_gb" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限</span></div>
      <div><label>速率策略 MB/s</label><input name="bandwidth_limit_mbs" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限；仅后台可见</span></div>
      <div><label>有效期天数</label><input name="expires_days" type="number" value="30" min="0" max="3650"><span class="muted small">0 表示永不过期</span></div>
      <div style="align-self:end"><button>创建</button></div>
    </form></section>
    <section class="card" id="users"><div class="section-title"><h2>用户列表</h2><p>管理状态、续期、注册密钥和删除账号</p></div>
      <form id="adminUserFilterForm" class="grid admin-user-filters">
        <div><label for="adminUserSearch">搜索用户</label><input id="adminUserSearch" name="search" value="${esc(adminUserSearch)}" placeholder="用户名、ID、注册密钥"></div>
        <div><label for="adminUserNode">接入节点</label><select id="adminUserNode" name="node"><option value="">全部节点</option>${(data.nodes || []).map(n => `<option value="${n.id}" ${String(n.id)===String(adminUserNode)?'selected':''}>${esc(n.region)} / ${esc(n.name)}</option>`).join('')}</select></div>
        <div><label for="adminUserStatus">账号状态</label><select id="adminUserStatus" name="status"><option value="all" ${adminUserStatus==='all'?'selected':''}>全部状态</option><option value="active" ${adminUserStatus==='active'?'selected':''}>正常启用</option><option value="disabled" ${adminUserStatus==='disabled'?'selected':''}>已停用</option><option value="expired" ${adminUserStatus==='expired'?'selected':''}>已到期</option></select></div>
        <div class="form-actions"><button type="submit">筛选</button><button type="button" class="secondary" id="adminUserFilterReset">重置</button></div>
      </form>
      <p class="muted small">当前 ${filteredUsers.length} 个用户符合条件，共 ${allUsers.length} 个用户。</p><table><thead><tr><th>ID</th><th>用户</th><th>角色</th><th>接入节点</th><th>端口</th><th>隧道</th><th>流量/速率策略</th><th>到期</th><th>状态</th><th>注册密钥</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>${paginationHtml('users', usersPage, filteredUsers.length, ADMIN_PAGE_SIZE)}</section>`;
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
  const sectionTitles = {users:'用户管理', keys:'注册密钥', nodes:'新增节点', risk:'风控审计'};
  app.innerHTML = appLayoutHtml(sectionHtml, currentAdminSection, sectionTitles[currentAdminSection] || '管理台');
  const adminUserFilterForm = document.querySelector('#adminUserFilterForm');
  if(adminUserFilterForm){
    adminUserFilterForm.onsubmit = (e) => {
      e.preventDefault();
      adminUserSearch = document.querySelector('#adminUserSearch').value.trim();
      adminUserNode = document.querySelector('#adminUserNode').value;
      adminUserStatus = document.querySelector('#adminUserStatus').value;
      adminPages.users = 1;
      loadAdmin('users');
    };
    document.querySelector('#adminUserFilterReset').onclick = () => {
      adminUserSearch = '';
      adminUserNode = '';
      adminUserStatus = 'all';
      adminPages.users = 1;
      loadAdmin('users');
    };
  }
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
async function adminLimits(id, trafficBytes=0, bandwidthKbps=0){
  const currentGb = trafficBytes ? (Number(trafficBytes) / 1024 / 1024 / 1024).toFixed(1) : '0';
  const currentMbs = bandwidthKbps ? (Number(bandwidthKbps) / 1024).toFixed(1) : '0';
  const traffic_limit_gb = prompt('今日流量上限 GB（0 表示不限）', currentGb);
  if(traffic_limit_gb === null) return;
  const bandwidth_limit_mbs = prompt('速率策略 MB/s（0 表示不限，仅后台可见）', currentMbs);
  if(bandwidth_limit_mbs === null) return;
  await api('/api/admin/users/limits', {method:'POST', body:{id, traffic_limit_gb, bandwidth_limit_mbs}}).then(r=>{show(r.message||'已更新套餐'); loadAdmin();}).catch(e=>show(e.message,true));
}
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
  for(const k of ['id','region','name','server_addr','server_port','auth_token','note','bandwidth_mbps']) f.elements[k].value = n[k] ?? '';
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

async function loadAdminHealth(){
  clearAdminDashboardTimer();
  hideFlash();
  currentAdminSection = 'health';
  setNav();
  let data;
  try{ data = await api('/api/admin/dashboard'); }
  catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    show(err.message, true);
    return;
  }
  const healthPageSize = nodeHealthPageSize();
  nodeHealthPage = clampPage(nodeHealthPage, (data.nodes || []).length, healthPageSize);
  const healthNodes = pageItems(data.nodes || [], nodeHealthPage, healthPageSize);
  const nodeRows = healthNodes.map(n => `
    <tr>
      <td><b>${esc(n.name)}</b><span class="muted small">${esc(n.server_addr || '')}:${esc(n.server_port || '')}</span></td>
      <td>${nodeStatusBadge(n)}<span class="muted small">${esc(n.auth_message || '')}</span></td>
      <td>${Number(n.port_count || 0) - Number(n.free_count || 0)} / ${n.port_count || 0}</td>
    </tr>`).join('') || emptyRow(3, '暂无节点');
  app.innerHTML = appLayoutHtml(`
    <section class="card dashboard-hero"><div><div class="eyebrow">NODE HEALTH</div><h2>节点健康</h2><p>检查 frps bind/auth 端口连通性，确认节点在线和端口池使用情况。</p></div><div class="hero-actions"><button onclick="loadAdminHealth()">立即刷新</button><button class="secondary" onclick="loadAdminDashboard()">返回仪表盘</button></div></section>
    <section class="card node-health-card"><div class="section-title"><h2>节点健康状态</h2><p>每页 ${healthPageSize} 条</p></div>
      <table class="compact-table"><thead><tr><th>节点</th><th>状态</th><th>端口使用</th></tr></thead><tbody>${nodeRows}</tbody></table>
      ${paginationHtml('health', nodeHealthPage, (data.nodes || []).length, healthPageSize)}
    </section>`, 'health', '节点健康');
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
  app.innerHTML = appLayoutHtml(`
    <section class="dashboard-hero card">
      <div>
        <div class="eyebrow">ADMIN DASHBOARD</div>
        <h2>运行总览</h2>
        <p>主机资源、备份和运维入口集中在这里。最后检查：${esc(nowText)}</p>
      </div>
      <div class="hero-actions">
        <button onclick="loadAdminDashboard()">立即刷新</button>
        <button class="secondary" onclick="loadAdmin('nodes')">新增节点</button>
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
    </section>`, 'admin-dashboard', '运行总览');
  const r2Form = document.querySelector('#r2ConfigForm');
  if(r2Form) r2Form.onsubmit = saveR2Config;
  const adminFrpcForm = document.querySelector('#adminFrpcForm');
  if(adminFrpcForm){ adminFrpcForm.onsubmit = submitAdminFrpc; renderAdminDeployScriptAddress(); renderAdminFrpcRows(); }
  adminDashboardTimer = setTimeout(() => loadAdminDashboard(true), refreshSeconds * 1000);
}

loadMe();


async function openNodeSwitch(){
  const modal=document.getElementById('nodeSwitchModal');
  const list=document.getElementById('nodeSwitchList');
  if(!modal||!list)return;
  modal.classList.remove('hidden');
  list.innerHTML='<p class="muted">正在加载可用节点…</p>';
  try{
    const result=await api('/api/nodes');
    const nodes=(result.nodes||[]).filter(n=>n.active);
    if(!nodes.length){list.innerHTML='<p class="muted">目前没有可切换的在线节点。</p>';return;}
    const current=nodes.find(n=>String(n.id)===String(currentDashboardNodeId));
    list.innerHTML=nodes.map(n=>`<button type="button" class="node-switch-option ${String(n.id)===String(currentDashboardNodeId)?'is-current':''}" onclick="switchDashboardNode(${Number(n.id)})"><span class="node-option-pin">⌖</span><span class="node-option-copy"><strong>${esc(n.name)}</strong><small>${esc(n.region||'位置未设置')} · ${esc(n.server_addr||'')}</small></span><span class="node-option-status">${String(n.id)===String(currentDashboardNodeId)?'当前节点':'选择此节点'}</span></button>`).join('');
  }catch(err){list.innerHTML='<p class="error">'+esc(err.message||'节点列表加载失败')+'</p>';}
}
function closeNodeSwitch(){document.getElementById('nodeSwitchModal')?.classList.add('hidden');}
let currentDashboardNodeId=null;
async function switchDashboardNode(nodeId){
  if(!nodeId||String(nodeId)===String(currentDashboardNodeId)){closeNodeSwitch();return;}
  if(!confirm('确定切换接入节点？已有隧道不会自动迁移，切换前请确认目标节点资源。'))return;
  try{
    await api('/api/user/node/switch',{method:'POST',body:{node_id:nodeId}});
    closeNodeSwitch();
    show('接入节点已切换，建议重新下载 frpc 配置。');
    await loadDashboard();
  }catch(err){show(err.message,true);}
}
