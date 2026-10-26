#!/usr/bin/env node
/**
 * 发布前注入「内置云端凭据」。
 *
 * 商业化取向：产品方内置一个云端账号/凭据，新用户装完即用（免注册）；
 * 用户自己的账号登录后优先用自己的额度。
 *
 * 用法（发布前）：
 *   Windows (PowerShell):  $env:LABCODE_GATEWAY_TOKEN='xxx'; $env:LABCODE_GATEWAY_URL='https://...'; npm run build:win
 *   macOS / Linux:         LABCODE_GATEWAY_TOKEN=xxx npm run build
 *
 * 生成的 resources/gateway.json 已被 .gitignore 忽略 —— 凭据不进仓库。
 * 没有设置环境变量时会写入空凭据（= 不启用内置云端，用户仍可登录使用）。
 */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'resources');
const outFile = path.join(outDir, 'gateway.json');

const token = (process.env.LABCODE_GATEWAY_TOKEN || '').trim();
const url = (process.env.LABCODE_GATEWAY_URL || '').trim();

try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ token, url }, null, 2) + '\n', 'utf8');
  if (token) {
    // 只提示前缀，避免把完整凭据打进构建日志
    console.log('[inject-gateway] 已注入内置云端凭据 ' + token.slice(0, 6) + '…' + (url ? ' @ ' + url : ''));
  } else {
    console.log('[inject-gateway] 未设置 LABCODE_GATEWAY_TOKEN → 不启用内置云端（写入空凭据）');
  }
} catch (e) {
  console.error('[inject-gateway] 写入失败：' + e.message);
  process.exit(1);
}
