// Nordic Legacy DFU over WebSerial, compatible with the Adafruit nRF52 UF2
// bootloader. Protocol is ported from adafruit-nrfutil's
// `nordicsemi/dfu/dfu_transport_serial.py` (DfuTransportSerial / HciPacket).

import {
  calcCrc16,
  concat,
  slipEncodeEscChars,
  slipHeader,
  u16le,
  u32le,
} from './slip.js';

// HCI control bits for Reliable Packet Type 14 frames.
const DATA_INTEGRITY_CHECK_PRESENT = 1;
const RELIABLE_PACKET = 1;
const HCI_PACKET_TYPE = 14;

// DFU payload kinds (first u32 of the frame content).
const DFU_INIT_PACKET = 1;
const DFU_START_PACKET = 3;
const DFU_DATA_PACKET = 4;
const DFU_STOP_DATA_PACKET = 5;

// Update modes.
export const DFU_UPDATE_MODE_APP = 4;

const DFU_PACKET_MAX_SIZE = 512;
const FLASH_PAGE_SIZE = 4096;
const FLASH_PAGE_ERASE_TIME_MS = 89.7; // nrf52840 worst case
const FLASH_WORD_WRITE_TIME_MS = 0.1;
const FLASH_PAGE_WRITE_TIME_MS = (FLASH_PAGE_SIZE / 4) * FLASH_WORD_WRITE_TIME_MS;

export const DEFAULT_BAUD_RATE = 115200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HciPacket state: module-level sequence number, rolls over mod 8, matches
// the bootloader's expected counter.
let sequenceNumber = 0;

export function resetSequenceNumber() {
  sequenceNumber = 0;
}

// Build an HCI "reliable" frame carrying `payload`:
//   [0xC0] [SLIP header(4) | payload | CRC16 LE, with 0xC0/0xDB escaped] [0xC0]
function buildHciPacket(payload) {
  sequenceNumber = (sequenceNumber + 1) % 8;
  const header = slipHeader(
    sequenceNumber,
    DATA_INTEGRITY_CHECK_PRESENT,
    RELIABLE_PACKET,
    HCI_PACKET_TYPE,
    payload.length,
  );
  const body = concat(header, payload);
  const crc = calcCrc16(body, 0xffff);
  const withCrc = concat(body, u16le(crc));
  const escaped = slipEncodeEscChars(withCrc);
  return concat(new Uint8Array([0xc0]), escaped, new Uint8Array([0xc0]));
}

// Incremental SLIP frame reader: feeds raw bytes in, yields complete frames
// delimited by a pair of 0xC0 bytes.
class FrameAccumulator {
  constructor() {
    this.buf = [];
    this.inFrame = false;
  }
  push(bytes) {
    const frames = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0xc0) {
        if (this.inFrame) {
          if (this.buf.length > 0) {
            frames.push(new Uint8Array(this.buf));
          }
          this.buf = [];
          this.inFrame = false;
        } else {
          this.inFrame = true;
          this.buf = [];
        }
      } else if (this.inFrame) {
        this.buf.push(b);
      }
    }
    return frames;
  }
}

// Wraps a WritableStream + ReadableStream pair. Reader is kept open for the
// lifetime of the transport so we can consume ACKs in order.
class SerialIO {
  constructor(port) {
    this.port = port;
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    this.accumulator = new FrameAccumulator();
    this.pendingFrames = [];
    this.pendingResolvers = [];
    this.readLoop();
  }
  async readLoop() {
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        const frames = this.accumulator.push(value);
        for (const f of frames) {
          const resolver = this.pendingResolvers.shift();
          if (resolver) resolver(f);
          else this.pendingFrames.push(f);
        }
      }
    } catch (err) {
      // Port disconnected mid-transfer — reject any waiters.
      const e = err instanceof Error ? err : new Error(String(err));
      for (const r of this.pendingResolvers) r.reject?.(e);
      this.pendingResolvers = [];
    }
  }
  write(bytes) {
    return this.writer.write(bytes);
  }
  nextFrame(timeoutMs) {
    if (this.pendingFrames.length) {
      return Promise.resolve(this.pendingFrames.shift());
    }
    return new Promise((resolve, reject) => {
      const slot = { resolve, reject };
      this.pendingResolvers.push(slot);
      if (timeoutMs != null) {
        setTimeout(() => {
          const idx = this.pendingResolvers.indexOf(slot);
          if (idx >= 0) {
            this.pendingResolvers.splice(idx, 1);
            reject(new Error(`ACK timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }
    });
  }
  async close() {
    try {
      await this.writer.close();
    } catch {}
    try {
      this.writer.releaseLock();
    } catch {}
    try {
      await this.reader.cancel();
    } catch {}
    try {
      this.reader.releaseLock();
    } catch {}
  }
}

async function sendPacket(io, packet, ackTimeoutMs = 2000) {
  await io.write(packet);
  // Drain one ACK frame. We don't verify the ACK sequence number; adafruit-nrfutil
  // doesn't either in practice (the retry path is effectively disabled upstream).
  try {
    await io.nextFrame(ackTimeoutMs);
  } catch (e) {
    // The final STOP packet races with the bootloader's activation reset, so a
    // timeout there is expected. Let callers decide how to react.
    throw e;
  }
}

function startPacketFrame(mode, sdSize, blSize, appSize) {
  return concat(
    u32le(DFU_START_PACKET),
    u32le(mode),
    u32le(sdSize),
    u32le(blSize),
    u32le(appSize),
  );
}
function initPacketFrame(initPacket) {
  // Trailing 2-byte padding required by the bootloader parser.
  return concat(u32le(DFU_INIT_PACKET), initPacket, u16le(0x0000));
}
function dataPacketFrame(chunk) {
  return concat(u32le(DFU_DATA_PACKET), chunk);
}
function stopDataPacketFrame() {
  return u32le(DFU_STOP_DATA_PACKET);
}

function erasePagesFor(appSize) {
  return Math.max(1, Math.floor(appSize / FLASH_PAGE_SIZE) + 1);
}

// Perform the full DFU session. `firmware` and `initPacket` are Uint8Arrays,
// extracted from the DFU zip (`*.bin` / `*.dat`).
//
// Progress callback receives values 0..1 during the firmware transfer.
export async function flash(port, { firmware, initPacket, onProgress, onLog }) {
  const log = (msg) => onLog?.(msg);
  resetSequenceNumber();
  await port.open({ baudRate: DEFAULT_BAUD_RATE });
  const io = new SerialIO(port);
  try {
    // Small settle delay after the port opens, mirrors the Python client.
    await sleep(100);

    log('送信: START_DFU');
    await sendPacket(
      io,
      buildHciPacket(startPacketFrame(DFU_UPDATE_MODE_APP, 0, 0, firmware.length)),
    );
    const erasePages = erasePagesFor(firmware.length);
    const eraseWaitMs = Math.max(500, erasePages * FLASH_PAGE_ERASE_TIME_MS);
    log(`フラッシュ消去待機: ${erasePages} pages (${Math.round(eraseWaitMs)}ms)`);
    await sleep(eraseWaitMs);

    log(`送信: INIT_PACKET (${initPacket.length} bytes)`);
    await sendPacket(io, buildHciPacket(initPacketFrame(initPacket)));

    log(`送信: DATA ${firmware.length} bytes, ${DFU_PACKET_MAX_SIZE}B/chunk`);
    let sent = 0;
    let chunkIndex = 0;
    for (let off = 0; off < firmware.length; off += DFU_PACKET_MAX_SIZE) {
      const end = Math.min(off + DFU_PACKET_MAX_SIZE, firmware.length);
      const chunk = firmware.subarray(off, end);
      await sendPacket(io, buildHciPacket(dataPacketFrame(chunk)));
      sent = end;
      chunkIndex++;
      onProgress?.(sent / firmware.length);
      // Every 8 chunks (one 4KB flash page), the bootloader erases/writes —
      // its CPU stalls briefly, so insert a matching cooldown.
      if (chunkIndex % 8 === 0) {
        await sleep(FLASH_PAGE_WRITE_TIME_MS);
      }
    }
    await sleep(FLASH_PAGE_WRITE_TIME_MS);

    log('送信: STOP_DATA');
    try {
      await sendPacket(io, buildHciPacket(stopDataPacketFrame()), 3000);
    } catch (e) {
      // Bootloader may reset into the app before ACKing — tolerate.
      log(`STOP_DATA ACK 無し (デバイスが再起動中の可能性): ${e.message}`);
    }
    onProgress?.(1);
    log('書き込み完了 — デバイスは自動的に再起動します');
  } finally {
    await io.close();
    try {
      await port.close();
    } catch {}
  }
}

// Parse a DFU zip blob (downloaded from GitHub Releases or chosen locally).
// Returns { firmware: Uint8Array, initPacket: Uint8Array, manifest: object }.
export async function parseDfuPackage(zipBlob) {
  const JSZip = /** @type {any} */ (globalThis).JSZip;
  if (!JSZip) {
    throw new Error('JSZip is not loaded.');
  }
  const zip = await JSZip.loadAsync(zipBlob);
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('manifest.json not found in DFU zip');
  const manifest = JSON.parse(await manifestEntry.async('string'));
  const app = manifest.manifest?.application;
  if (!app) throw new Error('manifest.application missing');
  const binEntry = zip.file(app.bin_file);
  const datEntry = zip.file(app.dat_file);
  if (!binEntry || !datEntry) {
    throw new Error(`bin/dat not found: ${app.bin_file} / ${app.dat_file}`);
  }
  const firmware = new Uint8Array(await binEntry.async('arraybuffer'));
  const initPacket = new Uint8Array(await datEntry.async('arraybuffer'));
  return { firmware, initPacket, manifest };
}
