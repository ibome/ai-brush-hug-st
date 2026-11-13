const messages = {
  CREDENTIAL_QUOTA: '浏览器秘钥存储空间不足，请先导出备份，再到「调试工具」检查存储；不要清空站点数据',
  CREDENTIAL_BLOCKED: '浏览器限制了秘钥存储，请检查站点存储权限或隐私模式，允许后重新保存',
  CREDENTIAL_CORRUPT: '原秘钥缓存格式异常，且备用存储不可用；请先导出备份，再到「调试工具」检查存储',
  CREDENTIAL_TIMEOUT: '秘钥存储响应超时，请关闭重复的酒馆页面后重试',
  CREDENTIAL_UNAVAILABLE: '当前浏览器的秘钥存储不可用，请到「调试工具」检查存储后重试',
  CREDENTIAL_MISSING: '此秘钥在当前账号或浏览器中无法读取，请在接口配置重新填写并保存',
  CREDENTIAL_SERVER: '酒馆秘钥接口暂时无法访问，请核对登录状态后重试',
  CREDENTIAL_INVALID: '秘钥或秘钥引用格式无效，请重新填写',
};

export function credentialError(code) {
  return Object.assign(new Error(messages[code] || messages.CREDENTIAL_UNAVAILABLE), { code });
}

export function credentialFailure(error, action = 'write') {
  const code = Object.hasOwn(messages, error?.code) ? error.code
    : ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name) ? 'CREDENTIAL_QUOTA'
      : error?.name === 'SecurityError' ? 'CREDENTIAL_BLOCKED'
        : error?.name === 'TimeoutError' ? 'CREDENTIAL_TIMEOUT'
          : action === 'read' ? 'CREDENTIAL_MISSING' : 'CREDENTIAL_UNAVAILABLE';
  return { code, message: messages[code] };
}

export const credentialSavedMessage = (ref) => ref?.startsWith('browser:')
  ? '秘钥已保存在当前浏览器，请使用同一浏览器与酒馆地址读取'
  : ref ? '秘钥已保存在酒馆账号' : '当前秘钥已清空';
