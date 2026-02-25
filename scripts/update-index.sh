#!/bin/bash
# OpenClaw 索引更新脚本
# 更新 MEMORY.md 索引

set -e

MEMORY_FILE="/home/ubuntu/.openclaw/workspace/MEMORY.md"
FIXES_DIR="/home/ubuntu/openclaw/logs/fixes"

# 颜色输出
GREEN='\033[0;32m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[索引]${NC} $1"
}

# 更新索引
update_index() {
    local date="$1"
    local issue="$2"
    local filename="$3"
    
    # 如果文件不存在，创建头部
    if [ ! -f "$MEMORY_FILE" ]; then
        mkdir -p "$(dirname "$MEMORY_FILE")"
        cat > "$MEMORY_FILE" << 'EOF'
# MEMORY.md - OpenClaw 记忆索引

## 修复记录索引

EOF
        log "创建索引文件: ${MEMORY_FILE}"
    fi
    
    # 检查是否已存在相同条目（避免重复）
    if grep -q "${filename}" "$MEMORY_FILE" 2>/dev/null; then
        log "索引条目已存在，跳过"
        return 0
    fi
    
    # 添加索引条目
    echo "- ${date}: ${issue} → fixes/${filename}" >> "$MEMORY_FILE"
    
    log "索引已更新: ${date}: ${issue}"
}

# 查看索引
show_index() {
    if [ -f "$MEMORY_FILE" ]; then
        cat "$MEMORY_FILE"
    else
        echo "索引文件不存在"
        return 1
    fi
}

# 主函数
main() {
    case "${1:-show}" in
        update)
            if [ $# -lt 4 ]; then
                echo "用法: $0 update <日期> <问题> <文件名>"
                exit 1
            fi
            update_index "$2" "$3" "$4"
            ;;
        show)
            show_index
            ;;
        *)
            echo "用法: $0 {update|show}"
            exit 1
            ;;
    esac
}

main "$@"
