'use strict';

const nvdEl = (id) => document.getElementById(id);
const EMBEDDED = new URLSearchParams(location.search).get('embed') === '1';

let settings = null;
let saveTimer = null;
let filter = '';

/* ── 저장 ────────────────────────────────────────────── */

function flash(text) {
  const badge = nvdEl('saved');
  badge.textContent = text || '저장됨';
  badge.classList.add('on');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => badge.classList.remove('on'), 1200);
}

function save(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await browser.storage.local.set(nvdMergeSettings(settings));
      flash();
    } catch (e) {
      flash('저장 실패');
    }
  }, delay === undefined ? 0 : delay);
}

/* ── 탭 고르기 ───────────────────────────────────────── */

function iconButton(text, title, disabled, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini ghost';
  button.textContent = text;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.disabled = !!disabled;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function renderTabList() {
  const host = nvdEl('tabList');
  host.textContent = '';

  settings.tabs.forEach((id, index) => {
    const dict = nvdDict(id);
    if (!dict) return;

    const row = document.createElement('div');
    row.className = 'item';
    row.setAttribute('role', 'listitem');

    const moves = document.createElement('span');
    moves.className = 'moves';
    moves.appendChild(iconButton('↑', '위로', index === 0, () => moveTab(index, -1)));
    moves.appendChild(iconButton('↓', '아래로', index === settings.tabs.length - 1,
      () => moveTab(index, 1)));

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = dict.label;
    name.title = dict.url;

    const remove = iconButton('−', dict.label + ' 빼기', settings.tabs.length <= 1,
      () => removeTab(id));

    row.append(moves, name, remove);
    host.appendChild(row);
  });
}

function renderDictList() {
  const host = nvdEl('dictList');
  host.textContent = '';

  const needle = filter.trim().toLowerCase();
  let shown = 0;

  for (const dict of NVD_DICTS) {
    if (needle && !dict.label.toLowerCase().includes(needle) &&
        !dict.id.toLowerCase().includes(needle)) continue;

    const added = settings.tabs.includes(dict.id);
    const row = document.createElement('div');
    row.className = 'item' + (added ? ' added' : '');
    row.setAttribute('role', 'listitem');

    const add = iconButton(added ? '✓' : '+', added ? '이미 추가됨' : dict.label + ' 추가',
      added, () => addTab(dict.id));

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = dict.label;
    name.title = dict.url;

    row.append(add, name);
    host.appendChild(row);
    shown += 1;
  }

  if (!shown) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '찾는 사전이 없습니다.';
    host.appendChild(empty);
  }
}

function addTab(id) {
  if (settings.tabs.includes(id)) return;
  settings.tabs.push(id);
  renderTabs();
  save();
}

function removeTab(id) {
  if (settings.tabs.length <= 1) return;
  settings.tabs = settings.tabs.filter((t) => t !== id);
  if (settings.defaultTabId === id) settings.defaultTabId = settings.tabs[0];
  renderTabs();
  save();
}

function moveTab(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= settings.tabs.length) return;
  const [moved] = settings.tabs.splice(index, 1);
  settings.tabs.splice(target, 0, moved);
  renderTabs();
  save();
}

function renderDefaultTabSelect() {
  const select = nvdEl('defaultTab');
  const current = settings.defaultTabId;
  select.textContent = '';

  for (const id of settings.tabs) {
    const dict = nvdDict(id);
    if (!dict) continue;
    const option = document.createElement('option');
    option.value = dict.id;
    option.textContent = dict.label;
    select.appendChild(option);
  }
  select.value = settings.tabs.includes(current) ? current : settings.tabs[0];
  settings.defaultTabId = select.value;
}

function renderTabs() {
  renderTabList();
  renderDictList();
  renderDefaultTabSelect();
}

/* ── 팝업 크기 ───────────────────────────────────────── */

function renderSizeChoices() {
  const host = nvdEl('sizeChoices');
  host.textContent = '';

  for (const [key, preset] of Object.entries(NVD_POPUP_PRESETS)) {
    const label = document.createElement('label');
    label.className = 'choice';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'popupSize';
    radio.value = key;
    radio.checked = settings.popupSize === key;
    radio.addEventListener('change', () => {
      settings.popupSize = key;
      updateCustomSize();
      save();
    });

    const text = document.createElement('span');
    text.textContent = key === 'custom'
      ? preset.label
      : preset.label + ' (' + preset.width + '×' + preset.height + ')';

    label.append(radio, text);
    host.appendChild(label);
  }
  updateCustomSize();
}

function updateCustomSize() {
  nvdEl('customSize').hidden = settings.popupSize !== 'custom';
}

/* ── 언어 ────────────────────────────────────────────── */

function renderLanguageSelect() {
  const select = nvdEl('popupLanguage');
  select.textContent = '';
  for (const [key, lang] of Object.entries(NVD_LANGUAGES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = lang.label;
    select.appendChild(option);
  }
  select.value = settings.popupLanguage;
}

/* ── 열기 방식 ───────────────────────────────────────── */

function renderOpenInSelect() {
  const select = nvdEl('openIn');
  select.textContent = '';
  for (const [key, mode] of Object.entries(NVD_OPEN_MODES)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = mode.label;
    select.appendChild(option);
  }
  select.value = settings.openIn;
}

/* ── 권한 ────────────────────────────────────────────── */

async function refreshPermission() {
  let granted = true;
  try {
    granted = await browser.permissions.contains({ origins: NVD_HOST_ORIGINS });
  } catch (e) {
    granted = true;
  }
  nvdEl('permBlock').hidden = granted;
}

/* ── 전체 렌더 ───────────────────────────────────────── */

/* 마지막 화면 유지가 켜지면 탭 선택 설정이, 마지막 탭 기억이 켜지면 기본 탭이 무의미해진다 */
function updateTabOpenState() {
  const keep = settings.keepLastView;
  const remember = settings.rememberLastTab;

  nvdEl('rememberLastTab').disabled = keep;
  nvdEl('rememberLastTabText').classList.toggle('off', keep);

  const lockDefault = keep || remember;
  nvdEl('defaultTab').disabled = lockDefault;
  nvdEl('defaultTabLabel').classList.toggle('off', lockDefault);
}

function renderAll() {
  nvdEl('rememberLastTab').checked = settings.rememberLastTab;
  nvdEl('keepLastView').checked = settings.keepLastView;
  nvdEl('carryQuery').checked = settings.carryQuery;
  nvdEl('popupWidth').value = settings.popupWidth;
  nvdEl('popupHeight').value = settings.popupHeight;
  nvdEl('forceMobileView').checked = settings.forceMobileView;
  nvdEl('mobileUserAgent').value = settings.mobileUserAgent;
  nvdEl('autoFocusInTab').checked = settings.autoFocusInTab;
  nvdEl('autoFocusInPopup').checked = settings.autoFocusInPopup;
  nvdEl('imeDebug').checked = settings.imeDebug;

  renderTabs();
  renderSizeChoices();
  renderLanguageSelect();
  renderOpenInSelect();
  updateTabOpenState();
}

async function init() {
  if (EMBEDDED) {
    document.body.classList.add('embed');
    nvdEl('close').hidden = false;
  }

  settings = await nvdLoadSettings();
  renderAll();
  refreshPermission();

  nvdEl('dictFilter').addEventListener('input', (event) => {
    filter = event.target.value;
    renderDictList();
  });

  nvdEl('resetTabs').addEventListener('click', () => {
    settings.tabs = NVD_DEFAULT_TAB_IDS.slice();
    settings.defaultTabId = NVD_DEFAULTS.defaultTabId;
    renderTabs();
    save();
  });

  nvdEl('defaultTab').addEventListener('change', (event) => {
    settings.defaultTabId = event.target.value;
    save();
  });

  nvdEl('rememberLastTab').addEventListener('change', (event) => {
    settings.rememberLastTab = event.target.checked;
    updateTabOpenState();
    save();
  });

  nvdEl('keepLastView').addEventListener('change', (event) => {
    settings.keepLastView = event.target.checked;
    updateTabOpenState();
    save();
  });

  nvdEl('carryQuery').addEventListener('change', (event) => {
    settings.carryQuery = event.target.checked;
    save();
  });

  nvdEl('openIn').addEventListener('change', (event) => {
    settings.openIn = event.target.value;
    save();
  });

  nvdEl('popupLanguage').addEventListener('change', (event) => {
    settings.popupLanguage = event.target.value;
    save();
  });

  for (const id of ['popupWidth', 'popupHeight']) {
    nvdEl(id).addEventListener('input', (event) => {
      settings[id] = event.target.value;
      save(500);
    });
    nvdEl(id).addEventListener('change', () => {
      const fixed = nvdMergeSettings(settings);
      settings.popupWidth = fixed.popupWidth;
      settings.popupHeight = fixed.popupHeight;
      nvdEl('popupWidth').value = settings.popupWidth;
      nvdEl('popupHeight').value = settings.popupHeight;
      save();
    });
  }

  nvdEl('forceMobileView').addEventListener('change', (event) => {
    settings.forceMobileView = event.target.checked;
    save();
  });

  nvdEl('mobileUserAgent').addEventListener('input', (event) => {
    settings.mobileUserAgent = event.target.value;
    save(500);
  });

  nvdEl('resetUA').addEventListener('click', () => {
    settings.mobileUserAgent = NVD_MOBILE_UA;
    nvdEl('mobileUserAgent').value = NVD_MOBILE_UA;
    save();
  });

  for (const id of ['autoFocusInTab', 'autoFocusInPopup']) {
    nvdEl(id).addEventListener('change', (event) => {
      settings[id] = event.target.checked;
      save();
    });
  }

  nvdEl('imeDebug').addEventListener('change', (event) => {
    settings.imeDebug = event.target.checked;
    save();
  });

  nvdEl('permBtn').addEventListener('click', async () => {
    try {
      const granted = await browser.permissions.request({ origins: NVD_HOST_ORIGINS });
      if (granted) nvdEl('permBlock').hidden = true;
    } catch (e) {}
  });

  /* 팝업 안에서는 confirm() 이 팝업을 닫아 버릴 수 있어 두 번 누르기로 확인한다. */
  const resetAll = nvdEl('resetAll');
  const resetLabel = resetAll.textContent;
  let resetArmed = null;

  resetAll.addEventListener('click', async () => {
    if (!resetArmed) {
      resetAll.textContent = '한 번 더 누르면 초기화됩니다';
      resetArmed = setTimeout(() => {
        resetArmed = null;
        resetAll.textContent = resetLabel;
      }, 4000);
      return;
    }

    clearTimeout(resetArmed);
    resetArmed = null;
    resetAll.textContent = resetLabel;

    try {
      await browser.storage.local.clear();
    } catch (e) {}
    settings = nvdMergeSettings(null);
    filter = '';
    nvdEl('dictFilter').value = '';
    renderAll();
    save();
  });

  nvdEl('close').addEventListener('click', () => {
    try {
      parent.postMessage({ type: 'nvd-close-settings' }, location.origin);
    } catch (e) {}
  });
}

init();
