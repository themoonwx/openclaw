---
name: market-report
description: >-
  每日市场简报生成。生成 A 股、港股、美股市场的开盘概况、板块表现、
  热点个股、重大新闻等信息。支持定时自动生成和手动触发。
trigger:
  - keywords: ["市场简报", "daily report", "早报", "盘前", "收盘"]
  - cron: "0 8 * * *"
output:
  format: markdown
  sections: 
    - overview      # 整体市场概况
    - indices       # 主要指数表现
    - sectors       # 板块涨跌
    - hot-stocks    # 热点个股
    - news          # 重大新闻
    - events        # 即将到来的事件
tools:
  - exec
  - read
risk_level: low
freshness: 1h
---

# Market Report - 每日市场简报

## 功能概述

生成每日市场简报，提供市场概况、指数表现、板块涨跌、热点个股和重大新闻。

## 支持市场

- A 股 (上海、深圳)
- 港股 (恒生指数)
- 美股 (道琼斯、纳斯达克、标普500)

## 输出格式

### 整体市场概况 (overview)

```
📊 2026-03-11 市场概况

A股: 震荡上行，成交量 1.2万亿
港股: 恒生指数 +1.2%
美股: 三大指数涨跌不一
```

### 主要指数 (indices)

| 指数 | 涨跌幅 | 最新价 |
|------|--------|--------|
| 上证指数 | +0.5% | 3421.56 |
| 深证成指 | +0.8% | 11567.89 |
| 创业板指 | +1.2% | 2345.67 |
| 恒生指数 | +1.2% | 18234.56 |

### 板块涨跌 (sectors)

| 板块 | 涨跌幅 | 领涨个股 |
|------|--------|----------|
| 新能源车 | +3.2% | 比亚迪 +5.1% |
| 半导体 | +2.1% | 中芯国际 +3.5% |
| 医药 | -1.2% | 恒瑞医药 -2.3% |

### 热点个股 (hot-stocks)

```
🔥 今日热点
1. 比亚迪 (+5.1%) - 新能源车销量大增
2. 宁德时代 (+4.2%) - 电池技术突破
3. 贵州茅台 (+2.1%) - 业绩预增
```

### 重大新闻 (news)

```
📰 重要新闻
1. 央行：保持流动性合理充裕
2. 工信部：推动新能源汽车高质量发展
3. 美联储：维持利率不变
```

## 使用方法

### 手动触发

```
@market 生成今日市场简报
@market 昨日市场总结
```

### 自动生成

配置 cron 定时任务，每日早8点自动生成：

```bash
# cron 配置
0 8 * * * curl -X POST http://localhost:18789/agents/market/skill/market-report
```

## 数据来源

- A 股: 东方财富、同花顺
- 港股: 东方财富港股
- 美股: Alpha Vantage / Yahoo Finance

## 注意事项

1. 简报生成时间约 30-60 秒
2. 历史简报保存在 workspace-market-report/
3. 如需实时数据，可使用 stock-monitor skill

## 相关 Skills

- `stock-monitor`: 实时监控个股
- `news-intelligence`: 新闻情报
- `stock-screener`: 股票筛选
