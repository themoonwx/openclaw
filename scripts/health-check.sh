#!/bin/bash
# OpenClaw 健康检查脚本
# 按需触发，不自动运行

set -e

LOG_DIR="/home/ubuntu/openclaw/logs"
SCRIPT_DIR="/home/ubuntu/openclaw/scripts"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[健康检查]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

error() {
    echo -e "${RED}[错误]${NC} $1"
}

# 检查 Gateway 进程状态
check_gateway() {
    log "检查 Gateway 进程状态..."
    
    if pgrep -f "openclaw-gateway" > /dev/null 2>&1; then
        log "Gateway 进程运行中"
        return 0
    else
        error "Gateway 进程未运行"
        return 1
    fi
}

# 配置文件路径
CONFIG_FILE="/home/ubuntu/.openclaw/openclaw.json"

# 静默检测飞书通道连通性
check_feishu() {
    log "检测飞书通道连通性..."
    
    # 从 JSON 配置检测飞书是否启用
    local feishu_enabled
    feishu_enabled=$(jq -r '.channels.feishu.enabled // false' "$CONFIG_FILE" 2>/dev/null)
    
    if [ "$feishu_enabled" != "true" ]; then
        warn "飞书通道: 未启用"
        return 2
    fi
    
    # 检测连通性
    if curl -s --connect-timeout 5 -o /dev/null "https://open.feishu.cn" 2>/dev/null; then
        log "飞书通道: 连通"
        return 0
    else
        warn "飞书通道: 无法连接"
        return 1
    fi
}

# 静默检测 Discord 通道连通性
check_discord() {
    log "检测 Discord 通道连通性..."
    
    # 从 JSON 配置检测 Discord 是否启用
    local discord_enabled
    discord_enabled=$(jq -r '.channels.discord.enabled // false' "$CONFIG_FILE" 2>/dev/null)
    
    if [ "$discord_enabled" != "true" ]; then
        warn "Discord 通道: 未启用"
        return 2
    fi
    
    # 检测连通性
    if curl -s --connect-timeout 5 -o /dev/null "https://discord.com" 2>/dev/null; then
        log "Discord 通道: 连通"
        return 0
    else
        warn "Discord 通道: 无法连接"
        return 1
    fi
}

# 静默检测钉钉通道连通性
check_dingtalk() {
    log "检测钉钉通道连通性..."
    
    # 从 JSON 配置检测钉钉是否启用
    local dingtalk_enabled
    dingtalk_enabled=$(jq -r '.channels["dingtalk-connector"].enabled // false' "$CONFIG_FILE" 2>/dev/null)
    
    if [ "$dingtalk_enabled" != "true" ]; then
        warn "钉钉通道: 未启用"
        return 2
    fi
    
    # 检测连通性
    if curl -s --connect-timeout 5 -o /dev/null "https://oapi.dingtalk.com" 2>/dev/null; then
        log "钉钉通道: 连通"
        return 0
    else
        warn "钉钉通道: 无法连接"
        return 1
    fi
}

# 生成修复报告
generate_fix_report() {
    local issue="$1"
    local cause="$2"
    local fix_method="$3"
    local prevention="$4"
    
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    local date_str=$(date "+%Y-%m-%d")
    
    # 生成序号
    local count=$(ls -1 /home/ubuntu/openclaw/logs/fixes/${date_str}_*.md 2>/dev/null | wc -l)
    local seq=$(printf "%03d" $((count + 1)))
    
    local filename="${date_str}_${seq}_fix.md"
    local filepath="/home/ubuntu/openclaw/logs/fixes/${filename}"
    
    # 写入修复报告 (使用 printf 处理换行)
    printf "# 修复报告 - %s\n\n## 问题\n%s\n\n## 原因\n%s\n\n## 修复方法\n%s\n\n## 预防建议\n%s\n" \
        "$timestamp" "$issue" "$cause" "$fix_method" "$prevention" > "$filepath"
    
    log "修复报告已生成: ${filename}"
    
    # 更新索引
    /home/ubuntu/openclaw/scripts/update-index.sh update "$date_str" "$issue" "$filename"
    
    echo "$filepath"
}

# 更新 MEMORY.md 索引
update_memory_index() {
    local date="$1"
    local issue="$2"
    local filename="$3"
    
    local memory_file="/home/ubuntu/.openclaw/workspace/MEMORY.md"
    
    # 如果文件不存在，创建头部
    if [ ! -f "$memory_file" ]; then
        cat > "$memory_file" << 'EOF'
# MEMORY.md - OpenClaw 记忆索引

## 修复记录索引

EOF
    fi
    
    # 添加索引条目
    echo "- ${date}: ${issue} → fixes/${filename}" >> "$memory_file"
    
    log "索引已更新"
}

# 主函数
main() {
    echo "========================================"
    echo "   OpenClaw 健康检查"
    echo "========================================"
    
    local status=0
    
    check_gateway || status=1
    check_feishu || status=1
    check_discord || status=1
    check_dingtalk || status=1
    
    echo "========================================"
    
    if [ $status -eq 0 ]; then
        log "所有检查通过"
    else
        warn "部分检查未通过，请查看日志"
    fi
    
    return $status
}

# 根据参数执行对应功能
case "${1:-check}" in
    check)
        main
        ;;
    gateway)
        check_gateway
        ;;
    feishu)
        check_feishu
        ;;
    discord)
        check_discord
        ;;
    dingtalk)
        check_dingtalk
        ;;
    report)
        if [ $# -lt 5 ]; then
            echo "用法: $0 report <问题> <原因> <修复方法> <预防建议>"
            exit 1
        fi
        generate_fix_report "$2" "$3" "$4" "$5"
        ;;
    index)
        if [ $# -lt 4 ]; then
            echo "用法: $0 index <日期> <问题> <文件名>"
            exit 1
        fi
        update_memory_index "$2" "$3" "$4"
        ;;
    *)
        echo "用法: $0 {check|gateway|feishu|discord|report|index}"
        exit 1
        ;;
esac
