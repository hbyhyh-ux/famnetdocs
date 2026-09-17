#!/usr/bin/env node
/**
 * src/index.html 의 __FONT:이름__ 자리표시자를 src/fonts/ 의 실제 폰트로
 * base64 인라인 치환해 dist/index.html 을 만든다.
 *
 * Apps Script 웹앱은 외부 정적 파일을 서빙하지 못하므로
 * 배포본은 폰트까지 모두 들어간 단일 HTML이어야 한다.
 *
 *   node build/build.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'index.html');
const ASSETS = [
  { tag: 'FONT', dir: path.join(ROOT, 'src', 'fonts'), mime: 'font/woff2' },
  { tag: 'IMG',  dir: path.join(ROOT, 'src', 'img'),   mime: 'image/png' },
];
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'index.html');

let html = fs.readFileSync(SRC, 'utf8');

let count = 0;
for (const { tag, dir, mime } of ASSETS) {
  const re = new RegExp(`__${tag}:([\\w.-]+)__`, 'g');
  const names = [...new Set([...html.matchAll(re)].map(m => m[1]))];
  for (const name of names) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      console.error(`✗ 자원 파일이 없습니다: ${path.relative(ROOT, file)}`);
      process.exit(1);
    }
    const b64 = fs.readFileSync(file).toString('base64');
    const before = html.length;
    html = html.split(`__${tag}:${name}__`).join(`data:${mime};base64,${b64}`);
    console.log(`  ${name}  ${(fs.statSync(file).size / 1024).toFixed(0)}KB → 인라인 (+${((html.length - before) / 1024).toFixed(0)}KB)`);
    count++;
  }
}
if (count === 0) console.warn('! 인라인할 자원이 없습니다. 그대로 복사합니다.');

// 자리표시자가 남아 있으면 배포본이 깨진다
const left = html.match(/__(?:FONT|IMG):[\w.-]+__/g);
if (left) { console.error('✗ 치환되지 않은 자리표시자:', left.join(', ')); process.exit(1); }

// 간단한 무결성 검사
const styleCount = (html.match(/<style>/g) || []).length;
const open = (html.match(/\{/g) || []).length;
const close = (html.match(/\}/g) || []).length;
if (styleCount !== 1) console.warn(`! <style> 블록이 ${styleCount}개입니다.`);
if (open !== close) console.warn(`! 중괄호 불일치: { ${open} vs } ${close}`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`\n✓ dist/index.html  ${(html.length / 1024).toFixed(0)}KB`);
console.log('  → Apps Script 의 index.html 에 전체 붙여넣고 새 버전으로 재배포하세요.');
