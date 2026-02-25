#!/bin/bash
# OpenClaw 配置备份脚本
# 每次修改配置前自动备份

set -e

BACKUP_DIR="/home/ubuntu/openclaw/backups"
CONFIG_DIR="/home/ubuntu/openclaw/config"
MAX_BACKUPS=10

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[备份]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

error() {
    echo -e "${RED}[错误]${NC} $1"
}

# 创建备份
create_backup() {
    local config_type="${1:-all}"
    local timestamp=$(date "+%Y%m%d_%H%M%S")
    local backup_name="config_${config_type}_${timestamp}.tar.gz"
    local backup_path="${BACKUP_DIR}/${backup_name}"
    
    log "开始备份配置: ${config_type}"
    
    # 确保备份目录存在
    mkdir -p "$BACKUP_DIR"
    
    case "$config_type" in
        all)
            tar -czf "$backup_path" -C "$(dirname "$CONFIG_DIR")" "$(basename "$CONFIG_DIR")" 2>/dev/null || {
                error "备份失败: 无法创建压缩包"
                return 1
            }
            ;;
        channels)
            if [ -d "${CONFIG_DIR}/channels" ]; then
                tar -czf "$backup_path" -C "$CONFIG_DIR" "channels" 2>/dev/null || {
                    error "备份失败: 无法创建压缩包"
                    return 1
                }
            else
                warn "channels 目录不存在"
                return 1
            fi
            ;;
        plugins)
            if [ -d "${CONFIG_DIR}/plugins" ]; then
                tar -czf "$backup_path" -C "$CONFIG_DIR" "plugins" 2>/dev/null || {
                    error "备份失败: 无法创建压缩包"
                    return 1
                }
            else
                warn "plugins 目录不存在"
                return 1
            }
            ;;
        gateway)
            if [ -f "${CONFIG_DIR}/gateway.yaml" ]; then
                tar -czf "$backup_path" -C "$CONFIG_DIR" "gateway.yaml" 2>/dev/null || {
                    error "备份失败: 无法创建压缩包"
                    return 1
                }
            else
                warn "gateway.yaml 不存在"
                return 1
            }
            ;;
        *)
            error "未知配置类型: ${config_type}"
            echo "可用类型: all, channels, plugins, gateway"
            return 1
            ;;
    esac
    
    log "备份已创建: ${backup_name}"
    
    # 清理旧备份
    cleanup_old_backups
    
    echo "$backup_path"
}

# 清理旧备份（保留最近10个）
cleanup_old_backups() {
    local count=$(ls -1t "${BACKUP_DIR}"/config_*.tar.gz 2>/dev/null | wc -l)
    
    if [ $count -gt $MAX_BACKUPS ]; then
        local to_delete=$((count - MAX_BACKUPS))
        warn "清理 ${to_delete} 个旧备份..."
        
        ls -1t "${BACKUP_DIR}"/config_*.tar.gz | tail -n "$to_delete" | xargs -r rm -f
        log "备份清理完成"
    fi
}

# 列出备份
list_backups() {
    log "可用备份:"
    ls -1t "${BACKUP_DIR}"/config_*.tar.gz 2>/dev/null | while read -r backup; do
        local size=$(du -h "$backup" | cut -f1)
        local date=$(basename "$backup" | grep -oP '\d{8}_\d{6}')
        echo "  - $(basename "$backup") (${size}) - ${date}"
    done
}

# 恢复备份
restore_backup() {
    local backup_file="$1"
    
    if [ -z "$backup_file" ]; then
        error "请指定备份文件"
        echo "用法: $0 restore <备份文件>"
        list_backups
        return 1
    fi
    
    local backup_path="${BACKUP_DIR}/${backup_file}"
    
    if [ ! -f "$backup_path" ]; then
        error "备份文件不存在: ${backup_file}"
        return 1
    fi
    
    warn "即将恢复备份: ${backup_file}"
    warn "当前配置将被覆盖!"
    
    read -p "确认恢复? (y/n): " confirm
    
    if [ "$confirm" = "y" ]; then
        tar -xzf "$backup_path" -C "$(dirname "$CONFIG_DIR")"
        log "配置已恢复"
        return 0
    else
        log "已取消恢复"
        return 2
    fi
}

# 显示帮助
show_help() {
    cat << EOF
OpenClaw 配置备份工具

用法: $(basename "$0") <命令> [参数]

命令:
  create [类型]     创建配置备份 (类型: all|channels|plugins|gateway)
  list             列出所有备份
  restore <文件>   恢复指定备份
  cleanup          清理旧备份（保留最近10个）
  help             显示此帮助

示例:
  $(basename "$0") create all          # 备份所有配置
  $(basename "$0") create channels     # 只备份通道配置
  $(basename "$0") list                # 查看可用备份
  $(basename "$0") restore config_all_20260224_120000.tar.gz
EOF
}

# 主函数
main() {
    local command="${1:-help}"
    
    case "$command" in
        create)
            create_backup "${2:-all}"
            ;;
        list)
            list_backups
            ;;
        restore)
            restore_backup "$2"
            ;;
        cleanup)
            cleanup_old_backups
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            error "未知命令: ${command}"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
