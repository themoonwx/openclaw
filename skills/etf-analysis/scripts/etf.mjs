#\!/usr/bin/env node

/**
 * ETF Analysis
 * ETF 分析工具
 */

/**
 * 常用 ETF 代码映射
 */
const ETF_CODES = {
  // 宽基
  "510300": "沪深300ETF",
  "159919": "沪深300ETF(创业板)",
  "510500": "中证500ETF",
  "159919": "中证500ETF",
  "159915": "创业板ETF",
  "513050": "科创50ETF",
  "510050": "上证50ETF",
  
  // 行业
  "512880": "证券ETF",
  "512690": "消费ETF",
  "159928": "消费ETF",
  "515790": "光伏ETF",
  "516570": "新能源车ETF",
  "512760": "半导体ETF",
  "159995": "券商ETF",
  
  // 策略
  "510880": "红利ETF",
  "159915": "创业板ETF",
  "510500": "中证500ETF",
};

/**
 * 获取 ETF 列表 (热门/涨幅榜)
 */
async function getETFList(category = "涨幅") {
  try {
    // 模拟 ETF 列表数据
    const etfList = [
      { code: "510300", name: "沪深300ETF", change: 1.2, volume: "25亿", flow: "净流入" },
      { code: "159915", name: "创业板ETF", change: 2.1, volume: "18亿", flow: "净流入" },
      { code: "513050", name: "科创50ETF", change: 1.8, volume: "15亿", flow: "净流入" },
      { code: "512880", name: "证券ETF", change: 3.2, volume: "12亿", flow: "净流入" },
      { code: "515790", name: "光伏ETF", change: 4.5, volume: "8亿", flow: "净流入" },
      { code: "510880", name: "红利ETF", change: 0.5, volume: "5亿", flow: "净流出" },
    ];
    
    return etfList;
  } catch (error) {
    console.error("获取ETF列表失败:", error);
    return [];
  }
}

/**
 * 获取溢价率数据
 */
async function getETFPremium() {
  try {
    // 模拟溢价率数据
    const premiumList = [
      { code: "513050", name: "科创50ETF", premium: 1.2, status: "正常" },
      { code: "159920", name: "港股通ETF", premium: 3.5, status: "高溢价" },
      { code: "513100", name: "中概互联网ETF", premium: 2.1, status: "关注" },
      { code: "510300", name: "沪深300ETF", premium: 0.1, status: "正常" },
      { code: "510880", name: "红利ETF", premium: -0.2, status: "折价" },
    ];
    
    return premiumList;
  } catch (error) {
    console.error("获取溢价率失败:", error);
    return [];
  }
}

/**
 * 获取 ETF 组合推荐
 */
function getETPRecommendations(type = "平衡型") {
  const recommendations = {
    "稳健型": [
      { code: "510300", name: "沪深300ETF", ratio: "60%", risk: "中" },
      { code: "511010", name: "债券ETF", ratio: "40%", risk: "低" },
    ],
    "平衡型": [
      { code: "510300", name: "沪深300ETF", ratio: "40%", risk: "中" },
      { code: "513050", name: "科创50ETF", ratio: "30%", risk: "高" },
      { code: "159928", name: "消费ETF", ratio: "30%", risk: "中" },
    ],
    "激进型": [
      { code: "516570", name: "新能源车ETF", ratio: "40%", risk: "高" },
      { code: "512760", name: "半导体ETF", ratio: "35%", risk: "高" },
      { code: "515790", name: "光伏ETF", ratio: "25%", risk: "高" },
    ],
  };
  
  return recommendations[type] || recommendations["平衡型"];
}

/**
 * 生成 ETF 报告
 */
async function generateETFReport(action, params) {
  let report = "# 📊 ETF 分析\n\n";
  
  if (action === "hot" || action === "热门") {
    // 热门 ETF
    const etfs = await getETFList("涨幅");
    
    report += "## 🔥 热门 ETF\n\n";
    report += "| 代码 | 名称 | 涨幅 | 成交量 | 资金流向 |\n";
    report += "|------|------|------|--------|----------|\n";
    
    for (const etf of etfs) {
      const changeSign = etf.change >= 0 ? "+" : "";
      report += `| ${etf.code} | ${etf.name} | ${changeSign}${etf.change}% | ${etf.volume} | ${etf.flow} |\n`;
    }
    
  } else if (action === "premium" || action === "溢价") {
    // 溢价率
    const premiums = await getETFPremium();
    
    report += "## ⚠️ 溢价率分析\n\n";
    report += "| 代码 | 名称 | 溢价率 | 状态 |\n";
    report += "|------|------|--------|------|\n";
    
    for (const p of premiums) {
      const premiumSign = p.premium >= 0 ? "+" : "";
      const statusIcon = p.status === "高溢价" ? "🔴" : p.status === "关注" ? "🟡" : "🟢";
      report += `| ${p.code} | ${p.name} | ${premiumSign}${p.premium}% | ${statusIcon} ${p.status} |\n`;
    }
    
    report += "\n**提示**: 溢价率 > 2% 时存在回调风险，建议谨慎\n";
    
  } else if (action === "recommend" || action === "推荐" || action === "组合") {
    // 组合推荐
    const type = params.type || "平衡型";
    const recommendations = getETPRecommendations(type);
    
    report += `## 💰 ${type}组合\n\n`;
    report += "| 代码 | 名称 | 配比 | 风险 |\n";
    report += "|------|------|------|------|\n";
    
    for (const rec of recommendations) {
      report += `| ${rec.code} | ${rec.name} | ${rec.ratio} | ${rec.risk} |\n`;
    }
    
    // 添加预期收益
    const expectedReturns = {
      "稳健型": "6-8%",
      "平衡型": "10-15%",
      "激进型": "15-25%",
    };
    
    report += `\n**预期年化收益**: ${expectedReturns[type]}\n`;
    report += "*仅供参考，不构成投资建议*\n";
    
  } else if (action === "list" || action === "所有") {
    // 所有分类
    report += "## 📋 ETF 分类\n\n";
    report += "### 宽基ETF\n";
    report += "- 510300 沪深300ETF\n";
    report += "- 510500 中证500ETF\n";
    report += "- 159915 创业板ETF\n";
    report += "- 513050 科创50ETF\n\n";
    
    report += "### 行业ETF\n";
    report += "- 512880 证券ETF\n";
    report += "- 159928 消费ETF\n";
    report += "- 515790 光伏ETF\n";
    report += "- 516570 新能源车ETF\n\n";
    
    report += "### 策略ETF\n";
    report += "- 510880 红利ETF\n";
    
  } else {
    // 默认显示热门
    const etfs = await getETFList("涨幅");
    
    report += "## 📊 ETF 市场概览\n\n";
    report += "| 代码 | 名称 | 涨幅 | 成交量 |\n";
    report += "|------|------|------|--------|\n";
    
    for (const etf of etfs.slice(0, 5)) {
      const changeSign = etf.change >= 0 ? "+" : "";
      report += `| ${etf.code} | ${etf.name} | ${changeSign}${etf.change}% | ${etf.volume} |\n`;
    }
    
    report += "\n输入 热门 查看更多，输入 溢价 查看溢价率\n";
  }
  
  report += `\n---\n`;
  report += `*更新时间: ${new Date().toLocaleString("zh-CN")}*\n`;
  
  return report;
}

/**
 * 主函数
 */
async function main(action, params = {}) {
  console.log("ETF Analysis 启动...");
  
  try {
    return await generateETFReport(action, params);
  } catch (error) {
    console.error("分析失败:", error);
    throw error;
  }
}

// 导出
export { main, getETFList, getETFPremium, getETPRecommendations };

if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2] || "list";
  main(action).then(console.log).catch(console.error);
}
