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

// 上下文续话关键词 - 当用户说这些时，需要从主session获取历史
const CONTINUE_CONTEXT_HINTS = [
  /继续/,
  /接着/,
  /之前/,
  /刚才/,
  /之前我们/,
  /基于之前的/,
  /接着之前的/,
  /继续之前的/,
  /沿用之前的/,
  /基于我们之前/,
  /使用之前的/,
  /按(照|我们|这个|刚才)/,
  /根据之前/,
  /按照(刚才|之前|我们)/,
  /apply.*previous/i,
  /continue.*from/i,
  /based.*previous/i,
  /following.*previous/i,
  /based.*discussion/i,
  /continue.*task/i,
];

export function needsContext(message: string): boolean {
  return CONTINUE_CONTEXT_HINTS.some((hint) => hint.test(message));
}

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
  // Second Priority: /Role direct call (e.g., /产品, /测试) - BEFORE /c, /p commands
  // ========================================
  const slashRoleMatch = trimmed.match(/^\/([a-zA-Z\u4e00-\u9fa5]+)\s*(.*)$/);
  if (slashRoleMatch) {
    const alias = slashRoleMatch[1].toLowerCase();
    // Skip if it's a known command (/c, /cc, /task, /p, /project)
    if (!["c", "cc", "task", "p", "project"].includes(alias)) {
      const content = slashRoleMatch[2].trim();
      const agentRole = AGENT_ALIASES[alias];
      if (agentRole) {
        return {
          mode: "single_agent",
          targetAgent: agentRole,
          content: content || "你好",
        };
      }
    }
  }

  // ========================================
  // Second Priority (alt): Natural language role call without / prefix
  // For Discord where / might be intercepted by Discord's slash commands
  // e.g., "测试 你好" or "@测试 你好" or "叫测试写一个"
  // Also handles Discord mentions like "<@123456789> 测试 你好"
  // ========================================
  // First strip Discord mention tags like <@123456789> or <@!123456789> or <@1475146625256263933>
  // Also handle cases where mention might be truncated like <@123456789
  const cleanedText = trimmed.replace(/^<@!?\d+>\s*/g, '').replace(/^<@\d+>\s*/g, '').replace(/^@\d+\s*/g, '');

  const naturalRoleMatch = cleanedText.match(/^(?:@|叫|请|让)?(测试|产品|前端|后端|运维|架构|qa|fe|be|ops)\s+(.+)$/i);
  if (naturalRoleMatch) {
    const alias = naturalRoleMatch[1].toLowerCase();
    const content = naturalRoleMatch[2].trim();
    const agentRole = AGENT_ALIASES[alias];
    if (agentRole) {
      return {
        mode: "single_agent",
        targetAgent: agentRole,
        content: content || "你好",
      };
    }
  }

  // ========================================
  // Third Priority: Claude Code task command (/c or /task) - direct execution
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
  // Third Priority: Explicit project command
  // ========================================
  const projectMatch = trimmed.match(/^\/(project|p)\s+(.+)/s);
  if (projectMatch) {
    return {
      mode: "multi_agent",
      content: projectMatch[2],
    };
  }

  // ========================================
  // First Priority: /Role direct call (e.g., /产品, /测试)
  // ========================================
  const slashMatch = trimmed.match(/^\/(\S+)\s*(.*)$/s);
  if (slashMatch) {
    const alias = slashMatch[1].toLowerCase();
    const content = slashMatch[2].trim();
    const agentRole = AGENT_ALIASES[alias];

    if (agentRole) {
      return {
        mode: "single_agent",
        targetAgent: agentRole,
        content: content || "你好",
      };
    }
  }

  // ========================================
  // Fourth Priority: @Role direct call (for platforms that support @mention)
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
  // Require at least one delimiter after agent name to avoid false triggers (e.g., "测试一下" shouldn't trigger)
  const naturalMatch = trimmed.match(
    /^(让|叫|请|@)?\s*(产品经理|产品|架构师|架构|前端|后端|运维|测试|pm|fe|be|ops|qa)[\s:：,，]+(.+)/i,
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
  // Fifth Priority: Keyword hint (suggests, doesn't auto-trigger)
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

// Get agent display tag (for message prefix)
export function getAgentDisplayTag(role: string): string {
  const tags: Record<string, string> = {
    product_manager: "【产品】",
    architect: "【架构】",
    tester: "【测试】",
    frontend: "【前端】",
    backend: "【后端】",
    devops: "【运维】",
    project: "【项目】",
    cc: "【CC】",
  };
  return tags[role] ?? role;
}
