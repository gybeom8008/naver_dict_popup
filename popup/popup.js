'use strict';

const nvdEl = (id) => document.getElementById(id);

/* sidebar.html 로 열렸으면 사이드바 (popup.html 과 같은 화면) */
const IN_SIDEBAR = document.documentElement.classList.contains('sidebar');

let settings = null;
let activeId = null;

/* 아이프레임 안의 콘텐츠 스크립트가 알려 주는 현재 상태 */
let viewState = { query: '', url: null };
let saveUrlTimer = null;

/* 아이프레임 안의 콘텐츠 스크립트가 "여기는 팝업이고 이 UA·언어를 쓴다"는 것을
   document_start 시점에 동기적으로 알아야 해서 window.name 으로 전달한다. */
function frameNameFor(s) {
  const params = new URLSearchParams();
  if (s.forceMobileView) params.set('ua', s.mobileUserAgent || NVD_MOBILE_UA);
  const langs = nvdLanguageTags(s);
  if (langs) params.set('lang', langs.join(','));
  const extra = params.toString();
  return extra ? NVD_FRAME_NAME + '|' + extra : NVD_FRAME_NAME;
}

function activeDict() {
  return activeId ? nvdDict(activeId) : null;
}

/* 팝업을 열 때 보여 줄 화면 */
function initialView() {
  if (settings.keepLastView && settings.lastUrl) {
    const dict = nvdDictForUrl(settings.lastUrl);
    if (dict && settings.tabs.includes(dict.id)) {
      return { id: dict.id, url: settings.lastUrl };
    }
  }
  const id = initialTabId();
  const dict = nvdDict(id);
  return { id: id, url: dict ? dict.url : 'about:blank' };
}

function initialTabId() {
  if (settings.rememberLastTab &&
      settings.lastTabId &&
      settings.tabs.includes(settings.lastTabId)) {
    return settings.lastTabId;
  }
  if (settings.tabs.includes(settings.defaultTabId)) return settings.defaultTabId;
  return settings.tabs[0];
}

function applyChrome() {
  /* 사이드바는 사이드바 크기를 그대로 채운다 (popup.css 의 html.sidebar) */
  if (IN_SIDEBAR) return;
  const size = nvdPopupSize(settings);
  const root = document.documentElement;
  root.style.setProperty('--popup-w', size.width + 'px');
  root.style.setProperty('--popup-h', size.height + 'px');

}

function renderTabs() {
  const host = nvdEl('tabs');
  host.textContent = '';

  for (const id of settings.tabs) {
    const dict = nvdDict(id);
    if (!dict) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = dict.label;
    button.title = dict.url;
    button.dataset.id = dict.id;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => selectTab(dict.id, { reload: dict.id === activeId }));
    host.appendChild(button);
  }
  markActive();
}

function markActive() {
  for (const button of nvdEl('tabs').children) {
    const on = button.dataset.id === activeId;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

function selectTab(id, options) {
  const dict = nvdDict(id);
  if (!dict || !settings.tabs.includes(id)) return;

  const opts = options || {};
  const changed = activeId !== id;

  activeId = id;
  markActive();

  if (changed || opts.reload) {
    /* 사전을 바꿀 때 검색어를 이어 간다. 같은 탭을 다시 누르면 첫 화면으로. */
    const carry = changed && !opts.reload && settings.carryQuery && viewState.query;
    openUrl(carry ? nvdSearchUrl(dict, viewState.query) : dict.url);
  }

  if (settings.rememberLastTab && opts.persist !== false) {
    browser.storage.local.set({ lastTabId: id }).catch(() => {});
  }
}

/* 크롬은 팝업 안의 페이지 스크립트에게 SameSite=Lax 쿠키(로그인 쿠키 NID_SES 등)를
   document.cookie 로 보여 주지 않는다. 모바일 사전은 페이지를 불러오자마자 그걸 보고
   로그인 여부를 정하므로, 아이프레임을 만들기 전에 이 주소의 쿠키 중 HttpOnly 가 아닌 것
   (일반 탭이라면 그 페이지가 읽을 수 있었던 것)을 읽어 이름 표식에 실어 보낸다.
   content/page-patch.js 가 페이지 스크립트보다 먼저 꺼내 쓰고 창 이름에서 지운다.
   파이어폭스는 팝업 안 쿠키가 따로 분리되어 있어 이 일을 하지 않는다. */
async function cookiesFor(url) {
  if (NVD_IS_FIREFOX || !url || !/^https:\/\/([a-z0-9-]+\.)*naver\.com\//.test(url)) return null;
  try {
    const list = await browser.cookies.getAll({ url: url });
    const visible = list.filter((c) => !c.httpOnly).map((c) => [c.name, c.value]);
    return visible.length ? visible : null;
  } catch (e) {
    return null;
  }
}

/* 사전 아이프레임을 이름(표식)이 맞는 상태로 준비한다.
   크롬은 아이프레임이 문서에 들어갈 때의 name 만 창 이름(window.name)으로 쓰고,
   나중에 name 을 바꿔도 반영하지 않는다. 그래서 이름이 달라져야 하면
   아이프레임을 새로 만들어 바꿔 끼운다. (파이어폭스도 같은 방식으로 문제없다.)
   쿠키를 실어 보낼 때는 페이지가 창 이름에서 그 부분을 지우므로 늘 새로 만든다. */
function prepareView(cookies) {
  let wanted = frameNameFor(settings);
  if (cookies) {
    const ck = 'ck=' + encodeURIComponent(JSON.stringify(cookies));
    wanted += (wanted.includes('|') ? '&' : '|') + ck;
  }
  const old = nvdEl('view');
  if (!cookies && old && old.getAttribute('name') === wanted) return old;

  const view = document.createElement('iframe');
  view.id = 'view';
  view.title = '네이버 사전';
  view.setAttribute('name', wanted);
  view.addEventListener('load', onViewLoad);

  if (old) old.replaceWith(view);
  else nvdEl('overlay').before(view);
  return view;
}

/* 크롬에서는 아이프레임 요소에 focus() 를 해도 그 안의 (다른 출처) 문서는
   document.hasFocus() 가 false 로 남아, 콘텐츠 스크립트가 검색창 포커스를 건너뛴다.
   contentWindow.focus() 까지 불러야 프레임 문서가 포커스를 가진다. */
function focusView() {
  const view = nvdEl('view');
  if (!view) return;
  view.focus();
  try { if (view.contentWindow) view.contentWindow.focus(); } catch (e) {}
}

function onViewLoad() {
  /* 아이프레임이 키보드 포커스를 받아야 그 안의 검색창에 타이핑할 수 있다 */
  if (settings.autoFocusInPopup && !settingsOpen()) focusView();
}

/* name 은 문서를 새로 불러오기 전에 정해져 있어야 한다.
   쿠키를 읽는 사이에 다른 탭을 누르면 마지막 것만 연다. */
let openSeq = 0;

async function openUrl(url) {
  const seq = ++openSeq;
  const cookies = await cookiesFor(url);
  if (seq !== openSeq) return;
  const view = prepareView(cookies);
  view.src = url || 'about:blank';
}

function reloadView() {
  const dict = activeDict();
  if (dict) openUrl(dict.url);
}

function scheduleLastUrlSave() {
  clearTimeout(saveUrlTimer);
  saveUrlTimer = setTimeout(() => {
    if (!settings.keepLastView || !viewState.url) return;
    browser.storage.local.set({ lastUrl: viewState.url }).catch(() => {});
  }, 400);
}

/* ── 설정 패널 (설정 페이지를 그대로 끼워 넣는다) ───────── */

function settingsOpen() {
  return !nvdEl('overlay').hidden;
}

function toggleSettings(force) {
  const overlay = nvdEl('overlay');
  const frame = nvdEl('settings');
  const open = typeof force === 'boolean' ? force : !settingsOpen();

  if (open) {
    frame.src = browser.runtime.getURL('options/options.html?embed=1');
    overlay.hidden = false;
  } else {
    overlay.hidden = true;
    frame.src = 'about:blank';
    if (settings.autoFocusInPopup) focusView();
  }
  nvdEl('gear').classList.toggle('on', open);
}

/* ── 호스트 권한 ─────────────────────────────────────── */

async function refreshPermissionNotice() {
  let granted = true;
  try {
    granted = await browser.permissions.contains({ origins: NVD_HOST_ORIGINS });
  } catch (e) {
    granted = true;
  }
  nvdEl('perm').hidden = granted;
}

/* ── 시작 ────────────────────────────────────────────── */

async function init() {
  settings = await nvdLoadSettings();
  applyChrome();
  renderTabs();

  const start = initialView();
  activeId = start.id;
  markActive();
  await openUrl(start.url);

  refreshPermissionNotice();

  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== 'nvd-view-state') return;
    if (sender && sender.tab) return;           /* 일반 탭에서 온 것은 무시 */
    viewState = { query: message.query || '', url: message.url || null };
    if (settings.keepLastView) scheduleLastUrlSave();
  });

  /* 팝업이 열리자마자 바로 타이핑할 수 있도록 */
  if (settings.autoFocusInPopup) focusView();

  nvdEl('gear').addEventListener('click', () => toggleSettings());

  nvdEl('openTab').addEventListener('click', async () => {
    const dict = activeDict();
    if (!dict) return;
    try {
      await browser.tabs.create({ url: dict.url });
      if (!IN_SIDEBAR) window.close();
    } catch (e) {}
  });

  nvdEl('permBtn').addEventListener('click', async () => {
    try {
      const granted = await browser.permissions.request({ origins: NVD_HOST_ORIGINS });
      if (granted) {
        nvdEl('perm').hidden = true;
        reloadView();
      }
    } catch (e) {}
  });

  nvdEl('permHide').addEventListener('click', () => { nvdEl('perm').hidden = true; });

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if (event.data && event.data.type === 'nvd-close-settings') toggleSettings(false);
  });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.every((k) => k === 'lastTabId' || k === 'lastUrl')) return;

    const before = settings;
    const beforeUrl = activeDict() ? activeDict().url : null;
    settings = await nvdLoadSettings();

    applyChrome();
    renderTabs();

    const frameChanged = frameNameFor(before) !== frameNameFor(settings);

    if (!settings.tabs.includes(activeId)) {
      const fallback = initialTabId();
      activeId = fallback;
      markActive();
      openUrl(nvdDict(fallback).url);
    } else {
      const dict = activeDict();
      if (frameChanged || (dict && dict.url !== beforeUrl)) reloadView();
    }
  });
}

init();
