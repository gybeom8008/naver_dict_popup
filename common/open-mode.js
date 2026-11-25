'use strict';

/* 툴바 아이콘을 눌렀을 때 팝업으로 열지, 사이드바로 열지 (설정 openIn).
   파이어폭스(background.js)와 크롬(background-chrome.js)이 함께 쓴다.

   - 팝업: action 의 팝업을 popup/popup.html 로 둔다.
   - 사이드바: action 의 팝업을 비워 아이콘 클릭이 팝업 대신 아래 동작으로 가게 한다.
     · 크롬: sidePanel 의 "아이콘을 누르면 사이드 패널 열기"를 켠다.
     · 파이어폭스: action.onClicked 에서 sidebarAction.toggle() 로 사이드바를 켜고 끈다.
   사이드바가 왼쪽·오른쪽 어디에 뜰지는 브라우저 설정이 정한다. */

const NVD_POPUP_PATH = 'popup/popup.html';

async function nvdSyncOpenMode() {
  const cfg = await nvdLoadSettings();
  const sidebar = cfg.openIn === 'sidebar';

  try {
    await browser.action.setPopup({ popup: sidebar ? '' : NVD_POPUP_PATH });
  } catch (e) {}

  /* 파이어폭스 방식(sidebarAction)이 있으면 크롬 방식(sidePanel)은 쓰지 않는다.
     나중에 파이어폭스가 크롬 호환용 sidePanel 을 구현해도, 아이콘 한 번에 두 방식이
     함께 돌아 사이드바가 열리자마자 닫히는 일이 없도록 크롬 방식은 꺼 둔다. */
  if (browser.sidePanel && browser.sidePanel.setPanelBehavior) {
    const useSidePanel = sidebar && !browser.sidebarAction;
    try {
      await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: useSidePanel });
    } catch (e) {}
  }
}

/* 팝업이 비어 있을 때(=사이드바 모드)만 불린다. 파이어폭스는 사용자 동작 처리 안에서
   곧바로 불러야 사이드바를 열 수 있으므로 기다리지 않고 부른다. */
browser.action.onClicked.addListener(() => {
  if (browser.sidebarAction && browser.sidebarAction.toggle) {
    browser.sidebarAction.toggle().catch(() => {});
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  /* openIn 이 바뀌었거나, 설정 전체 초기화로 지워졌을 때 */
  if ('openIn' in changes) nvdSyncOpenMode();
});

browser.runtime.onStartup.addListener(nvdSyncOpenMode);
browser.runtime.onInstalled.addListener(nvdSyncOpenMode);
nvdSyncOpenMode();
