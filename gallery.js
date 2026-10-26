/**
 * 图提取 ImageGrab - 画廊页逻辑
 * 展示缩略图、全选/反选、批量下载与进度反馈。
 */
(function () {
  "use strict";

  const els = {
    grid: document.getElementById("grid"),
    empty: document.getElementById("emptyState"),
    meta: document.getElementById("pageMeta"),
    selectAll: document.getElementById("selectAll"),
    btnInvert: document.getElementById("btnInvert"),
    selectedCount: document.getElementById("selectedCount"),
    btnDownload: document.getElementById("btnDownload"),
    overlay: document.getElementById("progressOverlay"),
    progressText: document.getElementById("progressText"),
    progressFill: document.getElementById("progressFill"),
    progressDetail: document.getElementById("progressDetail"),
    toast: document.getElementById("resultToast"),
  };

  /** @type {{ url: string, width: number, height: number }[]} */
  let images = [];
  let downloading = false;

  function updateSelectionUI() {
    const checks = [...els.grid.querySelectorAll(".card-check")];
    const total = checks.length;
    const selected = checks.filter((c) => c.checked).length;
    els.selectedCount.textContent = `已选 ${selected} / ${total}`;
    els.btnDownload.disabled = downloading || selected === 0;
    els.selectAll.checked = total > 0 && selected === total;
    els.selectAll.indeterminate = selected > 0 && selected < total;

    checks.forEach((c) => {
      const card = c.closest(".card");
      if (card) card.classList.toggle("is-selected", c.checked);
    });
  }

  function getSelectedImages() {
    return [...els.grid.querySelectorAll(".card-check:checked")].map((c) => ({
      url: c.dataset.url,
      width: Number(c.dataset.width) || 0,
      height: Number(c.dataset.height) || 0,
    }));
  }

  function render(data) {
    images = (data && data.images) || [];
    const title = (data && data.pageTitle) || "商品图片";
    document.title = `ImageGrab - ${title}`;

    if (data && data.pageUrl) {
      els.meta.textContent = `${title} · 共 ${images.length} 张`;
      els.meta.title = data.pageUrl;
    } else {
      els.meta.textContent = `共 ${images.length} 张`;
    }

    els.grid.innerHTML = "";

    if (!images.length) {
      els.empty.classList.remove("hidden");
      updateSelectionUI();
      return;
    }

    els.empty.classList.add("hidden");

    const frag = document.createDocumentFragment();
    images.forEach((img, index) => {
      const card = document.createElement("article");
      card.className = "card is-selected";

      const wrap = document.createElement("div");
      wrap.className = "thumb-wrap";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "card-check";
      check.checked = true;
      check.dataset.url = img.url;
      check.dataset.width = String(img.width || 0);
      check.dataset.height = String(img.height || 0);
      check.addEventListener("change", updateSelectionUI);

      const thumb = document.createElement("img");
      thumb.alt = `商品图 ${index + 1}`;
      thumb.loading = "lazy";
      thumb.referrerPolicy = "no-referrer";
      thumb.src = img.url;

      wrap.appendChild(check);
      wrap.appendChild(thumb);
      wrap.addEventListener("click", (e) => {
        if (e.target === check) return;
        check.checked = !check.checked;
        updateSelectionUI();
      });

      const info = document.createElement("div");
      info.className = "card-info";
      info.innerHTML = `
        <span class="card-size">${img.width || "?"} × ${img.height || "?"}</span>
        <span class="card-index">#${String(index + 1).padStart(3, "0")}</span>
      `;

      card.appendChild(wrap);
      card.appendChild(info);
      frag.appendChild(card);
    });

    els.grid.appendChild(frag);
    updateSelectionUI();
  }

  function showToast(message, duration = 3200) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      els.toast.classList.add("hidden");
    }, duration);
  }

  function setProgressVisible(visible) {
    els.overlay.classList.toggle("hidden", !visible);
  }

  function onProgress(payload) {
    if (!payload) return;

    if (payload.phase === "progress") {
      const pct = Math.round((payload.current / payload.total) * 100);
      els.progressFill.style.width = `${pct}%`;
      els.progressText.textContent = `正在处理 ${payload.current} / ${payload.total}`;
      const statusMap = {
        converting: "转换 PNG 中",
        done: "已加入下载",
        error: "失败",
      };
      const statusText = statusMap[payload.status] || payload.status;
      els.progressDetail.textContent = `${payload.filename} · ${statusText}${
        payload.error ? "：" + payload.error : ""
      }`;
      return;
    }

    if (payload.phase === "complete") {
      setProgressVisible(false);
      downloading = false;
      updateSelectionUI();
      const msg = `下载完成：成功 ${payload.success} 张，失败 ${payload.failed} 张（共 ${payload.total} 张）`;
      showToast(msg, 5000);
    }
  }

  async function loadGallery() {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "IMAGEGRAB_GET_GALLERY",
      });
      if (res && res.ok && res.data) {
        render(res.data);
      } else {
        // 直接读 storage 兜底
        const local = await chrome.storage.local.get("imagegrab_gallery");
        if (local.imagegrab_gallery) {
          render(local.imagegrab_gallery);
        } else {
          render({ images: [] });
        }
      }
    } catch (err) {
      console.error("[ImageGrab gallery]", err);
      els.meta.textContent = "加载失败";
      render({ images: [] });
      showToast("加载图片列表失败");
    }
  }

  els.selectAll.addEventListener("change", () => {
    const checked = els.selectAll.checked;
    els.grid.querySelectorAll(".card-check").forEach((c) => {
      c.checked = checked;
    });
    updateSelectionUI();
  });

  els.btnInvert.addEventListener("click", () => {
    els.grid.querySelectorAll(".card-check").forEach((c) => {
      c.checked = !c.checked;
    });
    updateSelectionUI();
  });

  els.btnDownload.addEventListener("click", async () => {
    const selected = getSelectedImages();
    if (!selected.length || downloading) return;

    downloading = true;
    updateSelectionUI();
    setProgressVisible(true);
    els.progressFill.style.width = "0%";
    els.progressText.textContent = `准备下载 ${selected.length} 张…`;
    els.progressDetail.textContent = "";

    try {
      const res = await chrome.runtime.sendMessage({
        type: "IMAGEGRAB_DOWNLOAD",
        payload: { images: selected },
      });
      if (!res || !res.ok) {
        throw new Error((res && res.error) || "下载请求失败");
      }
      // 若 SW 已同步返回 complete，补一次 UI（进度消息可能已先到）
      if (res.result && res.result.phase === "complete") {
        onProgress(res.result);
      }
    } catch (err) {
      setProgressVisible(false);
      downloading = false;
      updateSelectionUI();
      showToast("下载失败：" + (err.message || String(err)));
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "IMAGEGRAB_DOWNLOAD_PROGRESS") {
      onProgress(message.payload);
    }
  });

  // 通过 storage 接收进度（SW → 扩展页最稳妥的通道）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.imagegrab_download_progress) {
      onProgress(changes.imagegrab_download_progress.newValue);
    }
  });

  loadGallery();
})();
