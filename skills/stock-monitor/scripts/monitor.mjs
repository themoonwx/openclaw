#!/usr/bin/env node

/**
 * Stock Monitor
 * 个股监控工具
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// 监控数据存储路径
const DATA_DIR = process.env.DATA_DIR || "/home/ubuntu/.openclaw/data";
const WATCHLIST_FILE = join(DATA_DIR, "stock-watchlist.json");
const ALERTS_FILE = join(DATA_DIR, "stock-alerts.json");

/**
 * 加载自选股列表
 */
function loadWatchlist() {
  try {
    if (existsSync(WATCHLIST_FILE)) {
      return JSON.parse(readFileSync(WATCHLIST_FILE, "utf-8"));
    }
  } catch (error) {
    console.error("加载自选股失败:", error);
  }
  return [];
}

/**
 * 保存自选股列表
 */
function saveWatchlist(watchlist) {
  try {
    writeFileSync(WATCHLIST_FILE, JSON.stringify(watchlist, null, 2));
  } catch (error) {
    console.error("保存自选股失败:", error);
  }
}

/**
 * 加载告警记录
 */
function loadAlerts() {
  try {
    if (existsSync(ALERTS_FILE)) {
      return JSON.parse(readFileSync(ALERTS_FILE, "utf-8"));
    }
  } catch (error) {
    console.error("加载告警记录失败:", error);
  }
  return [];
}

/**
 * 添加自选股
 */
function addWatch(symbol, name, alerts = {}) {
  const watchlist = loadWatchlist();
  
  // 检查是否已存在
  const existing = watchlist.find(w => w.symbol === symbol);
  if (existing) {
    return { success: false, message: "股票已存在" };
  }
  
  watchlist.push({
    symbol,
    name,
    alerts,
    addedAt: new Date().toISOString(),
  });
  
  saveWatchlist(watchlist);
  return { success: true, message: `已添加 ${name} 到自选` };
}

/**
 * 移除自选股
 */
function removeWatch(symbol) {
  const watchlist = loadWatchlist();
  const index = watchlist.findIndex(w => w.symbol === symbol);
  
  if (index === -1) {
    return { success: false, message: "股票不存在" };
  }
  
  watchlist.splice(index, 1);
  saveWatchlist(watchlist);
  return { success: true, message: "已移除自选" };
}

/**
 * 获取股票实时数据
 */
async function getQuote(symbol) {
  try {
    // 使用 Yahoo Finance API
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d`
    );
    const data = await response.json();
    
    if (!data.chart?.result?.[0]) {
      return null;
    }
    
    const result = data.chart.result[0];
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    
    return {
      symbol: meta.symbol,
      name: meta.shortName || meta.symbol,
      price: meta.regularMarketPrice,
      change: meta.regularMarketChange,
      changePercent: meta.regularMarketChangePercent,
      volume: meta.regularMarketVolume,
      previousClose: meta.chartPreviousClose,
    };
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error.message);
    return null;
  }
}

/**
 * 批量获取自选股数据
 */
async function getWatchlistQuotes() {
  const watchlist = loadWatchlist();
  const symbols = watchlist.map(w => w.symbol);
  
  const quotes = await Promise.all(
    symbols.map(s => getQuote(s))
  );
  
  return quotes.filter(q => q !== null);
}

/**
 * 检查告警
 */
function checkAlerts(quotes, watchlist) {
  const alerts = [];
  
  for (const quote of quotes) {
    const watch = watchlist.find(w => w.symbol === quote.symbol);
    if (!watch?.alerts) continue;
    
    const { priceChange, volumeChange, priceAbove, priceBelow } = watch.alerts;
    
    // 检查涨跌幅告警
    if (priceChange && Math.abs(quote.changePercent || 0) >= priceChange) {
      alerts.push({
        symbol: quote.symbol,
        name: quote.name,
        type: "price_change",
        value: quote.changePercent,
        threshold: priceChange,
        message: `${quote.name} 涨跌幅 ${quote.changePercent?.toFixed(2)}% (阈值 ${priceChange}%)`,
      });
    }
    
    // 检查价格突破告警
    if (priceAbove && quote.price >= priceAbove) {
      alerts.push({
        symbol: quote.symbol,
        name: quote.name,
        type: "price_above",
        value: quote.price,
        threshold: priceAbove,
        message: `${quote.name} 突破 ${priceAbove} 元 (现价 ${quote.price})`,
      });
    }
    
    if (priceBelow && quote.price <= priceBelow) {
      alerts.push({
        symbol: quote.symbol,
        name: quote.name,
        type: "price_below",
        value: quote.price,
        threshold: priceBelow,
        message: `${quote.name} 跌破 ${priceBelow} 元 (现价 ${quote.price})`,
      });
    }
  }
  
  return alerts;
}

/**
 * 生成监控报告
 */
function generateMonitorReport(quotes, watchlist) {
  let report = "# 📊 自选股监控\n\n";
  
  if (watchlist.length === 0) {
    report += "*暂无自选股，请添加关注*\n";
    return report;
  }
  
  // 自选股列表
  report += "## 👀 关注列表\n\n";
  report += "| 代码 | 名称 | 现价 | 涨跌幅 | 状态 |\n";
  report += "|------|------|------|--------|------|\n";
  
  for (const watch of watchlist) {
    const quote = quotes.find(q => q.symbol === watch.symbol);
    if (!quote) continue;
    
    const changeSign = (quote.changePercent || 0) >= 0 ? "+" : "";
    const status = quote.changePercent >= 5 ? "🔥" : quote.changePercent <= -5 ? "⚠️" : "✅";
    
    report += `| ${quote.symbol} | ${quote.name} | ${quote.price?.toFixed(2)} | ${changeSign}${quote.changePercent?.toFixed(2)}% | ${status} |\n`;
  }
  
  // 检查告警
  const alerts = checkAlerts(quotes, watchlist);
  
  if (alerts.length > 0) {
    report += "\n## ⚠️ 触发告警\n\n";
    
    for (const alert of alerts) {
      const icon = alert.type === "price_change" ? "📈" : alert.type === "price_above" ? "🔼" : "🔽";
      report += `- ${icon} ${alert.message}\n`;
    }
  }
  
  return report;
}

/**
 * 主函数
 */
async function main(action, params) {
  console.log("🔔 Stock Monitor 启动...");
  
  try {
    if (action === "add") {
      const { symbol, name, ...alerts } = params;
      return addWatch(symbol, name, alerts);
    } else if (action === "remove") {
      return removeWatch(params.symbol);
    } else if (action === "list") {
      const watchlist = loadWatchlist();
      const quotes = await getWatchlistQuotes();
      return generateMonitorReport(quotes, watchlist);
    } else if (action === "check") {
      const watchlist = loadWatchlist();
      const quotes = await getWatchlistQuotes();
      return checkAlerts(quotes, watchlist);
    }
  } catch (error) {
    console.error("❌ 操作失败:", error);
    throw error;
  }
}

// 导出
export { main, addWatch, removeWatch, getWatchlistQuotes, checkAlerts };

if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2] || "list";
  main(action, {}).then(console.log).catch(console.error);
}
