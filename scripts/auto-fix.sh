#!/bin/bash
# OpenClaw 自动修复脚本
# 检测到问题后自动触发 CC 修复，并记录修复结果

set -e

SCRIPT_DIR="/home/ubuntu/openclaw/scripts"
FIXES_DIR="/home/ubuntu/openclaw/logs/fixes"
PENDING_FILE="/tmp/openclaw-pending-fix.txt"

echo "========================================"
echo "   OpenClaw 自动修复"
echo "========================================"

# 1. 运行健康检查
echo "[1/5] 运行健康检查..."
$SCRIPT_DIR/health-check.sh > /tmp/health-check.log 2>&1
HEALTH_RESULT=$?

if [ $HEALTH_RESULT -eq 0 ]; then
    echo "✅ 健康检查通过，无需修复"
    exit 0
fi

echo "⚠️ 健康检查未通过，继续修复流程..."

# 2. 读取健康检查日志，分析问题
echo "[2/5] 分析问题..."
LOG_CONTENT=$(cat /tmp/health-check.log)

# 提取问题类型
PROBLEM_TYPE="未知问题"
if echo "$LOG_CONTENT" | grep -q "飞书"; then
    PROBLEM_TYPE="飞书通道问题"
fi
if echo "$LOG_CONTENT" | grep-q "Gateway"; then
    PROBLEM_TYPE="Gateway问题"
fi

echo "检测到问题：$PROBLEM_TYPE"

# 3. 搜索历史修复记录
echo "[3/5] 搜索历史修复记录..."
HISTORY=""
if [ -d "$FIXES_DIR" ] && [ "$(ls -A $FIXES_DIR 2>/dev/null)" ]; then
    HISTORY=$(ls -t "$FIXES_DIR"/*.md 2>/dev/null | head -5 | xargs -I {} sh -c 'echo "=== {} ===" && cat {}' 2>/dev/null)
fi

if [ -z "$HISTORY" ]; then
    HISTORY="无历史记录"
fi

echo "历史修复记录：已获取"

# 4. 生成修复任务
echo "[4/5] 生成修复任务..."

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
FIX_FILE="$FIXES_DIR/${TIMESTAMP}_fix.md"

# 创建修复任务描述
TASK_FILE="/tmp/fix-task-$TIMESTAMP.txt"
cat > "$TASK_FILE" << EOF
# 修复任务 - $TIMESTAMP

## 问题
$PROBLEM_TYPE

## 健康检查日志
$(cat /tmp/health-check.log)

## 历史修复记录
$HISTORY

## 要求
1. 请先阅读以上历史修复记录
2. 参考历史方案进行修复
3. 修复完成后调用 record-fix.sh 记录：
   /home/ubuntu/openclaw/scripts/record-fix.sh --title "$PROBLEM_TYPE" --cause "分析日志得出" --fix "你的修复方法" --prevent "预防建议"
4. 不要把之前的修复改回去

EOF

echo "修复任务已生成：$TASK_FILE"

# 5. 触发 CC 修复
echo "[5/5] 触发 CC 修复..."

# 将任务写入待处理文件，由主进程处理
echo "$TASK_FILE" > "$PENDING_FILE"
echo "✅ 已将修复任务加入队列"
echo "请通过主进程触发 CC 修复"

# 记录本次问题
cat > "$FIX_FILE" << EOF
# 修复报告 - $TIMESTAMP

## 问题
$PROBLEM_TYPE

## 原因
待分析

## 修复方法
待执行

## 预防建议
待确定

## 状态
修复中
EOF

echo "✅ 已创建修复记录：$FIX_FILE"
