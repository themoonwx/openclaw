#!/bin/bash
# OpenClaw 待处理队列检查脚本
# 检查 /tmp/openclaw-pending-fix.txt 并自动触发修复

set -e

SCRIPT_DIR="/home/ubuntu/openclaw/scripts"
FIXES_DIR="/home/ubuntu/openclaw/logs/fixes"
PENDING_FILE="/tmp/openclaw-pending-fix.txt"

echo "========================================"
echo "   OpenClaw 待处理队列检查"
echo "========================================"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"

# 1. 检查待处理文件是否存在
echo "[1/5] 检查待处理文件..."
if [ ! -f "$PENDING_FILE" ]; then
    echo "✅ 无待处理修复任务"
    exit 0
fi

echo "⚠️ 发现待处理修复任务"

# 2. 读取修复任务
echo "[2/5] 读取修复任务..."
TASK_CONTENT=$(cat "$PENDING_FILE")
echo "任务内容预览:"
echo "---"
echo "$TASK_CONTENT" | head -20
echo "---"

# 提取任务文件路径
TASK_FILE=$(echo "$TASK_CONTENT" | head -1)

if [ -f "$TASK_FILE" ]; then
    FULL_TASK=$(cat "$TASK_FILE")
    echo "完整任务已读取"
else
    FULL_TASK="$TASK_CONTENT"
fi

# 3. 搜索历史修复记录
echo "[3/5] 搜索历史修复记录..."
HISTORY=""
if [ -d "$FIXES_DIR" ] && [ "$(ls -A $FIXES_DIR 2>/dev/null)" ]; then
    echo "找到历史修复记录:"
    ls -t "$FIXES_DIR"/*.md 2>/dev/null | head -5 | while read f; do
        echo "  - $(basename "$f")"
    done
    HISTORY=$(ls -t "$FIXES_DIR"/*.md 2>/dev/null | head -5 | xargs -I {} sh -c 'echo "=== {} ===" && cat {}' 2>/dev/null)
else
    echo "  无历史记录"
fi

# 4. 触发修复 (记录到日志，由主进程通过 sessions_spawn 触发)
echo "[4/5] 准备触发 CC 修复..."

# 生成触发信息用于日志
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
TRIGGER_LOG="/tmp/fix-trigger-$TIMESTAMP.log"

cat > "$TRIGGER_LOG" << EOF
# 修复触发日志 - $TIMESTAMP

## 待处理任务
$(cat "$PENDING_FILE")

## 完整任务内容
$FULL_TASK

## 历史修复记录
$HISTORY

## 触发时间
$(date '+%Y-%m-%d %H:%M:%S')

## 状态
准备触发 CC 修复
EOF

echo "📋 触发日志: $TRIGGER_LOG"

# 输出信息供主进程捕获
echo ""
echo "========================================"
echo "   修复任务已准备好"
echo "========================================"
echo "任务文件: $TASK_FILE"
echo "触发日志: $TRIGGER_LOG"
echo ""
echo "主进程将通过 sessions_spawn 触发 CC 修复"
echo ""

# 5. 标记任务为已处理（但不删除，待 CC 修复完成后再删除）
# 使用 .processing 后缀标记正在处理
PROCESSING_FILE="${PENDING_FILE}.processing"
mv "$PENDING_FILE" "$PROCESSING_FILE"
echo "✅ 已标记任务为处理中: $PROCESSING_FILE"

# 实际删除由修复完成后执行
# 这里只输出信息，修复完成后主进程会删除

exit 0
