#!/bin/bash
# 修复记录脚本 - 记录问题修复到 memorygraph
# 用法: record-fix.sh --title "问题描述" --cause "原因" --fix "修复方法" --prevent "预防建议"

set -e

# 默认值
TITLE=""
CAUSE=""
FIX=""
PREVENT=""

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --title)
      TITLE="$2"
      shift 2
      ;;
    --cause)
      CAUSE="$2"
      shift 2
      ;;
    --fix)
      FIX="$2"
      shift 2
      ;;
    --prevent)
      PREVENT="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

# 验证必要参数
if [[ -z "$TITLE" ]]; then
  echo "错误: --title 是必填参数"
  exit 1
fi

# 生成文件名
DATE=$(date +%Y-%m-%d)
# 从标题生成简短标识
SLUG=$(echo "$TITLE" | head -c 30 | tr ' ' '-' | tr -dc 'a-zA-Z0-9-')
FILENAME="${DATE}_${SLUG}_fix.md"
OUTPUT_DIR="/home/ubuntu/openclaw/logs/fixes"
OUTPUT_FILE="${OUTPUT_DIR}/${FILENAME}"

# 创建记录内容
CONTENT="# 修复记录

- **日期**: $(date '+%Y-%m-%d %H:%M:%S')
- **问题**: ${TITLE}
- **原因**: ${CAUSE}
- **修复方法**: ${FIX}
- **预防建议**: ${PREVENT}

---

## 详细记录

### 问题描述
${TITLE}

### 原因分析
${CAUSE}

### 修复措施
${FIX}

### 预防建议
${PREVENT}
"

# 写入文件
echo "$CONTENT" > "$OUTPUT_FILE"

echo "✅ 修复记录已保存: ${OUTPUT_FILE}"
echo "📝 标题: ${TITLE}"
