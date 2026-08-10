/* ==========================================================================
   MUREOP — 무렵
   공통 스크립트
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     1. 지금은, ○○ 무렵. — 방문자의 시간대를 읽어 화면에 반영
        (브랜드 컨셉 "시간을 향으로 번역"의 웹 인터랙션)
     ------------------------------------------------------------------ */
  var MOMENTS = [
    { from: 0,  to: 5,  label: "깊은 밤 무렵", tint: "rgba(30, 30, 30, 0.05)" },
    { from: 5,  to: 8,  label: "동트는 무렵",   tint: "rgba(139, 126, 111, 0.03)" },
    { from: 8,  to: 11, label: "아침 무렵",     tint: "rgba(255, 253, 245, 0.5)" },
    { from: 11, to: 15, label: "한낮 무렵",     tint: "rgba(255, 253, 245, 0.35)" },
    { from: 15, to: 18, label: "해 기우는 무렵", tint: "rgba(196, 168, 130, 0.07)" },
    { from: 18, to: 21, label: "해 질 무렵",    tint: "rgba(179, 141, 108, 0.09)" },
    { from: 21, to: 24, label: "밤 무렵",       tint: "rgba(30, 30, 30, 0.04)" }
  ];

  function currentMoment() {
    var h = new Date().getHours();
    for (var i = 0; i < MOMENTS.length; i++) {
      if (h >= MOMENTS[i].from && h < MOMENTS[i].to) return MOMENTS[i];
    }
    return MOMENTS[0];
  }

  var moment = currentMoment();
  document.documentElement.style.setProperty("--tint", moment.tint);
  document.querySelectorAll("[data-moment-label]").forEach(function (el) {
    el.textContent = moment.label;
  });

  /* ------------------------------------------------------------------
     2. 정물 연출용 병 실루엣 (실제 촬영 이미지로 교체 예정)
     ------------------------------------------------------------------ */
  var BOTTLE_SVG =
    '<svg viewBox="0 0 120 260" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    /* 리드 스틱 */
    '<g stroke="#8B7E6F" stroke-width="1.6" opacity="0.85">' +
    '<line x1="60" y1="120" x2="34" y2="8"/>' +
    '<line x1="60" y1="120" x2="52" y2="2"/>' +
    '<line x1="60" y1="120" x2="66" y2="4"/>' +
    '<line x1="60" y1="120" x2="82" y2="10"/>' +
    '<line x1="60" y1="120" x2="94" y2="24"/>' +
    "</g>" +
    /* 병 */
    '<path d="M52 108 h16 v14 c14 4 24 16 24 34 v78 c0 8 -6 14 -14 14 H42 c-8 0 -14 -6 -14 -14 v-78 c0 -18 10 -30 24 -34 z" ' +
    'fill="rgba(253,252,250,0.5)" stroke="rgba(58,58,58,0.35)" stroke-width="1.2"/>' +
    /* 액체 */
    '<path d="M30 172 h60 v62 c0 8 -6 12 -13 12 H43 c-7 0 -13 -4 -13 -12 z" fill="rgba(139,126,111,0.28)"/>' +
    /* 그림자 */
    '<ellipse cx="72" cy="252" rx="46" ry="6" fill="rgba(30,30,30,0.10)"/>' +
    "</svg>";

  document.querySelectorAll(".scene[data-bottle]").forEach(function (scene) {
    var holder = document.createElement("div");
    holder.className = "scene__bottle";
    holder.innerHTML = BOTTLE_SVG;
    scene.appendChild(holder);
  });

  /* ------------------------------------------------------------------
     3. 스크롤 진입 시 천천히 등장 (prefers-reduced-motion 존중)
     ------------------------------------------------------------------ */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealEls = document.querySelectorAll(".reveal");

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) {
      el.classList.add("is-visible");
    });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -5% 0px" }
    );
    revealEls.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ------------------------------------------------------------------
     4. 모바일 메뉴
     ------------------------------------------------------------------ */
  var menuBtn = document.querySelector(".header__menu-btn");
  var drawer = document.querySelector(".drawer");
  if (menuBtn && drawer) {
    menuBtn.addEventListener("click", function () {
      var open = drawer.getAttribute("data-open") === "true";
      drawer.setAttribute("data-open", String(!open));
      menuBtn.setAttribute("aria-expanded", String(!open));
      document.body.style.overflow = open ? "" : "hidden";
    });
  }

  /* ------------------------------------------------------------------
     5. 아코디언 (제품 상세 정보 접기/펼치기)
     ------------------------------------------------------------------ */
  document.querySelectorAll(".acc__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var panel = document.getElementById(btn.getAttribute("aria-controls"));
      if (!panel) return;
      var expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      panel.classList.toggle("is-open", !expanded);
    });
  });

  /* ------------------------------------------------------------------
     6. 구매 옵션 선택 (본품 / 리필) + Sticky CTA 갱신
     ------------------------------------------------------------------ */
  var optionBtns = document.querySelectorAll(".pd-option");
  var stickyPrice = document.querySelector("[data-sticky-price]");
  optionBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      optionBtns.forEach(function (b) {
        b.setAttribute("aria-pressed", "false");
      });
      btn.setAttribute("aria-pressed", "true");
      if (stickyPrice && btn.dataset.price) {
        stickyPrice.textContent = btn.dataset.price;
      }
      track("fragrance_select", { option: btn.dataset.option || "" });
    });
  });

  /* ------------------------------------------------------------------
     7. Sticky CTA — 히어로 CTA가 화면에서 사라지면 등장
     ------------------------------------------------------------------ */
  var sticky = document.querySelector(".sticky-cta");
  var stickyAnchor = document.querySelector("[data-sticky-anchor]");
  if (sticky && stickyAnchor && "IntersectionObserver" in window) {
    var stickyIO = new IntersectionObserver(
      function (entries) {
        sticky.classList.toggle("is-visible", !entries[0].isIntersecting);
      },
      { threshold: 0 }
    );
    stickyIO.observe(stickyAnchor);
  }

  /* ------------------------------------------------------------------
     8. 나의 무렵 찾기 — 답변에 따라 하나의 향을 추천
     ------------------------------------------------------------------ */
  var FINDER_RESULTS = {
    summer: {
      name: "여름 끝 무렵",
      line: "여름이 끝나기 직전. 창문을 열었을 때 들어오는 늦은 바람.",
      notes: "무화과 · 자몽 · 삼나무",
      href: "product-summer.html"
    },
    rain: {
      name: "비 갠 무렵",
      line: "비가 그친 뒤. 창밖에서 올라오는 젖은 흙의 냄새.",
      notes: "젖은 흙 · 풀 · 베티버",
      href: "product-rain.html"
    },
    sunset: {
      name: "해 질 무렵",
      line: "하루가 낮아지는 시간. 방 안으로 길게 들어오는 마지막 빛.",
      notes: "앰버 · 머스크 · 우디",
      href: "product-sunset.html"
    }
  };

  var finder = document.querySelector("[data-finder]");
  if (finder) {
    var chips = finder.querySelectorAll(".chip");
    var result = finder.querySelector(".finder__result");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) {
          c.setAttribute("aria-pressed", "false");
        });
        chip.setAttribute("aria-pressed", "true");
        var key = chip.dataset.result;
        var data = FINDER_RESULTS[key];
        if (!data || !result) return;
        result.innerHTML =
          '<p class="t-caption">당신의 무렵</p>' +
          '<p class="t-h3 mt-1">' + data.name + "</p>" +
          '<p class="t-small mt-1">' + data.line + "</p>" +
          '<p class="card__notes">' + data.notes + "</p>" +
          '<a class="btn btn--text mt-3" href="' + data.href + '">자세히 보기 </a>';
        result.classList.add("is-active");
        track("recommendation_click", { fragrance: key });
      });
    });
  }

  /* ------------------------------------------------------------------
     9. Analytics 이벤트 스텁
        런칭 시 GA4 / Meta Pixel 연동 지점. dataLayer 규격으로 적재.
     ------------------------------------------------------------------ */
  function track(event, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: event, params: params || {} });
  }
  window.mureopTrack = track;

  var page = document.body.dataset.page;
  if (page) track(page + "_view", { moment: moment.label });

  document.querySelectorAll("[data-track]").forEach(function (el) {
    el.addEventListener("click", function () {
      track(el.dataset.track, { label: el.dataset.trackLabel || "" });
    });
  });
})();
