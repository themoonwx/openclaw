// 统一的权限检查模块
import { readFileSync, existsSync, watch } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PERM_FILE = '/home/ubuntu/.openclaw/user-permissions.json';

let permissionsCache = null;
let permissionWatcher = null;

/**
 * 加载权限配置
 */
export function loadPermissions() {
  if (existsSync(PERM_FILE)) {
    try {
      return JSON.parse(readFileSync(PERM_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to load permissions:', e);
    }
  }
  return {};
}

/**
 * 启动文件监听实现热加载
 * @param {Function} callback - 权限变更时的回调函数
 */
export function startPermissionWatcher(callback) {
  if (permissionWatcher) return;

  // 初始加载
  permissionsCache = loadPermissions();

  // 监听文件变化
  permissionWatcher = watch(PERM_FILE, (eventType) => {
    if (eventType === 'change') {
      permissionsCache = loadPermissions();
      callback?.(permissionsCache);
    }
  });

  console.log('Permission watcher started');
}

/**
 * 停止文件监听
 */
export function stopPermissionWatcher() {
  if (permissionWatcher) {
    permissionWatcher.close();
    permissionWatcher = null;
    permissionsCache = null;
  }
}

/**
 * 根据平台和用户ID获取权限
 * @param {string} platform - 平台标识 (wechat_work, feishu, dingtalk, discord)
 * @param {string} userId - 用户ID
 * @returns {Object|null} 用户权限对象
 */
export function getUserPermissions(platform, userId) {
  if (!permissionsCache) {
    permissionsCache = loadPermissions();
  }

  if (!permissionsCache || !userId) return null;

  // 优先通过 userId 精确匹配
  if (permissionsCache[userId]) {
    const perm = permissionsCache[userId];
    if (perm.platform === platform) {
      return perm;
    }
  }

  // 兼容：通过 platform + username 匹配
  return Object.values(permissionsCache).find(
    p => p.platform === platform && p.user_id === userId
  );
}

/**
 * 检查用户是否有某项权限 {string} platform - 平台标识
 * @param
 * @param {string} userId - 用户ID
 * @param {string} permission - 权限名称
 * @returns {boolean} 是否有权限（未找到则默认允许）
 */
export function hasPermission(platform, userId, permission) {
  const userPerms = getUserPermissions(platform, userId);
  if (!userPerms) return true; // 未找到则默认允许
  return userPerms[permission] === true;
}

/**
 * 检查消息入口权限
 * @param {string} platform - 平台标识
 * @param {string} userId - 用户ID
 * @returns {{allowed: boolean, message: string}}
 */
export function checkSendMessagePermission(platform, userId) {
  const userPerms = getUserPermissions(platform, userId);
  if (!userPerms) {
    return { allowed: true, message: '' };
  }

  if (userPerms.send_message === false) {
    return {
      allowed: false,
      message: '您好！您当前没有发送消息的权限。'
    };
  }

  return { allowed: true, message: '' };
}

/**
 * 检查AI执行权限
 * @param {string} platform - 平台标识
 * @param {string} userId - 用户ID
 * @returns {{allowed: boolean, message: string}}
 */
export function checkClaudeCodePermission(platform, userId) {
  const userPerms = getUserPermissions(platform, userId);
  if (!userPerms) {
    return { allowed: true, message: '' };
  }

  if (userPerms.call_claude_code === false) {
    return {
      allowed: false,
      message: '您好！当前AI工具执行权限已关闭，只能进行基础文字对话。如需开启，请联系管理员。'
    };
  }

  return { allowed: true, message: '' };
}

/**
 * 获取权限缓存（供调试使用）
 */
export function getPermissionsCache() {
  return permissionsCache;
}

export default {
  loadPermissions,
  startPermissionWatcher,
  stopPermissionWatcher,
  getUserPermissions,
  hasPermission,
  checkSendMessagePermission,
  checkClaudeCodePermission,
  getPermissionsCache
};
