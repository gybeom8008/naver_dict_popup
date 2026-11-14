'use strict';

/* 네이버 사전 페이지(팝업 안이든 일반 탭이든)에서 하는 일
   1) 우리 팝업 아이프레임일 때만 navigator 의 userAgent·언어를 설정대로 바꿔 보인다.
      (HTTP 헤더는 백그라운드가 이미 바꾸지만, 언어별 사전은 SPA라서
       브라우저 안에서 navigator 를 직접 보고 모바일 여부와 표시 언어를 정한다.)
   2) 페이지가 다 뜬 뒤 검색창에 커서를 놓는다.

   2번이 필요한 이유: 네이버 사전은 검색창에 자동 포커스를 주지 않는다
   (번들에 autofocus 속성도, 검색창 focus() 호출도 없다). 그래서 페이지를 열고
   바로 타이핑하면 첫 글자는 IME(한/영) 상태가 확정되기 전에 들어가 언어가
   뒤바뀌고, 그 뒤에야 제대로 전환된다. 검색창을 직접 한 번 클릭하면 괜찮은
   이유도 이것이다. 그래서 클릭 대신 우리가 로딩이 끝난 뒤 포커스를 준다.
   입력 언어는 건드리지 않는다. */

(() => {
  /* 검색창 후보 (앞에서부터 먼저 맞는 것) */
  const SEARCH_SELECTORS = [
    '#ac_input',              /* 사전홈 PC + 모든 언어 사전 SPA */
    '#serch_val',             /* 사전홈 모바일 */
    'input[name="query"]',
    'input.keyword',
    'input[type="search"]'
  ];

  /* load 이후 이만큼 기다렸다 포커스한다 (페이지 스크립트가 다 돌도록) */
  const AFTER_LOAD_DELAY = 250;
  /* SPA 가 검색창을 늦게 그리므로 나타날 때까지 확인한다 */
  const POLL_INTERVAL = 150;
  const POLL_LIMIT = 40;       /* 약 6초 */
  /* 포커스가 먹었는지 확인하고 한 번 더 시도 */
  const VERIFY_DELAY = 250;

  let enabled = false;
  let debug = false;
  let started = false;
  let userActed = false;

  /* ─── 0) 팝업 아이프레임이면 navigator 를 설정대로 바꿔 보인다 (동기 실행) ─── */

  /* 팝업이 아이프레임 이름에 "nvd-popup-view|ua=...&lang=ko-KR,ko" 형태로 넣어 준다 */
  const frameName = (() => {
    try { return window.name || ''; } catch (e) { return ''; }
  })();
  const framePieces = frameName.split('|');
  const IN_POPUP = window.top !== window.self && framePieces[0] === NVD_FRAME_NAME;

  if (IN_POPUP && framePieces[1]) {
    const params = new URLSearchParams(framePieces[1]);
    const ua = params.get('ua') || null;
    const langs = params.get('lang') ? params.get('lang').split(',') : null;
    if (ua || langs) injectIntoPage(pagePatch, [ua, langs]);
  }

  /* 페이지 쪽에서 실행되는 코드. 콘텐츠 스크립트는 분리된 공간에서 돌아
     페이지의 navigator 를 직접 바꿀 수 없으므로 <script> 로 넣는다.
     바깥 변수에 기대지 않아야 한다 (toString 으로 옮겨 가므로). */
  function pagePatch(ua, langs) {
    try {
      const proto = Object.getPrototypeOf(navigator);
      const define = (key, value) => {
        try {
          Object.defineProperty(proto, key, { get: () => value, configurable: true });
        } catch (e) {}
      };

      /* 언어별 사전은 서버 응답이 같고, 모바일 여부를 브라우저 안에서 정한다 */
      if (ua) {
        define('userAgent', ua);
        define('appVersion', ua.replace(/^Mozilla\//, ''));
        define('platform', 'Linux armv8l');
        define('vendor', '');
      }

      /* 네이버는 navigator.languages 가 한국어가 아니면 외국인용 사전으로 보낸다 */
      if (langs) {
        define('language', langs[0]);
        define('languages', Object.freeze(langs.slice()));

        /* 네이버 언어 메뉴로 고른 언어(DICT_LOCALE3 쿠키)가 설정보다 앞서지 않도록 가린다 */
        const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (cookie && cookie.get && cookie.set) {
          Object.defineProperty(Document.prototype, 'cookie', {
            configurable: true,
            get() {
              return cookie.get.call(this)
                .split(/;\s*/)
                .filter((c) => !c.startsWith('DICT_LOCALE3='))
                .join('; ');
            },
            set(value) {
              cookie.set.call(this, value);
            }
          });
        }
      }
    } catch (e) {}
  }

  function injectIntoPage(fn, args) {
    try {
      const host = document.head || document.documentElement;
      if (!host) return;
      const script = document.createElement('script');
      script.textContent = '(' + fn.toString() + ').apply(null, ' + JSON.stringify(args) + ');';
      host.appendChild(script);
      script.remove();
    } catch (e) {
      /* 페이지 CSP 등 — 무시하고 HTTP 헤더 변경만 적용된다 */
    }
  }

  /* ─── 1) 검색창 포커스 ──────────────────────────────── */

  function log(...args) {
    if (debug) console.log('%c[네이버 사전]', 'color:#03c75a;font-weight:bold', ...args);
  }

  /* 사용자가 먼저 움직였으면 우리는 손을 뗀다 */
  const markUser = (why) => () => {
    if (!userActed) {
      userActed = true;
      log('사용자가 먼저 조작함 (' + why + ') — 자동 포커스 취소');
    }
  };
  window.addEventListener('pointerdown', markUser('클릭'), true);
  window.addEventListener('keydown', markUser('입력'), true);
  window.addEventListener('wheel', markUser('스크롤'), { capture: true, passive: true });

  function visible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.offsetParent) return true;
    return el.getClientRects().length > 0;
  }

  function findInput() {
    for (const selector of SEARCH_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(selector); } catch (e) { continue; }
      for (const el of nodes) {
        if (visible(el)) return el;
      }
    }
    return null;
  }

  function alreadyTyping() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function focusInput(el) {
    if (userActed) return;

    /* 배경 탭에서 포커스를 뺏지 않는다 */
    if (!document.hasFocus()) {
      log('이 문서에 포커스가 없음 — 건너뜀');
      return;
    }
    if (alreadyTyping()) {
      log('이미 다른 입력칸을 쓰는 중 — 건너뜀', document.activeElement);
      return;
    }

    try {
      el.focus({ preventScroll: true });
      if (el.value) {
        const end = el.value.length;
        try { el.setSelectionRange(end, end); } catch (e) {}
      }
      log('검색창에 커서를 놓음', el, '| 성공:', document.activeElement === el);
    } catch (e) {
      log('포커스 실패', e);
      return;
    }

    /* 페이지 스크립트가 곧바로 포커스를 가져가는 경우가 있어 한 번 더 확인 */
    setTimeout(() => {
      if (userActed || document.activeElement === el) return;
      if (!document.hasFocus() || alreadyTyping()) return;
      try {
        el.focus({ preventScroll: true });
        log('포커스를 다시 시도함 | 성공:', document.activeElement === el);
      } catch (e) {}
    }, VERIFY_DELAY);
  }

  function hunt(attempt) {
    if (!enabled || userActed) return;

    const el = findInput();
    if (el) {
      focusInput(el);
      return;
    }
    if (attempt < POLL_LIMIT) {
      setTimeout(() => hunt(attempt + 1), POLL_INTERVAL);
    } else {
      log('검색창을 찾지 못함 —', SEARCH_SELECTORS.join(', '));
    }
  }

  function start() {
    if (started || !enabled) return;
    started = true;

    const begin = () => setTimeout(() => hunt(0), AFTER_LOAD_DELAY);
    if (document.readyState === 'complete') begin();
    else window.addEventListener('load', begin, { once: true });
  }

  /* ─── 2) 팝업에 현재 검색어·주소 알리기 ──────────────── */

  let lastSent = { query: null, url: null };

  function queryFromUrl() {
    const source = (location.hash || '') + ' ' + (location.search || '');
    const match = source.match(/[?&]query=([^&\s]*)/);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch (e) {
      return '';
    }
  }

  function report() {
    const el = findInput();
    const query = el && el.value ? el.value : queryFromUrl();
    const url = location.href;
    if (query === lastSent.query && url === lastSent.url) return;
    lastSent = { query: query, url: url };
    try {
      const sending = browser.runtime.sendMessage({
        type: 'nvd-view-state',
        query: query,
        url: url
      });
      if (sending && sending.catch) sending.catch(() => {});
    } catch (e) {}
  }

  function watchView() {
    window.addEventListener('hashchange', report);
    window.addEventListener('popstate', report);
    window.addEventListener('input', report, true);
    /* SPA 가 pushState 로 이동하는 경우까지 놓치지 않도록 가볍게 확인 */
    setInterval(report, 1000);
    report();
  }

  /* ─── 설정 적용 ─────────────────────────────────────── */

  function applySettings(settings) {
    const first = !started && !enabled;
    enabled = IN_POPUP ? !!settings.autoFocusInPopup : !!settings.autoFocusInTab;
    debug = !!settings.imeDebug;

    if (first) {
      log('검색창 자동 포커스:', enabled ? '켜짐' : '꺼짐',
        '| 위치:', IN_POPUP ? '팝업' : '탭',
        '| readyState:', document.readyState);
    }
    if (enabled) start();
  }

  if (IN_POPUP) {
    if (document.readyState === 'complete') watchView();
    else window.addEventListener('load', watchView, { once: true });
  }

  nvdLoadSettings().then(applySettings);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    nvdLoadSettings().then(applySettings);
  });
})();
