#!/usr/bin/env node

/**
 * Stock Screener
 * 股票筛选工具
 */

/**
 * 筛选参数定义
 */
const SCREEN_PARAMS = {
  // 市值 (亿元)
  marketCap: { min: null, max: null },
  // 市盈率 PE
  pe: { min: null, max: null },
  // 市净率 PB
  pb: { min: null, max: null },
  // 净资产收益率 ROE (%)
  roe: { min: null, max: null },
  // 毛利率 (%)
  grossMargin: { min: null, max: null },
  // 净利润增速 (%)
  netProfitGrowth: { min: null, max: null },
  // 涨跌幅 (%)
  change: { min: null, max: null },
  // 成交量 (万元)
  volume: { min: null, max: null },
  // 换手率 (%)
  turnover: { min: null, max: null },
  // 股价 (元)
  price: { min: null, max: null },
  // 行业
  industry: null,
  // 概念
  concept: null,
};

/**
 * 解析筛选条件
 */
function parseCriteria(criteriaStr) {
  const params = { ...SCREEN_PARAMS };
  
  // 解析市值
  const marketCapMatch = criteriaStr.match(/市值[>]?[<]?(\d+)/);
  if (marketCapMatch) {
    if (criteriaStr.includes(">")) {
      params.marketCap.min = parseFloat(marketCapMatch[1]);
    } else if (criteriaStr.includes("<")) {
      params.marketCap.max = parseFloat(marketCapMatch[1]);
    }
  }
  
  // 解析 PE
  const peMatch = criteriaStr.match(/PE[>]?[<]?(\d+)/i);
  if (peMatch) {
    if (criteriaStr.includes(">")) {
      params.pe.min = parseFloat(peMatch[1]);
    } else if (criteriaStr.includes("<")) {
      params.pe.max = parseFloat(peMatch[1]);
    }
  }
  
  // 解析 ROE
  const roeMatch = criteriaStr.match(/ROE[>]?[<]?(\d+)/i);
  if (roeMatch) {
    if (criteriaStr.includes(">")) {
      params.roe.min = parseFloat(roeMatch[1]);
    } else if (criteriaStr.includes("<")) {
      params.roe.max = parseFloat(roeMatch[1]);
    }
  }
  
  // 解析股价
  const priceMatch = criteriaStr.match(/股价[>]?[<]?(\d+)/);
  if (priceMatch) {
    if (criteriaStr.includes(">")) {
      params.price.min = parseFloat(priceMatch[1]);
    } else if (criteriaStr.includes("<")) {
      params.price.max = parseFloat(priceMatch[1]);
    }
  }
  
  return params;
}

/**
 * 获取股票数据
 * 使用东方财富 API
 */
async function getStockData(symbols) {
  const results = [];
  
  for (const symbol of symbols) {
    try {
      // 尝试获取数据
      const response = await fetch(
        `https://push2.eastmoney.com/api/qt/stock/get?fid=f58&po=1&pz=50000&pn=1&fields=f57,f58,f43,f44,f45,f46,f47,f48,f50,f51,f52,f116,f117,f162,f167,f168,f169,f170,f171,f173,f177,f187,f188,f189,f190,f191,f192,f193,f194,f197,f198,f199,f200,f201,f202,f203,f204,f205,f206,f207,f208,f209,f210,f211,f212,f213,f214,f215,f218`
      );
      const data = await response.json();
      
      if (data.data?.f58) {
        results.push({
          symbol: data.data.f57,
          name: data.data.f58,
          price: data.data.f43 / 1000,
          change: data.data.f46 / 1000,
          changePercent: data.data.f47 / 1000,
          volume: data.data.f45,
          amount: data.data.f44,
          pe: data.data.f162 / 1000,
          pb: data.data.f167 / 1000,
          roe: data.data.f168 / 100,
          marketCap: data.data.f116 / 100000000,
        });
      }
    } catch (error) {
      console.error(`Error fetching ${symbol}:`, error.message);
    }
  }
  
  return results;
}

/**
 * 筛选股票
 */
function screenStocks(stocks, params) {
  return stocks.filter(stock => {
    if (params.marketCap.min && stock.marketCap < params.marketCap.min) return false;
    if (params.marketCap.max && stock.marketCap > params.marketCap.max) return false;
    if (params.pe.min && stock.pe < params.pe.min) return false;
    if (params.pe.max && stock.pe > params.pe.max) return false;
    if (params.roe.min && stock.roe < params.roe.min) return false;
    if (params.roe.max && stock.roe > params.roe.max) return false;
    if (params.price.min && stock.price < params.price.min) return false;
    if (params.price.max && stock.price > params.price.max) return false;
    return true;
  });
}

/**
 * 生成筛选报告
 */
function generateScreenReport(criteria, results) {
  let report = "# 📊 股票筛选结果\n\n";
  
  // 筛选条件
  report += "## 筛选条件\n\n";
  report += "| 条件 | 值 |\n";
  report += "|------|---|\n";
  
  if (criteria.marketCap.min) report += `| 市值 > | ${criteria.marketCap.min}亿 |\n`;
  if (criteria.marketCap.max) report += `| 市值 < | ${criteria.marketCap.max}亿 |\n`;
  if (criteria.pe.min) report += `| PE > | ${criteria.pe.min} |\n`;
  if (criteria.pe.max) report += `| PE < | ${criteria.pe.max} |\n`;
  if (criteria.roe.min) report += `| ROE > | ${criteria.roe.min}% |\n`;
  if (criteria.roe.max) report += `| ROE < | ${criteria.roe.max}% |\n`;
  
  report += `\n共筛选出 **${results.length}** 只股票\n\n`;
  
  // 筛选结果
  if (results.length > 0) {
    report += "## 筛选结果\n\n";
    report += "| 代码 | 名称 | 现价 | 涨跌幅 | PE | ROE | 市值 |\n";
    report += "|------|------|------|--------|-----|-----|------|\n";
    
    for (const stock of results.slice(0, 20)) {
      const changeSign = stock.change >= 0 ? "+" : "";
      report += `| ${stock.symbol} | ${stock.name} | ${stock.price?.toFixed(2)} | ${changeSign}${stock.changePercent?.toFixed(2)}% | ${stock.pe?.toFixed(1)} | ${stock.roe?.toFixed(1)}% | ${stock.marketCap?.toFixed(0)}亿 |\n`;
    }
    
    if (results.length > 20) {
      report += `\n*...还有 ${results.length - 20} 只股票*\n`;
    }
  }
  
  return report;
}

/**
 * 主函数
 */
async function main(criteriaStr) {
  console.log("🔍 开始筛选股票...");
  console.log("筛选条件:", criteriaStr);
  
  try {
    const params = parseCriteria(criteriaStr);
    
    // 模拟筛选 (实际需要接入真实数据源)
    const mockResults = [
      { symbol: "600519", name: "贵州茅台", price: 1680.50, change: 25.20, changePercent: 1.52, pe: 28.5, roe: 32.1, marketCap: 21000 },
      { symbol: "000858", name: "五粮液", price: 168.20, change: 2.50, changePercent: 1.51, pe: 18.2, roe: 25.6, marketCap: 6500 },
      { symbol: "600036", name: "招商银行", price: 35.80, change: 0.45, changePercent: 1.27, pe: 6.8, roe: 15.2, marketCap: 8900 },
    ];
    
    const results = screenStocks(mockResults, params);
    const report = generateScreenReport(params, results);
    
    console.log("\n" + report);
    return report;
  } catch (error) {
    console.error("❌ 筛选失败:", error);
    throw error;
  }
}

// 导出
export { main, parseCriteria, screenStocks, generateScreenReport };

if (import.meta.url === `file://${process.argv[1]}`) {
  const criteria = process.argv[2] || "PE<20 ROE>15%";
  main(criteria).catch(console.error);
}
