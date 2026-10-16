const app = document.querySelector('#app');
const nav = document.querySelector('#nav');
const flash = document.querySelector('#flash');
let currentUser = null;
let softwareLicense = null;
let currentAdminSection = 'users';
let adminDashboardTimer = null;
let panelVersion = '';
let panelUptime = 0;
let panelLatest = '';
let panelUpdateLink = 'https://github.com/bohu-t/lite-install#readme';
let tunnelPreviewTimer = null;
let csrfToken = null;
let clientNodeProbeUrl = '';
let colorMode = localStorage.getItem('fml_color_mode') || 'light';
let trafficRange = '30d';
const trafficChartCache = {};
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
let editingTunnelId = null;
let lastTunnels = [];
let adminSetupKey = '';
let adminFrpcUsers = [];
let adminSmtp = {};
let adminCurrentPage = 'dashboard';
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

// 应用布局顶栏的亮/暗直接切换（两态，点一下就有明显变化）
function toggleLightDark(){
  applyColorMode(resolvedColorMode() === 'dark' ? 'light' : 'dark');
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
          <div class="auth-brand"><span class="auth-brand-mark">F</span><span>Frp 管理台</span></div>
          <div class="auth-topbar-tools"><span>安全、稳定、易用</span><button type="button" class="auth-theme-button" data-nav="theme-toggle" title="切换主题">◐</button></div>
        </div>
      </header>
      <main class="auth-main">
        <section class="auth-visual">
          <div class="auth-visual-glow auth-visual-glow-one"></div><div class="auth-visual-glow auth-visual-glow-two"></div>
          <div class="auth-visual-content">
            <div class="auth-visual-brand"><span class="auth-visual-mark">F</span><strong>Frp 管理台</strong></div>
            <h1>高效、专业的<br>内网穿透管理平台</h1>
            <p>统一管理隧道、端口和客户端配置，让每条映射都清晰可控。</p>
            <div class="auth-visual-points"><span>高速线路</span><span>全协议支持</span><span>${esc(regionText)}</span></div>
          </div>
        </section>
        <section class="auth-form-area">
          <div class="auth-form-wrap">
            <div class="auth-mobile-brand"><span class="auth-brand-mark">F</span><strong>Frp 管理台</strong></div>
            <div class="auth-form-card">
              <div class="auth-form-heading"><h2>${title}</h2><p>${subtitle || '欢迎回来，请登录您的账号'}</p></div>
              ${formHtml}
              ${footHtml}
            </div>
            <p class="auth-footer">© 2026 Frp 管理台</p>
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
function tunnelMappingState(t){
  const status = t.mapping_status || (t.enabled ? 'unknown' : 'disabled');
  return {
    cls: status === 'online' ? 'ok' : (status === 'registered' ? 'warn' : (status === 'disabled' ? 'muted' : 'bad')),
    label: status === 'online' ? '已映射' : (status === 'registered' ? '已注册' : (status === 'disabled' ? '已停用' : '未连接'))
  };
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
    return `<section class="card"><div class="section-title"><h2>${stIcon('monitor')}我的映射监控</h2><p>${esc(dash?.error || '暂未接入 frps dashboard')}</p></div><p class="muted small">当前仍可通过“映射状态”列查看端口连通性。</p></section>`;
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
  return `<section class="card"><div class="section-title"><div><h2>${stIcon('monitor')}实时映射</h2><p>只显示当前账号的 frps 代理，不会看到其他用户。</p></div><span class="section-count">${(dash.proxies || []).length} 个代理</span></div><div class="proxy-card-grid">${cards}</div></section>`;
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

// Inline SVG icons supplied for the quick actions and profile tools.
const QICON_TUNNEL = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M1023.910943 511.999898c5.11911 317.794367-194.116663 516.825376-511.91103 511.911029-317.794367 4.914346-516.825376-194.116663-511.91103-511.911029C-4.825463 194.20553 194.205546-4.825478 511.999913 0.088868c317.794367-4.914346 516.825376 194.116663 511.91103 511.91103z" fill="#1296db"/><path d="M1022.477592 566.671996C1006.915497 340.40732 852.318366 201.16752 614.382119 204.85328c-254.112635-4.095288-413.624112 155.416189-409.528824 409.528824-3.890524 237.936247 135.554041 392.533378 361.613952 408.095473 268.036615-16.381153 439.629192-187.97373 456.010345-455.805581z" fill="#1296db"/><path d="M1015.515602 629.944199C985.824762 491.523456 876.480566 407.160519 716.764325 409.617692c-190.635668-3.071466-310.218084 116.51095-307.146618 307.146618-2.457173 159.716241 81.905765 269.060437 220.121743 298.751277 211.112109-34.400421 351.375731-174.664043 385.776152-385.571388z" fill="#1296db"/><path d="M997.701098 705.707031C964.734028 646.734881 902.076118 613.153517 819.146531 614.382104c-127.1587-2.047644-206.812056 77.605712-204.764412 204.764412-1.433351 82.929587 32.352777 145.587497 91.120163 178.554567a431.233852 431.233852 0 0 0 292.198816-291.994052z" fill="#1296db"/><path d="M380.745925 839.622957a196.369071 196.369071 0 0 1-139.035036-335.404107l87.434404-87.434404a31.738484 31.738484 0 0 1 44.843406 44.843406L286.75906 549.062256a133.096868 133.096868 0 0 0 188.383259 188.383259l87.434404-87.434404a31.738484 31.738484 0 0 1 44.843406 44.843406l-87.434404 87.434404a195.959542 195.959542 0 0 1-139.2398 57.334036zM672.330448 616.634512a31.738484 31.738484 0 0 1-22.319321-54.057805L737.240766 474.937539a133.096868 133.096868 0 0 0-188.383259-188.383259l-87.434404 87.434404a31.738484 31.738484 0 0 1-44.843406-44.843406l87.434404-87.434404a196.573835 196.573835 0 0 1 278.070071 278.070071l-87.434403 87.434404a31.533719 31.533719 0 0 1-22.319321 9.419163z" fill="#BDEFD1"/><path d="M439.103782 637.725247a52.829218 52.829218 0 0 1-37.267123-90.096342l145.792262-145.792261a52.829218 52.829218 0 0 1 74.73901 74.73901l-145.792261 145.792262a52.624454 52.624454 0 0 1-37.471888 15.357331z" fill="#FFFFFF"/></svg>';
const QICON_PORT = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 1024A512 512 0 1 1 512.056889-0.056889 512 512 0 0 1 512 1024z m289.792-512a284.444444 284.444444 0 1 0-284.444444 284.444444 282.851556 282.851556 0 0 0 194.673777-77.994666l93.184 93.184 40.220445-40.277334-95.914667-95.914666A282.112 282.112 0 0 0 801.792 512z m-284.444444 227.555556a227.555556 227.555556 0 1 1 0-455.111112 227.555556 227.555556 0 0 1 0 455.111112z" fill="#4FD2C2"/></svg>';
const QICON_TRAFFIC = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M960 544A480 480 0 1 1 480 64v480h480z" fill="#9526eb"/><path d="M1024 480H544V0a480 480 0 0 1 480 480z" fill="#F3ADBA"/></svg>';
const QICON_DOWNLOAD = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 512m-450.56 0a450.56 450.56 0 1 0 901.12 0 450.56 450.56 0 1 0-901.12 0Z" fill="#131415"/><path d="M624.64 696.32a30.72 30.72 0 0 1 0 61.44h-225.28a30.72 30.72 0 0 1 0-61.44h225.28zM512 266.24a30.72 30.72 0 0 1 30.72 30.72v217.96864l59.26912-64.65536a30.72 30.72 0 0 1 47.3088 39.1168l-2.00704 2.41664-112.64 122.88a30.72 30.72 0 0 1-43.06944 2.19136l-2.23232-2.19136-112.64-122.88a30.72 30.72 0 0 1 43.04896-43.7248l2.2528 2.19136 59.26912 64.69632V296.96A30.72 30.72 0 0 1 512 266.24z" fill="#FFFFFF"/></svg>';
const QICON_USER = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 512m-512 0a512 512 0 1 0 1024 0 512 512 0 1 0-1024 0Z" fill="#FD846F"/><path d="M646.339048 374.954667c0 75.897905-61.318095 136.777143-137.801143 136.777143s-137.825524-60.879238-137.825524-136.777143c0-75.922286 61.342476-136.021333 137.825524-136.021334 76.483048 0 137.825524 60.099048 137.825524 136.021334z m82.724571 417.401904H281.112381c-19.69981 0-28.550095-14.628571-28.550095-34.108952 0-115.95581 85.650286-207.530667 199.850666-207.530667h105.325715c114.200381 0 213.625905 92.550095 213.625904 208.505905v-1.950476c0.975238 19.504762-22.649905 34.108952-42.325333 35.08419z" fill="#FFFFFF"/></svg>';
const QICON_VERSION = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 64 128 256v512l384 192 384-192V256z" fill="#7C5CFF"/><path d="M512 152 216 300v424l296 148 296-148V300z" fill="#FFFFFF"/><path d="M512 240 304 344v336l208 104 208-104V344z" fill="#7C5CFF"/></svg>';
const QICON_SERVER = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><rect x="128" y="160" width="768" height="288" rx="44" fill="#2C6DD2"/><rect x="128" y="576" width="768" height="288" rx="44" fill="#20C997"/><circle cx="240" cy="304" r="34" fill="#FFFFFF"/><circle cx="240" cy="720" r="34" fill="#FFFFFF"/><rect x="330" y="286" width="420" height="36" rx="18" fill="#FFFFFF"/><rect x="330" y="702" width="420" height="36" rx="18" fill="#FFFFFF"/></svg>';
const QICON_CPU = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><g fill="#3478F6"><rect x="440" y="96" width="48" height="152" rx="24"/><rect x="536" y="96" width="48" height="152" rx="24"/><rect x="440" y="776" width="48" height="152" rx="24"/><rect x="536" y="776" width="48" height="152" rx="24"/><rect x="96" y="440" width="152" height="48" rx="24"/><rect x="96" y="536" width="152" height="48" rx="24"/><rect x="776" y="440" width="152" height="48" rx="24"/><rect x="776" y="536" width="152" height="48" rx="24"/></g><rect x="248" y="248" width="528" height="528" rx="76" fill="#3478F6"/><rect x="368" y="368" width="288" height="288" rx="40" fill="#FFFFFF"/></svg>';
const QICON_MEM = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><rect x="96" y="288" width="832" height="448" rx="60" fill="#9353F9"/><g fill="#FFFFFF"><rect x="184" y="392" width="88" height="240" rx="26"/><rect x="328" y="392" width="88" height="240" rx="26"/><rect x="472" y="392" width="88" height="240" rx="26"/><rect x="616" y="392" width="88" height="240" rx="26"/><rect x="760" y="392" width="88" height="240" rx="26"/></g></svg>';
const QICON_KEY = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><circle cx="392" cy="384" r="216" fill="#F5A623"/><circle cx="392" cy="384" r="88" fill="#FFFFFF"/><rect x="536" y="360" width="368" height="48" rx="24" fill="#F5A623"/><rect x="780" y="408" width="48" height="104" rx="24" fill="#F5A623"/><rect x="664" y="408" width="48" height="80" rx="24" fill="#F5A623"/></svg>';
const QICON_NODE = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><rect x="96" y="168" width="832" height="256" rx="44" fill="#2C6DD2"/><circle cx="216" cy="296" r="32" fill="#FFFFFF"/><rect x="304" y="278" width="420" height="36" rx="18" fill="#FFFFFF"/><circle cx="740" cy="744" r="208" fill="#20C997"/><rect x="684" y="720" width="112" height="48" rx="24" fill="#FFFFFF"/><rect x="716" y="688" width="48" height="112" rx="24" fill="#FFFFFF"/></svg>';
const QICON_RISK = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M512 96l352 128v256c0 224-160 384-352 448-192-64-352-224-352-448V224z" fill="#F45B5B"/><rect x="480" y="312" width="64" height="248" rx="32" fill="#FFFFFF"/><circle cx="512" cy="648" r="44" fill="#FFFFFF"/></svg>';
const QICON_SETTINGS = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><circle cx="512" cy="512" r="168" fill="#5B8DEF"/><circle cx="512" cy="512" r="72" fill="#FFFFFF"/><g fill="#5B8DEF"><rect x="488" y="232" width="48" height="96" rx="24"/><rect x="488" y="696" width="48" height="96" rx="24"/><rect x="232" y="488" width="96" height="48" rx="24"/><rect x="696" y="488" width="96" height="48" rx="24"/><rect x="308" y="318" width="48" height="96" rx="24" transform="rotate(-45 332 366)"/><rect x="668" y="318" width="48" height="96" rx="24" transform="rotate(45 692 366)"/><rect x="308" y="610" width="48" height="96" rx="24" transform="rotate(45 332 658)"/><rect x="668" y="610" width="48" height="96" rx="24" transform="rotate(-45 692 658)"/></g></svg>';

/* --- UI icon set (monochrome stroke icons, inherit currentColor) --- */
const UIICONS = {
  home:'<path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  users:'<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2"/><path d="M16 5.2a3 3 0 0 1 0 5.8M17.5 14.9c2 .6 3.5 2.2 3.5 4.4"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"/>',
  userPlus:'<circle cx="10" cy="8" r="3.4"/><path d="M3.5 20c0-3.2 2.9-5.2 6.5-5.2 1.4 0 2.7.3 3.7.8"/><path d="M17.5 14v6M14.5 17h6"/>',
  key:'<circle cx="8.5" cy="8.5" r="3.6"/><path d="M11 11l8.5 8.5M16.5 16.5l2-2M14 14l2-2"/>',
  license:'<path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z"/><path d="M9.5 12l1.8 1.8 3.2-3.6"/>',
  node:'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  nodePlus:'<rect x="3" y="4" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M12 15v6M9 18h6"/>',
  pulse:'<path d="M3 12h3.5l2-4.5 3 9 2.5-6 1.6 3.5H21"/>',
  bell:'<path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.5 6 1.5 6H4.5S6 13.5 6 9Z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
  monitor:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  risk:'<path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z"/><path d="M12 8.5v4M12 15.8h.01"/>',
  log:'<path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
  search:'<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3"/>',
  mem:'<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3M7 11h2M11 11h2M15 11h2"/>',
  bolt:'<path d="M13.5 3 6 13.5h5L10.5 21 18 10.5h-5z"/>',
  tools:'<path d="M14.5 4.5a3.5 3.5 0 0 0 4.4 4.6L21 11l-2 2-9.6-9.6 2-2z"/><path d="M9.5 8.5 3.6 14.4a2 2 0 0 0 0 2.8l3.2 3.2a2 2 0 0 0 2.8 0l5.9-5.9"/>',
  chart:'<path d="M4 20V4M4 20h16"/><path d="M8 17v-6M12.5 17V8M17 17v-9"/>',
  donut:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  activity:'<path d="M4 6h16M4 12h10M4 18h13"/>',
  port:'<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  tunnel:'<path d="M4 8.5h13l-3.2-3.2M20 15.5H7l3.2 3.2"/>',
  file:'<path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/>',
  script:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
  backup:'<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v11c0 1.7 3.1 3 7 3s7-1.3 7-3v-11"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  cloud:'<path d="M7.5 18.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 9.6 4.2 4.2 0 0 0 7.5 18.5Z"/>',
  edit:'<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13.5 5.5 18.5 10.5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6"/>',
  download:'<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7.2 12 13l8-5.8"/>',
  upload:'<path d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14"/>',
  bucket:'<path d="M5.6 8.2h12.8l-1.3 11a2 2 0 0 1-2 1.75H8.9a2 2 0 0 1-2-1.75Z"/><path d="M9.1 8.2a2.9 2.9 0 0 1 5.8 0"/>',
  database:'<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6"/><path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8"/>',
  cloudUpload:'<path d="M7.5 18h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 9.1 4.2 4.2 0 0 0 7.5 18Z"/><path d="M12 15v-4m0 0-1.8 1.8M12 11l1.8 1.8"/>'
};
function uiIcon(name, cls){
  const body = UIICONS[name];
  if(!body) return '';
  return `<span class="${cls || 'st-icon'}" aria-hidden="true"><svg viewBox="0 0 24 24">${body}</svg></span>`;
}
const stIcon = (name) => uiIcon(name, 'st-icon');
const sideIcon = (name) => uiIcon(name, 'side-icon');

function shortBytes(n){ n = Number(n || 0); if(n < 1024) return `${Math.round(n)} B`; if(n < 1048576) return `${(n/1024).toFixed(0)}K`; if(n < 1073741824) return `${(n/1048576).toFixed(0)}M`; return `${(n/1073741824).toFixed(1)}G`; }

function relTime(ts){
  const t = Number(ts || 0);
  if(!t) return '-';
  const diff = Math.max(0, Math.floor(Date.now()/1000 - t));
  if(diff < 60) return '刚刚';
  if(diff < 3600) return `${Math.floor(diff/60)} 分钟前`;
  if(diff < 86400) return `${Math.floor(diff/3600)} 小时前`;
  if(diff < 86400*7) return `${Math.floor(diff/86400)} 天前`;
  return new Date(t*1000).toLocaleDateString('zh-CN');
}

const PROTO_COLORS = {tcp:'#3b82f6', udp:'#22c55e', http:'#f59e0b', https:'#8b5cf6', stcp:'#06b6d4', xtcp:'#ec4899', tcpmux:'#64748b'};
const protoColor = (t) => PROTO_COLORS[t] || '#94a3b8';

function trafficBarsSvg(series, width){
  const H = 152, padL = 44, padR = 10, padT = 12, padB = 26;
  const W = Math.max(200, Math.round(width || 640));
  const n = Math.max(1, series.length);
  const maxV = Math.max.apply(null, series.map(p => Number(p.bytes) || 0).concat([1]));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(26, slot * 0.62));
  let grid = '';
  [0, 0.5, 1].forEach(f => {
    const yy = padT + innerH - f * innerH;
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="chart-grid"/>`;
    grid += `<text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" class="chart-ylabel">${esc(shortBytes(maxV * f))}</text>`;
  });
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 44))));
  let bars = '';
  series.forEach((p, i) => {
    const v = Number(p.bytes) || 0;
    const x = padL + slot * i + (slot - barW) / 2;
    const yy = padT + innerH - (v / maxV) * innerH;
    const h = Math.max(0, padT + innerH - yy);
    bars += `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, barW/2).toFixed(1)}" class="chart-bar"><title>${esc(p.label)} · ${esc(fmtBytes(v))}</title></rect>`;
    if(i % step === 0 || i === n - 1){
      bars += `<text x="${(padL + slot * i + slot/2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="chart-xlabel">${esc(p.short || p.label)}</text>`;
    }
  });
  return `<svg class="bar-chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}</svg>`;
}

function protocolDonutSvg(items, total){
  const size = 180, r = 70, cx = size/2, cy = size/2, stroke = 22;
  const circ = 2 * Math.PI * r;
  let segs = '', offset = 0;
  if(!total){
    segs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>`;
  } else {
    items.forEach(it => {
      const len = ((Number(it.bytes) || 0) / total) * circ;
      segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${protoColor(it.type)}" stroke-width="${stroke}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(it.label)} · ${esc(fmtBytes(it.bytes))}</title></circle>`;
      offset += len;
    });
  }
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img">${segs}<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-total">${esc(shortBytes(total))}</text><text x="${cx}" y="${cy + 15}" text-anchor="middle" class="donut-caption">本月合计</text></svg>`;
}

const ACTIVITY_ICONS = {login:'👤', tunnel:'🔗', node:'🛰️', traffic:'📶', risk:'⛔', backup:'💾', license:'🔑', default:'•'};
function activityItemHtml(item){
  const icon = ACTIVITY_ICONS[item.kind] || ACTIVITY_ICONS.default;
  const text = (item.bytes !== undefined && item.bytes !== null) ? `今日已使用流量 ${fmtBytes(item.bytes)}` : (item.text || item.title || '');
  return `<li class="activity-item"><span class="activity-icon k-${esc(item.kind || 'default')}">${icon}</span><div class="activity-main"><span class="activity-text">${esc(text)}</span><span class="activity-meta">${esc(item.title || '')} · ${esc(relTime(item.at))}</span></div></li>`;
}

async function renderTrafficUsage(range){
  const slot = document.getElementById('trafficUsageSlot');
  if(!slot) return;
  trafficRange = ['today','7d','30d'].includes(range) ? range : trafficRange;
  document.querySelectorAll('[data-traffic-range] button').forEach(b => b.classList.toggle('active', b.dataset.range === trafficRange));
  if(!trafficChartCache[trafficRange]){
    slot.innerHTML = '<p class="muted small">加载中…</p>';
    try{ trafficChartCache[trafficRange] = await api(`/api/user/traffic?range=${encodeURIComponent(trafficRange)}`); }
    catch(err){ slot.innerHTML = `<p class="error small">${esc(err.message)}</p>`; return; }
  }
  const d = trafficChartCache[trafficRange];
  if(!d.has_data){
    slot.innerHTML = `<div class="chart-empty"><strong>暂无流量数据</strong><p class="muted small">${d.enabled ? '当前统计范围内还没有产生流量。' : 'frps 控制台未接入面板，采集不到流量；接入后这里会自动出现曲线。'}</p></div>`;
    return;
  }
  const label = d.range === 'today' ? '今日累计' : (d.range === '7d' ? '近 7 天' : '近 30 天');
  slot.innerHTML = `<div class="traffic-usage-head"><div><span>${label}</span><strong>${fmtBytes(d.total)}</strong></div><div><span>单${d.unit}峰值</span><strong>${fmtBytes(d.peak)}</strong></div></div>`;
  const drawBars = () => slot.insertAdjacentHTML('beforeend', trafficBarsSvg(d.series, slot.clientWidth || Math.round(slot.getBoundingClientRect().width) || 300));
  drawBars();
}

function setTrafficRange(range){
  trafficRange = ['today','7d','30d'].includes(range) ? range : '30d';
  renderTrafficUsage(trafficRange);
}

async function renderTrafficProtocols(){
  const slot = document.getElementById('trafficProtocolSlot');
  if(!slot) return;
  slot.innerHTML = '<p class="muted small">加载中…</p>';
  let d;
  try{ d = await api('/api/user/traffic/protocols'); }
  catch(err){ slot.innerHTML = `<p class="error small">${esc(err.message)}</p>`; return; }
  if(!d.has_data){
    slot.innerHTML = `<div class="chart-empty"><strong>暂无流量数据</strong><p class="muted small">${d.enabled ? '本月还没有采集到协议流量。' : 'frps 控制台未接入面板，暂无协议流量。'}</p></div>`;
    return;
  }
  const legend = d.items.map(it => `<li><span class="proto-dot" style="background:${protoColor(it.type)}"></span><span class="proto-name">${esc(it.label)}</span><span class="proto-val">${esc(fmtBytes(it.bytes))}</span><span class="proto-pct">${it.percent}%</span></li>`).join('');
  const monthLabel = (d.month || '').replace('-', ' 年 ') + ' 月';
  slot.innerHTML = `<div class="protocol-body"><div class="donut-wrap">${protocolDonutSvg(d.items, d.total)}</div><ul class="protocol-legend">${legend}</ul></div><p class="muted small protocol-note">统计范围：${esc(monthLabel)} · 合计 ${esc(fmtBytes(d.total))}</p>`;
}

async function renderActivityFeed(){
  const slot = document.getElementById('activitySlot');
  if(!slot) return;
  slot.innerHTML = '<p class="muted small">加载中…</p>';
  let d;
  try{ d = await api('/api/user/activity?limit=8'); }
  catch(err){ slot.innerHTML = `<p class="error small">${esc(err.message)}</p>`; return; }
  if(!d.items || !d.items.length){
    slot.innerHTML = '<div class="chart-empty"><strong>暂无动态</strong><p class="muted small">登录、创建隧道等操作会显示在这里。</p></div>';
    return;
  }
  slot.innerHTML = `<ul class="activity-list">${d.items.map(activityItemHtml).join('')}</ul>`;
}

function openConfigModal(){ const m = document.getElementById('configModal'); if(m) m.classList.remove('hidden'); }
function closeConfigModal(){ const m = document.getElementById('configModal'); if(m) m.classList.add('hidden'); }

/* ---- Online frpc config editor ---- */
let frpcDraftTimer = null;
function frpcDraftKey(){ return 'fml_frpc_draft_' + (currentUser?.id || currentUser?.username || 'anon'); }
function frpcEditorEl(){ return document.getElementById('frpcEditor'); }
function frpcEditorStatus(msg){ const el = document.getElementById('editorStatus'); if(el) el.textContent = msg || ''; }
async function fetchGeneratedFrpc(){
  const res = await fetch('/config/frpc.toml', {credentials:'same-origin'});
  if(!res.ok){
    let msg = '生成失败 (' + res.status + ')';
    try{ const j = await res.json(); if(j && j.error) msg = j.error; }catch(e){}
    throw new Error(msg);
  }
  return await res.text();
}
function readFrpcDraft(){ try{ return localStorage.getItem(frpcDraftKey()) || ''; }catch(e){ return ''; } }
function writeFrpcDraft(v){ try{ localStorage.setItem(frpcDraftKey(), v); }catch(e){} }
function clearFrpcDraft(){ try{ localStorage.removeItem(frpcDraftKey()); }catch(e){} }
async function initFrpcEditor(){
  const ta = frpcEditorEl();
  if(!ta) return;
  const draft = readFrpcDraft();
  try{
    const gen = await fetchGeneratedFrpc();
    ta.value = draft || gen;
    frpcEditorStatus(draft ? '已保留你的本地草稿（点“重新生成”可覆盖）' : '已按当前隧道生成');
  }catch(err){
    ta.value = draft;
    frpcEditorStatus('无法自动生成：' + err.message);
  }
  ta.addEventListener('input', () => {
    frpcEditorStatus('编辑中…');
    if(frpcDraftTimer) clearTimeout(frpcDraftTimer);
    frpcDraftTimer = setTimeout(() => { writeFrpcDraft(ta.value); frpcEditorStatus('已保存到本机'); }, 500);
  });
}
async function regenFrpcConfig(){
  const ta = frpcEditorEl();
  if(!ta) return;
  frpcEditorStatus('生成中…');
  try{
    const gen = await fetchGeneratedFrpc();
    ta.value = gen;
    clearFrpcDraft();
    frpcEditorStatus('已按当前隧道重新生成');
  }catch(err){ frpcEditorStatus('生成失败：' + err.message); }
}
function copyFrpcConfig(){
  const ta = frpcEditorEl();
  if(!ta) return;
  copyText(ta.value);
  frpcEditorStatus('已复制到剪贴板');
}
function downloadFrpcDraft(){
  const ta = frpcEditorEl();
  if(!ta) return;
  const blob = new Blob([ta.value], {type:'application/toml;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'frpc.toml';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  frpcEditorStatus('已下载 frpc.toml');
}

function fmtUptime(sec){
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if(d) return `${d} 天 ${h} 小时`;
  if(h) return `${h} 小时 ${m} 分`;
  if(m) return `${m} 分钟`;
  return '刚刚启动';
}
function cmpVersion(a, b){
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for(let i = 0; i < Math.max(pa.length, pb.length); i++){
    const x = pa[i] || 0, y = pb[i] || 0;
    if(x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
function sidebarServiceCopyHtml(){
  const out = ['<strong>服务运行中</strong>', `<small>版本 ${esc(panelVersion || '-')}</small>`, `<small>运行 ${esc(panelUptime > 0 ? fmtUptime(panelUptime) : '-')}</small>`];
  if(panelLatest && cmpVersion(panelLatest, panelVersion) > 0){
    out.push(`<a class="sidebar-update" href="${esc(panelUpdateLink)}" target="_blank" rel="noopener noreferrer">发现新版本 v${esc(panelLatest)}，去升级 ↗</a>`);
  }
  return out.join('');
}
function setPanelMeta(data){
  if(!data) return;
  if(data.version) panelVersion = data.version;
  if(data.panel_version) panelVersion = data.panel_version;
  if(data.uptime_seconds !== undefined) panelUptime = Number(data.uptime_seconds) || 0;
  if(data.latest_version) panelLatest = String(data.latest_version).replace(/^v/i, '');
  if(data.update_link) panelUpdateLink = String(data.update_link);
}

let _avatarSeq = 0;
function avatarSvg(username, role, size){
  const isAdmin = role === 'admin';
  const initial = esc(String(username || '?').trim().slice(0, 1).toUpperCase() || '?');
  const id = 'av' + (++_avatarSeq);
  const c1 = isAdmin ? '#5b8cff' : '#2dd4bf';
  const c2 = isAdmin ? '#8b5cf6' : '#38bdf8';
  const s = Number(size) || 32;
  const badge = isAdmin
    ? `<g transform="translate(29.5,29.5)"><circle r="9" fill="#fff"/><path d="M-5 3.6h10L3.4-3.4.6-.7-.6-4.8-1.8-.7-4.6-3.4Z" fill="#7952F6"/></g>`
    : `<g transform="translate(29.5,29.5)"><circle r="9" fill="#fff"/><circle cx="0" cy="-2.3" r="3" fill="#0ea5e9"/><path d="M-4.7 5.4a4.7 4.7 0 0 1 9.4 0Z" fill="#0ea5e9"/></g>`;
  return `<svg class="avatar-svg" viewBox="0 0 40 40" width="${s}" height="${s}" role="img" aria-label="${isAdmin ? '管理员' : '用户'}头像"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><circle cx="20" cy="20" r="20" fill="url(#${id})"/><text x="19" y="27" text-anchor="middle" font-size="18" font-weight="700" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif">${initial}</text>${badge}</svg>`;
}
function passwordFieldsHtml(){
  return `<div><label>原密码</label><input name="old_password" type="password" autocomplete="current-password" required></div>
      <div><label>新密码</label><input name="new_password" type="password" autocomplete="new-password" minlength="6" placeholder="至少 6 位" required></div>
      <div><label>确认新密码</label><input name="new_password2" type="password" autocomplete="new-password" minlength="6" required></div>`;
}
async function submitPasswordChange(form, onDone){
  const fd = new FormData(form);
  const np = String(fd.get('new_password') || '');
  if(np.length < 6){ show('新密码至少 6 位', true); return; }
  if(np !== String(fd.get('new_password2') || '')){ show('两次输入的新密码不一致', true); return; }
  try{
    const r = await api('/api/account/password', {method:'POST', body:{old_password: String(fd.get('old_password') || ''), new_password: np}});
    form.reset();
    if(onDone) onDone();
    show(r.message || '密码已修改');
  }catch(err){ show(err.message, true); }
}
function adminPwdModalHtml(){
  return `<div id="pwdModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="pwdModalTitle" onclick="if(event.target===this)closePwdModal()">
      <section class="modal-page card admin-frpc-modal">
        <div class="section-title modal-title"><div><h2 id="pwdModalTitle">修改登录密码</h2><p>修改当前管理员账号的登录密码，下次登录请使用新密码。</p></div><button type="button" class="secondary modal-close" onclick="closePwdModal()" aria-label="关闭">关闭 ×</button></div>
        <form id="pwdForm" class="grid">${passwordFieldsHtml()}<div class="form-actions" style="grid-column:1/-1"><button type="submit">保存新密码</button><button type="button" class="secondary" onclick="closePwdModal()">取消</button></div></form>
      </section>
    </div>`;
}
function openPwdModal(){ const m = document.querySelector('#pwdModal'); if(m) m.classList.remove('hidden'); }
function closePwdModal(){ const m = document.querySelector('#pwdModal'); if(m) m.classList.add('hidden'); }
function initPasswordForm(){
  const form = document.querySelector('#profilePwdForm');
  if(!form) return;
  form.onsubmit = (e) => { e.preventDefault(); submitPasswordChange(form); };
}

function appSidebarHtml(kind='dashboard'){
  const isAdmin = currentUser?.role === 'admin';
  const username = currentUser?.username || '用户';
  const items = isAdmin ? [
    ['admin-dashboard','home','运行总览'],['admin','users','用户管理','users'],['admin','key','注册密钥','keys'],['admin','nodePlus','新增节点','nodes'],['admin-health','pulse','节点健康','health'],['admin-proxies','monitor','映射监控','proxies'],['admin','risk','风控审计','risk'],['admin-settings','gear','设置']
  ] : [
    ['dashboard','home','概览'],['dashboard-tunnels','tunnel','隧道管理'],['dashboard-profile','user','个人中心']
  ];
  const links = items.map(([action, icon, label, section]) => {
    const active = kind === action || (section && kind === section) ? ' active' : '';
    return `<button class="side-link${active}" data-nav="${action}"${section ? ` data-section="${section}"` : ''}>${sideIcon(icon)}<span class="side-link-label">${label}</span><span class="side-link-arrow">›</span></button>`;
  }).join('');
  const brandName = 'Frp 管理台';
  const brandSub = '内网穿透管理平台';
  return `<aside class="app-sidebar">
    <div class="sidebar-brand"><div class="brand-mark-small">F</div><div><strong>${brandName}</strong><span>${brandSub}</span></div></div>
    <div class="sidebar-section-label">工作空间</div>${links}
    ${isAdmin ? '' : `<div class="sidebar-section-label sidebar-tools-label">快速工具</div>
      <button class="side-link${kind === 'dashboard-config' ? ' active' : ''}" data-nav="dashboard-config">${sideIcon('download')}<span class="side-link-label">配置下载</span><span class="side-link-arrow">›</span></button>
      <button class="side-link${kind === 'dashboard-editor' ? ' active' : ''}" data-nav="dashboard-editor">${sideIcon('edit')}<span class="side-link-label">在线配置</span><span class="side-link-arrow">›</span></button>`}
    <div class="sidebar-spacer"></div>
    <div class="sidebar-service-status"><span class="sidebar-service-dot"></span><span class="sidebar-service-copy">${sidebarServiceCopyHtml()}</span></div>
    <div class="sidebar-user-card"><span class="sidebar-user-avatar">${avatarSvg(username, currentUser?.role, 32)}</span><span class="sidebar-user-copy"><strong>${esc(username)}</strong><small>${isAdmin ? '系统管理员' : '普通用户'}</small></span><button type="button" data-nav="logout" title="退出登录" aria-label="退出登录">↗</button></div>
  </aside>`;
}

function settingsTopbarHtml(title){
  const username = currentUser?.username || '管理员';
  const initial = esc(String(username).slice(0, 1).toUpperCase());
  return `<div class="workspace-topbar settings-topbar">
    <div class="settings-head"><span class="settings-head-icon">${stIcon('gear')}</span><div class="settings-head-copy"><h1>${esc(title || '管理员设置')}</h1><p>配置系统通知、邮件、备份、运维和存储等相关设置</p></div></div>
    <div class="topbar-actions settings-head-actions"><span class="settings-admin"><span class="settings-admin-avatar">${avatarSvg(username, currentUser?.role, 30)}</span><span class="settings-admin-name">${esc(username)}</span></span><button type="button" class="secondary settings-logout" data-nav="logout">退出登录</button></div>
  </div>`;
}

function appLayoutHtml(content, kind='dashboard', topTitle='工作区'){
  const username = currentUser?.username || '用户';
  const isSettings = kind === 'admin-settings';
  return `<div class="app-shell${isSettings ? ' is-settings' : ''}">${appSidebarHtml(kind)}<main class="workspace-main"><div class="workspace-topbar"><div class="topbar-banner"><svg class="topbar-banner-art" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 96 L150 58 L260 86 L420 34 L560 78 L700 44 L860 92 L1010 52 L1200 84 L1200 120 L0 120 Z" fill="rgba(122,174,255,.30)"/><path d="M0 108 L180 74 L340 100 L520 62 L700 96 L880 70 L1060 104 L1200 84 L1200 120 L0 120 Z" fill="rgba(122,174,255,.45)"/></svg><span class="topbar-banner-spark" aria-hidden="true"></span><div class="topbar-banner-left"><span class="topbar-brandmark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 18.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 9.6 4.2 4.2 0 0 0 7.5 18.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div class="topbar-banner-copy"><span class="topbar-kicker">FRP WORKSPACE</span><b>欢迎回来，${esc(username)}</b><span class="topbar-banner-sub">高效管理您的内网服务，轻松实现远程访问</span></div></div><div class="topbar-banner-right"><div class="topbar-banner-slogan"><b>让内网服务更简单</b><span>安全 · 稳定 · 高效</span></div><span class="topbar-banner-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 7h.01M7 17h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M14.6 12.3l1.8 1.8 3.2-3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div><button type="button" class="topbar-banner-theme" data-nav="theme-toggle" title="切换亮色/暗色" aria-label="切换亮色/暗色">◐</button></div></div>${content}</main></div>`;
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
    navButton('设置', 'admin-settings', 'secondary'),
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
    if(action === 'admin-settings') return loadAdminSettings();
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
    if(action === 'theme-toggle') return toggleLightDark();
    if(action === 'logout') return logout();
    if(action === 'dashboard') return loadDashboard();
    if(action === 'dashboard-tunnels') return loadDashboard('tunnels');
    if(action === 'dashboard-config') return loadDashboard('config');
    if(action === 'dashboard-editor') return loadDashboard('editor');
    if(action === 'dashboard-profile') return loadDashboard('profile');
    if(action === 'admin-dashboard') return loadAdminDashboard();
    if(action === 'admin-settings') return loadAdminSettings();
    if(action === 'admin-proxies') return loadAdminProxies();
    if(action === 'admin-health') return loadAdminHealth();
    if(action === 'admin') return loadAdmin(section);
  }catch(err){ show(err.message || '操作失败', true); }
});

const LATENCY_PROBE_URL = 'https://speed.cloudflare.com/__down?bytes=0';

async function probeLatency(url, tries = 3){
  const samples = [];
  const sameOrigin = url.startsWith('/');
  for(let i = 0; i < tries; i++){
    const sep = url.includes('?') ? '&' : '?';
    const t0 = performance.now();
    try{
      await fetch(url + sep + 'ts=' + Date.now() + '_' + i, {
        cache: 'no-store',
        credentials: sameOrigin ? 'same-origin' : 'omit',
        mode: sameOrigin ? 'same-origin' : 'cors'
      });
      samples.push(performance.now() - t0);
    }catch(e){ /* ignore failed sample */ }
  }
  return samples.length ? Math.min(...samples) : null;
}

async function measureClientLatency(){
  const el = document.getElementById('nodeLatencyValue');
  if(!el) return;
  // Priority: real user→node probe, then a public anycast reference (Cloudflare),
  // then the panel itself. Each is 3 samples, keep the minimum.
  let ms = null, src = '';
  if(clientNodeProbeUrl){ ms = await probeLatency(clientNodeProbeUrl); if(ms != null) src = 'node'; }
  if(ms == null){ ms = await probeLatency(LATENCY_PROBE_URL); if(ms != null) src = 'cloudflare'; }
  if(ms == null){ ms = await probeLatency('/api/ping'); if(ms != null) src = 'panel'; }
  const live = document.getElementById('nodeLatencyValue');
  if(!live) return;
  if(ms == null){ live.textContent = live.dataset.fallback || '暂未测量'; live.title = ''; return; }
  live.textContent = `${Math.round(ms)} ms`;
  live.title = {node:'用户→节点实测', cloudflare:'浏览器↔Cloudflare 就近节点', panel:'浏览器→面板'}[src] || '';
}

async function measureNodeLatencyByAddr(addr){
  const host = String(addr || '').trim();
  if(!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(host)) return null;
  return await probeLatency(`${location.protocol}//${host}/__fml_ping`);
}

// Fill every [data-latency-node] element with a real user→node round trip measured
// in the browser (falls back to the pre-rendered server-side value on failure).
async function fillNodeLatencies(){
  const els = Array.from(document.querySelectorAll('[data-latency-node]'));
  if(!els.length) return;
  const addrs = Array.from(new Set(els.map(e => e.dataset.latencyNode).filter(Boolean)));
  const results = {};
  await Promise.all(addrs.map(async a => { results[a] = await measureNodeLatencyByAddr(a); }));
  els.forEach(e => {
    const ms = results[e.dataset.latencyNode];
    if(ms != null){ e.textContent = `${Math.round(ms)} ms`; e.title = '用户→节点实测'; }
  });
}

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
      `<div class="auth-switch"><a class="auth-link" href="#" onclick="renderRegister();return false;">没有账号？</a><a class="auth-link" href="#" onclick="renderForgotPassword();return false;">忘记密码？</a></div>`, nodes);
  document.querySelector('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      const data = await api('/api/login', {method:'POST', body:{username:fd.get('username'), password:fd.get('password')}});
      currentUser = data.user; setNav(); await loadDashboard();
      if(currentUser && currentUser.role !== 'admin') showLegalNotice();
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

async function renderForgotPassword(){
  clearAdminDashboardTimer();
  currentUser = null; setNav(); hideFlash();
  app.innerHTML = authShell('找回密码', '输入用户名获取邮箱验证码，设置新密码', `
      <form id="forgotForm" class="stack-form auth-login-form">
        <div class="input-group"><label class="input-label" for="forgotUsername">用户名</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('user')}</span><input id="forgotUsername" class="input-ios" name="username" autocomplete="username" placeholder="请输入用户名" required></div></div>
        <div class="input-group"><label class="input-label" for="forgotCode">邮箱验证码</label><div class="row" style="gap:8px"><input id="forgotCode" class="input-ios" name="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" required style="flex:1;min-width:0"><button type="button" class="secondary" id="sendCodeBtn" onclick="sendResetCode()">获取验证码</button></div><p class="muted small" style="margin:6px 0 0">验证码会发送到账号绑定的邮箱</p></div>
        <div class="input-group"><label class="input-label" for="forgotPassword">新密码</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('lock')}</span><input id="forgotPassword" class="input-ios auth-password-input" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="请输入新密码（至少 6 位）" required><button type="button" class="auth-password-toggle" onclick="togglePasswordVisibility('forgotPassword', this)" aria-label="显示密码" title="显示密码">${iconSvg('eye')}</button></div></div>
        <div class="input-group"><label class="input-label" for="forgotPassword2">确认新密码</label><input id="forgotPassword2" class="input-ios" name="password2" type="password" autocomplete="new-password" minlength="6" placeholder="再次输入新密码" required></div>
        <p class="row"><button>重置密码</button><button type="button" class="secondary" onclick="renderLogin()">返回登录</button></p>
      </form>`,
      '<div class="auth-switch"><span>收不到邮件？</span><span>请联系管理员修改密码</span></div>');
  document.querySelector('#forgotForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const p1 = String(form.elements.password.value || '');
    const p2 = String(form.elements.password2.value || '');
    if(p1 !== p2){ show('两次输入的密码不一致', true); return; }
    try{
      const r = await api('/api/password/reset-by-code', {method:'POST', body:{username: form.elements.username.value, code: form.elements.code.value, password: p1}});
      show(r.message || '密码已重置，请登录');
      renderLogin();
    }catch(err){ show(err.message, true); }
  };
}

async function sendResetCode(){
  const u = document.querySelector('#forgotUsername');
  const btn = document.querySelector('#sendCodeBtn');
  const name = u ? u.value.trim() : '';
  if(!name){ show('请先填写用户名', true); return; }
  if(btn) btn.disabled = true;
  try{
    const r = await api('/api/password/request-code', {method:'POST', body:{username:name}});
    show(r.message || '验证码已发送');
    let n = 60;
    if(btn){
      btn.textContent = n + 's';
      const t = setInterval(() => { n--; if(n <= 0){ clearInterval(t); btn.disabled = false; btn.textContent = '获取验证码'; } else { btn.textContent = n + 's'; } }, 1000);
    }
  }catch(err){ if(btn) btn.disabled = false; show(err.message, true); }
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
        <h2>${stIcon('license')}需要软件授权激活</h2>
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
        <div class="section-title"><h2>${stIcon('license')}激活授权</h2><p>${esc(lic.message || '请填写卖家提供的以下信息')}</p></div>
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
      <div class="section-title"><h2>${stIcon('license')}软件授权激活</h2><p>输入卖家给你的鉴权密钥；只在安装时鉴权一次，成功后生成本机授权文件，重装后自动读取并校验机器指纹。</p></div>
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
      await loadDashboard();
      show(r.message || '授权已激活');
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
    const fd = Object.fromEntries(new FormData(e.target));
    const isEdit = !!editingTunnelId;
    try{
      if(isEdit){
        await api('/api/tunnels/update', {method:'POST', body:{...fd, id: editingTunnelId}});
        editingTunnelId = null;
      } else {
        await api('/api/tunnels/create', {method:'POST', body:fd});
      }
      tunnelFormDraft = {};
      closeTunnelModal();
      await loadDashboard('tunnels');
      // 提示必须在重渲染之后再显示，否则会被 loadDashboard 开头的 hideFlash() 立刻清掉
      show(isEdit ? '隧道已更新，重新下载 frpc.toml 后重启 frpc 生效' : '隧道已创建，重新下载 frpc.toml 后重启 frpc 生效');
    }catch(err){ show(err.message, true); }
  };
  applyTunnelFormMode();
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
  currentUser = data.user; softwareLicense = data.software_license || softwareLicense; setPanelMeta(data); setNav();
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
  lastTunnels = data.tunnels || [];
  const tunnelRows = data.tunnels.map(t => {
    const endpointRaw = tunnelEndpointText(t, data.frps);
    const endpointScheme = t.proxy_type === 'https' ? 'https://' : (['http','tcp'].includes(t.proxy_type) ? 'http://' : '');
    const endpointShown = (endpointScheme && endpointRaw && endpointRaw !== '-') ? endpointScheme + endpointRaw : endpointRaw;
    const endpoint = esc(endpointShown);
    const runtime = tunnelRuntimeStats(t, data.frps_user_dashboard);
    const mapState = tunnelMappingState(t);
    return `<article class="tc-card${t.enabled ? '' : ' is-off'}">
      <div class="tc-head">
        <span class="tc-type">${esc(String(t.proxy_type || 'tcp').slice(0, 1).toUpperCase())}</span>
        <span class="tc-title"><strong title="${esc(t.name)}">${esc(t.name)}</strong><small>${esc(t.proxy_type)} 隧道 · #${esc(t.id)}</small></span>
        <span class="tc-state ${t.enabled ? 'on' : 'off'}">${t.enabled ? '已启用' : '已停用'}</span>
      </div>
      <div class="tc-route">
        <span class="tc-hop"><span>本地</span><b title="${esc(t.local_ip)}:${esc(t.local_port)}">${esc(t.local_ip)}:${esc(t.local_port)}</b></span>
        <span class="tc-arrow" aria-hidden="true">→</span>
        <span class="tc-hop"><span>公网</span><b title="${endpoint}">${endpoint}</b>${endpointRaw !== '-' ? `<button type="button" class="tc-copy" data-copy-address="${endpoint}">复制</button>` : ''}</span>
      </div>
      <footer class="tc-foot">
        <span class="tc-chip"${t.mapping_message ? ` title="${esc(t.mapping_message)}"` : ''}><i>映射</i><b class="${mapState.cls}">${mapState.label}</b></span>
        <span class="tc-chip"><i>今日流量</i><b>${fmtBytes(runtime.trafficIn + runtime.trafficOut)}</b></span>
        <span class="tc-chip"><i>连接</i><b>${runtime.available ? runtime.connections : '-'}</b></span>
        <span class="tc-actions">
          <button class="secondary" onclick="loadDashboard('tunnels')">刷新</button>
          <button class="secondary" onclick="editTunnel(${t.id})">修改</button>
          <button class="secondary" onclick="toggleTunnel(${t.id})">${t.enabled ? '停用' : '启用'}</button>
          <button class="danger" onclick="deleteTunnel(${t.id})">删除</button>
        </span>
      </footer>
    </article>`;
  }).join('') || `<div class="empty-state"><strong>还没有隧道</strong><p class="muted small">创建第一个隧道后，就能在这里查看本地服务、公网入口和运行状态。</p><button onclick="loadDashboard('tunnels')">新建隧道</button></div>`;
  const tunnelPreviewRows = data.tunnels.map(t => {
    const endpointRaw = tunnelEndpointText(t, data.frps);
    const endpointScheme = t.proxy_type === 'https' ? 'https://' : (['http','tcp'].includes(t.proxy_type) ? 'http://' : '');
    const endpointShown = (endpointScheme && endpointRaw && endpointRaw !== '-') ? endpointScheme + endpointRaw : endpointRaw;
    const runtime = tunnelRuntimeStats(t, data.frps_user_dashboard);
    const status = t.mapping_status || (t.enabled ? 'unknown' : 'disabled');
    const statusLabel = status === 'online' ? '在线' : (status === 'registered' ? '已注册' : (status === 'disabled' ? '已停用' : '未连接'));
    const statusClass = status === 'online' ? 'ok' : (status === 'registered' ? 'warn' : (status === 'disabled' ? 'muted' : 'bad'));
    return `<article class="tunnel-preview-item">
      <div class="tunnel-preview-layout">
        <div class="tunnel-preview-identity"><img class="tunnel-preview-icon" src="/tunnel-globe.svg" alt=""><div class="tunnel-preview-name"><strong title="${esc(t.name)}">${esc(t.name)}</strong><span class="status-dot ${t.enabled ? 'is-online' : 'is-offline'} ${statusClass}">${statusLabel}</span></div><span class="tunnel-preview-local" title="${esc(t.local_ip)}:${esc(t.local_port)}">本地服务：${esc(t.local_ip)}:${esc(t.local_port)}</span></div>
        <div class="tunnel-preview-endpoint" title="${esc(endpointShown)}"><span>公网地址</span><b>${esc(endpointShown)}</b></div>
        <div class="tunnel-preview-traffic"><div><span>今日流量</span><b>${fmtBytes(runtime.trafficIn + runtime.trafficOut)}</b></div><div><span>连接数</span><b>${runtime.available ? runtime.connections : '-'}</b></div></div>
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
    const nodeAddr = String(node.server_addr || '').trim();
    // Node-side probe: real user→node round trip when the node is reachable by hostname
    // and serves the panel's /__fml_ping endpoint (co-located deployment).
    clientNodeProbeUrl = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(nodeAddr)
      ? `${location.protocol}//${nodeAddr}/__fml_ping` : '';

    const tunnelCount = data.tunnels.length;
    const tunnelLimit = Number(data.user.max_ports || 0);
    const tunnelUsagePercent = tunnelLimit > 0 ? Math.min(100, Math.round(tunnelCount / tunnelLimit * 100)) : 0;
    const tunnelUsageLabel = tunnelLimit > 0 ? `已使用 ${tunnelCount} / ${tunnelLimit}` : `已使用 ${tunnelCount} 条隧道`;
    const portUsagePercent = tunnelLimit > 0 ? Math.min(100, Math.round(tunnelCount / tunnelLimit * 100)) : 0;
    const portUsageLabel = tunnelLimit > 0 ? `已使用 ${tunnelCount} / ${tunnelLimit}` : `已使用 ${tunnelCount} 个端口`;
    const accountExpired = !!data.user.expired;
    const expiryPercent = accountExpired ? 0 : 100;
    const expiryLabel = accountExpired ? '账号已到期' : '账号有效';
    const trafficUsagePercent = trafficLimit > 0 ? Math.min(100, Math.round(todayTraffic / trafficLimit * 100)) : 0;
    const trafficUsageLabel = trafficLimit > 0 ? `已用 ${fmtBytes(todayTraffic)} / ${fmtBytes(trafficLimit)}` : '';

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
        <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M153.6 358.4h716.8v307.2H153.6z" fill="#20C997"/><path d="M845.824 614.4V409.6h-665.6v204.8h665.6z m0 102.4h-665.6v102.4a102.4 102.4 0 0 0 102.4 102.4h460.8a51.2 51.2 0 0 1 0 102.4h-460.8a204.8 204.8 0 0 1-204.8-204.8V204.8a204.8 204.8 0 0 1 204.8-204.8h460.8a204.8 204.8 0 0 1 204.8 204.8v614.4a51.2 51.2 0 0 1-102.4 0v-102.4z m0-409.6V204.8a102.4 102.4 0 0 0-102.4-102.4h-460.8a102.4 102.4 0 0 0-102.4 102.4v102.4h665.6z m-153.6 563.2a51.2 51.2 0 1 1 0-102.4 51.2 51.2 0 0 1 0 102.4z m-358.4-716.8h102.4a51.2 51.2 0 1 1 0 102.4h-102.4a51.2 51.2 0 1 1 0-102.4z m0 307.2h102.4a51.2 51.2 0 1 1 0 102.4h-102.4a51.2 51.2 0 0 1 0-102.4z" fill="#2C6DD2"/></svg><div class="overview-stat-copy"><span>当前节点</span><strong>${esc(node.region || node.name || '-')}</strong><small>${esc(node.name || '未分配节点')}</small></div></div></section>
        <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M960 544A480 480 0 1 1 480 64v480h480z" fill="#9526eb"/><path d="M1024 480H544V0a480 480 0 0 1 480 480z" fill="#F3ADBA"/></svg><div class="overview-stat-copy"><span>今日流量</span><strong>${fmtBytes(todayTraffic)}</strong><small>${trafficLimit ? '上限 ' + fmtBytes(trafficLimit) : '当前不限额；按今日统计'}</small></div></div>${trafficLimit > 0 ? `<div class="tunnel-usage"><div class="tunnel-usage-label"><span>${trafficUsageLabel}</span><b>${trafficUsagePercent}%</b></div><div class="tunnel-usage-track" role="progressbar" aria-label="今日流量使用情况" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${trafficUsagePercent}"><span style="width:${trafficUsagePercent}%"></span></div></div>` : ''}</section>
        <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M512 514m-448 0a448 448 0 1 0 896 0 448 448 0 1 0-896 0Z" fill="#69B452"/><path d="M512 512m-253.15 0a253.15 253.15 0 1 0 506.3 0 253.15 253.15 0 1 0-506.3 0Z" fill="#FFFFFF"/><path d="M512 512m-203.07 0a203.07 203.07 0 1 0 406.14 0 203.07 203.07 0 1 0-406.14 0Z" fill="#D1F0C7"/><path d="M622.12 497h-91.31a24.09 24.09 0 0 0-11.46-7.92V360.22a6 6 0 0 0-6-6h-2.81a6 6 0 0 0-6 6v128.93a24.06 24.06 0 1 0 26.19 38.08h91.49a6 6 0 0 0 6-6V503a6 6 0 0 0-6.1-6z" fill="#69B452"/></svg><div class="overview-stat-copy"><span>账号有效期</span><strong>${esc(data.user.expires_text || '-')}</strong><small>${data.user.expired ? '账号已到期' : '到期日期'}</small></div></div><div class="tunnel-usage"><div class="tunnel-usage-label"><span>${expiryLabel}</span><b>${expiryPercent}%</b></div><div class="tunnel-usage-track" role="progressbar" aria-label="账号有效状态" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${expiryPercent}"><span class="expiry-usage-fill" style="width:${expiryPercent}%"></span></div></div></section>
        <section class="workspace-stat port-limit-stat overview-icon-stat"><div class="overview-stat-main"><svg class="overview-stat-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M853.333333 201.984v469.333333H170.666667v-469.333333h682.666666z m-51.2 51.2H221.866667v366.933333h580.266666v-366.933333zM785.066667 802.304v51.2H238.933333v-51.2z" fill="#1296db"/></svg><div class="overview-stat-copy"><span>端口上限</span><strong>${esc(data.user.max_ports ?? '-')}</strong><small>可分配端口总数</small></div></div><div class="tunnel-usage"><div class="tunnel-usage-label"><span>${portUsageLabel}</span><b>${tunnelLimit > 0 ? portUsagePercent + '%' : '—'}</b></div><div class="tunnel-usage-track" role="progressbar" aria-label="端口使用情况" aria-valuemin="0" aria-valuemax="${tunnelLimit || tunnelCount || 1}" aria-valuenow="${tunnelLimit > 0 ? Math.min(tunnelCount, tunnelLimit) : tunnelCount}"><span style="width:${portUsagePercent}%"></span></div></div></section>
      </div>
      <div class="user-dashboard-grid">
        <section class="card node-status-card node-map-panel"><div class="node-map-backdrop" aria-hidden="true"><div class="node-map-grid"></div><svg viewBox="0 0 900 340" preserveAspectRatio="xMidYMid slice"><defs><filter id="nodeMapBlur"><feGaussianBlur stdDeviation="2.4"/></filter><linearGradient id="nodeMapFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#80b8ef"/><stop offset="100%" stop-color="#5e8bd9"/></linearGradient></defs><g fill="url(#nodeMapFill)" opacity=".28" filter="url(#nodeMapBlur)"><path d="M74 85l40-27 58 8 21 22 49-8 24 27-21 25-37 2-18 35-42 4-12 37-29-10-6-44-29-20z"/><path d="M214 193l39 12 28 45-8 38-21 18-18-43-25-26z"/><path d="M405 74l36-19 54 11 27 25 50-7 24 22 51-5 37 25-20 21-52-6-16 30-31-5-20 23-41-14-19-32-40-5-15-25-35-2z"/><path d="M459 166l43 1 30 31-8 51-27 47-25-18-11-52-18-24z"/><path d="M631 228l43-15 48 15 26 25-28 24-49-8-28 15-22-22z"/><path d="M748 65l42-13 39 20-6 26-42 9-30-17z"/></g><g fill="none" stroke="#5e9fe8" stroke-width="2" stroke-dasharray="5 7" opacity=".55"><path d="M170 118Q350 5 520 115T740 130"/><path d="M170 118Q250 240 430 210T740 130"/></g><g fill="#fff" stroke="#4388ec" stroke-width="3"><circle cx="170" cy="118" r="8"/><circle cx="430" cy="210" r="7"/><circle cx="740" cy="130" r="10"/></g><circle cx="740" cy="130" r="19" fill="#4388ec" opacity=".14"/></svg></div><div class="node-map-heading"><div><div class="section-kicker">CURRENT NODE · NODE OVERVIEW</div><h2>${stIcon('node')}当前节点</h2></div><span class="status-badge ${nodeStateClass}"><i></i>${nodeState}</span></div><div class="node-map-content node-compact-content"><div class="node-server-art"><img src="/server-icon.svg" alt="服务器图标"></div><div class="node-compact-details"><div class="node-compact-title"><strong>${esc(node.name || '未分配节点')}</strong><span class="status-badge ${nodeStateClass}"><i></i>${nodeState}</span></div><div class="node-compact-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${esc(nodeLocation)}</span></div><div class="node-compact-meta"><span title="浏览器实测网络延迟（优先用户→节点，回退公开测速点）">延迟：<span id="nodeLatencyValue" data-fallback="${esc(nodeLatency)}">${esc(nodeLatency)}</span></span><span class="node-meta-separator">|</span><span>带宽：${node.bandwidth_mbps || node.bandwidth || node.bandwidth_mbps === 0 ? esc(node.bandwidth_mbps ?? node.bandwidth) + ' Mbps' : '未设置'}</span></div></div><button type="button" class="node-switch-button" onclick="openNodeSwitch()">⇄ 切换节点</button></div><div id="nodeSwitchModal" class="node-switch-modal hidden" role="dialog" aria-modal="true" aria-labelledby="nodeSwitchTitle"><div class="node-switch-dialog"><div class="section-title"><div><div class="section-kicker">CHANGE NODE</div><h2 id="nodeSwitchTitle">${stIcon('node')}切换接入节点</h2><p>切换后会影响当前账号新建隧道的默认节点。</p></div><button class="secondary" type="button" onclick="closeNodeSwitch()">关闭 ×</button></div><div id="nodeSwitchList" class="node-switch-list"><p class="muted">正在加载可用节点…</p></div></div></div></section>
        <section class="card quick-actions-card"><div class="section-title"><div><div class="section-kicker">QUICK ACTIONS</div><h2>${stIcon('bolt')}快捷操作</h2></div></div><div class="quick-actions-grid"><button class="quick-action" onclick="loadDashboard('tunnels')"><span class="quick-action-icon">${QICON_TUNNEL}</span><b>管理隧道</b><small>查看和控制映射</small></button><button class="quick-action" onclick="openPortsModal()"><span class="quick-action-icon">${QICON_PORT}</span><b>查看端口</b><small>弹窗查看端口资源</small></button><button class="quick-action" onclick="loadDashboard('config')"><span class="quick-action-icon">${QICON_DOWNLOAD}</span><b>下载配置</b><small>配置与部署脚本</small></button><button class="quick-action" onclick="loadDashboard('profile')"><span class="quick-action-icon">${QICON_USER}</span><b>个人中心</b><small>账号与工具</small></button></div></section>
        <section class="card dashboard-tunnels-preview"><div class="section-title"><div><div class="section-kicker">MY TUNNELS</div><h2>${stIcon('tunnel')}我的隧道</h2></div><button class="secondary tunnel-preview-all" onclick="loadDashboard('tunnels')">查看全部隧道 ↗</button></div><div id="tunnelPreviewRotator" class="tunnel-preview-rotator">${tunnelPreviewRows}</div></section>
      <div class="dashboard-charts">
        <section class="card traffic-usage-card">
          <div class="section-title"><div><div class="section-kicker">TRAFFIC USAGE</div><h2>${stIcon('chart')}流量使用情况</h2></div><div class="seg-control" data-traffic-range><button type="button" data-range="today" onclick="setTrafficRange('today')">今天</button><button type="button" data-range="7d" onclick="setTrafficRange('7d')">7天</button><button type="button" data-range="30d" class="active" onclick="setTrafficRange('30d')">30天</button></div></div>
          <div id="trafficUsageSlot" class="chart-slot"></div>
        </section>
        <section class="card traffic-protocol-card">
          <div class="section-title"><div><div class="section-kicker">PROTOCOL SHARE</div><h2>${stIcon('donut')}流量占比</h2></div><span class="section-count">本月</span></div>
          <div id="trafficProtocolSlot" class="chart-slot"></div>
        </section>
        <section class="card activity-card">
          <div class="section-title"><div><div class="section-kicker">ACTIVITY</div><h2>${stIcon('activity')}最新动态</h2></div><button class="secondary activity-refresh" type="button" onclick="renderActivityFeed()">刷新</button></div>
          <div id="activitySlot" class="chart-slot"></div>
        </section>
        </div>
      </div>
      <div id="portsModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="portsModalTitle" onclick="if(event.target===this)closePortsModal()">
        <section class="modal-page card ports-modal">
          <div class="section-title modal-title">
            <div><div class="section-kicker">RESOURCE POOL</div><h2 id="portsModalTitle">${stIcon('port')}端口资源</h2><p>共 ${ps.total || 0} 个 · 可用 ${ps.free || 0} 个 · 已用 ${ps.used || 0} 个；黄色表示已分配给隧道。</p></div>
            <button type="button" class="secondary modal-close" onclick="closePortsModal()" aria-label="关闭端口资源">关闭 ×</button>
          </div>
          <div class="ports ports-modal-list">${portsHtml}</div>
        </section>
      </div>
      <div id="legalNoticeModal" class="modal-backdrop modal-center hidden" role="dialog" aria-modal="true" aria-labelledby="legalNoticeTitle" onclick="if(event.target===this)closeLegalNotice()">
        <section class="modal-page card legal-notice-modal">
          <div class="section-title modal-title"><div><div class="section-kicker">NOTICE</div><h2 id="legalNoticeTitle">${stIcon('risk')}使用须知 · 合规提醒</h2></div></div>
          <div class="legal-notice-body">
            <p><strong>请勿将本服务用于任何违法违规用途。</strong></p>
            <p>本平台仅用于合法的内网穿透与远程访问。严禁用于：搭建或传播违法违规内容、未授权访问/入侵他人系统、网络攻击、诈骗、赌博、侵权等行为。</p>
            <p>一经发现违规使用，账号将被立即封停，并保留依法向有关部门举报、配合调查的权利。因用户自身行为产生的一切法律责任由用户自行承担。</p>
          </div>
          <div class="form-actions" style="justify-content:flex-end"><button type="button" onclick="closeLegalNotice()">我已知晓</button></div>
        </section>
      </div>`, 'dashboard', '概览');
    Object.keys(trafficChartCache).forEach(k => delete trafficChartCache[k]);
    renderTrafficUsage(trafficRange);
    renderTrafficProtocols();
    renderActivityFeed();
    measureClientLatency();
    return;
  }
  if(view === 'tunnels'){
    app.innerHTML = appLayoutHtml(`
      <section class="card tunnel-create-card" id="tunnelCreateCard">
        <div class="section-title"><div><div class="section-kicker">CREATE TUNNEL</div><h2 id="tunnelFormTitle">${stIcon('plus')}创建隧道</h2><p id="tunnelFormHint">填好本地服务和公网访问方式，创建后重新下载 frpc.toml 并重启客户端即可生效。</p></div></div>
        <form id="tunnelForm" class="grid tunnel-create-form">
          <div><label>名称</label><input name="name" value="${esc(tunnelFormDraft.name || '')}" placeholder="web" required></div>
          <div><label>类型</label><select name="proxy_type" id="proxyTypeSelect">${proxyTypeOptions}</select></div>
          <div><label>本地 IP</label><input name="local_ip" value="${esc(tunnelFormDraft.local_ip || '127.0.0.1')}" required></div>
          <div><label>本地端口</label><input name="local_port" type="number" min="1" max="65535" value="${esc(tunnelFormDraft.local_port || '80')}" required></div>
          <div class="remote-port-field"><label>公网端口</label>${remotePortField}</div>
          <div class="domain-field hidden"><label>自定义域名</label><input name="custom_domains" value="${esc(tunnelFormDraft.custom_domains || '')}" placeholder="app.example.com,api.example.com"></div>
          <div class="secret-field hidden"><label>访问密钥</label><input name="secret_key" value="${esc(tunnelFormDraft.secret_key || '')}" placeholder="留空自动生成"></div>
          <div id="tunnelEditBanner" class="muted small hidden" style="grid-column:1/-1;margin:0">正在修改隧道 <b id="tunnelEditName"></b>（#<span id="tunnelEditId"></span>），保存后重新下载 frpc.toml 生效。</div>
          <div class="form-actions tunnel-form-actions"><button id="tunnelSubmitBtn">创建隧道</button><button type="button" class="secondary" onclick="resetTunnelForm()">清空重填</button><button type="button" class="secondary hidden" id="tunnelCancelEditBtn" onclick="cancelTunnelEdit()">取消修改</button></div>
        </form>
        <p class="muted small">HTTP / HTTPS / TCPMUX 需要 frps 已配置 vhostHTTPPort / vhostHTTPSPort / tcpmuxHTTPConnectPort 等对应能力。</p>
      </section>
      <section class="card tunnel-list-section"><div class="section-title"><div><div class="section-kicker">TUNNELS</div><h2>${stIcon('tunnel')}隧道列表</h2><p>一张卡片对应一条映射；改完配置请重新下载 frpc.toml 并重启客户端。</p></div><span class="section-count">${data.tunnels.length} 条隧道</span></div><div class="tc-grid">${tunnelRows}</div></section>`, 'dashboard-tunnels', '我的隧道');
    bindUserTunnelForm();
    return;
  }
  if(view === 'config'){
    const deployUrl = userDeployScriptUrl(data.user) || '/config/deploy-frpc.sh';
    const deployCmd = userDeployScriptCommand(data.user);
    app.innerHTML = appLayoutHtml(`
      <div class="config-grid">
        <section class="card config-dl-card">
          <div class="section-title"><div><div class="section-kicker">FRPC</div><h2>${stIcon('file')}frpc.toml</h2></div></div>
          <p class="muted small">包含你所有“已启用”隧道的完整配置，下载后覆盖客户端的 frpc.toml 即可。</p>
          <a class="config-option" href="/config/frpc.toml"><span class="config-option-icon">${QICON_DOWNLOAD}</span><span class="config-option-copy"><b>下载 frpc 配置</b><small>frpc.toml · 覆盖即生效</small></span></a>
        </section>
        <section class="card config-dl-card">
          <div class="section-title"><div><div class="section-kicker">DEPLOY</div><h2>${stIcon('script')}部署脚本</h2></div></div>
          <p class="muted small">在客户端服务器上执行，自动安装 frpc、写入配置并注册服务。</p>
          <a class="config-option" href="${esc(deployUrl)}"><span class="config-option-icon">${QICON_TUNNEL}</span><span class="config-option-copy"><b>下载 deploy-frpc.sh</b><small>一键安装并启动 frpc</small></span></a>
          ${deployCmd ? `<div class="copy-line"><code>${esc(deployCmd)}</code><button type="button" class="copy-inline" data-copy-address="${esc(deployCmd)}">复制</button></div>` : ''}
        </section>
      </div>
      <section class="card config-tip"><p class="muted small">想看/改具体内容？去 <button type="button" class="link-btn" onclick="loadDashboard('editor')">在线配置</button>，那里会根据你当前的隧道自动生成 frpc.toml。</p></section>`, 'dashboard-config', '配置下载');
    return;
  }
  if(view === 'editor'){
    app.innerHTML = appLayoutHtml(`
      <section class="card editor-card">
        <div class="section-title"><div><div class="section-kicker">FRPC.TOML</div><h2>${stIcon('file')}配置内容</h2><span class="editor-status" id="editorStatus">加载中…</span></div><div class="editor-actions"><button type="button" class="secondary" onclick="copyFrpcConfig()">复制全部</button><button type="button" class="secondary" onclick="downloadFrpcDraft()">下载 .toml</button><button type="button" class="secondary" onclick="regenFrpcConfig()">重新生成</button></div></div>
        <textarea id="frpcEditor" class="frpc-editor" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" placeholder="# 正在加载当前 tunnels 生成的配置…"></textarea>
        <p class="muted small">改动会暂存在本机浏览器；点“重新生成”会用当前隧道重新覆盖。新增/修改隧道后回来重新生成即可。</p>
      </section>`, 'dashboard-editor', '在线配置');
    initFrpcEditor();
    return;
  }
  if(view === 'profile'){
    app.innerHTML = appLayoutHtml(`
      <div class="profile-grid">
        <section class="card profile-card">
          <div class="profile-head"><span class="profile-avatar">${avatarSvg(data.user.username||'U', data.user.role, 56)}</span><div class="profile-id"><strong>${esc(data.user.username||'-')}</strong><small>${data.user.role === 'admin' ? '系统管理员' : '普通用户'}</small></div></div>
          <div class="profile-rows">
            <div class="info-line"><span>账号有效期</span><strong>${esc(data.user.expires_text || '-')}</strong></div>
            <div class="info-line"><span>今日流量</span><strong>${fmtBytes(todayTraffic)}${trafficLimit ? ' / ' + fmtBytes(trafficLimit) : ' / 不限'}</strong></div>
            <div class="info-line"><span>隧道数量</span><strong>${data.tunnels.length} 条</strong></div>
            <div class="info-line"><span>端口上限</span><strong>${esc(data.user.max_ports ?? '-')}</strong></div>
            <div class="info-line"><span>接入节点</span><strong>${esc(data.node?.region || data.node?.name || '-')}</strong></div>
            <div class="info-line"><span>FRPS 接入点</span><strong>${esc(data.frps.addr)}:${esc(data.frps.port)}</strong></div>
            <div class="info-line"><span>邮箱</span><strong>${esc(data.user.email || '未设置')}</strong></div>
          </div>
          <form id="userEmailForm" class="grid" style="margin-top:12px">
            <div style="grid-column:1/-1"><label>设置邮箱（用于「忘记密码」接收验证码）</label><input name="email" type="email" value="${esc(data.user.email || '')}" placeholder="user@example.com"></div>
            <div class="form-actions" style="grid-column:1/-1"><button type="submit">保存邮箱</button></div>
          </form>
        </section>
        <section class="card profile-tools">
          <div class="section-title"><div><div class="section-kicker">RENEW</div><h2>${stIcon('key')}账号续期</h2><p>输入管理员发放的续期密钥，为当前账号延长有效期。</p></div></div>
          <form id="renewForm" class="grid renew-form">
            <div><label>续期密钥</label><input name="key" placeholder="RNW-XXXXXXXXXXXXXXXX" autocomplete="off" spellcheck="false" required></div>
            <div style="align-self:end"><button type="submit">立即续期</button></div>
          </form>
          <div id="renewResult" class="renew-result hidden"></div>
          <div class="profile-rows"><div class="info-line"><span>当前到期</span><strong>${esc(data.user.expires_text || '-')}</strong></div></div>
        </section>
        <section class="card profile-pwd">
          <div class="section-title"><div><div class="section-kicker">SECURITY</div><h2>${stIcon('key')}修改登录密码</h2><p>修改当前账号的登录密码，下次登录请使用新密码。</p></div></div>
          <form id="profilePwdForm" class="grid">${passwordFieldsHtml()}<div class="form-actions" style="grid-column:1/-1"><button type="submit">保存新密码</button></div></form>
        </section>
      </div>`, 'dashboard-profile', '个人中心');
    initRenewForm();
    initUserEmailForm();
    initPasswordForm();
    return;
  }
  const sideNav = `<aside class="app-sidebar">
      <div class="sidebar-brand"><div class="brand-mark-small">F</div><div><strong>Frp 管理台</strong><span>工作台</span></div></div>
      <div class="sidebar-section-label">工作区</div>
      <button class="side-link active"><span class="side-icon">⌂</span>概览</button>
      <button class="side-link" onclick="document.querySelector('.tunnel-list-section')?.scrollIntoView({behavior:'smooth'})"><span class="side-icon">↗</span>我的隧道</button>
      <button class="side-link" onclick="document.querySelector('.ports-section')?.scrollIntoView({behavior:'smooth'})"><span class="side-icon">#</span>端口资源</button>
      <div class="sidebar-section-label">工具</div>
      <a class="side-link" href="/config/frpc.toml">${sideIcon('download')}下载配置</a>
      <a class="side-link" href="/config/deploy-frpc.sh">${sideIcon('gear')}部署脚本</a>
      <div class="sidebar-spacer"></div>
    </aside>`;
  app.innerHTML = appLayoutHtml(`
    <section class="workspace-hero"><div><div class="hero-overline">FRP WORKSPACE</div><h1>连接你的内网服务</h1><p>统一管理隧道、端口和客户端配置，让每条映射都清晰可控。</p></div><button onclick="loadDashboard('tunnels')">＋ 新建隧道</button></section>
    <div class="workspace-stats">
      <section class="workspace-stat highlight"><span>隧道总数</span><strong>${data.tunnels.length}</strong><small>${data.tunnels.filter(t => t.enabled).length} 条正在启用</small></section>
      <section class="workspace-stat"><span>端口资源</span><strong>${ps.free || 0}</strong><small>可用 / 共 ${ps.total || 0} 个</small></section>
      <section class="workspace-stat"><span>今日流量</span><strong>${fmtBytes(todayTraffic)}</strong><small>${trafficLimit ? `上限 ${fmtBytes(trafficLimit)}` : '当前不限额'}</small></section>
      <section class="workspace-stat"><span>接入节点</span><strong>${esc(data.node?.region || '-')}</strong><small>${esc(data.frps.addr)}:${esc(data.frps.port)}</small></section>
    </div>
    <div class="workspace-columns"><div class="workspace-primary">
    ${isAdmin ? '' : userFrpsDashboardHtml(data.frps_user_dashboard)}
    ${isAdmin ? '' : `<section class="card ports-section"><div class="section-title"><div><div class="section-kicker">RESOURCE POOL</div><h2>${stIcon('port')}端口资源</h2></div><p>黄色表示已分配给隧道</p></div><div class="ports">${portsHtml}</div></section>`}
    <section class="card tunnel-config-entry"><div class="section-title"><div><div class="section-kicker">QUICK ACTION</div><h2>${stIcon('plus')}开始创建映射</h2></div><p>支持 TCP / UDP / HTTP / HTTPS 等协议</p></div><button onclick="loadDashboard('tunnels')">去创建隧道</button><span class="muted small">在「隧道管理」页填写本地服务和公网访问方式，创建后下载最新 frpc 配置。</span></section>
    <section class="card tunnel-list-section"><div class="section-title"><div><div class="section-kicker">MY TUNNELS</div><h2>${stIcon('tunnel')}我的隧道</h2><p>一张卡片对应一条映射。修改配置后，请重新下载 frpc.toml 并重启客户端。</p></div><span class="section-count">${data.tunnels.length} 条隧道</span></div><div class="tc-grid">${tunnelRows}</div></section>
    </div><aside class="workspace-aside">
      <section class="side-info-card"><div class="section-kicker">ACCOUNT</div><h3>${stIcon('user')}账号信息</h3><div class="info-line"><span>当前账号</span><strong>${esc(data.user.username)}</strong></div><div class="info-line"><span>所在节点</span><strong>${esc(data.node?.region || '-')} / ${esc(data.node?.name || '-')}</strong></div><div class="info-line"><span>端口上限</span><strong>${esc(data.user.max_ports)}</strong></div><div class="info-line"><span>有效期</span><strong>${esc(data.user.expires_text)}</strong></div></section>
      <section class="side-info-card dark-side"><div class="section-kicker">ACCESS POINT</div><h3>${stIcon('node')}FRPS 接入点</h3><div class="endpoint-big">${esc(data.frps.addr)}</div><code>${esc(data.frps.port)}</code><div class="side-actions"><a class="btn" href="/config/frpc.toml">下载配置</a><a class="btn secondary" href="/config/deploy-frpc.sh">部署脚本</a></div></section>
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
      await loadDashboard();
      show('隧道已创建，重新下载 frpc.toml 后重启 frpc 生效');
    }catch(err){ show(err.message, true); }
  };
}

function focusTunnelForm(){
  const card = document.querySelector('#tunnelCreateCard');
  if(card) card.scrollIntoView({behavior:'smooth', block:'start'});
  const input = document.querySelector('#tunnelForm input[name="name"]');
  if(input) setTimeout(() => input.focus({preventScroll:true}), 260);
}
function resetTunnelForm(){
  editingTunnelId = null;
  tunnelFormDraft = {};
  loadDashboard('tunnels').then(() => { applyTunnelFormMode(); focusTunnelForm(); });
}
// 表单模式：创建 / 修改 切换
function applyTunnelFormMode(){
  const isEdit = !!editingTunnelId;
  const title = document.querySelector('#tunnelFormTitle');
  const hint = document.querySelector('#tunnelFormHint');
  const submitBtn = document.querySelector('#tunnelSubmitBtn');
  const cancelBtn = document.querySelector('#tunnelCancelEditBtn');
  const banner = document.querySelector('#tunnelEditBanner');
  if(title) title.innerHTML = isEdit ? `${stIcon('edit')}修改隧道` : `${stIcon('plus')}创建隧道`;
  if(hint) hint.textContent = isEdit
    ? '改完点「保存修改」，然后重新下载 frpc.toml 并重启客户端即可生效。'
    : '填好本地服务和公网访问方式，创建后重新下载 frpc.toml 并重启客户端即可生效。';
  if(submitBtn) submitBtn.textContent = isEdit ? '保存修改' : '创建隧道';
  if(cancelBtn) cancelBtn.classList.toggle('hidden', !isEdit);
  if(banner){
    banner.classList.toggle('hidden', !isEdit);
    if(isEdit){
      const t = (lastTunnels || []).find(x => Number(x.id) === Number(editingTunnelId));
      const nameEl = document.querySelector('#tunnelEditName');
      const idEl = document.querySelector('#tunnelEditId');
      if(nameEl) nameEl.textContent = t ? t.name : '';
      if(idEl) idEl.textContent = editingTunnelId;
    }
  }
}
function editTunnel(id){
  const t = (lastTunnels || []).find(x => Number(x.id) === Number(id));
  if(!t){ show('找不到该隧道，请刷新后重试', true); return; }
  editingTunnelId = Number(id);
  tunnelFormDraft = {
    name: t.name || '',
    proxy_type: t.proxy_type || 'tcp',
    local_ip: t.local_ip || '127.0.0.1',
    local_port: t.local_port != null ? String(t.local_port) : '',
    remote_port: t.remote_port ? String(t.remote_port) : '',
    custom_domains: t.custom_domains || '',
    secret_key: t.secret_key || '',
  };
  loadDashboard('tunnels').then(() => {
    applyTunnelFormMode();
    setTimeout(focusTunnelForm, 120);
  });
}
function cancelTunnelEdit(){
  editingTunnelId = null;
  tunnelFormDraft = {};
  loadDashboard('tunnels').then(() => applyTunnelFormMode());
}
// 创建隧道已改为页面内表单（不再用弹窗）；保留旧函数名做兼容。
function openTunnelModal(){ loadDashboard('tunnels').then(() => setTimeout(focusTunnelForm, 120)); }
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
  setPanelMeta(data);
  softwareLicense = data.software_license || softwareLicense;
  adminSetupKey = data.setup_key || adminSetupKey;
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
      <td>${u.id}</td><td>${esc(u.username)}</td><td>${u.email ? esc(u.email) : '—'}</td><td>${esc(u.role)}</td><td>${esc(u.node_region || '-')} / ${esc(u.node_name || '-')}</td><td>${u.port_count}/${u.max_ports}</td><td>${u.tunnel_count}</td>
      <td>${fmtBytes(u.traffic_limit_bytes)} / ${u.bandwidth_limit_kbps ? `${(Number(u.bandwidth_limit_kbps) / 1024).toFixed(1)} MB/s` : '不限'}</td>
      <td>${esc(u.expires_text)} ${u.expired ? '<span class="bad">已到期</span>' : ''}</td>
      <td>${u.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td><code class="token" title="${esc(u.invite_key_used || '')}">${esc(u.invite_key_used || '后台创建')}</code></td>
      <td class="actions node-actions user-actions">
        <button class="node-action" onclick="adminToggle(${u.id})">${u.active ? '停用' : '启用'}</button>
        <button class="node-action" onclick="adminExtend(${u.id})">续30天</button>
        <button class="node-action" onclick="openAdminLimits(${u.id}, ${Number(u.traffic_limit_bytes || 0)}, ${Number(u.bandwidth_limit_kbps || 0)}, '${esc(u.username)}')">流量限制</button>
        <button class="node-action" onclick="openAdminCred('password', ${u.id}, '${esc(u.username)}')">重置密码</button>
        <button class="node-action" onclick="openAdminCred('token', ${u.id}, '${esc(u.username)}')">重置令牌</button>
        <button class="node-action" onclick="openAdminEmail(${u.id}, '${esc(u.email || '')}', '${esc(u.username)}')">设邮箱</button>
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
  const KEY_KIND_LABEL = {register: '注册', renew: '续期', reset: '重置'};
  const keyRows = keysSlice.map(k => {
    const kind = ['register', 'renew', 'reset'].includes(k.kind) ? k.kind : 'register';
    const isRegister = kind === 'register';
    return `
    <tr>
      <td>${k.id}</td>
      <td><span class="key-kind ${kind}">${KEY_KIND_LABEL[kind]}</span></td>
      <td><code class="token" title="${esc(k.key)}">${esc(k.key)}</code></td>
      <td>${esc(k.note)}</td>
      <td>${k.used_count}/${k.max_uses}</td>
      <td>${isRegister ? k.max_ports : '-'}</td>
      <td>${isRegister ? `${fmtBytes(k.traffic_limit_bytes)} / ${k.bandwidth_limit_kbps ? `${(Number(k.bandwidth_limit_kbps) / 1024).toFixed(1)} MB/s` : '不限'}` : '-'}</td>
      <td>${kind === 'renew' ? `+${k.user_expires_days} 天` : (isRegister ? (k.user_expires_days === 0 ? '永不过期' : `${k.user_expires_days} 天`) : '-')}</td>
      <td>${esc(k.expires_text)} ${k.expired ? '<span class="bad">已过期</span>' : ''}</td>
      <td>${k.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td class="actions"><button onclick="copyText('${k.key}')">复制</button><button onclick="inviteToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button class="danger" onclick="inviteDelete(${k.id})">删除</button></td>
    </tr>`;
  }).join('') || emptyRow(11, '还没有密钥');
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
    <section class="card hidden" id="editNodeCard"><div class="section-title"><h2>${stIcon('edit')}编辑节点</h2><p>建议使用稳定域名，方便后期更换 VPS</p></div><form id="editNodeForm" class="grid">
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
    <section class="card"><div class="section-title"><h2>${stIcon('nodePlus')}新增节点</h2><p>每个节点独立端口池和 token；填好信息后可直接生成一键部署脚本</p></div><form id="nodeForm" class="grid">
      <div><label>地区</label><input name="region" placeholder="香港 / 日本 / 美国" required></div>
      <div><label>节点名</label><input name="name" placeholder="hk-1" required></div>
      <div><label>frps 域名/地址</label><input name="server_addr" placeholder="hk.example.com" required></div>
      <div><label>frps bindPort</label><input name="server_port" type="number" value="7000" min="1" max="65535"></div>
      <div><label>frps token</label><input name="auth_token" id="nodeAuthToken" value="${esc(genRandomToken())}" required><span class="muted small">已随机生成，可直接使用；<button type="button" class="link-btn" onclick="document.querySelector('#nodeAuthToken').value=genRandomToken()">重新生成</button></span></div>
      <div><label>带宽（Mbps）</label><input name="bandwidth_mbps" type="number" value="0" min="0" step="1"><span class="muted small">0 表示不限</span></div>
      <div><label>端口起始</label><input name="port_start" type="number" value="20000" min="1" max="65535"></div>
      <div><label>端口结束</label><input name="port_end" type="number" value="20199" min="1" max="65535"></div>
      <div><label>frp 版本</label><select name="frp_channel" id="nodeFrpChannel"><option value="stable">稳定版（推荐）</option><option value="latest">最新版</option><option value="custom">自定义版本</option></select></div>
      <div class="hidden" id="nodeFrpVersionWrap"><label>自定义 frp 版本</label><input name="frp_version" placeholder="例如 0.66.0"></div>
      <div><label>备注</label><input name="note" placeholder="线路/机房说明"></div>
      <div class="form-actions" style="grid-column:1/-1"><button>创建节点</button></div>
    </form>
    <div id="nodeDeployScriptBox" class="deploy-script-item hidden" style="margin-top:14px"><div class="label">一键部署脚本（复制到新节点机器上执行）</div><div class="copy-line"><code class="token deploy-token" id="nodeDeployScriptCmd"></code><button type="button" class="secondary" onclick="copyNodeDeployScript()">复制命令</button></div><p class="muted small">脚本从公开仓库拉取，不依赖本面板；执行时会把该节点注册到当前面板（地址、密钥与节点信息已按上方表单预填）。</p></div></section>
    <section class="card" id="nodes"><div class="section-title"><h2>${stIcon('node')}节点列表</h2><p>启用节点优先，剩余端口多的排前面</p></div><table><thead><tr><th>ID</th><th>地区</th><th>节点</th><th>frps</th><th>端口池</th><th>剩余</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>${nodeRows}</tbody></table>${paginationHtml('nodes', nodesPage, (data.nodes || []).length, ADMIN_PAGE_SIZE)}</section>`;
  const keysHtml = `
    <section class="card" id="keys"><div class="section-title"><h2>${stIcon('key')}生成注册密钥</h2><p>注册密钥固定单次使用，适合批量发货</p></div><form id="inviteForm" class="grid">
      <input type="hidden" name="kind" value="register">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/套餐名"></div>
      <div><label>注册后端口数</label><input name="max_ports" type="number" value="5" min="1" max="100"></div>
      <div><label>今日流量上限 GB</label><input name="traffic_limit_gb" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限</span></div>
      <div><label>速率策略 MB/s</label><input name="bandwidth_limit_mbs" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限；仅后台可见</span></div>
      <div><label>注册后账号有效期天数</label><input name="user_expires_days" type="number" value="30" min="0" max="3650"></div>
      <div style="align-self:end"><button>生成密钥</button></div>
    </form></section>
    <section class="card" id="renew-keys"><div class="section-title"><h2>${stIcon('key')}生成续期密钥</h2><p>用户凭续期密钥在「个人中心 · 账号续期」自助延长账号有效期</p></div><form id="renewKeyForm" class="grid">
      <input type="hidden" name="kind" value="renew">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/续期说明"></div>
      <div><label>续期天数</label><input name="user_expires_days" type="number" value="30" min="1" max="3650"><span class="muted small">用户使用后延长这么多天</span></div>
      <div style="grid-column:1/-1;display:flex;justify-content:flex-start"><button>生成续期密钥</button></div>
    </form></section>
    <section class="card"><div class="section-title"><div><h2>${stIcon('key')}密钥列表</h2><p>注册 / 续期密钥，单次使用</p></div><a class="btn" href="/admin/export/invite-keys.csv">导出未使用密钥 CSV</a></div><table><thead><tr><th>ID</th><th>类型</th><th>密钥</th><th>备注</th><th>使用</th><th>端口</th><th>流量/速率策略</th><th>有效期/续期</th><th>密钥到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${keyRows}</tbody></table>${paginationHtml('keys', keysPage, (data.invite_keys || []).length, ADMIN_PAGE_SIZE)}</section>
    ${data.software_license_authority ? `<section class="card" id="software-licenses"><div class="section-title"><h2>${stIcon('license')}服务器软件授权码</h2><p>卖家后台使用：先批量生成授权码发给客户；客户输入授权码后自动绑定他的部署服务器。</p></div><form id="softwareLicenseForm" class="grid">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/客户名"></div>
      <div><label>套餐</label><input name="plan" value="deploy"></div>
      <div><label>有效期天数</label><input name="expires_days" type="number" value="0" min="0" max="3650"><span class="muted small">0 表示永不过期</span></div>
      <div style="align-self:end"><button>生成软件授权码</button></div>
    </form><p class="panel-note small">客户不需要提供机器码；首次激活时授权服务器会自动绑定机器。批量生成后会自动复制并下载 txt。</p>
    <table><thead><tr><th>ID</th><th>授权码</th><th>备注</th><th>套餐</th><th>绑定机器</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${softwareKeyRows}</tbody></table></section>` : ''}`;
  const usersHtml = `
    <section class="card"><div class="section-title"><h2>${stIcon('userPlus')}创建用户</h2><p>管理员直开账号，可指定接入节点</p></div><form id="createUserForm" class="grid">
      <div><label>用户名</label><input name="username" required></div>
      <div><label>初始密码</label><input name="password" type="password" required></div>
      <div><label>邮箱</label><input name="email" type="email" placeholder="user@example.com（用于找回密码）"></div>
      <div><label>接入节点</label><select name="node_id" required>${adminNodeOptions}</select></div>
      <div><label>端口数量</label><input name="max_ports" type="number" value="5" min="1" max="100"></div>
      <div><label>今日流量上限 GB</label><input name="traffic_limit_gb" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限</span></div>
      <div><label>速率策略 MB/s</label><input name="bandwidth_limit_mbs" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限；仅后台可见</span></div>
      <div><label>有效期天数</label><input name="expires_days" type="number" value="30" min="0" max="3650"><span class="muted small">0 表示永不过期</span></div>
      <div style="align-self:end"><button>创建</button></div>
    </form></section>
    <section class="card" id="users"><div class="section-title"><h2>${stIcon('users')}用户列表</h2><p>管理状态、续期、注册密钥和删除账号</p></div>
      <form id="adminUserFilterForm" class="grid admin-user-filters">
        <div><label for="adminUserSearch">搜索用户</label><input id="adminUserSearch" name="search" value="${esc(adminUserSearch)}" placeholder="用户名、ID、注册密钥"></div>
        <div><label for="adminUserNode">接入节点</label><select id="adminUserNode" name="node"><option value="">全部节点</option>${(data.nodes || []).map(n => `<option value="${n.id}" ${String(n.id)===String(adminUserNode)?'selected':''}>${esc(n.region)} / ${esc(n.name)}</option>`).join('')}</select></div>
        <div><label for="adminUserStatus">账号状态</label><select id="adminUserStatus" name="status"><option value="all" ${adminUserStatus==='all'?'selected':''}>全部状态</option><option value="active" ${adminUserStatus==='active'?'selected':''}>正常启用</option><option value="disabled" ${adminUserStatus==='disabled'?'selected':''}>已停用</option><option value="expired" ${adminUserStatus==='expired'?'selected':''}>已到期</option></select></div>
        <div class="form-actions"><button type="submit">筛选</button><button type="button" class="secondary" id="adminUserFilterReset">重置</button></div>
      </form>
      <p class="muted small">当前 ${filteredUsers.length} 个用户符合条件，共 ${allUsers.length} 个用户。</p><table><thead><tr><th>ID</th><th>用户</th><th>邮箱</th><th>角色</th><th>接入节点</th><th>端口</th><th>隧道</th><th>流量/速率策略</th><th>到期</th><th>状态</th><th>注册密钥</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>${paginationHtml('users', usersPage, filteredUsers.length, ADMIN_PAGE_SIZE)}</section>
    <div id="adminLimitsModal" class="modal-backdrop modal-center hidden" role="dialog" aria-modal="true" aria-labelledby="adminLimitsTitle" onclick="if(event.target===this)closeAdminLimits()">
      <section class="modal-page card admin-limits-modal">
        <div class="section-title modal-title">
          <div><div class="section-kicker">LIMITS</div><h2 id="adminLimitsTitle">${stIcon('chart')}流量 / 速率限制</h2><p id="adminLimitsUser">调整该用户的每日流量上限与速率策略。</p></div>
          <button type="button" class="secondary modal-close" onclick="closeAdminLimits()">关闭 ×</button>
        </div>
        <form id="adminLimitsForm" class="grid">
          <input type="hidden" name="id">
          <div><label>今日流量上限 GB</label><input name="traffic_limit_gb" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限</span></div>
          <div><label>速率策略 MB/s</label><input name="bandwidth_limit_mbs" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限；仅后台可见</span></div>
          <div class="form-actions" style="grid-column:1/-1"><button type="submit">保存</button><button type="button" class="secondary" onclick="closeAdminLimits()">取消</button></div>
        </form>
      </section>
    </div>
    <div id="adminCredModal" class="modal-backdrop modal-center hidden" role="dialog" aria-modal="true" aria-labelledby="adminCredTitle" onclick="if(event.target===this)closeAdminCred()">
      <section class="modal-page card admin-cred-modal">
        <div class="section-title modal-title"><div><h2 id="adminCredTitle">重置密码</h2><p id="adminCredHint">默认已随机生成，可直接使用，也可自行修改。</p></div><button type="button" class="secondary modal-close" onclick="closeAdminCred()">关闭 ×</button></div>
        <form id="adminCredForm" class="grid">
          <input type="hidden" name="id">
          <input type="hidden" name="kind" value="password">
          <div style="grid-column:1/-1"><label id="adminCredLabel">新密码</label><input name="value" id="adminCredValue" required autocomplete="off" spellcheck="false"><span class="muted small">默认已生成随机值；<button type="button" class="link-btn" onclick="regenAdminCred()">重新生成</button></span></div>
          <div class="form-actions" style="grid-column:1/-1"><button type="submit">确认重置</button><button type="button" class="secondary" onclick="closeAdminCred()">取消</button></div>
        </form>
      </section>
    </div>
    <div id="adminEmailModal" class="modal-backdrop modal-center hidden" role="dialog" aria-modal="true" aria-labelledby="adminEmailTitle" onclick="if(event.target===this)closeAdminEmail()">
      <section class="modal-page card admin-limits-modal">
        <div class="section-title modal-title">
          <div><div class="section-kicker">EMAIL</div><h2 id="adminEmailTitle">${stIcon('cloud')}设置用户邮箱</h2><p id="adminEmailUser">用于「忘记密码」接收验证码。</p></div>
          <button type="button" class="secondary modal-close" onclick="closeAdminEmail()">关闭 ×</button>
        </div>
        <form id="adminEmailForm" class="grid">
          <input type="hidden" name="id">
          <div style="grid-column:1/-1"><label>邮箱地址</label><input name="email" type="email" placeholder="user@example.com（留空则清除）"></div>
          <div class="form-actions" style="grid-column:1/-1"><button type="submit">保存</button><button type="button" class="secondary" onclick="closeAdminEmail()">取消</button></div>
        </form>
      </section>
    </div>`;
  const riskHtml = `
    <section class="card" id="risk"><div class="section-title"><h2>${stIcon('risk')}投诉处理 / 风控</h2><p>按端口定位用户并快速封禁</p></div>
      <form id="lookupPortForm" class="grid">
        <div><label>被投诉端口</label><input name="remote_port" type="number" min="1" max="65535" placeholder="例如 20088" required></div>
        <div><label>节点（可选）</label><select name="node_id"><option value="0">全部节点</option>${nodeOptions(data.nodes || [])}</select></div>
        <div style="align-self:end"><button>查询</button></div>
      </form>
      <div id="riskResult" class="risk-result"></div>
    </section>
    <section class="card"><div class="section-title"><h2>${stIcon('log')}审计日志</h2><p>最近 80 条关键操作和风控事件</p></div><table><thead><tr><th>ID</th><th>事件</th><th>用户</th><th>端口</th><th>协议</th><th>详情</th><th>时间</th></tr></thead><tbody>${logRows}</tbody></table>${paginationHtml('risk', riskPage, (data.logs || []).length, ADMIN_PAGE_SIZE)}</section>`;
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
        if(keys.length){
          const text = keys.join('\n');
          await copyText(text);
        }
        await loadAdmin();
        show(r.message || '软件授权码已生成');
      }catch(err){ show(err.message, true); }
    };
  }
  const nodeForm = document.querySelector('#nodeForm');
  if(nodeForm){
    nodeForm.onsubmit = (e) => {
      e.preventDefault();
      // 不再直接建节点：根据表单生成一键部署脚本，用户在节点机上执行后节点才会接入。
      genNodeDeployScript();
    };
  }
  const nodeFrpChannel = document.querySelector('#nodeFrpChannel');
  if(nodeFrpChannel) nodeFrpChannel.onchange = () => {
    const wrap = document.querySelector('#nodeFrpVersionWrap');
    if(wrap) wrap.classList.toggle('hidden', nodeFrpChannel.value !== 'custom');
  };
  const editNodeForm = document.querySelector('#editNodeForm');
  if(editNodeForm){
    editNodeForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/nodes/update', {method:'POST', body:Object.fromEntries(fd)});
        await loadAdmin();
        show(r.message || '节点已更新');
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
        await loadAdmin();
        show(r.message || '用户已创建');
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
        if(keys.length){
          const text = keys.join('\n');
          await copyText(text);
        }
        await loadAdmin();
        show(r.message || '密钥已生成');
      }catch(err){ show(err.message, true); }
    };
  }
  const renewKeyForm = document.querySelector('#renewKeyForm');
  if(renewKeyForm){
    renewKeyForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try{
        const r = await api('/api/admin/invite-keys/create', {method:'POST', body:Object.fromEntries(fd)});
        const keys = r.keys || (r.key ? [r.key] : []);
        if(keys.length){ await copyText(keys.join('\n')); }
        await loadAdmin();
        show(r.message || '续期密钥已生成');
      }catch(err){ show(err.message, true); }
    };
  }
  const adminLimitsForm = document.querySelector('#adminLimitsForm');
  if(adminLimitsForm){
    adminLimitsForm.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try{
        const r = await api('/api/admin/users/limits', {method:'POST', body});
        closeAdminLimits();
        await loadAdmin();
        show(r.message || '已更新流量/速率限制');
      }catch(err){ show(err.message, true); }
    };
  }
  const adminEmailForm = document.querySelector('#adminEmailForm');
  if(adminEmailForm){
    adminEmailForm.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try{
        const r = await api('/api/admin/users/email', {method:'POST', body});
        closeAdminEmail();
        await loadAdmin();
        show(r.message || '邮箱已更新');
      }catch(err){ show(err.message, true); }
    };
  }
  const adminCredForm = document.querySelector('#adminCredForm');
  if(adminCredForm){ adminCredForm.onsubmit = submitAdminCred; }
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
    <div class="section-title"><h3>${stIcon('search')}查询结果</h3><p>如确认违规，可直接封禁用户</p></div>
    <table><thead><tr><th>节点</th><th>端口</th><th>用户</th><th>账号状态</th><th>隧道</th><th>协议</th><th>本地服务</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="section-title"><h3>${stIcon('log')}端口相关日志</h3><p>最近 30 条</p></div>
    <table><thead><tr><th>事件</th><th>用户</th><th>详情</th><th>时间</th></tr></thead><tbody>${logRows}</tbody></table>`;
}

async function banUser(id){
  const reason = prompt('请输入封禁原因', '违法/违规内容投诉');
  if(reason === null) return;
  await api('/api/admin/users/ban', {method:'POST', body:{id, reason}}).then(r=>{loadAdmin().then(()=>show(r.message || '已封禁'));}).catch(e=>show(e.message,true));
}

async function backupToR2(){
  if(!confirm('现在生成全量备份并上传到 Cloudflare R2？')) return;
  await api('/api/admin/backup/r2', {method:'POST', body:{}}).then(r=>{
    show(`${r.message}：${r.object_key}`);
    reloadAdminCurrentPage();
  }).catch(e=>show(e.message,true));
}

async function saveR2Config(e){
  e.preventDefault();
  const fd = new FormData(e.target);
  try{
    const r = await api('/api/admin/r2/config', {method:'POST', body:Object.fromEntries(fd)});
    await reloadAdminCurrentPage();
    show(r.message || 'R2 配置已保存');
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
    adminFrpcDraftRows = [{name:'web', proxy_type:'tcp', local_ip:'127.0.0.1', local_port:'80', remote_port:'', custom_domains:'', secret_key:''}];
    closeAdminFrpcModal();
    await reloadAdminCurrentPage();
    show(r.message || '隧道已创建并下载 frpc 配置和部署脚本');
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
    await reloadAdminCurrentPage();
  }catch(err){ show(err.message, true); }
}

async function adminToggle(id){ await api('/api/admin/users/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function adminExtend(id){ await api('/api/admin/users/extend', {method:'POST', body:{id, days:30}}).then(r=>{loadAdmin().then(()=>show(r.message||'已续期'));}).catch(e=>show(e.message,true)); }
function openAdminLimits(id, trafficBytes=0, bandwidthKbps=0, username=''){
  const modal = document.querySelector('#adminLimitsModal');
  if(!modal) return;
  const form = modal.querySelector('#adminLimitsForm');
  if(form){
    form.elements.id.value = id;
    form.elements.traffic_limit_gb.value = trafficBytes ? (Number(trafficBytes) / 1024 / 1024 / 1024).toFixed(1) : '0';
    form.elements.bandwidth_limit_mbs.value = bandwidthKbps ? (Number(bandwidthKbps) / 1024).toFixed(1) : '0';
  }
  const label = modal.querySelector('#adminLimitsUser');
  if(label) label.textContent = username ? `用户 ${username}` : '调整该用户的每日流量上限与速率策略。';
  modal.classList.remove('hidden');
}
function closeAdminLimits(){ document.querySelector('#adminLimitsModal')?.classList.add('hidden'); }
function openAdminEmail(id, email, username){
  const modal = document.querySelector('#adminEmailModal');
  if(!modal) return;
  const form = modal.querySelector('#adminEmailForm');
  form.elements.id.value = id;
  form.elements.email.value = email || '';
  const label = modal.querySelector('#adminEmailUser');
  if(label) label.textContent = username ? `用户 ${username} · 用于「忘记密码」接收验证码` : '用于「忘记密码」接收验证码。';
  modal.classList.remove('hidden');
}
function closeAdminEmail(){ document.querySelector('#adminEmailModal')?.classList.add('hidden'); }
let adminCredKind = 'password';
function regenAdminCred(){
  const el = document.querySelector('#adminCredValue');
  if(!el) return;
  el.value = adminCredKind === 'token' ? genRandomToken(32) : genRandomToken(12);
}
function openAdminCred(kind, id, username){
  adminCredKind = kind === 'token' ? 'token' : 'password';
  const modal = document.querySelector('#adminCredModal');
  if(!modal) return;
  const form = modal.querySelector('#adminCredForm');
  form.elements.id.value = id;
  form.elements.kind.value = adminCredKind;
  const title = modal.querySelector('#adminCredTitle');
  const label = modal.querySelector('#adminCredLabel');
  const hint = modal.querySelector('#adminCredHint');
  if(adminCredKind === 'token'){
    if(title) title.textContent = '重置面板令牌';
    if(label) label.textContent = '新令牌';
    if(hint) hint.textContent = `用户 ${username}：默认已随机生成，可自行修改；重置后该用户需重新下载 frpc 配置。`;
  }else{
    if(title) title.textContent = '重置登录密码';
    if(label) label.textContent = '新密码';
    if(hint) hint.textContent = `用户 ${username}：默认已随机生成，可自行修改；重置后该用户需用新密码登录。`;
  }
  regenAdminCred();
  modal.classList.remove('hidden');
}
function closeAdminCred(){ document.querySelector('#adminCredModal')?.classList.add('hidden'); }
async function submitAdminCred(e){
  e.preventDefault();
  const form = e.target;
  const kind = form.elements.kind.value === 'token' ? 'token' : 'password';
  const id = Number(form.elements.id.value || 0);
  const value = String(form.elements.value.value || '').trim();
  if(!value){ show('请填写内容', true); return; }
  if(kind === 'password' && value.length < 6){ show('密码至少 6 位', true); return; }
  if(kind === 'token' && value.length < 8){ show('令牌至少 8 位', true); return; }
  try{
    const body = kind === 'token' ? {id, token: value} : {id, password: value};
    const path = kind === 'token' ? '/api/admin/users/reset-token' : '/api/admin/users/reset-password';
    const r = await api(path, {method:'POST', body});
    closeAdminCred();
    await loadAdmin();
    show(r.message || (kind === 'token' ? '令牌已重置' : '密码已重置'));
  }catch(err){ show(err.message, true); }
}
async function adminDelete(id){ if(confirm('删除用户会释放端口并删除隧道，确定？')) await api('/api/admin/users/delete', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('用户已删除'))).catch(e=>show(e.message,true)); }
async function inviteToggle(id){ await api('/api/admin/invite-keys/toggle', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('密钥状态已更新'))).catch(e=>show(e.message,true)); }
async function inviteDelete(id){ if(confirm('删除这个注册密钥？')) await api('/api/admin/invite-keys/delete', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('密钥已删除'))).catch(e=>show(e.message,true)); }
async function softwareLicenseToggle(id){ await api('/api/admin/software-licenses/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function softwareLicenseUnbind(id){ if(confirm('解绑后该授权码可被下一台客户服务器重新激活，确定？')) await api('/api/admin/software-licenses/unbind', {method:'POST', body:{id}}).then(r=>{loadAdmin().then(()=>show(r.message || '已解绑'));}).catch(e=>show(e.message,true)); }
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

// 一键添加节点脚本（公开仓库版，不依赖本面板）
const NODE_INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/bohu-t/lite-install/main/add-frps-node.sh';
function shellQuote(v){ return `'${String(v).replace(/'/g, `'\\''`)}'`; }
function genRandomToken(len){
  const n = Math.max(8, Number(len) || 32);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(n);
  if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else for(let i=0;i<n;i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for(let i=0;i<n;i++) out += chars[bytes[i] % chars.length];
  return out;
}
function genNodeDeployScript(){
  const form = document.querySelector('#nodeForm');
  if(!form) return;
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  const region = String(fd.get('region') || '').trim();
  const addr = String(fd.get('server_addr') || '').trim();
  const bind = String(fd.get('server_port') || '').trim() || '7000';
  const token = String(fd.get('auth_token') || '').trim();
  const portStart = String(fd.get('port_start') || '').trim();
  const portEnd = String(fd.get('port_end') || '').trim();
  if(!name || !region || !addr || !token || !portStart || !portEnd){
    show('请先填写：地区、节点名、frps 域名/地址、frps token、端口范围', true); return;
  }
  const setupKey = (adminSetupKey || '').trim();
  if(!setupKey){ show('节点密钥获取失败，请刷新页面后重试', true); return; }
  const channel = (document.querySelector('#nodeFrpChannel') || {}).value || 'stable';
  const customVer = String((document.querySelector('#nodeFrpVersionWrap input') || {}).value || '').trim();
  const env = [
    `PANEL_URL=${shellQuote(location.origin)}`,
    `SETUP_KEY=${shellQuote(setupKey)}`,
    `NODE_NAME=${shellQuote(name)}`,
    `REGION=${shellQuote(region)}`,
    `SERVER_IP=${shellQuote(addr)}`,
    `FRPS_BIND_PORT=${shellQuote(bind)}`,
    `FRPS_TOKEN=${shellQuote(token)}`,
    `PORT_START=${shellQuote(portStart)}`,
    `PORT_END=${shellQuote(portEnd)}`,
    `BANDWIDTH_MBPS=${shellQuote(String(fd.get('bandwidth_mbps') || '0').trim() || '0')}`,
    `NOTE=${shellQuote(String(fd.get('note') || '').trim())}`,
  ];
  if(channel === 'latest') env.push('FRP_CHANNEL=latest');
  else if(channel === 'custom'){
    if(!customVer){ show('请填写自定义 frp 版本号', true); return; }
    env.push(`FRP_VERSION=${shellQuote(customVer)}`);
  } else env.push('FRP_CHANNEL=stable');
  const cmd = `${env.join(' ')} bash <(curl -fsSL ${NODE_INSTALL_SCRIPT_URL})`;
  const box = document.querySelector('#nodeDeployScriptBox');
  const codeEl = document.querySelector('#nodeDeployScriptCmd');
  if(codeEl) codeEl.textContent = cmd;
  if(box){ box.classList.remove('hidden'); box.scrollIntoView({behavior:'smooth', block:'nearest'}); }
}
function copyNodeDeployScript(){
  const el = document.querySelector('#nodeDeployScriptCmd');
  const cmd = el ? el.textContent.trim() : '';
  if(!cmd){ show('请先填好信息并点「创建节点」生成脚本', true); return; }
  copyText(cmd);
}

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


async function sendNotifyTest(){
  try{
    const r = await api('/api/admin/notify-test', {method:'POST', body:{}});
    const detail = (r.results || []).map(x => `${x.channel}：${x.ok ? '成功' : x.message}`).join('；');
    show(detail ? `测试通知已发送（${detail}）` : (r.message || '测试通知已发送'));
  }catch(err){ show(err.message, true); }
}

async function sendSmtpTest(){
  const to = (adminSmtp && (adminSmtp.from_addr || adminSmtp.user)) || '';
  if(!to){ show('请先填写并保存发件账号', true); return; }
  try{ const r = await api('/api/admin/smtp-test', {method:'POST', body:{to}}); show(r.message || '测试邮件已发送'); }
  catch(err){ show(err.message, true); }
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
  setPanelMeta(data);
  const allNodes = data.nodes || [];
  const onlineNodes = allNodes.filter(n => n.active && n.auth_status === 'online').length;
  const badNodes = allNodes.filter(n => n.active && n.auth_status !== 'online').length;
  const offNodes = allNodes.filter(n => !n.active).length;
  const totalPorts = allNodes.reduce((s,n) => s + Number(n.port_count || 0), 0);
  const usedPorts = allNodes.reduce((s,n) => s + (Number(n.port_count || 0) - Number(n.free_count || 0)), 0);
  const freePorts = allNodes.reduce((s,n) => s + Number(n.free_count || 0), 0);
  const healthPageSize = nodeHealthPageSize();
  nodeHealthPage = clampPage(nodeHealthPage, allNodes.length, healthPageSize);
  const healthNodes = pageItems(allNodes, nodeHealthPage, healthPageSize);
  const nodeRows = healthNodes.map(n => {
    const used = Number(n.port_count || 0) - Number(n.free_count || 0);
    const latency = (n.auth_latency_ms !== undefined && n.auth_latency_ms !== null) ? `${n.auth_latency_ms} ms` : '—';
    const latencyCell = `<span data-latency-node="${esc(n.server_addr || '')}">${esc(latency)}</span>`;
    return `
    <tr>
      <td><b>${esc(n.name || '-')}</b></td>
      <td><code>${esc(n.server_addr || '-')}:${esc(n.server_port ?? '-')}</code></td>
      <td>${nodeStatusBadge(n)}</td>
      <td>${latencyCell}</td>
      <td>${n.port_start != null ? `${esc(n.port_start)} - ${esc(n.port_end)}` : '—'}</td>
      <td>${used} / ${esc(n.port_count || 0)}</td>
      <td>${n.bandwidth_mbps ? esc(n.bandwidth_mbps) + ' Mbps' : '未设置'}</td>
      <td>${n.dashboard_configured ? '<span class="ok">已接入</span>' : '<span class="muted">未接入</span>'}</td>
      <td>${esc(n.note || '—')}</td>
    </tr>`;
  }).join('') || emptyRow(9, '暂无节点');
  app.innerHTML = appLayoutHtml(`
    <section class="monitor-summary-grid">
      <section class="card monitor-summary-card monitor-summary-primary"><span>节点总数</span><strong>${allNodes.length}</strong><small>在线 ${onlineNodes} · 停用 ${offNodes}</small></section>
      <section class="card monitor-summary-card"><span>认证正常</span><strong>${onlineNodes}</strong><small>auth/bind 端口可连通</small></section>
      <section class="card monitor-summary-card"><span>认证异常</span><strong>${badNodes}</strong><small>启用但端口不可达</small></section>
      <section class="card monitor-summary-card"><span>端口池</span><strong>${usedPorts} / ${totalPorts}</strong><small>空闲 ${freePorts} 个</small></section>
    </section>
    <section class="card node-health-card"><div class="section-title"><div><h2>${stIcon('pulse')}节点健康状态</h2><p>检查 frps bind/auth 端口连通性，确认节点在线和端口池使用情况。</p></div><button class="secondary" type="button" onclick="loadAdminHealth()">重新检查</button></div>
      <table class="compact-table"><thead><tr><th>节点</th><th>frps 接入</th><th>认证状态</th><th>延迟</th><th>端口池</th><th>端口使用</th><th>带宽</th><th>流量监控</th><th>备注</th></tr></thead><tbody>${nodeRows}</tbody></table>
      ${paginationHtml('health', nodeHealthPage, allNodes.length, healthPageSize)}
    </section>`, 'health', '节点健康');
  fillNodeLatencies();
}

/* --- Admin host resource charts (2D line/area, no external libs) --- */
let adminHostHistory = [];

function hostClockText(ts){
  const d = new Date((Number(ts) || 0) * 1000);
  if(isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function hostChartSvg(points, key, color, gradId, width, label){
  const W = Math.max(180, Math.round(width || 300));
  const H = 132, padL = 30, padR = 30, padT = 14, padB = 20;
  const innerW = Math.max(10, W - padL - padR), innerH = Math.max(10, H - padT - padB);
  let pts = (points || []).filter(p => p && p[key] !== null && p[key] !== undefined && !isNaN(Number(p[key])));
  if(!pts.length) return '<div class="host-chart-empty">等待采样…</div>';
  if(pts.length === 1) pts = [pts[0], pts[0]];
  const n = pts.length;
  const clamp = v => Math.max(0, Math.min(100, Number(v)));
  const xs = i => padL + (innerW * i) / (n - 1);
  const ys = v => padT + innerH - (clamp(v) / 100) * innerH;
  let grid = '';
  [0, 25, 50, 75, 100].forEach(v => {
    const yy = ys(v).toFixed(1);
    grid += `<line x1="${padL}" y1="${yy}" x2="${(W - padR).toFixed(1)}" y2="${yy}" class="host-chart-grid"/>`;
  });
  [100, 50, 0].forEach(v => {
    grid += `<text x="${padL - 6}" y="${(ys(v) + 3.5).toFixed(1)}" text-anchor="end" class="host-chart-ylabel">${v}%</text>`;
  });
  const coords = pts.map((p, i) => [xs(i), ys(p[key])]);
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const base = (padT + innerH).toFixed(1);
  const area = `${line} L${coords[n-1][0].toFixed(1)},${base} L${coords[0][0].toFixed(1)},${base} Z`;
  const last = coords[n-1], lastV = Math.round(clamp(pts[n-1][key]));
  const vx = Math.min(Math.max(last[0], padL + 14), W - padR - 14);
  const vy = Math.max(last[1] - 10, padT + 10);
  const t0 = hostClockText(pts[0].ts), t1 = hostClockText(pts[n-1].ts);
  return `<svg class="host-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || '')}">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".32"/><stop offset="100%" stop-color="${color}" stop-opacity=".02"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#${gradId})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.6" fill="#fff" stroke="${color}" stroke-width="2.2"/>
    <text x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle" class="host-chart-value">${lastV}%</text>
    ${n > 2 ? `<text x="${padL}" y="${H - 5}" text-anchor="start" class="host-chart-xlabel">${esc(t0)}</text>` : ''}
    <text x="${(W - padR).toFixed(1)}" y="${H - 5}" text-anchor="end" class="host-chart-xlabel">${n > 2 ? esc(t1) : '采样中'}</text>
  </svg>`;
}

function hostChartPanelHtml(history, key, color, gradId, label, valueLabel, note){
  const count = (history || []).filter(p => p && p[key] !== null && p[key] !== undefined).length;
  return `<div class="host-chart-panel">
    <div class="host-chart-head"><span class="host-chart-name"><i class="host-dot ${key}"></i>${esc(label)}</span><b>${esc(valueLabel)}</b></div>
    <div class="host-chart-slot" data-metric="${key}" data-color="${color}" data-grad="${gradId}" data-label="${esc(label)}"></div>
    <div class="host-chart-foot"><small>${esc(note)}</small><small class="host-chart-samples">采样 ${count} 点</small></div>
  </div>`;
}

function renderHostCharts(){
  const slots = document.querySelectorAll('.host-chart-slot');
  if(!slots.length) return;
  Array.prototype.forEach.call(slots, slot => {
    slot.innerHTML = hostChartSvg(adminHostHistory, slot.dataset.metric, slot.dataset.color, slot.dataset.grad, slot.clientWidth || 260, slot.dataset.label);
  });
}

function reloadAdminCurrentPage(){
  return adminCurrentPage === 'settings' ? loadAdminSettings() : loadAdminDashboard();
}

function adminOpsCardHtml(){
  return `<section class="card admin-ops-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-purple">${stIcon('tools')}</span><div><h2>运维入口</h2><p>提供系统运维维护相关工具和功能。</p></div></div>
    <div class="ops-list">
      <button type="button" class="ops-row" onclick="openAdminFrpcModal()">
        <span class="ops-row-icon">${stIcon('file')}</span>
        <span class="ops-row-copy"><b>为用户生成 frpc 配置</b><small>选择用户、添加隧道，生成并下载 frpc.toml 与部署脚本。</small></span>
        <span class="ops-row-arrow">›</span>
      </button>
      <button type="button" class="ops-row" onclick="openPwdModal()">
        <span class="ops-row-icon">${stIcon('key')}</span>
        <span class="ops-row-copy"><b>修改登录密码</b><small>修改当前管理员账号的登录密码。</small></span>
        <span class="ops-row-arrow">›</span>
      </button>
    </div>
  </section>`;
}

function adminSmtpCardHtml(smtp){
  return `<section class="card admin-smtp-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-blue">${stIcon('mail')}</span><div><h2>邮件设置</h2><p>配置 SMTP 服务器信息，用于发送通知和邮件。</p></div><span class="status-badge ${smtp.configured ? 'ok' : 'bad'}"><i></i>${smtp.configured ? '已配置' : '未配置'}</span></div>
    <form id="smtpForm" class="settings-form form-grid">
      <div><label>SMTP 服务器</label><input name="host" value="${esc(smtp.host || '')}" placeholder="smtp.gmail.com"></div>
      <div><label>端口</label><input name="port" type="number" value="${esc(smtp.port || 587)}" min="1" max="65535"></div>
      <div><label>账号</label><input name="user" value="${esc(smtp.user || '')}" placeholder="you@gmail.com"></div>
      <div><label>密码 / 应用专用密码</label><input name="password" type="password" placeholder="${smtp.password_set ? '已设置，留空不修改' : '应用专用密码'}"></div>
      <div><label>发件人地址</label><input name="from_addr" value="${esc(smtp.from_addr || '')}" placeholder="留空则用账号"></div>
      <div><label>加密方式</label><select name="ssl"><option value="0"${smtp.ssl ? '' : ' selected'}>STARTTLS（587）</option><option value="1"${smtp.ssl ? ' selected' : ''}>SSL（465）</option></select></div>
      <div class="form-actions span-2"><button type="submit">保存设置</button><button type="button" class="secondary" onclick="sendSmtpTest()">发送测试邮件</button></div>
    </form>
  </section>`;
}

function adminBackupCardHtml(r2, r2Status, r2Source){
  return `<section class="card admin-backup-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-green">${stIcon('cloud')}</span><div><h2>备份与恢复</h2><p>管理系统数据备份与恢复，支持本地和云存储。</p></div></div>
    <div class="backup-units">
      <div class="backup-unit">
        <span class="backup-unit-icon icon-blue">${stIcon('download')}</span>
        <b>下载全量备份</b>
        <p>导出数据库与前端配置文件。</p>
        <a class="btn" href="/admin/backup/full.zip">下载备份</a>
      </div>
      <div class="backup-unit">
        <span class="backup-unit-icon icon-green">${stIcon('upload')}</span>
        <b>上传备份恢复</b>
        <p>选择备份文件恢复数据。</p>
        <div class="backup-unit-action"><input id="restoreBackupFile" type="file" accept=".zip,application/zip"><button type="button" class="secondary" onclick="restoreFullBackup()">恢复备份</button></div>
      </div>
      <div class="backup-unit">
        <span class="backup-unit-icon icon-orange">${stIcon('cloudUpload')}</span>
        <b>R2 备份上传</b>
        <p>将当前全量备份上传到 Cloudflare R2。</p>
        <button type="button" class="secondary" onclick="backupToR2()">上传备份</button>
      </div>
      <div class="backup-unit">
        <span class="backup-unit-icon icon-purple">${stIcon('database')}</span>
        <b>备份配置状态</b>
        <p>${r2.configured ? 'R2 已配置，可上传云端备份。' : 'R2 未配置，仅支持本地备份。'}</p>
        <button type="button" class="secondary" onclick="loadAdminSettings()">查看状态</button>
      </div>
    </div>
    <div class="backup-summary"><span>本地备份：<b class="ok">可用</b></span><span>R2 云备份：${r2Status} · ${esc(r2Source)}</span></div>
  </section>`;
}

function adminNotifyFieldHtml(f, params){
  const val = (params && params[f.key] !== undefined && params[f.key] !== null) ? String(params[f.key]) : String(f.default || '');
  const hint = f.hint ? `<span class="muted small">${esc(f.hint)}</span>` : '';
  const req = f.required ? ' *' : '';
  if(f.type === 'select'){
    const opts = (f.options || []).map(o => `<option value="${esc(o.value)}"${String(o.value) === val ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    return `<div><label>${esc(f.label)}${req}</label><select name="${esc(f.key)}">${opts}</select>${hint}</div>`;
  }
  return `<div><label>${esc(f.label)}${req}</label><input name="${esc(f.key)}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">${hint}</div>`;
}

const NOTIFY_CHANNEL_SVG = {
  telegramBot:'<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12a12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.5.5 0 0 1 .171.325c.016.093.036.306.02.472c-.18 1.898-.962 6.502-1.36 8.627c-.168.9-.499 1.201-.82 1.23c-.696.065-1.225-.46-1.9-.902c-1.056-.693-1.653-1.124-2.678-1.8c-1.185-.78-.417-1.21.258-1.91c.177-.184 3.247-2.977 3.307-3.23c.007-.032.014-.15-.056-.212s-.174-.041-.249-.024q-.159.037-5.061 3.345q-.72.495-1.302.48c-.428-.008-1.252-.241-1.865-.44c-.752-.245-1.349-.374-1.297-.789q.04-.324.893-.663q5.247-2.286 6.998-3.014c3.332-1.386 4.025-1.627 4.476-1.635"/>',
  dingtalkBot:'<path d="M6.802 2.02a1 1 0 0 1 .849.22l9.751 8.359a2 2 0 0 1 .235 2.799l-1.06 1.272l.87.436a1 1 0 0 1 .134 1.708l-7 5a1 1 0 0 1-1.539-1.101l1.21-4.034c-2.363-.9-3.747-3.055-4.233-5.483A1 1 0 0 1 7.01 10c-.474-.703-.86-1.42-1.134-2.149c-.649-1.73-.658-3.523.23-5.298a1 1 0 0 1 .696-.533"/>',
  weWorkBot:'<path d="M12 1c6.075 0 11 4.925 11 11s-4.925 11-11 11S1 18.075 1 12S5.925 1 12 1m3.52 15.49a.35.35 0 0 0-.24.1c-.14.13-.16.34.02.53l.07.07c.44.44.74.99.85 1.57c0 .02.04.23.04.23c.05.19.15.37.29.5c.21.21.51.34.82.34c.3 0 .59-.12.8-.33c.44-.44.44-1.16 0-1.61c-.15-.15-.34-.26-.53-.3l-.15-.03c-.61-.11-1.17-.41-1.62-.86c-.03-.03-.07-.07-.1-.11c-.06-.074-.16-.1-.25-.1M11 4.75c-2.117 0-4.264.77-5.75 2.31C4.111 8.246 3.5 9.72 3.5 11.24c0 1.06.3 2.12.88 3.06c.47.695.993 1.371 1.66 1.89l-.384 1.624a.6.6 0 0 0 .856.673L8.64 17.41c.53.166 1.08.234 1.63.3a8.3 8.3 0 0 0 1.7-.03l.38-.05q.283-.046.564-.112a2.33 2.33 0 0 1-.92-1.605l-.254.037c-.62.067-1.232.03-1.85-.04c-.43-.057-.838-.185-1.25-.31l-1.02.5l.23-.67l-.74-.6c-.513-.401-.917-.934-1.28-1.47c-.4-.65-.61-1.38-.61-2.11c0-1.08.456-2.119 1.26-2.97c1.158-1.198 2.854-1.78 4.5-1.78c1.54 0 3.108.513 4.24 1.58c.365.365.707.75.95 1.21c.177.354.338.722.424 1.107a2.34 2.34 0 0 1 1.811.123c-.075-.716-.33-1.4-.665-2.04c-.329-.62-.776-1.155-1.27-1.65c-1.468-1.38-3.471-2.08-5.47-2.08m9.37 9.77a1.136 1.136 0 0 0-1.1.86l-.03.15a3.1 3.1 0 0 1-.86 1.63c-.04.03-.07.07-.11.1c-.14.13-.14.35 0 .49c.07.06.17.1.26.1h.01c.07 0 .15-.02.26-.13l.07-.07c.44-.44.99-.74 1.57-.85c.023 0 .227-.04.23-.04c.2-.06.37-.16.5-.3c.44-.44.44-1.17 0-1.61c-.21-.21-.5-.33-.8-.33m-4.21-1.07c-.08 0-.16.03-.27.14l-.07.07c-.44.44-.99.74-1.57.85c-.02 0-.23.04-.23.04c-.2.06-.37.16-.5.3c-.44.44-.44 1.17 0 1.61c.21.21.51.34.82.34c.3 0 .59-.12.8-.33c.15-.16.25-.34.29-.53a.4.4 0 0 0 .03-.16c.11-.61.41-1.18.86-1.63c.03-.03.06-.06.1-.09c.146-.115.13-.36 0-.49a.34.34 0 0 0-.26-.12m1.18-1.97c-.3 0-.59.12-.8.33c-.44.44-.44 1.16 0 1.61c.15.15.34.26.53.3c.054.006.144.029.15.03c.61.12 1.17.41 1.62.86c.03.03.07.07.1.11c.08.08.16.1.25.1c.1 0 .16-.04.23-.11c.12-.13.14-.32-.02-.52l-.08-.08c-.44-.44-.74-.99-.85-1.57c0-.02-.04-.23-.04-.23c-.05-.19-.15-.37-.29-.5c-.21-.21-.5-.33-.8-.33"/>',
  weWorkApp:'<path d="M12 1c6.075 0 11 4.925 11 11s-4.925 11-11 11S1 18.075 1 12S5.925 1 12 1m3.52 15.49a.35.35 0 0 0-.24.1c-.14.13-.16.34.02.53l.07.07c.44.44.74.99.85 1.57c0 .02.04.23.04.23c.05.19.15.37.29.5c.21.21.51.34.82.34c.3 0 .59-.12.8-.33c.44-.44.44-1.16 0-1.61c-.15-.15-.34-.26-.53-.3l-.15-.03c-.61-.11-1.17-.41-1.62-.86c-.03-.03-.07-.07-.1-.11c-.06-.074-.16-.1-.25-.1M11 4.75c-2.117 0-4.264.77-5.75 2.31C4.111 8.246 3.5 9.72 3.5 11.24c0 1.06.3 2.12.88 3.06c.47.695.993 1.371 1.66 1.89l-.384 1.624a.6.6 0 0 0 .856.673L8.64 17.41c.53.166 1.08.234 1.63.3a8.3 8.3 0 0 0 1.7-.03l.38-.05q.283-.046.564-.112a2.33 2.33 0 0 1-.92-1.605l-.254.037c-.62.067-1.232.03-1.85-.04c-.43-.057-.838-.185-1.25-.31l-1.02.5l.23-.67l-.74-.6c-.513-.401-.917-.934-1.28-1.47c-.4-.65-.61-1.38-.61-2.11c0-1.08.456-2.119 1.26-2.97c1.158-1.198 2.854-1.78 4.5-1.78c1.54 0 3.108.513 4.24 1.58c.365.365.707.75.95 1.21c.177.354.338.722.424 1.107a2.34 2.34 0 0 1 1.811.123c-.075-.716-.33-1.4-.665-2.04c-.329-.62-.776-1.155-1.27-1.65c-1.468-1.38-3.471-2.08-5.47-2.08m9.37 9.77a1.136 1.136 0 0 0-1.1.86l-.03.15a3.1 3.1 0 0 1-.86 1.63c-.04.03-.07.07-.11.1c-.14.13-.14.35 0 .49c.07.06.17.1.26.1h.01c.07 0 .15-.02.26-.13l.07-.07c.44-.44.99-.74 1.57-.85c.023 0 .227-.04.23-.04c.2-.06.37-.16.5-.3c.44-.44.44-1.17 0-1.61c-.21-.21-.5-.33-.8-.33m-4.21-1.07c-.08 0-.16.03-.27.14l-.07.07c-.44.44-.99.74-1.57.85c-.02 0-.23.04-.23.04c-.2.06-.37.16-.5.3c-.44.44-.44 1.17 0 1.61c.21.21.51.34.82.34c.3 0 .59-.12.8-.33c.15-.16.25-.34.29-.53a.4.4 0 0 0 .03-.16c.11-.61.41-1.18.86-1.63c.03-.03.06-.06.1-.09c.146-.115.13-.36 0-.49a.34.34 0 0 0-.26-.12m1.18-1.97c-.3 0-.59.12-.8.33c-.44.44-.44 1.16 0 1.61c.15.15.34.26.53.3c.054.006.144.029.15.03c.61.12 1.17.41 1.62.86c.03.03.07.07.1.11c.08.08.16.1.25.1c.1 0 .16-.04.23-.11c.12-.13.14-.32-.02-.52l-.08-.08c-.44-.44-.74-.99-.85-1.57c0-.02-.04-.23-.04-.23c-.05-.19-.15-.37-.29-.5c-.21-.21-.5-.33-.8-.33"/>',
  chat:'<path d="m13.44 8.927l-.889.37l.056.117a.6.6 0 0 1 .212-.054q.076.001.126.046q.05.042.072.16q.022.119.022.634v2.736q0 .284-.042.381a.3.3 0 0 1-.118.142q-.079.046-.286.045v.12h1.481v-.12q-.231 0-.32-.048a.3.3 0 0 1-.126-.142q-.04-.09-.04-.378V8.927zm-11.722.34q-.494 0-.84.147q-.35.15-.534.436a1.1 1.1 0 0 0-.185.612q0 .508.393.864q.276.252.968.422q.537.135.688.191a.7.7 0 0 1 .31.183q.087.106.088.259q0 .232-.21.41q-.212.175-.628.176q-.393 0-.625-.197q-.23-.199-.307-.619L0 12.23q.084.72.517 1.096q.434.378 1.244.378q.556-.002.93-.156a1.26 1.26 0 0 0 .781-1.169a1.3 1.3 0 0 0-.171-.684a1.2 1.2 0 0 0-.472-.437q-.3-.16-.927-.31q-.628-.147-.79-.286a.326.326 0 0 1 .009-.524q.21-.157.586-.156q.361 0 .542.145q.181.147.237.471l.864-.028q-.019-.591-.425-.949q-.407-.353-1.208-.353zm21.808.33a.475.475 0 1 0-.002.95a.475.475 0 0 0 .002-.95m0 .072a.4.4 0 0 1 .401.403c0 .116-.05.22-.128.294l-.086-.135a.4.4 0 0 0-.065-.078a.2.2 0 0 0-.048-.03a.2.2 0 0 0 .127-.057a.14.14 0 0 0 .043-.109a.2.2 0 0 0-.025-.091a.13.13 0 0 0-.067-.055a.3.3 0 0 0-.123-.02h-.266v.606h.08v-.268h.091q.03 0 .045.003q.02.005.036.014q.018.014.04.043q.023.03.059.083l.08.125h.043a.4.4 0 0 1-.237.08a.405.405 0 0 1-.404-.405c0-.224.18-.403.404-.403m-.157.191h.191q.067 0 .097.027a.1.1 0 0 1 .03.07a.1.1 0 0 1-.016.055a.08.08 0 0 1-.047.035a.2.2 0 0 1-.085.013h-.17zm-15.037.6q-.616-.001-1.023.514v-.455h-.754v3.105h.814v-1.401q0-.52.063-.713a.6.6 0 0 1 .234-.306a.67.67 0 0 1 .385-.118q.167 0 .287.082q.119.08.17.229q.055.148.054.646v1.581h.816V11.7a2.5 2.5 0 0 0-.046-.55a.9.9 0 0 0-.16-.343a.83.83 0 0 0-.341-.25a1.3 1.3 0 0 0-.499-.097m2.65 0a1.7 1.7 0 0 0-.826.2a1.4 1.4 0 0 0-.571.586a1.7 1.7 0 0 0-.202.793q0 .534.202.904q.201.374.588.566q.388.194.814.194q.69-.001 1.144-.463q.455-.464.455-1.167q0-.697-.451-1.156q-.449-.457-1.154-.457zm7.315.05q-.527 0-.865.323a1.02 1.02 0 0 0-.336.77q0 .29.147.534c.1.162.24.285.423.379q-.334.281-.429.44a.55.55 0 0 0-.092.271q0 .102.071.184t.24.187a10 10 0 0 0-.329.355c-.113.145-.19.253-.226.336a.4.4 0 0 0-.034.157q0 .178.246.343q.437.284 1.071.284q.825 0 1.337-.477q.349-.326.35-.694a.6.6 0 0 0-.183-.45a.84.84 0 0 0-.49-.227a9 9 0 0 0-.878-.053a4 4 0 0 1-.46-.027q-.159-.023-.212-.075q-.056-.054-.056-.112a.4.4 0 0 1 .05-.159a.9.9 0 0 1 .186-.221q.234.072.459.07q.54 0 .864-.301a.96.96 0 0 0 .323-.722q0-.37-.187-.61h.394c.097 0 .15-.002.167-.01a.06.06 0 0 0 .035-.025a.3.3 0 0 0 .018-.12a.2.2 0 0 0-.02-.105a.1.1 0 0 0-.033-.028a1 1 0 0 0-.166-.008h-.639a1.3 1.3 0 0 0-.746-.21zm-2.752 0q-.378 0-.714.194a1.44 1.44 0 0 0-.546.61a1.8 1.8 0 0 0-.205.825q0 .571.34 1.03a1.29 1.29 0 0 0 1.09.543q.419 0 .76-.211q.344-.21.54-.627q.194-.414.194-.821q0-.577-.354-1.022a1.34 1.34 0 0 0-1.105-.522zm-12.182.009l1.174 3.113a1.2 1.2 0 0 1-.21.431q-.135.168-.419.167q-.154 0-.344-.04l.067.645q.228.05.464.052q.232-.001.418-.052a1 1 0 0 0 .31-.138a.9.9 0 0 0 .224-.234a2.2 2.2 0 0 0 .205-.414l.199-.545l1.085-2.985h-.844l-.722 2.204l-.74-2.204zm16.631.078v.122a.8.8 0 0 1 .245.091q.052.043.136.157q.108.152.158.255l1.088 2.275l-.213.526q-.119.292-.236.393q-.118.103-.217.104a1 1 0 0 1-.167-.05a1 1 0 0 0-.3-.07c-.105 0-.19.025-.25.084a.3.3 0 0 0-.092.22q0 .146.126.257a.46.46 0 0 0 .322.112q.27.002.56-.223q.29-.224.469-.664l1.226-3.014a1.6 1.6 0 0 1 .113-.254a.6.6 0 0 1 .145-.146a.5.5 0 0 1 .188-.053v-.122h-.978v.122q.14 0 .197.023a.17.17 0 0 1 .083.057a.15.15 0 0 1 .023.087q0 .136-.056.271l-.675 1.671l-.737-1.53q-.11-.225-.11-.356a.21.21 0 0 1 .074-.16a.35.35 0 0 1 .224-.063h.068v-.122zm-1.753.08q.26.001.43.217q.224.293.224.815q0 .398-.16.584a.52.52 0 0 1-.41.188a.53.53 0 0 1-.43-.216q-.223-.286-.223-.802c0-.268.054-.461.163-.59a.52.52 0 0 1 .406-.197zm-2.798.054q.362-.002.598.312q.346.46.346 1.263q0 .643-.209.905a.65.65 0 0 1-.528.264q-.429-.002-.691-.477c-.174-.32-.263-.695-.263-1.135q0-.406.11-.669a.73.73 0 0 1 .285-.361a.67.67 0 0 1 .352-.102m-4.463.395q.323.001.543.247q.216.244.216.703q0 .468-.216.712a.7.7 0 0 1-.543.248a.7.7 0 0 1-.542-.248q-.22-.242-.22-.708q0-.463.22-.707a.7.7 0 0 1 .542-.247m6.66 2.498q.398.056 1.142.08q.51.01.68.083t.17.241q0 .235-.282.442q-.284.208-.874.208q-.622-.001-.951-.204q-.191-.115-.19-.277c0-.078.024-.169.076-.26a1.5 1.5 0 0 1 .228-.313z"/>',
  ntfy:'<path d="M12.597 13.693v2.156h6.205v-2.156ZM5.183 6.549v2.363l3.591 1.901l.023.01l-.023.009l-3.591 1.901v2.35l.386-.211l5.456-2.969V9.729ZM3.659 2.037C1.915 2.037.42 3.41.42 5.154v.002L.438 18.73L0 21.963l5.956-1.583h14.806c1.744 0 3.238-1.374 3.238-3.118V5.154c0-1.744-1.493-3.116-3.237-3.117h-.001zm0 2.2h17.104c.613.001 1.037.447 1.037.917v12.108c0 .47-.424.916-1.038.916H5.633l-3.026.915l.031-.179l-.017-13.76c0-.47.424-.917 1.038-.917"/>',
  goCqHttpBot:'<path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673c.54.065 2.103-2.472 2.103-2.472c0 1.469.756 3.387 2.394 4.771c-.612.188-1.363.479-1.845.835c-.434.32-.379.646-.301.778c.343.578 5.883.369 7.482.189c1.6.18 7.14.389 7.483-.189c.078-.132.132-.458-.301-.778c-.483-.356-1.233-.646-1.846-.836c1.637-1.384 2.393-3.302 2.393-4.771c0 0 1.563 2.537 2.103 2.472c.251-.03.581-1.39-.438-4.673"/>',
};
const NOTIFY_LINK_ICON = '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>';
function adminNotifyCardHtml(notify){
  const n = notify || {};
  const yn = (v, d) => (v === undefined || v === null ? d : !!v);
  const channels = n.channels || [];
  const cur = n.type || '';
  const params = n.params || {};
  const curCh = channels.find(c => c.type === cur);
  const ready = !!(curCh && (curCh.fields || []).filter(f => f.required).every(f => String(params[f.key] || '').trim() !== ''));
  const primaryOrder = ['telegramBot','dingtalkBot','lark','bark','weWorkApp'];
  const byType = {};
  channels.forEach(c => { byType[c.type] = c; });
  const chipHtml = c => {
    const svg = NOTIFY_CHANNEL_SVG[c.type];
    const inner = svg ? `<svg viewBox="0 0 24 24" class="chip-svg">${svg}</svg>`
                      : `<svg viewBox="0 0 24 24" class="chip-svg chip-svg-link">${NOTIFY_LINK_ICON}</svg>`;
    return `<button type="button" class="notify-chip${c.type === cur ? ' active' : ''}" data-channel="${esc(c.type)}" data-name="${esc(c.name)}" onclick="openNotifyConfig('${esc(c.type)}')"><span class="chip-ico">${inner}</span>${esc(c.name)}</button>`;
  };
  const chips = primaryOrder.filter(t => byType[t]).map(t => chipHtml(byType[t]))
    .concat(channels.filter(c => !primaryOrder.includes(c.type)).map(chipHtml)).join('');
  const groups = channels.map(c => {
    const inner = (c.fields || []).map(f => adminNotifyFieldHtml(f, n.params || {})).join('');
    return `<div class="notify-channel-fields" data-channel="${esc(c.type)}" style="display:${c.type === cur ? 'grid' : 'none'}">${inner}</div>`;
  }).join('');
  return `<section class="card admin-notify-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-blue">${stIcon('bell')}</span><div><h2>通知设置</h2><p>配置系统通知规则和渠道，及时获取异常信息。</p></div><span class="status-badge ${ready ? 'ok' : 'bad'}"><i></i>${ready ? '已配置' : '未配置'}</span></div>
    <form id="notifyForm" class="settings-form">
      <div class="notify-row notify-row-duo">
        <div class="notify-cell"><div class="notify-row-label"><label>通知开关</label></div><div class="notify-row-control"><label class="switch"><input type="checkbox" name="enabled" value="1"${n.enabled ? ' checked' : ''} onchange="syncNotifySwitch(this)"><span class="switch-track"><span class="switch-thumb"></span></span></label><span class="switch-state" id="notifySwitchState">${n.enabled ? '已开启' : '已关闭'}</span></div></div>
        <div class="notify-cell"><div class="notify-row-label"><label>冷却时间</label></div><div class="notify-row-control"><input name="cooldown_minutes" type="number" min="0" max="1440" value="${esc(n.cooldown_minutes ?? 30)}"><span class="unit">分钟</span></div></div>
      </div>
      <div class="notify-row">
        <div class="notify-row-label"><label>通知场景</label></div>
        <div class="notify-row-control"><label class="check"><input type="checkbox" name="on_down" value="1"${yn(n.on_down, true) ? ' checked' : ''}> 节点异常</label><label class="check"><input type="checkbox" name="on_up" value="1"${yn(n.on_up, true) ? ' checked' : ''}> 节点恢复</label></div>
      </div>
      <div class="notify-row notify-row-block">
        <div class="notify-row-label"><label>通知渠道</label></div>
        <div class="notify-chips">${chips}</div>
      </div>
      <input type="hidden" name="notify_type" id="notifyTypeSelect" value="${esc(cur)}">
      <div class="form-actions"><button type="submit">保存设置</button><button type="button" class="secondary" onclick="sendNotifyTest()">发送测试通知</button></div>
      <div id="notifyConfigModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="notifyConfigTitle" onclick="if(event.target===this)closeNotifyConfig()">
        <section class="modal-page card notify-config-modal">
          <div class="section-title modal-title"><div><h2 id="notifyConfigTitle">渠道配置</h2><p>填写所选渠道的参数，点「保存设置」后生效。</p></div><button type="button" class="secondary modal-close" onclick="closeNotifyConfig()">关闭 ×</button></div>
          <div class="notify-config">${groups}</div>
          <div class="form-actions"><button type="button" onclick="closeNotifyConfig()">完成</button></div>
        </section>
      </div>
    </form>
  </section>`;
}

function adminR2CardHtml(r2, r2Status, r2Source){
  return `<section class="card admin-r2-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-orange">${stIcon('bucket')}</span><div><h2>Cloudflare R2 备份配置</h2><p>配置 R2 存储桶信息，用于备份数据。</p></div><span class="status-badge ${r2.configured ? 'ok' : 'bad'}"><i></i>${r2.configured ? '已配置' : '未配置'}</span></div>
    <form id="r2ConfigForm" class="settings-form r2-form-grid">
      <div class="r2-field"><label>Account ID</label><input name="account_id" value="${esc(r2.account_id || '')}" placeholder="Cloudflare Account ID"></div>
      <div class="r2-field"><label>Access Key ID</label><input name="access_key_id" value="${esc(r2.access_key_id || '')}" placeholder="R2 API Token Access Key ID"></div>
      <div class="r2-field"><label>Secret Access Key</label><input name="secret_access_key" type="password" placeholder="${r2.secret_set ? '已设置，留空则不修改' : 'R2 Secret Access Key'}"></div>
      <div class="r2-field r2-field-half"><label>Bucket</label><input name="bucket" value="${esc(r2.bucket || '')}" placeholder="bucket-name"></div>
      <div class="r2-field r2-field-half"><label>备份目录 Prefix</label><input name="prefix" value="${esc(r2.prefix || 'frp-manager-lite/backups')}" placeholder="frp-manager-lite/backups"></div>
      <div class="form-actions r2-actions"><button type="submit">保存配置</button></div>
    </form>
    <p class="settings-hint">配置保存在本面板数据库中；Secret 不会明文回显。已有环境变量配置仍可作为兼容兜底。</p>
  </section>`;
}

function adminFrpcModalHtml(frpcUserOptions){
  return `<div id="adminFrpcModal" class="modal-backdrop${adminFrpcModalOpen ? '' : ' hidden'}" role="dialog" aria-modal="true" aria-labelledby="adminFrpcModalTitle">
      <section class="modal-page card admin-frpc-modal">
        <div class="section-title modal-title"><div><h2 id="adminFrpcModalTitle">为用户配置并下载 frpc</h2><p>选择普通用户，可一次添加多条隧道；TCP/UDP 公网端口从该用户已分配端口中选择。</p></div><button type="button" class="secondary modal-close" onclick="closeAdminFrpcModal()" aria-label="关闭 frpc 配置">关闭 ×</button></div>
        ${frpcUserOptions ? `<form id="adminFrpcForm">
          <div class="grid"><div><label>用户</label><select name="user_id" required onchange="saveAdminFrpcDraft(); renderAdminFrpcRows(); renderAdminDeployScriptAddress();">${frpcUserOptions}</select></div></div>
          <div id="adminDeployScriptAddress">${adminDeployScriptAddressHtml()}</div>
          <div id="adminFrpcRows" class="admin-frpc-rows"></div>
          <div class="form-actions"><button>创建隧道并下载</button><button type="button" class="secondary" onclick="addAdminFrpcRow()">添加一条隧道</button><button type="button" class="secondary" onclick="downloadAdminFrpcOnly()">只下载现有配置</button></div>
        </form>` : '<p class="muted">暂无普通用户，先创建用户后再下载 frpc 配置。</p>'}
      </section>
    </div>`;
}

function selectNotifyChannel(type){
  type = type || '';
  const sel = document.querySelector('#notifyTypeSelect');
  if(sel) sel.value = type;
  const form = document.querySelector('#notifyForm');
  if(!form) return;
  let activeName = '';
  form.querySelectorAll('.notify-chip[data-channel]').forEach(c => {
    const on = (c.dataset.channel || '') === type;
    c.classList.toggle('active', on);
    if(on) activeName = c.dataset.name || '';
  });
  form.querySelectorAll('.notify-channel-fields').forEach(g => { g.style.display = (g.dataset.channel === type) ? 'grid' : 'none'; });
  const title = document.querySelector('#notifyConfigTitle');
  if(title) title.textContent = activeName ? (activeName + ' 配置') : '渠道配置';
}
function openNotifyConfig(type){
  selectNotifyChannel(type);
  const modal = document.querySelector('#notifyConfigModal');
  if(modal) modal.classList.remove('hidden');
}
function closeNotifyConfig(){
  const modal = document.querySelector('#notifyConfigModal');
  if(modal) modal.classList.add('hidden');
}
function syncNotifySwitch(el){
  const s = document.querySelector('#notifySwitchState');
  if(s) s.textContent = (el && el.checked) ? '已开启' : '已关闭';
}

function wireAdminSettingsForms(){
  const r2Form = document.querySelector('#r2ConfigForm');
  if(r2Form) r2Form.onsubmit = saveR2Config;
  const smtpForm = document.querySelector('#smtpForm');
  if(smtpForm){
    smtpForm.onsubmit = async (e) => {
      e.preventDefault();
      try{
        const r = await api('/api/admin/smtp-config', {method:'POST', body:Object.fromEntries(new FormData(e.target))});
        await reloadAdminCurrentPage();
        show(r.message || '邮件设置已保存');
      }catch(err){ show(err.message, true); }
    };
  }
  const notifyForm = document.querySelector('#notifyForm');
  if(notifyForm){
    const typeSel = document.querySelector('#notifyTypeSelect');
    selectNotifyChannel(typeSel ? typeSel.value : '');
    notifyForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const type = fd.get('notify_type') || '';
      const params = {};
      const group = notifyForm.querySelector(`.notify-channel-fields[data-channel="${type}"]`);
      if(group){
        group.querySelectorAll('input,select,textarea').forEach(el => { if(el.name) params[el.name] = el.value; });
      }
      const body = {
        enabled: fd.get('enabled') ? '1' : '0',
        on_down: fd.get('on_down') ? '1' : '0',
        on_up: fd.get('on_up') ? '1' : '0',
        cooldown_minutes: fd.get('cooldown_minutes'),
        type,
        params,
      };
      try{
        const r = await api('/api/admin/notify-config', {method:'POST', body});
        await reloadAdminCurrentPage();
        show(r.message || '通知设置已保存');
      }catch(err){ show(err.message, true); }
    };
  }
  const adminFrpcForm = document.querySelector('#adminFrpcForm');
  if(adminFrpcForm){ adminFrpcForm.onsubmit = submitAdminFrpc; renderAdminDeployScriptAddress(); renderAdminFrpcRows(); }
  const pwdForm = document.querySelector('#pwdForm');
  if(pwdForm){ pwdForm.onsubmit = (e) => { e.preventDefault(); submitPasswordChange(pwdForm, () => closePwdModal()); }; }
}

async function loadAdminSettings(){
  hideFlash();
  clearAdminDashboardTimer();
  adminCurrentPage = 'settings';
  setNav();
  let data;
  try{ data = await api('/api/admin/dashboard'); }
  catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    show(err.message, true);
    return;
  }
  const smtp = data.smtp || {}; adminSmtp = smtp;
  const notify = data.notify || {};
  setPanelMeta(data);
  const r2 = data.r2 || {};
  const r2Source = r2.source === 'database' ? '面板配置' : (r2.source === 'env' ? '环境变量兼容' : '未配置');
  const r2Status = r2.configured ? '<span class="ok">已配置</span>' : '<span class="bad">未配置</span>';
  const frpcUsers = data.frpc_users || [];
  adminFrpcUsers = frpcUsers;
  window.adminProxyTypeOptions = data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux'];
  const frpcUserOptions = frpcUsers.map(u => `<option value="${u.id}">${esc(u.username)} · ${esc(u.node_region || '-')} / ${esc(u.node_name || '-')} · 端口 ${u.port_count || 0} · 可用 ${(u.available_ports || []).length} · 隧道 ${u.tunnel_count || 0}</option>`).join('');
  app.innerHTML = appLayoutHtml(`
    <div class="admin-settings-grid">
      <div class="admin-settings-col">${adminNotifyCardHtml(notify)}${adminBackupCardHtml(r2, r2Status, r2Source)}</div>
      <div class="admin-settings-col">${adminSmtpCardHtml(smtp)}${adminOpsCardHtml()}${adminR2CardHtml(r2, r2Status, r2Source)}</div>
    </div>
    ${adminFrpcModalHtml(frpcUserOptions)}
    ${adminPwdModalHtml()}
  `, 'admin-settings', '管理员设置');
  wireAdminSettingsForms();
}

async function loadAdminDashboard(auto=false){
  hideFlash();
  clearAdminDashboardTimer();
  adminCurrentPage = 'dashboard';
  let data;
  try{ data = await api('/api/admin/dashboard'); }
  catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    if(!auto) show(err.message, true);
    return;
  }
  setNav();
  setPanelMeta(data);
  const refreshSeconds = Math.max(10, Number(data.refresh_seconds || 30));
  const portStats = data.port_stats || {};
  const userStats = data.user_stats || {};
  const host = data.host || {};
  const smtp = data.smtp || {}; adminSmtp = smtp;
  const r2 = data.r2 || {};
  const usedPorts = Number(portStats.used || 0);
  const totalPorts = Number(portStats.total || 0);
  const freePorts = Number(portStats.free || Math.max(0, totalPorts - usedPorts));
  const portUsage = totalPorts > 0 ? ((usedPorts / totalPorts) * 100).toFixed(1) : '0.0';
  const r2Source = r2.source === 'database' ? '面板配置' : (r2.source === 'env' ? '环境变量兼容' : '未配置');
  const r2Status = r2.configured ? '<span class="ok">已配置</span>' : '<span class="bad">未配置</span>';
  const frpcUsers = data.frpc_users || [];
  adminFrpcUsers = frpcUsers;
  window.adminProxyTypeOptions = data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux'];
  const frpcUserOptions = frpcUsers.map(u => `<option value="${u.id}">${esc(u.username)} · ${esc(u.node_region || '-')} / ${esc(u.node_name || '-')} · 端口 ${u.port_count || 0} · 可用 ${(u.available_ports || []).length} · 隧道 ${u.tunnel_count || 0}</option>`).join('');
  const proxyTypeOptions = (data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux']).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  const hostCpu = host.cpu_percent == null ? null : Number(host.cpu_percent);
  const hostMem = host.memory_percent == null ? null : Number(host.memory_percent);
  const hostCpuLabel = hostCpu == null ? '—' : hostCpu + '%';
  const hostMemLabel = hostMem == null ? '—' : hostMem + '%';
  const hostHistory = Array.isArray(host.history) ? host.history : [];
  const hostSampleSeconds = Math.max(5, Number(host.sample_seconds || 30));
  const hostSamplePoints = Math.max(6, Number(host.sample_points || 60));
  const nodeRows = (data.nodes || []).map(n => {
    const ok = !!n.auth_port_ok;
    const latency = n.auth_latency_ms == null ? '—' : `${n.auth_latency_ms} ms`;
    const latencyEl = `<b data-latency-node="${esc(n.server_addr || '')}">${esc(latency)}</b>`;
    const statusText = ok ? '在线' : (n.active ? '不可达' : '已停用');
    const portText = `端口 ${Number(n.port_count || 0)} / 空闲 ${Number(n.free_count || 0)}`;
    return `<div class="admin-node-row"><span class="admin-node-dot ${ok ? 'ok' : 'bad'}" title="${esc(n.auth_message || statusText)}"></span><div class="admin-node-copy"><strong>${esc(n.name || '-')}</strong><small>${esc(n.server_addr || '-')}:${esc(n.server_port ?? '-')}</small></div><div class="admin-node-meta">${latencyEl}<small>${esc(statusText)} · ${esc(portText)}</small></div></div>`;
  }).join('') || '<div class="empty-state"><strong>还没有节点</strong><p class="muted small">先去「节点管理」添加一个 frps 节点。</p></div>';
  app.innerHTML = appLayoutHtml(`

    <div class="workspace-stats user-overview-stats admin-overview-stats">
      <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><span class="overview-stat-icon">${QICON_TRAFFIC}</span><div class="overview-stat-copy"><span>总流量</span><strong>${fmtBytes(data.traffic_today)}</strong><small>今日全平台 · 所有用户</small></div></div></section>
      <section class="workspace-stat highlight overview-icon-stat"><div class="overview-stat-main"><span class="overview-stat-icon">${QICON_VERSION}</span><div class="overview-stat-copy"><span>面板版本</span><strong>${esc(data.panel_version || data.version || '-')}</strong><small>frp-manager-lite</small></div></div></section>
      <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><span class="overview-stat-icon">${QICON_SERVER}</span><div class="overview-stat-copy"><span>节点在线</span><strong>${data.active_node_count}/${data.node_count}</strong><small>每 ${refreshSeconds} 秒检查认证端口</small></div></div></section>
      <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><span class="overview-stat-icon">${QICON_PORT}</span><div class="overview-stat-copy"><span>端口使用率</span><strong>${portUsage}%</strong><small>已用 ${usedPorts} · 空闲 ${freePorts} · 共 ${totalPorts}</small></div></div><div class="tunnel-usage"><div class="tunnel-usage-label"><span>端口池</span><b>${portUsage}%</b></div><div class="tunnel-usage-track" role="progressbar" aria-label="端口使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${portUsage}"><span style="width:${portUsage}%"></span></div></div></section>
      <section class="workspace-stat overview-icon-stat"><div class="overview-stat-main"><span class="overview-stat-icon">${QICON_USER}</span><div class="overview-stat-copy"><span>用户</span><strong>${userStats.active}/${userStats.total}</strong><small>活跃用户 / 总用户</small></div></div></section>
    </div>

    <div class="admin-dashboard-grid">
      <section class="card admin-host-card">
        <div class="section-title"><div><div class="section-kicker">HOST RESOURCES</div><h2>${stIcon('cpu')}主机资源</h2></div><span class="status-badge ${hostCpu == null ? '' : 'ok'}"><i></i>运行中</span></div>
        <div class="host-charts">
          ${hostChartPanelHtml(hostHistory, 'cpu', '#3478f6', 'hostGradCpu', 'CPU 使用率', hostCpuLabel, `${host.cpu_count || 0} 核 · 负载 ${host.load1 ?? '-'} / ${host.load5 ?? '-'} / ${host.load15 ?? '-'}`)}
          ${hostChartPanelHtml(hostHistory, 'mem', '#9353f9', 'hostGradMem', '内存使用率', hostMemLabel, `${fmtBytes(host.memory_used)} / ${fmtBytes(host.memory_total)} · 可用 ${fmtBytes(host.memory_available)}`)}
        </div>
        <div class="host-meta-row"><div><span>节点在线</span><b>${data.active_node_count}/${data.node_count}</b></div><div><span>自动检查</span><b>每 ${refreshSeconds} 秒</b></div><div><span>资源采样</span><b>每 ${hostSampleSeconds} 秒 · 保留 ${hostSamplePoints} 点</b></div></div>
      </section>

      <section class="card quick-actions-card">
        <div class="section-title"><div><div class="section-kicker">QUICK ACTIONS</div><h2>${stIcon('bolt')}快捷操作</h2></div></div>
        <div class="quick-actions-grid">
          <button class="quick-action" onclick="loadAdmin('users')"><span class="quick-action-icon">${QICON_USER}</span><b>用户管理</b><small>账号与到期</small></button>
          <button class="quick-action" onclick="loadAdmin('keys')"><span class="quick-action-icon">${QICON_KEY}</span><b>注册密钥</b><small>邀请注册</small></button>
          <button class="quick-action" onclick="loadAdmin('nodes')"><span class="quick-action-icon">${QICON_NODE}</span><b>节点管理</b><small>frps 接入</small></button>
          <button class="quick-action" onclick="loadAdmin('health')"><span class="quick-action-icon">${QICON_SERVER}</span><b>节点健康</b><small>连通性检查</small></button>
          <button class="quick-action" onclick="loadAdminProxies()"><span class="quick-action-icon">${QICON_TUNNEL}</span><b>映射监控</b><small>隧道状态</small></button>
          <button class="quick-action" onclick="loadAdmin('risk')"><span class="quick-action-icon">${QICON_RISK}</span><b>风控审计</b><small>登录与封禁</small></button>
          <button class="quick-action" onclick="loadAdminSettings()"><span class="quick-action-icon">${QICON_SETTINGS}</span><b>设置</b><small>运维 · 邮件 · 备份</small></button>
        </div>
      </section>

      <section class="card admin-nodes-card">
        <div class="section-title"><div><div class="section-kicker">NODES</div><h2>${stIcon('node')}节点状态</h2></div><span class="section-count">${data.active_node_count}/${data.node_count} 在线</span></div>
        <div class="admin-node-list">${nodeRows}</div>
      </section>

      <section class="card admin-biz-card">
        <div class="section-title"><div><div class="section-kicker">BUSINESS</div><h2>${stIcon('chart')}业务概况</h2></div></div>
        <div class="admin-biz-list">
          <div><span>隧道总数</span><b>${data.tunnel_count || 0}</b></div>
          <div><span>普通用户</span><b>${userStats.total || 0}</b></div>
          <div><span>注册密钥</span><b>${data.invite_key_count || 0}</b></div>
          <div><span>封禁记录</span><b>${data.ban_count || 0}</b></div>
        </div>
      </section>
    </div>
    `, 'admin-dashboard', '运行总览');
  adminHostHistory = hostHistory;
  renderHostCharts();
  fillNodeLatencies();
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
function openPortsModal(){ const m = document.getElementById('portsModal'); if(m) m.classList.remove('hidden'); }
function closePortsModal(){ document.getElementById('portsModal')?.classList.add('hidden'); }
function showLegalNotice(){ const m = document.getElementById('legalNoticeModal'); if(m) m.classList.remove('hidden'); }
function closeLegalNotice(){ document.getElementById('legalNoticeModal')?.classList.add('hidden'); }
document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closePortsModal(); });
function initUserEmailForm(){
  const form = document.querySelector('#userEmailForm');
  if(!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = String(new FormData(form).get('email') || '').trim();
    try{
      const r = await api('/api/user/email', {method:'POST', body:{email}});
      await loadDashboard('profile');
      show(r.message || '邮箱已更新');
    }catch(err){ show(err.message, true); }
  };
}

function initRenewForm(){
  const form = document.querySelector('#renewForm');
  if(!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const box = document.querySelector('#renewResult');
    const key = String(new FormData(form).get('key') || '').trim();
    if(!key){ if(box){ box.className = 'renew-result error'; box.textContent = '请输入续期密钥'; } return; }
    const btn = form.querySelector('button');
    if(btn) btn.disabled = true;
    try{
      const r = await api('/api/user/renew', {method:'POST', body:{key}});
      if(box){ box.className = 'renew-result ok'; box.textContent = r.message || '续期成功'; }
      await loadDashboard('profile');
      show(r.message || '续期成功');
    }catch(err){
      if(box){ box.className = 'renew-result error'; box.textContent = err.message || '续期失败'; }
    }finally{
      if(btn) btn.disabled = false;
    }
  };
}
let currentDashboardNodeId=null;
async function switchDashboardNode(nodeId){
  if(!nodeId||String(nodeId)===String(currentDashboardNodeId)){closeNodeSwitch();return;}
  if(!confirm('确定切换接入节点？已有隧道不会自动迁移，切换前请确认目标节点资源。'))return;
  try{
    await api('/api/user/node/switch',{method:'POST',body:{node_id:nodeId}});
    closeNodeSwitch();
    await loadDashboard();
    show('接入节点已切换，建议重新下载 frpc 配置。');
  }catch(err){show(err.message,true);}
}
