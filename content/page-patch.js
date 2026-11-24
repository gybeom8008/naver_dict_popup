'use strict';

/* 페이지 자신의 공간(world: MAIN)에서 document_start 에 실행된다.
   우리 팝업 아이프레임일 때만 navigator 의 userAgent·언어를 설정대로 바꿔 보인다.
   (HTTP 헤더는 백그라운드가 이미 바꾸지만, 언어별 사전은 SPA라서
    브라우저 안에서 navigator 를 직접 보고 모바일 여부와 표시 언어를 정한다.)

   이 파일은 페이지와 같은 공간에서 돌기 때문에 확장기능 API 도, common/defaults.js 도
   쓸 수 없다. 필요한 값은 팝업이 아이프레임 이름에
   "nvd-popup-view|ua=...&lang=ko-KR,ko&ck=..." 형태로 넣어 준다.
   ck 는 크롬에서만 붙는 쿠키 보충 목록인데, 페이지 스크립트가 돌기 전에 꺼내고
   창 이름에서 바로 지운다. 그 뒤 프레임 안에서 페이지를 옮겨 다니면
   content/naver-dict.js 가 'nvd-popup-cookies' 이벤트로 다시 건네준다.
   전역 이름을 남기지 않도록 즉시 실행 함수로 감싼다. */

(() => {
  /* common/defaults.js 의 NVD_FRAME_NAME 과 같아야 한다 */
  const FRAME_NAME = 'nvd-popup-view';

  let name = '';
  try { name = window.name || ''; } catch (e) { return; }

  const pieces = name.split('|');
  if (window.top === window.self || pieces[0] !== FRAME_NAME) return;

  const params = new URLSearchParams(pieces[1] || '');
  const ua = params.get('ua') || null;
  const langs = params.get('lang') ? params.get('lang').split(',') : null;

  /* 쿠키 값이 창 이름에 남아 있으면 이 프레임이 나중에 다른 사이트로 옮겨 갔을 때
     그 사이트가 읽을 수 있다. 꺼내자마자 지운다. */
  let initialCookies = null;
  if (params.has('ck')) {
    try { initialCookies = JSON.parse(params.get('ck')); } catch (e) {}
    params.delete('ck');
    const rest = params.toString();
    try { window.name = rest ? FRAME_NAME + '|' + rest : FRAME_NAME; } catch (e) {}
  }

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
      define('vendor', /Chrome\//.test(ua) ? 'Google Inc.' : '');

      /* 크롬 계열은 navigator.userAgentData 로도 모바일 여부를 알려 준다 */
      const real = navigator.userAgentData;
      if (real) {
        const patchValues = (v) => Object.assign({}, v, { mobile: true, platform: 'Android' });
        const fake = {
          brands: real.brands,
          mobile: true,
          platform: 'Android',
          getHighEntropyValues: (hints) => real.getHighEntropyValues(hints).then(patchValues),
          toJSON: () => ({ brands: real.brands, mobile: true, platform: 'Android' })
        };
        define('userAgentData', fake);
      }
    }

    /* 네이버는 navigator.languages 가 한국어가 아니면 외국인용 사전으로 보낸다 */
    if (langs) {
      define('language', langs[0]);
      define('languages', Object.freeze(langs.slice()));
    }
  } catch (e) {}

  /* ── document.cookie ──────────────────────────────────
     1) 크롬은 확장 팝업 안의 페이지 스크립트에게 SameSite=Lax 쿠키(로그인 쿠키 NID_SES 등)를
        숨긴다. 요청에는 실리므로 서버는 로그인 상태로 보지만, 네이버 스크립트는
        document.cookie 에 NID_SES 가 없으면 로그아웃으로 판단해 검색 기록 등을 막는다.
        그래서 콘텐츠 스크립트가 확장기능에서 받아 온 쿠키(일반 탭이라면 이 페이지가
        읽을 수 있었을 것, 즉 HttpOnly 가 아닌 것)를 보충해 보인다.
     2) 팝업 언어를 정했으면 네이버 언어 메뉴로 고른 언어(DICT_LOCALE3 쿠키)가
        설정보다 앞서지 않도록 가린다. */
  try {
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (!cookie || !cookie.get || !cookie.set) return;

    const valid = (list) => Array.isArray(list)
      ? list.filter((c) => Array.isArray(c) && c.length === 2 &&
          typeof c[0] === 'string' && typeof c[1] === 'string')
      : [];

    let extra = valid(initialCookies);   /* [이름, 값] 목록 */

    document.addEventListener('nvd-popup-cookies', (event) => {
      try {
        const list = valid(JSON.parse(event.detail));
        if (list.length) extra = list;
      } catch (e) {}
    });

    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get() {
        const real = cookie.get.call(this);
        const parts = real ? real.split(/;\s*/) : [];
        const seen = new Set(parts.map((c) => c.split('=')[0]));
        for (const [n, v] of extra) {
          if (!seen.has(n)) parts.push(n + '=' + v);
        }
        return (langs ? parts.filter((c) => !c.startsWith('DICT_LOCALE3=')) : parts).join('; ');
      },
      set(value) {
        cookie.set.call(this, value);

        /* 보충 목록에 있는 쿠키를 페이지가 바꾸면, 크롬이 그 쓰기를 막더라도
           페이지에는 바꾼 값(지웠으면 지운 상태)이 보이게 한다 */
        const text = String(value);
        const first = text.split(';')[0];
        const eq = first.indexOf('=');
        if (eq < 0) return;
        const n = first.slice(0, eq).trim();
        if (!extra.some((c) => c[0] === n)) return;

        const attrs = text.slice(first.length).toLowerCase();
        const maxAge = attrs.match(/;\s*max-age\s*=\s*(-?\d+)/);
        const expires = attrs.match(/;\s*expires\s*=\s*([^;]+)/);
        const removed = (maxAge && Number(maxAge[1]) <= 0) ||
          (!maxAge && expires && Date.parse(expires[1]) <= Date.now());

        extra = extra.filter((c) => c[0] !== n);
        if (!removed) extra.push([n, first.slice(eq + 1).trim()]);
      }
    });
  } catch (e) {}
})();
