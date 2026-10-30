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

/* ---- 统一的应用内弹窗（替代浏览器 confirm/prompt/alert）---- */
function appDialog(opts){
  return new Promise(resolve => {
    const id = 'appDialogModal';
    const old = document.getElementById(id);
    if(old) old.remove();
    const inputHtml = opts.input
      ? `<div class="input-group"><label class="input-label">${esc(opts.inputLabel || '')}</label><input id="appDialogInput" class="input-ios" value="${esc(opts.inputValue || '')}"></div>`
      : '';
    const cancelBtn = opts.cancelText === null ? '' : `<button type="button" class="secondary" id="appDialogCancel">${esc(opts.cancelText || '取消')}</button>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="${id}" role="dialog" aria-modal="true">
      <section class="modal-page card app-dialog">
        <div class="section-title modal-title"><div><h2>${esc(opts.title || '提示')}</h2></div></div>
        <p class="app-dialog-message">${esc(opts.message || '').replace(/\n/g, '<br>')}</p>
        ${inputHtml}
        <div class="form-actions app-dialog-actions">${cancelBtn}<button type="button" id="appDialogOk" class="${opts.danger ? 'danger' : ''}">${esc(opts.okText || '确定')}</button></div>
      </section>
    </div>`);
    const modal = document.getElementById(id);
    const finish = (ok) => {
      const inp = modal.querySelector('#appDialogInput');
      const value = inp ? inp.value : '';
      modal.remove();
      resolve({ ok, value });
    };
    modal.querySelector('#appDialogOk').onclick = () => finish(true);
    const cancel = modal.querySelector('#appDialogCancel');
    if(cancel) cancel.onclick = () => finish(false);
    modal.addEventListener('click', (e) => { if(e.target === modal) finish(false); });
    const inp = modal.querySelector('#appDialogInput');
    if(inp){
      inp.focus(); inp.select();
      inp.onkeydown = (e) => { if(e.key === 'Enter'){ e.preventDefault(); finish(true); } };
    }
    if(!inp && opts.danger && cancel){ cancel.focus(); }
    const onKey = (e) => { if(e.key === 'Escape'){ document.removeEventListener('keydown', onKey); finish(false); } };
    document.addEventListener('keydown', onKey);
  });
}
async function appConfirm(message, opts){
  const r = await appDialog(Object.assign({title:'确认', message, okText:'确定', cancelText:'取消'}, opts || {}));
  return r.ok;
}
async function appPrompt(message, defaultValue, opts){
  const r = await appDialog(Object.assign({title:'请输入', message, input:true, inputValue:defaultValue || '', okText:'确定'}, opts || {}));
  return r.ok ? r.value : null;
}
async function appAlert(message, opts){
  await appDialog(Object.assign({title:'提示', message, okText:'知道了', cancelText:null}, opts || {}));
}

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
  if(!regions.length) return '<span>多地区实例</span>';
  return regions.map(r => `<span>${esc(r)}</span>`).join('');
}

function authShell(title, subtitle, formHtml, footHtml='', nodes=[]){
  const regionText = (nodes || []).filter(n => n.active).map(n => n.region).filter(Boolean).slice(0, 3).join('、') || '多地区实例';
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

function fmtPts(v){
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
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
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
  coins:'<ellipse cx="12" cy="7" rx="7.2" ry="3.2"/><path d="M4.8 7v4.2c0 1.8 3.2 3.2 7.2 3.2s7.2-1.4 7.2-3.2V7"/><path d="M4.8 11.6v4.2c0 1.8 3.2 3.2 7.2 3.2s7.2-1.4 7.2-3.2v-4.2"/>',
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
  if(diff < 86400*30) return `${Math.floor(diff/86400)} 天前`;
  if(diff < 86400*365) return `${Math.floor(diff/86400/30)} 个月前`;
  return `${Math.floor(diff/86400/365)} 年前`;
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
    slot.innerHTML = `<div class="chart-empty"><strong>暂无流量数据</strong><p class="muted small">当前统计范围内还没有产生流量。</p></div>`;
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
    slot.innerHTML = `<div class="chart-empty"><strong>暂无流量数据</strong><p class="muted small">本月还没有采集到协议流量。</p></div>`;
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
function frpcDraftKey(){
  const scope = window.__cfgScope || {};
  const suffix = scope.plan_id ? ('_p' + scope.plan_id) : '';
  return 'fml_frpc_draft_' + (currentUser?.id || currentUser?.username || 'anon') + suffix;
}
function frpcEditorEl(){ return document.getElementById('frpcEditor'); }
function frpcEditorStatus(msg){ const el = document.getElementById('editorStatus'); if(el) el.textContent = msg || ''; }
async function fetchGeneratedFrpc(){
  const scope = window.__cfgScope || {};
  const qs = new URLSearchParams();
  if(scope.node_id) qs.set('node_id', String(scope.node_id));
  if(scope.plan_id) qs.set('plan_id', String(scope.plan_id));
  const url = '/config/frpc.toml' + (qs.toString() ? '?' + qs.toString() : '');
  const res = await fetch(url, {credentials:'same-origin'});
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
function openPwdModal(){
  const um = document.querySelector('#userMenu');
  if(um) um.classList.add('hidden');
  let m = document.querySelector('#pwdModal');
  if(!m){
    document.body.insertAdjacentHTML('beforeend', adminPwdModalHtml());
    m = document.querySelector('#pwdModal');
  }
  m.classList.remove('hidden');
  const form = m.querySelector('#pwdForm');
  if(form && !form.dataset.bound){
    form.dataset.bound = '1';
    form.onsubmit = (e) => { e.preventDefault(); submitPasswordChange(form, closePwdModal); };
  }
}
function closePwdModal(){ const m = document.querySelector('#pwdModal'); if(m) m.classList.add('hidden'); }
function initPasswordForm(){
  const form = document.querySelector('#profilePwdForm');
  if(!form) return;
  form.onsubmit = (e) => { e.preventDefault(); submitPasswordChange(form); };
}

function appSidebarHtml(kind='dashboard'){
  const isAdmin = currentUser?.role === 'admin';
  const username = currentUser?.username || '用户';
  const layoutItems = isAdmin ? [
    ['admin-dashboard','home','运行总览'],
    ['admin','users','用户管理','users'],
    ['admin','nodePlus','新增节点','nodes'],
    ['admin','license','套餐','plans'],
    '__finance__',
    '__tickets__',
    ['admin-health','pulse','节点健康','health'],
    ['admin-proxies','monitor','映射监控','proxies'],
    ['admin','risk','风控审计','risk'],
    ['admin-ops','tools','平台维护'],
    ['admin-settings','gear','设置']
  ] : [
    ['dashboard','home','概览'],
    ['dashboard-myplans','license','我的实例'],
    ['dashboard-nodes','node','新建实例'],
    '__tickets__',
    ['dashboard-hosts','cloud','托管申请'],
    ['dashboard-points','bolt','账单与充值'],
    ['dashboard-profile','user','个人中心']
  ];
  const financeItems = [
    ['admin','chart','订单','orders'],
    ['admin-ledger','coins','收支表','ledger']
  ];
  const ticketItems = isAdmin ? [
    ['admin-tickets','log','故障工单'],
    ['admin-payouts','key','提现工单'],
    ['admin-hosts','cloud','托管申请']
  ] : [
    ['dashboard-tickets','log','故障工单'],
    ['dashboard-payouts','key','提现工单']
  ];
  const linkHtml = ([action, icon, label, section], sub, dotId) => {
    const active = kind === action || (section && kind === section) ? ' active' : '';
    return `<button class="side-link${sub ? ' side-sublink' : ''}${active}" data-nav="${action}"${section ? ` data-section="${section}"` : ''}>${sideIcon(icon)}<span class="side-link-label">${label}</span>${dotId ? `<span class="side-dot hidden" id="${dotId}"></span>` : ''}<span class="side-link-arrow">›</span></button>`;
  };
  const ticketActive = ticketItems.some(([a]) => kind === a);
  const stored = localStorage.getItem('sideTicketsOpen');
  const open = ticketActive || stored === '1';
  const groupBlock = (label, items, key, icon, dotId, dotIds) => {
    const active = items.some(([a]) => kind === a);
    const stored = localStorage.getItem(key);
    const open = active || stored === '1';
    return `<div class="side-group">
      <button type="button" class="side-link side-group-toggle${active ? ' active' : ''}" data-group="${key}" onclick="toggleSideGroup(this)" aria-expanded="${open ? 'true' : 'false'}">
        ${sideIcon(icon)}<span class="side-link-label">${label}</span>${dotId ? `<span class="side-dot hidden" id="${dotId}"></span>` : ''}<span class="side-group-chevron">›</span>
      </button>
      <div class="side-subnav${open ? ' open' : ''}">${items.map((x, i) => linkHtml(x, true, (dotIds || [])[i])).join('')}</div>
    </div>`;
  };
  const financeBlock = groupBlock('订单收支', financeItems, 'sideFinanceOpen', 'chart');
  const ticketsBlock = groupBlock('技术支持', ticketItems, 'sideTicketsOpen', 'log', 'ticketDot', ['ticketDotTickets', 'ticketDotPayouts', 'ticketDotHosts']);
  const brandName = 'Frp 管理台';
  const brandSub = '内网穿透管理平台';
  return `<aside class="app-sidebar">
    <div class="sidebar-brand"><div class="brand-mark-small">F</div><div><strong>${brandName}</strong><span>${brandSub}</span></div></div>
    <div class="sidebar-section-label">工作空间</div>${layoutItems.map(x => x === '__tickets__' ? ticketsBlock : (x === '__finance__' ? financeBlock : linkHtml(x, false))).join('')}
    ${''}
    <div class="sidebar-spacer"></div>
    <div class="sidebar-service-status"><span class="sidebar-service-dot"></span><span class="sidebar-service-copy">${sidebarServiceCopyHtml()}</span></div>
    <div class="sidebar-user-wrap">
      <div class="sidebar-user-card" onclick="toggleUserMenu(event)" role="button" tabindex="0" aria-label="账号菜单">
        <span class="sidebar-user-avatar">${avatarSvg(username, currentUser?.role, 32)}</span>
        <span class="sidebar-user-copy"><strong>${esc(username)}</strong><small>${isAdmin ? '系统管理员' : '普通用户'}</small></span>
        <span class="sidebar-user-more">⋯</span>
      </div>
      <div class="user-menu hidden" id="userMenu">
        <button type="button" onclick="openPwdModal()">${sideIcon('key')}<span>修改密码</span></button>
        <button type="button" class="danger" data-nav="logout">${sideIcon('logout')}<span>退出登录</span></button>
      </div>
    </div>
  </aside>`;
}

function toggleSideGroup(btn){
  const sub = btn.parentElement.querySelector('.side-subnav');
  if(!sub) return;
  const open = !sub.classList.contains('open');
  sub.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  const key = btn.getAttribute('data-group') || 'sideTicketsOpen';
  localStorage.setItem(key, open ? '1' : '0');
}

function settingsTopbarHtml(title){
  const username = currentUser?.username || '管理员';
  const initial = esc(String(username).slice(0, 1).toUpperCase());
  return `<div class="workspace-topbar settings-topbar">
    <div class="settings-head"><span class="settings-head-icon">${stIcon('gear')}</span><div class="settings-head-copy"><h1>${esc(title || '管理员设置')}</h1><p>配置系统通知、邮件、备份、运维和存储等相关设置</p></div></div>
    <div class="topbar-actions settings-head-actions"><span class="settings-admin"><span class="settings-admin-avatar">${avatarSvg(username, currentUser?.role, 30)}</span><span class="settings-admin-name">${esc(username)}</span></span><button type="button" class="secondary settings-logout" data-nav="logout">退出登录</button></div>
  </div>`;
}

async function loadNotifications(){
  if(!currentUser) return;
  try{
    const r = await api('/api/notifications');
    window.__notifs = r.notifications || [];
    window.__notifUnread = Number(r.unread_notifications ?? r.unread ?? 0);
    window.__annUnread = Number(r.unseen_announcements ?? 0);
    renderNotifBadge();
  }catch(e){}
  try{
    const s = await api('/api/tickets/summary');
    setSideDot('ticketDot', Number(s.count || 0));
    setSideDot('ticketDotTickets', Number(s.tickets || 0));
    setSideDot('ticketDotPayouts', Number(s.payouts || 0));
    setSideDot('ticketDotHosts', Number(s.hosts || 0));
  }catch(e){}
}

function setSideDot(id, count){
  const el = document.querySelector('#' + id);
  if(!el) return;
  el.classList.toggle('hidden', !(count > 0));
}

function renderNotifBadge(){
  const el = document.querySelector('#notifBadge');
  if(!el) return;
  const n = Number(window.__notifUnread || 0) + Number(window.__annUnread || 0);
  el.textContent = n > 99 ? '99+' : String(n);
  el.classList.toggle('hidden', n <= 0);
}

let notifTab = 'notif';

async function loadAnnouncements(){
  try{
    const r = await api('/api/announcements');
    window.__announcements = r.announcements || [];
  }catch(e){ window.__announcements = window.__announcements || []; }
}

function notifModalHtml(){
  const list = window.__notifs || [];
  const anns = window.__announcements || [];
  const notifHtml = list.length ? list.map(n => `<article class="notif-item unread" id="notifItem${n.id}">
      <div class="notif-item-head"><b>${esc(n.title)}</b><small>${fmtTs(n.created_at)}</small></div>
      <p class="notif-item-body">${esc(n.content || '')}</p>
      <div class="notif-item-foot">
        ${n.link ? `<button type="button" class="notif-btn primary" onclick="openNotif(${n.id}, '${esc(n.link || '')}')">查看详情</button>` : ''}
        <button type="button" class="notif-btn" onclick="markNotifRead(${n.id})">知道了</button>
      </div>
    </article>`).join('') : '<div class="notif-empty">暂无未读通知</div>';
  const annHtml = anns.length ? `<div class="ann-timeline">${anns.map((a, i) => `<article class="ann-node ${i % 2 ? 'left' : 'right'}">
      <span class="ann-node-dot"></span>
      <div class="ann-card">
        <div class="ann-card-head"><b>${esc(a.title)}</b><small>${relTime(a.created_at)}</small></div>
        <div class="ann-body">${ticketBodyHtml(a.content)}</div>
      </div>
    </article>`).join('')}</div>` : '<div class="notif-empty">暂无系统公告</div>';
  return `<div class="modal-backdrop" id="notifModal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeNotifModal()">
    <section class="modal-page card notif-modal">
      <div class="notif-head-bar">
        <div class="notif-head-title">${stIcon('bell')}<h2>系统公告</h2></div>
        <button type="button" class="notif-close" onclick="closeNotifModal()" aria-label="关闭">×</button>
      </div>
      <nav class="seg-tabs notif-tabs">
        <button type="button" class="seg-tab${notifTab === 'notif' ? ' active' : ''}" onclick="switchNotifTab('notif')">${stIcon('bell')}通知${(window.__notifUnread||0) > 0 ? `<span>${window.__notifUnread}</span>` : ''}</button>
        <button type="button" class="seg-tab${notifTab === 'ann' ? ' active' : ''}" onclick="switchNotifTab('ann')">${stIcon('log')}系统公告${Number(window.__annUnread||0) > 0 ? `<span>${window.__annUnread}</span>` : ''}</button>
      </nav>
      <div class="notif-body">
        ${notifTab === 'notif' ? `<div class="notif-list">${notifHtml}</div>` : `<div class="ann-list">${annHtml}</div>`}
      </div>
      <div class="notif-foot">
        ${notifTab === 'notif'
          ? `<button type="button" class="notif-btn" onclick="markAllNotifsRead()">全部标为已读</button>`
          : `<button type="button" class="notif-btn" onclick="dismissAnnToday()">今日不再提示</button><button type="button" class="notif-btn primary" onclick="dismissAnnForever()">关闭公告</button>`}
      </div>
    </section></div>`;
}

function dismissAnnToday(){
  localStorage.setItem('annDismissDate', new Date().toISOString().slice(0, 10));
  closeNotifModal();
}

async function dismissAnnForever(){
  try{ await api('/api/notifications/read', {method:'POST', body:{announcements:true}}); }catch(e){}
  closeNotifModal();
  await loadNotifications();
}

async function maybeShowAnnouncements(){
  if(!currentUser) return;
  const today = new Date().toISOString().slice(0, 10);
  if(localStorage.getItem('annDismissDate') === today) return;
  if(sessionStorage.getItem('annAutoShown') === '1') return;
  try{
    const r = await api('/api/notifications');
    if(Number(r.unseen_announcements || 0) > 0){
      sessionStorage.setItem('annAutoShown', '1');
      notifTab = 'ann';
      await loadAnnouncements();
      await openNotifModal();
    }
  }catch(e){}
}

async function openNotifModal(){
  await Promise.all([loadNotifications(), loadAnnouncements()]);
  const old = document.querySelector('#notifModal');
  if(old) old.remove();
  document.body.insertAdjacentHTML('beforeend', notifModalHtml());
}

function closeNotifModal(){ const el = document.querySelector('#notifModal'); if(el) el.remove(); }

async function switchNotifTab(tab){
  notifTab = tab;
  if(tab === 'ann'){
    try{ await api('/api/notifications/read', {method:'POST', body:{announcements:true}}); }catch(e){}
    await loadNotifications();
  }
  const el = document.querySelector('#notifModal');
  if(el){ el.remove(); document.body.insertAdjacentHTML('beforeend', notifModalHtml()); }
}

async function markAllNotifsRead(){
  try{ await api('/api/notifications/read', {method:'POST', body:{all:true}}); await loadNotifications(); await switchNotifTab(notifTab); }catch(e){}
}

async function markNotifRead(id){
  try{ await api('/api/notifications/read', {method:'POST', body:{id:Number(id)}}); }catch(e){}
  const el = document.getElementById('notifItem' + id);
  if(el) el.remove();
  const wrap = document.querySelector('.notif-list');
  if(wrap && !wrap.querySelector('.notif-item')) wrap.innerHTML = '<div class="notif-empty">暂无未读通知</div>';
  loadNotifications();
}

async function openNotif(id, link){
  try{ await api('/api/notifications/read', {method:'POST', body:{id:Number(id)}}); }catch(e){}
  closeNotifModal();
  loadNotifications();
  if(!link) return;
  if(link.startsWith('ticket:')){
    const tid = Number(link.slice(7));
    if(currentUser && currentUser.role === 'admin') loadTicketDetail(tid, 'admin');
    else loadTicketDetail(tid);
    return;
  }
  if(link === 'payouts'){ if(currentUser && currentUser.role === 'admin') loadAdminPayouts(); return; }
  if(link === 'tickets'){ if(currentUser && currentUser.role === 'admin') loadAdminTickets(); else loadTickets(); }
}

function toggleUserMenu(ev){
  if(ev) ev.stopPropagation();
  const menu = document.querySelector('#userMenu');
  if(!menu) return;
  menu.classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  const menu = document.querySelector('#userMenu');
  if(menu && !menu.classList.contains('hidden') && !e.target.closest('.sidebar-user-wrap')) menu.classList.add('hidden');
});

function appLayoutHtml(content, kind='dashboard', topTitle='工作区'){
  const username = currentUser?.username || '用户';
  const isSettings = kind === 'admin-settings';
  return `<div class="app-shell${isSettings ? ' is-settings' : ''}">${appSidebarHtml(kind)}<main class="workspace-main"><div class="workspace-topbar"><div class="topbar-banner"><svg class="topbar-banner-art" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"><path d="M0 96 L150 58 L260 86 L420 34 L560 78 L700 44 L860 92 L1010 52 L1200 84 L1200 120 L0 120 Z" fill="rgba(122,174,255,.30)"/><path d="M0 108 L180 74 L340 100 L520 62 L700 96 L880 70 L1060 104 L1200 84 L1200 120 L0 120 Z" fill="rgba(122,174,255,.45)"/></svg><span class="topbar-banner-spark" aria-hidden="true"></span><div class="topbar-banner-left"><span class="topbar-brandmark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 18.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 9.6 4.2 4.2 0 0 0 7.5 18.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><div class="topbar-banner-copy"><span class="topbar-kicker">FRP WORKSPACE</span><b>欢迎回来，${esc(username)}</b><span class="topbar-banner-sub">高效管理您的内网服务，轻松实现远程访问</span></div></div><div class="topbar-banner-right"><div class="topbar-banner-slogan"><b>让内网服务更简单</b><span>安全 · 稳定 · 高效</span></div><span class="topbar-banner-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 7h.01M7 17h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M14.6 12.3l1.8 1.8 3.2-3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div><button type="button" class="topbar-banner-theme" data-nav="theme-toggle" title="切换亮色/暗色" aria-label="切换亮色/暗色">◐</button></div></div>${content}</main>${currentUser ? `<div class="topbar-bell-wrap floating"><div class="topbar-bell-wrap"><button type="button" class="topbar-banner-theme topbar-bell" onclick="openNotifModal()" title="通知" aria-label="通知"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.5 6 1.5 6H4.5S6 13.5 6 9Z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 18.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span id="notifBadge" class="notif-badge hidden">0</span></button><div id="notifPanel" class="notif-panel hidden"></div></div></div>` : ''}</div>`;
}

function ensureTableWraps(){
  document.querySelectorAll('#app table').forEach(t => {
    const p = t.parentElement;
    if(!p) return;
    if(p.classList.contains('table-wrap')) return;
    if(p.classList.contains('card') || p.classList.contains('risk-result') || p.classList.contains('maint-table')){
      p.style.overflowX = 'auto';
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    p.insertBefore(wrap, t);
    wrap.appendChild(t);
  });
}

function startTableWrapObserver(){
  const appEl = document.getElementById('app');
  if(!appEl || window.__tableWrapObserver) return;
  window.__tableWrapObserver = new MutationObserver(() => ensureTableWraps());
  window.__tableWrapObserver.observe(appEl, { childList: true, subtree: true });
  ensureTableWraps();
}

function toggleMobileNav(force){
  const open = typeof force === 'boolean' ? force : !document.body.classList.contains('mobile-nav-open');
  document.body.classList.toggle('mobile-nav-open', open);
}

function ensureMobileNavToggle(){
  if(!document.querySelector('#mobileNavBtn')){
    document.body.insertAdjacentHTML('beforeend', '<button type="button" id="mobileNavBtn" class="mobile-nav-toggle" aria-label="打开导航" onclick="toggleMobileNav()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button><div id="mobileNavMask" class="mobile-nav-mask" onclick="toggleMobileNav(false)"></div>');
  }
}

function setNav(){
  document.body.classList.toggle('is-app', !!currentUser);
  if(currentUser) ensureMobileNavToggle();
  setTimeout(startTableWrapObserver, 0);
  if(currentUser){
    setTimeout(loadNotifications, 0);
    setTimeout(maybeShowAnnouncements, 1200);
    if(!window.__notifTimer) window.__notifTimer = setInterval(loadNotifications, 60000);
  }
  document.body.classList.toggle('is-auth', !currentUser);
  const themeBtn = navButton(`${colorMode === 'dark' ? '浅色' : '深色'}模式`, 'theme');
  if(!currentUser){ nav.innerHTML = themeBtn; return; }
  const licenseRequired = !!(softwareLicense && softwareLicense.required && !softwareLicense.licensed);
  const isAdmin = currentUser.role === 'admin';
  const adminNav = isAdmin && !licenseRequired ? [
    navButton('用户', 'admin', 'secondary', 'users'),
    navButton('套餐', 'admin', 'secondary', 'plans'),
    navButton('订单', 'admin', 'secondary', 'orders'),
    navButton('托管', 'admin-hosts', 'secondary'),
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
  document.body.classList.remove('mobile-nav-open');
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
  document.body.classList.remove('mobile-nav-open');
  const action = el.getAttribute('data-nav');
  const section = el.getAttribute('data-section') || 'users';
  try{
    if(action === 'theme') return toggleColorMode();
    if(action === 'theme-toggle') return toggleLightDark();
    if(action === 'logout') return logout();
    if(action === 'dashboard') return loadDashboard();
    if(action === 'dashboard-nodes') return loadDashboard('nodes');
    if(action === 'dashboard-tunnels') return loadDashboard('tunnels');
    if(action === 'dashboard-config') return loadDashboard('config');
    if(action === 'dashboard-editor') return loadDashboard('editor');
    if(action === 'dashboard-profile') return loadDashboard('profile');
    if(action === 'dashboard-notify') return loadDashboard('profile');
    if(action === 'dashboard-plans') return loadPlans();
    if(action === 'dashboard-points') return loadPoints();
    if(action === 'dashboard-tickets') return loadTickets();
    if(action === 'dashboard-payouts') return loadPayoutTickets();
    if(action === 'admin-tickets') return loadAdminTickets();
    if(action === 'admin-payouts') return loadAdminPayouts();
    if(action === 'admin-ledger') return loadAdminLedger();
    if(action === 'admin-announcements') return loadAdminAnnouncements();
    if(action === 'admin-ops') return loadAdminOps();
    if(action === 'admin-recharge') return loadAdminRecharge();
    if(action === 'dashboard-myplans') return loadMyPlans();
    if(action === 'dashboard-hosts') return loadHosts();
    if(action === 'admin-hosts') return loadAdminHosts();
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
  const overviewLive = document.getElementById('overviewNodeLatencyValue');
  if(!live && !overviewLive) return;
  if(ms == null){
    [live, overviewLive].filter(Boolean).forEach(el => { el.textContent = el.dataset.fallback || '暂未测量'; el.title = ''; });
    return;
  }
  [live, overviewLive].filter(Boolean).forEach(el => {
    el.textContent = `${Math.round(ms)} ms`;
    el.title = {node:'用户→实例实测', cloudflare:'浏览器↔Cloudflare 就近节点', panel:'浏览器→面板'}[src] || '';
  });
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
    if(ms != null){ e.textContent = `${Math.round(ms)} ms`; e.title = '用户→实例实测'; }
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
  let nodes = [], registration = {open_registration: false};
  try { nodes = await loadNodes(); registration = await api('/api/registration-status'); } catch(e) { show('加载注册信息失败：' + e.message, true); }
  const openRegistration = !!registration.open_registration;
  const registerIntro = openRegistration ? '填写邮箱并通过验证码完成注册' : '输入密钥并选择适合你的地区';
  app.innerHTML = authShell(openRegistration ? '开放注册' : '密钥注册', registerIntro, `
      <form id="registerForm" class="stack-form auth-login-form">
        <div class="input-group"><label class="input-label" for="registerUsername">用户名</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('user')}</span><input id="registerUsername" class="input-ios" name="username" autocomplete="username" placeholder="请输入用户名" required></div></div>
        <div class="input-group"><label class="input-label" for="registerPassword">密码</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('lock')}</span><input id="registerPassword" class="input-ios auth-password-input" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="请输入密码（至少 6 位）" required><button type="button" class="auth-password-toggle" onclick="togglePasswordVisibility('registerPassword', this)" aria-label="显示密码" title="显示密码">${iconSvg('eye')}</button></div></div>
        <div class="input-group"><label class="input-label" for="registerPassword2">确认密码</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('lock')}</span><input id="registerPassword2" class="input-ios auth-password-input" name="password2" type="password" autocomplete="new-password" minlength="6" placeholder="请再次输入密码" required><button type="button" class="auth-password-toggle" onclick="togglePasswordVisibility('registerPassword2', this)" aria-label="显示密码" title="显示密码">${iconSvg('eye')}</button></div></div>
        ${openRegistration ? `<div class="input-group"><label class="input-label" for="registerEmail">邮箱</label><div class="auth-input-wrap"><span class="auth-input-icon">${iconSvg('mail')}</span><input id="registerEmail" class="input-ios" name="email" type="email" autocomplete="email" placeholder="请输入邮箱，用于接收验证码" required></div></div>
        <div class="input-group"><label class="input-label" for="registerCode">邮箱验证码</label><div class="row" style="gap:8px"><input id="registerCode" class="input-ios" name="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" required style="flex:1;min-width:0"><button type="button" class="secondary" id="registerCodeBtn" onclick="sendRegisterCode()">获取验证码</button></div></div><input type="hidden" name="node_id" value="0"><input type="hidden" name="invite_key" value="">` : '<div class="input-group"><label class="input-label" for="registerNode">接入节点</label><select id="registerNode" class="input-ios" name="node_id" required>${nodeOptions(nodes)}</select></div><div class="input-group"><label class="input-label" for="registerKey">注册密钥</label><input id="registerKey" class="input-ios" name="invite_key" placeholder="FML-..." required></div>'}
        <p class="row"><button>注册</button><button type="button" class="secondary" onclick="renderLogin()">返回登录</button></p>
      </form>`, '', nodes);
  document.querySelector('#registerForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pwd = String(fd.get('password') || '');
    const pwd2 = String(fd.get('password2') || '');
    if(pwd !== pwd2){ show('两次输入的密码不一致', true); return; }
    if(pwd.length < 6){ show('密码至少 6 位', true); return; }
    fd.delete('password2');
    try{
      const r = await api('/api/register', {method:'POST', body:Object.fromEntries(fd)});
      show(r.message || '注册成功，请登录');
      renderLogin();
    }catch(err){ show(err.message, true); }
  };
}


async function loadPlans(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let data;
  try{
    const [plansRes, ordersRes, pointsRes] = await Promise.all([
      api('/api/plans'),
      api('/api/user/orders').catch(() => ({orders:[]})),
      api('/api/user/balance').catch(() => ({balance:0, payment:{}}))
    ]);
    data = {plans: plansRes.plans || [], payment: plansRes.payment || {}, orders: ordersRes.orders || [], balance: pointsRes.balance || 0, activeModes: ordersRes.active_modes || []};
  }catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    show(err.message, true);
    return;
  }
  window.__fmlPlans = data.plans || [];
  const cards = (data.plans || []).map(p => {
    const enough = Number(data.balance) >= Number(p.price);
    return `
    <article class="plan-card">
      <div class="plan-card-head"><h3>${esc(p.name)}</h3><span class="plan-price">¥${fmtPts(p.price)} <small>元</small></span></div>
      <ul class="plan-meta">
        <li><span>端口数</span><b>${p.max_ports}</b></li>
        <li><span>计费方式</span><b>${p.billing_mode === 'traffic' ? '流量' : '时间'}</b></li>
        <li><span>${p.billing_mode === 'traffic' ? '流量额度' : '有效期'}</span><b>${p.billing_mode === 'traffic' ? (p.traffic_limit_gb ? p.traffic_limit_gb + ' GB' : '未设置') : (p.duration_days ? p.duration_days + ' 天' : '不限期')}</b></li>
        ${p.billing_mode !== 'traffic' ? `<li><span>流量上限</span><b>${p.traffic_limit_gb ? p.traffic_limit_gb + ' GB' : '不限量'}</b></li>` : ''}
        <li><span>速率上限</span><b>${p.bandwidth_limit_mbs ? p.bandwidth_limit_mbs + ' MB/s' : '不限'}</b></li>
      </ul>
      ${p.note ? `<p class="plan-note">${esc(p.note)}</p>` : ''}
      ${p.fair_use_note ? `<p class="plan-note plan-fair">${esc(p.fair_use_note)}</p>` : ''}
      <button type="button" class="plan-buy" onclick="buyPlan(${p.id})" ${enough ? '' : 'disabled'}>${enough ? '余额购买' : '余额不足'}</button>
    </article>`;
  }).join('') || '<p class="muted">管理员还没有上架套餐。</p>';
  const statusText = {pending:'待支付', paid:'已完成', cancelled:'已取消', expired:'已过期', refunded:'已退款'};
  const orderRows = (data.orders || []).map((o, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(o.order_no)}</td>
      <td>${esc(o.plan_name)}</td>
      <td>${(o.kind === 'recharge' ? '+' : '-') + '¥' + fmtPts(o.amount)}</td>
      <td><span class="status-badge ${o.status === 'paid' ? 'ok' : (o.status === 'pending' ? '' : 'bad')}"><i></i>${statusText[o.status] || esc(o.status)}</span></td>
      <td>${fmtTs(o.created_at)}</td>
      <td class="actions node-actions">${o.status === 'pending' ? `<button type="button" class="node-action" onclick="resumePay('${esc(o.order_no)}')">继续支付</button>` : '<span class="muted small">—</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">暂无订单</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">PLANS</span><h1>购买套餐</h1><p>使用余额购买套餐，购买后自动开通端口与有效期。</p></div><div class="ov-head-badge"><span>我的余额</span><b>¥${fmtPts(data.balance)}</b></div></div>
    <section class="card"><div class="section-title"><div><h2>${stIcon('license')}可选套餐</h2><p>共 ${(data.plans || []).length} 个套餐</p></div><button type="button" class="secondary" onclick="loadPoints()">充值余额</button></div><div class="plan-grid">${cards}</div></section>
    <section class="card"><div class="section-title"><div><h2>${stIcon('chart')}我的订单</h2><p>最近 50 条</p></div></div><table><thead><tr><th>序号</th><th>订单号</th><th>套餐</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${orderRows}</tbody></table></section>
  `, 'dashboard-plans', '购买套餐');
}

async function buyPlan(planId){
  let nodes = [];
  try{ nodes = await loadNodes(); }catch(e){ show('加载节点失败：' + e.message, true); return; }
  const active = (nodes || []).filter(n => n.active !== false);
  if(!active.length){ show('暂无可选实例，请联系管理员', true); return; }
  const plan = (window.__fmlPlans || []).find(p => Number(p.id) === Number(planId)) || {};
  const current = String(currentDashboardNodeId || '');
  const options = active.map((n, i) => `<label class="node-pick">
      <input type="radio" name="buyNode" value="${Number(n.id)}"${String(n.id) === current || (!current && i === 0) ? ' checked' : ''}>
      <span class="node-pick-body"><b>${esc(n.region || '')} / ${esc(n.name || '')}</b><small>${esc(n.server_addr || '')} · 空闲端口 ${Number(n.free_count || 0)}</small></span>
    </label>`).join('');
  const html = `<div class="modal-backdrop" id="buyPlanModal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeBuyPlan()">
    <section class="modal-page card">
      <div class="section-title modal-title"><div><h2>选择接入实例</h2><p>套餐：${esc(plan.name || '')} · ¥${fmtPts(plan.price)}</p></div><button type="button" class="secondary modal-close" onclick="closeBuyPlan()">关闭 ×</button></div>
      <div class="node-pick-list">${options}</div>
      <p class="muted small">购买后 10 分钟内、且套餐端口未产生流量，可全额退订；超过 10 分钟按剩余比例退款并扣除手续费。</p>
      <p class="muted small">购买后仍可在「可用实例」页更换实例（套餐有效期内，且需先清空该账号的隧道）。</p>
      <div class="form-actions"><button type="button" onclick="confirmBuyPlan(${Number(planId)})">确认购买</button></div>
    </section>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeBuyPlan(){
  const el = document.querySelector('#buyPlanModal');
  if(el) el.remove();
}

async function confirmBuyPlan(planId){
  const picked = document.querySelector('#buyPlanModal input[name="buyNode"]:checked');
  if(!picked){ show('请选择接入实例', true); return; }
  const nodeId = Number(picked.value);
  closeBuyPlan();
  try{
    const r = await api('/api/user/orders', {method:'POST', body:{plan_id:planId, node_id:nodeId}});
    await appAlert((r.message || '购买成功') + '\n\n10 分钟内且端口未产生流量，可全额退订。', {title:'购买成功'});
    await loadPlans();
  }catch(err){ show(err.message, true); }
}

async function cancelPlan(id, name, refund){
  if(!await appConfirm(`确认退订「${name}」？\n预计退回 ¥${fmtPts(refund)} 到余额。`, {title:'退订套餐', okText:'确认退订', danger:true})) return;
  try{
    const r = await api('/api/user/plans/cancel', {method:'POST', body:{id}});
    await appAlert(r.message || '退订成功', {title:'退订成功'});
    await loadDashboard('profile');
  }catch(err){ show(err.message, true); }
}

function showTunnelForm(){
  const card = document.querySelector('#tunnelCreateCard');
  if(!card) return;
  card.classList.remove('hidden');
  card.scrollIntoView({behavior:'smooth', block:'start'});
  setTimeout(() => { const inp = card.querySelector('input[name="name"]'); if(inp) inp.focus(); }, 250);
}

async function renewInstance(upid, planId, nodeId, price, name){
  if(!planId){ show('该套餐已下架，无法延期', true); return; }
  if(!await appConfirm(`确认延期「${name}」？\n将扣除 ¥${fmtPts(price)}，时长或流量会叠加到当前实例。`, {title:'延期', okText:'确认延期'})) return;
  try{
    const r = await api('/api/user/orders', {method:'POST', body:{plan_id:Number(planId), node_id:Number(nodeId)}});
    show(r.message || '延期成功');
    await loadDashboard('tunnels');
  }catch(err){ show(err.message || '延期失败', true); }
}

async function toggleAutoRenew(upid, enabled){
  try{
    await api('/api/user/plans/auto-renew', {method:'POST', body:{id:Number(upid), enabled:!!enabled}});
    show(enabled ? '已开启自动延期' : '已关闭自动延期');
  }catch(err){
    show(err.message || '设置失败', true);
    await loadDashboard('tunnels');
  }
}

async function resumePay(orderNo){
  try{
    const r = await api('/api/orders/status?order_no=' + encodeURIComponent(orderNo));
    const order = r.order || {};
    if(order.status === 'paid'){ show('订单已支付'); return loadPlans(); }
    if(!order.pay_url){ show('没有可用的支付链接，请联系管理员', true); return; }
    window.location.href = order.pay_url;
  }catch(err){ show(err.message, true); }
}



let hostsTab = 'nodes';

let nnState = { region: '', nodeId: 0, planId: 0, ports: [], tunnels: [] };
let nnFilter = { q: '', min: '', max: '', sort: 'default' };


const HOST_STATUS_CLASS = {pending:'', approved:'ok', rejected:'bad', blacklisted:'bad'};
const HOST_RULES = [
  ['资源共享', '托管旨在将您的闲置服务器接入平台以分摊成本。我们不建议以高额盈利为唯一目的的大规模托管。'],
  ['真实合规', '请真实填写节点地理位置、线路描述，并合理分配资源（不建议过度超售），严禁虚假宣传。发现违规用途或虚标配置，直接拉黑并停止结算。'],
  ['清退保障', '母鸡连续离线超过 24 小时，平台将自动下架（如有特殊情况，需提前联系管理员说明），并扣除部分收益赔偿用户。'],
  ['工单响应', '托管后可能会有用户针对网络等问题提交相关工单，请务必及时登录平台处理，保证服务质量。'],
  ['退场规则', '如需提前退场，请提交退场工单，需赔付受影响用户。']
];

function hostRowsHtml(hosts, admin){
  return hosts.map((h, i) => `<tr${h.ticket_id ? ` class="clickable-row" onclick="loadTicketDetail(${h.ticket_id}${admin ? ", 'admin'" : ''})"` : ''}>
      <td>${i + 1}</td>
      <td>${esc(h.name)}</td>
      <td>${esc(h.region)}</td>
      <td>${esc(h.server_addr)}:${h.server_port}</td>
      <td>${h.expires_at ? fmtTs(h.expires_at) : '-'}</td>
      <td>${h.bandwidth_mbps ? h.bandwidth_mbps + ' Mbps' : '不限'} / ${h.monthly_traffic_gb ? h.monthly_traffic_gb + ' GB' : '不限'}</td>
      ${admin ? `<td>${esc(h.username)}</td>` : ''}
      <td><span class="status-badge ${HOST_STATUS_CLASS[h.status] || ''}"><i></i>${esc(h.status_text)}</span></td>
      <td>${fmtTs(h.created_at)}</td>
    </tr>`).join('') || `<tr><td colspan="${admin ? 9 : 8}" class="muted">暂无托管记录</td></tr>`;
}

let hostWizard = { step: 1, host: null, timer: null };

function hostFormModal(){
  hostWizard = { step: 1, host: null, timer: null };
  renderHostWizard();
}

function closeHostForm(){
  if(hostWizard.timer){ clearInterval(hostWizard.timer); hostWizard.timer = null; }
  const el = document.querySelector('#hostFormModal');
  if(el) el.remove();
}

function hostWizardStepper(step){
  const steps = [['1','托管准则'],['2','母鸡信息'],['3','设置套餐'],['4','接入平台']];
  return `<div class="hw-steps">${steps.map(([no, label], i) => {
    const n = i + 1;
    const state = n < step ? ' done' : (n === step ? ' active' : '');
    return `<div class="hw-step${state}"><span>${n < step ? '✓' : no}</span><b>${label}</b></div>`;
  }).join('')}</div>`;
}

function renderHostWizard(){
  const step = hostWizard.step;
  const host = hostWizard.host || {};
  let body = '';
  if(step === 1){
    body = `<div class="hw-rules">
      <p class="muted small">提交母鸡前请先阅读并同意以下准则。</p>
      <ol class="host-rule-list">${HOST_RULES.map(([t, d]) => `<li><b>${esc(t)}：</b><span>${esc(d)}</span></li>`).join('')}</ol>
      <div class="hw-actions"><button type="button" class="secondary" onclick="closeHostForm()">取消</button><button type="button" onclick="hostWizardNext(2)">同意并继续</button></div>
    </div>`;
  } else if(step === 2){
    body = `<form id="hwHostForm" class="grid">
      <div><label>母鸡名称</label><input name="name" required placeholder="例如 wh-01"></div>
      <div><label>地区</label><input name="region" placeholder="例如 武汉" required></div>
      <div><label>公网 IP / 域名</label><input name="server_addr" required placeholder="frp.example.com"></div>
      <div><label>frps 端口</label><input name="server_port" type="number" value="7000" min="1" max="65535" required></div>
      <div><label>端口起始</label><input name="port_start" type="number" value="20000" min="1" max="65535" required></div>
      <div><label>端口结束</label><input name="port_end" type="number" value="20199" min="1" max="65535" required></div>
      <div><label>带宽 Mbps</label><input name="bandwidth_mbps" type="number" value="100" min="1" required></div>
      <div><label>月流量 GB</label><input name="monthly_traffic_gb" type="number" value="500" min="0.1" step="0.1" required></div>
      <div><label>服务器到期时间</label><input name="expires_at" type="date" required min="${new Date(Date.now() + 86400000).toISOString().slice(0,10)}"><span class="muted small">用于限制套餐时长，到期自动停售</span></div>
      <div class="span-2"><label>备注</label><input name="note" placeholder="线路 / 机房 / 联系方式" required></div>
      <div class="hw-actions span-2"><button type="button" class="secondary" onclick="hostWizardNext(1)">上一步</button><button type="submit">下一步：设置套餐</button></div>
    </form>`;
  } else if(step === 3){
    body = `<form id="hwPlanForm" class="grid">
      <div class="span-2"><p class="muted small">母鸡「${esc(host.node_name || '')}」已创建，先配置一个套餐，审核通过后自动上架。</p></div>
      <div><label>套餐名称</label><input name="name" required placeholder="例如 入门版"></div>
      <div><label>价格（¥）</label><input name="price" type="number" min="0" value="10" required></div>
      <div><label>计费方式</label><select name="billing_mode"><option value="time">时间模式</option><option value="traffic">流量模式</option></select></div>
      <div><label>有效期（天）</label><input name="duration_days" type="number" min="1" max="30" value="30"></div>
      <div><label>流量额度 GB</label><input name="traffic_limit_gb" type="number" min="0" step="0.1" value="0"><span class="muted small">流量模式必填</span></div>
      <div><label>端口数</label><input name="max_ports" type="number" min="1" max="100" value="5" required></div>
      <div class="hw-actions span-2"><button type="button" class="secondary" onclick="hostWizardNext(2)">上一步</button><button type="submit">下一步：生成接入脚本</button></div>
    </form>`;
  } else {
    body = `<div class="hw-script">
      <p class="muted small">在母鸡机器上执行下面命令，接入成功后会自动提交管理员审核。</p>
      <div class="copy-line"><code class="token deploy-token" id="hwScriptCmd">${esc(host.script || '')}</code><button type="button" class="secondary" onclick="copyHostWizardScript()">复制命令</button></div>
      <div class="hw-status" id="hwStatus">${host.status === 'pending' ? '已提交审核，等待管理员核查' : '等待母鸡接入…'}</div>
      <div class="hw-actions"><button type="button" class="secondary" onclick="checkHostWizardStatus()">检测接入状态</button><button type="button" onclick="closeHostForm(); loadHosts()">完成</button></div>
    </div>`;
  }
  const old = document.querySelector('#hostFormModal');
  if(old) old.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="hostFormModal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeHostForm()">
    <section class="modal-page card host-wizard">
      <div class="section-title modal-title"><div><h2>添加母鸡</h2><p>四步完成：阅读准则、填写信息、设置套餐、接入平台</p></div><button type="button" class="secondary modal-close" onclick="closeHostForm()">关闭 ×</button></div>
      ${hostWizardStepper(step)}
      ${body}
    </section>
  </div>`);

  if(step === 2){
    const form = document.querySelector('#hwHostForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = '提交中…';
      try{
        const r = await api('/api/user/hosts', {method:'POST', body:Object.fromEntries(new FormData(form))});
        hostWizard.host = {
          host_id: r.host_id, node_id: r.node_id, node_name: r.node_name,
          deploy_token: r.deploy_token, auth_token: r.auth_token,
          region: r.region, server_addr: r.server_addr, server_port: r.server_port,
          port_start: r.port_start, port_end: r.port_end, bandwidth_mbps: r.bandwidth_mbps,
          note: new FormData(form).get('note') || ''
        };
        hostWizard.step = 3;
        renderHostWizard();
      }catch(err){
        btn.disabled = false; btn.textContent = '下一步：设置套餐';
        await appAlert(err.message, {title:'提交失败'});
      }
    };
  }
  if(step === 3){
    const form = document.querySelector('#hwPlanForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = '保存中…';
      try{
        const fd = Object.fromEntries(new FormData(form));
        await api('/api/user/provider/plans/save', {method:'POST', body:{...fd, node_id: hostWizard.host.node_id}});
        hostWizard.host.script = buildHostWizardScript(hostWizard.host);
        hostWizard.step = 4;
        renderHostWizard();
        checkHostWizardStatus(true);
        if(hostWizard.timer) clearInterval(hostWizard.timer);
        hostWizard.timer = setInterval(() => checkHostWizardStatus(true), 10000);
      }catch(err){
        btn.disabled = false; btn.textContent = '下一步：生成接入脚本';
        await appAlert(err.message, {title:'保存失败'});
      }
    };
  }
}

function hostWizardNext(step){
  if(step === 1){ closeHostForm(); return; }
  hostWizard.step = step;
  renderHostWizard();
}

function buildHostWizardScript(h){
  const env = [
    `PANEL_URL=${shellQuote(location.origin)}`,
    `SETUP_KEY=${shellQuote(h.deploy_token || '')}`,
    `NODE_NAME=${shellQuote(h.node_name || '')}`,
    `REGION=${shellQuote(h.region || '')}`,
    `SERVER_IP=${shellQuote(h.server_addr || '')}`,
    `FRPS_BIND_PORT=${shellQuote(String(h.server_port || 7000))}`,
    `FRPS_TOKEN=${shellQuote(h.auth_token || '')}`,
    `PORT_START=${shellQuote(String(h.port_start || 20000))}`,
    `PORT_END=${shellQuote(String(h.port_end || 20199))}`,
    `BANDWIDTH_MBPS=${shellQuote(String(h.bandwidth_mbps || 0))}`,
    `NOTE=${shellQuote(h.note || '')}`,
    'FRP_CHANNEL=stable'
  ];
  return `${env.join(' ')} bash <(curl -fsSL ${NODE_INSTALL_SCRIPT_URL})`;
}

function copyHostWizardScript(){
  const el = document.querySelector('#hwScriptCmd');
  if(!el) return;
  copyText(el.textContent.trim());
}

async function checkHostWizardStatus(silent){
  if(!hostWizard.host) return;
  try{
    const r = await api('/api/user/hosts');
    const list = r.hosts || [];
    const row = list.find(h => Number(h.id) === Number(hostWizard.host.host_id));
    const el = document.querySelector('#hwStatus');
    if(!row || !el) return;
    if(row.status === 'pending'){
      el.textContent = '已接入平台，已提交管理员审核';
      el.className = 'hw-status ok';
      if(hostWizard.timer){ clearInterval(hostWizard.timer); hostWizard.timer = null; }
    } else if(row.status === 'approved'){
      el.textContent = '审核通过，节点与套餐已上架';
      el.className = 'hw-status ok';
      if(hostWizard.timer){ clearInterval(hostWizard.timer); hostWizard.timer = null; }
    } else {
      el.textContent = '等待母鸡接入…';
    }
  }catch(e){ if(!silent) show(e.message, true); }
}

let userNotifyState = { cfg: null, channels: [], events: {} };

async function fetchUserNotifyConfig(){
  const data = await api('/api/user/notify-config');
  userNotifyState.cfg = data.config || {};
  userNotifyState.channels = data.channels || [];
  userNotifyState.events = data.events || {};
  return userNotifyState;
}

function userNotifyFieldsHtml(type, params){
  const ch = userNotifyState.channels.find(c => c.type === type);
  if(!ch) return '<p class="muted small">请先选择通知方式</p>';
  return (ch.fields || []).map(f => adminNotifyFieldHtml(f, params || {})).join('');
}

function userNotifyChannelSvg(type){
  const svg = NOTIFY_CHANNEL_SVG[type];
  return svg ? `<svg viewBox="0 0 24 24" class="chip-svg">${svg}</svg>`
             : `<svg viewBox="0 0 24 24" class="chip-svg chip-svg-link">${NOTIFY_LINK_ICON}</svg>`;
}

function userNotifyCardHtml(){
  const cfg = userNotifyState.cfg || {};
  const channels = userNotifyState.channels || [];
  const events = userNotifyState.events || {};
  const cur = cfg.type || (channels[0] || {}).type || '';
  const curCh = channels.find(c => c.type === cur);
  const params = cfg.params || {};
  const selected = new Set(cfg.events || []);
  const ready = !!(curCh && (curCh.fields || []).filter(f => f.required).every(f => String(params[f.key] || '').trim() !== ''));
  const enabled = !!cfg.enabled && !!cur;
  const eventRows = Object.entries(events).map(([k, label]) => `<label class="check"><input type="checkbox" name="events" value="${esc(k)}"${selected.has(k) ? ' checked' : ''}> ${esc(label)}</label>`).join('');
  const chips = channels.map(c => `<button type="button" class="notify-chip${c.type === cur ? ' active' : ''}" data-channel="${esc(c.type)}" data-name="${esc(c.name)}" onclick="openUserNotifyConfig('${esc(c.type)}')"><span class="chip-ico">${userNotifyChannelSvg(c.type)}</span>${esc(c.name)}</button>`).join('');
  const groups = channels.map(c => `<div class="notify-channel-fields" data-channel="${esc(c.type)}" style="display:${c.type === cur ? 'grid' : 'none'}">${(c.fields || []).map(f => adminNotifyFieldHtml(f, params)).join('')}</div>`).join('');
  return `<section class="card admin-notify-card user-notify" style="grid-column:1/-1">
    <div class="settings-card-head"><span class="settings-card-icon icon-blue">${stIcon('bell')}</span><div><h2>通知设置</h2><p>选择你希望接收的通知渠道和事件；站内通知始终保留。</p></div><span class="status-badge ${enabled && ready ? 'ok' : 'bad'}"><i></i>${enabled && ready ? '已启用' : (enabled ? '待完善' : '未启用')}</span></div>
    <form id="userNotifyForm" class="settings-form">
      <div class="notify-row notify-row-duo">
        <div class="notify-cell"><div class="notify-row-label"><label>通知开关</label></div><div class="notify-row-control"><label class="switch"><input type="checkbox" name="enabled" value="1"${cfg.enabled ? ' checked' : ''} onchange="syncUserNotifySwitch(this)"><span class="switch-track"><span class="switch-thumb"></span></span></label><span class="switch-state" id="userNotifySwitchState">${cfg.enabled ? '已开启' : '已关闭'}</span></div></div>
        <div class="notify-cell"><div class="notify-row-label"><label>通知方式</label></div><div class="notify-row-control"><b id="userNotifyCurName" style="font-size:13px;color:var(--text)">${esc(curCh ? curCh.name : '未选择')}</b></div></div>
      </div>
      <div class="notify-row notify-row-block"><div class="notify-row-label"><label>通知渠道</label></div><div class="notify-chips">${chips || '<span class="muted small">暂无可用的通知渠道</span>'}</div></div>
      <input type="hidden" name="notify_type" id="userNotifyType" value="${esc(cur)}">
      <div class="notify-row notify-row-block"><div class="notify-row-label"><label>接收哪些事件</label></div><div class="notify-row-control" style="justify-content:flex-start;flex-wrap:wrap;gap:10px 18px">${eventRows || '<span class="muted small">暂无可选事件</span>'}</div></div>
      <div class="form-actions"><button type="submit">保存设置</button><button type="button" class="secondary" onclick="testUserNotify()">发送测试</button></div>
      <div id="userNotifyConfigModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="userNotifyConfigTitle" onclick="if(event.target===this)closeUserNotifyConfig()">
        <section class="modal-page card notify-config-modal" style="width:min(720px,100%)">
          <div class="section-title modal-title"><div><h2 id="userNotifyConfigTitle">渠道配置</h2><p>填写该渠道的参数，点「保存设置」后生效。</p></div><button type="button" class="secondary modal-close" onclick="closeUserNotifyConfig()">关闭 ×</button></div>
          <div class="notify-config">${groups}</div>
          <div class="form-actions"><button type="button" onclick="closeUserNotifyConfig()">完成</button></div>
        </section>
      </div>
    </form>
    <p class="settings-hint">渠道凭证只保存在你的账号下；同一事件每天最多提醒一次，避免打扰。</p>
  </section>`;
}

function selectUserNotifyChannel(type){
  type = type || '';
  const inp = document.querySelector('#userNotifyType');
  if(inp) inp.value = type;
  const form = document.querySelector('#userNotifyForm');
  if(!form) return;
  let activeName = '';
  form.querySelectorAll('.notify-chip[data-channel]').forEach(c => {
    const on = (c.dataset.channel || '') === type;
    c.classList.toggle('active', on);
    if(on) activeName = c.dataset.name || '';
  });
  form.querySelectorAll('.notify-channel-fields').forEach(g => { g.style.display = (g.dataset.channel === type) ? 'grid' : 'none'; });
  const cur = document.querySelector('#userNotifyCurName');
  if(cur) cur.textContent = activeName || '未选择';
}

function openUserNotifyConfig(type){
  selectUserNotifyChannel(type);
  const modal = document.querySelector('#userNotifyConfigModal');
  if(modal) modal.classList.remove('hidden');
}

function closeUserNotifyConfig(){
  const modal = document.querySelector('#userNotifyConfigModal');
  if(modal) modal.classList.add('hidden');
}

function syncUserNotifySwitch(el){
  const s = document.querySelector('#userNotifySwitchState');
  if(s) s.textContent = (el && el.checked) ? '已开启' : '已关闭';
}

function initUserNotifyForm(){
  const form = document.querySelector('#userNotifyForm');
  if(!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = { enabled: fd.get('enabled') ? '1' : '0', type: fd.get('notify_type') || '', events: fd.getAll('events'), params: {} };
    const ch = userNotifyState.channels.find(c => c.type === body.type);
    (ch ? ch.fields : []).forEach(f => { body.params[f.key] = fd.get(f.key) || ''; });
    try{
      const r = await api('/api/user/notify-config', {method:'POST', body});
      await loadDashboard('profile');
      show(r.message || '通知设置已保存');
    }catch(err){ show(err.message, true); }
  };
}

async function testUserNotify(){
  try{
    const r = await api('/api/user/notify-test', {method:'POST', body:{}});
    show(r.message || '已发送');
  }catch(err){ show(err.message || '发送失败', true); }
}

async function loadHosts(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let data, pdata, plData, eData;
  try{
    [data, pdata, plData, eData] = await Promise.all([
      api('/api/user/hosts'),
      api('/api/user/provider/nodes').catch(() => ({nodes: []})),
      api('/api/user/provider/plans').catch(() => ({plans: []})),
      api('/api/user/provider/earnings').catch(() => ({earnings: [], total_net: 0, commission_pct: 10}))
    ]);
  }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const hosts = data.hosts || [];
  const pNodes = pdata.nodes || [];
  const pPlans = plData.plans || [];
  const pEarn = eData.plans || [];
  const pTotal = Number(eData.total_paid || 0);
  const pGuarantee = Number(eData.guarantee || 0);
  const pIncome = Number(eData.income || 0);
  window.__providerIncome = pIncome;
  const pct = Number(eData.commission_pct ?? 10);
  const tab = hostsTab || 'nodes';
  const nodesSection = `<section class="card"><div class="section-title"><div><h2>${stIcon('node')}我的节点</h2><p>${pNodes.length ? '已接入平台的主机' : '提交母鸡并通过审核后，这里会显示你的节点'}</p></div></div>
      ${pNodes.length ? `<div class="table-wrap"><table><thead><tr><th>序号</th><th>节点</th><th>地区</th><th>接入地址</th><th>端口（已用/总）</th><th>本月流量</th><th>实例</th><th>状态</th><th>到期时间</th><th>上次在线</th></tr></thead><tbody>
        ${pNodes.map((n, i) => `<tr><td>${i + 1}</td><td><b>${esc(n.name)}</b></td><td>${esc(n.region)}</td><td>${esc(n.server_addr)}:${n.server_port}</td><td>${n.ports_used} / ${n.ports_total}</td><td>${fmtBytes(n.month_used_bytes)} / ${n.monthly_traffic_bytes > 0 ? fmtBytes(n.monthly_traffic_bytes) : '不限'}</td><td>${n.active_plans}</td><td><span class="status-badge ${n.auto_suspended ? 'bad' : (n.active ? 'ok' : 'bad')}"><i></i>${n.auto_suspended ? '已停售' : (n.active ? '在线' : '已停用')}</span></td><td>${n.expires_at ? fmtTs(n.expires_at) : '-'}</td><td>${n.last_online_at ? fmtTs(n.last_online_at) : '-'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty-state"><strong>还没有节点</strong><p class="muted small">点右上角「添加母鸡」，审核通过后自动成为你的节点。</p></div>'}
    </section>`;
  const plansSection = `<section class="card"><div class="section-title"><div><h2>${stIcon('license')}我的套餐</h2><p>${pNodes.length ? '上架后买家可在该节点购买' : '先有节点，才能上架套餐'}</p></div><button type="button" onclick="providerPlanForm()" ${pNodes.length ? '' : 'disabled'}>＋ 上架套餐</button></div>
      <div class="table-wrap"><table><thead><tr><th>序号</th><th>名称</th><th>节点</th><th>计费</th><th>价格</th><th>端口</th><th>时长/流量</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${pPlans.length ? pPlans.map((pl, i) => `<tr><td>${i + 1}</td><td><b>${esc(pl.name)}</b></td><td>${esc((pNodes.find(n => Number(n.id) === Number(pl.node_id)) || {}).name || ('#' + pl.node_id))}</td><td>${pl.billing_mode === 'traffic' ? '流量' : '时间'}</td><td>¥${fmtPts(pl.price)}</td><td>${pl.max_ports}</td><td>${pl.billing_mode === 'traffic' ? pl.traffic_limit_gb + ' GB' : pl.duration_days + ' 天'}</td><td><span class="status-badge ${pl.active ? 'ok' : 'bad'}"><i></i>${pl.active ? '在售' : '下架'}</span></td><td class="actions node-actions"><button type="button" class="node-action" onclick='providerPlanForm(${pl.id})'>编辑</button><button type="button" class="node-action node-action-danger" onclick="providerPlanDelete(${pl.id})">下架</button></td></tr>`).join('') : '<tr><td colspan="9" class="muted">还没有上架套餐</td></tr>'}
      </tbody></table></div>
    </section>`;
  const earnSection = `<section class="card"><div class="section-title"><div><h2>${stIcon('bolt')}收益</h2><p>按服务进度结算：${100 - pct}% 到账，${pct}% 留存为保证金</p></div><span class="section-count">已结算 ¥${fmtPts(pTotal)} · 保证金 ¥${fmtPts(pGuarantee)}</span></div>
      <div class="row" style="gap:10px;align-items:center;margin:6px 0 12px">
        <span class="muted small">可提现收益</span><b style="font-size:18px">¥${fmtPts(pIncome)}</b>
        <button type="button" onclick="loadPayoutTickets()" ${pIncome > 0 ? '' : 'disabled'}>提现</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>实例</th><th>节点</th><th>套餐价</th><th>已结算</th><th>保证金</th><th>进度</th><th>状态</th></tr></thead><tbody>
      ${pEarn.length ? pEarn.map(e => `<tr><td><b>${esc(e.plan_name || '-')}</b></td><td>${esc(e.node_name || ('#' + e.node_id))}</td><td>¥${fmtPts(e.price)}</td><td><b>¥${fmtPts(e.paid)}</b></td><td>¥${fmtPts(e.guarantee)}</td><td>${Math.round(Number(e.progress || 0) * 100)}%</td><td>${e.status === 'active' ? '服务中' : (e.status === 'expired' ? '已到期' : (e.status === 'exhausted' ? '流量用尽' : '已退订'))}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">暂无收益记录</td></tr>'}
      </tbody></table></div>
      <p class="muted small" style="margin-top:10px">保证金在服务正常到期后转为平台服务费；提前清退或节点故障时，一半补偿买家，一半归平台。</p>
    </section>`;
  const hostsSection = `<section class="card"><div class="section-title"><div><h2>${stIcon('cloud')}申请记录</h2><p>共 ${hosts.length} 条，包含待审核与被拒绝的母鸡</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>序号</th><th>名称</th><th>地区</th><th>接入地址</th><th>到期时间</th><th>带宽 / 流量</th><th>状态</th><th>提交时间</th></tr></thead><tbody>${hostRowsHtml(hosts, false)}</tbody></table></div>
    </section>`;
  const sections = { nodes: nodesSection, plans: plansSection, earn: earnSection, hosts: hostsSection };
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">HOSTING</span><h1>托管申请</h1><p>提交母鸡、上架套餐、查看收益与申请记录。</p></div>
      <div class="row" style="gap:10px"><button type="button" class="secondary" onclick="loadHosts()">刷新</button><button type="button" onclick="hostFormModal()">＋ 添加母鸡</button></div></div>
    <nav class="seg-tabs">
      <button type="button" class="seg-tab${tab === 'nodes' ? ' active' : ''}" onclick="switchHostsTab('nodes')">我的节点${pNodes.length ? `<span>${pNodes.length}</span>` : ''}</button>
      <button type="button" class="seg-tab${tab === 'plans' ? ' active' : ''}" onclick="switchHostsTab('plans')">我的套餐${pPlans.length ? `<span>${pPlans.length}</span>` : ''}</button>
      <button type="button" class="seg-tab${tab === 'earn' ? ' active' : ''}" onclick="switchHostsTab('earn')">收益</button>
      <button type="button" class="seg-tab${tab === 'hosts' ? ' active' : ''}" onclick="switchHostsTab('hosts')">申请记录${hosts.length ? `<span>${hosts.length}</span>` : ''}</button>
    </nav>
    ${sections[tab] || sections.nodes}
  `, 'dashboard-hosts', '托管申请');
}

function switchHostsTab(tab){
  hostsTab = tab;
  loadHosts();
}

let ticketsTab = 'mine';
const TICKET_STATUS = { open: '待处理', processing: '处理中', closed: '已关闭', rejected: '已拒绝' };
const TICKET_STATUS_CLASS = { open: 'tk-open', processing: 'tk-processing', closed: 'tk-closed', rejected: 'tk-rejected' };
const ticketStatusBadge = (status) => `<span class="status-badge ${TICKET_STATUS_CLASS[status] || ''}"><i></i>${TICKET_STATUS[status] || esc(status)}</span>`;
const TICKET_KIND = { issue: '问题工单', withdraw: '提现工单', host: '托管申请' };

async function loadTickets(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let mine = [], received = [], nodes = [], plans = [];
  try{
    const [a, b, c, d] = await Promise.all([
      api('/api/user/tickets'),
      api('/api/provider/tickets').catch(() => ({tickets: []})),
      api('/api/user/nodes').catch(() => ({nodes: []})),
      api('/api/dashboard').catch(() => ({my_plans: []}))
    ]);
    mine = (a.tickets || []).filter(t => (t.kind || 'issue') === 'issue');
  received = (b.tickets || []).filter(t => (t.kind || 'issue') === 'issue');
  nodes = c.nodes || []; plans = d.my_plans || [];
  }catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const nodeById = {}; nodes.forEach(n => { nodeById[Number(n.id)] = n; });
  const myNodeIds = [...new Set(plans.filter(p => p.status !== 'cancelled').map(p => Number(p.node_id)))].filter(Boolean);
  window.__ticketNodes = myNodeIds.map(id => ({ id, name: (nodeById[id] || {}).name || ('#' + id), region: (nodeById[id] || {}).region || '' }));
  const list = ticketsTab === 'mine' ? mine : received;
  const rows = list.map((t, i) => {
    const need = ticketsTab === 'received' ? t.status === 'open' : t.status === 'processing';
    const needText = ticketsTab === 'received' ? '待处理' : '待你确认';
    const statusBadge = need
      ? `<span class="status-badge warn"><i></i>${needText}</span>`
      : `${ticketStatusBadge(t.status)}`;
    return `<tr class="clickable-row${need ? ' need-action' : ''}" onclick="loadTicketDetail(${t.id})">
      <td>${i + 1}</td>
      <td>${esc(t.ticket_no)}</td>
      <td>${TICKET_KIND[t.kind] || t.kind}</td>
      <td>${esc(t.title)}</td>
      <td>${t.node_id ? esc(t.node_name || (nodeById[Number(t.node_id)] || {}).name || ('#' + t.node_id)) : '不关联'}</td>
      <td>${statusBadge}</td>
      <td>${fmtTs(t.created_at)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">${ticketsTab === 'mine' ? '还没有提交过工单' : '还没有收到工单'}</td></tr>`;
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">TICKETS</span><h1>故障工单</h1><p>节点或实例出现故障时，提交工单通知机主处理。</p></div>
      <div class="row" style="gap:10px"><button type="button" class="secondary" onclick="loadTickets()">刷新</button><button type="button" onclick="loadTicketNew()">＋ 新建工单</button></div></div>
    <nav class="seg-tabs">
      <button type="button" class="seg-tab${ticketsTab === 'mine' ? ' active' : ''}" onclick="switchTicketsTab('mine')">我提交的${mine.length ? `<span>${mine.length}</span>` : ''}</button>
      <button type="button" class="seg-tab${ticketsTab === 'received' ? ' active' : ''}" onclick="switchTicketsTab('received')">我收到的${received.length ? `<span>${received.length}</span>` : ''}</button>
    </nav>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>序号</th><th>编号</th><th>类型</th><th>标题</th><th>节点</th><th>状态</th><th>提交时间</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  `, 'dashboard-tickets', '工单');
}

function switchTicketsTab(tab){ ticketsTab = tab; loadTickets(); }

function ticketBodyHtml(c){
  const raw = String(c || '');
  if(/<[a-z][\s\S]*>/i.test(raw)) return raw;
  return esc(raw).replace(/\n/g, '<br>');
}

async function uploadImage(file, kind){
  if(!file || !file.type || !file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if(file.size > 3 * 1024 * 1024) throw new Error('图片不能超过 3MB');
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
  const r = await api('/api/user/upload', {method:'POST', body:{kind, mime:file.type, data:dataUrl}});
  return r.token;
}

function payoutStatusMeta(status){
  if(status === 'paid') return { cls: 'ok', text: '已打款' };
  if(status === 'pending') return { cls: 'warn', text: '待处理' };
  if(status === 'cancelled') return { cls: '', text: '已撤销' };
  return { cls: 'bad', text: '已拒绝' };
}

function payoutBadge(status){
  const m = payoutStatusMeta(status);
  return `<span class="status-badge ${m.cls}"><i></i>${m.text}</span>`;
}

function showImageViewer(url){
  if(!url) return;
  const old = document.querySelector('#imgViewer');
  if(old) old.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="img-viewer" id="imgViewer" onclick="if(event.target===this)closeImageViewer()">
    <img src="${esc(url)}" alt="预览">
    <button type="button" class="img-viewer-close" onclick="closeImageViewer()" aria-label="关闭">×</button>
  </div>`);
  if(!window.__imgViewerKey){
    window.__imgViewerKey = true;
    document.addEventListener('keydown', e => { if(e.key === 'Escape') closeImageViewer(); });
  }
}

function closeImageViewer(){
  const el = document.querySelector('#imgViewer');
  if(el) el.remove();
}

function attsHtml(tokens){
  let list = Array.isArray(tokens) ? tokens : [];
  if(!list.length && typeof tokens === 'string' && tokens.trim()){
    try{ const parsed = JSON.parse(tokens); if(Array.isArray(parsed)) list = parsed; }catch(e){}
  }
  if(!list.length) return '';
  return `<div class="ticket-atts">${list.map(t => `<img src="/api/upload/${encodeURIComponent(t)}" alt="附件" onclick="showImageViewer('/api/upload/${encodeURIComponent(t)}')">`).join('')}</div>`;
}

function tkCmd(cmd){
  document.execCommand(cmd, false, null);
  const ed = document.querySelector('#tkEditor');
  if(ed) ed.focus();
}

async function loadTicketNew(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let nodes = [], plans = [];
  try{
    const [a, b] = await Promise.all([
      api('/api/user/nodes').catch(() => ({nodes: []})),
      api('/api/dashboard').catch(() => ({my_plans: []}))
    ]);
    nodes = a.nodes || []; plans = b.my_plans || [];
  }catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const nodeById = {}; nodes.forEach(n => { nodeById[Number(n.id)] = n; });
  const ids = [...new Set(plans.filter(p => p.status !== 'cancelled').map(p => Number(p.node_id)))].filter(Boolean);
  const opts = '<option value="0">不关联实例</option>' + ids.map(id => `<option value="${id}">${esc((nodeById[id] || {}).name || ('#' + id))}（${esc((nodeById[id] || {}).region || '')}）</option>`).join('');
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">TICKETS</span><h1>提交故障工单</h1><p>描述节点或实例的故障，机主会收到通知并处理。</p></div>
      <button type="button" class="secondary" onclick="loadTickets()">‹ 返回</button></div>
    <section class="tk-panel">
      <label class="tk-field"><span>工单主题</span><input id="tkSubject" maxlength="80" placeholder="简述您遇到的问题"></label>
      <label class="tk-field"><span>关联实例</span><select id="tkNode">${opts}</select></label>
      <div class="tk-field"><span>沟通内容</span>
        <div class="tk-editor-wrap">
          <div class="tk-toolbar">
            <button type="button" title="加粗" onclick="tkCmd('bold')"><b>B</b></button>
            <button type="button" title="斜体" onclick="tkCmd('italic')"><i>I</i></button>
            <button type="button" title="下划线" onclick="tkCmd('underline')"><u>U</u></button>
            <button type="button" title="列表" onclick="tkCmd('insertUnorderedList')">• 列表</button>
            <button type="button" title="插入图片" onclick="document.querySelector('#tkFile').click()">🖼 图片</button>
            <input type="file" id="tkFile" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
          </div>
          <div id="tkEditor" class="tk-editor" contenteditable="true" data-placeholder="出现时间、现象、已尝试的操作..."></div>
        </div>
      </div>
      <div id="tkAtts" class="tk-atts"></div>
      <button type="button" class="tk-submit" id="tkSubmit">提交</button>
    </section>
  `, 'dashboard-tickets', '故障工单');
  window.__tkAtts = [];
  const fileInput = document.querySelector('#tkFile');
  if(fileInput) fileInput.onchange = async () => {
    for(const f of Array.from(fileInput.files || [])){
      try{ window.__tkAtts.push(await uploadImage(f, 'ticket')); }catch(err){ show(err.message || '图片上传失败', true); }
    }
    fileInput.value = '';
    renderTicketAtts();
  };
  renderTicketAtts();
  const submit = document.querySelector('#tkSubmit');
  submit.onclick = async () => {
    const title = document.querySelector('#tkSubject').value.trim();
    const nodeId = Number(document.querySelector('#tkNode').value || 0);
    const ed = document.querySelector('#tkEditor');
    if(!title){ show('请填写工单主题', true); return; }
    if(!ed.innerText.trim()){ show('请填写沟通内容', true); return; }
    submit.disabled = true;
    try{
      const r = await api('/api/user/tickets/create', {method:'POST', body:{node_id:nodeId, title, content:ed.innerHTML, attachments:window.__tkAtts || []}});
      show(r.message || '已提交'); await loadTickets();
    }catch(err){ show(err.message || '提交失败', true); submit.disabled = false; }
  };
}

async function loadPayoutTickets(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let income = 0, payouts = [], acc = { method: 'alipay', account: '', holder: '', qr_token: '' };
  try{
    const [a, b] = await Promise.all([api('/api/user/payouts'), api('/api/user/payout-account')]);
    income = Number(a.income || 0); payouts = a.payouts || []; acc = b.account || acc;
  }catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const hasAcc = !!(acc.account && acc.holder);
  const rows = payouts.map((p, i) => `<tr class="${p.ticket_id ? 'clickable-row' : ''}"${p.ticket_id ? ` onclick="loadTicketDetail(${p.ticket_id})"` : ''}><td>${i + 1}</td><td>${esc(p.payout_no)}</td><td><b>¥${fmtPts(p.amount)}</b></td><td>${esc(p.method)}</td><td>${esc(p.account)}</td><td>${payoutBadge(p.status)}</td><td>${fmtTs(p.created_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">暂无提现记录</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">PAYOUTS</span><h1>提现工单</h1><p>把托管收益转入余额，或提现到已配置的收款账户。</p></div></div>
    <section class="card"><div class="section-title"><div><h2>${stIcon('key')}申请提现</h2><p>可提现收益 <b>¥${fmtPts(income)}</b>${hasAcc ? '' : ' · 尚未配置收款信息'}</p></div><span class="section-count">${hasAcc ? esc(acc.method + ' ' + acc.account) : '未配置'}</span></div>
      <form id="withdrawForm" class="grid">
        <div><label>提现方式</label><select name="mode"><option value="balance">转入余额</option><option value="external"${hasAcc ? '' : ' disabled'}>提现到收款账户</option></select></div>
        <div><label>提现金额（元）</label><input name="amount" type="number" min="0.01" step="0.01" max="${income}" value="${income > 0 ? fmtPts(income) : ''}" ${income > 0 ? '' : 'disabled'}></div>
        <div class="span-2 muted small">${hasAcc ? '收款信息可在「个人中心」修改。' : '提现到收款账户前，请先在「个人中心」配置收款信息。'}</div>
        <div class="form-actions span-2"><button type="submit" ${income > 0 ? '' : 'disabled'}>提交提现工单</button></div>
      </form>
    </section>
    <section class="card"><div class="section-title"><div><h2>提现记录</h2><p>共 ${payouts.length} 条</p></div></div><div class="table-wrap"><table><thead><tr><th>序号</th><th>单号</th><th>金额</th><th>方式</th><th>账号</th><th>状态</th><th>时间</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  `, 'dashboard-payouts', '提现工单');
  const form = document.querySelector('#withdrawForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    try{
      const r = await api('/api/user/withdraw', {method:'POST', body:{mode:fd.mode, amount:Number(fd.amount)}});
      show(r.message || '已提交'); await loadPayoutTickets();
    }catch(err){ show(err.message || '提现失败', true); }
  };
}

async function loadTicketDetail(id, scope){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  const isAdminView = scope === 'admin';
  let data;
  try{ data = await api('/api/user/tickets?id=' + Number(id)); }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const t = data.ticket || {};
  const msgs = data.messages || [];
  const payout = data.payout || null;
  window.__currentTicketId = Number(id);
  const isClosed = t.status === 'closed';
  const kind = t.kind || 'issue';
  const isWithdraw = kind === 'withdraw';
  const isHost = kind === 'host';
  const backFn = isWithdraw ? (isAdminView ? 'loadAdminPayouts()' : 'loadPayoutTickets()')
               : isHost ? (isAdminView ? 'loadAdminHosts()' : 'loadHosts()')
               : (isAdminView ? 'loadAdminTickets()' : 'loadTickets()');
  const listLabel = isWithdraw ? '提现工单' : (isHost ? '托管申请' : '故障工单');
  const payoutMatch = String(t.content || '').match(/PO[0-9A-Za-z]{6,}/);
  const displayNo = isWithdraw && payoutMatch ? payoutMatch[0] : (t.ticket_no || '');
  const navKind = isWithdraw ? (isAdminView ? 'admin-payouts' : 'dashboard-payouts')
                : isHost ? (isAdminView ? 'admin-hosts' : 'dashboard-hosts')
                : (isAdminView ? 'admin-tickets' : 'dashboard-tickets');
  const thread = [
    `<div class="ticket-msg user"><div class="ticket-msg-head"><b>${esc(t.username || '')}</b><span>用户 · ${fmtTs(t.created_at)}</span></div><p>${ticketBodyHtml(t.content)}</p>${attsHtml(t.attachments)}</div>`,
    ...msgs.map(m => `<div class="ticket-msg ${m.role}"><div class="ticket-msg-head"><b>${esc(m.username)}</b><span>${m.role === 'owner' ? '机主' : (m.role === 'admin' ? '管理员' : '用户')} · ${fmtTs(m.created_at)}</span></div><p>${ticketBodyHtml(m.content)}</p>${attsHtml(m.attachments)}</div>`)
  ].join('');
  app.innerHTML = appLayoutHtml(`
    <div class="page-head-row">
      ${instCrumbBar(displayNo, [{ label: listLabel, onclick: backFn }])}
      <div class="row" style="gap:10px"><button type="button" class="secondary" onclick="${backFn}">‹ 返回${listLabel}</button></div>
    </div>
    <p class="ticket-detail-title">${esc(t.title || '')}</p>
    ${payout ? `<section class="card payout-panel">
        <div class="section-title"><div><h2>${stIcon('key')}提现单 ${esc(payout.payout_no)}</h2><p>${payoutStatusMeta(payout.status).text}</p></div>
          ${payoutBadge(payout.status)}</div>
        <div class="payout-panel-grid">
          <div><span>金额</span><b>¥${fmtPts(payout.amount)}</b></div>
          <div><span>方式</span><b>${esc(payout.method)}</b></div>
          <div><span>账号</span><b>${esc(payout.account)}</b></div>
          <div><span>姓名</span><b>${esc(payout.holder)}</b></div>
          ${payout.qr_token ? `<div class="payout-qr"><span>收款码</span><img src="/api/upload/${encodeURIComponent(payout.qr_token)}" alt="收款码" onclick="showImageViewer('/api/upload/${encodeURIComponent(payout.qr_token)}')"></div>` : ''}
        </div>
      </section>` : ''}
    <div class="ticket-layout">
      <section class="card ticket-main">
        <div class="section-title"><div><h2>${stIcon('log')}沟通记录</h2><p>${isWithdraw ? '与用户确认收款信息与打款进度' : '用户与机主在本页沟通，图片可点开查看原图'}</p></div>${payout ? '' : ticketStatusBadge(t.status)}</div>
        <div class="ticket-thread">${thread}</div>
        ${isClosed ? `<p class="muted small">该工单已关闭${t.resolution ? ' · 处理结果：' + ticketBodyHtml(t.resolution) : ''}</p>` : `
        <div class="ticket-reply">
          <label class="tk-field"><span>回复内容</span><textarea id="tkReplyText" rows="4" placeholder="输入回复内容"></textarea></label>
          <div class="row" style="gap:8px;align-items:center">
            <button type="button" class="secondary" onclick="document.querySelector('#tkReplyFile').click()">＋ 图片</button>
            <input type="file" id="tkReplyFile" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
            <div id="tkReplyAtts" class="tk-atts"></div>
            <button type="button" id="tkReplySubmit" style="margin-left:auto">发送</button>
          </div>
        </div>`}
      </section>
      <aside class="card ticket-side">
        <div class="section-title"><div><h2>${isWithdraw ? '提现信息' : (isHost ? '申请信息' : '工单信息')}</h2></div>${payout ? `${payoutBadge(payout.status)}` : ''}</div>
        <div class="instance-action-meta">
          <div><span>编号</span><b>${esc(displayNo)}</b></div>
          <div><span>类型</span><b>${TICKET_KIND[t.kind] || t.kind}</b></div>
          ${isWithdraw ? '' : `<div><span>实例节点</span><b>${t.node_id ? esc(t.node_name || ('#' + t.node_id)) : '不关联'}</b></div>`}
          ${payout ? '' : `<div><span>状态</span><b>${TICKET_STATUS[t.status] || t.status}</b></div>`}
          <div><span>创建时间</span><b>${fmtTs(t.created_at)}</b></div>
        </div>
        <div class="ticket-side-actions">
          ${isWithdraw && isAdminView && payout && payout.status === 'pending' ? `<button type="button" onclick="reviewPayoutInTicket(${Number(payout.id)}, 'paid')">已打款</button><button type="button" class="secondary" onclick="reviewPayoutInTicket(${Number(payout.id)}, 'reject')">拒绝</button>` : ''}
          ${isHost && isAdminView && !isClosed ? `<button type="button" onclick="hostReview(${Number(t.host_id || 0)}, 'approve')">通过审核</button><button type="button" class="secondary" onclick="hostReview(${Number(t.host_id || 0)}, 'reject')">拒绝</button><button type="button" class="node-action node-action-danger" onclick="hostReview(${Number(t.host_id || 0)}, 'blacklist')">拉黑</button>` : ''}
          ${!isClosed ? `<button type="button" class="secondary" onclick="closeTicket(${Number(t.id)}, '${isAdminView ? 'admin' : 'user'}')">${isAdminView ? '结束工单' : '撤销工单'}</button>` : ''}
        </div>
      </aside>
    </div>
  `, navKind, listLabel);
  window.__replyAtts = [];
  const fileInput = document.querySelector('#tkReplyFile');
  if(fileInput) fileInput.onchange = async () => {
    for(const f of Array.from(fileInput.files || [])){
      try{ window.__replyAtts.push(await uploadImage(f, 'ticket')); }catch(err){ show(err.message || '上传失败', true); }
    }
    fileInput.value = '';
    renderReplyAtts();
  };
  renderReplyAtts();
  const btn = document.querySelector('#tkReplySubmit');
  if(btn) btn.onclick = async () => {
    const text = document.querySelector('#tkReplyText').value.trim();
    if(!text && !(window.__replyAtts || []).length){ show('请输入回复内容或上传图片', true); return; }
    btn.disabled = true;
    try{
      await api('/api/user/tickets/reply', {method:'POST', body:{id:Number(t.id), content:text, attachments:window.__replyAtts || []}});
      await loadTicketDetail(t.id, scope);
    }catch(err){ show(err.message || '发送失败', true); btn.disabled = false; }
  };
}

function renderTicketAtts(){
  const box = document.querySelector('#tkAtts');
  if(!box) return;
  const list = window.__tkAtts || [];
  box.innerHTML = list.map((tok, i) => `<span class="tk-att"><img src="/api/upload/${encodeURIComponent(tok)}" alt=""><button type="button" onclick="removeTicketAtt(${i})">×</button></span>`).join('');
}

function removeTicketAtt(i){
  (window.__tkAtts || []).splice(i, 1);
  renderTicketAtts();
}

function renderReplyAtts(){
  const box = document.querySelector('#tkReplyAtts');
  if(!box) return;
  const list = window.__replyAtts || [];
  box.innerHTML = list.map((tok, i) => `<span class="tk-att"><img src="/api/upload/${encodeURIComponent(tok)}" alt=""><button type="button" onclick="removeReplyAtt(${i})">×</button></span>`).join('');
}
function removeReplyAtt(i){ (window.__replyAtts || []).splice(i, 1); renderReplyAtts(); }

async function reviewPayoutInTicket(pid, action){
  const label = action === 'paid' ? '标记为已打款' : '拒绝该提现';
  if(!await appConfirm(`确认${label}？`, {title:'提现处理', okText:'确认', danger: action !== 'paid'})) return;
  try{
    const r = await api('/api/admin/payouts/review', {method:'POST', body:{id:Number(pid), action}});
    show(r.message || '已处理');
    if(window.__currentTicketId) await loadTicketDetail(window.__currentTicketId, 'admin');
  }catch(err){ show(err.message, true); }
}

async function closeTicket(id, scope){
  const isAdmin = scope === 'admin';
  const resolution = await appPrompt(isAdmin ? '处理结果（可选，填了会展示在工单里）' : '撤销原因（可选，填了会展示在工单里）', '',
    {title: isAdmin ? '结束工单' : '撤销工单'});
  if(resolution === null) return;
  try{ await api('/api/user/tickets/close', {method:'POST', body:{id:Number(id), resolution}}); show(isAdmin ? '工单已结束' : '工单已撤销'); await loadTicketDetail(id, scope); }
  catch(err){ show(err.message, true); }
}

async function loadAdminTickets(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let tickets = [];
  try{ tickets = ((await api('/api/admin/tickets')).tickets || []).filter(t => (t.kind || 'issue') === 'issue'); }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const rows = tickets.map((t, i) => `<tr class="clickable-row" onclick="loadTicketDetail(${t.id}, 'admin')"><td>${i + 1}</td><td>${esc(t.ticket_no)}</td><td>${TICKET_KIND[t.kind] || t.kind}</td><td>${esc(t.title)}</td><td>${esc(t.username)}</td><td>${t.node_id ? esc(t.node_name || ('#' + t.node_id)) : '不关联'}</td><td>${ticketStatusBadge(t.status)}</td><td>${fmtTs(t.created_at)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">暂无工单</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">TICKETS</span><h1>故障工单</h1><p>全部用户提交的故障工单</p></div></div>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>序号</th><th>编号</th><th>类型</th><th>标题</th><th>提交人</th><th>节点</th><th>状态</th><th>时间</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  `, 'admin-tickets', '工单');
}

async function loadAdminAnnouncements(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let list = [];
  try{ list = (await api('/api/admin/announcements')).announcements || []; }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const rows = list.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.title)}</b></td><td>${esc(String(a.content || '').replace(/<[^>]+>/g, '').slice(0, 60))}</td><td><span class="status-badge ${a.kind === 'notice' ? 'tk-processing' : 'tk-closed'}"><i></i>${a.kind === 'notice' ? '通知' : '公告'}</span></td><td><span class="status-badge ${a.active ? 'ok' : 'bad'}"><i></i>${a.active ? '展示中' : '已下架'}</span></td><td>${fmtTs(a.created_at)}</td><td class="actions node-actions">${a.active ? `<button class="node-action node-action-danger" onclick="deleteAnnouncement(${a.id})">下架</button>` : '<span class="muted small">—</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">暂无公告</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">ANNOUNCEMENTS</span><h1>系统公告</h1><p>发布后会显示在用户的「通知中心 › 系统公告」</p></div></div>
    <section class="card"><div class="section-title"><div><h2>${stIcon('bell')}发布公告</h2></div></div>
      <form id="annForm" class="grid">
        <div class="span-2"><label>发布类型</label><select name="kind"><option value="announcement">系统公告（展示在公告页签）</option><option value="notice">通知（推送到用户通知列表）</option></select></div>
        <div class="span-2"><label>标题</label><input name="title" maxlength="120" required></div>
        <div class="span-2"><label>内容</label><textarea name="content" rows="4" required placeholder="支持简单格式文本"></textarea></div>
        <div class="form-actions span-2"><button type="submit">发布</button></div>
      </form>
    </section>
    <section class="card"><div class="section-title"><div><h2>公告列表</h2><p>共 ${list.length} 条</p></div></div><div class="table-wrap"><table><thead><tr><th>序号</th><th>标题</th><th>内容</th><th>类型</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  `, 'admin-announcements', '公告');
  const form = document.querySelector('#annForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try{
      const r = await api('/api/admin/announcements/save', {method:'POST', body:Object.fromEntries(new FormData(form))});
      show(r.message || '已发布'); await loadAdminAnnouncements();
    }catch(err){ show(err.message || '发布失败', true); }
  };
}

async function deleteAnnouncement(id){
  if(!await appConfirm('下架后用户将看不到这条公告，确认？', {title:'下架公告', okText:'确认下架', danger:true})) return;
  try{ await api('/api/admin/announcements/delete', {method:'POST', body:{id:Number(id)}}); show('已下架'); await loadAdminAnnouncements(); }catch(err){ show(err.message, true); }
}

async function loadAdminOps(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let anns = [], keys = [];
  try{
    const [a, b] = await Promise.all([api('/api/admin/announcements'), api('/api/admin/recharge-keys')]);
    anns = a.announcements || []; keys = b.recharge_keys || [];
  }catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const annRows = anns.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.title)}</b><br><span class="muted small">${esc(String(a.content || '').replace(/<[^>]+>/g, '').slice(0, 40))}</span></td><td><span class="status-badge ${a.active ? 'ok' : 'bad'}"><i></i>${a.active ? '展示中' : '已下架'}</span></td><td>${fmtTs(a.created_at)}</td><td class="actions node-actions">${a.active ? `<button class="node-action node-action-danger" onclick="deleteAnnouncement(${a.id})">下架</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无公告</td></tr>';
  const keyRows = keys.map((k, i) => `<tr><td>${i + 1}</td><td><code class="token">${esc(k.key)}</code></td><td>¥${fmtPts(k.amount)}</td><td><span class="status-badge ${k.used_by ? 'bad' : (k.active ? 'ok' : '')}"><i></i>${k.used_by ? '已使用' : (k.active ? '可用' : '停用')}</span></td><td>${fmtTs(k.created_at)}</td><td class="actions node-actions">${k.used_by ? '—' : `<button type="button" class="node-action" onclick="rechargeKeyToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button type="button" class="node-action node-action-danger" onclick="rechargeKeyDelete(${k.id})">删除</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">还没有充值密钥</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">MAINTENANCE</span><h1>平台维护</h1><p>运维工具、系统公告与充值密钥</p></div></div>

    

    <div class="maint-grid">
      <section class="card maint-panel">
        <div class="section-title"><div><h2>${stIcon('bell')}系统公告</h2><p>发布后显示在用户通知中心</p></div><span class="section-count">${anns.length} 条</span></div>
        <form id="annForm" class="maint-form">
          <select name="kind"><option value="announcement">系统公告</option><option value="notice">通知</option></select>
          <input name="title" maxlength="120" placeholder="标题" required>
          <textarea name="content" rows="3" placeholder="内容" required></textarea>
          <div class="maint-form-actions"><button type="submit">发布</button></div>
        </form>
        <div class="maint-table"><table><thead><tr><th>#</th><th>公告</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${annRows}</tbody></table></div>
      </section>

      <section class="card maint-panel">
        <div class="section-title"><div><h2>${stIcon('key')}充值密钥</h2><p>生成后发给用户充值余额</p></div><span class="section-count">可用 ${keys.filter(k => !k.used_by && k.active).length}</span></div>
        <form id="rechargeKeyForm" class="maint-form">
          <div class="maint-form-row">
            <label><span>每枚金额（元）</span><input name="amount" type="number" min="0.01" step="0.01" value="100"></label>
            <label><span>生成数量</span><input name="count" type="number" min="1" max="500" value="1"></label>
            <label><span>有效期（天）</span><input name="duration_days" type="number" min="0" max="3650" value="0"></label>
          </div>
          <input name="note" placeholder="备注（订单号 / 客户名）">
          <div class="maint-form-actions"><button type="submit">生成密钥</button></div>
        </form>
        <div class="maint-table"><table><thead><tr><th>#</th><th>密钥</th><th>金额</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${keyRows}</tbody></table></div>
      </section>
    </div>
  `, 'admin-ops', '平台维护');
  const annForm = document.querySelector('#annForm');
  annForm.onsubmit = async (e) => {
    e.preventDefault();
    try{
      const r = await api('/api/admin/announcements/save', {method:'POST', body:Object.fromEntries(new FormData(annForm))});
      show(r.message || '已发布'); await loadAdminOps();
    }catch(err){ show(err.message || '发布失败', true); }
  };
  const keyForm = document.querySelector('#rechargeKeyForm');
  keyForm.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(keyForm);
    const body = {amount: fd.get('amount'), count: fd.get('count'), note: fd.get('note'), expires_days: fd.get('duration_days')};
    try{
      const r = await api('/api/admin/recharge-keys/create', {method:'POST', body});
      const list = r.keys || [];
      if(list.length) await copyText(list.join('\n'));
      await appAlert((r.message || '充值密钥已生成') + (list.length ? '\n已复制到剪贴板。' : ''), {title:'生成完成'});
      await loadAdminOps();
    }catch(err){ show(err.message, true); }
  };
}

async function loadAdminRecharge(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let data;
  try{ data = await api('/api/admin/recharge-keys'); }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const keys = data.recharge_keys || [];
  const rows = keys.map((k, i) => `<tr>
      <td>${i + 1}</td>
      <td><code class="token">${esc(k.key)}</code></td>
      <td>¥${fmtPts(k.amount)}</td>
      <td>${esc(k.note || '—')}</td>
      <td>${k.used_by ? '<span class="bad">已使用</span>' : (k.active ? '<span class="ok">可用</span>' : '<span class="bad">停用</span>')}</td>
      <td>${fmtTs(k.created_at)}</td>
      <td class="actions node-actions">${k.used_by ? '<span class="muted small">已使用</span>' : `<button type="button" class="node-action" onclick="rechargeKeyToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button type="button" class="node-action node-action-danger" onclick="rechargeKeyDelete(${k.id})">删除</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">还没有充值密钥</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">RECHARGE KEYS</span><h1>充值密钥</h1><p>生成后发给用户，用户在「账单与充值」页兑换；每枚只能使用一次</p></div><span class="section-count">可用 ${keys.filter(k => !k.used_by && k.active).length}</span></div>
    <section class="card"><div class="section-title"><div><h2>${stIcon('key')}生成密钥</h2></div></div>
      <form id="rechargeKeyForm" class="grid">
        <div><label>每枚金额（元）</label><input name="amount" type="number" value="100" min="0.01" step="0.01"></div>
        <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
        <div><label>有效期（天）</label><input name="duration_days" type="number" value="0" min="0" max="3650"><span class="muted small">0 表示长期有效</span></div>
        <div><label>备注</label><input name="note" placeholder="订单号/客户名"></div>
        <div class="form-actions" style="grid-column:1/-1;justify-content:flex-end"><button>生成充值密钥</button></div>
      </form>
    </section>
    <section class="card"><div class="section-title"><div><h2>密钥列表</h2><p>共 ${keys.length} 条</p></div></div><div class="table-wrap"><table><thead><tr><th>序号</th><th>密钥</th><th>金额</th><th>备注</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  `, 'admin-recharge', '充值密钥');
  const form = document.querySelector('#rechargeKeyForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {amount: fd.get('amount'), count: fd.get('count'), note: fd.get('note'), expires_days: fd.get('duration_days')};
    try{
      const r = await api('/api/admin/recharge-keys/create', {method:'POST', body});
      const list = r.keys || [];
      if(list.length) await copyText(list.join('\n'));
      await appAlert((r.message || '充值密钥已生成') + (list.length ? '\n已复制到剪贴板。' : ''), {title:'生成完成'});
      await loadAdminRecharge();
    }catch(err){ show(err.message, true); }
  };
}

let ledgerFilter = { book: 'cash', category: '', range: '30', q: '', userId: 0 };
let ledgerUsers = null;

const LEDGER_BOOK_TABS = [['cash', '平台现金账'], ['balance', '用户资金账'], ['user', '用户流水']];

function ledgerRangeTs(range){
  const now = Math.floor(Date.now() / 1000);
  if(range === '7') return now - 7 * 86400;
  if(range === '30') return now - 30 * 86400;
  if(range === '90') return now - 90 * 86400;
  return 0;
}

function ledgerSetFilter(key, value){
  ledgerFilter[key] = value;
  if(key === 'book'){ ledgerFilter.category = ''; ledgerFilter.q = ''; }
  loadAdminLedger();
  if(key === 'q'){
    const el = document.getElementById('ledgerSearch');
    if(el){ el.focus(); if(el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); }
  }
}

async function ledgerFetchUsers(){
  if(ledgerUsers) return ledgerUsers;
  try{ ledgerUsers = (await api('/api/admin/ledger/users')).users || []; }
  catch(err){ ledgerUsers = []; }
  return ledgerUsers;
}

async function loadAdminLedger(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  const book = ledgerFilter.book || 'cash';
  let userOptions = '';
  if(book === 'user'){
    const users = await ledgerFetchUsers();
    if(!ledgerFilter.userId && users.length) ledgerFilter.userId = users[0].id;
    userOptions = users.map(u => `<option value="${u.id}"${Number(ledgerFilter.userId) === Number(u.id) ? ' selected' : ''}>${esc(u.username || ('#' + u.id))}（${u.count} 笔）</option>`).join('');
  }
  const qs = new URLSearchParams();
  qs.set('book', book);
  if(ledgerFilter.category) qs.set('category', ledgerFilter.category);
  if(ledgerFilter.q) qs.set('q', ledgerFilter.q);
  const from = ledgerRangeTs(ledgerFilter.range);
  if(from) qs.set('from', String(from));
  qs.set('limit', '300');
  if(book === 'user' && ledgerFilter.userId) qs.set('user_id', String(ledgerFilter.userId));
  let data = { rows: [], summary: {}, categories: {}, user: null };
  if(book !== 'user' || ledgerFilter.userId){
    try{ data = await api('/api/admin/ledger?' + qs.toString()); }
    catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  }
  const rows = data.rows || [];
  const sum = data.summary || {};
  const cats = data.categories || {};
  const money = (v) => Number(v || 0).toFixed(2);
  const unitText = () => '¥';
  const unit = '¥';
  const raise = Number(sum.in || 0) + Number(sum.reverse || 0);
  const cut = Number(sum.out || 0);
  const cashNet = Number(sum.in || 0) - cut + Number(sum.reverse || 0);
  const catOptions = Object.entries(cats).map(([k, v]) => `<option value="${k}"${ledgerFilter.category === k ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const dirMeta = (d) => d === 'in' ? { cls: 'in', text: book === 'cash' ? '收入' : '增加' }
                       : d === 'out' ? { cls: 'out', text: book === 'cash' ? '支出' : '减少' }
                       : d === 'reverse' ? { cls: 'reverse', text: '冲正' }
                       : { cls: 'none', text: '事件' };
  const dirSign = (d) => d === 'in' ? '+' : (d === 'out' ? '-' : (d === 'reverse' ? (book === 'cash' ? '-' : '+') : ''));
  const cards = book === 'cash'
    ? `<div class="ledger-card"><span>现金收入</span><b class="ledger-in">+¥${money(sum.in)}</b><small>在线充值到账</small></div>
       <div class="ledger-card"><span>现金支出</span><b class="ledger-out">-¥${money(cut - Number(sum.reverse || 0))}</b><small>提现打款（已扣冲正）</small></div>
       <div class="ledger-card"><span>现金净额</span><b class="${cashNet >= 0 ? 'ledger-in' : 'ledger-out'}">${cashNet >= 0 ? '+' : '-'}¥${money(Math.abs(cashNet))}</b><small>当前筛选范围</small></div>`
    : `<div class="ledger-card"><span>${book === 'user' ? '余额增加' : '资金增加'}</span><b class="ledger-in">+¥${money(raise)}</b><small>充值到账 / 退款 / 冲正</small></div>
       <div class="ledger-card"><span>${book === 'user' ? '余额减少' : '资金减少'}</span><b class="ledger-out">-¥${money(cut)}</b><small>套餐消费 / 提现转出</small></div>
       <div class="ledger-card"><span>净变动</span><b class="${(raise - cut) >= 0 ? 'ledger-in' : 'ledger-out'}">${(raise - cut) >= 0 ? '+' : '-'}¥${money(Math.abs(raise - cut))}</b><small>${book === 'user' ? `当前余额 ¥${money(data.user ? data.user.balance : 0)}` : '当前筛选范围'}</small></div>`;
  const rowHtml = rows.map(r => {
    const meta = dirMeta(r.direction);
    const signed = dirSign(r.direction);
    const cls = r.direction === 'in' ? 'ledger-in' : (r.direction === 'out' ? 'ledger-out' : (r.direction === 'reverse' ? 'ledger-reverse' : 'ledger-muted'));
    const u = book === 'user' ? unitText(r.unit) : unit;
    return `<tr${r.direction === 'none' ? ' class="is-event"' : ''}>
      <td class="muted small">${fmtTs(r.ts)}</td>
      <td><span class="ledger-dir ${meta.cls}">${meta.text}</span></td>
      <td>${esc(r.category_text || r.category)}</td>
      <td><b class="${cls}">${signed}${money(r.amount)} ${u}</b></td>
      <td>${esc(r.username || '-')}</td>
      <td class="muted small">${esc(r.order_no || '-')}</td>
      <td class="muted small">${esc(r.note || '-')}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="muted">${book === 'user' && !ledgerFilter.userId ? '还没有产生流水的用户' : '该条件下暂无流水'}</td></tr>`;
  const tabs = LEDGER_BOOK_TABS.map(([k, t]) => `<button type="button" class="ledger-tab${book === k ? ' active' : ''}" onclick="ledgerSetFilter('book','${k}')">${t}</button>`).join('');
  const subtitles = {
    cash: '真金白银的进出：在线充值入账、提现打款出账',
    balance: '用户余额与收益池的增减：充值到账增加，消费与提现减少，结算与保证金属内部划转',
    user: '单个用户的余额明细，从两本账按用户派生'
  };
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">LEDGER</span><h1>收支表</h1><p>${esc(subtitles[book] || '')}</p></div><button type="button" class="secondary" onclick="loadAdminLedger()">刷新</button></div>
    <div class="ledger-tabs">${tabs}</div>
    <div class="ledger-cards">${cards}</div>
    <section class="card">
      <div class="ledger-toolbar">
        ${book === 'user' ? `<select onchange="ledgerSetFilter('userId', Number(this.value))">${userOptions || '<option value="">暂无用户</option>'}</select>` : ''}
        <label class="ledger-search"><span>⌕</span><input id="ledgerSearch" placeholder="搜索单号 / 用户 / 备注" value="${esc(ledgerFilter.q || '')}" oninput="ledgerSetFilter('q', this.value)"></label>
        <select onchange="ledgerSetFilter('range', this.value)">
          ${[['7','近 7 天'],['30','近 30 天'],['90','近 90 天'],['all','全部']].map(([v, t]) => `<option value="${v}"${ledgerFilter.range === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <select onchange="ledgerSetFilter('category', this.value)">
          <option value="">全部类型</option>${catOptions}
        </select>
        <span class="muted small">共 ${rows.length} 条</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>方向</th><th>类型</th><th>金额</th><th>用户</th><th>订单号</th><th>备注</th></tr></thead>
        <tbody>${rowHtml}</tbody>
      </table></div>
    </section>
  `, 'admin-ledger', '收支表');
}

async function loadAdminPayouts(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let payouts = [];
  try{ payouts = (await api('/api/admin/payouts')).payouts || []; }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const rows = payouts.map((p, i) => `<tr class="${p.ticket_id ? 'clickable-row' : ''}"${p.ticket_id ? ` onclick="loadTicketDetail(${p.ticket_id}, 'admin')"` : ''}><td>${i + 1}</td><td>${esc(p.payout_no)}</td><td>${esc(p.username)}</td><td><b>¥${fmtPts(p.amount)}</b></td><td>${esc(p.method)}</td><td>${esc(p.account)}</td><td>${esc(p.holder)}</td><td>${p.qr_token ? `<img class="qr-thumb" src="/api/upload/${encodeURIComponent(p.qr_token)}" alt="收款码" onclick="showImageViewer('/api/upload/${encodeURIComponent(p.qr_token)}')">` : '-'}</td><td>${payoutBadge(p.status)}</td><td>${fmtTs(p.created_at)}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">暂无提现申请</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">PAYOUTS</span><h1>提现工单</h1><p>处理供给方的收款提现申请</p></div><button type="button" class="secondary" onclick="loadAdminPayouts()">刷新</button></div>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>序号</th><th>单号</th><th>用户</th><th>金额</th><th>方式</th><th>账号</th><th>姓名</th><th>收款码</th><th>状态</th><th>时间</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  `, 'admin-payouts', '提现');
}

async function reviewPayout(id, action){
  if(!await appConfirm(action === 'paid' ? '确认已打款？' : '确认拒绝并退回收益？', {title:'处理提现', okText:'确认', danger: action === 'reject'})) return;
  try{ const r = await api('/api/admin/payouts/review', {method:'POST', body:{id:Number(id), action}}); show(r.message || '已处理'); await loadAdminPayouts(); }
  catch(err){ show(err.message, true); }
}

async function providerWithdraw(mode){
  const income = Number(window.__providerIncome || 0);
  if(income <= 0){ show('暂无可提现收益', true); return; }
  const label = mode === 'balance' ? '转入余额的金额（元）' : '提现金额（元）';
  const val = await appPrompt(label, String(income), {title: mode === 'balance' ? '收益转入余额' : '提现申请'});
  if(val === null) return;
  const points = Number(val);
  if(!Number.isFinite(points) || points <= 0){ show('请输入正确的金额', true); return; }
  if(points > income){ show(`最多可提现 ¥${fmtPts(income)}`, true); return; }
  try{
    const r = await api('/api/user/withdraw', {method:'POST', body:{mode, amount:points}});
    show(r.message || '已提交');
    await loadHosts();
  }catch(err){ show(err.message || '提现失败', true); }
}

async function providerPlanForm(id){
  let nodes = [];
  try{ nodes = (await api('/api/user/provider/nodes')).nodes || []; }catch(e){ show(e.message, true); return; }
  if(!nodes.length){ show('还没有已接入的节点', true); return; }
  let plan = { id: 0, name: '', node_id: nodes[0].id, price: 10, max_ports: 1, billing_mode: 'time', duration_days: 30, traffic_limit_gb: 0, bandwidth_limit_mbps: 0, active: 1 };
  if(id){
    const all = (await api('/api/user/provider/plans')).plans || [];
    plan = all.find(p => Number(p.id) === Number(id)) || plan;
  }
  const nodeOpts = nodes.map(n => `<option value="${n.id}"${Number(plan.node_id) === Number(n.id) ? ' selected' : ''}>${esc(n.name)}（${esc(n.region)}）</option>`).join('');
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="providerPlanModal" role="dialog" aria-modal="true" onclick="if(event.target===this)closeProviderPlan()">
    <section class="modal-page card app-dialog">
      <div class="section-title modal-title"><div><h2>${id ? '编辑套餐' : '上架套餐'}</h2><p>价格由你定，平台抽成见收益页</p></div></div>
      <form id="providerPlanForm" class="grid">
        <div><label>节点</label><select name="node_id">${nodeOpts}</select></div>
        <div><label>名称</label><input name="name" value="${esc(plan.name || '')}" maxlength="40" required></div>
        <div><label>价格（元）</label><input name="price" type="number" min="0" value="${Number(plan.price || 0)}" required></div>
        <div><label>端口数</label><input name="max_ports" type="number" min="1" max="100" value="${Number(plan.max_ports || 1)}" required></div>
        <div><label>计费方式</label><select name="billing_mode" id="ppMode"><option value="time"${plan.billing_mode !== 'traffic' ? ' selected' : ''}>时间</option><option value="traffic"${plan.billing_mode === 'traffic' ? ' selected' : ''}>流量</option></select></div>
        <div id="ppDays"><label>时长（天，≤30）</label><input name="duration_days" type="number" min="1" max="30" value="${Number(plan.duration_days || 30)}"></div>
        <div id="ppTraffic" class="hidden"><label>流量额度（GB）</label><input name="traffic_limit_gb" type="number" min="1" value="${Number(plan.traffic_limit_gb || 0)}"></div>
        <div><label>带宽（Mbps，0 不限）</label><input name="bandwidth_limit_mbps" type="number" min="0" value="${Number(plan.bandwidth_limit_mbps || 0)}"></div>
        <div class="form-actions" style="grid-column:1/-1"><button type="button" class="secondary" onclick="closeProviderPlan()">取消</button><button type="submit">保存</button></div>
      </form>
    </section></div>`);
  const form = document.querySelector('#providerPlanForm');
  const modeSel = form.querySelector('#ppMode');
  const syncMode = () => {
    const traffic = modeSel.value === 'traffic';
    form.querySelector('#ppDays').classList.toggle('hidden', traffic);
    form.querySelector('#ppTraffic').classList.toggle('hidden', !traffic);
  };
  modeSel.onchange = syncMode; syncMode();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = { id: Number(id || 0), ...fd };
    body.active = 1;
    try{
      const r = await api('/api/user/provider/plans/save', {method:'POST', body});
      closeProviderPlan(); show(r.message || '已保存'); await loadHosts();
    }catch(err){ show(err.message || '保存失败', true); }
  };
}

function closeProviderPlan(){ const el = document.querySelector('#providerPlanModal'); if(el) el.remove(); }

async function providerPlanDelete(id){
  if(!await appConfirm('下架后买家将无法购买该套餐，确认下架？', {title:'下架套餐', okText:'确认下架', danger:true})) return;
  try{ const r = await api('/api/user/provider/plans/delete', {method:'POST', body:{id:Number(id)}}); show(r.message || '已下架'); await loadHosts(); }
  catch(err){ show(err.message || '操作失败', true); }
}

async function loadAdminHosts(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let data;
  try{ data = await api('/api/admin/hosts'); }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const hosts = data.hosts || [];
  const pending = hosts.filter(h => h.status === 'pending').length;
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">HOSTING</span><h1>托管申请</h1><p>审核用户提交的母鸡，通过后自动创建节点。</p></div>
      <div class="row" style="gap:10px"><span class="section-count">待审核 ${pending}</span><button type="button" class="secondary" onclick="loadAdminHosts()">刷新</button></div></div>
    <section class="card host-rules">
      <div class="section-title"><div><h2>${stIcon('shield')}托管规则与准则</h2><p>审核时请对照以下约定</p></div></div>
      <ol class="host-rule-list">${HOST_RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
    </section>
    <section class="card"><div class="section-title"><div><h2>${stIcon('cloud')}托管列表</h2><p>共 ${hosts.length} 条</p></div></div>
      <table><thead><tr><th>序号</th><th>名称</th><th>地区</th><th>接入地址</th><th>到期时间</th><th>带宽 / 流量</th><th>提交人</th><th>状态</th><th>提交时间</th></tr></thead><tbody>${hostRowsHtml(hosts, true)}</tbody></table>
    </section>`, 'admin-hosts', '托管申请');
}

async function loadAdminHostDetail(id){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let hosts = [];
  try{ hosts = (await api('/api/admin/hosts')).hosts || []; }
  catch(err){ if(err.message === 'unauthorized') return renderLogin(); show(err.message, true); return; }
  const h = hosts.find(x => Number(x.id) === Number(id));
  if(!h){ show('托管申请不存在', true); return loadAdminHosts(); }
  const rows = [
    ['提交人', h.username],
    ['地区', h.region],
    ['接入地址', `${h.server_addr}:${h.server_port}`],
    ['端口池', `${h.port_start} - ${h.port_end}`],
    ['带宽', h.bandwidth_mbps ? `${h.bandwidth_mbps} Mbps` : '不限'],
    ['月流量', h.monthly_traffic_gb ? `${h.monthly_traffic_gb} GB` : '不限'],
    ['服务器到期', h.expires_at ? fmtTs(h.expires_at) : '-'],
    ['提交时间', fmtTs(h.created_at)],
    ['备注', h.note || '-']
  ];
  app.innerHTML = appLayoutHtml(`
    ${instCrumbBar(h.name, [{ label: '托管申请', onclick: 'loadAdminHosts()' }])}
    <div class="instance-layout">
      <div class="instance-main">
        <section class="card">
          <div class="section-title"><div><div class="section-kicker">HOST</div><h2>${stIcon('cloud')}母鸡信息</h2></div>${ticketStatusBadge(h.status === 'pending' ? 'open' : (h.status === 'approved' ? 'closed' : 'rejected'))}</div>
          <div class="host-detail-grid">${rows.map(([k, v]) => `<div class="host-detail-row"><span>${k}</span><b>${esc(String(v))}</b></div>`).join('')}</div>
        </section>
        <section class="card host-rules">
          <div class="section-title"><div><h2>${stIcon('shield')}托管规则与准则</h2><p>审核时请对照以下约定</p></div></div>
          <ol class="host-rule-list">${HOST_RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
        </section>
      </div>
      <aside class="instance-side">
        <section class="card ia-card">
          <div class="ia-head"><span class="ia-head-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.5 5.8 13.1h5.2l-1.2 8.4 7.6-10.8h-5.2z" fill="currentColor"/></svg></span><div class="ia-head-copy"><h2>审核</h2><p>当前状态：${esc(h.status_text || h.status)}</p></div></div>
          ${h.status === 'pending' ? `<button type="button" class="ia-primary" onclick="hostReview(${h.id}, 'approve')"><span>通过审核</span></button>
          <div class="ia-duo"><button type="button" class="ia-secondary" onclick="hostReview(${h.id}, 'reject')"><span>拒绝</span></button><button type="button" class="ia-secondary" onclick="hostReview(${h.id}, 'blacklist')"><span>拉黑</span></button></div>`
          : `<button type="button" class="ia-secondary" onclick="loadAdminHosts()"><span>返回列表</span></button>`}
        </section>
      </aside>
    </div>`, 'admin-hosts', '托管申请');
}

async function hostReview(id, action){
  const labels = {approve:'通过', reject:'拒绝', blacklist:'拉黑'};
  if(!await appConfirm(`确认${labels[action]}该托管申请？`, {title:'托管审核', okText:labels[action], danger: action !== 'approve'})) return;
  try{
    const r = await api('/api/admin/hosts/review', {method:'POST', body:{id, action}});
    await appAlert(r.message || '已处理', {title:'审核完成'});
    if(window.__currentTicketId) loadTicketDetail(window.__currentTicketId, 'admin');
    else loadAdminHosts();
  }catch(err){ await appAlert(err.message, {title:'操作失败'}); }
}

async function loadNewNode(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let nodes = [], plans = [];
  try{
    const [nres, pres] = await Promise.all([api('/api/user/nodes'), api('/api/plans')]);
    nodes = (nres.nodes || []).filter(n => n.active !== false);
    plans = pres.plans || [];
  }catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    show(err.message, true);
    return;
  }
  window.__nnData = { nodes, plans };
  if(nnState.region && !nodes.some(n => (n.region || '默认地区') === nnState.region)) nnState = { region:'', nodeId:0, planId:0, ports:[], tunnels:[] };
  renderNewNode();
}

function nnPlansFor(nodeId){
  const plans = (window.__nnData && window.__nnData.plans) || [];
  return plans.filter(p => Number(p.node_id || 0) === 0 || Number(p.node_id) === Number(nodeId));
}

function renderNewNode(){
  const data = window.__nnData || { nodes: [], plans: [] };
  const nodes = data.nodes || [];
  const plans = data.plans || [];
  const regions = {};
  nodes.forEach(n => {
    const key = n.region || '默认地区';
    (regions[key] = regions[key] || []).push(n);
  });
  const regionNames = Object.keys(regions);
  const nnKw = String(nnFilter.q || '').trim().toLowerCase();
  const nnMin = Number(nnFilter.min || 0) || 0;
  const nnMax = Number(nnFilter.max || 0) || 0;
  const nodeMatch = (n) => !nnKw || [n.name, n.note, n.region].some(x => String(x || '').toLowerCase().includes(nnKw));
  const nodePrice = (n) => {
    const list = plans.filter(p => Number(p.node_id || 0) === 0 || Number(p.node_id) === Number(n.id));
    return list.length ? Math.min(...list.map(p => Number(p.price || 0))) : null;
  };
  const regionPrice = (name) => {
    const ids = regions[name].map(n => Number(n.id));
    const list = plans.filter(p => Number(p.node_id || 0) === 0 || ids.includes(Number(p.node_id)));
    if(!list.length) return null;
    return Math.min(...list.map(p => Number(p.price || 0)));
  };
  const CN_REGION = /中国|河南|河北|山东|山西|陕西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|湖北|湖南|广东|广西|海南|四川|贵州|云南|甘肃|青海|宁夏|新疆|西藏|内蒙古|北京|上海|天津|重庆|香港|澳门|台湾/;
  const regionFlag = (name) => {
    const text = String(name || '');
    if(/香港/.test(text)) return '🇭🇰';
    if(/澳门/.test(text)) return '🇲🇴';
    if(/台湾/.test(text)) return '🇹🇼';
    if(CN_REGION.test(text)) return '🇨🇳';
    const map = {'美国':'🇺🇸','日本':'🇯🇵','新加坡':'🇸🇬','欧洲':'🇪🇺','韩国':'🇰🇷','英国':'🇬🇧','德国':'🇩🇪','法国':'🇫🇷','荷兰':'🇳🇱','加拿大':'🇨🇦','澳大利亚':'🇦🇺','俄罗斯':'🇷🇺','印度':'🇮🇳','泰国':'🇹🇭','越南':'🇻🇳','马来西亚':'🇲🇾','菲律宾':'🇵🇭','土耳其':'🇹🇷','巴西':'🇧🇷'};
    return map[text] || '🌐';
  };
  const regionLabel = (name) => {
    const text = String(name || '');
    if(/香港|澳门|台湾/.test(text)) return `【中国·${text}】`;
    if(CN_REGION.test(text)) return `【中国·${text.replace(/^中国[·\s]*/, '')}】`;
    return text;
  };
  const emptyHint = (text) => `<div class="nn-empty">${stIcon('node')}<p>${text}</p></div>`;
  const currentStep = !nnState.region ? 1 : (!nnState.nodeId ? 2 : (!nnState.planId ? 3 : 4));
  const maxTunnels = Math.max(1, Math.min(20, Number(((plans.find(p => Number(p.id) === Number(nnState.planId)) || {}).max_ports) || 1)));

  const stepper = `
    <div class="nn-stepper">
      ${[['1','选择地区','选取您满意的地区'],['2','选择实例','选择接入服务器'],['3','选择套餐','按需选择计费方式'],['4','创建隧道','预分配公网端口'],['5','支付开通','完成支付，立即使用']].map(([no,title,sub], idx) => {
        const n = idx + 1;
        const state = n < currentStep ? ' done' : (n === currentStep ? ' active' : '');
        return `<div class="nn-step-item${state}">
          <span class="nn-step-dot">${n < currentStep ? '✓' : no}</span>
          <div class="nn-step-copy"><b>${title}</b><small>${sub}</small></div>
          ${n < 5 ? '<span class="nn-step-line"></span>' : ''}
        </div>`;
      }).join('')}
    </div>`;

  const visibleRegions = regionNames.filter(name => (regions[name] || []).some(nodeMatch));
  const totalMatched = nodes.filter(nodeMatch).length;
  const regionTabs = `<div class="nn-tabs">
    <button type="button" class="nn-tab${!nnState.region ? ' active' : ''}" onclick="nnPickRegion('')">全部 <b>${totalMatched}</b></button>
    ${visibleRegions.map(name => `<button type="button" class="nn-tab${nnState.region === name ? ' active' : ''}" onclick="nnPickRegion('${esc(name)}')">${esc(regionLabel(name).replace(/[【】]/g, ''))} <b>${(regions[name] || []).filter(nodeMatch).length}</b></button>`).join('')}
  </div>`;
  const step1 = `<div class="nn-region-chips">${visibleRegions.map(name => {
    const active = nnState.region === name;
    const min = regionPrice(name);
    const count = (regions[name] || []).filter(nodeMatch).length;
    return `<button type="button" class="nn-chip${active ? ' active' : ''}" onclick="nnPickRegion('${esc(name)}')">
      <span class="nn-chip-flag">${regionFlag(name)}</span>
      <span class="nn-chip-name">${esc(regionLabel(name))}</span>
      <span class="nn-chip-line"></span>
      <span class="nn-chip-foot"><span>${count} 个节点</span><b>${min === null ? '暂无套餐' : '¥' + min + ' 起'}</b></span>
    </button>`;
  }).join('') || emptyHint('暂无可用地区')}</div>`;

  const sortNodes = (list) => {
    if(nnFilter.sort === 'price-asc') return [...list].sort((a, b) => (nodePrice(a) ?? 1e9) - (nodePrice(b) ?? 1e9));
    if(nnFilter.sort === 'price-desc') return [...list].sort((a, b) => (nodePrice(b) ?? -1) - (nodePrice(a) ?? -1));
    return list;
  };
  const regionNodes = sortNodes((nnState.region ? (regions[nnState.region] || []) : nodes).filter(nodeMatch));
  const step2 = !regionNodes.length ? emptyHint('该条件下暂无可用实例') : `<div class="nn-node-cards">${regionNodes.map(n => {
    const active = Number(nnState.nodeId) === Number(n.id);
    const online = !!n.auth_port_ok;
    const exceeded = !!n.traffic_exceeded;
    const used = Number(n.month_used_gb || 0);
    const limit = Number(n.monthly_traffic_gb || 0);
    const days = Math.max(0, Math.floor((Date.now() / 1000 - Number(n.created_at || 0)) / 86400));
    const note = String(n.note || '').trim();
    const stateClass = exceeded ? 'exhausted' : (online ? 'online' : 'maintenance');
    const stateText = exceeded ? '流量用尽' : (online ? '在线' : '维护中');
    const icoCube = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 21 7.2v9.6L12 21.4 3 16.8V7.2z" fill="#2F6FED"/><path d="M12 2.6 21 7.2 12 11.8 3 7.2z" fill="#5B93FF"/><path d="M12 11.8v9.6L3 16.8V7.2z" fill="#1E56C8"/></svg>';
    const icoCal = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.4" fill="#3FBF7F"/><rect x="3.5" y="5" width="17" height="4.4" rx="2.4" fill="#2EA968"/><path d="M8 3v4M16 3v4" stroke="#1E8A52" stroke-width="1.8" stroke-linecap="round"/><path d="M7.5 13h2.2M11 13h2.2M14.5 13h2.2M7.5 16.4h2.2M11 16.4h2.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';
    const icoClock = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="#8B5CF6" stroke-width="2.2"/><path d="M12 7.4V12l3.1 1.9" fill="none" stroke="#8B5CF6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.6 4.6v3.4h-3.4" fill="none" stroke="#8B5CF6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const icoDb = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6.2" rx="7.2" ry="2.8" fill="#22C3D6"/><path d="M4.8 6.2v5.4c0 1.5 3.2 2.8 7.2 2.8s7.2-1.3 7.2-2.8V6.2" fill="#1AA9BC"/><path d="M4.8 11.6V17c0 1.5 3.2 2.8 7.2 2.8s7.2-1.3 7.2-2.8v-5.4" fill="#22C3D6"/></svg>';
    return `<button type="button" class="nn-node-card srv2${active ? ' active' : ''}${exceeded ? ' disabled' : ''}" ${exceeded ? 'disabled' : ''} onclick="nnPickNode(${Number(n.id)})">
      <span class="nn-hero">
        <span class="nn-hero-icon">${stIcon('node')}</span>
        <b class="nn-hero-name">${esc(n.name || '')}</b>
        <span class="nn-hero-badge ${stateClass}">${stateClass === 'maintenance' ? '🔧' : (stateClass === 'online' ? '●' : '!')} ${stateText}</span>
      </span>
      <span class="nn-rows">
        <span class="nn-row"><span class="nn-row-icon">${icoCube}</span><span class="nn-row-label">frps 版本</span><b class="nn-row-value">${esc(n.frps_version || '-')}</b></span>
        <span class="nn-row"><span class="nn-row-icon">${icoCal}</span><span class="nn-row-label">上架天数</span><b class="nn-row-value">${days} 天</b></span>
        <span class="nn-row"><span class="nn-row-icon">${icoClock}</span><span class="nn-row-label">最大续期时间</span><b class="nn-row-value">${n.expires_at ? fmtTs(n.expires_at).slice(0, 10) : '不限'}</b></span>
        <span class="nn-row"><span class="nn-row-icon">${icoDb}</span><span class="nn-row-label">月流量限制</span><b class="nn-row-value">${Number(n.monthly_traffic_gb || 0) > 0 ? Number(n.monthly_traffic_gb) + ' GB' : '不限'}</b></span>
      </span>
      <span class="nn-warn-bar"><span class="nn-warn-mark">⚠</span><span class="nn-warn-sep"></span><b>${esc(note || '合理使用严禁一切非法业务')}</b></span>
    </button>`;
  }).join('') || emptyHint('该地区暂无可用实例')}</div>`;

  const nodePlans = (nnState.nodeId ? nnPlansFor(nnState.nodeId) : []).filter(p => {
    const price = Number(p.price || 0);
    if(nnMin && price < nnMin) return false;
    if(nnMax && price > nnMax) return false;
    return true;
  });
  const planIcon = (mode, hasQuota, hasDays) => {
    if(mode === 'traffic') return '<svg viewBox="0 0 24 24"><path d="M7 18h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 9.6 4.2 4.2 0 0 0 7 18Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
    if(mode === 'time' && hasQuota) return '<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
    return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
  };
  const planCards = nodePlans.map(p => {
    const active = Number(nnState.planId) === Number(p.id);
    const isTraffic = p.billing_mode === 'traffic';
    const hasQuota = Number(p.traffic_limit_gb || 0) > 0;
    const hasDays = Number(p.duration_days || 0) > 0;
    const combo = !isTraffic && hasQuota;
    const typeName = isTraffic ? '流量套餐' : (combo ? '组合套餐' : '时间套餐');
    const main = isTraffic ? `${p.traffic_limit_gb} GB` : `${p.duration_days} 天`;
    const sub = isTraffic ? `${p.max_ports} 端口` : `${hasQuota ? p.traffic_limit_gb + ' GB · ' : ''}${p.max_ports} 端口`;
    const soldOut = !!p.sold_out;
    return `<button type="button" class="nn-plan-card${active ? ' active' : ''}${soldOut ? ' soldout' : ''}" ${soldOut ? 'disabled' : ''} onclick="nnPickPlan(${Number(p.id)})">
      <span class="nn-plan-icon">${planIcon(p.billing_mode, hasQuota, hasDays)}</span>
      <span class="nn-plan-type">${typeName}</span>
      <span class="nn-plan-name">${esc(p.name)}</span>
      <span class="nn-plan-title">${main}</span>
      <span class="nn-plan-sub">${sub}</span>
      <span class="nn-plan-stock ${soldOut ? 'out' : ''}">${esc(p.stock_text || '')}</span>
      <span class="nn-plan-price"><b>¥${Number(p.price)}</b></span>
      <span class="nn-plan-foot">${hasQuota && !isTraffic ? '含流量额度' : (isTraffic ? '用完即止' : '不限流量')}</span>
    </button>`;
  }).join('') || emptyHint('该实例暂无可购买套餐');
  const step3 = !nnState.nodeId ? emptyHint('请先选择实例，随后会显示该实例可购买的套餐') : `<div class="nn-plan-cards">${planCards}</div>`;

  const chosenPlan = plans.find(p => Number(p.id) === Number(nnState.planId));
  const chosenNode = nodes.find(n => Number(n.id) === Number(nnState.nodeId));
  const ready = !!(nnState.region && nnState.nodeId && nnState.planId);
  const portPool = nnState.ports || [];
  const tunnelRows = (nnState.tunnels || []).map((t, i) => {
    const used = new Set((nnState.tunnels || []).map(x => Number(x.remote_port || 0)).filter(Boolean));
    const opts = portPool.map(pt => `<option value="${pt}" ${Number(t.remote_port) === Number(pt) ? 'selected' : ''}${used.has(pt) && Number(t.remote_port) !== Number(pt) ? ' disabled' : ''}>${pt}</option>`).join('');
    return `<div class="nn-tunnel-row">
      <label class="nn-field"><span>隧道名称</span><input value="${esc(t.name || '')}" maxlength="40" oninput="nnTunnelSet(${i},'name',this.value)"></label>
      <label class="nn-field"><span>协议</span><select onchange="nnTunnelSet(${i},'proxy_type',this.value)"><option value="tcp"${t.proxy_type === 'tcp' ? ' selected' : ''}>TCP</option><option value="udp"${t.proxy_type === 'udp' ? ' selected' : ''}>UDP</option></select></label>
      <label class="nn-field"><span>本地地址</span><input value="${esc(t.local_ip || '127.0.0.1')}" maxlength="60" placeholder="127.0.0.1" oninput="nnTunnelSet(${i},'local_ip',this.value)"></label>
      <label class="nn-field"><span>本地端口</span><input type="number" min="1" max="65535" value="${Number(t.local_port || 0)}" oninput="nnTunnelSet(${i},'local_port',this.value)"></label>
      <label class="nn-field"><span>公网端口</span><select onchange="nnTunnelSet(${i},'remote_port',this.value)">${opts || '<option value="0">暂无可用端口</option>'}</select></label>
      <button type="button" class="node-action node-action-danger" onclick="nnTunnelRemove(${i})">删除</button>
    </div>`;
  }).join('');
  const step4 = !nnState.planId ? emptyHint('请先选择套餐，随后可预分配端口并创建隧道') : `<div class="nn-tunnel-wrap">
      <p class="muted small">公网端口已按套餐预分配，开通后立即生效。可先配置需要映射的本地服务，最多 ${maxTunnels} 条。</p>
      <div class="nn-tunnel-list">${tunnelRows}</div>
      <button type="button" class="secondary" ${(nnState.tunnels || []).length >= Math.min(maxTunnels, portPool.length || maxTunnels) ? 'disabled' : ''} onclick="nnTunnelAdd()">+ 添加隧道</button>
    </div>`;
  const tunnelSummary = (nnState.tunnels || []).filter(t => t.name).map(t => `${esc(t.name)} ${esc(t.proxy_type.toUpperCase())} ${t.remote_port || '-'}`).join('、');
  const step5 = `<div class="nn-pay-panel">
      <div class="nn-pay-summary">
        <div><span>地区</span><b>${nnState.region ? esc(nnState.region) : '未选择'}</b></div>
        <div><span>节点</span><b>${chosenNode ? esc(chosenNode.name) : '未选择'}</b></div>
        <div><span>套餐</span><b>${chosenPlan ? esc(chosenPlan.name) : '未选择'}</b></div>
        <div><span>隧道</span><b>${tunnelSummary || '暂未配置'}</b></div>
        <div><span>应付</span><b class="nn-pay-amount">¥${chosenPlan ? Number(chosenPlan.price) : 0}</b></div>
      </div>
      <button type="button" class="nn-pay${ready ? ' ready' : ''}" ${ready ? '' : 'disabled'} onclick="nnPay()">${ready ? '立即支付并开通' : '请完成上方步骤'}</button>
    </div>`;

  const sumDays = chosenPlan ? Number(chosenPlan.duration_days || 0) : 0;
  const sumGb = chosenPlan ? Number(chosenPlan.traffic_limit_gb || 0) : 0;
  const sumPorts = chosenPlan ? Number(chosenPlan.max_ports || 0) : 0;
  const sumTunnels = (nnState.tunnels || []).filter(t => t.name).length;
  const stepPill = (n) => `<span class="nn-step-pill">步骤${n}</span>`;

  const toolbar = `<div class="nn-toolbar">
      <label class="nn-search"><span>⌕</span><input id="nnSearch" placeholder="搜索实例" value="${esc(nnFilter.q)}" oninput="nnSetFilter('q',this.value)"></label>
      <div class="nn-price-range">
        <span>¥</span><input id="nnPriceMin" type="number" min="0" placeholder="最低价" value="${esc(nnFilter.min)}" oninput="nnSetFilter('min',this.value)">
        <i>—</i>
        <input id="nnPriceMax" type="number" min="0" placeholder="最高价" value="${esc(nnFilter.max)}" oninput="nnSetFilter('max',this.value)">
      </div>
      <select id="nnSort" class="nn-sort" onchange="nnSetFilter('sort',this.value)">
        <option value="default"${nnFilter.sort === 'default' ? ' selected' : ''}>默认排序</option>
        <option value="price-asc"${nnFilter.sort === 'price-asc' ? ' selected' : ''}>价格从低到高</option>
        <option value="price-desc"${nnFilter.sort === 'price-desc' ? ' selected' : ''}>价格从高到低</option>
      </select>
    </div>`;

  const summaryCard = `<aside class="nn-col-right">
      <section class="card nn-summary">
        <div class="nn-sum-head"><b>订单摘要</b>${nnState.region ? `<span class="nn-sum-tag">${regionFlag(nnState.region)} ${esc(regionLabel(nnState.region))}</span>` : ''}</div>
        <h3 class="nn-sum-name">${chosenPlan ? esc(chosenPlan.name) : '待选择套餐'}</h3>
        <p class="nn-sum-node">${chosenNode ? esc(chosenNode.name) : '待选择实例'}</p>
        <div class="nn-sum-rows">
          <span><i>📅</i>时长<b>${sumDays ? sumDays + ' 天' : '不限'}</b></span>
          <span><i>🔌</i>端口<b>${sumPorts || '-'}</b></span>
          <span><i>📊</i>流量<b>${sumGb ? sumGb + ' GB' : '不限'}</b></span>
          <span><i>🧩</i>隧道<b>${sumTunnels} 条</b></span>
        </div>
        <div class="nn-sum-price"><small>应付金额</small><b>¥${chosenPlan ? Number(chosenPlan.price) : 0}</b></div>
        <button type="button" class="nn-sum-pay${ready ? ' ready' : ''}" ${ready ? '' : 'disabled'} onclick="nnPay()">${ready ? '立即创建' : '请完成左侧步骤'}</button>
        <div class="nn-sum-note">
          <p class="nn-sum-note-title">💡 购买须知</p>
          <ul>
            <li>资源托管：实例由不同托管方提供，购买时长代表预付周期，不代表绝对可用时长。</li>
            <li>退款保障：实例持续异常或提前下架时，可随时退订，按剩余价值退回账户余额。</li>
            <li>购买后 10 分钟内且端口未产生流量，可全额退订；超过按剩余比例退款并扣除手续费。</li>
          </ul>
        </div>
      </section>
    </aside>`;

  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">NEW NODE</span><h1>新建实例</h1><p>选择地区与实例，配置套餐和隧道，右侧确认后立即创建。</p></div></div>

    <section class="card nn-block nn-block-region">
      <div class="nn-block-head">
        ${stepPill(1)}
        <div class="nn-head-copy"><h2>选择地区</h2><p>选择离你更近的地区，延迟更低</p></div>
        ${toolbar}
      </div>
      ${regionTabs}
      ${step1}
    </section>

    <div class="nn-grid3">
      <section class="card nn-block nn-col-left">
        <div class="nn-block-head">
          ${stepPill(2)}
          <div class="nn-head-copy"><h2>选择实例</h2><p>${(nnState.region ? esc(regionLabel(nnState.region)) : '全部地区') + ' · ' + regionNodes.length + ' 个实例'}</p></div>
        </div>
        <div class="nn-col-scroll">${step2}</div>
      </section>

      <div class="nn-col-mid">
        <section class="card nn-block">
          <div class="nn-block-head">
            ${stepPill(3)}
            <div class="nn-head-copy"><h2>选择配置</h2><p>时间、流量或组合套餐</p></div>
          </div>
          ${step3}
        </section>
        <section class="card nn-block">
          <div class="nn-block-head">
            ${stepPill(4)}
            <div class="nn-head-copy"><h2>实例配置</h2><p>端口预分配，开通即可使用</p></div>
          </div>
          ${step4}
        </section>
      </div>

      ${summaryCard}
    </div>
  `, 'dashboard-nodes', '新建实例');
}

function nnSetFilter(key, value){
  nnFilter[key] = value;
  renderNewNode();
  const map = { q: 'nnSearch', min: 'nnPriceMin', max: 'nnPriceMax' };
  const el = document.getElementById(map[key]);
  if(el){
    el.focus();
    if(el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length);
  }
}

function nnPickRegion(name){
  nnState.region = name; nnState.nodeId = 0; nnState.planId = 0; nnState.ports = []; nnState.tunnels = [];
  renderNewNode();
}
function nnPickNode(id){
  nnState.nodeId = Number(id); nnState.planId = 0; nnState.ports = []; nnState.tunnels = [];
  renderNewNode();
}
async function nnPickPlan(id){
  nnState.planId = Number(id);
  const plan = ((window.__nnData || {}).plans || []).find(p => Number(p.id) === Number(id)) || {};
  const maxPorts = Math.max(1, Math.min(20, Number(plan.max_ports || 1)));
  nnState.tunnels = [{ name: '', proxy_type: 'tcp', local_ip: '127.0.0.1', local_port: 8080, remote_port: 0 }];
  nnState.ports = [];
  renderNewNode();
  try{
    const r = await api('/api/user/nodes/' + Number(nnState.nodeId) + '/free-ports?count=' + maxPorts);
    nnState.ports = (r.ports || []).map(Number);
    if(nnState.tunnels[0] && !nnState.tunnels[0].remote_port) nnState.tunnels[0].remote_port = nnState.ports[0] || 0;
  }catch(e){}
  renderNewNode();
}

function nnTunnelSet(i, key, value){
  const t = (nnState.tunnels || [])[i];
  if(!t) return;
  t[key] = (key === 'local_port' || key === 'remote_port') ? Number(value || 0) : value;
}

function nnTunnelAdd(){
  const plan = ((window.__nnData || {}).plans || []).find(p => Number(p.id) === Number(nnState.planId)) || {};
  const maxPorts = Math.max(1, Math.min(20, Number(plan.max_ports || 1)));
  if((nnState.tunnels || []).length >= Math.min(maxPorts, (nnState.ports || []).length || maxPorts)) return;
  const used = new Set(nnState.tunnels.map(t => Number(t.remote_port || 0)));
  const free = (nnState.ports || []).find(pt => !used.has(Number(pt))) || 0;
  nnState.tunnels.push({ name: '', proxy_type: 'tcp', local_port: 8080 + nnState.tunnels.length, remote_port: free });
  renderNewNode();
}

function nnTunnelRemove(i){
  (nnState.tunnels || []).splice(i, 1);
  renderNewNode();
}
async function nnPay(){
  if(!nnState.region || !nnState.nodeId || !nnState.planId) return;
  const plan = ((window.__nnData || {}).plans || []).find(p => Number(p.id) === Number(nnState.planId)) || {};
  const node = ((window.__nnData || {}).nodes || []).find(n => Number(n.id) === Number(nnState.nodeId)) || {};
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="nnPayModal" role="dialog" aria-modal="true" onclick="if(event.target===this)nnPayClose()">
    <section class="modal-page card app-dialog">
      <div class="section-title modal-title"><div><h2>确认开通</h2><p>支付成功后立即生效</p></div></div>
      <div class="nn-pay-modal-rows" id="nnPayRows">
        <div><span>地区</span><b>${esc(nnState.region)}</b></div>
        <div><span>实例</span><b>${esc(node.name || '')}</b></div>
        <div><span>套餐</span><b>${esc(plan.name || '')}</b></div>
        <div><span>隧道</span><b>${(nnState.tunnels || []).filter(t => t.name).map(t => esc(t.name) + ' ' + t.proxy_type.toUpperCase() + ' ' + esc(t.local_ip || '127.0.0.1') + ':' + Number(t.local_port || 0) + ' → ' + (t.remote_port || '-')).join('、') || '暂未配置'}</b></div>
        <div><span>应付</span><b class="nn-pay-amount">¥${Number(plan.price || 0)}</b></div>
      </div>
      <p class="muted small" id="nnPayHint">10 分钟内且端口未产生流量，可全额退订。</p>
      <div class="form-actions app-dialog-actions">
        <button type="button" class="secondary" id="nnPayCancel" onclick="nnPayClose()">取消</button>
        <button type="button" id="nnPayOk">确认支付</button>
      </div>
    </section>
  </div>`);
  const okBtn = document.querySelector('#nnPayOk');
  okBtn.onclick = async () => {
    okBtn.disabled = true;
    okBtn.textContent = '支付中…';
    try{
      const fail = (msg) => { show(msg, true); okBtn.disabled = false; okBtn.textContent = '确认支付'; };
      const named = (nnState.tunnels || []).filter(t => String(t.name || '').trim());
      if((nnState.tunnels || []).length && named.length !== (nnState.tunnels || []).length){ fail('有隧道未填写名称'); return; }
      const dupNames = named.map(t => String(t.name).trim()).filter((n, i, arr) => arr.indexOf(n) !== i);
      if(dupNames.length){ fail(`隧道名称「${dupNames[0]}」重复，请更换`); return; }
      const tunnels = named.map(t => ({name:String(t.name).trim(), proxy_type:t.proxy_type, local_ip:String(t.local_ip || '127.0.0.1').trim() || '127.0.0.1', local_port:Number(t.local_port), remote_port:Number(t.remote_port || 0)}));
      const r = await api('/api/user/orders', {method:'POST', body:{plan_id:nnState.planId, node_id:nnState.nodeId, tunnels}});
      nnPayClose();
      nnState = { region:'', nodeId:0, planId:0, ports:[], tunnels:[] };
      await loadMyPlans();
      show(r.message || '开通成功');
    }catch(err){
      const hint = document.querySelector('#nnPayHint');
      if(hint){ hint.textContent = err.message || '支付失败'; hint.className = 'bad small'; }
      okBtn.disabled = false;
      okBtn.textContent = '重试';
    }
  };
}

function nnPayClose(){
  const el = document.querySelector('#nnPayModal');
  if(el) el.remove();
}

async function loadMyPlans(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let data, nodes = [], planById = {};
  try{
    const [dash, nres, pres] = await Promise.all([api('/api/dashboard'), api('/api/user/nodes').catch(() => ({nodes:[]})), api('/api/plans').catch(() => ({plans:[]}))]);
    data = dash; nodes = nres.nodes || [];
    (pres.plans || []).forEach(p => { planById[Number(p.id)] = p; });
  }catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    show(err.message, true);
    return;
  }
  const myPlans = (data.my_plans || []).filter(p => p.status !== 'cancelled');
  const nodeById = {};
  nodes.forEach(n => { nodeById[Number(n.id)] = n; });
  const groups = {};
  myPlans.forEach(p => {
    const n = nodeById[Number(p.node_id)] || {};
    const key = n.region || '未分配地区';
    (groups[key] = groups[key] || []).push(p);
  });
  const regionNames = Object.keys(groups);
  const cardHtml = (p) => {
    const n = nodeById[Number(p.node_id)] || {};
    const statusText = p.status === 'exhausted' ? '流量用尽' : (p.status === 'cancelled' ? '已退订' : (p.expired ? '已到期' : '运行中'));
    const statusClass = p.status === 'active' && !p.expired ? 'ok' : 'bad';
    const bw = Number(n.bandwidth_mbps || 0);
    const usedGb = Number(n.month_used_gb || 0);
    const limitGb = Number(n.monthly_traffic_gb || 0);
    const quotaText = p.quota_gb > 0 ? `${p.used_gb} / ${p.quota_gb} GB` : '不限量';
    const expireText = p.billing_mode === 'traffic' ? '按流量计费' : (p.expires_at ? p.expires_text : '不限期');
    return `<article class="my-node-card" onclick="openInstanceTunnels(${Number(p.node_id || 0)}, '${esc(n.name || '实例')}', ${Number(p.id)}, '${esc(p.plan_name || '')}')">
      <div class="my-node-head">
        <div class="my-node-title"><span class="my-node-region">${esc(n.region || '未分配')}</span><b>${esc(n.name || '实例 ' + (p.node_id || ''))}</b><small>${esc(p.plan_name || '')}</small></div>
        <span class="status-badge ${statusClass}"><i></i>${statusText}</span>
      </div>
      <div class="my-node-notice"><b>实例说明</b><span>${esc(n.note || '合理使用严禁一切非法业务')}</span>${n.server_addr ? `<span class="my-node-speed">测速：<a href="https://www.itdog.cn/ping/${encodeURIComponent(n.server_addr)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">https://www.itdog.cn/ping/${esc(n.server_addr)}</a></span>` : ''}</div>
      <div class="my-node-specs">
        <div><span>端口</span><b>${p.max_ports}</b></div>
        <div><span>流量</span><b>${esc(quotaText)}</b></div>
        <div><span>带宽 / 月流量上限</span><b>${bw > 0 ? bw + ' Mbps' : '不限'} / ${limitGb > 0 ? usedGb + '/' + limitGb + ' GB' : '不限'}</b></div>
        <div><span>接入地址</span><b>${esc(n.server_addr || '-')}:${esc(n.server_port ?? '')}</b></div>
        <div><span>frps 版本</span><b>${esc(n.frps_version || '-')}</b></div>
      </div>
      <div class="my-node-foot">
        <div class="my-node-foot-row"><span>续费价格</span><b class="my-node-price-val">${(() => { const v = (planById[Number(p.plan_id)] || {}).price ?? p.renew_price; return v === null || v === undefined ? '已下架' : '¥' + fmtPts(v); })()}</b></div>
        <div class="my-node-foot-row"><span>自动延期</span><span class="my-node-auto">${p.auto_renew ? '已开启' : '未开启'}</span></div>
        <div class="my-node-foot-row"><span>到期时间</span><b>${esc(p.billing_mode === 'traffic' ? '按流量计费' : (p.expires_at ? p.expires_text : '不限期'))}</b></div>
      </div>
    </article>`;
  };
  const sections = regionNames.map(region => `
    <section class="my-node-section">
      <div class="section-title"><div><h2>${stIcon('node')}${esc(region)}</h2></div></div>
      <div class="my-node-grid">${groups[region].map(cardHtml).join('')}</div>
    </section>`).join('') || `<section class="card"><div class="empty-state"><strong>还没有实例</strong><p class="muted small">去「新建实例」购买套餐后，这里会显示你的实例。</p><button type="button" onclick="loadNewNode()">新建实例</button></div></section>`;
  app.innerHTML = appLayoutHtml(`
    <div class="page-head-row">
      ${instCrumbBar('我的实例')}
      <div class="row" style="gap:10px"><button type="button" onclick="loadNewNode()">新建实例</button></div>
    </div>
    ${sections}
  `, 'dashboard-myplans', '我的实例');
}

function instanceScopeOf(nodeId, planId, nodeName, planName){
  const sel = window.__selectedNode || {};
  return {
    node_id: Number(nodeId || sel.id || 0),
    plan_id: Number(planId || sel.planId || 0),
    node_name: nodeName || sel.name || '',
    plan_name: planName || sel.planName || ''
  };
}

function openInstanceConfig(nodeId, planId, nodeName, planName){
  window.__cfgScope = instanceScopeOf(nodeId, planId, nodeName, planName);
  loadDashboard('editor');
}

function openInstanceConfigDownload(nodeId, planId, nodeName, planName){
  window.__cfgScope = instanceScopeOf(nodeId, planId, nodeName, planName);
  loadDashboard('cfgdl');
}

function instCrumbBar(current, parents){
  const chev = '<svg class="inst-crumb-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const links = (parents || []).map(p => `<button type="button" class="inst-crumb-link" onclick="${p.onclick}">${p.label}</button>${chev}`).join('');
  return `<nav class="inst-crumb" aria-label="导航">
    <span class="inst-crumb-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><circle cx="17.5" cy="6" r="2.6"/><circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="18" r="2.6"/><path d="M8.8 10.7l6.4-3.4M8.8 13.3l6.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </span>
    ${links}
    <span class="inst-crumb-current">${esc(current)}</span>
  </nav>`;
}

function instanceCrumbHtml(current){
  const scope = window.__cfgScope || {};
  const nodeId = Number(scope.node_id || 0), planId = Number(scope.plan_id || 0);
  const nodeName = String(scope.node_name || '实例');
  const planName = String(scope.plan_name || '');
  const escName = nodeName.replace(/'/g, "\\'");
  const escPlan = planName.replace(/'/g, "\\'");
  const label = planName ? `${esc(nodeName)} · ${esc(planName)}` : esc(nodeName);
  return instCrumbBar(current, [
    { label: '我的实例', onclick: 'loadMyPlans()' },
    { label, onclick: `openInstanceTunnels(${nodeId}, '${escName}', ${planId}, '${escPlan}')` }
  ]);
}

function openInstanceTunnels(nodeId, nodeName, planId, planName){
  window.__selectedNode = { id: Number(nodeId || 0), name: nodeName || '', planId: Number(planId || 0), planName: planName || '' };
  loadDashboard('tunnels');
}

function initPayoutAccountForm(){
  const form = document.querySelector('#payoutAccountForm');
  if(!form) return;
  const qrFile = form.querySelector('#qrFile');
  if(qrFile) qrFile.onchange = async () => {
    const f = (qrFile.files || [])[0];
    if(!f) return;
    try{
      const token = await uploadImage(f, 'qr');
      form.elements.qr_token.value = token;
      const box = document.querySelector('#qrPreview');
      if(box) box.innerHTML = `<img src="/api/upload/${encodeURIComponent(token)}" alt="收款码">`;
      show('收款码已上传，记得保存');
    }catch(err){ show(err.message || '上传失败', true); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const token = String((form.elements.qr_token || {}).value || '').trim();
    if(!token){ show('请先上传收款码', true); return; }
    try{
      const r = await api('/api/user/payout-account/save', {method:'POST', body:Object.fromEntries(new FormData(form))});
      show(r.message || '已保存');
    }catch(err){ show(err.message || '保存失败', true); }
  };
}

function initProfilePoints(){
  const rf = document.querySelector('#profileRechargeForm');
  if(rf){
    const inp = rf.querySelector('input[name="amount"]');
    const hint = document.querySelector('#profileAmountHint');
    const refresh = () => {
      const amt = Number(inp && inp.value || 0);
      if(hint) hint.textContent = amt > 0 ? `应付 ¥${amt.toFixed(2)}` : '请输入充值金额';
    };
    if(inp) inp.addEventListener('input', refresh);
    refresh();
    rf.onsubmit = async (e) => {
      e.preventDefault();
      const amt = Number(new FormData(e.target).get('amount') || 0);
      if(!amt || amt < 0.01){ await appAlert('请输入有效的充值金额', {title:'提示'}); return; }
      try{
        const r = await api('/api/user/recharge/orders', {method:'POST', body:{amount:amt}});
        const order = r.order || {};
        if(!order.pay_url){ await appAlert('下单失败：没有支付链接', {title:'提示'}); return; }
        window.location.href = order.pay_url;
      }catch(err){ await appAlert(err.message, {title:'充值失败'}); }
    };
  }
  const kf = document.querySelector('#profileKeyForm');
  if(kf){
    kf.onsubmit = async (e) => {
      e.preventDefault();
      const key = String(new FormData(e.target).get('key') || '').trim();
      if(!key){ await appAlert('请输入充值密钥', {title:'提示'}); return; }
      try{
        const r = await api('/api/user/redeem', {method:'POST', body:{key}});
        await appAlert(r.message || '充值成功', {title:'充值成功'});
        await loadDashboard('profile');
      }catch(err){ await appAlert(err.message, {title:'充值失败'}); }
    };
  }
}

async function loadPoints(){
  hideFlash(); clearAdminDashboardTimer(); setNav();
  let data;
  try{ data = await api('/api/user/balance'); }
  catch(err){
    if(err.message === 'unauthorized') return renderLogin();
    show(err.message, true);
    return;
  }
  const payment = data.payment || {};
  const rate = 1;
  const usableChannels = (payment.providers || []).filter(x => x.ready && x.key !== 'mock');
  const channelHtml = usableChannels.length > 1
    ? `<div class="span-2"><label>支付方式</label><div class="pay-channels">${usableChannels.map((x, i) => `<label class="check"><input type="radio" name="provider" value="${x.key}"${i === 0 ? ' checked' : ''}> ${x.name}</label>`).join('')}</div></div>`
    : (usableChannels.length === 1 ? `<input type="hidden" name="provider" value="${usableChannels[0].key}">` : '');
  // 未开通任何在线支付渠道时不展示充值表单，避免用户提交后必然失败
  const onlineRechargeHtml = usableChannels.length ? `
          <div class="section-title"><div><h2>${stIcon('license')}在线充值</h2><p>选择金额并完成支付，余额立即到账</p></div></div>
          <form id="pointsRechargeForm" class="grid">
            <div><label>充值金额（元）</label><input name="amount" type="number" min="0.01" step="0.01" value="10" required><span class="muted small" id="pointsAmountHint">应付 ¥10.00</span></div>
            ${channelHtml}
            <div class="form-actions" style="grid-column:1/-1"><button>去支付</button></div>
          </form>
          <div class="billing-divider"></div>` : `
          <p class="muted small">当前仅支持密钥充值，在线支付暂未开通。</p>
          <div class="billing-divider"></div>`;
  const kindText = {recharge:'在线充值', key_recharge:'密钥充值', plan_purchase:'购买套餐', admin_adjust:'管理员调整'};
  const rows = (data.logs || []).map((l, i) => `<tr>
      <td>${i + 1}</td>
      <td>${fmtTs(l.created_at)}</td>
      <td>${kindText[l.kind] || esc(l.kind)}</td>
      <td>${l.delta > 0 ? '+' : '-'}¥${fmtPts(Math.abs(Number(l.delta || 0)))}</td>
      <td>¥${fmtPts(l.balance_after)}</td>
      <td>${esc(l.note || l.ref || '-')}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">暂无交易记录</td></tr>';
  app.innerHTML = appLayoutHtml(`
    <div class="ov-page-head"><div><span class="section-kicker">BILLING</span><h1>账单与充值</h1><p>查看余额、充值方式与交易历史。</p></div></div>
    <div class="billing-grid">
      <div class="billing-left">
        <section class="card billing-balance">
          <div class="billing-balance-head"><span>当前余额</span><span class="status-badge ok"><i></i>可用</span></div>
          <div class="billing-balance-value">¥${fmtPts(data.balance)} <small>元</small></div>
          <div class="billing-balance-meta"><span>余额仅用于购买套餐，不可提现</span><span>收益提现请到提现工单</span></div>
        </section>
        <section class="card">
          ${onlineRechargeHtml}
          <div class="section-title"><div><h2>${stIcon('key')}充值密钥</h2><p>输入管理员发放的密钥，立即到账</p></div></div>
          <form id="pointsKeyForm" class="grid">
            <div><label>充值密钥</label><input name="key" placeholder="PT-..." required></div>
            <div class="form-actions" style="grid-column:1/-1"><button>兑换</button></div>
          </form>
        </section>
      </div>
      <section class="card billing-history">
        <div class="section-title"><div><h2>${stIcon('chart')}交易历史</h2><p>最近 100 条记录</p></div></div>
        <table><thead><tr><th>序号</th><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>
      </section>
    </div>
  `, 'dashboard-points', '账单与充值');

  const rf = document.querySelector('#pointsRechargeForm');
  if(rf){
    const pointsInput = rf.querySelector('input[name="amount"]');
    const amountHint = document.querySelector('#pointsAmountHint');
    const refreshAmount = () => {
      const amt = Number(pointsInput && pointsInput.value || 0);
      if(amountHint) amountHint.textContent = amt > 0 ? `应付 ¥${amt.toFixed(2)}` : '请输入充值金额';
    };
    if(pointsInput) pointsInput.addEventListener('input', refreshAmount);
    refreshAmount();
    rf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amt = Number(fd.get('amount') || 0);
      const provider = String(fd.get('provider') || '');
      if(!usableChannels.length){ show('管理员未配置在线支付，请使用密钥充值', true); return; }
      if(!amt || amt < 0.01){ show('请输入有效的充值金额', true); return; }
      try{
        const r = await api('/api/user/recharge/orders', {method:'POST', body:{amount:amt, provider}});
        const order = r.order || {};
        if(!order.pay_url){ show('下单失败：没有支付链接', true); return; }
        window.location.href = order.pay_url;
      }catch(err){ show(err.message, true); }
    };
  }
  const kf = document.querySelector('#pointsKeyForm');
  if(kf){
    kf.onsubmit = async (e) => {
      e.preventDefault();
      const key = String(new FormData(e.target).get('key') || '').trim();
      if(!key){ show('请输入充值密钥', true); return; }
      try{
        const r = await api('/api/user/redeem', {method:'POST', body:{key}});
        await appAlert(r.message || '充值成功', {title:'充值成功'});
        await loadPoints();
      }catch(err){ show(err.message, true); }
    };
  }
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

async function sendRegisterCode(){
  const u = document.querySelector('#registerUsername');
  const e = document.querySelector('#registerEmail');
  const btn = document.querySelector('#registerCodeBtn');
  const name = u ? u.value.trim() : '';
  const email = e ? e.value.trim() : '';
  if(!name){ show('请先填写用户名', true); return; }
  if(!email){ show('请先填写邮箱', true); return; }
  if(btn) btn.disabled = true;
  try{
    const r = await api('/api/register/request-code', {method:'POST', body:{username:name, email:email}});
    show(r.message || '验证码已发送');
    let n = 60;
    if(btn){
      btn.textContent = n + 's';
      const t = setInterval(() => { n--; if(n <= 0){ clearInterval(t); btn.disabled = false; btn.textContent = '获取验证码'; } else { btn.textContent = n + 's'; } }, 1000);
    }
  }catch(err){ if(btn) btn.disabled = false; show(err.message, true); }
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
    if(currentUser) await handlePayReturn();
  }catch{ renderLogin(); }
}

async function handlePayReturn(){
  const qp = new URLSearchParams(location.search);
  const pay = qp.get('pay');
  if(!pay) return;
  const orderNo = qp.get('order') || '';
  history.replaceState(null, '', location.pathname);
  if(currentUser && currentUser.role === 'admin') return;
  if(pay === 'success'){
    show('支付成功，套餐已开通');
    return loadPlans();
  }
  if(orderNo){
    try{
      const r = await api('/api/orders/status?order_no=' + encodeURIComponent(orderNo));
      if(r.order && r.order.status === 'paid'){ show('支付成功，套餐已开通'); return loadPlans(); }
    }catch(e){}
  }
  show('支付结果确认中，如已扣款请稍后刷新订单', true);
  return loadPlans();
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

function switchConfigNode(nodeId){
  document.querySelectorAll('[data-cfg]').forEach(a => {
    const base = a.getAttribute('data-cfg') === 'frpc' ? '/config/frpc.toml' : '/config/deploy-frpc.sh';
    const token = a.getAttribute('data-token') || '';
    a.href = base + '?node_id=' + encodeURIComponent(nodeId) + (token ? '&token=' + encodeURIComponent(token) : '');
  });
  const cmd = document.querySelector('#cfgCmd');
  if(cmd){
    const base = cmd.getAttribute('data-base') || '';
    const next = base + (base.includes('?') ? '&' : '?') + 'node_id=' + encodeURIComponent(nodeId);
    cmd.textContent = next;
    const btn = cmd.parentElement && cmd.parentElement.querySelector('.copy-inline');
    if(btn) btn.setAttribute('data-copy-address', next);
  }
}

async function loadInstancePorts(nodeId){
  const sel = document.querySelector('#tunnelForm select[name="remote_port"]');
  if(!sel || !nodeId) return;
  try{
    const r = await api('/api/user/nodes/' + Number(nodeId) + '/ports');
    const ports = r.ports || [];
    const cur = sel.value;
    // 正在编辑的隧道自己占用的端口不能禁用：disabled 的选中项不会随表单提交，
    // 后端会收到 0 并提示「TCP/UDP 必须选择公网端口」。
    const editing = (lastTunnels || []).find(t => Number(t.id) === Number(editingTunnelId));
    const ownPort = editing ? Number(editing.remote_port) : 0;
    sel.innerHTML = ports.length
      ? ports.map(p => {
          const own = Number(p.port) === ownPort;
          return `<option value="${p.port}"${p.used && !own ? ' disabled' : ''}${String(p.port) === String(cur) ? ' selected' : ''}>${p.port}${p.used && !own ? '（已用）' : ''}</option>`;
        }).join('')
      : '<option value="">该实例暂无端口</option>';
  }catch(e){}
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
  const tunnelRowHtml = (t) => {
    const endpointRaw = tunnelEndpointText(t, data.frps);
    const endpointScheme = t.proxy_type === 'https' ? 'https://' : (['http','tcp'].includes(t.proxy_type) ? 'http://' : '');
    const endpointShown = (endpointScheme && endpointRaw && endpointRaw !== '-') ? endpointScheme + endpointRaw : endpointRaw;
    const endpoint = esc(endpointShown);
    const runtime = tunnelRuntimeStats(t, data.frps_user_dashboard);
    const mapState = tunnelMappingState(t);
    return `<article class="tc-card${t.enabled ? '' : ' is-off'}">
      <div class="tc-head">
        <span class="tc-type">${esc(String(t.proxy_type || 'tcp').slice(0, 1).toUpperCase())}</span>
        <span class="tc-title"><strong title="${esc(t.name)}">${esc(t.name)}</strong><small>${esc(t.proxy_type)} 隧道</small></span>
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
  };
  const tunnelRows = data.tunnels.map(tunnelRowHtml).join('') || `<div class="empty-state"><strong>还没有隧道</strong><p class="muted small">创建第一个隧道后，就能在这里查看本地服务、公网入口和运行状态。</p><button onclick="loadDashboard('tunnels')">新建隧道</button></div>`;
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
        <section class="workspace-stat ov-stat" style="--ov-accent:#3478f6;--ov-tint:#eef4ff">
          <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.tunnel}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">隧道数量</span><strong class="ov-stat-value">${tunnelCount}</strong><span class="ov-stat-sub">${data.tunnels.filter(t => t.enabled).length} 条正在运行</span></div></div>
          <div class="tunnel-usage">
            <div class="tunnel-usage-label"><span>${tunnelUsageLabel}</span><b>${tunnelLimit > 0 ? `${tunnelUsagePercent}%` : '—'}</b></div>
            <div class="tunnel-usage-track" role="progressbar" aria-label="隧道使用情况" aria-valuemin="0" aria-valuemax="${tunnelLimit || tunnelCount || 1}" aria-valuenow="${tunnelLimit > 0 ? Math.min(tunnelCount, tunnelLimit) : tunnelCount}"><span style="width:${tunnelUsagePercent}%"></span></div>
          </div>
        </section>
        <section class="workspace-stat ov-stat" style="--ov-accent:#22c55e;--ov-tint:#f0fdf4">
          <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg></span><div class="ov-stat-copy"><span class="ov-stat-label">当前实例</span><strong class="ov-stat-value">${esc(node.region || node.name || '-')}</strong><span class="ov-stat-sub">${esc(node.name || '未分配实例')}</span></div><span class="ov-stat-state ${nodeStateClass}"><i></i>${nodeState}</span></div>
          <div class="ov-node-meta"><span>延迟 <b id="overviewNodeLatencyValue" data-fallback="${esc(nodeLatency)}">${esc(nodeLatency)}</b></span><span class="ov-node-meta-sep">·</span><span>带宽 <b>${node.bandwidth_mbps || node.bandwidth || node.bandwidth_mbps === 0 ? esc(node.bandwidth_mbps ?? node.bandwidth) + ' Mbps' : '未设置'}</b></span></div>
        </section>
        <section class="workspace-stat ov-stat" style="--ov-accent:#8b5cf6;--ov-tint:#f5f2ff">
          <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.chart}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">今日流量</span><strong class="ov-stat-value">${fmtBytes(todayTraffic)}</strong><span class="ov-stat-sub">${trafficLimit ? '上限 ' + fmtBytes(trafficLimit) : '当前不限额；按今日统计'}</span></div></div>
${trafficLimit > 0 ? `<div class="tunnel-usage"><div class="tunnel-usage-label"><span>${trafficUsageLabel}</span><b>${trafficUsagePercent}%</b></div><div class="tunnel-usage-track" role="progressbar" aria-label="今日流量使用情况" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${trafficUsagePercent}"><span style="width:${trafficUsagePercent}%"></span></div></div>` : ''}
        </section>
        <section class="workspace-stat ov-stat" style="--ov-accent:#f59e0b;--ov-tint:#fff8ec">
          <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.6 10.2h4.2a2.1 2.1 0 0 1 0 4.2H9.6"/></svg></span><div class="ov-stat-copy"><span class="ov-stat-label">账户余额</span><strong class="ov-stat-value">¥${fmtPts(data.user.balance)}</strong><span class="ov-stat-sub">可用于购买套餐</span></div></div>
          <div class="ov-points-action"><button type="button" class="secondary" onclick="loadPoints()">账单充值</button></div>
        </section>
        <section class="workspace-stat ov-stat" style="--ov-accent:#2c6dd2;--ov-tint:#eef4ff">
          <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.port}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">端口上限</span><strong class="ov-stat-value">${esc(data.user.max_ports ?? '-')}</strong><span class="ov-stat-sub">可分配端口总数</span></div></div>
          <div class="tunnel-usage">
            <div class="tunnel-usage-label"><span>${portUsageLabel}</span><b>${tunnelLimit > 0 ? portUsagePercent + '%' : '—'}</b></div>
            <div class="tunnel-usage-track" role="progressbar" aria-label="端口使用情况" aria-valuemin="0" aria-valuemax="${tunnelLimit || tunnelCount || 1}" aria-valuenow="${tunnelLimit > 0 ? Math.min(tunnelCount, tunnelLimit) : tunnelCount}"><span style="width:${portUsagePercent}%"></span></div>
          </div>
        </section>
      </div>
      <div class="user-dashboard-grid">
        <section class="card node-status-card node-map-panel"><div class="node-map-backdrop" aria-hidden="true"><div class="node-map-grid"></div><svg class="node-map-world" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice"><defs><filter id="nodeMapSoft" x="-6%" y="-6%" width="112%" height="112%"><feGaussianBlur stdDeviation="1.7"/></filter></defs><g class="node-map-graticule"><line x1="0" y1="84" x2="1000" y2="84"/><line x1="0" y1="167" x2="1000" y2="167"/><line x1="0" y1="251" x2="1000" y2="251"/><line x1="0" y1="335" x2="1000" y2="335"/><line x1="0" y1="418" x2="1000" y2="418"/><line x1="167" y1="0" x2="167" y2="500"/><line x1="333" y1="0" x2="333" y2="500"/><line x1="500" y1="0" x2="500" y2="500"/><line x1="667" y1="0" x2="667" y2="500"/><line x1="833" y1="0" x2="833" y2="500"/></g><g class="node-map-land" filter="url(#nodeMapSoft)"><path d="M335 578 333 581 327 581 321 581 317 580 316 578 322 579 328 579 330 577 332 576 335 578ZM58 576 52 576 49 575 47 574 45 573 47 571 52 572 55 573 57 574 58 576ZM375 571 378 572 379 574 380 576 380 578 375 579 371 580 366 580 360 581 353 581 350 580 350 578 356 577 358 576 360 575 361 573 363 572 365 571 370 570 375 571ZM163 555 167 555 170 555 166 557 162 556 159 555 163 555ZM151 555 155 556 150 555 146 554 148 554 151 555ZM225 549 228 550 231 549 233 551 231 551 227 551 224 551 220 551 217 550 217 548 221 549 225 549ZM310 546 310 549 306 550 303 551 299 551 297 550 294 551 292 550 292 548 295 547 297 546 300 546 301 543 301 541 302 539 305 538 306 540 308 543 310 546ZM0 594 3 592 8 593 10 592 12 592 16 593 19 592 28 591 31 592 36 594 44 594 50 596 61 596 69 595 81 596 87 597 95 596 102 595 92 593 83 593 81 591 73 590 75 587 75 585 71 584 69 582 64 581 71 582 78 581 82 582 86 581 91 580 93 579 92 577 89 576 85 575 79 575 74 575 69 574 67 573 63 572 61 571 60 567 64 568 69 568 73 567 75 569 80 568 83 568 87 567 90 565 94 565 93 562 97 561 99 562 103 561 107 560 111 560 114 560 118 559 121 558 124 557 127 558 133 557 136 558 140 558 144 557 148 558 152 558 156 558 160 558 164 558 167 558 170 557 174 556 177 557 180 557 183 555 185 556 186 558 188 559 191 558 194 559 198 560 201 561 205 560 209 560 213 560 217 560 220 561 222 559 220 558 215 557 214 555 212 551 214 552 218 552 221 552 225 553 227 554 229 555 232 555 236 555 240 554 243 553 246 554 250 554 252 551 254 553 258 553 261 553 263 555 267 555 270 555 274 556 276 555 277 553 280 555 284 554 286 555 288 556 292 556 295 555 298 554 301 554 305 553 309 553 311 552 313 551 314 549 312 547 311 545 310 543 310 541 311 539 312 537 312 534 313 531 315 530 317 529 321 527 322 525 325 523 328 523 331 521 334 521 336 520 339 519 341 519 340 521 337 522 334 522 332 522 330 523 328 524 326 525 326 528 326 530 323 530 321 531 318 534 319 536 320 538 322 538 324 540 326 541 327 544 329 546 330 549 330 551 331 553 331 555 330 557 328 558 324 558 323 560 321 561 317 562 313 563 310 563 306 564 304 566 299 566 295 566 290 566 285 566 291 568 294 569 292 571 288 571 284 572 283 575 287 576 291 578 297 579 302 580 306 581 311 582 317 583 324 584 329 585 334 586 337 587 338 589 342 588 346 587 351 585 357 585 362 584 369 583 375 584 381 585 383 583 387 582 394 582 399 581 404 581 410 580 416 580 421 579 419 577 418 575 412 575 406 576 401 576 400 574 401 572 406 570 411 569 414 568 417 567 420 566 424 565 427 565 429 564 434 564 438 564 441 563 444 562 447 561 451 560 454 559 456 558 454 556 455 554 457 553 460 553 463 552 466 551 468 549 471 547 475 547 479 548 481 546 484 546 488 547 492 547 495 546 498 547 502 547 505 546 508 546 511 545 514 544 517 544 520 543 522 542 524 543 526 542 528 544 530 545 533 545 534 543 537 542 541 542 542 544 544 542 547 542 551 542 553 542 557 542 560 542 561 544 563 545 566 544 569 544 572 544 575 544 578 543 581 543 583 542 586 541 589 541 591 540 593 538 597 538 600 540 603 539 605 541 607 541 610 541 611 539 614 538 617 537 619 537 623 536 625 535 627 535 629 534 632 534 634 533 636 532 639 532 641 531 644 529 646 528 649 528 651 528 654 528 657 528 659 529 659 531 661 532 663 533 666 533 668 534 671 535 673 535 676 535 678 533 681 534 683 534 686 535 689 535 691 535 694 539 693 541 691 542 688 543 689 545 692 545 690 547 689 549 691 550 694 550 697 550 699 548 701 546 703 545 705 542 707 541 710 541 713 541 716 540 718 538 720 536 722 535 725 535 728 533 730 532 733 533 735 532 738 532 741 532 743 531 744 529 747 532 749 532 752 532 754 532 757 532 760 532 762 532 764 532 766 533 769 533 772 533 774 532 777 533 779 531 782 529 786 527 790 528 795 531 798 532 800 532 803 531 806 531 808 530 810 529 813 528 816 528 818 528 819 530 821 531 824 530 826 531 829 532 833 533 836 532 838 531 840 530 842 530 845 530 848 531 850 530 853 530 855 530 858 531 860 530 863 530 866 530 869 530 872 529 874 529 875 527 877 527 878 530 882 532 885 531 889 531 891 531 895 531 897 531 901 531 904 531 906 532 906 534 910 536 913 537 917 537 921 538 924 538 927 538 929 537 931 538 933 539 936 540 939 540 942 541 944 542 947 543 949 544 952 545 955 545 958 545 961 545 965 545 968 546 971 547 974 547 976 548 975 550 973 552 972 554 970 555 967 556 965 557 961 558 958 560 956 561 955 563 954 566 956 569 958 571 963 572 959 574 955 574 949 575 947 577 945 579 944 581 948 582 951 585 955 586 959 587 963 588 969 589 971 591 979 592 981 593 989 592 995 593ZM312 485 315 488 319 488 318 490 315 490 313 491 311 492 308 491 306 490 303 490 299 488 296 486 293 482 295 483 299 485 302 486 304 485 305 482 307 481 309 481 310 483 312 485ZM337 476 340 477 339 479 335 480 334 478 331 480 330 478 333 476 336 477ZM695 471 691 471 691 469 691 467 693 468 696 469 695 471ZM904 439 907 441 910 439 912 440 912 444 911 448 908 449 906 449 904 446 904 444 902 441 902 439 904 439ZM981 440 983 440 984 443 981 447 981 450 979 450 976 452 976 454 974 457 972 459 970 460 968 460 966 459 963 459 963 457 964 455 968 451 971 449 974 447 975 445 977 443 978 440 980 438 981 440ZM985 423 987 427 987 424 989 428 991 429 993 429 996 429 995 432 994 434 992 434 992 436 990 439 989 441 987 443 985 441 987 438 986 436 983 435 985 432 985 430 985 427 984 425 983 423 981 420 980 417 982 419 984 420 985 423ZM964 374 962 374 960 372 958 370 956 368 958 368 960 369 963 372 964 374ZM995 357 996 360 994 360 992 358 994 357ZM998 355 996 356 996 354 998 353M966 354 964 353 966 354ZM964 348 965 351 963 351 963 347ZM639 344 639 348 640 351 638 351 639 354 637 356 637 359 636 363 635 368 633 375 632 380 631 384 629 384 626 386 622 384 622 382 621 379 620 376 620 373 621 371 622 369 623 366 624 364 622 360 622 357 623 355 623 353 625 353 627 351 629 351 630 349 633 347 633 345 636 342 636 340 637 338 638 340 639 344ZM899 344 900 347 902 346 904 349 904 353 905 355 906 358 906 360 907 363 910 364 912 366 913 368 915 371 916 374 918 375 919 378 921 381 925 385 925 388 925 390 925 392 927 395 926 398 926 400 925 403 925 405 925 407 923 410 921 412 920 415 919 417 919 420 917 424 917 426 917 428 915 429 912 429 909 430 908 432 906 433 904 432 902 431 903 429 901 430 899 432 897 431 895 431 893 431 891 430 889 427 888 425 888 423 886 422 884 421 885 419 884 417 883 419 880 420 882 418 882 416 883 414 883 412 881 415 879 416 878 419 876 417 876 415 874 413 872 411 869 408 867 408 865 407 860 407 856 408 853 409 850 409 847 411 845 412 845 414 843 415 841 415 839 416 837 415 835 415 833 415 831 417 829 418 826 419 824 419 821 417 820 414 821 412 822 409 821 407 820 404 819 402 820 400 818 397 817 395 817 392 815 389 815 386 817 388 816 384 815 382 815 380 816 377 816 375 817 372 817 375 818 373 821 371 824 369 826 369 828 368 830 367 833 366 836 365 838 362 840 360 840 358 842 354 843 357 843 354 845 353 845 351 847 349 848 347 850 346 852 345 855 346 857 348 860 348 861 344 862 342 863 340 865 339 868 338 866 335 868 335 871 337 873 338 876 339 878 338 880 339 880 341 879 343 877 346 876 348 879 351 881 352 884 355 886 356 889 358 891 357 892 355 892 353 894 349 893 347 893 344 893 341 894 339 895 336 896 333 897 335 897 337 898 339 899 341 899 343ZM950 333 948 332 950 333ZM835 332 830 329 833 329 835 330 835 332ZM947 331 944 330 944 328 946 330ZM949 330 947 327 946 325 948 328 949 330ZM846 331 843 332 844 328 847 327 850 325 852 325 854 325 850 328 847 329 846 331ZM827 324 830 325 828 327 826 328 824 328 825 326 827 326 827 324ZM841 324 841 326 837 327 833 327 835 325 837 326 839 326 841 324ZM944 325 942 324 939 322 941 322 943 324ZM938 322 936 321 935 319 938 322ZM802 320 807 320 813 320 814 323 818 323 821 325 818 327 815 325 813 325 810 325 807 324 804 323 802 323 796 322 795 320 793 320 795 317 798 317 800 318 802 320ZM874 318 873 320 873 317 874 315 874 318ZM933 320 931 319 930 317 929 314 931 315 932 318 933 320ZM922 315 920 316 917 318 914 317 912 316 915 315 917 313 917 315 919 315 921 313 921 310 923 310 923 313 922 315ZM853 308 851 308 853 307ZM862 307 863 309 861 308 859 308 857 308 855 308 856 306 859 306 862 307ZM925 312 924 310 922 308 921 306 919 305 921 306 923 307 924 309 925 312ZM873 300 873 306 876 308 879 304 882 302 884 302 887 303 889 304 892 305 896 307 902 309 904 311 905 313 906 315 910 317 911 319 908 319 909 322 911 324 913 328 915 328 917 330 919 332 917 333 914 332 911 331 909 329 907 327 906 324 902 323 900 324 898 325 898 327 896 329 892 328 889 325 886 324 882 325 883 323 885 322 884 318 883 315 878 312 875 311 871 308 870 310 869 307 867 306 870 304 872 305 867 304 866 301 864 301 863 299 866 298 868 297 872 299ZM848 291 846 294 844 295 841 294 836 294 834 295 833 298 836 301 837 299 843 298 842 300 840 301 838 302 840 307 842 312 842 315 840 314 841 311 838 313 838 311 836 308 836 305 834 306 834 310 835 315 833 316 832 311 832 308 830 306 831 303 831 301 833 295 836 291 838 292 841 293 845 293 847 290ZM857 292 857 295 855 297 857 299 855 297 854 292 854 289 856 290 857 292ZM794 316 791 316 789 314 785 311 784 309 782 306 780 303 778 298 776 295 775 292 774 289 771 287 770 284 768 282 765 278 765 276 771 277 773 281 775 283 777 285 780 288 782 288 785 291 786 294 788 295 787 298 789 300 790 302 791 304 793 304 795 307 794 311 794 316ZM827 289 831 293 827 293 826 295 826 299 824 301 824 305 823 310 819 310 818 308 816 308 811 308 810 306 808 307 806 306 806 301 804 300 803 297 803 294 803 291 805 289 807 290 809 289 809 286 811 286 814 285 816 282 817 280 821 277 823 274 824 271 827 273 827 275 829 276 831 277 829 278 829 280 827 281 826 284 828 288ZM851 266 851 268 851 270 851 274 850 270 848 272 849 274 848 276 845 274 844 272 845 270 843 268 842 270 839 271 840 267 842 266 844 267 846 266 847 264 849 264 848 261 851 263 851 265ZM726 274 723 275 722 272 721 267 723 261 725 263 726 266 727 269 727 273ZM331 260 328 261 329 259 330 257 331 260ZM844 260 843 263 840 262 841 260 842 257 843 260 845 256 844 260ZM829 263 825 266 827 264 829 262 831 259 832 256 832 259 831 261 829 263ZM839 254 842 255 841 258 839 259 839 257 839 254ZM849 253 849 257 847 256 848 259 846 257 845 255 847 256 847 254 845 252 848 252ZM838 250 837 253 836 251 834 248 837 248 838 250ZM837 231 839 232 840 236 840 239 838 240 838 243 838 245 840 246 844 247 844 249 845 252 842 250 841 248 839 247 836 248 835 246 835 244 833 242 833 238 834 234 835 231 837 231ZM318 232 315 232 313 233 313 231 316 231 318 232ZM286 233 284 233 282 232 284 231 286 231 288 232 286 233ZM298 226 301 226 303 226 305 227 308 228 310 230 309 232 307 231 305 232 303 231 302 234 301 232 299 232 296 232 293 231 296 231 298 231 298 229 298 227 296 227 298 226ZM806 230 804 232 802 231 802 228 803 226 806 225 808 225 807 228 806 230ZM68 229 66 226 67 224 69 225 70 227 68 229ZM65 221 63 221 65 221ZM62 221 60 220 62 221ZM279 216 282 217 286 220 288 221 290 222 292 223 294 224 292 226 290 226 288 226 284 226 286 224 283 223 281 220 277 219 273 218 273 216 270 216 268 218 265 219 266 216 269 215 271 215 274 214 276 214 279 216ZM285 212 283 210 283 207 285 210 285 212ZM837 216 835 218 834 215 834 213 835 209 837 207 839 208 838 210 837 216ZM284 202 281 203 281 201 284 201ZM286 202 286 205 285 202ZM874 176 873 179 870 179 869 181 868 178 869 176 871 176 874 176ZM596 170 594 172 592 174 590 174 590 172 592 171 594 171 596 170ZM566 170 570 171 572 171 573 173 569 173 565 172 566 170ZM543 161 542 164 542 167 540 166 538 165 535 163 538 162 541 161 543 161ZM526 151 527 153 527 158 524 159 523 154 523 152 526 151ZM892 165 891 168 891 170 890 172 886 174 881 174 877 178 875 177 875 174 870 175 867 176 864 176 867 179 865 185 863 187 862 185 862 182 859 179 862 177 864 175 866 173 868 171 874 170 877 171 880 164 882 166 886 163 887 161 889 157 889 153 890 151 893 150 894 155 894 158 892 161 892 165ZM527 147 526 150 524 149 524 147 526 144 527 147ZM900 140 902 141 904 139 904 143 900 144 898 148 893 145 892 149 889 149 888 146 890 143 893 143 894 138 894 135 898 139 900 140ZM323 132 325 132 328 132 326 134 322 132 322 130 323 132ZM328 123 323 122 321 120 325 121 328 122ZM157 125 151 124 148 121 144 120 143 118 146 118 148 118 151 119 153 122 156 123 157 125ZM344 117 342 120 344 119 346 120 347 122 349 121 351 122 351 125 353 124 353 126 354 128 353 131 351 132 350 128 346 131 344 131 346 129 344 128 341 128 335 128 337 126 335 125 338 123 341 117 342 115 345 114 344 117ZM131 105 134 105 133 109 136 112 133 110 130 108 130 106ZM899 117 902 123 898 122 896 127 899 131 899 133 897 131 895 134 894 131 894 128 894 124 895 121 895 116 893 113 894 108 896 106 896 104 897 107 898 110 898 114 899 117ZM481 112 476 114 472 113 475 110 473 106 477 103 479 102 481 102 484 104 483 106 483 109 481 112ZM535 100 534 103 531 101 530 99 534 98 535 100ZM75 95 72 96 70 93 73 92 76 92 75 95ZM492 89 489 93 492 93 495 93 494 96 491 99 494 99 497 103 499 104 501 108 505 110 504 112 504 115 502 117 498 117 493 118 490 119 487 119 485 120 488 115 491 115 486 114 488 112 487 110 487 107 491 108 492 106 490 103 487 103 487 100 484 101 484 98 483 96 484 92 486 89 488 90 492 89ZM40 85 38 85 35 84 38 83 40 83 40 85ZM280 77 279 79 277 77 279 76ZM273 75 269 77 267 77 269 74 273 74ZM23 71 25 72 29 72 31 73 29 74 27 73 23 73 23 71ZM263 65 265 66 267 67 270 68 273 69 276 70 275 72 271 72 269 70 266 72 262 74 261 72 258 72 260 70 260 68 261 64 263 65ZM460 62 459 64 462 66 459 69 451 72 448 72 445 72 437 71 440 69 433 67 438 67 432 65 434 62 439 62 443 64 447 62 451 63 455 62 460 62ZM289 59 286 60 285 58 287 56 289 55 291 56 291 58 289 59ZM0 53 7 56 14 59 14 61 16 62 15 60 23 60 28 63 25 65 21 65 21 69 17 69 15 68 11 67 8 65 5 66 3 64 0 64 2 65 0 67M1000 67 996 69 993 68 995 70 997 73 999 75 993 76 985 78 982 79 978 81 974 83 973 85 969 82 962 85 958 85 954 85 953 87 950 91 953 93 953 98 950 98 949 101 950 103 945 104 945 108 940 109 940 113 936 116 934 114 933 109 932 101 933 96 935 94 936 92 940 91 945 87 950 83 955 80 957 76 953 76 952 79 945 83 943 78 935 79 928 85 931 88 924 88 920 89 920 86 916 86 913 87 904 87 895 88 886 95 875 103 880 104 881 106 884 106 886 105 889 105 893 109 893 112 891 115 890 120 889 125 885 130 884 133 880 137 876 141 875 143 871 145 869 145 867 143 864 146 862 147 860 149 860 152 858 153 855 155 854 157 857 160 859 164 860 166 860 170 859 172 856 173 854 174 851 175 851 173 852 170 850 166 852 166 850 163 848 163 846 162 847 160 848 157 846 156 841 156 839 158 836 159 838 157 839 153 835 153 832 155 831 158 828 158 826 159 828 162 830 162 830 164 833 165 836 162 838 164 840 164 840 166 836 167 835 169 832 170 831 173 834 175 835 178 837 181 839 184 839 187 837 188 838 190 839 194 838 196 836 197 834 201 832 205 830 209 826 213 822 216 819 216 817 218 816 216 815 218 811 220 808 220 807 224 805 224 805 222 805 220 801 219 796 223 794 226 794 229 796 232 798 237 801 239 802 242 804 249 803 255 801 257 798 259 796 262 792 265 791 263 792 261 790 259 787 258 785 253 782 251 780 251 780 249 778 249 778 252 776 258 775 261 776 263 779 267 779 270 781 272 784 274 786 276 787 279 787 281 787 283 788 286 790 290 788 291 785 289 782 286 781 284 780 282 779 279 778 277 779 275 778 273 776 270 775 268 774 266 773 268 773 266 773 264 774 261 773 258 774 255 773 253 774 250 773 248 772 244 771 239 770 236 768 238 765 240 763 240 763 235 762 232 760 228 760 226 757 223 756 221 756 219 754 216 751 215 752 217 751 219 749 219 747 218 745 219 742 220 742 223 740 225 736 227 733 231 731 234 728 236 727 238 724 240 722 242 723 247 723 250 722 253 722 259 720 259 719 262 717 264 717 267 715 268 713 264 711 260 710 256 709 254 708 251 707 247 707 244 704 239 703 233 702 228 702 224 702 221 698 223 696 222 692 218 693 215 689 212 687 211 687 209 684 206 679 207 675 207 671 207 666 206 663 206 659 205 658 201 655 201 652 203 649 201 646 199 643 198 641 194 639 190 636 189 633 190 634 192 634 195 636 198 637 200 639 202 639 204 640 206 641 208 641 206 642 204 643 207 643 209 644 211 646 211 648 211 650 211 652 208 654 206 656 204 657 208 658 210 659 212 661 212 663 213 664 215 666 216 665 219 664 221 662 224 660 226 661 229 659 229 657 230 657 232 655 233 654 235 652 236 649 237 646 238 645 240 642 242 638 244 635 246 633 246 632 248 630 249 627 249 625 250 623 251 621 251 620 249 620 247 619 244 618 242 619 240 619 238 618 236 617 234 615 230 614 227 612 225 609 221 608 218 609 216 607 212 604 210 603 208 603 206 601 202 599 199 598 197 596 197 597 195 597 192 596 196 595 198 593 197 590 191 591 195 593 198 595 204 596 206 597 208 599 212 599 214 602 218 603 222 603 226 604 230 607 232 608 236 609 240 611 241 614 245 616 247 617 249 620 251 620 254 621 256 621 258 623 259 627 258 630 258 632 257 634 256 636 256 638 255 640 255 641 253 642 256 642 258 641 260 640 263 639 267 637 272 635 277 633 281 629 286 627 289 622 292 620 295 617 299 616 301 614 303 613 305 611 307 611 309 610 311 608 317 608 319 610 320 609 323 609 326 610 328 611 331 612 334 612 337 613 340 613 346 613 348 612 350 611 352 610 355 607 356 604 358 601 361 598 365 596 368 598 371 598 373 599 377 598 379 598 381 595 383 592 385 590 386 591 388 591 390 590 392 590 395 589 397 588 399 586 401 585 403 583 405 580 409 578 411 576 413 573 414 570 415 566 415 564 415 560 416 557 417 554 418 552 417 551 415 551 413 550 411 551 407 549 404 547 401 545 396 543 394 542 391 542 388 541 385 540 380 540 376 540 374 539 372 537 369 536 365 535 363 533 359 533 357 532 354 533 351 534 348 535 343 537 340 538 338 538 336 538 334 537 332 536 330 536 328 537 326 536 323 535 320 534 318 534 316 533 314 531 310 528 306 526 303 524 300 525 297 526 295 526 292 527 288 527 285 526 283 524 280 521 280 519 281 516 281 515 279 514 276 512 274 510 274 507 274 505 274 503 275 499 277 497 278 495 279 492 278 489 278 487 278 484 278 482 279 479 280 475 279 472 276 470 274 468 272 465 270 464 268 463 264 462 262 460 261 459 258 456 255 454 253 453 249 452 245 452 243 454 241 454 239 454 237 455 235 455 232 455 229 455 227 455 225 454 223 453 220 454 218 455 216 456 212 457 210 459 207 460 203 462 202 464 198 468 197 470 194 473 190 473 186 474 183 474 181 476 179 479 177 481 176 483 172 484 170 486 170 490 171 493 172 497 170 500 169 504 167 509 166 513 166 515 166 517 165 520 165 523 166 526 164 528 165 531 165 529 168 530 170 530 173 528 175 529 177 531 179 535 180 539 181 542 182 544 185 546 186 550 187 553 189 556 187 555 184 556 182 558 181 560 180 564 181 566 182 569 183 570 185 574 185 576 185 579 187 582 186 584 185 586 185 588 185 589 187 592 187 594 187 596 185 597 183 597 180 599 176 600 174 600 171 599 168 596 166 595 168 590 169 588 167 585 167 582 169 580 167 577 167 575 163 573 161 574 159 573 157 576 153 580 153 581 151 587 151 590 149 593 148 598 148 603 150 607 152 610 151 612 151 615 150 616 148 615 146 614 144 612 144 607 140 604 139 602 136 604 136 606 133 609 130 606 130 604 130 602 131 600 132 597 133 597 135 599 136 601 136 598 138 594 140 593 137 590 136 593 134 588 133 588 131 585 132 584 134 582 136 581 138 579 142 577 146 578 148 581 150 577 151 573 154 572 152 569 152 566 153 568 154 566 155 563 153 563 156 565 158 565 160 567 161 567 163 564 162 565 164 563 164 564 168 562 168 560 166 559 163 559 161 558 159 556 157 555 155 554 152 554 150 554 148 552 147 549 145 547 144 544 143 542 140 541 138 540 136 539 138 538 136 534 136 534 138 535 141 538 142 539 145 542 148 544 148 544 150 547 151 549 152 551 154 551 156 549 154 547 153 546 156 548 157 547 159 545 162 544 159 544 157 543 155 541 153 539 152 536 151 534 149 531 147 529 145 528 141 525 140 523 140 522 142 518 144 513 143 509 144 508 146 508 148 506 151 502 151 502 153 500 154 499 157 500 159 499 161 498 163 496 164 494 167 491 167 488 167 486 168 484 169 482 166 479 165 477 166 475 166 476 163 475 161 474 159 474 157 475 154 476 152 475 149 475 146 474 144 478 142 481 142 485 142 488 143 490 143 495 143 496 141 497 134 494 130 492 128 488 127 487 124 491 124 496 124 495 121 497 122 504 119 505 116 507 116 509 115 511 114 513 109 517 107 519 107 522 107 524 106 524 104 524 102 523 100 522 97 524 95 526 94 529 92 529 94 529 96 530 98 527 100 528 102 528 104 530 104 530 106 533 105 535 104 538 105 541 105 545 104 549 103 552 103 555 104 559 101 558 98 559 96 560 94 563 92 565 95 567 95 568 92 568 90 565 89 565 87 568 86 572 86 575 86 578 86 581 84 578 83 573 83 568 84 564 85 562 83 559 82 560 79 558 75 560 73 562 71 569 67 571 67 570 65 566 63 562 64 559 67 559 69 555 72 550 75 548 80 550 82 552 84 550 88 547 89 546 95 544 98 541 98 539 101 536 101 535 98 533 94 531 89 529 86 523 90 520 91 516 89 515 86 514 78 516 75 524 72 529 69 534 64 541 57 546 54 553 50 559 48 564 49 568 46 573 46 578 45 587 48 583 49 586 51 589 50 594 52 601 53 612 57 614 58 614 61 611 62 607 63 594 61 592 61 597 64 597 69 601 70 603 71 603 69 601 68 603 66 610 69 612 68 610 65 617 62 619 62 622 63 624 61 621 59 623 57 621 54 628 55 630 57 627 58 627 60 629 61 633 60 634 58 640 56 649 53 651 53 649 56 652 56 654 55 659 55 663 53 667 55 670 53 667 51 676 51 680 52 690 56 692 54 689 52 686 51 685 47 690 42 692 39 694 39 702 40 700 44 702 48 702 53 705 55 703 57 698 62 701 63 705 61 706 59 708 57 707 55 708 53 705 53 704 51 707 47 703 44 708 42 707 39 709 39 710 41 709 45 712 45 711 43 715 41 721 41 726 43 724 40 724 36 728 36 735 36 741 35 739 34 742 31 745 31 751 29 758 29 766 28 769 28 775 27 780 27 781 25 783 24 790 22 795 23 791 24 797 25 800 26 809 26 815 27 817 29 816 31 813 32 806 34 804 35 807 35 811 36 814 35 815 38 817 37 821 36 830 37 842 39 842 36 848 37 853 37 857 39 858 41 860 45 865 47 867 43 872 44 877 43 882 45 884 44 889 44 887 41 890 39 915 42 918 44 925 46 936 46 942 46 944 48 944 50 947 51 951 51 956 50 961 51 966 51 971 54 974 53 972 51 973 49 982 50 988 50 996 51M636 150 638 153 640 154 638 154 637 157 636 159 636 161 637 163 639 164 641 166 645 167 650 166 649 162 650 159 648 157 648 155 646 155 647 152 650 153 652 152 650 149 649 147 647 148 647 151 646 149 646 146 643 144 641 141 640 139 642 139 643 136 645 136 647 136 648 133 647 131 645 131 642 130 639 132 636 132 635 134 632 135 630 139 632 142 632 144 635 149ZM234 52 233 54 229 53 227 53 223 51 225 50 227 49 230 50 232 50 234 52ZM1000 46 997 47 996 45ZM0 44 3 44 7 45 4 46 0 46 0 44ZM248 51 248 55 252 52 256 54 255 57 257 59 260 57 262 54 262 50 266 50 270 51 274 52 274 54 272 56 274 58 268 62 265 62 262 61 261 63 258 66 257 68 254 70 250 70 248 72 248 74 245 75 241 77 238 81 237 84 237 88 241 89 242 92 244 95 248 94 253 96 255 97 257 99 261 100 264 101 268 101 271 102 271 105 272 108 274 112 278 115 280 114 282 111 280 105 278 103 283 102 286 99 287 97 287 94 285 91 282 89 285 85 284 82 283 76 285 76 290 76 293 77 295 76 297 77 301 79 302 81 307 81 307 84 308 88 310 89 312 91 316 89 319 85 321 83 323 86 326 91 329 95 328 97 332 99 335 101 339 102 341 103 342 106 344 107 345 112 343 113 341 115 337 116 333 119 329 119 323 119 318 119 316 119 313 121 310 123 306 128 302 131 305 130 309 126 315 123 319 122 322 124 319 127 320 130 321 133 325 135 329 134 332 130 332 133 334 134 330 136 324 138 322 140 318 142 316 142 316 139 321 136 317 136 314 137 311 140 308 141 305 142 304 144 303 147 304 149 305 147 306 149 304 150 302 150 300 150 298 151 295 152 299 151 296 153 294 153 294 156 292 159 290 157 291 159 292 161 289 165 290 162 288 161 288 158 288 162 286 161 288 162 288 166 290 171 288 173 285 174 283 176 280 178 277 181 275 183 274 185 274 188 274 190 275 193 276 196 278 201 278 203 277 205 277 207 275 207 274 205 272 202 270 199 270 195 270 193 267 190 264 191 262 190 260 189 257 189 254 189 252 189 252 191 252 193 250 193 248 193 245 191 243 192 241 191 239 191 237 192 234 195 232 196 230 198 230 202 230 205 229 208 229 210 228 215 228 217 229 219 230 223 232 226 233 228 237 230 238 232 240 231 242 231 244 230 246 229 248 228 249 226 249 223 251 221 254 220 257 220 259 221 257 224 257 227 257 229 256 231 255 234 255 236 255 238 253 240 255 240 257 240 259 240 261 240 263 240 265 240 267 241 269 243 269 245 268 247 268 250 268 252 267 254 267 256 268 259 269 261 271 262 272 264 274 265 276 264 278 263 280 262 282 263 284 264 287 265 289 263 290 261 290 258 292 257 294 257 296 256 298 254 301 252 302 254 300 256 301 259 300 261 301 264 303 261 302 257 305 256 305 254 307 255 309 255 310 257 311 259 313 259 316 258 318 260 320 260 321 258 325 258 328 258 326 259 327 261 329 261 331 263 331 266 333 265 336 268 338 270 338 272 340 274 345 275 347 275 350 276 353 277 356 280 358 283 360 289 361 292 359 295 365 297 365 300 367 298 371 299 375 301 377 303 376 305 379 304 385 306 389 306 393 309 397 313 399 314 401 314 403 319 404 322 402 327 401 330 397 335 395 339 393 342 392 344 392 351 391 356 391 359 390 365 387 369 386 373 384 375 383 377 380 377 376 378 374 380 371 381 368 383 365 387 365 390 365 395 364 397 362 399 359 405 357 408 355 409 354 413 352 415 351 417 347 419 345 418 341 417 339 417 338 415 338 417 341 420 341 422 342 424 342 426 340 430 335 432 330 433 327 432 327 435 327 437 327 439 323 441 320 439 320 444 323 444 324 446 321 447 319 449 319 452 318 454 315 454 313 456 312 459 315 461 318 462 317 465 313 467 312 471 309 473 309 478 311 480 307 480 303 482 303 485 298 484 295 482 292 480 291 478 292 476 290 473 290 467 291 464 294 461 290 460 293 457 293 451 297 452 298 445 296 444 295 448 294 443 295 436 297 434 296 431 296 427 298 421 300 415 302 410 301 405 302 402 301 397 303 393 304 386 304 379 305 371 305 365 305 360 302 358 296 353 291 350 289 347 288 344 286 339 283 332 280 325 278 321 276 319 274 317 274 312 275 310 277 308 278 305 275 304 275 299 277 297 278 295 278 293 281 291 281 288 284 286 285 284 286 282 285 279 285 276 285 272 284 270 282 267 282 265 280 264 278 266 276 267 278 269 275 270 275 268 273 267 271 267 268 266 268 264 266 262 264 260 264 262 262 261 262 259 261 257 260 254 258 252 256 250 254 249 252 248 250 247 248 247 245 246 241 241 239 240 237 239 235 239 233 240 230 240 228 239 225 237 223 237 220 235 218 234 215 232 213 231 211 230 208 228 207 226 206 224 207 222 208 220 206 217 203 212 200 209 199 207 197 206 196 203 193 200 193 198 191 197 188 194 187 190 186 187 184 185 181 184 181 187 181 190 184 193 185 195 187 198 188 200 190 202 191 205 192 207 193 210 195 212 196 214 194 215 194 213 192 211 190 210 188 209 188 206 188 204 185 202 182 200 180 198 182 198 183 195 181 193 179 192 178 190 177 187 176 184 175 181 174 179 172 177 169 176 166 174 165 172 162 168 160 164 158 162 156 159 156 156 154 154 155 151 155 148 154 145 155 142 156 135 155 131 154 128 154 126 158 127 159 130 160 126 159 123 153 120 151 118 146 117 144 114 145 112 141 110 141 107 137 105 137 103 136 101 133 100 133 97 129 94 128 91 125 91 120 91 117 90 111 86 109 85 104 84 100 85 95 83 91 81 88 82 89 85 87 85 84 86 82 87 79 87 78 85 79 82 82 81 78 82 76 84 72 87 74 89 72 91 69 93 66 94 61 97 60 99 57 100 55 100 52 101 49 102 47 103 42 104 45 102 48 101 51 99 54 99 55 97 59 95 62 93 62 90 64 88 61 89 58 90 56 88 56 90 55 88 52 89 50 89 50 87 49 85 45 85 43 84 41 83 41 81 39 79 40 77 42 75 43 73 45 73 47 74 49 72 51 72 53 71 51 69 53 68 49 68 46 68 42 69 38 68 33 65 37 63 43 61 45 61 45 63 51 63 49 61 45 59 43 58 41 56 37 55 38 53 43 53 47 52 47 50 50 48 53 48 58 46 61 46 65 45 69 45 71 47 73 46 77 46 81 48 84 47 90 49 95 49 97 49 101 49 105 50 108 50 114 51 118 53 121 53 123 52 127 51 131 51 135 49 139 49 141 50 143 49 146 48 151 51 154 49 155 51 158 51 163 50 167 51 173 53 177 53 180 53 184 55 180 57 185 57 192 57 195 56 198 59 201 57 198 55 200 54 203 54 205 54 207 54 210 56 213 56 218 58 222 57 227 57 226 55 229 54 233 55 233 59 235 56 237 56 238 53 235 50 232 49 232 45 236 43 239 43 242 45 246 49 243 50 248 51ZM183 38 181 40 188 39 192 41 195 39 197 40 199 43 201 42 199 38 201 38 204 38 207 40 209 43 210 46 214 48 220 49 219 51 215 51 215 54 210 53 206 52 202 52 197 54 189 54 185 54 180 52 177 52 174 49 176 49 180 48 184 49 188 48 182 47 176 47 172 47 177 45 173 45 168 44 171 41 173 40 180 38 183 38ZM210 37 207 40 203 37 208 36 210 37ZM288 38 285 39 282 39 279 40 275 38 275 36 277 36 283 36 288 38ZM260 38 262 40 264 38 271 36 276 40 276 42 281 41 284 40 290 41 294 43 294 45 299 44 302 46 309 47 311 49 314 52 309 54 315 56 320 57 324 60 328 60 327 63 322 67 319 65 315 62 311 62 311 64 314 67 317 68 319 69 320 73 319 75 316 74 309 71 313 74 316 76 316 78 309 76 303 74 299 73 296 70 292 68 284 70 282 68 284 66 289 66 295 65 295 62 298 59 297 57 292 54 286 53 288 52 285 50 283 50 281 49 279 50 274 50 264 49 258 48 254 48 251 47 254 45 250 45 249 41 252 38 254 37 262 36 260 38ZM221 36 225 37 230 36 228 39 232 40 231 43 227 45 224 45 222 43 215 40 221 40 218 37 221 36ZM899 38 895 38 889 38 891 36 895 36 899 37ZM241 40 238 42 235 42 233 39 233 37 235 36 237 35 243 35 249 36 244 39 241 40ZM165 44 158 46 150 43 153 39 156 36 153 34 162 34 166 34 173 35 176 36 179 37 176 38 169 40 165 43ZM919 31 915 33 911 32 906 31 912 30 919 31ZM240 32 238 33 234 33 231 32 233 30 237 29 239 31ZM903 30 901 32 891 32 886 33 880 31 882 28 886 28 893 28 903 30ZM226 26 229 27 229 29 227 32 223 32 220 31 220 29 215 30 215 27 218 27 222 26 226 26ZM199 27 201 29 203 28 206 28 206 30 205 32 195 32 188 34 184 34 189 31 177 32 173 31 177 27 179 26 187 28 192 30 197 30 193 27 196 25 198 26ZM660 47 658 47 649 47 648 45 643 44 643 42 646 41 651 37 649 36 655 33 655 31 661 30 670 27 679 27 684 25 689 25 691 26 689 27 680 29 671 31 662 34 658 38 654 41 655 44 660 47ZM237 24 240 25 246 25 248 27 250 29 252 30 256 30 260 30 264 29 270 29 275 29 278 31 277 33 272 34 269 33 261 34 255 34 251 33 243 32 242 30 239 27 233 27 230 26 231 24 237 24ZM177 22 177 25 175 26 172 26 167 28 163 29 159 28 163 25 169 23 173 23 177 22ZM239 23 233 23 238 22 240 22ZM194 22 189 23 185 22 187 21 191 21 195 21ZM569 22 562 23 558 22 558 20 564 20 569 22ZM195 19 192 20 187 20 190 18 192 18 195 19ZM234 21 230 22 227 21 226 18 230 18 235 20ZM222 20 219 21 214 20 208 20 211 19 207 18 212 17 220 18 222 20ZM792 20 776 21 781 17 784 16 786 17 793 19ZM551 15 560 18 553 19 551 22 549 22 548 25 544 25 538 23 541 22 537 21 531 18 529 15 537 14 542 15 547 14 551 15ZM571 13 576 14 572 16 564 16 556 16 551 15 548 13 557 12 561 13 564 12 571 13ZM642 12 638 13 636 13 632 14 629 13 631 12 625 12 630 11 634 11 636 11 639 11 643 12ZM778 18 772 18 764 17 759 16 757 14 753 13 760 10 766 10 772 11 778 15 778 18ZM258 15 262 16 258 17 253 20 248 20 242 20 239 18 241 16 236 16 233 15 231 14 233 12 235 11 238 11 243 10 247 12 252 12 256 13 258 15ZM310 3 317 3 323 4 328 5 321 7 315 8 312 9 318 9 312 11 307 12 302 15 297 15 295 16 286 16 290 17 288 18 291 19 288 20 284 21 282 23 278 24 284 25 276 28 269 27 261 27 257 27 251 27 251 25 256 24 255 21 257 21 264 23 260 20 256 20 258 18 263 18 264 16 260 15 259 13 266 13 268 14 273 12 266 12 257 12 252 11 249 10 246 9 246 7 250 7 253 7 258 6 263 5 266 5 269 6 271 4 275 3 280 3 288 3 290 3 298 3 304 3 310 3ZM425 2 442 4 437 6 426 6 411 6 413 7 423 7 431 8 436 7 439 8 436 10 443 9 456 7 465 8 466 10 455 12 453 13 444 13 451 14 448 16 445 18 445 22 449 25 444 25 440 26 445 28 446 31 443 31 446 34 440 34 443 36 438 38 435 38 438 40 438 42 433 40 431 41 435 42 439 44 440 47 435 48 432 46 429 44 430 47 427 48 434 49 438 49 430 52 423 55 415 56 412 56 409 57 405 61 399 63 397 64 393 64 389 65 387 67 387 70 386 72 381 75 382 78 381 81 380 84 376 84 371 82 366 81 363 80 361 76 357 72 355 69 355 66 351 63 352 60 350 59 353 55 357 54 358 52 359 50 356 51 354 51 352 52 348 51 348 48 349 46 352 46 357 47 352 45 350 44 347 44 345 43 348 40 346 39 344 36 341 33 337 31 330 28 324 28 316 28 310 28 306 27 302 25 309 24 315 23 303 22 296 21 307 18 317 16 319 15 311 14 313 12 323 10 327 9 333 7 341 6 350 6 353 7 360 5 367 7 371 7 376 8 370 6 379 3 389 3 393 2 403 1 425 2Z" fill-rule="evenodd"/></g><g class="node-map-routes"><path class="node-map-route" d="M814 190 Q 900 250 828 317"/><path class="node-map-route node-map-route-2" d="M814 190 Q 660 120 505 146"/></g><g class="node-map-pins"><circle class="node-map-dot" cx="828" cy="317" r="5"/><circle class="node-map-dot" cx="505" cy="146" r="4.5"/><circle class="node-map-dot" cx="215" cy="171" r="4.5"/><circle class="node-map-dot" cx="560" cy="345" r="4.5"/><g class="node-map-pin" transform="translate(814 190)"><circle class="node-map-pin-halo" r="17"/><path class="node-map-pin-mark" d="M0 -13.5c-5 0-9 4-9 9 0 6.6 9 17.5 9 17.5s9-10.9 9-17.5c0-5-4-9-9-9z"/><circle class="node-map-pin-core" cy="-4.4" r="3.4"/></g></g></svg></div><div class="node-map-heading"><div><div class="section-kicker">CURRENT NODE · NODE OVERVIEW</div><h2>${stIcon('node')}当前实例</h2></div><span class="status-badge ${nodeStateClass}"><i></i>${nodeState}</span></div><div class="node-map-content node-compact-content"><div class="node-server-art"><img src="/server-icon.svg" alt="服务器图标"></div><div class="node-compact-details"><div class="node-compact-title"><strong>${esc(node.name || '未分配实例')}</strong><span class="status-badge ${nodeStateClass}"><i></i>${nodeState}</span></div><div class="node-compact-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${esc(nodeLocation)}</span></div><div class="node-compact-meta"><span title="浏览器实测网络延迟（优先用户→节点，回退公开测速点）">延迟：<span id="nodeLatencyValue" data-fallback="${esc(nodeLatency)}">${esc(nodeLatency)}</span></span><span class="node-meta-separator">|</span><span>带宽：${node.bandwidth_mbps || node.bandwidth || node.bandwidth_mbps === 0 ? esc(node.bandwidth_mbps ?? node.bandwidth) + ' Mbps' : '未设置'}</span></div></div></div><div id="nodeSwitchModal" class="node-switch-modal hidden" role="dialog" aria-modal="true" aria-labelledby="nodeSwitchTitle"><div class="node-switch-dialog"><div class="section-title"><div><div class="section-kicker">CHANGE NODE</div><h2 id="nodeSwitchTitle">${stIcon('node')}切换接入实例</h2><p>切换后会影响当前账号新建隧道的默认实例。</p></div><button class="secondary" type="button" onclick="closeNodeSwitch()">关闭 ×</button></div><div id="nodeSwitchList" class="node-switch-list"><p class="muted">正在加载可用实例…</p></div></div></div></section>
        <section class="card quick-actions-card"><div class="section-title"><div><div class="section-kicker">QUICK ACTIONS</div><h2>${stIcon('bolt')}快捷操作</h2></div></div><div class="quick-actions-grid">
          <button class="quick-action" onclick="loadMyPlans()"><span class="quick-action-icon">${QICON_NODE}</span><b>我的实例</b><small>实例与隧道</small></button>
          <button class="quick-action" onclick="loadNewNode()"><span class="quick-action-icon">${QICON_TUNNEL}</span><b>新建实例</b><small>选购地区与套餐</small></button>
          <button class="quick-action" onclick="loadTicketNew()"><span class="quick-action-icon">${QICON_RISK}</span><b>提交工单</b><small>故障与售后</small></button>
          <button class="quick-action" onclick="loadPoints()"><span class="quick-action-icon">${QICON_KEY}</span><b>账单与充值</b><small>余额与订单</small></button>
          <button class="quick-action" onclick="loadDashboard('profile')"><span class="quick-action-icon">${QICON_USER}</span><b>个人中心</b><small>邮箱与收款</small></button>
        </div></section>
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
    const selNode = window.__selectedNode;
    if(selNode && selNode.id){
      window.__cfgScope = { node_id: Number(selNode.id), plan_id: Number(selNode.planId || 0), node_name: selNode.name || '', plan_name: selNode.planName || '' };
    }
    const crumb = selNode ? instCrumbBar(selNode.planName ? `${selNode.name} · ${selNode.planName}` : selNode.name, [
      { label: '我的实例', onclick: 'loadMyPlans()' }
    ]) : '';
    const myPlans = (data.my_plans || []).filter(p => !selNode || Number(p.node_id) === Number(selNode.id));
    const plan = (selNode && selNode.planId ? myPlans.find(p => Number(p.id) === Number(selNode.planId)) : null) || myPlans.find(p => p.status === 'active' && !p.expired) || myPlans[0] || null;
    const planPorts = plan && Array.isArray(plan.ports) ? plan.ports.map(Number) : [];
    const visibleTunnels = plan
      ? (data.tunnels || []).filter(t => Number(t.plan_id || 0) === Number(plan.id) || (Number(t.plan_id || 0) === 0 && planPorts.includes(Number(t.remote_port || 0))))
      : (selNode ? (data.tunnels || []).filter(t => Number(t.node_id) === Number(selNode.id)) : (data.tunnels || []));
    const instanceTunnelRows = visibleTunnels.map(tunnelRowHtml).join('') || '<div class="empty-state"><strong>还没有隧道</strong><p class="muted small">点击右侧「新建隧道」创建第一条映射。</p></div>';
    const planValue = plan ? (plan.billing_mode === 'traffic' ? `${plan.used_gb} / ${plan.quota_gb} GB` : (plan.expires_at ? plan.expires_text : '不限期')) : '-';
    const nodeIdForCfg = Number(selNode ? selNode.id : plan.node_id || 0);
    const renewPrice = (plan.renew_price === null || plan.renew_price === undefined) ? '已下架' : ('¥' + fmtPts(plan.renew_price));
    const expiryText = plan.billing_mode === 'traffic' ? '按流量计费' : (plan.expires_at ? plan.expires_text : '不限期');
    const actionCard = plan ? `<section class="card ia-card">
        <div class="ia-head">
          <span class="ia-head-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.5 5.8 13.1h5.2l-1.2 8.4 7.6-10.8h-5.2z" fill="currentColor"/></svg>
          </span>
          <div class="ia-head-copy"><h2>操作</h2><p>管理您的套餐和服务</p></div>
          <button type="button" class="ia-renew" onclick="renewInstance(${Number(plan.id)}, ${Number(plan.plan_id || 0)}, ${nodeIdForCfg}, ${Number(plan.renew_price ?? 0)}, '${esc(plan.plan_name || '')}')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4.5V10h-5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>延期</span>
          </button>
        </div>

        <div class="ia-plan">
          <div class="ia-plan-top">
            <span class="ia-crown" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 8.2l4.2 3.1L12 4.6l4.8 6.7L21 8.2l-1.7 9.3H4.7z" fill="currentColor"/><rect x="4.7" y="19" width="14.6" height="1.8" rx=".9" fill="currentColor"/></svg></span>
            <b class="ia-plan-name">${esc(plan.plan_name || '-')}</b>
            <span class="ia-plan-state"><i></i>${plan.billing_mode === 'traffic' ? '按量计费' : '进行中'}</span>
            <span class="ia-plan-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 8.2l4.2 3.1L12 4.6l4.8 6.7L21 8.2l-1.7 9.3H4.7z" fill="currentColor"/></svg></span>
          </div>
          <div class="ia-plan-grid">
            <div class="ia-plan-cell">
              <span class="ia-cell-label"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.4V12l3.2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>${plan.billing_mode === 'traffic' ? '流量用量' : '到期时间'}</span>
              <b class="ia-cell-value">${esc(planValue)}</b>
            </div>
            <div class="ia-plan-cell">
              <span class="ia-cell-label"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6.4" rx="7" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 6.4v5.2c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6.4M5 11.6v5.2c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-5.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>续费价格</span>
              <b class="ia-cell-value">${esc(renewPrice)}</b>
            </div>
          </div>
        </div>

        <button type="button" class="ia-primary" onclick="showTunnelForm()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4.5V10h-5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>新建隧道</span>
          <svg class="ia-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>

        <div class="ia-duo">
          <button type="button" class="ia-secondary" onclick="openInstanceConfigDownload(${nodeIdForCfg}, ${Number(plan.id)})">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18.5h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>下载配置</span>
          </button>
          <button type="button" class="ia-secondary" onclick="openInstanceConfig(${nodeIdForCfg}, ${Number(plan.id)})">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.2 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.3a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1.1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H9.2a1.6 1.6 0 0 0 1-1.5V3.3a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            <span>在线配置</span>
          </button>
        </div>

        <div class="ia-divider"></div>

        <div class="ia-switch-row">
          <span class="ia-switch-label">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.4V12l3.2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            <span>自动延期</span>
          </span>
          <label class="ia-switch">
            <input type="checkbox"${plan.auto_renew ? ' checked' : ''} onchange="toggleAutoRenew(${Number(plan.id)}, this.checked)">
            <span class="ia-switch-track"><span class="ia-switch-thumb"></span></span>
          </label>
        </div>

        <button type="button" class="ia-danger" onclick="cancelPlan(${Number(plan.id)}, '${esc(plan.plan_name || '')}', ${Number(plan.refund_amount || 0)})">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.2 17.8 17.8 6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <span>退订</span>
        </button>
      </section>` : '';
    app.innerHTML = appLayoutHtml(`
      ${crumb}
      <div class="instance-layout">
        <div class="instance-main">
          <section class="card tunnel-create-card${editingTunnelId ? '' : ' hidden'}" id="tunnelCreateCard">
            <div class="section-title"><div><div class="section-kicker">CREATE TUNNEL</div><h2 id="tunnelFormTitle">${stIcon('plus')}创建隧道</h2><p id="tunnelFormHint">填好本地服务和公网访问方式，创建后重新下载 frpc.toml 并重启客户端即可生效。</p></div></div>
            <form id="tunnelForm" class="grid tunnel-create-form">
              <input type="hidden" name="node_id" value="${selNode ? Number(selNode.id) : ''}">
              <input type="hidden" name="plan_id" value="${selNode && selNode.planId ? Number(selNode.planId) : ''}">
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
          </section>
          <section class="card tunnel-list-section"><div class="section-title"><div><div class="section-kicker">TUNNELS</div><h2>${stIcon('tunnel')}隧道列表</h2><p>一张卡片对应一条映射；改完配置请重新下载 frpc.toml 并重启客户端。</p></div><span class="section-count">${visibleTunnels.length} 条隧道</span></div><div class="tc-grid">${instanceTunnelRows}</div></section>
        </div>
        <aside class="instance-side">${actionCard}</aside>
      </div>`, 'dashboard-tunnels', '我的隧道');
    bindUserTunnelForm();
    if(selNode && selNode.id) loadInstancePorts(Number(selNode.id));
    return;
  }
  if(view === 'cfgdl'){
    const scope = window.__cfgScope || {};
    const nodeId = Number(scope.node_id || 0), planId = Number(scope.plan_id || 0);
    const qs = `node_id=${nodeId}&plan_id=${planId}`;
    app.innerHTML = appLayoutHtml(`
      ${instanceCrumbHtml('配置下载')}
      <div class="config-grid">
        <section class="card config-dl-card">
          <div class="section-title"><div><div class="section-kicker">FRPC</div><h2>${stIcon('file')}frpc.toml</h2></div></div>
          <p class="muted small">只包含当前实例「${esc(scope.plan_name || '')}」下的隧道，不会混入其他实例。</p>
          <a class="config-option" href="/config/frpc.toml?${qs}"><span class="config-option-icon">${QICON_DOWNLOAD}</span><span class="config-option-copy"><b>下载 frpc 配置</b><small>frpc.toml · 覆盖即生效</small></span></a>
        </section>
        <section class="card config-dl-card">
          <div class="section-title"><div><div class="section-kicker">DEPLOY</div><h2>${stIcon('script')}部署脚本</h2></div></div>
          <p class="muted small">脚本内置当前实例的配置，执行后自动安装并启动 frpc。</p>
          <a class="config-option" href="/config/deploy-frpc.sh?${qs}"><span class="config-option-icon">${QICON_TUNNEL}</span><span class="config-option-copy"><b>下载 deploy-frpc.sh</b><small>一键安装并启动 frpc</small></span></a>
        </section>
      </div>`, 'dashboard-cfgdl', '配置下载');
    return;
  }
  if(view === 'config'){
    let allNodes = [];
    try{ allNodes = (await api('/api/user/nodes')).nodes || []; }catch(e){}
    const cfgIds = [...new Set((data.my_plans || []).filter(p => p.status !== 'cancelled').map(p => Number(p.node_id)))].filter(Boolean);
    const cfgNodes = allNodes.filter(n => cfgIds.includes(Number(n.id)));
    const defaultNodeId = Number((cfgNodes.find(n => Number(n.id) === Number(data.node?.id)) || cfgNodes[0] || {}).id || 0);
    const nodeSel = cfgNodes.length > 1
      ? `<div class="config-node-pick"><label>实例节点</label><select id="cfgNodeSel" onchange="switchConfigNode(this.value)">${cfgNodes.map(n => `<option value="${n.id}"${Number(n.id) === defaultNodeId ? ' selected' : ''}>${esc(n.name)}（${esc(n.region || '')}）</option>`).join('')}</select></div>`
      : '';
    const deployUrl = userDeployScriptUrl(data.user) || '/config/deploy-frpc.sh';
    const deployCmd = userDeployScriptCommand(data.user);
    const cfgQuery = defaultNodeId ? ('?node_id=' + defaultNodeId) : '';
    const deployQuery = defaultNodeId ? ('node_id=' + defaultNodeId) : '';
    app.innerHTML = appLayoutHtml(`
      ${nodeSel}
      <div class="config-grid">
        <section class="card config-dl-card">
          <div class="section-title"><div><div class="section-kicker">FRPC</div><h2>${stIcon('file')}frpc.toml</h2></div></div>
          <p class="muted small">包含该节点下“已启用”隧道的配置，下载后覆盖客户端的 frpc.toml 即可。</p>
          <a class="config-option" data-cfg="frpc" href="/config/frpc.toml${cfgQuery}"><span class="config-option-icon">${QICON_DOWNLOAD}</span><span class="config-option-copy"><b>下载 frpc 配置</b><small>frpc.toml · 覆盖即生效</small></span></a>
        </section>
        <section class="card config-dl-card">
          <div class="section-title"><div><div class="section-kicker">DEPLOY</div><h2>${stIcon('script')}部署脚本</h2></div></div>
          <p class="muted small">在客户端服务器上执行，自动安装 frpc、写入配置并注册服务。</p>
          <a class="config-option" data-cfg="deploy" data-token="${esc(data.user?.token || '')}" href="${esc(deployUrl)}${deployUrl.includes('?') ? '&' : '?'}${deployQuery}"><span class="config-option-icon">${QICON_TUNNEL}</span><span class="config-option-copy"><b>下载 deploy-frpc.sh</b><small>一键安装并启动 frpc</small></span></a>
          ${deployCmd ? `<div class="copy-line"><code id="cfgCmd" data-base="${esc(deployCmd)}">${esc(deployCmd)}${deployQuery ? (deployCmd.includes('?') ? '&' : '?') + deployQuery : ''}</code><button type="button" class="copy-inline" data-copy-address="${esc(deployCmd)}${deployQuery ? (deployCmd.includes('?') ? '&' : '?') + deployQuery : ''}">复制</button></div>` : ''}
        </section>
      </div>
      <section class="card config-tip"><p class="muted small">想看/改具体内容？去 <button type="button" class="link-btn" onclick="loadDashboard('editor')">在线配置</button>，那里会根据你当前的隧道自动生成 frpc.toml。</p></section>`, 'dashboard-config', '配置下载');
    return;
  }
  if(view === 'editor'){
    const scoped = Number((window.__cfgScope || {}).plan_id || 0) > 0;
    app.innerHTML = appLayoutHtml(`
      ${scoped ? instanceCrumbHtml('在线配置') : ''}
      <section class="card editor-card">
        <div class="section-title"><div><div class="section-kicker">FRPC.TOML</div><h2>${stIcon('file')}配置内容</h2><span class="editor-status" id="editorStatus">加载中…</span></div><div class="editor-actions"><button type="button" class="secondary" onclick="copyFrpcConfig()">复制全部</button><button type="button" class="secondary" onclick="downloadFrpcDraft()">下载 .toml</button><button type="button" class="secondary" onclick="regenFrpcConfig()">重新生成</button></div></div>
        <textarea id="frpcEditor" class="frpc-editor" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" placeholder="# 正在加载当前 tunnels 生成的配置…"></textarea>
        <p class="muted small">改动会暂存在本机浏览器；点“重新生成”会用当前隧道重新覆盖。新增/修改隧道后回来重新生成即可。</p>
      </section>`, 'dashboard-editor', '在线配置');
    initFrpcEditor();
    return;
  }
  if(view === 'nodes'){
    return loadNewNode();
  }
  if(view === 'profile'){
    const myPlans = data.my_plans || [];
    const activePlans = myPlans.filter(p => !p.expired);
    const payment = data.payment || {};
    const planRows = myPlans.map((p, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(p.plan_name || '-')}</td>
        <td>${p.max_ports}</td>
        <td>${p.billing_mode === 'traffic' ? '流量' : '时间'}</td>
        <td>${p.quota_gb > 0 ? `${p.used_gb} / ${p.quota_gb} GB` : '不限量'}${p.billing_mode !== 'traffic' && p.expires_at ? `<br><span class="muted small">到期 ${esc(p.expires_text)}</span>` : ''}</td>
        <td>${p.status === 'exhausted' ? '<span class="bad">流量用尽</span>' : (p.status === 'cancelled' ? '<span class="muted">已退订</span>' : (p.expired ? '<span class="bad">已到期</span>' : (p.paused ? '<span class="muted">已暂停</span>' : '<span class="ok">生效中</span>')))}${p.grace_until && p.status !== 'active' ? `<br><span class="muted small">端口保留至 ${fmtTs(p.grace_until)}</span>` : ''}</td>
        <td class="actions node-actions">${p.status === 'active' ? `<button type="button" class="node-action node-action-danger" onclick="cancelPlan(${p.id}, '${esc(p.plan_name)}', ${Number(p.refund_amount || 0)})">退订</button>` : '<span class="muted small">—</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">还没有购买过套餐</td></tr>';
    let payoutAcc = { method: 'alipay', account: '', holder: '' };
    try{ payoutAcc = (await api('/api/user/payout-account')).account || payoutAcc; }catch(e){}
    try{ await fetchUserNotifyConfig(); }catch(e){ userNotifyState.cfg = {}; }
    const latestExpiry = activePlans.length
      ? (activePlans.every(p => p.billing_mode === 'traffic')
          ? '按流量计费'
          : (activePlans.some(p => !p.expires_at && p.billing_mode !== 'traffic')
              ? '不限期'
              : activePlans.filter(p => p.billing_mode !== 'traffic').map(p => p.expires_text).sort().slice(-1)[0]))
      : '';
    app.innerHTML = appLayoutHtml(`
      <div class="profile-grid">
        <section class="card profile-card">
          <div class="profile-head"><span class="profile-avatar">${avatarSvg(data.user.username||'U', data.user.role, 56)}</span><div class="profile-id"><strong>${esc(data.user.username||'-')}</strong><small>${data.user.role === 'admin' ? '系统管理员' : '普通用户'}</small></div></div>
          <div class="profile-rows">
            <div class="info-line"><span>生效套餐</span><strong>${activePlans.length} 个</strong></div>
            <div class="info-line"><span>今日流量</span><strong>${fmtBytes(todayTraffic)}${trafficLimit ? ' / ' + fmtBytes(trafficLimit) : ' / 不限'}</strong></div>
            <div class="info-line"><span>隧道数量</span><strong>${data.tunnels.length} 条</strong></div>
            <div class="info-line"><span>端口上限</span><strong>${esc(data.user.max_ports ?? '-')}</strong></div>
            <div class="info-line"><span>邮箱</span><strong>${esc(data.user.email || '未设置')}</strong></div>
          </div>
          <form id="userEmailForm" class="grid" style="margin-top:12px">
            <div style="grid-column:1/-1"><label>设置邮箱（用于「忘记密码」接收验证码）</label><input name="email" type="email" value="${esc(data.user.email || '')}" placeholder="user@example.com"></div>
            <div class="form-actions" style="grid-column:1/-1"><button type="submit">保存邮箱</button></div>
          </form>
        </section>
        <section class="card">
        <div class="section-title"><div><div class="section-kicker">PAYOUT</div><h2>${stIcon('key')}收款信息</h2><p>用于提现收益到你的支付宝 / 微信</p></div></div>
        <form id="payoutAccountForm" class="grid">
          <div><label>收款方式</label><select name="method"><option value="alipay"${payoutAcc.method === 'alipay' ? ' selected' : ''}>支付宝</option><option value="wechat"${payoutAcc.method === 'wechat' ? ' selected' : ''}>微信</option></select></div>
          <div><label>收款账号</label><input name="account" value="${esc(payoutAcc.account || '')}" required placeholder="支付宝账号 / 微信号"></div>
          <div><label>姓名</label><input name="holder" value="${esc(payoutAcc.holder || '')}" required placeholder="收款人姓名"></div>
          <div class="span-2"><label>收款码（必填）</label><input type="file" id="qrFile" accept="image/png,image/jpeg,image/webp"><input type="hidden" name="qr_token" value="${esc(payoutAcc.qr_token || '')}"><div id="qrPreview" class="qr-preview">${payoutAcc.qr_token ? `<img src="/api/upload/${encodeURIComponent(payoutAcc.qr_token)}" alt="收款码" onclick="showImageViewer('/api/upload/${encodeURIComponent(payoutAcc.qr_token)}')">` : ''}</div></div>
          <div class="form-actions" style="grid-column:1/-1"><button type="submit">保存收款信息</button></div>
        </form>
        </section>
        ${userNotifyCardHtml()}
      </div>`, 'dashboard-profile', '个人中心');
    initUserEmailForm();
    initPayoutAccountForm();
    initUserNotifyForm();
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
      <section class="workspace-stat"><span>接入实例</span><strong>${esc(data.node?.region || '-')}</strong><small>${esc(data.frps.addr)}:${esc(data.frps.port)}</small></section>
    </div>
    <div class="workspace-columns"><div class="workspace-primary">
    ${isAdmin ? '' : userFrpsDashboardHtml(data.frps_user_dashboard)}
    ${isAdmin ? '' : `<section class="card ports-section"><div class="section-title"><div><div class="section-kicker">RESOURCE POOL</div><h2>${stIcon('port')}端口资源</h2></div><p>黄色表示已分配给隧道</p></div><div class="ports">${portsHtml}</div></section>`}
    <section class="card tunnel-config-entry"><div class="section-title"><div><div class="section-kicker">QUICK ACTION</div><h2>${stIcon('plus')}开始创建映射</h2></div><p>支持 TCP / UDP / HTTP / HTTPS 等协议</p></div><button onclick="loadDashboard('tunnels')">去创建隧道</button><span class="muted small">在「隧道管理」页填写本地服务和公网访问方式，创建后下载最新 frpc 配置。</span></section>
    <section class="card tunnel-list-section"><div class="section-title"><div><div class="section-kicker">MY TUNNELS</div><h2>${stIcon('tunnel')}我的隧道</h2><p>一张卡片对应一条映射。修改配置后，请重新下载 frpc.toml 并重启客户端。</p></div><span class="section-count">${data.tunnels.length} 条隧道</span></div><div class="tc-grid">${tunnelRows}</div></section>
    </div><aside class="workspace-aside">
      <section class="side-info-card"><div class="section-kicker">ACCOUNT</div><h3>${stIcon('user')}账号信息</h3><div class="info-line"><span>当前账号</span><strong>${esc(data.user.username)}</strong></div><div class="info-line"><span>所在实例</span><strong>${esc(data.node?.region || '-')} / ${esc(data.node?.name || '-')}</strong></div><div class="info-line"><span>端口上限</span><strong>${esc(data.user.max_ports)}</strong></div></section>
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
async function deleteTunnel(id){ if(await appConfirm('删除这个隧道？', {title:'删除隧道', okText:'删除', danger:true})) await api('/api/tunnels/delete', {method:'POST', body:{id}}).then(()=>loadDashboard('tunnels')).catch(e=>show(e.message,true)); }

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

function orderRowHtml(o, i){
  const st = window.__adminOrderStatusText || {};
  return `<tr>
      <td>${i + 1}</td>
      <td>${esc(o.order_no)}</td>
      <td>${esc(o.username)}</td>
      <td>${o.kind === 'recharge' ? '余额充值' : '套餐购买'}</td>
      <td>${esc(o.plan_name)}</td>
      <td>${o.amount ? (o.kind === 'recharge' ? '+' : '-') + '¥' + fmtPts(o.amount) : '-'}</td>
      <td>¥${fmtPts(o.amount)}</td>
      <td><span class="status-badge ${o.status === 'paid' ? 'ok' : (o.status === 'pending' ? '' : 'bad')}"><i></i>${st[o.status] || esc(o.status)}</span></td>
      <td>${esc(o.provider || '-')}</td>
      <td>${fmtTs(o.created_at)}</td>
      <td class="actions node-actions">${o.status === 'pending' ? `<button type="button" class="node-action" onclick="orderComplete('${esc(o.order_no)}')">手动开通</button>` : '<span class="muted small">—</span>'}</td>
    </tr>`;
}

function applyOrderFilter(){
  const all = window.__adminOrderList || [];
  const status = (document.querySelector('#ofStatus') || {}).value || '';
  const kind = (document.querySelector('#ofKind') || {}).value || '';
  const q = ((document.querySelector('#ofQ') || {}).value || '').trim().toLowerCase();
  const list = all.filter(o => {
    if(status && o.status !== status) return false;
    if(kind && o.kind !== kind) return false;
    if(q){
      const hay = [o.order_no, o.username, o.plan_name].join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  const body = document.querySelector('#adminOrderBody');
  if(body) body.innerHTML = list.map((o, i) => orderRowHtml(o, i)).join('') || '<tr><td colspan="11" class="muted">没有符合条件的订单</td></tr>';
  const cnt = document.querySelector('#adminOrderCount');
  if(cnt) cnt.textContent = `筛选 ${list.length} / 共 ${all.length} 条`;
}

function resetOrderFilter(){
  const s = document.querySelector('#ofStatus'); if(s) s.value = '';
  const k = document.querySelector('#ofKind'); if(k) k.value = '';
  const q = document.querySelector('#ofQ'); if(q) q.value = '';
  applyOrderFilter();
}

async function loadAdmin(section=currentAdminSection){
  clearAdminDashboardTimer();
  hideFlash();
  currentAdminSection = ['users','plans','orders','nodes','risk'].includes(section) ? section : currentAdminSection;
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
    const searchable = [u.username, u.node_region, u.node_name, u.id].join(' ').toLocaleLowerCase();
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
  const rows = usersSlice.map((u, i) => `
    <tr>
      <td>${(usersPage - 1) * ADMIN_PAGE_SIZE + i + 1}</td><td>${esc(u.username)}</td><td>${u.email ? esc(u.email) : '—'}</td><td>${esc(u.role)}</td><td><b>¥${fmtPts(u.balance)}</b></td><td>${esc(u.node_region || '-')} / ${esc(u.node_name || '-')}</td><td>${u.port_count}/${u.max_ports}</td><td>${u.tunnel_count}</td>
      <td>${fmtBytes(u.traffic_limit_bytes)} / ${u.bandwidth_limit_kbps ? `${(Number(u.bandwidth_limit_kbps) / 1024).toFixed(1)} MB/s` : '不限'}</td>
      <td>${u.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td class="actions node-actions user-actions">
        <button class="node-action" onclick="adminToggle(${u.id})">${u.active ? '停用' : '启用'}</button>
        <button class="node-action" onclick="openAdminLimits(${u.id}, ${Number(u.traffic_limit_bytes || 0)}, ${Number(u.bandwidth_limit_kbps || 0)}, '${esc(u.username)}')">流量限制</button>
        <button class="node-action" onclick="openAdminCred('password', ${u.id}, '${esc(u.username)}')">重置密码</button>
        <button class="node-action" onclick="openAdminCred('token', ${u.id}, '${esc(u.username)}')">重置令牌</button>
        <button class="node-action" onclick="adminAdjustPoints(${u.id}, '${esc(u.username)}')">调余额</button>
        <button class="node-action" onclick="openAdminEmail(${u.id}, '${esc(u.email || '')}', '${esc(u.username)}')">设邮箱</button>
        <button class="node-action node-action-danger" onclick="adminDelete(${u.id})">删除</button>
      </td>
    </tr>`).join('');
  const nodeRows = nodesSlice.map((n, i) => `
    <tr>
      <td>${(nodesPage - 1) * ADMIN_PAGE_SIZE + i + 1}</td><td>${esc(n.region)}</td><td>${esc(n.name)}</td><td>${esc(n.server_addr)}:${n.server_port}</td>
      <td>${esc(n.frps_version || '-')}</td>
      <td>${n.port_start}-${n.port_end}</td><td>${n.free_count}/${n.port_count}</td>
      <td>${n.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td>${Number(n.month_used_gb || 0)} / ${Number(n.monthly_traffic_gb || 0) > 0 ? Number(n.monthly_traffic_gb) + ' GB' : '不限'}${n.traffic_exceeded ? ' <span class="bad">已用尽</span>' : ''}</td>
      <td>${esc(n.note)}</td>
      <td class="actions node-actions"><button class="node-action" onclick='editNode(${JSON.stringify(n)})'>编辑</button><button class="node-action" onclick="nodeToggle(${n.id})">${n.active ? '停用' : '启用'}</button><a class="btn node-action" href="/config/frps.example.toml?node_id=${n.id}">frps配置</a><button class="node-action node-action-danger" onclick="nodeDelete(${n.id})">删除</button></td>
    </tr>`).join('') || emptyRow(10, '还没有节点');
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
      <td class="actions node-actions"><button class="node-action" onclick="copyText('${k.key}')">复制</button><button class="node-action" onclick="inviteToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button class="node-action node-action-danger" onclick="inviteDelete(${k.id})">删除</button></td>
    </tr>`;
  }).join('') || emptyRow(11, '还没有密钥');
  const logRows = logsSlice.map((l, i) => `
    <tr><td>${(riskPage - 1) * ADMIN_PAGE_SIZE + i + 1}</td><td>${esc(l.event)}</td><td>${esc(l.username || '-')}</td><td>${esc(l.remote_port || '-')}</td><td>${esc(l.proxy_type || '-')}</td><td>${esc(l.detail || '')}</td><td>${fmtTs(l.created_at)}</td></tr>
  `).join('') || emptyRow(7, '暂无审计日志');
  const softwareKeyRows = (data.software_license_keys || []).map((k, i) => `
    <tr>
      <td>${i + 1}</td><td><code class="token" title="${esc(k.license_key)}">${esc(k.license_key)}</code></td><td>${esc(k.note)}</td><td>${esc(k.plan)}</td>
      <td>${k.machine_id ? `<code class="token">${esc(k.machine_id)}</code>` : '未绑定'}</td>
      <td>${esc(k.expires_text)} ${k.expired ? '<span class="bad">已过期</span>' : ''}</td>
      <td>${k.active ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
      <td class="actions node-actions"><button class="node-action" onclick="copyText('${k.license_key}')">复制</button><button class="node-action" onclick="softwareLicenseToggle(${k.id})">${k.active ? '停用' : '启用'}</button><button class="node-action" onclick="softwareLicenseUnbind(${k.id})">解绑</button></td>
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
      <div><label>月流量上限（GB）</label><input name="monthly_traffic_gb" type="number" min="0" step="0.1" placeholder="例如 1000"><span class="muted small">0 表示不限；用完后该节点停止服务</span></div>
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
      <div><label>月流量上限（GB）</label><input name="monthly_traffic_gb" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限；用完后该节点停止服务</span></div>
      <div><label>端口起始</label><input name="port_start" type="number" value="20000" min="1" max="65535"></div>
      <div><label>端口结束</label><input name="port_end" type="number" value="20199" min="1" max="65535"></div>
      <div><label>frp 版本</label><select name="frp_channel" id="nodeFrpChannel"><option value="stable">稳定版（推荐）</option><option value="latest">最新版</option><option value="custom">自定义版本</option></select></div>
      <div class="hidden" id="nodeFrpVersionWrap"><label>自定义 frp 版本</label><input name="frp_version" placeholder="例如 0.66.0"></div>
      <div><label>备注</label><input name="note" placeholder="线路/机房说明"></div>
      <div class="form-actions" style="grid-column:1/-1"><button>创建节点</button></div>
    </form>
    <div id="nodeDeployScriptBox" class="deploy-script-item hidden" style="margin-top:14px"><div class="label">一键部署脚本（复制到新节点机器上执行）</div><div class="copy-line"><code class="token deploy-token" id="nodeDeployScriptCmd"></code><button type="button" class="secondary" onclick="copyNodeDeployScript()">复制命令</button></div><p class="muted small">脚本从公开仓库拉取，不依赖本面板；执行时会把该节点注册到当前面板（地址、密钥与节点信息已按上方表单预填）。</p></div></section>
    <section class="card" id="nodes"><div class="section-title"><h2>${stIcon('node')}节点列表</h2><p>启用节点优先，剩余端口多的排前面</p></div><table><thead><tr><th>序号</th><th>地区</th><th>节点</th><th>frps</th><th>版本</th><th>端口池</th><th>剩余</th><th>状态</th><th>月流量</th><th>备注</th><th>操作</th></tr></thead><tbody>${nodeRows}</tbody></table>${paginationHtml('nodes', nodesPage, (data.nodes || []).length, ADMIN_PAGE_SIZE)}</section>`;
  const plansList = data.plans || [];
  const orderList = data.orders || [];
  window.__fmlPlans = plansList;
  const nodeName = (id) => {
    const n = (data.nodes || []).find(x => Number(x.id) === Number(id));
    return n ? `${n.region} / ${n.name}` : (id ? ('#' + id) : '自动分配');
  };
  const planRows = plansList.map((p, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(p.name)}</td>
      <td><b>¥${fmtPts(p.price)}</b></td>
      <td>${p.max_ports}</td>
      <td>${p.billing_mode === 'traffic' ? '流量' : '时间'}</td>
      <td>${p.billing_mode === 'traffic' ? (p.traffic_limit_gb ? p.traffic_limit_gb + ' GB' : '未设置') : `${p.duration_days ? p.duration_days + ' 天' : '不限期'}${p.traffic_limit_gb ? ' · ' + p.traffic_limit_gb + ' GB 上限' : ' · 不限量'}`}</td>
      <td>${p.bandwidth_limit_mbs ? p.bandwidth_limit_mbs + ' MB/s' : '不限'}</td>
      <td><span class="status-badge ${p.active ? 'ok' : 'bad'}"><i></i>${p.active ? '上架' : '下架'}</span></td>
      <td class="actions node-actions"><button type="button" class="node-action" onclick="editPlan(${p.id})">编辑</button><button type="button" class="node-action" onclick="planToggle(${p.id})">${p.active ? '下架' : '上架'}</button><button type="button" class="node-action node-action-danger" onclick="planDelete(${p.id})">删除</button></td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">还没有套餐，先在上方创建</td></tr>';
  const orderStatusText = {pending:'待支付', paid:'已支付', cancelled:'已取消', expired:'已过期', refunded:'已退款'};
  window.__adminOrderList = orderList;
  window.__adminOrderStatusText = orderStatusText;
  const ordersHtml = `
    <section class="card"><div class="section-title"><div><h2>${stIcon('chart')}订单</h2><p>最近 100 条；待支付订单可手动开通</p></div><span class="section-count" id="adminOrderCount">共 ${orderList.length} 条</span></div>
      <div class="filter-bar">
        <select id="ofStatus" onchange="applyOrderFilter()">
          <option value="">全部状态</option>
          <option value="paid">已支付</option>
          <option value="pending">待支付</option>
          <option value="cancelled">已取消</option>
          <option value="refunded">已退款</option>
        </select>
        <select id="ofKind" onchange="applyOrderFilter()">
          <option value="">全部类型</option>
          <option value="plan">套餐购买</option>
          <option value="recharge">余额充值</option>
        </select>
        <input id="ofQ" placeholder="订单号 / 用户 / 套餐" oninput="applyOrderFilter()">
        <button type="button" class="secondary" onclick="resetOrderFilter()">重置</button>
      </div>
      <table><thead><tr><th>序号</th><th>订单号</th><th>用户</th><th>类型</th><th>套餐 / 内容</th><th>金额</th><th>实付</th><th>状态</th><th>支付方式</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="adminOrderBody">${orderList.map((o, i) => orderRowHtml(o, i)).join('') || '<tr><td colspan="11" class="muted">暂无订单</td></tr>'}</tbody></table>
    </section>`;
  const plansHtml = `
    <section class="card" id="plans"><div class="section-title"><h2>${stIcon('license')}套餐模板</h2><p>用户按套餐在线购买，支付成功后自动分配端口与有效期</p></div>
    <form id="planForm" class="grid">
      <input type="hidden" name="id" value="">
      <div><label>套餐名称</label><input name="name" placeholder="例如 入门版 / 专业版" required></div>
      <div><label>价格（元）</label><input name="price" type="number" value="100" min="0" step="0.01"><span class="muted small">用户购买时从余额扣除的金额</span></div>
      <div><label>适用节点</label><select name="node_id"><option value="0">全部节点（通用）</option>${nodeOptions(data.nodes || [])}</select><span class="muted small">绑定后用户只能在该节点购买此套餐</span></div>
      <div><label>计费方式</label><select name="billing_mode"><option value="time">时间模式（按天）</option><option value="traffic">流量模式（按 GB）</option></select></div>
      <div><label>有效期（天）</label><input name="duration_days" type="number" value="30" min="0" max="30"><span class="muted small">仅时间套餐需要；流量套餐用完为止，不用填</span></div>
      <div><label>端口数</label><input name="max_ports" type="number" value="5" min="0" max="100"></div>
      <div><label>流量额度 GB</label><input name="traffic_limit_gb" type="number" value="0" min="0" step="0.1"><span class="muted small">流量模式必填；时间模式可选填（0 表示不限量）</span></div>
      <div><label>速率 MB/s</label><input name="bandwidth_limit_mbs" type="number" value="0" min="0" step="0.1"><span class="muted small">0 表示不限</span></div>
      <div><label>排序</label><input name="sort_order" type="number" value="0"><span class="muted small">数字越小越靠前</span></div>
      <div><label>备注</label><input name="note" placeholder="套餐说明，展示给用户"></div>
      <div style="grid-column:1/-1"><label>公平使用说明</label><textarea name="fair_use_note" rows="2" placeholder="例如：标称不限量，月流量超过 1TB 将限速"></textarea></div>
      <div class="form-actions" style="grid-column:1/-1"><button>保存套餐</button><button type="button" class="secondary" onclick="resetPlanForm()">清空</button></div>
    </form></section>
    <section class="card"><div class="section-title"><div><h2>${stIcon('license')}套餐列表</h2><p>共 ${plansList.length} 个套餐</p></div></div><table><thead><tr><th>序号</th><th>名称</th><th>价格</th><th>端口</th><th>计费</th><th>有效期 / 额度</th><th>速率</th><th>状态</th><th>操作</th></tr></thead><tbody>${planRows}</tbody></table></section>
    
    ${data.software_license_authority ? `<section class="card" id="software-licenses"><div class="section-title"><h2>${stIcon('license')}服务器软件授权码</h2><p>卖家后台使用：先批量生成授权码发给客户；客户输入授权码后自动绑定他的部署服务器。</p></div><form id="softwareLicenseForm" class="grid">
      <div><label>生成数量</label><input name="count" type="number" value="1" min="1" max="500"></div>
      <div><label>备注</label><input name="note" placeholder="订单号/客户名"></div>
      <div><label>套餐</label><input name="plan" value="deploy"></div>
      <div><label>有效期天数</label><input name="expires_days" type="number" value="0" min="0" max="3650"><span class="muted small">0 表示永不过期</span></div>
      <div style="align-self:end"><button>生成软件授权码</button></div>
    </form><p class="panel-note small">客户不需要提供机器码；首次激活时授权服务器会自动绑定机器。批量生成后会自动复制并下载 txt。</p>
    <table><thead><tr><th>序号</th><th>授权码</th><th>备注</th><th>套餐</th><th>绑定机器</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody>${softwareKeyRows}</tbody></table></section>` : ''}`;
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
    <section class="card" id="users"><div class="section-title"><h2>${stIcon('users')}用户列表</h2><p>管理状态、续期和删除账号</p></div>
      <form id="adminUserFilterForm" class="grid admin-user-filters">
        <div><label for="adminUserSearch">搜索用户</label><input id="adminUserSearch" name="search" value="${esc(adminUserSearch)}" placeholder="用户名、ID"></div>
        <div><label for="adminUserNode">接入节点</label><select id="adminUserNode" name="node"><option value="">全部节点</option>${(data.nodes || []).map(n => `<option value="${n.id}" ${String(n.id)===String(adminUserNode)?'selected':''}>${esc(n.region)} / ${esc(n.name)}</option>`).join('')}</select></div>
        <div><label for="adminUserStatus">账号状态</label><select id="adminUserStatus" name="status"><option value="all" ${adminUserStatus==='all'?'selected':''}>全部状态</option><option value="active" ${adminUserStatus==='active'?'selected':''}>正常启用</option><option value="disabled" ${adminUserStatus==='disabled'?'selected':''}>已停用</option><option value="expired" ${adminUserStatus==='expired'?'selected':''}>已到期</option></select></div>
        <div class="form-actions"><button type="submit">筛选</button><button type="button" class="secondary" id="adminUserFilterReset">重置</button></div>
      </form>
      <p class="muted small">当前 ${filteredUsers.length} 个用户符合条件，共 ${allUsers.length} 个用户。</p><table><thead><tr><th>序号</th><th>用户</th><th>邮箱</th><th>角色</th><th>余额</th><th>接入节点</th><th>端口</th><th>隧道</th><th>流量/速率策略</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>${paginationHtml('users', usersPage, filteredUsers.length, ADMIN_PAGE_SIZE)}</section>
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
    <section class="card"><div class="section-title"><h2>${stIcon('log')}审计日志</h2><p>最近 80 条关键操作和风控事件</p></div><table><thead><tr><th>序号</th><th>事件</th><th>用户</th><th>端口</th><th>协议</th><th>详情</th><th>时间</th></tr></thead><tbody>${logRows}</tbody></table>${paginationHtml('risk', riskPage, (data.logs || []).length, ADMIN_PAGE_SIZE)}</section>`;
  const sectionHtml = {users: usersHtml, plans: plansHtml, orders: ordersHtml, nodes: nodeHtml, risk: riskHtml}[currentAdminSection] || usersHtml;
  const sectionTitles = {users:'用户管理', plans:'套餐管理', orders:'订单管理', nodes:'新增节点', risk:'风控审计'};
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
  const planForm = document.querySelector('#planForm');
  if(planForm){
    planForm.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if(body.billing_mode === 'traffic') body.duration_days = '0';
      try{
        const r = await api('/api/admin/plans/save', {method:'POST', body});
        await loadAdmin();
        show(r.message || '套餐已保存');
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
      <td class="actions node-actions">${m.user_id ? `<button class="node-action node-action-danger" onclick="banUser(${m.user_id})">封禁用户</button>` : '<span class="muted small">—</span>'}</td>
    </tr>`).join('') || emptyRow(8, '没有查到该端口');
  const logRows = logs.map(l => `<tr><td>${esc(l.event)}</td><td>${esc(l.username || '-')}</td><td>${esc(l.detail || '')}</td><td>${fmtTs(l.created_at)}</td></tr>`).join('') || emptyRow(4, '该端口暂无日志');
  box.innerHTML = `
    <div class="section-title"><h3>${stIcon('search')}查询结果</h3><p>如确认违规，可直接封禁用户</p></div>
    <table><thead><tr><th>节点</th><th>端口</th><th>用户</th><th>账号状态</th><th>隧道</th><th>协议</th><th>本地服务</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="section-title"><h3>${stIcon('log')}端口相关日志</h3><p>最近 30 条</p></div>
    <table><thead><tr><th>事件</th><th>用户</th><th>详情</th><th>时间</th></tr></thead><tbody>${logRows}</tbody></table>`;
}

async function banUser(id){
  const reason = await appPrompt('请输入封禁原因', '违法/违规内容投诉', {title:'封禁用户'});
  if(reason === null) return;
  await api('/api/admin/users/ban', {method:'POST', body:{id, reason}}).then(r=>{loadAdmin().then(()=>show(r.message || '已封禁'));}).catch(e=>show(e.message,true));
}

async function backupToR2(){
  if(!await appConfirm('现在生成全量备份并上传到 Cloudflare R2？', {title:'R2 备份'})) return;
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
  const confirmText = await appPrompt('恢复会替换当前数据库。请输入 RESTORE 确认：', '', {title:'恢复备份'});
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
async function adminDelete(id){ if(await appConfirm('删除用户会释放端口并删除隧道，确定？', {title:'删除用户', okText:'删除', danger:true})) await api('/api/admin/users/delete', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('用户已删除'))).catch(e=>show(e.message,true)); }
function resetPlanForm(){
  const f = document.querySelector('#planForm');
  if(!f) return;
  f.reset();
  f.elements.id.value = '';
  f.elements.price.value = '100';
  f.elements.max_ports.value = '5';
  f.elements.duration_days.value = '30';
  f.elements.billing_mode.value = 'time';
  f.elements.traffic_limit_gb.value = '0';
  f.elements.bandwidth_limit_mbs.value = '0';
  f.elements.sort_order.value = '0';
  f.elements.active.value = '1';
  f.elements.fair_use_note.value = '';
  f.elements.node_id.value = '0';
}
function editPlan(id){
  const f = document.querySelector('#planForm');
  const p = (window.__fmlPlans || []).find(x => Number(x.id) === Number(id));
  if(!f || !p) return;
  f.elements.id.value = p.id;
  f.elements.name.value = p.name;
  f.elements.price.value = p.price;
  f.elements.max_ports.value = p.max_ports;
  f.elements.duration_days.value = p.duration_days;
  f.elements.billing_mode.value = p.billing_mode || 'time';
  f.elements.traffic_limit_gb.value = p.traffic_limit_gb;
  f.elements.bandwidth_limit_mbs.value = p.bandwidth_limit_mbs;
  f.elements.node_id.value = p.node_id || 0;
  f.elements.sort_order.value = p.sort_order;
  f.elements.note.value = p.note;
  f.elements.fair_use_note.value = p.fair_use_note || '';
  f.elements.node_id.value = p.node_id || 0;
  f.scrollIntoView({behavior:'smooth', block:'center'});
}
async function adminAdjustPoints(id, username){
  const raw = await appPrompt(`调整 ${username} 的余额（正数增加，负数扣减，单位元）`, '100.00', {title:'调整余额'});
  if(raw === null) return;
  const delta = Number(raw);
  if(!Number.isFinite(delta) || delta === 0){ show('请输入非零金额', true); return; }
  try{
    const r = await api('/api/admin/users/balance', {method:'POST', body:{id, delta, note:'管理员调整'}});
    await loadAdmin();
    await appAlert(r.message || '余额已调整', {title:'余额已调整'});
  }catch(err){ show(err.message, true); }
}

async function rechargeKeyToggle(id){ await api('/api/admin/recharge-keys/toggle', {method:'POST', body:{id}}).then(()=>loadAdminOps().then(()=>show('密钥状态已更新'))).catch(e=>show(e.message,true)); }
async function rechargeKeyDelete(id){ if(await appConfirm('删除这枚充值密钥？', {title:'删除充值密钥', okText:'删除', danger:true})) await api('/api/admin/recharge-keys/delete', {method:'POST', body:{id}}).then(()=>loadAdminOps().then(()=>show('密钥已删除'))).catch(e=>show(e.message,true)); }
async function planToggle(id){ await api('/api/admin/plans/toggle', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('套餐状态已更新'))).catch(e=>show(e.message,true)); }
async function planDelete(id){ if(await appConfirm('删除这个套餐？删除后不再展示，历史订单和套餐数据仍保留。', {title:'删除套餐', okText:'删除', danger:true})) await api('/api/admin/plans/delete', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('套餐已删除'))).catch(e=>show(e.message,true)); }
async function orderComplete(orderNo){ if(await appConfirm('确认手动开通该订单？将立即分配端口并延长有效期。', {title:'手动开通'})) await api('/api/admin/orders/complete', {method:'POST', body:{order_no:orderNo}}).then(r=>loadAdmin().then(()=>appAlert(r.message || '已开通', {title:'开通完成'}))).catch(e=>show(e.message,true)); }

async function inviteToggle(id){ await api('/api/admin/invite-keys/toggle', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('密钥状态已更新'))).catch(e=>show(e.message,true)); }
async function inviteDelete(id){ if(await appConfirm('删除这个注册密钥？', {title:'删除注册密钥', okText:'删除', danger:true})) await api('/api/admin/invite-keys/delete', {method:'POST', body:{id}}).then(()=>loadAdmin().then(()=>show('密钥已删除'))).catch(e=>show(e.message,true)); }
async function softwareLicenseToggle(id){ await api('/api/admin/software-licenses/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function softwareLicenseUnbind(id){ if(await appConfirm('解绑后该授权码可被下一台客户服务器重新激活，确定？', {title:'解绑授权码'})) await api('/api/admin/software-licenses/unbind', {method:'POST', body:{id}}).then(r=>{loadAdmin().then(()=>show(r.message || '已解绑'));}).catch(e=>show(e.message,true)); }
function editNode(n){
  const card = document.querySelector('#editNodeCard');
  const f = document.querySelector('#editNodeForm');
  card.classList.remove('hidden');
  for(const k of ['id','region','name','server_addr','server_port','auth_token','note','bandwidth_mbps','monthly_traffic_gb']) f.elements[k].value = n[k] ?? '';
  f.elements.active.value = n.active ? '1' : '0';
  card.scrollIntoView({behavior:'smooth', block:'start'});
}
async function nodeToggle(id){ await api('/api/admin/nodes/toggle', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }
async function nodeDelete(id){ if(await appConfirm('删除节点会删除空端口池；节点下有用户/隧道时会被拒绝。确定？', {title:'删除节点', okText:'删除', danger:true})) await api('/api/admin/nodes/delete', {method:'POST', body:{id}}).then(loadAdmin).catch(e=>show(e.message,true)); }

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

async function refreshPortStats(){
  try{
    const r = await api('/api/admin/ports/stats');
    const total = Number(r.total || 0);
    const used = Number(r.used || 0);
    const free = Number(r.free || 0);
    const pct = total > 0 ? ((used / total) * 100).toFixed(1) : '0.0';
    const setText = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
    setText('ovPortUsage', pct + '%');
    setText('ovPortSub', `已用 ${used} · 空闲 ${free} · 共 ${total}`);
    setText('ovPortPct', pct + '%');
    const bar = document.getElementById('ovPortBar');
    if(bar) bar.style.width = pct + '%';
    const track = document.getElementById('ovPortTrack');
    if(track) track.setAttribute('aria-valuenow', pct);
  }catch(e){}
}

let portStatsTimer = null;

function startPortStatsTimer(){
  if(portStatsTimer) clearInterval(portStatsTimer);
  portStatsTimer = setInterval(refreshPortStats, 10000);
}

function clearAdminDashboardTimer(){
  if(adminDashboardTimer){ clearTimeout(adminDashboardTimer); adminDashboardTimer = null; }
  if(portStatsTimer){ clearInterval(portStatsTimer); portStatsTimer = null; }
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

function financeChartSvg(points){
  const days = Array.isArray(points) && points.length ? points : [{ label: '-', income: 0, expense: 0 }];
  const W = 560, H = 210, P = { l: 48, r: 14, t: 16, b: 28 };
  const maxVal = Math.max(1, ...days.map(d => Math.max(Number(d.income) || 0, Number(d.expense) || 0)));
  const stepX = (W - P.l - P.r) / Math.max(1, days.length - 1);
  const yOf = v => P.t + (H - P.t - P.b) * (1 - v / maxVal);
  const line = key => days.map((d, i) => `${i ? 'L' : 'M'}${(P.l + i * stepX).toFixed(1)},${yOf(Number(d[key]) || 0).toFixed(1)}`).join(' ');
  const area = key => `${line(key)} L${(P.l + (days.length - 1) * stepX).toFixed(1)},${(H - P.b).toFixed(1)} L${P.l},${(H - P.b).toFixed(1)} Z`;
  const grid = [0, 0.5, 1].map(ratio => {
    const v = maxVal * ratio, y = yOf(v).toFixed(1);
    return `<line x1="${P.l}" y1="${y}" x2="${W - P.r}" y2="${y}" stroke="rgba(148,163,184,.35)" stroke-width="1" stroke-dasharray="4 4"/><text x="${P.l - 8}" y="${Number(y) + 4}" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">¥${v >= 100 ? Math.round(v) : v.toFixed(1)}</text>`;
  }).join('');
  const dots = key => days.map((d, i) => `<circle cx="${(P.l + i * stepX).toFixed(1)}" cy="${yOf(Number(d[key]) || 0).toFixed(1)}" r="2.6" fill="${key === 'income' ? '#16a34a' : '#dc2626'}"/>`).join('');
  const labelStep = Math.ceil(days.length / 8);
  const labels = days.map((d, i) => (i % labelStep === 0 || i === days.length - 1)
    ? `<text x="${(P.l + i * stepX).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">${esc(String(d.label || ''))}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="收支折线图">
    <defs>
      <linearGradient id="finIncGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#16a34a" stop-opacity=".22"/><stop offset="100%" stop-color="#16a34a" stop-opacity="0"/></linearGradient>
      <linearGradient id="finExpGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#dc2626" stop-opacity=".18"/><stop offset="100%" stop-color="#dc2626" stop-opacity="0"/></linearGradient>
    </defs>
    ${grid}
    <path d="${area('income')}" fill="url(#finIncGrad)"/>
    <path d="${area('expense')}" fill="url(#finExpGrad)"/>
    <path d="${line('income')}" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${line('expense')}" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots('income')}${dots('expense')}
    ${labels}
  </svg>`;
}

let finRange = 7;

function finRangeLabel(days){
  return days <= 1 ? '今天' : `${days} 天`;
}

async function setFinRange(days){
  finRange = Number(days) || 7;
  let info;
  try{ info = await api('/api/admin/ledger/analysis?days=' + finRange); }
  catch(e){ return; }
  const totals = info.totals || {};
  const income = Number(totals.income || 0), expense = Number(totals.expense || 0), net = income - expense;
  const money = (v) => Number(v || 0).toFixed(2);
  const setHtml = (sel, html) => { const el = document.querySelector(sel); if(el) el.innerHTML = html; };
  setHtml('#finBadge', `<i></i>${finRangeLabel(finRange)} ${net >= 0 ? '+' : '-'}¥${money(Math.abs(net))}`);
  const badge = document.querySelector('#finBadge');
  if(badge){ badge.className = 'status-badge ' + (net >= 0 ? 'ok' : 'bad'); }
  setHtml('#finSummary', `
    <div><span>现金收入</span><b class="ledger-in">+¥${money(income)}</b></div>
    <div><span>现金支出</span><b class="ledger-out">-¥${money(expense)}</b></div>
    <div><span>现金净额</span><b class="${net >= 0 ? 'ledger-in' : 'ledger-out'}">${net >= 0 ? '+' : '-'}¥${money(Math.abs(net))}</b></div>`);
  setHtml('#finChart', financeChartSvg(info.series || []));
  setHtml('#finCats', (info.categories || []).map(c => `<span class="fin-cat ${c.direction}">${esc(c.text)} <b>${c.direction === 'in' ? '+' : '-'}¥${money(c.amount)}</b></span>`).join(''));
  document.querySelectorAll('.fin-range-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === finRange));
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

function adminPaymentCardHtml(pay){
  pay = pay || {};
  const enabledChannels = (pay.providers || []).map(x => x.key);
  const status = pay.ready ? '<span class="status-badge ok"><i></i>已就绪</span>' : '<span class="status-badge bad"><i></i>未就绪</span>';
  const badge = (ok) => ok ? '<span class="status-badge ok"><i></i>已配置</span>' : '<span class="status-badge bad"><i></i>未配置</span>';
  return `<section class="card admin-payment-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-green">${stIcon('license')}</span><div><h2>支付设置</h2><p>配置在线支付渠道，用户购买套餐时使用。</p></div>${status}</div>
    <form id="paymentForm" class="settings-form form-grid">
      <div class="span-2"><label>支付渠道（可多选，用户下单时自行选择）</label><div class="pay-channels">
        <label class="check"><input type="checkbox" name="providers" value="alipay"${enabledChannels.includes('alipay') ? ' checked' : ''}> 支付宝</label>
        <label class="check"><input type="checkbox" name="providers" value="wechat"${enabledChannels.includes('wechat') ? ' checked' : ''}> 微信支付</label>
      </div><span class="muted small">全部取消即关闭在线支付；只有已配置完成的渠道才会对用户可用</span></div>
      <div class="span-2"><label>对外访问地址</label><input name="public_url" value="${esc(pay.public_url || '')}" placeholder="https://frp.example.com"><span class="muted small">支付回调地址，必须是公网可访问的 https</span></div>
      <div><label>退订手续费（%）</label><input name="refund_fee_percent" type="number" value="${Number(pay.refund_fee_percent ?? 10)}" min="0" max="100"><span class="muted small">按剩余比例退款后再扣</span></div>
      <div class="span-2 pay-config-row">
        <div class="pay-config-item"><div><b>支付宝</b>${badge(pay.alipay_configured)}</div><button type="button" class="secondary" onclick="openPayConfig('alipay')">配置支付宝</button></div>
        <div class="pay-config-item"><div><b>微信支付</b>${badge(pay.wechat_configured)}</div><button type="button" class="secondary" onclick="openPayConfig('wechat')">配置微信支付</button></div>
      </div>
      <div class="form-actions span-2"><button type="submit">保存设置</button></div>
    </form>
    <div id="alipayConfigModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" onclick="if(event.target===this)closePayConfig('alipay')">
      <section class="modal-page card">
        <div class="section-title modal-title"><div><h2>支付宝配置</h2><p>电脑网站支付，需应用私钥与支付宝公钥。</p></div><button type="button" class="secondary modal-close" onclick="closePayConfig('alipay')">关闭 ×</button></div>
        <form id="alipayConfigForm" class="settings-form form-grid">
          <div class="span-2"><label>App ID</label><input name="alipay_app_id" value="${esc(pay.alipay_app_id || '')}" placeholder="2021000000000000"></div>
          <div class="span-2"><label>网关</label><input name="alipay_gateway" value="${esc(pay.alipay_gateway || 'https://openapi.alipay.com/gateway.do')}"><span class="muted small">沙箱：https://openapi-sandbox.dl.alipaydev.com/gateway.do</span></div>
          <div class="span-2"><label>应用私钥</label><textarea name="alipay_private_key" rows="3" placeholder="${pay.alipay_configured ? '已设置，留空不修改' : '-----BEGIN PRIVATE KEY-----'}"></textarea></div>
          <div class="span-2"><label>支付宝公钥</label><textarea name="alipay_public_key" rows="3" placeholder="${pay.alipay_configured ? '已设置，留空不修改' : '-----BEGIN PUBLIC KEY-----'}"></textarea></div>
          <div class="form-actions span-2"><button type="submit">保存支付宝配置</button></div>
        </form>
      </section>
    </div>
    <div id="wechatConfigModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" onclick="if(event.target===this)closePayConfig('wechat')">
      <section class="modal-page card">
        <div class="section-title modal-title"><div><h2>微信支付配置</h2><p>H5 支付，需要商户号与 API 密钥。</p></div><button type="button" class="secondary modal-close" onclick="closePayConfig('wechat')">关闭 ×</button></div>
        <form id="wechatConfigForm" class="settings-form form-grid">
          <div class="span-2"><label>AppID</label><input name="wechat_appid" value="${esc(pay.wechat_appid || '')}" placeholder="wx0000000000000000"></div>
          <div class="span-2"><label>商户号</label><input name="wechat_mch_id" value="${esc(pay.wechat_mch_id || '')}" placeholder="1600000000"></div>
          <div class="span-2"><label>API 密钥</label><input name="wechat_api_key" type="password" placeholder="${pay.wechat_configured ? '已设置，留空不修改' : '32 位 API 密钥'}"></div>
          <div class="form-actions span-2"><button type="submit">保存微信配置</button></div>
        </form>
      </section>
    </div>
  </section>`;
}

function openPayConfig(kind){
  const el = document.querySelector(kind === 'alipay' ? '#alipayConfigModal' : '#wechatConfigModal');
  if(el) el.classList.remove('hidden');
}

function closePayConfig(kind){
  const el = document.querySelector(kind === 'alipay' ? '#alipayConfigModal' : '#wechatConfigModal');
  if(el) el.classList.add('hidden');
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

function adminBncrCardHtml(b){
  b = b || {};
  return `<section class="card admin-bncr-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-green">${stIcon('bell')}</span><div><h2>Bncr 企微群通知</h2><p>经本机 Bncr 推送到企业微信群，节点离线 / 新工单 / 工单超时会 @对应供货商</p></div><span class="status-badge ${b.enabled && b.group_id ? 'ok' : 'bad'}"><i></i>${b.enabled && b.group_id ? '已配置' : '未配置'}</span></div>
    <form id="bncrConfigForm" class="settings-form r2-form-grid">
      <div class="r2-field"><label>启用</label><div class="notify-row-control"><label class="switch"><input type="checkbox" name="enabled" value="1"${b.enabled ? ' checked' : ''} onchange="const st=document.getElementById('bncrSwitchState');if(st)st.textContent=this.checked?'已开启':'已关闭'"><span class="switch-track"><span class="switch-thumb"></span></span></label><span class="switch-state" id="bncrSwitchState">${b.enabled ? '已开启' : '已关闭'}</span></div></div>
      <div class="r2-field"><label>Bncr 插件地址</label><input name="url" value="${esc(b.url || '')}" placeholder="http://127.0.0.1:9099"></div>
      <div class="r2-field"><label>访问 Token</label><input name="token" value="${esc(b.token || '')}" placeholder="与 Bncr 插件一致，可留空"></div>
      <div class="r2-field r2-field-half"><label>平台</label><input name="platform" value="${esc(b.platform || 'wecomLong')}" placeholder="wecomLong"></div>
      <div class="r2-field r2-field-half"><label>群 chatid</label><input name="group_id" value="${esc(b.group_id || '')}" placeholder="群里发送「企业微信ID」查询"></div>
      <div class="form-actions r2-actions"><button type="submit">保存配置</button><button type="button" class="secondary" onclick="sendBncrTest()">发送测试</button></div>
    </form>
    <p class="settings-hint">地址填 Bncr 容器可访问的本机回环或宿主 IP；群 chatid 在群里发「企业微信ID」即可拿到。</p>
  </section>`;
}

async function sendBncrTest(){
  try{
    const r = await api('/api/admin/bncr-test', {method:'POST', body:{}});
    show(r.message || '已发送');
  }catch(err){ show(err.message || '发送失败', true); }
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

function adminSystemInfoCardHtml(data){
  const up = Number(data.uptime_seconds || 0);
  const upText = up > 86400 ? `${Math.floor(up / 86400)} 天 ${Math.floor((up % 86400) / 3600)} 小时`
                            : (up > 3600 ? `${Math.floor(up / 3600)} 小时 ${Math.floor((up % 3600) / 60)} 分` : `${Math.floor(up / 60)} 分钟`);
  const ps = data.port_stats || {};
  const rows = [
    ['面板版本', `v${esc(data.version || '-')}`],
    ['运行时长', upText],
    ['节点数量', `${Number(data.active_node_count || 0)} / ${Number(data.node_count || 0)} 在线`],
    ['端口池', `已用 ${Number(ps.used || 0)} · 空闲 ${Number(ps.free || 0)} · 共 ${Number(ps.total || 0)}`],
    ['隧道总数', `${Number(data.tunnel_count || 0)} 条`]
  ];
  return `<section class="card admin-sysinfo-card">
    <div class="settings-card-head"><span class="settings-card-icon icon-blue">${stIcon('monitor')}</span><div><h2>系统信息</h2><p>当前面板运行概况</p></div></div>
    <div class="sysinfo-list">${rows.map(([k, v]) => `<div class="sysinfo-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
  </section>`;
}

function balanceSettingsGrid(){
  const grid = document.querySelector('.admin-settings-grid');
  if(!grid) return;
  const cards = Array.from(grid.children).filter(el => el.classList && el.classList.contains('card'));
  if(cards.length < 2) return;
  if(window.innerWidth <= 1180){
    grid.classList.add('single-col');
    grid.innerHTML = '';
    cards.forEach(c => grid.appendChild(c));
    return;
  }
  grid.classList.remove('single-col');
  const heights = cards.map(c => c.getBoundingClientRect().height || 320);
  const n = Math.min(cards.length, 12);
  // 第一张固定放左列，其余枚举最优分配
  const baseA = heights[0] + 20;
  let bestMask = 0, bestDiff = Infinity;
  for(let mask = 0; mask < (1 << (n - 1)); mask++){
    let a = baseA, b = 0, anyB = false;
    for(let i = 1; i < n; i++){
      if(mask & (1 << (i - 1))) a += heights[i] + 20;
      else { b += heights[i] + 20; anyB = true; }
    }
    if(!anyB) continue;
    const diff = Math.abs(a - b);
    if(diff < bestDiff){ bestDiff = diff; bestMask = mask; }
  }
  grid.innerHTML = '';
  const colA = document.createElement('div');
  const colB = document.createElement('div');
  colA.className = 'admin-settings-col';
  colB.className = 'admin-settings-col';
  grid.appendChild(colA);
  grid.appendChild(colB);
  cards.forEach((card, i) => {
    const toA = i === 0 ? true : (i < n ? !!(bestMask & (1 << (i - 1))) : (colA.children.length <= colB.children.length));
    (toA ? colA : colB).appendChild(card);
  });
}

function wireAdminSettingsForms(){
  const r2Form = document.querySelector('#r2ConfigForm');
  if(r2Form) r2Form.onsubmit = saveR2Config;
  const bncrForm = document.querySelector('#bncrConfigForm');
  if(bncrForm){
    bncrForm.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.enabled = fd.get('enabled') ? '1' : '0';
      try{
        const r = await api('/api/admin/bncr-config', {method:'POST', body});
        await reloadAdminCurrentPage();
        show(r.message || 'Bncr 设置已保存');
      }catch(err){ show(err.message, true); }
    };
  }
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
  const paymentForm = document.querySelector('#paymentForm');
  if(paymentForm){
    paymentForm.onsubmit = async (e) => {
      e.preventDefault();
      try{
        const fd = new FormData(e.target);
        const body = Object.fromEntries(fd);
        body.providers = fd.getAll('providers').join(',');
        const r = await api('/api/admin/payment-config', {method:'POST', body});
        await reloadAdminCurrentPage();
        show(r.message || '支付设置已保存');
      }catch(err){ show(err.message, true); }
    };
  }
  const alipayForm = document.querySelector('#alipayConfigForm');
  if(alipayForm){
    alipayForm.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {alipay_app_id: f.alipay_app_id.value, alipay_gateway: f.alipay_gateway.value};
      if(f.alipay_private_key.value.trim()) body.alipay_private_key = f.alipay_private_key.value.trim();
      if(f.alipay_public_key.value.trim()) body.alipay_public_key = f.alipay_public_key.value.trim();
      try{
        const r = await api('/api/admin/payment-config', {method:'POST', body});
        closePayConfig('alipay');
        await reloadAdminCurrentPage();
        show(r.message || '支付宝配置已保存');
      }catch(err){ show(err.message, true); }
    };
  }
  const wechatForm = document.querySelector('#wechatConfigForm');
  if(wechatForm){
    wechatForm.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {wechat_appid: f.wechat_appid.value, wechat_mch_id: f.wechat_mch_id.value};
      if(f.wechat_api_key.value.trim()) body.wechat_api_key = f.wechat_api_key.value.trim();
      try{
        const r = await api('/api/admin/payment-config', {method:'POST', body});
        closePayConfig('wechat');
        await reloadAdminCurrentPage();
        show(r.message || '微信支付配置已保存');
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
  const bncr = data.bncr || {};
  setPanelMeta(data);
  const r2 = data.r2 || {};
  const r2Source = r2.source === 'database' ? '面板配置' : (r2.source === 'env' ? '环境变量兼容' : '未配置');
  const r2Status = r2.configured ? '<span class="ok">已配置</span>' : '<span class="bad">未配置</span>';
  const frpcUsers = data.frpc_users || [];
  window.adminProxyTypeOptions = data.allowed_proxy_types || ['tcp','udp','http','https','stcp','xtcp','tcpmux'];
  app.innerHTML = appLayoutHtml(`
    <div class="admin-settings-grid">
      ${adminPaymentCardHtml(data.payment)}
      ${adminSmtpCardHtml(smtp)}
      ${adminBncrCardHtml(bncr)}
      ${adminBackupCardHtml(r2, r2Status, r2Source)}
      ${adminR2CardHtml(r2, r2Status, r2Source)}
      ${adminSystemInfoCardHtml(data)}
    </div>
    ${adminPwdModalHtml()}
  `, 'admin-settings', '管理员设置');
  wireAdminSettingsForms();
  balanceSettingsGrid();
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
  const money = (v) => Number(v || 0).toFixed(2);
  const ledgerDaily = data.ledger_daily || [];
  const ledgerTotals = data.ledger_totals || {};
  const finIncome = Number(ledgerTotals.income || 0);
  const finExpense = Number(ledgerTotals.expense || 0);
  const finNet = finIncome - finExpense;
  const finRows = ledgerDaily.map(d => `<tr><td>${esc(String(d.day || '').slice(5))}</td><td class="ledger-in">+¥${money(d.income)}</td><td class="ledger-out">-¥${money(d.expense)}</td><td class="${Number(d.net) >= 0 ? 'ledger-in' : 'ledger-out'}">${Number(d.net) >= 0 ? '+' : '-'}¥${money(Math.abs(Number(d.net) || 0))}</td></tr>`).join('');
  const finCats = (data.ledger_categories || []).map(c => `<span class="fin-cat ${c.direction}">${esc(c.text)} <b>${c.direction === 'in' ? '+' : '-'}¥${money(c.amount)}</b></span>`).join('');
  const r2Source = r2.source === 'database' ? '面板配置' : (r2.source === 'env' ? '环境变量兼容' : '未配置');
  const r2Status = r2.configured ? '<span class="ok">已配置</span>' : '<span class="bad">未配置</span>';
  const frpcUsers = data.frpc_users || [];
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
      <section class="workspace-stat ov-stat" style="--ov-accent:#8b5cf6;--ov-tint:#f5f2ff">
        <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.chart}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">总流量</span><strong class="ov-stat-value">${fmtBytes(data.traffic_today)}</strong><span class="ov-stat-sub">今日全平台 · 所有用户</span></div></div>
      </section>
      <section class="workspace-stat ov-stat" style="--ov-accent:#3478f6;--ov-tint:#eef4ff">
        <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.file}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">面板版本</span><strong class="ov-stat-value">${esc(data.panel_version || data.version || '-')}</strong><span class="ov-stat-sub">frp-manager-lite</span></div></div>
      </section>
      <section class="workspace-stat ov-stat" style="--ov-accent:#22c55e;--ov-tint:#f0fdf4">
        <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.node}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">节点在线</span><strong class="ov-stat-value">${data.active_node_count}/${data.node_count}</strong><span class="ov-stat-sub">每 ${refreshSeconds} 秒检查认证端口</span></div></div>
      </section>
      <section class="workspace-stat ov-stat" style="--ov-accent:#f59e0b;--ov-tint:#fff8ec">
        <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.port}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">端口使用率</span><strong class="ov-stat-value" id="ovPortUsage">${portUsage}%</strong><span class="ov-stat-sub" id="ovPortSub">已用 ${usedPorts} · 空闲 ${freePorts} · 共 ${totalPorts}</span></div></div>
        <div class="tunnel-usage"><div class="tunnel-usage-label"><span>端口池</span><b id="ovPortPct">${portUsage}%</b></div><div class="tunnel-usage-track" id="ovPortTrack" role="progressbar" aria-label="端口使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${portUsage}"><span id="ovPortBar" style="width:${portUsage}%"></span></div></div>
      </section>
      <section class="workspace-stat ov-stat" style="--ov-accent:#2c6dd2;--ov-tint:#eef4ff">
        <div class="ov-stat-main"><span class="ov-stat-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${UIICONS.users}</svg></span><div class="ov-stat-copy"><span class="ov-stat-label">用户</span><strong class="ov-stat-value">${userStats.active}/${userStats.total}</strong><span class="ov-stat-sub">活跃用户 / 总用户</span></div></div>
      </section>
    </div>

    <div class="admin-dashboard-grid">
      <section class="card admin-finance-card">
        <div class="section-title"><div><div class="section-kicker">FINANCE</div><h2>${stIcon('chart')}收支分析</h2></div><div class="fin-range">${[[1,'今天'],[7,'7 天'],[30,'30 天'],[90,'90 天']].map(([d, t]) => `<button type="button" class="fin-range-btn${finRange === d ? ' active' : ''}" data-days="${d}" onclick="setFinRange(${d})">${t}</button>`).join('')}</div><span class="status-badge ${finNet >= 0 ? 'ok' : 'bad'}" id="finBadge"><i></i>${finRangeLabel(finRange)} ${finNet >= 0 ? '+' : '-'}¥${money(Math.abs(finNet))}</span></div>
        <div class="fin-summary" id="finSummary">
          <div><span>现金收入</span><b class="ledger-in">+¥${money(finIncome)}</b></div>
          <div><span>现金支出</span><b class="ledger-out">-¥${money(finExpense)}</b></div>
          <div><span>现金净额</span><b class="${finNet >= 0 ? 'ledger-in' : 'ledger-out'}">${finNet >= 0 ? '+' : '-'}¥${money(Math.abs(finNet))}</b></div>
        </div>
        <div class="fin-chart" id="finChart">
          ${financeChartSvg(ledgerDaily)}
          <div class="fin-legend"><span class="inc"><i></i>收入</span><span class="exp"><i></i>支出</span></div>
        </div>
        <div class="fin-cats" id="finCats">${finCats}</div>
      </section>

      <section class="card quick-actions-card">
        <div class="section-title"><div><div class="section-kicker">QUICK ACTIONS</div><h2>${stIcon('bolt')}快捷操作</h2></div></div>
        <div class="quick-actions-grid">
          <button class="quick-action" onclick="loadAdmin('users')"><span class="quick-action-icon">${QICON_USER}</span><b>用户管理</b><small>账号与到期</small></button>
          <button class="quick-action" onclick="loadAdmin('plans')"><span class="quick-action-icon">${QICON_VERSION}</span><b>套餐管理</b><small>模板与上下架</small></button>
          <button class="quick-action" onclick="loadAdmin('orders')"><span class="quick-action-icon">${QICON_KEY}</span><b>订单</b><small>支付与开通</small></button>
          <button class="quick-action" onclick="loadAdminLedger()"><span class="quick-action-icon">${QICON_TRAFFIC}</span><b>收支表</b><small>收入与支出流水</small></button>
          <button class="quick-action" onclick="loadAdmin('nodes')"><span class="quick-action-icon">${QICON_NODE}</span><b>节点管理</b><small>frps 接入</small></button>
          <button class="quick-action" onclick="loadAdmin('health')"><span class="quick-action-icon">${QICON_SERVER}</span><b>节点健康</b><small>连通性检查</small></button>
          <button class="quick-action" onclick="loadAdminProxies()"><span class="quick-action-icon">${QICON_TUNNEL}</span><b>映射监控</b><small>隧道状态</small></button>
          <button class="quick-action" onclick="loadAdminOps()"><span class="quick-action-icon">${QICON_SETTINGS}</span><b>平台维护</b><small>公告与密钥</small></button>
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
          <div><span>套餐订单</span><b>${data.order_count || 0}</b></div>
          <div><span>封禁记录</span><b>${data.ban_count || 0}</b></div>
        </div>
      </section>
    </div>
    `, 'admin-dashboard', '运行总览');
  adminHostHistory = hostHistory;
  renderHostCharts();
  fillNodeLatencies();
  adminDashboardTimer = setTimeout(() => loadAdminDashboard(true), refreshSeconds * 1000);
  startPortStatsTimer();
}

loadMe();


async function openNodeSwitch(){
  const modal=document.getElementById('nodeSwitchModal');
  const list=document.getElementById('nodeSwitchList');
  if(!modal||!list)return;
  modal.classList.remove('hidden');
  list.innerHTML='<p class="muted">正在加载可用实例…</p>';
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
async function switchDashboardNode(nodeId, backView){
  if(!nodeId||String(nodeId)===String(currentDashboardNodeId)){closeNodeSwitch();return;}
  if(!await appConfirm('确定切换接入节点？已有隧道不会自动迁移，切换前请确认目标节点资源。', {title:'切换节点'}))return;
  try{
    await api('/api/user/node/switch',{method:'POST',body:{node_id:nodeId}});
    closeNodeSwitch();
    await loadDashboard(backView || 'overview');
    show('接入节点已切换，建议重新下载 frpc 配置。');
  }catch(err){show(err.message,true);}
}
