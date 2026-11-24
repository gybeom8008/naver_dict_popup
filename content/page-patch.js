'use strict';

/* 페이지 자신의 공간(world: MAIN)에서 document_start 에 실행된다.
   우리 팝업 아이프레임일 때만 navigator 의 userAgent·언어를 설정대로 바꿔 보인다.
   (HTTP 헤더는 백그라운드가 이미 바꾸지만, 언어별 사전은 SPA라서
    브라우저 안에서 navigator 를 직접 보고 모바일 여부와 표시 언어를 정한다.)

   이 파일은 페이지와 같은 공간에서 돌기 때문에 확장기능 API 도, common/defaults.js 도
   쓸 수 없다. 필요한 값은 팝업이 아이프레임 이름에
   "nvd-popup-view|ua=...&lang=ko-KR,ko" 형태로 넣어 준다.
   전역 이름을 남기지 않도록 즉시 실행 함수로 감싼다. */

(() => {
  /* common/defaults.js 의 NVD_FRAME_NAME 과 같아야 한다 */
  const FRAME_NAME = 'nvd-popup-view';

  let name = '';
  try { name = window.name || ''; } catch (e) { return; }

  const pieces = name.split('|');
  if (window.top === window.self || pieces[0] !== FRAME_NAME || !pieces[1]) return;

  const params = new URLSearchParams(pieces[1]);
  const ua = params.get('ua') || null;
  const langs = params.get('lang') ? params.get('lang').split(',') : null;
  if (!ua && !langs) return;

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
})();
