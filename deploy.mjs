#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  eulim-site  빌드 + 배포
//
//  wrangler.jsonc 의 assets.directory 가 "." 이므로
//  배포 파일은 프로젝트 루트에 놓입니다.
//  원본은 _src/ 에 두고 .assetsignore 로 배포에서 제외합니다.
//
//      _src/index.html      원본 (주석 포함, 배포 안 됨)
//          │  build.mjs
//          ▼
//      index.html           미니파이본 (배포됨)
//
//  사용법
//      node deploy.mjs            빌드 + 배포
//      node deploy.mjs build      빌드만
//      node deploy.mjs deploy     배포만
// ═══════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const ROOT = dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);

const SRC = '_src';
const MODE = (process.argv[2] || 'all').toLowerCase();

// 원본, 출력, 제목, 빌드ID, 템플릿 여부
const TARGETS = [
  ['index.html',                  'index.html',                  'eulim · PROCESS_ not screens',             'EU-HUB-260903-K7', false],
  // schedule-manager 공개 주소(/schedule-manager/)는 index.html = 현재 버전(A4), 직전 버전은 index0.html (이력: _src/schedule-manager/VERSIONS.md)
  ['schedule-manager/index-260917-A4.html', 'schedule-manager/index.html',  'Agent UX · 사람+에이전트 프로젝트 매니저', 'EU-AUX-260917-A4', false],
  ['schedule-manager/index.html',           'schedule-manager/index0.html', 'Agent UX · 사람+에이전트 프로젝트 매니저', 'EU-AUX-260903-J5', false],
  // 버전별 파일 — 새 버전은 파일명을 따로 만들고 기존 파일은 덮어쓰지 않습니다
  ['schedule-manager/index-260915-A1.html', 'schedule-manager/index-260915-A1.html', 'Agent UX · 사람+에이전트 프로젝트 매니저', 'EU-AUX-260915-A1', false],
  ['schedule-manager/index-260917-A1.html', 'schedule-manager/index-260917-A1.html', 'Agent UX · 사람+에이전트 프로젝트 매니저', 'EU-AUX-260917-A1', false],
  ['schedule-manager/index-260917-A2.html', 'schedule-manager/index-260917-A2.html', 'Agent UX · 사람+에이전트 프로젝트 매니저', 'EU-AUX-260917-A2', false],
  ['schedule-manager/index-260917-A3.html', 'schedule-manager/index-260917-A3.html', 'Agent UX · 사람+에이전트 프로젝트 매니저', 'EU-AUX-260917-A3', false],
  ['case-lms.html',               'case-lms.html',               '기업교육 SaaS 관리자 · 케이스 스터디',      'EU-CSL-260903-R9', false],
  ['LMS-SaaS-admin.html',         'LMS-SaaS-admin.html',         '기업교육 SaaS 관리자 콘솔',                'EU-LMS-260903-T4', true],
  ['OPS/Ops Console.dc.html',     'OPS/Ops Console.dc.html',     'ROGin Core · AI 퀀트 미들웨어',            'EU-ROG-260903-B6', true],
];

const CACHE_URLS = [
  'https://eulim.dataplaner.workers.dev/',
  'https://eulim.dataplaner.workers.dev/schedule-manager/index.html',
  'https://eulim.dataplaner.workers.dev/case-lms',
  'https://eulim.dataplaner.workers.dev/LMS-SaaS-admin',
  'https://eulim.dataplaner.workers.dev/OPS/Ops%20Console.dc.html',
];

const line = (s = '') => console.log(s);
const rule = () => line('  ' + '─'.repeat(52));

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a.trim().toLowerCase()); }));
}

function die(msg) {
  line();
  rule();
  line('  실패 — ' + msg);
  rule();
  line();
  process.exit(1);
}

line();
rule();
line(`  eulim-site  deploy      mode: ${MODE}`);
rule();
line();

// ── 사전 점검 ───────────────────────────────────────────────────
if (!existsSync('wrangler.jsonc') && !existsSync('wrangler.toml')) {
  die('wrangler 설정이 없습니다. 프로젝트 루트에서 실행하세요.');
}

if (!existsSync('.assetsignore')) {
  line('  [!] .assetsignore 가 없습니다.');
  line('      assets.directory 가 "." 이라 _src, build.mjs, wrangler.jsonc 까지');
  line('      전부 공개 웹에 올라갑니다.');
  line();
  const a = await ask('  그래도 계속할까요? (y/N) ');
  if (a !== 'y') die('중단했습니다. .assetsignore 를 먼저 만드세요.');
  line();
}

// ── [1] 빌드 ────────────────────────────────────────────────────
if (MODE !== 'deploy') {
  if (!existsSync('build.mjs')) die('build.mjs 가 없습니다.');
  if (!existsSync('node_modules/html-minifier-terser')) {
    line('  [!] 빌드에 필요한 패키지가 설치되어 있지 않습니다.');
    line();
    line('      이 폴더에서 아래 명령을 한 번만 실행하세요.');
    line('        npm install html-minifier-terser');
    line();
    die('의존성 없음');
  }
  if (!existsSync(SRC)) {
    line(`  원본 폴더 "${SRC}" 가 없습니다. 아래 구조로 넣어 주세요.`);
    line();
    TARGETS.forEach(t => line(`      ${SRC}/${t[0]}`));
    die('원본 폴더 없음');
  }

  line('  [1/3] 빌드');
  line();

  for (const dir of ['schedule-manager', 'OPS']) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  let built = 0, skipped = 0;
  for (const [src, out, title, id, tpl] of TARGETS) {
    const from = join(SRC, src);
    if (!existsSync(from)) {
      line(`   [!] ${src} 없음 — 건너뜀`);
      skipped++;
      continue;
    }
    line(`   · ${src}`);
    const args = ['build.mjs', from, out, title, id];
    if (tpl) args.push('--template');
    const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (r.status !== 0) die(`빌드 실패: ${src}`);
    built++;
  }

  // .dc 는 .dc.html 과 동일 내용
  if (existsSync('OPS/Ops Console.dc.html')) {
    copyFileSync('OPS/Ops Console.dc.html', 'OPS/Ops Console.dc');
  }

  line();
  line(`   빌드 완료 — ${built}개 처리${skipped ? `, ${skipped}개 건너뜀` : ''}`);
  line();

  if (MODE === 'build') {
    rule();
    line('  빌드만 실행했습니다. 결과를 확인한 뒤 배포하세요.');
    rule();
    line();
    process.exit(0);
  }
}

// ── [2] 배포 ────────────────────────────────────────────────────
line('  [2/3] Cloudflare 배포');
line('        (최초 실행 시 브라우저 로그인 창이 열립니다)');
line();

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const dep = spawnSync(npx, ['--yes', 'wrangler@latest', 'deploy'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (dep.status !== 0) die('wrangler 배포가 실패했습니다. 위 메시지를 확인하세요.');

line();
line('   배포 완료 — https://eulim.dataplaner.workers.dev');
line();

// ── [3] 캐시 초기화 안내 ────────────────────────────────────────
line('  [3/3] 카카오톡 OG 캐시');
line();
line('   이미지 파일명이 그대로면 캐시가 자동 갱신되지 않습니다.');
line('   아래 주소를 디버거에 하나씩 넣고 초기화하세요.');
line();
CACHE_URLS.forEach(u => line('     ' + u));
line();

const open = await ask('  디버거를 지금 열까요? (y/N) ');
if (open === 'y') {
  const url = 'https://developers.kakao.com/tool/clear/og';
  const cmd = process.platform === 'win32' ? 'start'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawnSync(cmd, [url], { shell: true, stdio: 'ignore' });
}

line();
rule();
line('  완료');
rule();
line();
