/**
 * 图提取 ImageGrab - Service Worker (Manifest V3)
 * 负责：打开画廊页、跨域拉取图片、OffscreenCanvas 转 PNG、批量下载。
 */

const STORAGE_KEY = "imagegrab_gallery";
const PROGRESS_KEY = "imagegrab_download_progress";

/** 写入画廊数据（session 优先，local 兜底） */
async function saveGalleryData(payload) {
  const data = {
    images: payload.images || [],
    pageTitle: payload.pageTitle || "",
    pageUrl: payload.pageUrl || "",
    capturedAt: payload.capturedAt || Date.now(),
  };

  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ [STORAGE_KEY]: data });
    }
  } catch (e) {
    console.warn("[ImageGrab] session storage 不可用", e);
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: data });
  return data;
}

/** 读取画廊数据 */
async function loadGalleryData() {
  try {
    if (chrome.storage.session) {
      const sessionData = await chrome.storage.session.get(STORAGE_KEY);
      if (sessionData[STORAGE_KEY]) return sessionData[STORAGE_KEY];
    }
  } catch (_) {
    /* ignore */
  }
  const localData = await chrome.storage.local.get(STORAGE_KEY);
  return localData[STORAGE_KEY] || null;
}

/** 打开画廊标签页 */
async function openGallery(payload) {
  await saveGalleryData(payload);
  const url = chrome.runtime.getURL("gallery.html");
  await chrome.tabs.create({ url });
  return { ok: true };
}

/** Uint8Array → data URL（downloads API 在 SW 中比 Blob URL 更稳妥） */
function bytesToDataUrl(bytes, mime = "image/png") {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk)
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * 跨域拉取图片并转为 PNG data URL
 * fetch → createImageBitmap → OffscreenCanvas.convertToBlob
 */
async function convertUrlToPngDataUrl(imageUrl) {
  const response = await fetch(imageUrl, {
    mode: "cors",
    credentials: "omit",
    cache: "no-cache",
    referrerPolicy: "no-referrer",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob || !blob.size) {
    throw new Error("空图片响应");
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法创建 OffscreenCanvas 上下文");
    }
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: "image/png" });
    const buffer = new Uint8Array(await pngBlob.arrayBuffer());
    return bytesToDataUrl(buffer);
  } finally {
    bitmap.close();
  }
}

/** 序号补零文件名：商品图_001.png */
function buildFilename(index) {
  const num = String(index + 1).padStart(3, "0");
  return `商品图_${num}.png`;
}

/**
 * 广播下载进度
 * 扩展页无法用 tabs.sendMessage，因此写入 storage 供画廊监听，
 * 并尝试 runtime.sendMessage 作为补充通道。
 */
async function broadcastProgress(payload) {
  try {
    await chrome.storage.local.set({ [PROGRESS_KEY]: payload });
  } catch (_) {
    /* ignore */
  }

  try {
    await chrome.runtime.sendMessage({
      type: "IMAGEGRAB_DOWNLOAD_PROGRESS",
      payload,
    });
  } catch (_) {
    /* 无接收方时会抛错，可忽略 */
  }
}

/**
 * 批量下载：逐张转 PNG data URL，再调用 chrome.downloads
 */
async function downloadSelected(images) {
  const total = images.length;
  let success = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < total; i++) {
    const item = images[i];
    const url = typeof item === "string" ? item : item.url;
    const filename = buildFilename(i);

    await broadcastProgress({
      phase: "progress",
      current: i + 1,
      total,
      filename,
      status: "converting",
    });

    try {
      const dataUrl = await convertUrlToPngDataUrl(url);

      await chrome.downloads.download({
        url: dataUrl,
        filename: `ImageGrab/${filename}`,
        saveAs: false,
        conflictAction: "uniquify",
      });

      success += 1;
      await broadcastProgress({
        phase: "progress",
        current: i + 1,
        total,
        filename,
        status: "done",
      });
    } catch (err) {
      failed += 1;
      const msg = err && err.message ? err.message : String(err);
      errors.push({ url, error: msg });
      await broadcastProgress({
        phase: "progress",
        current: i + 1,
        total,
        filename,
        status: "error",
        error: msg,
      });
    }
  }

  const summary = {
    phase: "complete",
    total,
    success,
    failed,
    errors,
  };
  await broadcastProgress(summary);
  return summary;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "IMAGEGRAB_OPEN_GALLERY") {
    openGallery(message.payload || {})
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({ ok: false, error: err.message || String(err) })
      );
    return true;
  }

  if (message.type === "IMAGEGRAB_GET_GALLERY") {
    loadGalleryData()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) =>
        sendResponse({ ok: false, error: err.message || String(err) })
      );
    return true;
  }

  if (message.type === "IMAGEGRAB_DOWNLOAD") {
    const images = (message.payload && message.payload.images) || [];
    if (!images.length) {
      sendResponse({ ok: false, error: "未选择图片" });
      return false;
    }
    downloadSelected(images)
      .then((res) => sendResponse({ ok: true, result: res }))
      .catch((err) =>
        sendResponse({ ok: false, error: err.message || String(err) })
      );
    return true;
  }

  // 进度消息仅转发，画廊页自行处理
  if (message.type === "IMAGEGRAB_DOWNLOAD_PROGRESS") {
    return false;
  }
});
