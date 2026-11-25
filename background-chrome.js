'use strict';

/* 크롬용 백그라운드 (서비스 워커). 파이어폭스는 background.js 를 쓴다.

   크롬 MV3 는 일반 사용자 설치 확장기능에 차단형 webRequest 를 허용하지 않으므로,
   background.js 와 같은 일을 declarativeNetRequest 세션 규칙으로 한다.
   1) 팝업에서 나가는 요청의 User-Agent 를 모바일로, Accept-Language 를 팝업 언어로 바꾼다.
   2) 혹시 네이버가 나중에 X-Frame-Options 를 붙여도 팝업 안에서는 무력화한다.

   "팝업에서 나간 요청"은 tabId 가 -1(어느 탭에도 속하지 않음)인 것으로 가린다.
   확장기능 팝업은 탭이 아니어서, 그 안의 아이프레임과 하위 리소스 요청이 모두 -1 이 된다.
   일반 탭의 네이버는 건드리지 않는다.

   파이어폭스판과 다른 점
   - DICT_LOCALE3 쿠키는 요청 헤더에서 뺄 수 없다 (declarativeNetRequest 는 쿠키 헤더를
     통째로 지우거나 둘 수만 있다). 페이지 안의 document.cookie 에서는 content/page-patch.js
     가 여전히 가린다.
   - CSP frame-ancestors 는 지시어 하나만 골라 뺄 수 없어 손대지 않는다.
     (2026-09 확인 기준으로 네이버는 X-Frame-Options 도 CSP frame-ancestors 도 보내지 않는다.) */

importScripts('common/defaults.js', 'common/open-mode.js');

const NVD_RULE_REQUEST = 1;
const NVD_RULE_RESPONSE = 2;

/* NVD_HOST_ORIGINS 와 같은 범위 (하위 도메인 포함) */
const NVD_REQUEST_DOMAINS = ['naver.com', 'naver.net', 'pstatic.net'];

function nvdBuildRules(cfg) {
  const rules = [];
  const headers = [];

  if (cfg.forceMobileView) {
    headers.push({ header: 'User-Agent', operation: 'set', value: cfg.mobileUserAgent || NVD_MOBILE_UA });
    /* 크롬은 클라이언트 힌트 헤더로도 데스크톱임을 알리므로 함께 모바일로 맞춘다 */
    headers.push({ header: 'Sec-CH-UA-Mobile', operation: 'set', value: '?1' });
    headers.push({ header: 'Sec-CH-UA-Platform', operation: 'set', value: '"Android"' });
  }

  const langs = nvdLanguageTags(cfg);
  if (langs) {
    /* 사전홈은 이 헤더로 화면 언어를 정한다 */
    headers.push({ header: 'Accept-Language', operation: 'set', value: nvdAcceptLanguage(langs) });
  }

  if (headers.length) {
    rules.push({
      id: NVD_RULE_REQUEST,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: headers },
      condition: { tabIds: [-1], requestDomains: NVD_REQUEST_DOMAINS }
    });
  }

  rules.push({
    id: NVD_RULE_RESPONSE,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [{ header: 'X-Frame-Options', operation: 'remove' }]
    },
    condition: { tabIds: [-1], requestDomains: NVD_REQUEST_DOMAINS, resourceTypes: ['sub_frame'] }
  });

  return rules;
}

/* 설정이 바뀌는 대로 규칙을 통째로 갈아 끼운다 */
let nvdSyncing = Promise.resolve();

function nvdSyncRules() {
  nvdSyncing = nvdSyncing.then(async () => {
    try {
      const cfg = await nvdLoadSettings();
      const existing = await chrome.declarativeNetRequest.getSessionRules();
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: existing.map((r) => r.id),
        addRules: nvdBuildRules(cfg)
      });
    } catch (e) {
      console.warn('[네이버 사전 팝업] 요청 규칙 등록 실패:', e);
    }
  });
  return nvdSyncing;
}

/* 세션 규칙은 브라우저를 다시 켜면 사라지므로 시작할 때마다 다시 등록한다.
   서비스 워커가 깨어날 때마다 아래 최상위 호출도 한 번씩 돈다. */
chrome.runtime.onStartup.addListener(nvdSyncRules);
chrome.runtime.onInstalled.addListener(nvdSyncRules);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (keys.every((k) => k === 'lastTabId' || k === 'lastUrl')) return;
  nvdSyncRules();
});

nvdSyncRules();

/* 크롬은 확장 팝업 안의 페이지 스크립트에게 SameSite=Lax 쿠키(로그인 쿠키 NID_SES 등)를
   document.cookie 로 보여 주지 않는다. 네이버는 그걸 보고 로그인 여부를 판단하므로,
   팝업 프레임의 콘텐츠 스크립트가 물으면 그 주소의 쿠키 중 HttpOnly 가 아닌 것만 돌려준다.
   일반 탭이라면 같은 페이지가 직접 읽을 수 있었던 범위다. */
const NVD_POPUP_PAGE = chrome.runtime.getURL('popup/');

function nvdFromPopupFrame(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (!sender.frameId) return false;                         /* 최상위 문서(일반 탭)는 제외 */
  if (!sender.tab) return true;                              /* 툴바 팝업은 탭이 아니다 */
  return typeof sender.tab.url === 'string' && sender.tab.url.startsWith(NVD_POPUP_PAGE);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'nvd-popup-cookies') return;
  if (!nvdFromPopupFrame(sender)) return;

  let url;
  try { url = new URL(sender.url); } catch (e) { return; }
  if (url.protocol !== 'https:' || !/(^|\.)naver\.com$/.test(url.hostname)) return;

  chrome.cookies.getAll({ url: url.href })
    .then((list) => sendResponse(list.filter((c) => !c.httpOnly).map((c) => [c.name, c.value])))
    .catch(() => sendResponse([]));
  return true;
});
