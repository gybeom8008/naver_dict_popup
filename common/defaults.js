'use strict';

/* 팝업 / 설정 / 백그라운드 / 콘텐츠 스크립트가 함께 쓰는 기본값과 헬퍼.
   모듈이 아닌 일반 스크립트이므로 이름 충돌을 피해 NVD_ 접두사를 쓴다. */

/* 크롬에는 browser 네임스페이스가 없다. MV3 크롬의 chrome.* 는 프로미스를 돌려주므로
   그대로 browser 라는 이름으로 써도 된다. 파이어폭스에서는 아무것도 하지 않는다. */
if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
  globalThis.browser = globalThis.chrome;
}

const NVD_IS_FIREFOX = typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);

/* 헤더 조작·아이프레임 삽입에 필요한 호스트 권한 (파이어폭스 MV3에서는 사용자가 허용해야 함).
   사전만 쓰지만 naver.com 전체를 둔다. 크롬은 확장 팝업 안의 요청에 대해 권한이 있는
   주소에만 SameSite=Lax/Strict 쿠키를 보내므로, 로그인 상태를 묻는 nid·gnb.naver.com 까지
   권한이 있어야 팝업에서도 로그인이 이어진다. */
const NVD_HOST_ORIGINS = [
  '*://*.naver.com/*',
  '*://*.naver.net/*',
  '*://*.pstatic.net/*'
];

/* 팝업 안의 아이프레임임을 콘텐츠 스크립트가 동기적으로 알아내기 위한 표식.
   document_start 시점에 window.name 으로 읽는다. */
const NVD_FRAME_NAME = 'nvd-popup-view';

/* 모바일 UA 기본값은 지금 쓰는 브라우저의 안드로이드판으로 한다 */
const NVD_MOBILE_UA = NVD_IS_FIREFOX
  ? 'Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0'
  : 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';

/* 네이버 사전이 제공하는 사전 목록. 탭은 이 목록의 id 로만 저장하므로
   사용자가 주소를 직접 입력할 일이 없다. (dict.naver.com 홈에서 추출) */
const NVD_DICTS = [
  { id: "home",          label: "사전홈",        url: "https://dict.naver.com/" },
  { id: "ko",            label: "국어",          url: "https://ko.dict.naver.com/" },
  { id: "en",            label: "영어",          url: "https://en.dict.naver.com/" },
  { id: "ja",            label: "일본어",        url: "https://ja.dict.naver.com/" },
  { id: "zh",            label: "중국어",        url: "https://zh.dict.naver.com/" },
  { id: "hanja",         label: "한자",          url: "https://hanja.dict.naver.com/" },
  { id: "dutch",         label: "네덜란드어",     url: "https://dict.naver.com/dutch/" },
  { id: "nepali",        label: "네팔어",        url: "https://dict.naver.com/nepali/" },
  { id: "nokodict",      label: "노르웨이어",     url: "https://dict.naver.com/nokodict/" },
  { id: "dakodict",      label: "덴마크어",      url: "https://dict.naver.com/dakodict/" },
  { id: "deutsch",       label: "독일어",        url: "https://dict.naver.com/deutsch/" },
  { id: "lokodict",      label: "라오어",        url: "https://dict.naver.com/lokodict/" },
  { id: "latin",         label: "라틴어",        url: "https://dict.naver.com/latin/" },
  { id: "russian",       label: "러시아어",      url: "https://dict.naver.com/russian/" },
  { id: "romanian",      label: "루마니아어",     url: "https://dict.naver.com/romanian/" },
  { id: "mongolian",     label: "몽골어",        url: "https://dict.naver.com/mongolian/" },
  { id: "burmese",       label: "미얀마어",      url: "https://dict.naver.com/burmese/" },
  { id: "vietnamese",    label: "베트남어",      url: "https://dict.naver.com/vietnamese/" },
  { id: "swahili",       label: "스와힐리어",     url: "https://dict.naver.com/swahili/" },
  { id: "swedish",       label: "스웨덴어",      url: "https://dict.naver.com/swedish/" },
  { id: "espanol",       label: "스페인어",      url: "https://dict.naver.com/espanol/" },
  { id: "arabic",        label: "아랍어",        url: "https://dict.naver.com/arabic/" },
  { id: "albanian",      label: "알바니아어",     url: "https://dict.naver.com/albanian/" },
  { id: "urkodict",      label: "우르두어",      url: "https://dict.naver.com/urkodict/" },
  { id: "uzbek",         label: "우즈베크어",     url: "https://dict.naver.com/uzbek/" },
  { id: "ukrainian",     label: "우크라이나어",   url: "https://dict.naver.com/ukrainian/" },
  { id: "italian",       label: "이탈리아어",     url: "https://dict.naver.com/italian/" },
  { id: "indonesian",    label: "인도네시아어",   url: "https://dict.naver.com/indonesian/" },
  { id: "georgian",      label: "조지아어",      url: "https://dict.naver.com/georgian/" },
  { id: "czech",         label: "체코어",        url: "https://dict.naver.com/czech/" },
  { id: "kkkodict",      label: "카자흐어",      url: "https://dict.naver.com/kkkodict/" },
  { id: "khmer",         label: "캄보디아어",     url: "https://dict.naver.com/khmer/" },
  { id: "hrkodict",      label: "크로아티아어",   url: "https://dict.naver.com/hrkodict/" },
  { id: "tlkodict",      label: "타갈로그어",     url: "https://dict.naver.com/tlkodict/" },
  { id: "thai",          label: "태국어",        url: "https://dict.naver.com/thai/" },
  { id: "tetum",         label: "테툼어",        url: "https://dict.naver.com/tetum/" },
  { id: "turkish",       label: "튀르키예어",     url: "https://dict.naver.com/turkish/" },
  { id: "persian",       label: "페르시아어",     url: "https://dict.naver.com/persian/" },
  { id: "portuguese",    label: "포르투갈어",     url: "https://dict.naver.com/portuguese/" },
  { id: "polish",        label: "폴란드어",      url: "https://dict.naver.com/polish/" },
  { id: "french",        label: "프랑스어",      url: "https://dict.naver.com/french/" },
  { id: "finnish",       label: "핀란드어",      url: "https://dict.naver.com/finnish/" },
  { id: "hakodict",      label: "하우사어",      url: "https://dict.naver.com/hakodict/" },
  { id: "hungarian",     label: "헝가리어",      url: "https://dict.naver.com/hungarian/" },
  { id: "hindi",         label: "힌디어",        url: "https://dict.naver.com/hindi/" },
  { id: "en-russian",    label: "영어-러시아어",   url: "https://english.dict.naver.com/english-russian-dictionary/" },
  { id: "en-vietnamese", label: "영어-베트남어",   url: "https://english.dict.naver.com/english-vietnamese-dictionary/" },
  { id: "en-spanish",    label: "영어-스페인어",   url: "https://english.dict.naver.com/english-spanish-dictionary/" },
  { id: "en-indonesian", label: "영어-인도네시아어", url: "https://english.dict.naver.com/english-indonesian-dictionary/" },
  { id: "en-japanese",   label: "영어-일본어",    url: "https://english.dict.naver.com/english-japanese-dictionary/" },
  { id: "en-chinese",    label: "영어-중국어",    url: "https://english.dict.naver.com/english-chinese-dictionary/" },
  { id: "en-thai",       label: "영어-태국어",    url: "https://english.dict.naver.com/english-thai-dictionary/" },
  { id: "en-portuguese", label: "영어-포르투갈어",  url: "https://english.dict.naver.com/english-portuguese-dictionary/" }
];

const NVD_DEFAULT_TAB_IDS = ['home', 'ko', 'en', 'ja', 'zh'];

/* 팝업 안 사전의 표시 언어. 네이버는 navigator.languages 가 한국어가 아니면
   외국인용 사전(korean.dict.naver.com/kojadict/ 등)으로 보내 버리므로,
   팝업 프레임에서만 브라우저 언어를 이 값으로 바꿔 보인다. */
const NVD_LANGUAGES = {
  ko:      { label: '한국어',             tags: ['ko-KR', 'ko'] },
  en:      { label: 'English',            tags: ['en-US', 'en'] },
  ja:      { label: '日本語',              tags: ['ja-JP', 'ja'] },
  zh:      { label: '中文',                tags: ['zh-CN', 'zh'] },
  browser: { label: '브라우저 설정 따름', tags: null }
};

/* 팝업 크기 (파이어폭스·크롬 모두 상한 800 x 600) */
const NVD_POPUP_PRESETS = {
  small:  { label: '작게',      width: 340, height: 440 },
  medium: { label: '중간',      width: 420, height: 560 },
  large:  { label: '크게',      width: 560, height: 600 },
  custom: { label: '직접 입력', width: 420, height: 560 }
};

const NVD_DEFAULTS = {
  tabs: NVD_DEFAULT_TAB_IDS,
  defaultTabId: 'home',
  rememberLastTab: false,
  lastTabId: null,

  popupLanguage: 'ko',

  /* 팝업에서 사전을 바꿀 때 검색어를 이어서 검색한다 */
  carryQuery: true,
  /* 팝업을 열 때 기본 탭 대신 마지막으로 보던 화면을 그대로 되살린다 */
  keepLastView: false,
  lastUrl: null,

  popupSize: 'medium',
  popupWidth: 420,
  popupHeight: 560,

  forceMobileView: true,
  mobileUserAgent: NVD_MOBILE_UA,

  /* 사전 페이지가 열리면 검색창에 커서를 놓는다.
     네이버는 검색창에 자동 포커스를 주지 않기 때문에, 바로 타이핑하면
     첫 글자가 IME 상태가 확정되기 전에 들어가 언어가 뒤바뀐다.
     다만 모바일 페이지는 검색창에 포커스가 가면 전체 화면 검색 모드로 바뀌므로
     팝업과 일반 탭을 따로 켜고 끈다. */
  autoFocusInTab: true,
  autoFocusInPopup: true,
  imeDebug: false
};

/* 설정이 아니라 팝업이 스스로 기록하는 값. 이것만 바뀌었을 때는 화면을 다시 그리지 않는다. */
const NVD_VIEW_KEYS = ['lastTabId', 'lastUrl', 'pinned', 'pinBounds'];

const NVD_LIMITS = {
  width:  { min: 300, max: 800 },
  height: { min: 260, max: 600 }
};

function nvdDict(id) {
  return NVD_DICTS.find((d) => d.id === id) || null;
}

/* 주소가 어느 사전의 것인지 (가장 긴 접두사가 이긴다) */
function nvdDictForUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  let best = null;
  for (const dict of NVD_DICTS) {
    if (url.startsWith(dict.url) && (!best || dict.url.length > best.url.length)) best = dict;
  }
  /* https://dict.naver.com/dict.search?query=... 같은 사전홈 검색 결과 */
  if (!best && url.startsWith('https://dict.naver.com/')) best = nvdDict('home');
  return best;
}

/* 사전별 검색 주소. 언어 사전은 SPA 해시 라우트, 사전홈은 서버 페이지. */
function nvdSearchUrl(dict, query) {
  const q = encodeURIComponent(query);
  if (dict.id === 'home') return 'https://dict.naver.com/dict.search?query=' + q;
  return dict.url + '#/search?query=' + q;
}

/* 팝업 언어 설정의 언어 태그 목록 (브라우저 설정을 따르면 null) */
function nvdLanguageTags(settings) {
  const lang = NVD_LANGUAGES[settings.popupLanguage];
  return lang && lang.tags ? lang.tags.slice() : null;
}

/* ['ko-KR', 'ko'] → 'ko-KR,ko;q=0.9' */
function nvdAcceptLanguage(tags) {
  return tags.map((tag, i) => (i === 0 ? tag : tag + ';q=' + (1 - i / 10).toFixed(1))).join(',');
}

function nvdClamp(value, { min, max }, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* 저장값을 기본값과 합치고, 깨진 값이나 옛 형식을 되살린다. */
function nvdMergeSettings(stored) {
  const s = Object.assign({}, NVD_DEFAULTS, stored || {});

  /* 탭: 사전 id 배열. 1.0.x 는 {id,label,url} 객체 배열이었다. */
  let ids = Array.isArray(s.tabs) ? s.tabs : [];
  ids = ids
    .map((t) => (typeof t === 'string' ? t : t && typeof t.id === 'string' ? t.id : null))
    .filter((id) => id && nvdDict(id));
  s.tabs = ids.filter((id, i) => ids.indexOf(id) === i);
  if (!s.tabs.length) s.tabs = NVD_DEFAULT_TAB_IDS.slice();

  if (!s.tabs.includes(s.defaultTabId)) s.defaultTabId = s.tabs[0];
  if (s.lastTabId && !s.tabs.includes(s.lastTabId)) s.lastTabId = null;

  if (typeof s.lastUrl !== 'string' || !nvdDictForUrl(s.lastUrl)) s.lastUrl = null;

  if (!Object.prototype.hasOwnProperty.call(NVD_POPUP_PRESETS, s.popupSize)) {
    s.popupSize = NVD_DEFAULTS.popupSize;
  }
  s.popupWidth = nvdClamp(s.popupWidth, NVD_LIMITS.width, NVD_DEFAULTS.popupWidth);
  s.popupHeight = nvdClamp(s.popupHeight, NVD_LIMITS.height, NVD_DEFAULTS.popupHeight);

  if (!Object.prototype.hasOwnProperty.call(NVD_LANGUAGES, s.popupLanguage)) {
    s.popupLanguage = NVD_DEFAULTS.popupLanguage;
  }

  if (typeof s.mobileUserAgent !== 'string' || !s.mobileUserAgent.trim()) {
    s.mobileUserAgent = NVD_MOBILE_UA;
  }
  s.mobileUserAgent = s.mobileUserAgent.trim();

  /* 옛 설정을 이어받는다: 1.0.x 의 imeMode/imeFixEnabled, 1.1.x 의 autoFocusSearch */
  let inherited = null;
  if (stored) {
    if (typeof stored.autoFocusSearch === 'boolean') inherited = stored.autoFocusSearch;
    else if (stored.imeMode === 'off' || stored.imeFixEnabled === false) inherited = false;
  }
  if (inherited !== null) {
    if (typeof s.autoFocusInTab !== 'boolean' || stored.autoFocusInTab === undefined) {
      s.autoFocusInTab = inherited;
    }
    if (typeof s.autoFocusInPopup !== 'boolean' || stored.autoFocusInPopup === undefined) {
      s.autoFocusInPopup = inherited;
    }
  }

  s.rememberLastTab = !!s.rememberLastTab;
  s.carryQuery = !!s.carryQuery;
  s.keepLastView = !!s.keepLastView;
  s.forceMobileView = !!s.forceMobileView;
  s.autoFocusInTab = !!s.autoFocusInTab;
  s.autoFocusInPopup = !!s.autoFocusInPopup;
  s.imeDebug = !!s.imeDebug;

  /* 핀 상태와 핀 창 위치는 common/pin.js 와 핀 창이 따로 읽고 쓴다.
     설정 화면이 옛 값을 다시 저장해 덮어쓰지 않도록 설정 묶음에서 뺀다. */
  delete s.pinned;
  delete s.pinBounds;

  /* 더 이상 쓰지 않는 키는 흘려보낸다 */
  delete s.imeFixEnabled;
  delete s.imeMode;
  delete s.imeHostModes;
  delete s.autoFocusSearch;

  return s;
}

/* 현재 설정에서 팝업이 쓸 실제 크기 */
function nvdPopupSize(settings) {
  if (settings.popupSize === 'custom') {
    return { width: settings.popupWidth, height: settings.popupHeight };
  }
  const preset = NVD_POPUP_PRESETS[settings.popupSize] || NVD_POPUP_PRESETS.medium;
  return { width: preset.width, height: preset.height };
}

async function nvdLoadSettings() {
  try {
    return nvdMergeSettings(await browser.storage.local.get(null));
  } catch (e) {
    return nvdMergeSettings(null);
  }
}
