/**
 * 图提取 ImageGrab - Content Script
 * 仅在商品详情页注入悬浮按钮，扫描并提取商品图片后交给扩展后台。
 */
(function () {
  "use strict";

  const FAB_ID = "imagegrab-fab";
  const TOAST_ID = "imagegrab-toast";
  const MIN_SIZE = 100;

  /** 各平台商品详情页 URL 判断 */
  function isProductDetailPage() {
    const host = location.hostname.toLowerCase();
    const path = location.pathname;
    const search = location.search;

    // 淘宝
    if (host.includes("taobao.com")) {
      return (
        /\/item\.htm/i.test(path) ||
        /\/item\//i.test(path) ||
        host.startsWith("item.") ||
        /[?&]id=\d+/.test(search)
      );
    }

    // 天猫
    if (host.includes("tmall.com")) {
      return (
        /\/item\.htm/i.test(path) ||
        host.startsWith("detail.") ||
        /[?&]id=\d+/.test(search)
      );
    }

    // 京东
    if (host.includes("jd.com")) {
      return (
        host.startsWith("item.") ||
        /\/\d+\.html/i.test(path) ||
        /\/product\//i.test(path)
      );
    }

    // 拼多多 / 商家版（pinduoduo / yangkeduo）
    if (host.includes("pinduoduo.com") || host.includes("yangkeduo.com")) {
      return (
        /goods\.html/i.test(path) ||
        /\/goods\b/i.test(path) ||
        /[?&]goods_id=\d+/i.test(search) ||
        /mms\.pinduoduo\.com/i.test(host)
      );
    }

    return false;
  }

  /** 相对路径补全为绝对 URL */
  function toAbsoluteUrl(url) {
    if (!url || typeof url !== "string") return null;
    let cleaned = url.trim().replace(/^["']|["']$/g, "");
    if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("blob:")) {
      return null;
    }
    // 协议相对 URL
    if (cleaned.startsWith("//")) {
      cleaned = location.protocol + cleaned;
    }
    try {
      return new URL(cleaned, location.href).href;
    } catch {
      return null;
    }
  }

  /** 从 srcset 中取最大宽度候选 */
  function pickFromSrcset(srcset) {
    if (!srcset) return null;
    const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
    let bestUrl = null;
    let bestScore = -1;
    for (const part of parts) {
      const tokens = part.split(/\s+/);
      const url = tokens[0];
      let score = 0;
      const descriptor = tokens[1] || "";
      if (descriptor.endsWith("w")) {
        score = parseInt(descriptor, 10) || 0;
      } else if (descriptor.endsWith("x")) {
        score = (parseFloat(descriptor) || 1) * 1000;
      }
      if (score >= bestScore) {
        bestScore = score;
        bestUrl = url;
      }
    }
    return bestUrl;
  }

  /** 从 style / 内联 background-image 提取 URL */
  function extractBgUrls(value) {
    if (!value || value === "none") return [];
    const urls = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let match;
    while ((match = re.exec(value)) !== null) {
      urls.push(match[2]);
    }
    return urls;
  }

  /** 粗过滤：图标、logo、占位、追踪像素等 */
  function isLikelyJunkUrl(url) {
    const lower = url.toLowerCase();
    const junkHints = [
      "logo",
      "icon",
      "favicon",
      "sprite",
      "avatar",
      "placeholder",
      "loading",
      "spacer",
      "blank",
      "1x1",
      "pixel",
      "track",
      "beacon",
      "emoji",
      "badge",
      "btn_",
      "button",
      ".svg",
      "data:image/svg",
    ];
    return junkHints.some((h) => lower.includes(h));
  }

  /** 尝试去掉淘宝/京东 CDN 缩略图尺寸后缀，取更大图 */
  function upgradeImageUrl(url) {
    try {
      const u = new URL(url);
      // 阿里 CDN：_60x60.jpg / .jpg_q50.jpg_.webp 等
      u.pathname = u.pathname
        .replace(/_\d+x\d+(q\d+)?(\.[a-z]+)+$/i, (m) => {
          const ext = m.match(/\.(jpe?g|png|webp|gif)$/i);
          return ext ? ext[0] : "";
        })
        .replace(/\.(jpe?g|png|gif)_(\d+x\d+|q\d+).*$/i, ".$1");
      // 京东：!q70 / s100x100_
      u.pathname = u.pathname
        .replace(/\/s\d+x\d+_/i, "/")
        .replace(/!\w+$/i, "");
      return u.href;
    } catch {
      return url;
    }
  }

  /**
   * 探测图片真实尺寸（不依赖 DOM 上的显示尺寸）
   * 过小或加载失败则丢弃
   */
  function probeImageSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      const timer = setTimeout(() => {
        img.src = "";
        resolve(null);
      }, 8000);

      img.onload = () => {
        clearTimeout(timer);
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        if (w < MIN_SIZE || h < MIN_SIZE) {
          resolve(null);
          return;
        }
        resolve({ url, width: w, height: h });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  }

  /** 收集页面候选图片 URL */
  function collectCandidateUrls() {
    const set = new Set();

    const add = (raw) => {
      const abs = toAbsoluteUrl(raw);
      if (!abs || isLikelyJunkUrl(abs)) return;
      set.add(upgradeImageUrl(abs));
    };

    // <img> 及相关懒加载属性、srcset
    document.querySelectorAll("img").forEach((img) => {
      [
        img.currentSrc,
        img.src,
        img.getAttribute("data-src"),
        img.getAttribute("data-lazy-src"),
        img.getAttribute("data-original"),
        img.getAttribute("data-lazy"),
        img.getAttribute("data-img"),
        img.getAttribute("data-url"),
        img.getAttribute("data-ks-lazyload"),
      ].forEach(add);

      const srcset =
        img.getAttribute("srcset") || img.getAttribute("data-srcset");
      if (srcset) add(pickFromSrcset(srcset));
    });

    // <source srcset>
    document.querySelectorAll("source[srcset]").forEach((el) => {
      add(pickFromSrcset(el.getAttribute("srcset")));
    });

    // 内联 style 与计算样式中的 background-image
    document.querySelectorAll("[style*='background']").forEach((el) => {
      extractBgUrls(el.style.backgroundImage).forEach(add);
    });

    // 常见商品图容器的计算背景（限制数量避免性能问题）
    const bgCandidates = document.querySelectorAll(
      "div, span, a, li, section, figure"
    );
    const maxBgScan = Math.min(bgCandidates.length, 400);
    for (let i = 0; i < maxBgScan; i++) {
      const el = bgCandidates[i];
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") {
        extractBgUrls(bg).forEach(add);
      }
    }

    return Array.from(set);
  }

  /** 扫描并过滤出合格商品图 */
  async function extractImages() {
    const urls = collectCandidateUrls();
    const results = [];
    const seen = new Set();

    // 并发探测，限制并发数
    const concurrency = 8;
    let index = 0;

    async function worker() {
      while (index < urls.length) {
        const i = index++;
        const url = urls[i];
        if (seen.has(url)) continue;
        seen.add(url);
        const info = await probeImageSize(url);
        if (info) results.push(info);
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, () => worker())
    );

    // 按面积从大到小排序，商品主图优先
    results.sort((a, b) => b.width * b.height - a.width * a.height);
    return results;
  }

  function showToast(message) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  async function onGrabClick() {
    const btn = document.getElementById(FAB_ID);
    if (!btn || btn.classList.contains("is-loading")) return;

    btn.classList.add("is-loading");
    btn.textContent = "提取中";
    showToast("正在扫描页面图片…");

    try {
      const images = await extractImages();
      if (!images.length) {
        showToast("未找到符合条件的商品图片");
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "IMAGEGRAB_OPEN_GALLERY",
        payload: {
          images,
          pageTitle: document.title || "商品详情",
          pageUrl: location.href,
          capturedAt: Date.now(),
        },
      });

      if (response && response.ok) {
        showToast(`已提取 ${images.length} 张图片，正在打开画廊`);
      } else {
        showToast((response && response.error) || "打开画廊失败");
      }
    } catch (err) {
      console.error("[ImageGrab]", err);
      showToast("提取失败：" + (err.message || String(err)));
    } finally {
      btn.classList.remove("is-loading");
      btn.textContent = "获取图片";
    }
  }

  function injectFab() {
    if (document.getElementById(FAB_ID)) return;
    const btn = document.createElement("button");
    btn.id = FAB_ID;
    btn.type = "button";
    btn.textContent = "获取图片";
    btn.title = "提取本页商品图片";
    btn.addEventListener("click", onGrabClick);
    document.documentElement.appendChild(btn);
  }

  function init() {
    if (!isProductDetailPage()) return;
    injectFab();

    // SPA / 懒加载场景：URL 变化时重新判断
    let lastHref = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        const existing = document.getElementById(FAB_ID);
        if (isProductDetailPage()) {
          injectFab();
        } else if (existing) {
          existing.remove();
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
