#\!/usr/bin/env node

/**
 * News Intelligence
 * 新闻情报聚合
 */

/**
 * 获取东方财富新闻
 */
async function getEastMoneyNews(category = "全部") {
  try {
    const categoryMap = {
      "全部": "0",
      "A股": "1",
      "港股": "2",
      "美股": "3",
      "基金": "4",
      "期货": "5",
      "外汇": "6",
    };
    
    const cid = categoryMap[category] || "0";
    const response = await fetch(
      `https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_${cid}.html`
    );
    const text = await response.text();
    
    // 解析 JSON
    const match = text.match(/\{[\s\S]*\}/);
    if (\!match) return [];
    
    const data = JSON.parse(match[0]);
    
    return (data.Lives || []).map(item => ({
      title: item.title,
      summary: item.digest,
      source: item.url,
      time: item.showtime,
      category: item.type,
    }));
  } catch (error) {
    console.error("获取新闻失败:", error.message);
    return [];
  }
}

/**
 * 获取个股新闻
 */
async function getStockNews(symbol) {
  try {
    const response = await fetch(
      `https://searchapi.eastmoney.com/api/suggest/get?input=${symbol}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=5`
    );
    const data = await response.json();
    
    // 解析新闻 (简化版)
    return [
      {
        symbol,
        title: `${symbol} 相关新闻`,
        time: new Date().toLocaleString("zh-CN"),
        source: "东方财富",
      },
    ];
  } catch (error) {
    console.error("获取个股新闻失败:", error.message);
    return [];
  }
}

/**
 * 关键词过滤
 */
function filterByKeyword(news, keywords) {
  if (\!keywords || keywords.length === 0) return news;
  
  return news.filter(item => {
    const text = (item.title + " " + item.summary).toLowerCase();
    return keywords.some(k => text.includes(k.toLowerCase()));
  });
}

/**
 * 生成新闻报告
 */
function generateNewsReport(news, options = {}) {
  const { category = "全部", keywords = [] } = options;
  
  let filteredNews = news;
  if (keywords.length > 0) {
    filteredNews = filterByKeyword(news, keywords);
  }
  
  let report = "# 📰 新闻情报\n\n";
  
  if (filteredNews.length === 0) {
    report += "*暂无新闻*\n";
    return report;
  }
  
  // 分类显示
  report += `## 📋 ${category} 要闻\n\n`;
  report += "| 时间 | 标题 | 来源 |\n";
  report += "|------|------|------|\n";
  
  for (const item of filteredNews.slice(0, 20)) {
    const time = item.time || "";
    const title = item.title || "";
    const source = item.source || "东方财富";
    report += `| ${time} | ${title} | ${source} |\n`;
  }
  
  if (filteredNews.length > 20) {
    report += `\n*...还有 ${filteredNews.length - 20} 条新闻*\n`;
  }
  
  // 生成时间
  report += `\n---\n`;
  report += `*更新时间: ${new Date().toLocaleString("zh-CN")}*\n`;
  
  return report;
}

/**
 * 搜索新闻
 */
async function searchNews(query) {
  try {
    // 使用 Web Search (通过 OpenClaw 工具)
    // 这里返回模拟数据
    return [
      {
        title: `${query} 相关新闻 1`,
        summary: "这是关于搜索词的新闻摘要...",
        time: new Date().toISOString(),
        url: "#",
      },
      {
        title: `${query} 相关新闻 2`,
        summary: "这是另一条新闻摘要...",
        time: new Date().toISOString(),
        url: "#",
      },
    ];
  } catch (error) {
    console.error("搜索失败:", error);
    return [];
  }
}

/**
 * 主函数
 */
async function main(action, params) {
  console.log("📰 News Intelligence 启动...");
  
  try {
    if (action === "latest") {
      const news = await getEastMoneyNews(params.category || "全部");
      return generateNewsReport(news, params);
    } else if (action === "stock") {
      const news = await getStockNews(params.symbol);
      return generateNewsReport(news, { category: params.symbol });
    } else if (action === "search") {
      const news = await searchNews(params.query);
      return generateNewsReport(news, { keywords: [params.query] });
    } else {
      // 默认获取最新新闻
      const news = await getEastMoneyNews();
      return generateNewsReport(news);
    }
  } catch (error) {
    console.error("❌ 获取新闻失败:", error);
    throw error;
  }
}

// 导出
export { main, getEastMoneyNews, getStockNews, searchNews, generateNewsReport };

if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2] || "latest";
  main(action, {}).then(console.log).catch(console.error);
}
