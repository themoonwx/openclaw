// 统一的权限检查模块
import { readFileSync, existsSync, watch } from 'fs';
import { fileURLToPath } from 'url';

const PERM_FILE = '/home/ubuntu/.openclaw/user-permissions.json';

let permissionsCache = null;
let permissionWatcher = null;

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

export function startPermissionWatcher(callback) {
  if (permissionWatcher) return;
  permissionsCache = loadPermissions();
  permissionWatcher = watch(PERM_FILE, (eventType) => {
    if (eventType === 'change') {
      permissionsCache = loadPermissions();
      callback?.(permissionsCache);
    }
  });
  console.log('Permission watcher started');
}

export function stopPermissionWatcher() {
  if (permissionWatcher) {
    permissionWatcher.close();
    permissionWatcher = null;
    permissionsCache = null;
  }
}

export function getUserPermissions(platform, userId) {
  if (!permissionsCache) {
    permissionsCache = loadPermissions();
  }

  if (!permissionsCache || !userId) return null;

  const perms = Object.values(permissionsCache);

  // 1. 优先通过 userId 精确匹配（UUID）
  if (permissionsCache[userId]) {
    const perm = permissionsCache[userId];
    if (perm.platform === platform) {
      return perm;
    }
  }

  // 2. 通过 user_id 字段匹配
  const byUserId = perms.find(p => p.platform === platform && p.user_id === userId);
  if (byUserId) return byUserId;

  // 3. 通过 username 匹配（包含关系）
  const byUsername = perms.find(p => p.platform === platform && p.username?.includes(userId));
  if (byUsername) return byUsername;

  // 4. 如果该平台只有一个用户，返回该用户的权限（兼容模式）
  const platformPerms = perms.filter(p => p.platform === platform);
  if (platformPerms.length === 1) {
    return platformPerms[0];
  }

  return null;
}

export function hasPermission(platform, userId, permission) {
  const userPerms = getUserPermissions(platform, userId);
  if (!userPerms) return true;
  return userPerms[permission] === true;
}

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
