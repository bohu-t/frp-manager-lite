#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/frp-manager-lite}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"
PANEL_URL="${PANEL_URL:-}"
FML_SETUP_KEY="${FML_SETUP_KEY:-}"
IFACE="${FML_RATE_LIMIT_IFACE:-}"
NODE_ID="${FML_RATE_LIMIT_NODE_ID:-}"
DRY_RUN="${DRY_RUN:-0}"
CLEAR="${CLEAR:-0}"

CHAIN="FML_RATE_LIMIT"
MARK_BASE="${FML_RATE_LIMIT_MARK_BASE:-42000}"
CLASS_BASE="${FML_RATE_LIMIT_CLASS_BASE:-4200}"
QDISC_HANDLE="${FML_RATE_LIMIT_QDISC_HANDLE:-42}"
DEFAULT_CLASS="${FML_RATE_LIMIT_DEFAULT_CLASS:-9999}"
DEFAULT_RATE="${FML_RATE_LIMIT_DEFAULT_RATE:-10000mbit}"
FORCE="${FML_RATE_LIMIT_FORCE:-0}"

log(){ printf '\033[1;34m[rate-limit]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[rate-limit] WARN:\033[0m %s\n' "$*"; }
err(){ printf '\033[1;31m[rate-limit] ERROR:\033[0m %s\n' "$*" >&2; }
run(){ if [[ "$DRY_RUN" == "1" ]]; then printf '+ '; printf '%q ' "$@"; printf '\n'; else "$@"; fi; }
need_cmd(){ command -v "$1" >/dev/null 2>&1 || { err "缺少命令：$1"; exit 1; }; }

load_env(){
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
  PANEL_URL="${PANEL_URL:-http://127.0.0.1:${FML_PUBLISH_PORT:-18081}}"
  FML_SETUP_KEY="${FML_SETUP_KEY:-${FML_SETUP_KEY:-}}"
}

detect_iface(){
  if [[ -n "$IFACE" ]]; then return 0; fi
  IFACE="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  if [[ -z "$IFACE" ]]; then
    IFACE="$(ip -o -4 route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  fi
  [[ -n "$IFACE" ]] || { err "无法自动识别出口网卡，请设置 FML_RATE_LIMIT_IFACE=eth0"; exit 1; }
}

api_url(){
  local url="${PANEL_URL%/}/api/host/port-rate-rules"
  if [[ -n "$NODE_ID" ]]; then url="${url}?node_id=${NODE_ID}"; fi
  printf '%s' "$url"
}

fetch_rules(){
  local url tmp
  url="$(api_url)"
  tmp="$(mktemp)"
  if ! curl -fsS --connect-timeout 5 --max-time 20 -H "X-FML-Setup-Key: ${FML_SETUP_KEY}" "$url" -o "$tmp"; then
    rm -f "$tmp"
    err "拉取限速规则失败：$url"
    exit 1
  fi
  python3 - "$tmp" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path, 'r', encoding='utf-8'))
if not data.get('ok'):
    raise SystemExit(data.get('error') or 'API returned ok=false')
for r in data.get('rules') or []:
    port = int(r.get('port') or 0)
    proto = str(r.get('protocol') or 'tcp').lower()
    rate = int(r.get('rate_kbit') or 0)
    if port > 0 and proto in {'tcp','udp'} and rate > 0:
        print(f'{port}\t{proto}\t{rate}')
PY
  rm -f "$tmp"
}

clear_rules(){
  run iptables -t mangle -D OUTPUT -j "$CHAIN" 2>/dev/null || true
  run iptables -t mangle -F "$CHAIN" 2>/dev/null || true
  run iptables -t mangle -X "$CHAIN" 2>/dev/null || true
  if tc qdisc show dev "$IFACE" 2>/dev/null | grep -q "qdisc htb ${QDISC_HANDLE}:"; then
    run tc qdisc del dev "$IFACE" root 2>/dev/null || true
  fi
}

guard_existing_qdisc(){
  local line
  line="$(tc qdisc show dev "$IFACE" 2>/dev/null | awk '$0 ~ / root / {print; exit}')"
  [[ -z "$line" ]] && return 0
  if grep -q "qdisc htb ${QDISC_HANDLE}:" <<< "$line"; then return 0; fi
  if [[ "$FORCE" == "1" ]]; then
    warn "将覆盖现有 root qdisc：$line"
    return 0
  fi
  if grep -Eq 'qdisc (fq_codel|pfifo_fast|noqueue) ' <<< "$line"; then
    warn "将替换系统默认 root qdisc：$line"
    return 0
  fi
  err "检测到已有自定义 root qdisc，默认不覆盖：$line；如确认可覆盖，设置 FML_RATE_LIMIT_FORCE=1"
  exit 1
}

ensure_base(){
  guard_existing_qdisc
  if [[ "$DRY_RUN" == "1" ]]; then
    run modprobe sch_htb
    run modprobe cls_fw
  else
    modprobe sch_htb 2>/dev/null || true
    modprobe cls_fw 2>/dev/null || true
  fi
  run iptables -t mangle -N "$CHAIN" 2>/dev/null || true
  run iptables -t mangle -F "$CHAIN"
  if ! iptables -t mangle -C OUTPUT -j "$CHAIN" >/dev/null 2>&1; then
    run iptables -t mangle -A OUTPUT -j "$CHAIN"
  fi
  run tc qdisc replace dev "$IFACE" root handle "${QDISC_HANDLE}:" htb default "$DEFAULT_CLASS"
  run tc class replace dev "$IFACE" parent "${QDISC_HANDLE}:" classid "${QDISC_HANDLE}:${DEFAULT_CLASS}" htb rate "$DEFAULT_RATE" ceil "$DEFAULT_RATE"
}

apply_rules(){
  local rules count=0 idx=1
  rules="$(fetch_rules)"
  if [[ -z "$rules" ]]; then
    clear_rules
    log "没有需要应用的端口速率策略；已清空 ${CHAIN} 规则，未改动其他 qdisc。"
    return 0
  fi
  ensure_base
  while IFS=$'\t' read -r port proto rate_kbit; do
    [[ -n "$port" ]] || continue
    local mark classid
    mark=$((MARK_BASE + idx))
    classid=$((CLASS_BASE + idx))
    run tc class replace dev "$IFACE" parent "${QDISC_HANDLE}:" classid "${QDISC_HANDLE}:${classid}" htb rate "${rate_kbit}kbit" ceil "${rate_kbit}kbit"
    run tc filter replace dev "$IFACE" protocol ip parent "${QDISC_HANDLE}:" prio 10 handle "$mark" fw flowid "${QDISC_HANDLE}:${classid}"
    if [[ "$proto" == "tcp" ]]; then
      run iptables -t mangle -A "$CHAIN" -p tcp --sport "$port" -j MARK --set-mark "$mark"
    else
      run iptables -t mangle -A "$CHAIN" -p udp --sport "$port" -j MARK --set-mark "$mark"
    fi
    count=$((count + 1)); idx=$((idx + 1))
  done <<< "$rules"
  log "已应用 ${count} 条端口速率策略：iface=${IFACE}, qdisc=${QDISC_HANDLE}:, chain=${CHAIN}"
}

main(){
  [[ "$(id -u)" == "0" ]] || { err "请用 root 执行"; exit 1; }
  need_cmd curl; need_cmd python3; need_cmd ip; need_cmd tc; need_cmd iptables
  load_env
  [[ -n "$FML_SETUP_KEY" ]] || { err "缺少 FML_SETUP_KEY，请检查 ${ENV_FILE}"; exit 1; }
  detect_iface
  if [[ "$CLEAR" == "1" ]]; then clear_rules; log "已清理端口速率策略"; return 0; fi
  apply_rules
}

main "$@"
