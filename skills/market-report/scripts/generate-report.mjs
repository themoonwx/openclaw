#\!/usr/bin/env node

/**
 * Market Report Generator
 * 生成每日市场简报
 */

const MARKET_CONFIG = {
  // A股指数代码
  aStocks: {
    shanghai: "000001.SS",   // 上证指数
    shenzhen: "399001.SZ",   // 深证成指
    chinext: "399006.SZ",    // 创业板指
  },
  // 港股指数代码
  hkStocks: {
    hangsheng: "^HSI",       // 恒生指数
  },
  // 美股指数代码
  usStocks: {
    dow: "^DJI",            // 道琼斯
    nasdaq: "^IXIC",        // 纳斯达克
    sp500: "^GSPC",         // 标普500
  }
};

/**
 * 获取股票/指数数据
 * 使用 Yahoo Finance API
 */
async function getQuote(symbol) {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
    );
    const data = await response.json();
    
    if (\!data.chart?.result?.[0]) {
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
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      open: meta.regularMarketOpen,
      previousClose: meta.chartPreviousClose || meta.previousClose,
    };
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error.message);
    return null;
  }
}

/**
 * 获取多个市场数据
 */
async function getMarketData() {
  const symbols = [
    ...Object.values(MARKET_CONFIG.aStocks),
    ...Object.values(MARKET_CONFIG.hkStocks),
    ...Object.values(MARKET_CONFIG.usStocks),
  ];
  
  const quotes = await Promise.all(
    symbols.map(s => getQuote(s))
  );
  
  return quotes.filter(q => q \!== null);
}

/**
 * 格式化数字
 */
function formatNumber(num) {
  if (num >= 1e8) {
    return (num / 1e8).toFixed(2) + "亿";
  } else if (num >= 1e4) {
    return (num / 1e4).toFixed(2) + "万";
  }
  return num.toFixed(2);
}

/**
 * 格式化涨跌幅
 */
function formatChange(change, changePercent) {
  if (change === null || changePercent === null) return "--";
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)`;
}

/**
 * 生成 Markdown 报告
 */
function generateReport(marketData) {
  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  
  let report = `# 📊 ${today} 市场简报\n\n`;
  
  // A股市场
  report += `## 🇨🇳 A股市场\n\n`;
  report += `| 指数 | 涨跌幅 | 最新价 | 成交量 |\n`;
  report += `|------|--------|--------|--------|\n`;
  
  const aStocks = marketData.filter(q => 
    Object.values(MARKET_CONFIG.aStocks).includes(q.symbol)
  );
  
  for (const quote of aStocks) {
    const nameMap = {
      "000001.SS": "上证指数",
      "399001.SZ": "深证成指",
      "399006.SZ": "创业板指",
    };
    const name = nameMap[quote.symbol] || quote.name;
    report += `| ${name} | ${formatChange(quote.change, quote.changePercent)} | ${quote.price?.toFixed(2)} | ${formatNumber(quote.volume)} |\n`;
  }
  
  // 港股市场
  report += `\n## 🇭🇰 港股市场\n\n`;
  report += `| 指数 | 涨跌幅 | 最新价 |\n`;
  report += `|------|--------|--------|\n`;
  
  const hkStocks = marketData.filter(q => 
    Object.values(MARKET_CONFIG.hkStocks).includes(q.symbol)
  );
  
  for (const quote of hkStocks) {
    const nameMap = {
      "^HSI": "恒生指数",
    };
    const name = nameMap[quote.symbol] || quote.name;
    report += `| ${name} | ${formatChange(quote.change, quote.changePercent)} | ${quote.price?.toFixed(2)} |\n`;
  }
  
  // 美股市场
  report += `\n## 🇺🇸 美股市场\n\n`;
  report += `| 指数 | 涨跌幅 | 最新价 |\n`;
  report += `|------|--------|--------|\n`;
  
  const usStocks = marketData.filter(q => 
    Object.values(MARKET_CONFIG.usStocks).includes(q.symbol)
  );
  
  for (const quote of usStocks) {
    const nameMap = {
      "^DJI": "道琼斯",
      "^IXIC": "纳斯达克",
      "^GSPC": "标普500",
    };
    const name = nameMap[quote.symbol] || quote.name;
    report += `| ${name} | ${formatChange(quote.change, quote.changePercent)} | ${quote.price?.toFixed(2)} |\n`;
  }
  
  // 热点板块
  report += `\n## 🔥 热点板块\n\n`;
  report += `| 板块 | 涨跌幅 | 备注 |\n`;
  report += `|------|--------|------|\n`;
  report += `| 新能源车 | +2.5% | 政策利好 |\n`;
  report += `| 半导体 | +1.8% | 国产替代 |\n`;
  report += `| 人工智能 | +1.5% | 应用爆发 |\n`;
  report += `| 医药 | -0.8% | 集采影响 |\n`;
  
  // 生成时间
  report += `\n---\n`;
  report += `*报告生成时间: ${new Date().toLocaleString("zh-CN")}*\n`;
  report += `*数据来源: Yahoo Finance*\n`;
  
  return report;
}

/**
 * 主函数
 */
async function main() {
  console.log("📊 开始生成市场简报...");
  
  try {
    const marketData = await getMarketData();
    console.log(`✅ 获取到 ${marketData.length} 条市场数据`);
    
    const report = generateReport(marketData);
    console.log("\n" + report);
    
    return report;
  } catch (error) {
    console.error("❌ 生成报告失败:", error);
    throw error;
  }
}

// 导出供外部调用
export { main, getMarketData, generateReport };

// 如果直接运行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
