#!/usr/bin/env bash
# ==============================================================================
# SecureDrop LAN - Enterprise Service Controller & Auto-Start Manager
# ==============================================================================
# Usage:
#   ./start.sh                Start server in background (daemon mode)
#   ./start.sh -f | --foreground  Start server in foreground
#   ./start.sh stop           Stop the running server
#   ./start.sh restart        Restart the server
#   ./start.sh status         Check server running status & metrics
#   ./start.sh logs           Follow server logs (tail -f)
#   ./start.sh auto-restart   Run supervisor daemon with automatic crash recovery
#   ./start.sh --install-service Install & enable systemd user auto-start service
# ==============================================================================

set -o pipefail

# Resolve script directory and navigate to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Colors for terminal output
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[0;32m"
  CYAN="\033[0;36m"
  YELLOW="\033[1;33m"
  RED="\033[0;31m"
  BLUE="\033[0;34m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  CYAN=""
  YELLOW=""
  RED=""
  BLUE=""
  RESET=""
fi

# Load optional .env configuration
if [ -f "$SCRIPT_DIR/.env" ]; then
  # Export vars from .env safely
  set -a
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/.env"
  set +a
fi

# Configuration defaults
HOST="${SECUREDROP_HOST:-0.0.0.0}"
PORT="${SECUREDROP_WEB_PORT:-${SECUREDROP_PORT:-8000}}"
TCP_PORT="${SECUREDROP_TCP_PORT:-9001}"
PID_FILE="$SCRIPT_DIR/.securedrop.pid"
LOG_FILE="$SCRIPT_DIR/securedrop.log"

# Discover primary LAN IP
get_lan_ip() {
  local ip=""
  if command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}')
  fi
  if [ -z "$ip" ]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

# Find appropriate Python interpreter
get_python() {
  if [ -n "$VIRTUAL_ENV" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then
    echo "$VIRTUAL_ENV/bin/python"
    return 0
  fi
  for venv in "$SCRIPT_DIR/.venv" "$SCRIPT_DIR/venv" "$SCRIPT_DIR/env"; do
    if [ -x "$venv/bin/python" ]; then
      echo "$venv/bin/python"
      return 0
    fi
  done
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return 0
  elif command -v python >/dev/null 2>&1; then
    echo "python"
    return 0
  fi
  return 1
}

PYTHON=$(get_python)
if [ -z "$PYTHON" ]; then
  echo -e "${RED}[ERROR] Python 3 interpreter not found. Please install python3.${RESET}"
  exit 1
fi

# Check whether a given PID is alive
is_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Resolve active server PID (from PID file or active listening port)
get_active_pid() {
  local pid=""
  if [ -f "$PID_FILE" ]; then
    pid=$(tr -d ' \r\n' < "$PID_FILE")
    if is_pid_alive "$pid"; then
      echo "$pid"
      return 0
    fi
  fi
  # Fallback: scan for running run.py or process bound to PORT
  if command -v fuser >/dev/null 2>&1; then
    pid=$(fuser "${PORT}/tcp" 2>/dev/null | awk '{print $1}')
    if [ -n "$pid" ] && is_pid_alive "$pid"; then
      echo "$pid"
      return 0
    fi
  fi
  if command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -ti :"${PORT}" 2>/dev/null | head -n 1)
    if [ -n "$pid" ] && is_pid_alive "$pid"; then
      echo "$pid"
      return 0
    fi
  fi
  pid=$(pgrep -f "python.*run\.py" 2>/dev/null | head -n 1)
  if [ -n "$pid" ] && is_pid_alive "$pid"; then
    echo "$pid"
    return 0
  fi
  return 1
}

# Perform HTTP health check
check_health() {
  local port="$1"
  "$PYTHON" -c "
import urllib.request, sys
try:
    with urllib.request.urlopen('http://127.0.0.1:${port}/api/health', timeout=1.5) as r:
        if r.status == 200:
            sys.exit(0)
except Exception:
    pass
sys.exit(1)
" 2>/dev/null
}

# Print stylized banner
print_banner() {
  echo -e "${CYAN}${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}${BOLD}║           SECUREDROP LAN v2 — AUTO-START CONTROLLER        ║${RESET}"
  echo -e "${CYAN}${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}"
}

# Action: Start Server
do_start() {
  local mode="$1"
  local existing_pid
  existing_pid=$(get_active_pid)

  if [ -n "$existing_pid" ]; then
    if check_health "$PORT"; then
      echo -e "${YELLOW}[!] SecureDrop LAN is ALREADY RUNNING (PID: ${existing_pid}) on port ${PORT}.${RESET}"
      do_status
      echo -e "\nTip: To restart with latest code, run: ${BOLD}./start.sh restart${RESET}"
      return 0
    else
      echo -e "${YELLOW}[!] Found stale/unresponsive process (PID: ${existing_pid}). Terminating before fresh start...${RESET}"
      kill -9 "$existing_pid" 2>/dev/null
      rm -f "$PID_FILE"
      sleep 1
    fi
  fi

  print_banner
  local lan_ip
  lan_ip=$(get_lan_ip)

  echo -e "${BLUE}* Working Directory :${RESET} ${SCRIPT_DIR}"
  echo -e "${BLUE}* Python Runtime    :${RESET} $($PYTHON --version 2>&1)"
  echo -e "${BLUE}* Target Host:Port  :${RESET} ${HOST}:${PORT} (TCP Chunks: ${TCP_PORT})"
  echo -e "${BLUE}* Log Destination   :${RESET} ${LOG_FILE}"

  # Build React frontend if bundle not present
  if [ -d "$SCRIPT_DIR/frontend" ] && [ ! -d "$SCRIPT_DIR/securedrop/static/dist" ]; then
    if command -v npm >/dev/null 2>&1; then
      echo -e "${CYAN}► Building React frontend bundle...${RESET}"
      (cd "$SCRIPT_DIR/frontend" && npm run build) >/dev/null 2>&1 || true
    fi
  fi

  if [ "$mode" = "foreground" ]; then
    echo -e "${GREEN}${BOLD}► Starting SecureDrop LAN in FOREGROUND (Ctrl+C to stop)...${RESET}\n"
    exec "$PYTHON" run.py --host "$HOST" --port "$PORT" --tcp-port "$TCP_PORT"
  fi

  # If systemd user service is enabled, utilize systemd lifecycle management
  if [ "$mode" != "foreground" ] && command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-enabled --quiet securedrop.service 2>/dev/null; then
      echo -e "${GREEN}${BOLD}► Managing via systemd user service (securedrop.service)...${RESET}"
      systemctl --user restart securedrop.service
      
      echo -n -e "${CYAN}Waiting for service initialization...${RESET}"
      local attempts=0
      local ok=0
      while [ $attempts -lt 15 ]; do
        if check_health "$PORT"; then
          ok=1
          break
        fi
        sleep 0.8
        echo -n "."
        attempts=$((attempts + 1))
      done
      echo ""

      if [ $ok -eq 1 ]; then
        local svc_pid
        svc_pid=$(get_active_pid)
        [ -n "$svc_pid" ] && echo "$svc_pid" > "$PID_FILE"
        echo -e "${GREEN}${BOLD}✓ SecureDrop LAN successfully started & online!${RESET}"
        echo -e "  ${BOLD}Service:${RESET}     systemd user service (active & enabled)"
        echo -e "  ${BOLD}PID:${RESET}         ${svc_pid}"
        echo -e "  ${BOLD}LAN Access:${RESET}  ${GREEN}http://${lan_ip}:${PORT}${RESET}"
        echo -e "  ${BOLD}Local Access:${RESET}${GREEN}http://127.0.0.1:${PORT}${RESET}"
        echo -e "  ${BOLD}TCP Chunks:${RESET}  ${TCP_PORT}"
        echo -e "\n${BOLD}Quick Commands:${RESET}"
        echo -e "  Check status:  ${CYAN}./start.sh status${RESET}"
        echo -e "  View live logs:${CYAN}./start.sh logs${RESET}"
        echo -e "  Restart:       ${CYAN}./start.sh restart${RESET}"
        echo -e "  Stop server:   ${CYAN}./start.sh stop${RESET}"
        return 0
      fi
    fi
  fi

  echo -e "${GREEN}${BOLD}► Launching background daemon...${RESET}"
  nohup "$PYTHON" run.py --host "$HOST" --port "$PORT" --tcp-port "$TCP_PORT" </dev/null >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  disown "$new_pid" 2>/dev/null || true
  echo "$new_pid" > "$PID_FILE"

  # Wait and verify health check
  echo -n -e "${CYAN}Waiting for server initialization...${RESET}"
  local attempts=0
  local max_attempts=15
  local ok=0
  while [ $attempts -lt $max_attempts ]; do
    if ! is_pid_alive "$new_pid"; then
      echo -e "\n${RED}[ERROR] Process died shortly after launch. Inspecting last 20 log lines:${RESET}"
      tail -n 20 "$LOG_FILE" 2>/dev/null
      rm -f "$PID_FILE"
      return 1
    fi
    if check_health "$PORT"; then
      ok=1
      break
    fi
    sleep 0.8
    echo -n "."
    attempts=$((attempts + 1))
  done
  echo ""

  if [ $ok -eq 1 ]; then
    echo -e "${GREEN}${BOLD}✓ SecureDrop LAN successfully started & online!${RESET}"
    echo -e "  ${BOLD}PID:${RESET}         ${new_pid} (saved in ${PID_FILE})"
    echo -e "  ${BOLD}LAN Access:${RESET}  ${GREEN}http://${lan_ip}:${PORT}${RESET}"
    echo -e "  ${BOLD}Local Access:${RESET}${GREEN}http://127.0.0.1:${PORT}${RESET}"
    echo -e "  ${BOLD}TCP Chunks:${RESET}  ${TCP_PORT}"
    echo -e "\n${BOLD}Quick Commands:${RESET}"
    echo -e "  Check status:  ${CYAN}./start.sh status${RESET}"
    echo -e "  View live logs:${CYAN}./start.sh logs${RESET}"
    echo -e "  Restart:       ${CYAN}./start.sh restart${RESET}"
    echo -e "  Stop server:   ${CYAN}./start.sh stop${RESET}"
    return 0
  else
    echo -e "${RED}[ERROR] Health check timed out on port ${PORT}. Inspecting logs:${RESET}"
    tail -n 20 "$LOG_FILE" 2>/dev/null
    return 1
  fi
}

# Action: Stop Server
do_stop() {
  local pid
  pid=$(get_active_pid)

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-active --quiet securedrop.service 2>/dev/null; then
      echo -e "${YELLOW}► Stopping systemd user service (securedrop.service)...${RESET}"
      systemctl --user stop securedrop.service
      rm -f "$PID_FILE"
      echo -e "${GREEN}✓ Systemd service stopped cleanly.${RESET}"
      return 0
    fi
  fi

  if [ -z "$pid" ]; then
    echo -e "${YELLOW}[INFO] SecureDrop LAN is not running.${RESET}"
    rm -f "$PID_FILE"
    return 0
  fi

  echo -e "${YELLOW}► Stopping SecureDrop LAN (PID: ${pid})...${RESET}"
  kill -15 "$pid" 2>/dev/null

  local count=0
  while is_pid_alive "$pid" && [ $count -lt 10 ]; do
    sleep 0.5
    count=$((count + 1))
  done

  if is_pid_alive "$pid"; then
    echo -e "${RED}[!] Force terminating unresponsive PID ${pid}...${RESET}"
    kill -9 "$pid" 2>/dev/null
    sleep 0.5
  fi

  # Also clean up any lingering child processes on TCP chunk port
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${TCP_PORT}/tcp" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo -e "${GREEN}✓ Server stopped cleanly.${RESET}"
}

# Action: Status
do_status() {
  local pid
  pid=$(get_active_pid)
  local lan_ip
  lan_ip=$(get_lan_ip)

  print_banner
  if [ -n "$pid" ] && is_pid_alive "$pid"; then
    echo -e "Status:        ${GREEN}${BOLD}ONLINE (Running)${RESET}"
    echo -e "PID:           ${pid}"
    local res_info
    res_info=$(ps -p "$pid" -o %cpu,%mem,etime --no-headers 2>/dev/null | xargs)
    if [ -n "$res_info" ]; then
      local cpu mem etime
      cpu=$(echo "$res_info" | awk '{print $1}')
      mem=$(echo "$res_info" | awk '{print $2}')
      etime=$(echo "$res_info" | awk '{print $3}')
      echo -e "Resource:      CPU ${cpu}%, RAM ${mem}%, Uptime ${etime}"
    fi
    echo -e "LAN URL:       ${GREEN}http://${lan_ip}:${PORT}${RESET}"
    echo -e "Local URL:     ${GREEN}http://127.0.0.1:${PORT}${RESET}"
    echo -e "TCP Port:      ${TCP_PORT}"
    if check_health "$PORT"; then
      echo -e "Healthcheck:   ${GREEN}HTTP 200 OK${RESET}"
    else
      echo -e "Healthcheck:   ${RED}WARNING: Not responding on /api/health${RESET}"
    fi
  else
    echo -e "Status:        ${RED}${BOLD}STOPPED (Offline)${RESET}"
    echo -e "Target Port:   ${PORT}"
    echo -e "Run:           ${CYAN}./start.sh${RESET} to start."
  fi
}

# Action: Live Logs
do_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    touch "$LOG_FILE"
  fi
  echo -e "${CYAN}Streaming logs from ${LOG_FILE} (Ctrl+C to exit)...${RESET}"
  tail -n 50 -f "$LOG_FILE"
}

# Action: Auto-Restart Supervisor
do_auto_restart() {
  print_banner
  echo -e "${YELLOW}${BOLD}► Starting SecureDrop LAN in AUTO-RESTART SUPERVISOR mode.${RESET}"
  echo -e "${YELLOW}The server will automatically restart if it terminates or crashes.${RESET}"
  echo -e "Press [Ctrl+C] to exit supervisor.\n"

  trap 'echo -e "\n${YELLOW}Supervisor shutting down...${RESET}"; exit 0' SIGINT SIGTERM

  local restart_count=0
  while true; do
    restart_count=$((restart_count + 1))
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] Starting instance #${restart_count}...${RESET}"
    "$PYTHON" run.py --host "$HOST" --port "$PORT" --tcp-port "$TCP_PORT"
    local exit_code=$?
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] Instance #${restart_count} exited with code ${exit_code}.${RESET}"
    echo -e "${CYAN}Restarting in 2 seconds...${RESET}"
    sleep 2
  done
}

# Action: Install systemd user service for auto-boot
do_install_service() {
  local service_dir="$HOME/.config/systemd/user"
  local service_file="$service_dir/securedrop.service"
  mkdir -p "$service_dir"

  cat <<EOF > "$service_file"
[Unit]
Description=SecureDrop LAN Enterprise Service
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${SCRIPT_DIR}/start.sh --foreground
Restart=always
RestartSec=3
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
EOF

  echo -e "${GREEN}✓ Created systemd service: ${service_file}${RESET}"
  systemctl --user daemon-reload
  systemctl --user enable securedrop.service
  systemctl --user restart securedrop.service

  # Enable user lingering so service runs at machine boot even before GUI login
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USER" 2>/dev/null || true
  fi

  echo -e "${GREEN}${BOLD}✓ Systemd service installed, enabled, and started!${RESET}"
  echo -e "Manage with: ${CYAN}systemctl --user status securedrop.service${RESET}"
}

# Usage documentation
show_help() {
  print_banner
  echo -e "Usage: ${BOLD}./start.sh [COMMAND|OPTION]${RESET}\n"
  echo "Commands:"
  echo "  start               Start server in background (default if no arguments)"
  echo "  restart             Gracefully stop and start a fresh server instance"
  echo "  stop                Stop the active server process"
  echo "  status              Show server process status, resource usage, and URLs"
  echo "  logs                Tail live application logs (-f)"
  echo "  auto-restart        Run resilient supervisor with auto-restart loop"
  echo ""
  echo "Options:"
  echo "  -f, --foreground    Run directly in terminal foreground"
  echo "  -d, --daemon        Explicit background daemon execution"
  echo "  --install-service   Install & register systemd auto-start service on boot"
  echo "  -h, --help          Show this help screen"
}

# Dispatcher
ACTION="${1:-start}"

case "$ACTION" in
  start)
    do_start "daemon"
    ;;
  -f|--foreground|foreground)
    do_start "foreground"
    ;;
  -d|--daemon|daemon)
    do_start "daemon"
    ;;
  stop)
    do_stop
    ;;
  restart)
    do_stop
    sleep 1
    do_start "daemon"
    ;;
  status)
    do_status
    ;;
  logs)
    do_logs
    ;;
  auto-restart|watch|supervisor)
    do_auto_restart
    ;;
  --install-service|install-service)
    do_install_service
    ;;
  -h|--help|help)
    show_help
    ;;
  *)
    echo -e "${RED}[ERROR] Unknown option: '$ACTION'${RESET}\n"
    show_help
    exit 1
    ;;
esac
