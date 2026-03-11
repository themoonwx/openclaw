#\!/usr/bin/env node

/**
 * Portfolio Analyzer
 * 投资组合分析工具
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// 数据存储路径
const DATA_DIR = process.env.DATA_DIR || "/home/ubuntu/.openclaw/data";
const PORTFOLIO_FILE = join(DATA_DIR, "portfolio.json");

/**
 * 加载持仓数据
 */
function loadPortfolio() {
  try {
    if (existsSync(PORTFOLIO_FILE)) {
      return JSON.parse(readFileSync(PORTFOLIO_FILE, "utf-8"));
    }
  } catch (error) {
    console.error("加载持仓失败:", error);
  }
  return { positions: [], transactions: [] };
}

/**
 * 保存持仓数据
 */
function savePortfolio(portfolio) {
  try {
    writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
  } catch (error) {
    console.error("保存持仓失败:", error);
  }
}

/**
 * 获取股票现价
 */
async function getQuote(symbol) {
  try {
    // A股使用东方财富
    const response = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${symbol.startsWith("6") ? "1." : "0."}${symbol}&fields=f43,f57,f58`
    );
    const data = await response.json();
    
    if (data.data) {
      return {
        symbol: data.data.f57,
        name: data.data.f58,
        price: data.data.f43 / 1000,
      };
    }
  } catch (error) {
    console.error(`获取行情失败 ${symbol}:`, error.message);
  }
  return null;
}

/**
 * 添加持仓
 */
function addPosition(symbol, name, shares, costPrice) {
  const portfolio = loadPortfolio();
  
  // 检查是否已存在
  const existing = portfolio.positions.find(p => p.symbol === symbol);
  if (existing) {
    return { success: false, message: "股票已存在，请使用更新" };
  }
  
  portfolio.positions.push({
    symbol,
    name,
    shares: parseInt(shares),
    costPrice: parseFloat(costPrice),
    cost: parseFloat(costPrice) * parseInt(shares),
    addedAt: new Date().toISOString(),
  });
  
  savePortfolio(portfolio);
  return { success: true, message: `已添加 ${name} ${shares}股` };
}

/**
 * 更新持仓
 */
function updatePosition(symbol, shares, costPrice = null) {
  const portfolio = loadPortfolio();
  
  const position = portfolio.positions.find(p => p.symbol === symbol);
  if (\!position) {
    return { success: false, message: "股票不存在" };
  }
  
  if (shares) position.shares = parseInt(shares);
  if (costPrice) {
    position.costPrice = parseFloat(costPrice);
    position.cost = position.shares * position.costPrice;
  }
  
  savePortfolio(portfolio);
  return { success: true, message: "持仓已更新" };
}

/**
 * 删除持仓
 */
function removePosition(symbol) {
  const portfolio = loadPortfolio();
  
  const index = portfolio.positions.findIndex(p => p.symbol === symbol);
  if (index === -1) {
    return { success: false, message: "股票不存在" };
  }
  
  portfolio.positions.splice(index, 1);
  savePortfolio(portfolio);
  return { success: true, message: "持仓已删除" };
}

/**
 * 计算组合收益
 */
async function calculatePerformance(portfolio) {
  const symbols = portfolio.positions.map(p => p.symbol);
  const quotes = await Promise.all(symbols.map(s => getQuote(s)));
  
  let totalMarketValue = 0;
  let totalCost = 0;
  const positions = [];
  
  for (const position of portfolio.positions) {
    const quote = quotes.find(q => q?.symbol === position.symbol);
    const currentPrice = quote?.price || position.costPrice;
    const marketValue = currentPrice * position.shares;
    const profit = marketValue - position.cost;
    const profitPercent = (profit / position.cost) * 100;
    
    totalMarketValue += marketValue;
    totalCost += position.cost;
    
    positions.push({
      ...position,
      currentPrice,
      marketValue,
      profit,
      profitPercent,
    });
  }
  
  const totalProfit = totalMarketValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
  
  return {
    positions,
    totalMarketValue,
    totalCost,
    totalProfit,
    totalProfitPercent,
  };
}

/**
 * 生成组合报告
 */
async function generatePortfolioReport(action, params) {
  const portfolio = loadPortfolio();
  
  if (action === "add") {
    return addPosition(params.symbol, params.name, params.shares, params.costPrice);
  } else if (action === "update") {
    return updatePosition(params.symbol, params.shares, params.costPrice);
  } else if (action === "remove") {
    return removePosition(params.symbol);
  } else if (action === "list" || action === "view") {
    const performance = await calculatePerformance(portfolio);
    
    let report = "# 📊 投资组合\n\n";
    
    // 概览
    report += "## 概览\n\n";
    report += `| 指标 | 值 |\n`;
    report += `|------|-----|\n`;
    report += `| 总市值 | ${(performance.totalMarketValue / 10000).toFixed(2)}万 |\n`;
    report += `| 总成本 | ${(performance.totalCost / 10000).toFixed(2)}万 |\n`;
    report += `| 总盈亏 | ${(performance.totalProfit / 10000).toFixed(2)}万 |\n`;
    report += `| 收益率 | ${performance.totalProfitPercent >= 0 ? "+" : ""}${performance.totalProfitPercent.toFixed(2)}% |\n`;
    report += `| 持仓数 | ${portfolio.positions.length}只 |\n\n`;
    
    // 持仓明细
    if (performance.positions.length > 0) {
      report += "## 持仓明细\n\n";
      report += "| 股票 | 数量 | 成本价 | 现价 | 盈亏 | 收益率 |\n";
      report += "|------|------|--------|------|------|--------|\n";
      
      for (const p of performance.positions) {
        const profitSign = p.profit >= 0 ? "+" : "";
        report += `| ${p.name} | ${p.shares} | ${p.costPrice.toFixed(2)} | ${p.currentPrice.toFixed(2)} | ${profitSign}${(p.profit/10000).toFixed(2)}万 | ${profitSign}${p.profitPercent.toFixed(2)}% |\n`;
      }
    }
    
    report += `\n---\n`;
    report += `*更新时间: ${new Date().toLocaleString("zh-CN")}*\n`;
    
    return report;
  }
  
  return { message: "未知操作" };
}

/**
 * 主函数
 */
async function main(action, params) {
  console.log("📈 Portfolio Analyzer 启动...");
  
  try {
    return await generatePortfolioReport(action, params);
  } catch (error) {
    console.error("❌ 操作失败:", error);
    throw error;
  }
}

// 导出
export { main, addPosition, updatePosition, removePosition, calculatePerformance };

if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2] || "list";
  main(action, {
    symbol: process.argv[3],
    name: process.argv[4],
    shares: process.argv[5],
    costPrice: process.argv[6],
  }).then(console.log).catch(console.error);
}
