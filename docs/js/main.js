/**
 * 图提取 ImageGrab — 宣传站交互
 * - 移动端汉堡菜单
 * - 滚动进入视口淡入上移（IntersectionObserver）
 * - 导航当前区块高亮
 * - 顶栏滚动态
 */
(function () {
  "use strict";

  const header = document.querySelector(".site-header");
  const nav = document.getElementById("site-nav");
  const toggle = document.querySelector(".nav-toggle");
  const navLinks = document.querySelectorAll(".nav-link");

  /* ---------- 汉堡菜单 ---------- */
  function setMenuOpen(open) {
    if (!nav || !toggle) return;
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
  }

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      setMenuOpen(!nav.classList.contains("is-open"));
    });

    // 点击锚点后关闭菜单
    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setMenuOpen(false));
    });

    // 点击菜单外关闭
    document.addEventListener("click", (e) => {
      if (!nav.classList.contains("is-open")) return;
      if (nav.contains(e.target) || toggle.contains(e.target)) return;
      setMenuOpen(false);
    });

    // Escape 关闭
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    });
  }

  /* ---------- 顶栏滚动阴影 ---------- */
  function updateHeader() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();

  /* ---------- 滚动进入动画 ---------- */
  const revealEls = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      },
      {
        root: null,
        rootMargin: "0px 0px -8% 0px",
        threshold: 0.12,
      }
    );

    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    // 旧浏览器直接显示
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  /* ---------- 导航当前区块高亮 ---------- */
  const sections = ["intro", "features", "install", "cta"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  function setActiveLink(id) {
    navLinks.forEach((link) => {
      const href = link.getAttribute("href") || "";
      const match = href === "#" + id;
      link.classList.toggle("is-active", match);
    });
  }

  function updateActiveFromScroll() {
    const offset = (header ? header.offsetHeight : 68) + 24;
    let current = null;

    for (const section of sections) {
      const top = section.getBoundingClientRect().top;
      if (top - offset <= 0) {
        current = section.id;
      }
    }

    // 接近页顶时不高亮锚点
    if (window.scrollY < 120) {
      setActiveLink(null);
      return;
    }

    setActiveLink(current);
  }

  if ("IntersectionObserver" in window && sections.length) {
    // 以滚动位置为主，resize / scroll 时更新；节流避免抖动
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          updateActiveFromScroll();
          ticking = false;
        });
      },
      { passive: true }
    );
    updateActiveFromScroll();
  }

  /* ---------- 窗口变回桌面时重置菜单 ---------- */
  const mq = window.matchMedia("(min-width: 768px)");
  function onBreakpoint(e) {
    if (e.matches) setMenuOpen(false);
  }
  if (mq.addEventListener) {
    mq.addEventListener("change", onBreakpoint);
  } else if (mq.addListener) {
    mq.addListener(onBreakpoint);
  }
})();
