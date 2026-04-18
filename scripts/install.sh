#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "  _  __      _         _              _ _     _ "
echo " | |/ /     | |       | |            | (_)   | |"
echo " | ' / _ __ | |_ ___  | |__  _   _  _| |_  __| |"
echo " |  < | '_ \| __/ _ \ | '_ \| | | || | | |/ _\` |"
echo " | . \| | | | ||  __/ | |_) | |_| || | | | (_| |"
echo " |_|\_\_| |_|\__\___| |_.__/ \__,_||_|_|_|\__,_|"
echo -e "${NC}"
echo ""
echo -e "${BLUE}KeleAgent - Local-first AI Agent Platform${NC}"
echo -e "${BLUE}Version 1.0.0${NC}"
echo ""

GITHUB_REPO="fengzhifengsu/fzfs"
INSTALL_DIR="${INSTALL_DIR:-/opt/kele-agent}"
DATA_DIR="${INSTALL_DIR}/data"
LOGS_DIR="${INSTALL_DIR}/logs"
SKILLS_DIR="${INSTALL_DIR}/skills"
CONFIG_FILE="${INSTALL_DIR}/kele-agent.json"
SERVICE_NAME="kele-agent"
TEMP_DIR=$(mktemp -d)

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

trap "rm -rf $TEMP_DIR" EXIT

clone_repo() {
    log_info "Cloning KeleAgent from GitHub..."
    git clone -q --depth 1 "https://github.com/${GITHUB_REPO}.git" "$TEMP_DIR/kele"
    log_info "Repository cloned"
}

check_root() {
    if [ "$(id -u)" -eq 0 ]; then
        log_warn "Running as root. Consider running as a regular user."
    fi
}

check_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
        log_info "Detected OS: $OS $VER"
    else
        log_error "Cannot detect OS"
        exit 1
    fi
}

check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -lt 18 ]; then
            log_error "Node.js 18+ required, found $(node -v)"
            log_info "Please upgrade Node.js and try again"
            exit 1
        fi
        log_info "Node.js $(node -v) already installed"
        return 0
    fi
    return 1
}

install_node() {
    log_info "Installing Node.js..."
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
            apt-get install -y nodejs > /dev/null 2>&1
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
            yum install -y nodejs > /dev/null 2>&1
            ;;
        *"Arch"*|*"Manjaro"*)
            pacman -Sy --noconfirm nodejs npm > /dev/null 2>&1
            ;;
        *)
            log_error "Unsupported OS for automatic Node.js installation"
            log_info "Please install Node.js 18+ manually: https://nodejs.org"
            exit 1
            ;;
    esac
    log_info "Node.js $(node -v) installed"
}

install_dependencies() {
    log_info "Installing system dependencies..."
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            apt-get update > /dev/null 2>&1
            apt-get install -y build-essential git curl wget > /dev/null 2>&1
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            yum groupinstall -y "Development Tools" > /dev/null 2>&1
            yum install -y git curl wget > /dev/null 2>&1
            ;;
        *"Arch"*|*"Manjaro"*)
            pacman -Sy --noconfirm base-devel git curl wget > /dev/null 2>&1
            ;;
    esac
    log_info "System dependencies installed"
}

install_kele_agent() {
    log_info "Installing KeleAgent to $INSTALL_DIR..."

    mkdir -p "$INSTALL_DIR"
    mkdir -p "$DATA_DIR"
    mkdir -p "$LOGS_DIR"
    mkdir -p "$SKILLS_DIR"

    cp -r "$TEMP_DIR/kele/src" "$INSTALL_DIR/"
    cp -r "$TEMP_DIR/kele/scripts" "$INSTALL_DIR/"
    cp "$TEMP_DIR/kele/package.json" "$INSTALL_DIR/"
    cp "$TEMP_DIR/kele/tsconfig.json" "$INSTALL_DIR/"
    cp "$TEMP_DIR/kele/kele-agent.json" "$INSTALL_DIR/"

    cd "$INSTALL_DIR"

    log_info "Installing npm dependencies (this may take a minute)..."
    npm install --production --silent 2>/dev/null || npm install --production

    log_info "Building TypeScript..."
    npm run build 2>/dev/null || log_warn "Build skipped (no TypeScript compiler available)"

    chmod -R 755 "$INSTALL_DIR"

    log_info "KeleAgent installed to $INSTALL_DIR"
}

create_config() {
    log_info "Creating default configuration..."

    cat > "$CONFIG_FILE" << 'EOF'
{
  "agent": {
    "name": "KeleAgent",
    "model": {
      "provider": "openai",
      "name": "gpt-4",
      "apiKey": "",
      "baseUrl": ""
    },
    "systemPrompt": "You are KeleAgent, a helpful AI assistant with persistent memory and extensible skills.",
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
    "authToken": "",
    "corsOrigins": []
  },
  "channels": {
    "feishu": {
      "enabled": false,
      "appId": "",
      "appSecret": "",
      "verificationToken": "",
      "encryptKey": "",
      "host": "open.feishu.cn",
      "requireMention": true
    },
    "telegram": {
      "enabled": false,
      "botToken": ""
    },
    "discord": {
      "enabled": false,
      "botToken": "",
      "clientId": ""
    },
    "slack": {
      "enabled": false,
      "botToken": "",
      "signingSecret": ""
    }
  },
  "memory": {
    "enabled": true,
    "dbPath": "./data/memory.db",
    "maxContextLength": 50,
    "embeddingModel": "text-embedding-3-small"
  },
  "skills": {
    "workspacePath": "./skills",
    "autoInstall": false,
    "allowList": []
  },
  "automation": {
    "enabled": true,
    "cronJobsPath": "./data/cron.json",
    "webhooksPath": "./data/webhooks.json"
  },
  "browser": {
    "enabled": true,
    "headless": true,
    "timeout": 30000
  },
  "logging": {
    "level": "info",
    "filePath": "./logs/kele-agent.log"
  }
}
EOF

    log_info "Configuration created at $CONFIG_FILE"
}

create_service() {
    if ! command -v systemctl &> /dev/null; then
        log_warn "systemd not found, skipping service creation"
        return
    fi

    log_info "Creating systemd service..."

    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=KeleAgent - Local-first AI Agent Platform
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node dist/index.js start -c $CONFIG_FILE
Restart=always
RestartSec=10
StandardOutput=append:$LOGS_DIR/kele-agent.log
StandardError=append:$LOGS_DIR/kele-agent-error.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"

    log_info "Systemd service created at $SERVICE_FILE"
    log_info "Start with: sudo systemctl start $SERVICE_NAME"
    log_info "Stop with:  sudo systemctl stop $SERVICE_NAME"
    log_info "Status with: sudo systemctl status $SERVICE_NAME"
}

create_launcher() {
    log_info "Creating launcher script..."

    LAUNCHER="/usr/local/bin/kele"

    cat > "$LAUNCHER" << EOF
#!/bin/bash

INSTALL_DIR="$INSTALL_DIR"
CONFIG_FILE="$CONFIG_FILE"

cd "\$INSTALL_DIR"

case "\$1" in
    start)
        if command -v systemctl &> /dev/null && systemctl is-active --quiet kele-agent 2>/dev/null; then
            echo "KeleAgent is already running (systemd)"
            exit 0
        fi
        echo "Starting KeleAgent..."
        if [ -d "dist" ]; then
            node dist/index.js start -c "\$CONFIG_FILE" &
        else
            npx ts-node src/main.ts start -c "\$CONFIG_FILE" &
        fi
        echo "KeleAgent started (PID: \$!)"
        echo "Stop with: kele stop"
        ;;
    stop)
        if systemctl is-active --quiet kele-agent 2>/dev/null; then
            sudo systemctl stop kele-agent
        else
            pkill -f "node dist/index.js" || pkill -f "ts-node src/main.ts" || echo "KeleAgent is not running"
        fi
        echo "KeleAgent stopped"
        ;;
    status)
        if systemctl is-active --quiet kele-agent 2>/dev/null; then
            systemctl status kele-agent
        else
            if pgrep -f "node dist/index.js" > /dev/null || pgrep -f "ts-node src/main.ts" > /dev/null; then
                echo "KeleAgent is running (manual mode)"
                pgrep -af "node dist/index.js\|ts-node src/main.ts"
            else
                echo "KeleAgent is not running"
            fi
        fi
        ;;
    restart)
        \$0 stop
        sleep 2
        \$0 start
        ;;
    log)
        tail -f "$LOGS_DIR/kele-agent.log"
        ;;
    config)
        echo "Current configuration:"
        cat "\$CONFIG_FILE"
        ;;
    configure)
        bash "$INSTALL_DIR/scripts/configure.sh"
        ;;
    *)
        echo "Usage: kele {start|stop|status|restart|log|config|configure}"
        echo ""
        echo "Commands:"
        echo "  start      - Start KeleAgent"
        echo "  stop       - Stop KeleAgent"
        echo "  status     - Check KeleAgent status"
        echo "  restart    - Restart KeleAgent"
        echo "  log        - View KeleAgent logs"
        echo "  config     - View current configuration"
        echo "  configure  - Run interactive configuration wizard"
        ;;
esac
EOF

    chmod +x "$LAUNCHER"

    log_info "Launcher script created at $LAUNCHER"
}

print_summary() {
    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  KeleAgent Installation Complete!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo -e "  Installation directory: ${BLUE}$INSTALL_DIR${NC}"
    echo -e "  Configuration file:     ${BLUE}$CONFIG_FILE${NC}"
    echo -e "  Data directory:         ${BLUE}$DATA_DIR${NC}"
    echo -e "  Log directory:          ${BLUE}$LOGS_DIR${NC}"
    echo ""
    echo -e "  ${YELLOW}Next steps:${NC}"
    echo ""
    echo -e "  1. Configure your AI model:"
    echo -e "     ${BLUE}kele configure${NC}"
    echo ""
    echo -e "  2. Start KeleAgent:"
    echo -e "     ${BLUE}kele start${NC}"
    echo ""
    echo -e "  3. Check status:"
    echo -e "     ${BLUE}kele status${NC}"
    echo ""
    echo -e "  4. View logs:"
    echo -e "     ${BLUE}kele log${NC}"
    echo ""
    echo -e "  ${YELLOW}Available commands:${NC}"
    echo -e "     kele {start|stop|status|restart|log|config|configure}"
    echo ""
}

# Main installation flow
main() {
    check_root
    check_os

    echo ""
    echo -e "${BLUE}Installing KeleAgent...${NC}"
    echo ""

    if ! check_node; then
        install_node
    fi

    install_dependencies
    clone_repo
    install_kele_agent
    create_config
    create_service
    create_launcher

    print_summary
}

main "$@"
