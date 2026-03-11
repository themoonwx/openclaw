#!/usr/bin/env node

/**
 * Market Data Service
 * 市场数据服务 - 集成多个数据源
 * 
 * 支持:
 * - Alpha Vantage (免费 API)
 * - Yahoo Finance
 * - 东方财富 (A股)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// 配置
const CONFIG = {
  // Alpha Vantage API (免费版: 25次/天)
  ALPHA_VANTAGE_API_KEY: process.env.ALPHA_VANTAGE_API_KEY || "demo",
  ALPHA_VANTAGE_BASE: "https://www.alphavantage.co/query",
  
  // Yahoo Finance (无需 API Key)
  YAHOO_FINANCE_BASE: "https://query1.finance.yahoo.com/v8/finance",
  
  // 东方财富 (A股)
  EAST_MONEY_BASE: "https://push2.eastmoney.com",
  
  // 缓存配置
  CACHE_TTL: 5 * 60 * 1000, // 5分钟
};

// 缓存
const cache = new Map();

/**
 * 获取缓存
 */
function getCache(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * 设置缓存
 */
function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Yahoo Finance 获取股票/指数数据
 */
export async function getYahooQuote(symbol) {
  const cacheKey = `yahoo_quote_${symbol}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  
  try {
    const response = await fetch(
      `${CONFIG.YAHOO_FINANCE_BASE}/chart/${symbol}?interval=1d&range=5d&fields=frequency,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,regularMarketOpen,regularMarketPreviousClose`
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.chart?.result?.[0]) {
      return null;
    }
    
    const result = data.chart.result[0];
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    
    const quoteData = {
      symbol: meta.symbol,
      name: meta.shortName || meta.longName || meta.symbol,
      price: meta.regularMarketPrice,
      change: meta.regularMarketChange,
      changePercent: meta.regularMarketChangePercent,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      open: meta.regularMarketOpen,
      previousClose: meta.chartPreviousClose || meta.previousClose,
      currency: meta.currency || "USD",
      marketState: meta.marketState || "CLOSED",
      timestamp: Date.now(),
    };
    
    setCache(cacheKey, quoteData);
    return quoteData;
  } catch (error) {
    console.error(`Yahoo Finance Error (${symbol}):`, error.message);
    return null;
  }
}

/**
 * Yahoo Finance 批量获取
 */
export async function getYahooQuotes(symbols) {
  const results = await Promise.all(
    symbols.map(s => getYahooQuote(s))
  );
  return results.filter(r => r !== null);
}

/**
 * Alpha Vantage 获取股票数据
 */
export async function getAlphaVantageQuote(symbol, functionType = "GLOBAL_QUOTE") {
  const cacheKey = `av_${functionType}_${symbol}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  
  try {
    const params = new URLSearchParams({
      function: functionType,
      symbol: symbol,
      apikey: CONFIG.ALPHA_VANTAGE_API_KEY,
    });
    
    const response = await fetch(`${CONFIG.ALPHA_VANTAGE_BASE}?${params}`);
    const data = await response.json();
    
    if (data["Error Message"]) {
      console.error(`Alpha Vantage Error: ${data["Error Message"]}`);
      return null;
    }
    
    if (data["Note"]) {
      console.warn("Alpha Vantage API 限制:", data["Note"]);
      return null;
    }
    
    let quoteData = null;
    
    if (functionType === "GLOBAL_QUOTE" && data["Global Quote"]) {
      const q = data["Global Quote"];
      quoteData = {
        symbol: q["01. symbol"],
        price: parseFloat(q["05. price"]),
        change: parseFloat(q["09. change"]),
        changePercent: parseFloat(q["10. change percent"]?.replace("%", "")),
        volume: parseInt(q["06. volume"]),
        open: parseFloat(q["02. open"]),
        high: parseFloat(q["03. high"]),
        low: parseFloat(q["04. low"]),
        previousClose: parseFloat(q["08. previous close"]),
      };
    }
    
    if (quoteData) {
      setCache(cacheKey, quoteData);
    }
    
    return quoteData;
  } catch (error) {
    console.error(`Alpha Vantage Error (${symbol}):`, error.message);
    return null;
  }
}

/**
 * 东方财富获取 A 股数据
 */
export async function getEastMoneyQuote(symbol) {
  const cacheKey = `em_quote_${symbol}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;
  
  try {
    const response = await fetch(
      `${CONFIG.EAST_MONEY_BASE}/api/qt/stock/get?secid=${symbol.startsWith("6") ? "1." : "0."}${symbol}&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f59,f60,f116,f117,f162,f163,f164,f167,f168,f169,f170,f171,f173,f177,f187,f188,f189,f190,f191,f192,f193,f197,f198,f199,f200,f201,f202,f203`
    );
    
    const data = await response.json();
    
    if (!data.data) {
      return null;
    }
    
    const d = data.data;
    const quoteData = {
      symbol: d.f57,
      name: d.f58,
      price: d.f43 / 1000,
      change: d.f46 / 1000,
      changePercent: d.f47 / 1000,
      volume: d.f45,
      amount: d.f44,
      open: d.f50 / 1000,
      high: d.f51 / 1000,
      low: d.f52 / 1000,
      previousClose: d.f60 / 1000,
      pe: d.f162 / 1000,
      pb: d.f167 / 1000,
      roe: d.f168 / 100,
      marketCap: d.f116 / 100000000,
      timestamp: Date.now(),
    };
    
    setCache(cacheKey, quoteData);
    return quoteData;
  } catch (error) {
    console.error(`East Money Error (${symbol}):`, error.message);
    return null;
  }
}

/**
 * 东方财富批量获取
 */
export async function getEastMoneyQuotes(symbols) {
  // 东方财富支持批量查询，这里简化处理
  const results = await Promise.all(
    symbols.map(s => getEastMoneyQuote(s))
  );
  return results.filter(r => r !== null);
}

/**
 * 统一接口: 获取股票数据
 * 自动识别市场和数据源
 */
export async function getQuote(symbol) {
  // 识别市场
  if (/^\d{6}$/.test(symbol)) {
    // A 股
    return getEastMoneyQuote(symbol);
  } else if (/^[A-Z]/.test(symbol)) {
    // 美股/港股
    return getYahooQuote(symbol);
  } else {
    // 默认为 Yahoo Finance
    return getYahooQuote(symbol);
  }
}

/**
 * 获取市场概览
 */
export async function getMarketOverview() {
  const symbols = {
    // A股
    "000001.SS": "上证指数",
    "399001.SZ": "深证成指",
    "399006.SZ": "创业板指",
    // 港股
    "^HSI": "恒生指数",
    // 美股
    "^DJI": "道琼斯",
    "^IXIC": "纳斯达克",
    "^GSPC": "标普500",
  };
  
  const quotes = await getYahooQuotes(Object.keys(symbols));
  
  const overview = {};
  for (const quote of quotes) {
    overview[symbols[quote.symbol]] = quote;
  }
  
  return overview;
}

/**
 * 清除缓存
 */
export function clearCache() {
  cache.clear();
}

/**
 * 主函数 (CLI)
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "quote";
  
  if (command === "quote") {
    const symbol = args[1] || "000001.SS";
    const quote = await getQuote(symbol);
    console.log(JSON.stringify(quote, null, 2));
  } else if (command === "overview") {
    const overview = await getMarketOverview();
    console.log(JSON.stringify(overview, null, 2));
  } else if (command === "cache:clear") {
    clearCache();
    console.log("Cache cleared");
  }
}

// 导出所有函数
export default {
  getQuote,
  getYahooQuote,
  getYahooQuotes,
  getAlphaVantageQuote,
  getEastMoneyQuote,
  getEastMoneyQuotes,
  getMarketOverview,
  clearCache,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
