// src/multi-agent/trigger.ts

// Three-layer trigger mechanism for multi-agent system

export interface RouteResult {
  mode:
    | "multi_agent"
    | "single_agent"
    | "suggest_project"
    | "single_llm"
    | "cc_task"
    | "cc_task_with_context"
    | "cc_progress";
  content: string;
  targetAgent?: string;
  suggestion?: string;
}

// Role alias mapping - support multiple naming conventions
const AGENT_ALIASES: Record<string, string> = {
  // Product Manager
  产品经理: "product_manager",
  产品: "product_manager",
  pm: "product_manager",
  需求: "product_manager",

  // Architect
  架构师: "architect",
  架构: "architect",
  arch: "architect",

  // Frontend
  前端: "frontend",
  fe: "frontend",
  front: "frontend",

  // Backend
  后端: "backend",
  be: "backend",
  back: "backend",

  // DevOps
  运维: "devops",
  ops: "devops",
  deploy: "devops",
  部署: "devops",

  // Tester
  测试: "tester",
  test: "tester",
  qa: "tester",
  审查: "tester",
  review: "tester",
};

const PROJECT_HINTS = [
  /开发一个/,
  /搭建.*(系统|平台|网站|应用)/,
  /从零开始/,
  /帮我做一个.*项目/,
  /帮我写一个/,
  /创建一个/,
  /build\s+a/,
  /create\s+a/,
  /develop\s+a/,
];

export function routeMessage(message: string): RouteResult {
  const trimmed = message.trim();

  // ========================================
  // Query CC task progress
  // ========================================
  const progressMatch = trimmed.match(/^\/(进度|progress|status|ps)\s*$/i);
  if (progressMatch) {
    return {
      mode: "cc_progress",
      content: "",
    };
  }

  // ========================================
  // First Priority: Claude Code task with context (/cc) - include conversation history
  // ========================================
  const ccWithContextMatch = trimmed.match(/^\/(cc)\s+(.+)/s);
  if (ccWithContextMatch) {
    return {
      mode: "cc_task_with_context",
      content: ccWithContextMatch[2],
    };
  }

  // ========================================
  // Second Priority: Claude Code task command (/c or /task) - direct execution
  // ========================================
  const ccTaskMatch = trimmed.match(/^\/(c|task)\s+(.+)/s);
  if (ccTaskMatch) {
    return {
      mode: "cc_task",
      content: ccTaskMatch[2],
    };
  }

  // Block code modification requests - redirect to CC
  const codeKeywords = [
    /修改.*代码/,
    /写.*代码/,
    /开发/,
    /实现/,
    /创建.*文件/,
    /编写.*脚本/,
    /按.*方案/,
    /按这个/,
    /execute|按/,
    /modify.*code/,
    /write.*code/,
    /develop/,
    /implement/,
    /create.*file/,
  ];

  for (const keyword of codeKeywords) {
    if (keyword.test(trimmed)) {
      return {
        mode: "cc_task_with_context",
        content: trimmed,
      };
    }
  }

  // ========================================
  // Second Priority: Explicit project command
  // ========================================
  const projectMatch = trimmed.match(/^\/(project|p)\s+(.+)/s);
  if (projectMatch) {
    return {
      mode: "multi_agent",
      content: projectMatch[2],
    };
  }

  // ========================================
  // Second Priority: @Role direct call
  // ========================================
  const agentMatch = trimmed.match(/^@(\S+)\s+(.+)/s);
  if (agentMatch) {
    const alias = agentMatch[1].toLowerCase();
    const agentRole = AGENT_ALIASES[alias];

    if (agentRole) {
      return {
        mode: "single_agent",
        targetAgent: agentRole,
        content: agentMatch[2],
      };
    }
  }

  // Also support Chinese natural language: "让前端写个xxx" / "叫后端实现xxx" / "前端写个组件"
  const naturalMatch = trimmed.match(
    /^(让|叫|请|@)?\s*(产品经理|产品|架构师|架构|前端|后端|运维|测试|pm|fe|be|ops|qa)[\s:：,，]*(.+)/i,
  );
  if (naturalMatch) {
    const alias = naturalMatch[2].toLowerCase();
    const agentRole = AGENT_ALIASES[alias];
    if (agentRole) {
      return {
        mode: "single_agent",
        targetAgent: agentRole,
        content: naturalMatch[3],
      };
    }
  }

  // ========================================
  // Third Priority: Keyword hint (suggests, doesn't auto-trigger)
  // ========================================
  if (PROJECT_HINTS.some((r) => r.test(trimmed))) {
    return {
      mode: "suggest_project",
      content: trimmed,
      suggestion:
        "💡 检测到项目级需求，输入 /p 可启动多 Agent 协作模式。也可以 @角色名 单独调用某个角色。",
    };
  }

  // ========================================
  // Default: Single LLM flow
  // ========================================
  return {
    mode: "single_llm",
    content: trimmed,
  };
}

// Agent type mapping - determines call method
export const AGENT_TYPES: Record<string, "lightweight" | "heavy"> = {
  product_manager: "lightweight",
  architect: "lightweight",
  tester: "lightweight",
  frontend: "heavy",
  backend: "heavy",
  devops: "heavy",
};

// Get agent display name
export function getAgentDisplayName(role: string): string {
  const names: Record<string, string> = {
    product_manager: "产品经理",
    architect: "架构师",
    tester: "测试工程师",
    frontend: "前端工程师",
    backend: "后端工程师",
    devops: "运维工程师",
  };
  return names[role] ?? role;
}
