'use strict';

/* 핀 고정 — 파이어폭스(background.js)와 크롬(background-chrome.js)이 함께 쓴다.

   툴바 팝업은 브라우저가 포커스를 잃으면 강제로 닫는다. 확장기능이 막을 방법이 없어서,
   핀을 누르면 같은 화면(popup.html?pinned=1)을 작은 별도 창으로 띄운다.

   - 핀 상태(pinned)는 storage.local 에 둔다. 창을 닫아도, 브라우저를 다시 켜도 유지된다.
   - 핀 상태에서는 툴바 팝업을 끄고(action.setPopup('')), 아이콘을 누를 때마다
     핀 창을 켜고 끈다(action.onClicked).
   - 지금 떠 있는 핀 창의 창·탭 번호는 storage.session 에 둔다(브라우저를 끄면 사라진다).
   - 핀 창 크기·위치(pinBounds)는 핀 창이 직접 저장한다. */

const NVD_POPUP_PATH = 'popup/popup.html';

/* 크롬판이 핀 창의 탭 번호를 요청 규칙에 넣을 수 있도록 알린다 (파이어폭스에는 없음) */
function nvdPinTabChanged() {
  if (typeof nvdSyncRules === 'function') nvdSyncRules();
}

async function nvdIsPinned() {
  try {
    const { pinned } = await browser.storage.local.get('pinned');
    return !!pinned;
  } catch (e) {
    return false;
  }
}

async function nvdSyncActionPopup() {
  const pinned = await nvdIsPinned();
  try {
    await browser.action.setPopup({ popup: pinned ? '' : NVD_POPUP_PATH });
  } catch (e) {}
}

/* 지금 떠 있는 핀 창 (없으면 null) */
async function nvdPinWindow() {
  let ids = {};
  try { ids = await browser.storage.session.get(['pinWindowId', 'pinTabId']); } catch (e) {}
  if (typeof ids.pinWindowId !== 'number') return null;
  try {
    return await browser.windows.get(ids.pinWindowId);
  } catch (e) {
    await nvdForgetPinWindow();
    return null;
  }
}

async function nvdForgetPinWindow() {
  try { await browser.storage.session.remove(['pinWindowId', 'pinTabId']); } catch (e) {}
  nvdPinTabChanged();
}

/* 핀 창을 띄울 자리: 저장해 둔 크기·위치, 없으면 지금 브라우저 창의 오른쪽 위 */
async function nvdPinBounds() {
  const cfg = await nvdLoadSettings();
  const size = nvdPopupSize(cfg);
  /* 창 테두리·제목 표시줄만큼 더한다 */
  const bounds = { width: size.width + 16, height: size.height + 48 };

  let saved = null;
  try { saved = (await browser.storage.local.get('pinBounds')).pinBounds; } catch (e) {}
  if (saved && [saved.left, saved.top, saved.width, saved.height].every(Number.isFinite) &&
      saved.width >= 200 && saved.height >= 200) {
    return { left: saved.left, top: saved.top, width: saved.width, height: saved.height };
  }

  try {
    const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && Number.isFinite(win.left) && Number.isFinite(win.width)) {
      bounds.left = Math.max(0, win.left + win.width - bounds.width - 16);
      bounds.top = Math.max(0, (win.top || 0) + 80);
    }
  } catch (e) {}
  return bounds;
}

async function nvdOpenPinWindow(startUrl) {
  const existing = await nvdPinWindow();
  if (existing) {
    try { await browser.windows.update(existing.id, { focused: true }); } catch (e) {}
    return;
  }

  let page = NVD_POPUP_PATH + '?pinned=1';
  if (typeof startUrl === 'string' && nvdDictForUrl(startUrl)) {
    page += '&url=' + encodeURIComponent(startUrl);
  }

  /* 크롬은 화면 밖으로 반 넘게 나가는 위치를 거부한다 (빼 둔 모니터 위에 저장된 위치 등).
     그러면 위치를 빼고, 그래도 안 되면 크기까지 빼고 다시 띄운다. */
  const base = { url: browser.runtime.getURL(page), type: 'popup', focused: true };
  const bounds = await nvdPinBounds();
  const attempts = [
    Object.assign({}, base, bounds),
    Object.assign({}, base, { width: bounds.width, height: bounds.height }),
    base
  ];
  let win = null;
  for (const options of attempts) {
    try {
      win = await browser.windows.create(options);
      break;
    } catch (e) {
      if (options === base) throw e;
    }
  }
  const tab = win.tabs && win.tabs[0];
  try {
    await browser.storage.session.set({ pinWindowId: win.id, pinTabId: tab ? tab.id : null });
  } catch (e) {}
  nvdPinTabChanged();
}

async function nvdClosePinWindow() {
  const win = await nvdPinWindow();
  if (!win) return;
  try { await browser.windows.remove(win.id); } catch (e) {}
  await nvdForgetPinWindow();
}

async function nvdSetPinned(pinned, startUrl) {
  await browser.storage.local.set({ pinned: !!pinned });
  await nvdSyncActionPopup();
  if (pinned) await nvdOpenPinWindow(startUrl);
  else await nvdClosePinWindow();
}

/* 핀 상태에서 아이콘을 누르면 핀 창을 켜고 끈다 */
browser.action.onClicked.addListener(async () => {
  if (!(await nvdIsPinned())) {
    /* 핀이 풀렸는데 팝업 설정이 아직 안 돌아온 경우 */
    await nvdSyncActionPopup();
    return;
  }
  if (await nvdPinWindow()) await nvdClosePinWindow();
  else await nvdOpenPinWindow(null);
});

browser.windows.onRemoved.addListener(async (windowId) => {
  let ids = {};
  try { ids = await browser.storage.session.get('pinWindowId'); } catch (e) {}
  if (ids.pinWindowId === windowId) await nvdForgetPinWindow();
});

/* 크롬과 파이어폭스 모두에서 동작하도록 프로미스 반환 대신 sendResponse 를 쓴다 */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'nvd-pin') return;
  if (!sender || sender.id !== browser.runtime.id) return;
  nvdSetPinned(!!message.pinned, message.url).then(
    () => sendResponse(true),
    () => sendResponse(false)
  );
  return true;
});

/* 설정 전체 초기화 등으로 핀 값이 바뀌면 툴바 팝업 설정을 맞춘다 */
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('pinned' in changes)) return;
  nvdSyncActionPopup();
  if (!changes.pinned.newValue) nvdClosePinWindow();
});

browser.runtime.onStartup.addListener(nvdSyncActionPopup);
browser.runtime.onInstalled.addListener(nvdSyncActionPopup);
nvdSyncActionPopup();
