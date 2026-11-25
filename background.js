'use strict';

/* 파이어폭스용 백그라운드. 크롬은 차단형 webRequest 를 쓸 수 없어 background-chrome.js 를 쓴다.

   하는 일
   1) 팝업 아이프레임에서 나가는 요청의 User-Agent 를 모바일로 바꿔 모바일 페이지를 받고,
      Accept-Language 를 팝업 언어 설정으로 바꾼다.
   2) 혹시 네이버가 나중에 프레임 차단 헤더를 붙여도 팝업 안에서는 무력화한다.
      (2026-09 확인 기준으로는 X-Frame-Options / CSP frame-ancestors 를 보내지 않는다.)

   두 동작 모두 "우리 팝업에서 시작된 요청"에만 적용한다. 일반 탭의 네이버는 건드리지 않는다. */

const NVD_EXT_PREFIX = browser.runtime.getURL('/');
const NVD_FILTER = { urls: NVD_HOST_ORIGINS };

let nvdCfg = nvdMergeSettings(null);

nvdLoadSettings().then((s) => { nvdCfg = s; });

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  nvdLoadSettings().then((s) => { nvdCfg = s; });
});

/* 요청이 우리 확장기능 페이지(팝업) 안에서 시작됐는지 판별.
   - 아이프레임 자체(sub_frame): documentUrl / originUrl 이 moz-extension:// 팝업
   - 그 안의 하위 리소스: frameAncestors 에 팝업 URL 이 들어 있다 (Firefox 전용 필드) */
function nvdFromPopup(details) {
  if (details.documentUrl && details.documentUrl.startsWith(NVD_EXT_PREFIX)) return true;
  if (details.originUrl && details.originUrl.startsWith(NVD_EXT_PREFIX)) return true;
  const ancestors = details.frameAncestors;
  if (Array.isArray(ancestors)) {
    for (const a of ancestors) {
      if (a && typeof a.url === 'string' && a.url.startsWith(NVD_EXT_PREFIX)) return true;
    }
  }
  return false;
}

function nvdOnBeforeSendHeaders(details) {
  const langs = nvdLanguageTags(nvdCfg);
  if (!nvdCfg.forceMobileView && !langs) return;
  if (!nvdFromPopup(details)) return;

  let headers = details.requestHeaders;
  const replace = (name, value) => {
    headers = headers.filter((h) => h.name.toLowerCase() !== name.toLowerCase());
    headers.push({ name: name, value: value });
  };

  if (nvdCfg.forceMobileView) {
    replace('User-Agent', nvdCfg.mobileUserAgent || NVD_MOBILE_UA);
  }

  if (langs) {
    /* 사전홈은 이 헤더로 화면 언어를 정한다 */
    replace('Accept-Language', nvdAcceptLanguage(langs));

    /* 네이버 언어 메뉴로 고른 언어(DICT_LOCALE3 쿠키)가 설정보다 앞서지 않도록 뺀다 */
    headers = headers.map((h) => {
      if (h.name.toLowerCase() !== 'cookie') return h;
      const kept = h.value.split(/;\s*/).filter((c) => !c.startsWith('DICT_LOCALE3='));
      return { name: h.name, value: kept.join('; ') };
    });
  }

  return { requestHeaders: headers };
}

function nvdOnHeadersReceived(details) {
  if (details.type !== 'sub_frame') return;
  if (!nvdFromPopup(details)) return;

  const kept = [];
  let changed = false;

  for (const header of details.responseHeaders) {
    const name = header.name.toLowerCase();

    if (name === 'x-frame-options') {
      changed = true;
      continue;
    }

    if (name === 'content-security-policy' || name === 'content-security-policy-report-only') {
      const parts = header.value.split(';');
      const survivors = parts.filter((p) => !/^\s*frame-ancestors\b/i.test(p));
      if (survivors.length !== parts.length) {
        changed = true;
        const value = survivors.join(';').trim();
        if (value) kept.push({ name: header.name, value: value });
        continue;
      }
    }

    kept.push(header);
  }

  return changed ? { responseHeaders: kept } : undefined;
}

try {
  browser.webRequest.onBeforeSendHeaders.addListener(
    nvdOnBeforeSendHeaders,
    NVD_FILTER,
    ['blocking', 'requestHeaders']
  );
  browser.webRequest.onHeadersReceived.addListener(
    nvdOnHeadersReceived,
    NVD_FILTER,
    ['blocking', 'responseHeaders']
  );
} catch (e) {
  /* 호스트 권한이 아직 허용되지 않은 경우 등 — 팝업에서 권한 요청 배너를 띄운다. */
  console.warn('[네이버 사전 팝업] webRequest 등록 실패:', e);
}
