import { readFileSync, writeFileSync } from 'fs';
import { minify as minifyHtml } from 'html-minifier-terser';

const SRC = process.argv[2];
const OUT = process.argv[3];
const TITLE = process.argv[4] || 'eulim application';
const BUILD = process.argv[5] || 'EU-XXX-000000-00';
const SAFE  = process.argv.includes('--template');   // .dc 템플릿 파일용 안전 모드

const BANNER = `<!--
  ═══════════════════════════════════════════════════════════════
  ${TITLE}
  Copyright (c) 2026 eulim. All rights reserved.

  본 저작물의 소스코드·화면 구성·데이터 구조·지표 설계는
  eulim의 저작물입니다. 저작권자의 사전 서면 동의 없이
  복제·수정·배포·상업적 이용을 금합니다.

  This source code is proprietary. Unauthorized copying,
  modification, distribution, or commercial use is prohibited.

  Contact : biblical@naver.com
  Build   : ${BUILD}
  ═══════════════════════════════════════════════════════════════
-->
`;

let src = readFileSync(SRC, 'utf8');

// ── clean-css 버그 회피 ────────────────────────────────────
// .001ms 같은 극소 시간값을 NaNs 로 잘못 변환하는 문제가 있어
// 의미가 동일한 1ms 로 미리 정규화합니다. (prefers-reduced-motion 리셋)
const CSSBUG = /(\banimation-duration\s*:\s*|\btransition-duration\s*:\s*)\.?0*\.001ms/g;
const bugHits = (src.match(CSSBUG) || []).length;
if (bugHits) {
  src = src.replace(CSSBUG, '$11ms');
  console.log(`  · clean-css 시간값 버그 회피: .001ms → 1ms  (${bugHits}건)`);
}

const out = await minifyHtml(src, {
  // ── HTML ────────────────────────────────────────────────
  // ── 템플릿 안전장치 ─────────────────────────────────────
  // .dc 프레임워크는 onClick 처럼 대소문자를 구분하는 속성을 쓰고,
  // 그 값이 {{ 표현식 }} 이라 JS 로 파싱하면 사라집니다.
  caseSensitive: SAFE,             // 속성명 소문자화 방지
  customEventAttributes: SAFE ? [] : undefined,  // on* 속성 JS 미니파이 비활성

  removeComments: true,            // HTML 주석 제거
  collapseWhitespace: true,
  conservativeCollapse: SAFE,     // 템플릿 모드: 공백 1칸 보존
  conservativeCollapse: false,
  preserveLineBreaks: false,
  removeAttributeQuotes: false,    // 안전을 위해 따옴표 유지
  removeRedundantAttributes: false,
  removeEmptyAttributes: false,
  keepClosingSlash: true,
  minifyCSS: !SAFE,               // 템플릿 모드에서는 CSS 미니파이 비활성

  // ── JS ──────────────────────────────────────────────────
  minifyJS: {
    ecma: 2020,
    compress: {
      drop_console: false,         // 저작권 배너 console.log 보존
      drop_debugger: true,
      passes: 2,
    },
    mangle: {
      toplevel: false,             // ★ 전역 이름 보존 — 동작 안정성 최우선
    },
    format: {
      comments: /^!/,              // /*! 저작권 주석만 보존
      ascii_only: false,
    },
  },
});

writeFileSync(OUT, BANNER + out, 'utf8');

const a = Buffer.byteLength(src), b = Buffer.byteLength(BANNER + out);
console.log(`${SRC}`);
console.log(`  ${a.toLocaleString()} → ${b.toLocaleString()} bytes  (${(100 - b / a * 100).toFixed(1)}% 감소)`);
