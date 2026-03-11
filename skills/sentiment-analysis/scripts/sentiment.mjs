#!/usr/bin/env node

/**
 * Sentiment Analysis
 * 市场情绪分析工具
 */

/**
 * 情绪关键词映射
 */
const SENTIMENT_KEYWORDS = {
  positive: [
    "上涨", "涨停", "突破", "大涨", "利好", "增持", "推荐", "买入",
    "超预期", "业绩增长", "订单", "签约", "研发", "量产", "获批"
  ],
  negative: [
    "下跌", "跌停", "大跌", "利空", "减持", "卖出", "风险", "亏损",
    "不及预期", "业绩下滑", "诉讼", "处罚", "问询", "警示"
  ],
  neutral: [
    "公告", "会议", "披露", "报告", "财报", "澄清", "说明"
  ]
};

/**
 * 简单情感分析
 */
function analyzeSentiment(text) {
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  
  for (const keyword of SENTIMENT_KEYWORDS.positive) {
    if (text.includes(keyword)) positive++;
  }
  
  for (const keyword of SENTIMENT_KEYWORDS.negative) {
    if (text.includes(keyword)) negative++;
  }
  
  for (const keyword of SENTIMENT_KEYWORDS.neutral) {
    if (text.includes(keyword)) neutral++;
  }
  
  const total = positive + negative + neutral;
  if (total === 0) return "neutral";
  
  const positiveRatio = positive / total;
  const negativeRatio = negative / total;
  
  if (positiveRatio > 0.5) return "positive";
  if (negativeRatio > 0.5) return "negative";
  return "neutral";
}

/**
 * 获取市场情绪指标
 */
async function getMarketSentiment() {
  try {
    // 获取涨跌停数据
    const response = await fetch(
      "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:2+t:23"
    );
    const data = await response.json();
    
    const upCount = data.data?.diff?.length || 0;
    
    // 获取跌停数据
    const downResponse = await fetch(
      "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=0&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:81"
    );
    const downData = await downResponse.json();
    const downCount = downData.data?.diff?.length || 0;
    
    // 计算多空比
    const ratio = downCount > 0 ? (upCount / downCount).toFixed(2) : upCount;
    
    // 判断整体情绪
    let overallSentiment = "neutral";
    if (ratio > 2) overallSentiment = "positive";
    if (ratio < 0.5) overallSentiment = "negative";
    
    return {
      upCount,
      downCount,
      ratio,
      overallSentiment,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("获取情绪数据失败:", error);
    return null;
  }
}

/**
 * 获取个股舆情
 */
async function getStockSentiment(symbol) {
  try {
    // 获取新闻
    const newsResponse = await fetch(
      `https://searchapi.eastmoney.com/api/suggest/get?input=${symbol}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`
    );
    const newsData = await newsResponse.json();
    
    // 简单情感分析
    const headlines = ["业绩预增", "订单充足", "技术创新"]; // 模拟
    const sentiment = analyzeSentiment(headlines.join(" "));
    
    // 获取讨论热度 (模拟)
    const heat = Math.floor(Math.random() * 100);
    
    return {
      symbol,
      sentiment,
      heat,
      news: headlines,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("获取个股舆情失败:", error);
    return null;
  }
}

/**
 * 生成情绪报告
 */
async function generateSentimentReport(target, type = "market") {
  let report = "# 📊 市场情绪分析\n\n";
  
  if (type === "market") {
    const sentiment = await getMarketSentiment();
    
    if (!sentiment) {
      report += "*获取情绪数据失败*\n";
      return report;
    }
    
    // 整体情绪
    const sentimentEmoji = {
      positive: "🟢",
      neutral: "🟡",
      negative: "🔴"
    };
    const sentimentText = {
      positive: "乐观",
      neutral: "中性",
      negative: "悲观"
    };
    
    report += `### 整体情绪: ${sentimentEmoji[sentiment.overallSentiment]} ${sentimentText[sentiment.overallSentiment]}\n\n`;
    
    // 指标
    report += "| 指标 | 值 | 信号 |\n";
    report += "|------|-----|------|\n";
    report += `| 涨停数 | ${sentiment.upCount} | -\n`;
    report += `| 跌停数 | ${sentiment.downCount} | -\n`;
    report += `| 多空比 | ${sentiment.ratio} | ${parseFloat(sentiment.ratio) > 1 ? "多方占优" : "空方占优"}\n`;
    
    // 多空对比
    report += "\n### 📈 多空对比\n\n";
    const maxBar = 20;
    const upBar = Math.min(Math.floor(parseFloat(sentiment.ratio) * 5), maxBar);
    const downBar = maxBar - upBar;
    
    report += `多方: ${"█".repeat(upBar)}${"░".repeat(downBar)} ${sentiment.upCount}\n`;
    report += `空方: ${"░".repeat(upBar)}${"█".repeat(downBar)} ${sentiment.downCount}\n`;
    
  } else if (type === "stock") {
    const sentiment = await getStockSentiment(target);
    
    if (!sentiment) {
      report += "*获取舆情数据失败*\n";
      return report;
    }
    
    const sentimentEmoji = {
      positive: "🟢",
      neutral: "🟡",
      negative: "🔴"
    };
    const sentimentText = {
      positive: "乐观",
      neutral: "中性",
      negative: "悲观"
    };
    
    report += `### ${target} 情绪: ${sentimentEmoji[sentiment.sentiment]} ${sentimentText[sentiment.sentiment]}\n\n`;
    
    report += "| 指标 | 值 |\n";
    report += "|------|-----|\n";
    report += `| 热度 | ${sentiment.heat}/100 |\n`;
    report += `| 情绪 | ${sentimentText[sentiment.sentiment]} |\n`;
    
    if (sentiment.news?.length > 0) {
      report += "\n### 📰 相关关键词\n\n";
      for (const news of sentiment.news) {
        report += `- ${news}\n`;
      }
    }
  }
  
  report += `\n---\n`;
  report += `*更新时间: ${new Date().toLocaleString("zh-CN")}*\n`;
  
  return report;
}

/**
 * 主函数
 */
async function main(type, target) {
  console.log("📊 Sentiment Analysis 启动...");
  
  try {
    if (type === "market") {
      return await generateSentimentReport(null, "market");
    } else if (type === "stock") {
      return await generateSentimentReport(target, "stock");
    }
    
    return await generateSentimentReport(null, "market");
  } catch (error) {
    console.error("❌ 分析失败:", error);
    throw error;
  }
}

// 导出
export { main, analyzeSentiment, getMarketSentiment, getStockSentiment };

if (import.meta.url === `file://${process.argv[1]}`) {
  const type = process.argv[2] || "market";
  const target = process.argv[3];
  main(type, target).then(console.log).catch(console.error);
}
