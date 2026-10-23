import crypto from 'node:crypto';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { RELEASE } from '../src/release.js';
import { assertBrowserRegex } from './browser-regexp.mjs';

export const PROTECTION_PROFILE = 'light-identifiers-v1';
export const protectionOptions = Object.freeze({
  target: 'browser',
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  renameProperties: false,
  transformObjectKeys: false,
  stringArray: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,
  selfDefending: false,
  numbersToExpressions: false,
  splitStrings: false,
  simplify: false,
  sourceMap: false,
  unicodeEscapeSequence: false,
});
export const codeDigest = (code) => crypto.createHash('sha256').update(code).digest('hex');
export const releaseBanner = (vendor = false) =>
  `/*! Linghuashi ${RELEASE.version} | ${vendor ? 'Third-party dependencies.' : 'Copyright (c) 2026 \u5c0f\u6ce2.'}\n`
  + ` * ${vendor ? 'Third-party code: see THIRD-PARTY-NOTICES.txt.' : 'New work: Linghuashi Personal Use and Attribution License 1.0; see LICENSE.'}\n`
  + ' * Legacy BSD and third-party permissions remain applicable; see LICENSES/ and THIRD-PARTY-NOTICES.txt.\n'
  + ` * Build: ${RELEASE.build}.\n */\n`;

export function protectCode(code, name) {
  const seed = Number.parseInt(codeDigest(`${RELEASE.build}:${name}:${PROTECTION_PROFILE}`).slice(0, 8), 16) || 1;
  return JavaScriptObfuscator.obfuscate(code, { ...protectionOptions, seed }).getObfuscatedCode();
}

export function protectBuild() {
  return {
    name: 'linghuashi-release-protection',
    apply: 'build',
    enforce: 'post',
    augmentChunkHash() { return JSON.stringify({ profile: PROTECTION_PROFILE, options: protectionOptions, build: RELEASE.build }); },
    generateBundle: { order: 'post', handler(_options, bundle) {
      const files = [];
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const vendor = file.name === 'vendor';
        const modules = Object.keys(file.modules).map((id) => id.replaceAll('\\', '/'));
        if (vendor && modules.some((id) => /\/(?:src|server)\//.test(id) && !id.includes('/node_modules/'))) {
          this.error('First-party code must not be placed in the unprotected vendor chunk');
        }
        const before = Buffer.byteLength(file.code);
        file.code = releaseBanner(vendor) + (vendor ? file.code : protectCode(file.code, file.name));
        assertBrowserRegex(file.code, file.fileName);
        file.map = null;
        files.push({ name: file.fileName, protected: !vendor, beforeBytes: before,
          bytes: Buffer.byteLength(file.code), sha256: codeDigest(file.code) });
      }
      this.emitFile({ type: 'asset', fileName: 'build-protection.json',
        source: JSON.stringify({ version: RELEASE.version, build: RELEASE.build, profile: PROTECTION_PROFILE,
          sourceMaps: false, files: files.sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + '\n' });
    } },
  };
}
