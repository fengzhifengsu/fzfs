#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

CONFIG_FILE="${1:-./kele-agent.json}"

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}Configuration file not found: $CONFIG_FILE${NC}"
    echo -e "${YELLOW}Please run install.sh first or specify config path:${NC}"
    echo -e "  $0 /path/to/kele-agent.json"
    exit 1
fi

echo -e "${BLUE}"
echo "  _  __      _         _              _ _     _ "
echo " | |/ /     | |       | |            | (_)   | |"
echo " | . \| | | | ||  __/ | |_) | |_| || | | | (_| |"
echo " |_|\_\_| |_|\__\___| |_.__/ \__,_||_|_|_|\__,_|"
echo -e "${NC}"
echo ""
echo -e "${BLUE}KeleAgent Interactive Configuration Wizard${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

read_json_value() {
    local file="$1"
    local key="$2"
    python3 -c "
import json
with open('$file') as f:
    config = json.load(f)
keys = '$key'.split('.')
value = config
for k in keys:
    value = value.get(k, '')
print(value if isinstance(value, str) else json.dumps(value))
" 2>/dev/null || echo ""
}

update_json_value() {
    local file="$1"
    local key="$2"
    local value="$3"

    python3 -c "
import json
with open('$file') as f:
    config = json.load(f)
keys = '$key'.split('.')
target = config
for k in keys[:-1]:
    target = target.setdefault(k, {})
try:
    target[keys[-1]] = json.loads('$value')
except:
    target[keys[-1]] = '$value'
with open('$file', 'w') as f:
    json.dump(config, f, indent=2)
" 2>/dev/null
}

echo -e "${CYAN}Step 1: AI Model Provider${NC}"
echo -e "Which AI model provider do you want to use?"
echo ""
echo "  1) OpenAI (GPT-4, GPT-3.5)"
echo "  2) Anthropic (Claude)"
echo "  3) Google (Gemini)"
echo "  4) Ollama (Local models)"
echo "  5) Custom API"
echo ""
read -p "Select provider [1-5]: " provider_choice

case $provider_choice in
    1)
        update_json_value "$CONFIG_FILE" "agent.model.provider" "openai"
        echo ""
        echo -e "${CYAN}OpenAI Configuration${NC}"
        read -p "API Key: " openai_key
        read -p "Model name [gpt-4]: " openai_model
        openai_model=${openai_model:-gpt-4}
        update_json_value "$CONFIG_FILE" "agent.model.apiKey" "$openai_key"
        update_json_value "$CONFIG_FILE" "agent.model.name" "$openai_model"
        ;;
    2)
        update_json_value "$CONFIG_FILE" "agent.model.provider" "anthropic"
        echo ""
        echo -e "${CYAN}Anthropic Configuration${NC}"
        read -p "API Key: " anthropic_key
        read -p "Model name [claude-3-opus-20240229]: " anthropic_model
        anthropic_model=${anthropic_model:-claude-3-opus-20240229}
        update_json_value "$CONFIG_FILE" "agent.model.apiKey" "$anthropic_key"
        update_json_value "$CONFIG_FILE" "agent.model.name" "$anthropic_model"
        ;;
    3)
        update_json_value "$CONFIG_FILE" "agent.model.provider" "google"
        echo ""
        echo -e "${CYAN}Google Configuration${NC}"
        read -p "API Key: " google_key
        read -p "Model name [gemini-pro]: " google_model
        google_model=${google_model:-gemini-pro}
        update_json_value "$CONFIG_FILE" "agent.model.apiKey" "$google_key"
        update_json_value "$CONFIG_FILE" "agent.model.name" "$google_model"
        ;;
    4)
        update_json_value "$CONFIG_FILE" "agent.model.provider" "ollama"
        echo ""
        echo -e "${CYAN}Ollama Configuration${NC}"
        read -p "Model name [llama3]: " ollama_model
        ollama_model=${ollama_model:-llama3}
        read -p "Ollama API URL [http://localhost:11434/v1]: " ollama_url
        ollama_url=${ollama_url:-http://localhost:11434/v1}
        update_json_value "$CONFIG_FILE" "agent.model.apiKey" "ollama"
        update_json_value "$CONFIG_FILE" "agent.model.name" "$ollama_model"
        update_json_value "$CONFIG_FILE" "agent.model.baseUrl" "$ollama_url"
        ;;
    5)
        update_json_value "$CONFIG_FILE" "agent.model.provider" "custom"
        echo ""
        echo -e "${CYAN}Custom API Configuration${NC}"
        read -p "API Key: " custom_key
        read -p "API Base URL: " custom_url
        read -p "Model name: " custom_model
        update_json_value "$CONFIG_FILE" "agent.model.apiKey" "$custom_key"
        update_json_value "$CONFIG_FILE" "agent.model.baseUrl" "$custom_url"
        update_json_value "$CONFIG_FILE" "agent.model.name" "$custom_model"
        ;;
    *)
        echo -e "${RED}Invalid choice, keeping current configuration${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${CYAN}Step 2: System Prompt${NC}"
echo ""
echo "Current: $(read_json_value "$CONFIG_FILE" "agent.systemPrompt")"
echo ""
read -p "Enter system prompt [You are KeleAgent, a helpful AI assistant with persistent memory and extensible skills.]: " system_prompt
system_prompt=${system_prompt:-"You are KeleAgent, a helpful AI assistant with persistent memory and extensible skills."}
update_json_value "$CONFIG_FILE" "agent.systemPrompt" "$system_prompt"

echo ""
echo -e "${CYAN}Step 3: Model Parameters${NC}"
echo ""
read -p "Temperature (0-2, controls creativity) [0.7]: " temperature
temperature=${temperature:-0.7}
update_json_value "$CONFIG_FILE" "agent.temperature" "$temperature"

read -p "Max tokens per response [4096]: " max_tokens
max_tokens=${max_tokens:-4096}
update_json_value "$CONFIG_FILE" "agent.maxTokens" "$max_tokens"

echo ""
echo -e "${CYAN}Step 4: Gateway Settings${NC}"
echo ""
read -p "Gateway port [18789]: " gateway_port
gateway_port=${gateway_port:-18789}
update_json_value "$CONFIG_FILE" "gateway.port" "$gateway_port"

read -p "Bind address [127.0.0.1]: " gateway_host
gateway_host=${gateway_host:-127.0.0.1}
update_json_value "$CONFIG_FILE" "gateway.host" "$gateway_host"

echo ""
echo -e "${CYAN}Step 5: Chat Channels${NC}"
echo ""

read -p "Enable Feishu (飞书)? [y/N]: " enable_feishu
if [[ $enable_feishu =~ ^[Yy]$ ]]; then
    update_json_value "$CONFIG_FILE" "channels.feishu.enabled" "true"
    read -p "Feishu App ID: " feishu_app_id
    read -p "Feishu App Secret: " feishu_app_secret
    read -p "Feishu Verification Token: " feishu_token
    update_json_value "$CONFIG_FILE" "channels.feishu.appId" "$feishu_app_id"
    update_json_value "$CONFIG_FILE" "channels.feishu.appSecret" "$feishu_app_secret"
    update_json_value "$CONFIG_FILE" "channels.feishu.verificationToken" "$feishu_token"
    read -p "Use Feishu international (open.larksuite.com)? [y/N]: " feishu_intl
    if [[ $feishu_intl =~ ^[Yy]$ ]]; then
        update_json_value "$CONFIG_FILE" "channels.feishu.host" "open.larksuite.com"
    fi
else
    update_json_value "$CONFIG_FILE" "channels.feishu.enabled" "false"
fi

echo ""
read -p "Enable Telegram? [y/N]: " enable_telegram
if [[ $enable_telegram =~ ^[Yy]$ ]]; then
    update_json_value "$CONFIG_FILE" "channels.telegram.enabled" "true"
    read -p "Telegram Bot Token: " telegram_token
    update_json_value "$CONFIG_FILE" "channels.telegram.botToken" "$telegram_token"
else
    update_json_value "$CONFIG_FILE" "channels.telegram.enabled" "false"
fi

echo ""
read -p "Enable Discord? [y/N]: " enable_discord
if [[ $enable_discord =~ ^[Yy]$ ]]; then
    update_json_value "$CONFIG_FILE" "channels.discord.enabled" "true"
    read -p "Discord Bot Token: " discord_token
    read -p "Discord Client ID: " discord_client_id
    update_json_value "$CONFIG_FILE" "channels.discord.botToken" "$discord_token"
    update_json_value "$CONFIG_FILE" "channels.discord.clientId" "$discord_client_id"
else
    update_json_value "$CONFIG_FILE" "channels.discord.enabled" "false"
fi

echo ""
echo -e "${CYAN}Step 6: Memory Settings${NC}"
echo ""
read -p "Enable persistent memory? [Y/n]: " enable_memory
if [[ $enable_memory =~ ^[Nn]$ ]]; then
    update_json_value "$CONFIG_FILE" "memory.enabled" "false"
else
    update_json_value "$CONFIG_FILE" "memory.enabled" "true"
fi

echo ""
echo -e "${CYAN}Step 7: Automation Settings${NC}"
echo ""
read -p "Enable automation (Cron jobs, Webhooks)? [Y/n]: " enable_automation
if [[ $enable_automation =~ ^[Nn]$ ]]; then
    update_json_value "$CONFIG_FILE" "automation.enabled" "false"
else
    update_json_value "$CONFIG_FILE" "automation.enabled" "true"
fi

echo ""
echo -e "${CYAN}Step 8: Browser Settings${NC}"
echo ""
read -p "Enable browser automation? [Y/n]: " enable_browser
if [[ $enable_browser =~ ^[Nn]$ ]]; then
    update_json_value "$CONFIG_FILE" "browser.enabled" "false"
else
    update_json_value "$CONFIG_FILE" "browser.enabled" "true"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Configuration Saved!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "Configuration file: ${BLUE}$CONFIG_FILE${NC}"
echo ""
echo -e "${CYAN}Configuration Summary:${NC}"
echo ""
echo -e "  Provider:     $(read_json_value "$CONFIG_FILE" "agent.model.provider")"
echo -e "  Model:        $(read_json_value "$CONFIG_FILE" "agent.model.name")"
echo -e "  Temperature:  $(read_json_value "$CONFIG_FILE" "agent.temperature")"
echo -e "  Max Tokens:   $(read_json_value "$CONFIG_FILE" "agent.maxTokens")"
echo -e "  Gateway:      $(read_json_value "$CONFIG_FILE" "gateway.host"):$(read_json_value "$CONFIG_FILE" "gateway.port")"
echo -e "  Feishu:       $(read_json_value "$CONFIG_FILE" "channels.feishu.enabled")"
echo -e "  Telegram:     $(read_json_value "$CONFIG_FILE" "channels.telegram.enabled")"
echo -e "  Discord:      $(read_json_value "$CONFIG_FILE" "channels.discord.enabled")"
echo -e "  Memory:       $(read_json_value "$CONFIG_FILE" "memory.enabled")"
echo -e "  Automation:   $(read_json_value "$CONFIG_FILE" "automation.enabled")"
echo -e "  Browser:      $(read_json_value "$CONFIG_FILE" "browser.enabled")"
echo ""
echo -e "${YELLOW}Start KeleAgent with:${NC}"
echo -e "  ${BLUE}kele start${NC}"
echo ""
