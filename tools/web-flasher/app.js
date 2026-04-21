import { requestVialDevice, isUnlocked, jumpToBootloader } from './hid.js';
import { flash, parseDfuPackage } from './dfu.js';

// Firmware is bundled into the Pages deploy (see .github/workflows/pages.yml)
// so we can fetch it same-origin and avoid the CORS restrictions on GitHub's
// release-assets CDN.
const BUNDLED_ZIP_URL = './firmware/wakizashi-dfu.zip';
const BUNDLED_VERSION_URL = './firmware/version.json';

// Known VID/PIDs for serial bootloader enumeration hints (user still picks via dialog).
const BOOTLOADER_HINTS = [
  { usbVendorId: 0x239a }, // Adafruit
  { usbVendorId: 0x2886 }, // Seeed (XIAO variants)
];

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

const ui = {
  btnFetch: $('#btn-fetch'),
  fileInput: $('#file-input'),
  fetchStatus: $('#fetch-status'),
  btnReset: $('#btn-reset'),
  resetStatus: $('#reset-status'),
  btnFlash: $('#btn-flash'),
  flashStatus: $('#flash-status'),
  progress: $('#progress-bar'),
  log: $('#log'),
  compatHid: $('#compat-hid'),
  compatSerial: $('#compat-serial'),
};

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  ui.log.textContent += `[${ts}] ${msg}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function setStatus(el, text, cls) {
  el.textContent = text;
  el.className = 'status' + (cls ? ` ${cls}` : '');
}

function setProgress(ratio) {
  ui.progress.style.width = `${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Blob | null} */
let firmwareBlob = null;
let firmwareLabel = '';

// ---------------------------------------------------------------------------
// Compatibility check
// ---------------------------------------------------------------------------

function checkCompat() {
  const hasHid = 'hid' in navigator;
  const hasSerial = 'serial' in navigator;
  setStatus(ui.compatHid, hasHid ? '利用可能' : '未対応', hasHid ? 'ok' : 'err');
  setStatus(ui.compatSerial, hasSerial ? '利用可能' : '未対応', hasSerial ? 'ok' : 'err');
  if (!hasHid || !hasSerial) {
    log('このブラウザは WebHID / WebSerial に対応していません。Chrome / Edge / Opera の最新版をお使いください。');
    ui.btnReset.disabled = true;
    ui.btnFlash.disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Fetch bundled firmware
// ---------------------------------------------------------------------------

async function loadBundledFirmware() {
  setStatus(ui.fetchStatus, '取得中…');
  try {
    const versionRes = await fetch(BUNDLED_VERSION_URL, { cache: 'no-store' });
    if (!versionRes.ok) {
      throw new Error(`version.json の取得に失敗: ${versionRes.status}`);
    }
    const version = await versionRes.json();
    if (!version.tag) {
      throw new Error('まだ Release がありません。リポジトリで `git tag v0.1.0 && git push origin v0.1.0` を実行して初回リリースを作成してください');
    }

    const zipRes = await fetch(BUNDLED_ZIP_URL, { cache: 'no-store' });
    if (!zipRes.ok) {
      throw new Error(`DFU zip の取得に失敗: ${zipRes.status}`);
    }
    firmwareBlob = await zipRes.blob();
    firmwareLabel = version.tag;
    log(`${version.tag}: wakizashi-dfu.zip (${Math.round(firmwareBlob.size / 1024)} KB) を取得`);
    const { firmware, initPacket } = await parseDfuPackage(firmwareBlob);
    log(`DFU パッケージ OK: firmware=${firmware.length}B, init=${initPacket.length}B`);
    setStatus(ui.fetchStatus, `${version.tag} を取得`, 'ok');
  } catch (e) {
    firmwareBlob = null;
    firmwareLabel = '';
    setStatus(ui.fetchStatus, '失敗', 'err');
    log(`エラー: ${e instanceof Error ? e.message : e}`);
  }
}

async function loadFirmwareFromFile(file) {
  setStatus(ui.fetchStatus, '読み込み中…');
  try {
    firmwareBlob = file;
    firmwareLabel = file.name;
    const { firmware, initPacket } = await parseDfuPackage(firmwareBlob);
    log(`ローカルファイル OK: firmware=${firmware.length}B, init=${initPacket.length}B`);
    setStatus(ui.fetchStatus, file.name, 'ok');
  } catch (e) {
    firmwareBlob = null;
    firmwareLabel = '';
    setStatus(ui.fetchStatus, '失敗', 'err');
    log(`エラー: ${e instanceof Error ? e.message : e}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Reset keyboard to bootloader via WebHID
// ---------------------------------------------------------------------------

async function resetKeyboard() {
  setStatus(ui.resetStatus, '接続中…');
  try {
    const device = await requestVialDevice();
    if (!device) {
      setStatus(ui.resetStatus, 'キャンセル', 'warn');
      return;
    }
    log(`HID 接続: ${device.productName ?? '(no name)'} (VID ${device.vendorId.toString(16)}, PID ${device.productId.toString(16)})`);
    const unlocked = await isUnlocked(device);
    if (!unlocked) {
      log('Vial unlock 状態が検出できませんでした。ファームの security 設定によっては手動 unlock が必要です。');
    }
    log('BootloaderJump (0x0B) を送信');
    await jumpToBootloader(device);
    // The keyboard disappears before any ACK — treat immediate send as success.
    setStatus(ui.resetStatus, 'リセット送信済み', 'ok');
    log('キーボードが DFU モードで再列挙されたら手順 3 へ進んでください');
  } catch (e) {
    setStatus(ui.resetStatus, '失敗', 'err');
    log(`エラー: ${e instanceof Error ? e.message : e}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Flash via WebSerial DFU
// ---------------------------------------------------------------------------

async function flashFirmware() {
  if (!firmwareBlob) {
    log('先に手順 1 でファームウェアを取得してください');
    return;
  }
  setStatus(ui.flashStatus, 'ポート選択中…');
  try {
    if (!('serial' in navigator)) throw new Error('WebSerial unavailable');
    const port = await navigator.serial.requestPort({ filters: BOOTLOADER_HINTS });
    log('シリアルポートに接続');
    const { firmware, initPacket } = await parseDfuPackage(firmwareBlob);
    setStatus(ui.flashStatus, '書き込み中…');
    setProgress(0);
    await flash(port, {
      firmware,
      initPacket,
      onProgress: setProgress,
      onLog: log,
    });
    setStatus(ui.flashStatus, `書き込み完了 (${firmwareLabel})`, 'ok');
  } catch (e) {
    setStatus(ui.flashStatus, '失敗', 'err');
    log(`エラー: ${e instanceof Error ? e.message : e}`);
  }
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------

checkCompat();

ui.btnFetch.addEventListener('click', () => loadBundledFirmware());
ui.fileInput.addEventListener('change', (e) => {
  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  if (file) loadFirmwareFromFile(file);
});
ui.btnReset.addEventListener('click', resetKeyboard);
ui.btnFlash.addEventListener('click', flashFirmware);

// After compat check we can enable the HID/Serial buttons.
if ('hid' in navigator) ui.btnReset.disabled = false;
if ('serial' in navigator) ui.btnFlash.disabled = false;
