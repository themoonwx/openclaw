#!/usr/bin/env node

/**
 * Historical Data Service
 * 历史数据存储与分析服务
 *
 * 功能:
 * - 自动采集历史K线数据
 * - 数据存储到本地文件
 * - 支持回测和分析
 * - 技术指标计算
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// 配置
const CONFIG = {
  // 数据存储目录
  DATA_DIR: process.env.DATA_DIR || "/home/ubuntu/.openclaw/data/historical",

  // Yahoo Finance API
  YAHOO_BASE: "https://query1.finance.yahoo.com/v8/finance/chart",

  // 东方财富 A股
  EAST_MONEY_BASE: "https://push2.eastmoney.comock/kline",
/api/qt/st
  // 数据保留天数
  RETAIN_DAYS: 365,
};

// 确保目录存在
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 获取股票历史K线
 */
async function fetchHistoricalData(symbol, period = "1y", interval = "1d") {
  try {
    // 判断市场
    if (/^\d{6}$/.test(symbol)) {
      // A股使用东方财富
      return await fetchEastMoneyKline(symbol, period);
    } else {
      // 美股/港股使用Yahoo
      return await fetchYahooKline(symbol, period, interval);
    }
  } catch (error) {
    console.error(`获取历史数据失败 ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Yahoo Finance 获取K线
 */
async function fetchYahooKline(symbol, period, interval) {
  const rangeMap = {
    "1m": "1mo",
    "3m": "3mo",
    "6m": "6mo",
    "1y": "1y",
    "2y": "2y",
    "5y": "5y",
    "max": "max"
  };

  const response = await fetch(
    `${CONFIG.YAHOO_BASE}/${symbol}?interval=${interval}&range=${rangeMap[period] || "1y"}`
  );

  const data = await response.json();

  if (!data.chart?.result?.[0]) {
    return null;
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp;
  const quotes = result.indicators.quote[0];

  const klines = [];
  for (let i = 0; i < timestamps.length; i++) {
    klines.push({
      date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
      open: quotes.open[i],
      high: quotes.high[i],
      low: quotes.low[i],
      close: quotes.close[i],
      volume: quotes.volume[i],
    });
  }

  return klines;
}

/**
 * 东方财富获取A股K线
 */
async function fetchEastMoneyKline(symbol, period) {
  const secid = symbol.startsWith("6") ? `1.${symbol}` : `0.${symbol}`;
  const rangeMap = {
    "1m": "120",
    "3m": "240",
    "6m": "240",
    "1y": "365",
    "2y": "730",
    "5y": "1825",
  };

  const response = await fetch(
    `${CONFIG.EAST_MONEY_BASE}/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&end=20500101&lmt=${rangeMap[period] || 365}`
  );

  const data = await response.json();

  if (!data.data?.klines) {
    return null;
  }

  const klines = data.data.klines.map(kline => {
    const [date, open, close, high, low, volume, amount] = kline.split(",");
    return {
      date,
      open: parseFloat(open),
      close: parseFloat(close),
      high: parseFloat(high),
      low: parseFloat(low),
      volume: parseInt(volume),
      amount: parseFloat(amount),
    };
  });

  return klines;
}

/**
 * 保存历史数据
 */
function saveHistoricalData(symbol, klines) {
  ensureDir(CONFIG.DATA_DIR);

  const filePath = join(CONFIG.DATA_DIR, `${symbol}.json`);
  const data = {
    symbol,
    updatedAt: new Date().toISOString(),
    klines: klines || [],
  };

  writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`已保存 ${symbol} ${klines?.length || 0} 条K线数据`);
}

/**
 * 读取历史数据
 */
function loadHistoricalData(symbol) {
  const filePath = join(CONFIG.DATA_DIR, `${symbol}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (error) {
    console.error(`读取历史数据失败 ${symbol}:`, error);
    return null;
  }
}

/**
 * 计算技术指标
 */
function calculateIndicators(klines) {
  if (!klines || klines.length === 0) return null;

  const closes = klines.map(k => k.close);

  // 简单移动平均 SMA
  function sma(period) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
      }
    }
    return result;
  }

  // RSI
  function rsi(period = 14) {
    const result = [];
    let gains = 0;
    let losses = 0;

    for (let i = 0; i < closes.length; i++) {
      if (i < period) {
        result.push(null);
        continue;
      }

      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;

      if (i === period) {
        gains /= period;
        losses /= period;
      } else {
        gains = (gains * (period - 1) + Math.max(change, 0)) / period;
        losses = (losses * (period - 1) + Math.max(-change, 0)) / period;
      }

      const rs = losses === 0 ? 100 : gains / losses;
      result.push(100 - (100 / (1 + rs)));
    }
    return result;
  }

  return {
    sma5: sma(5),
    sma10: sma(10),
    sma20: sma(20),
    sma60: sma(60),
    rsi14: rsi(14),
  };
}

/**
 * 分析趋势
 */
function analyzeTrend(klines, indicators) {
  if (!klines || klines.length < 60) return null;

  const latest = klines[klines.length - 1];
  const ma20 = indicators.sma20[indicators.sma20.length - 1];
  const ma60 = indicators.sma60[indicators.sma60.length - 1];
  const rsi = indicators.rsi14[indicators.rsi14.length - 1];

  // 趋势判断
  let trend = "neutral";
  if (latest.close > ma20 && ma20 > ma60) {
    trend = "uptrend";
  } else if (latest.close < ma20 && ma20 < ma60) {
    trend = "downtrend";
  }

  // RSI 判断
  let rsiSignal = "neutral";
  if (rsi > 70) rsiSignal = "overbought";
  else if (rsi < 30) rsiSignal = "oversold";

  return {
    trend,
    trendText: {
      uptrend: "上涨趋势",
      downtrend: "下跌趋势",
      neutral: "横盘整理"
    }[trend],
    price: latest.close,
    ma20: ma20?.toFixed(2),
    ma60: ma60?.toFixed(2),
    rsi: rsi?.toFixed(2),
    rsiSignal: {
      overbought: "超买",
      oversold: "超卖",
      neutral: "中性"
    }[rsiSignal],
  };
}

/**
 * 回测策略
 */
function backtest(klines, strategy = "ma_cross") {
  if (!klines || klines.length < 100) {
    return { error: "数据不足" };
  }

  let cash = 100000; // 初始资金 10万
  let shares = 0;
  let trades = [];

  const closes = klines.map(k => k.close);

  if (strategy === "ma_cross") {
    // 简单均线交叉策略
    const indicators = calculateIndicators(klines);
    const sma20 = indicators.sma20;
    const sma60 = indicators.sma60;

    for (let i = 60; i < closes.length; i++) {
      // 金叉买入
      if (sma20[i-1] <= sma60[i-1] && sma20[i] > sma60[i] && shares === 0) {
        shares = Math.floor(cash / closes[i]);
        cash -= shares * closes[i];
        trades.push({ date: klines[i].date, action: "BUY", price: closes[i], shares });
      }
      // 死叉卖出
      else if (sma20[i-1] >= sma60[i-1] && sma20[i] < sma60[i] && shares > 0) {
        cash += shares * closes[i];
        trades.push({ date: klines[i].date, action: "SELL", price: closes[i], shares });
        shares = 0;
      }
    }

    // 最终持仓
    if (shares > 0) {
      cash += shares * closes[closes.length - 1];
    }
  }

  const totalReturn = ((cash - 100000) / 100000) * 100;
  const years = klines.length / 252;
  const annualReturn = Math.pow(cash / 100000, 1 / years) - 1;

  return {
    initialCash: 100000,
    finalCash: cash,
    totalReturn: totalReturn.toFixed(2) + "%",
    annualReturn: (annualReturn * 100).toFixed(2) + "%",
    totalTrades: trades.length,
    trades: trades.slice(-10), // 最近10笔
  };
}

/**
 * 主函数
 */
async function main(command, symbol, period = "1y") {
  console.log(`Historical Data Service: ${command} ${symbol}`);

  try {
    if (command === "fetch") {
      // 获取并保存
      const klines = await fetchHistoricalData(symbol, period);
      if (klines) {
        saveHistoricalData(symbol, klines);
        console.log(`获取 ${symbol} ${klines.length} 条K线`);
      }
    } else if (command === "load") {
      // 读取本地
      const data = loadHistoricalData(symbol);
      if (data) {
        console.log(`已加载 ${symbol} ${data.klines.length} 条K线`);
        return data;
      }
    } else if (command === "analyze") {
      // 分析
      let data = loadHistoricalData(symbol);
      if (!data) {
        const klines = await fetchHistoricalData(symbol, period);
        if (klines) {
          saveHistoricalData(symbol, klines);
          data = { klines };
        }
      }

      if (data?.klines) {
        const indicators = calculateIndicators(data.klines);
        const trend = analyzeTrend(data.klines, indicators);

        return { indicators, trend };
      }
    } else if (command === "backtest") {
      // 回测
      let data = loadHistoricalData(symbol);
      if (!data) {
        const klines = await fetchHistoricalData(symbol, "2y");
        if (klines) {
          saveHistoricalData(symbol, klines);
          data = { klines };
        }
      }

      if (data?.klines) {
        return backtest(data.klines);
      }
    }
  } catch (error) {
    console.error("操作失败:", error);
    throw error;
  }
}

// 导出
export {
  fetchHistoricalData,
  saveHistoricalData,
  loadHistoricalData,
  calculateIndicators,
  analyzeTrend,
  backtest
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] || "fetch";
  const symbol = process.argv[3] || "000001.SS";
  const period = process.argv[4] || "1y";
  main(command, symbol, period).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error);
}
