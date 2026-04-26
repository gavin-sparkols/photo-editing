(function () {
  "use strict";

  const stageWrap = document.getElementById("stage-wrap");
  const stagesRoot = document.getElementById("stages");
  const status = document.getElementById("status");
  const fileImage = document.getElementById("fileImage");
  const chkUseFilled = document.getElementById("chkUseFilled");
  const btnOcr = document.getElementById("btnOcr");
  const btnLayout = document.getElementById("btnLayout");
  const btnPng = document.getElementById("btnPng");
  const btnPptx = document.getElementById("btnPptx");
  const btnApplyJson = document.getElementById("btnApplyJson");
  const jsonPreview = document.getElementById("jsonPreview");
  const chkGrid = document.getElementById("chkGrid");
  const stageToolbar = document.getElementById("stageToolbar");
  const zoomPct = document.getElementById("zoomPct");
  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomOut = document.getElementById("btnZoomOut");
  const btnZoomReset = document.getElementById("btnZoomReset");
  const fileImageName = document.getElementById("fileImageName");
  const uploadOcr = document.getElementById("uploadOcr");
  const appShell = document.getElementById("app");
  const filmstrip = document.getElementById("filmstrip");
  const filmstripList = document.getElementById("filmstripList");
  const btnFilmstripToggle = document.getElementById("btnFilmstripToggle");
  const filmstripFooter = document.getElementById("filmstripFooter");
  const filmstripFileAdd = document.getElementById("filmstripFileAdd");
  const btnFilmstripAdd = document.getElementById("btnFilmstripAdd");
  const stageTextBar = document.getElementById("stageTextBar");
  const fltAddText = document.getElementById("fltAddText");
  const fltFontPreset = document.getElementById("fltFontPreset");
  const fltDelText = document.getElementById("fltDelText");

  var imageObjectUrl = null;
  var filledObjectUrl = null;
  var viewZoom = 1;
  var VIEW_Z = { min: 0.15, max: 4.5 };
  var pageSlabs = [];
  var nextSlabId = 1;
  var filmstripOpenWide = true;
  var activeSlabId = null;
  /** 画布二维平移（px），替代原先 #stage-wrap 的 scroll，斜向拖移更跟手 */
  var canvasPanX = 0;
  var canvasPanY = 0;
  /** 字框拖移 / 角点缩放 */
  var regInteractState = null;
  /** 多选字框；「主」为最后一项（primaryRegCtx），用于工具栏与单框逻辑 */
  var selectedRegList = [];
  /** Alt+拖空白：框选矩形状态（相对 #stage-wrap 的 client 坐标） */
  var marqueeSelectState = null;
  var marqueeEl = null;
  /** 在捕获阶段记录：点工具栏对齐按钮时焦点是否还在字框 inner（避免 click 时已是按钮而误判为框对齐） */
  var alignToolbarWasRegInnerFocus = false;
  var statusHideTimer = null;
  var statusDismissGen = 0;

  function applyStagesPanTransform() {
    if (!stagesRoot) {
      return;
    }
    stagesRoot.style.transform =
      "translate(" + canvasPanX + "px," + canvasPanY + "px)";
  }

  function setStatus(msg, type) {
    if (!status) {
      return;
    }
    if (statusHideTimer) {
      clearTimeout(statusHideTimer);
      statusHideTimer = null;
    }
    statusDismissGen++;
    var dismissAt = statusDismissGen;
    status.textContent = msg || "";
    status.className = "status-pill" + (type ? " " + type : "");
    if (type === "working") {
      status.setAttribute("aria-busy", "true");
    } else {
      status.removeAttribute("aria-busy");
    }
    /* 成功提示短时自动收起，避免长期压在画布上方影响观感 */
    if (type === "ok" && msg) {
      statusHideTimer = setTimeout(function () {
        statusHideTimer = null;
        if (dismissAt !== statusDismissGen || !status) {
          return;
        }
        status.textContent = "";
        status.className = "status-pill";
        status.removeAttribute("aria-busy");
      }, 3200);
    }
  }

  function clearObjectUrl() {
    if (imageObjectUrl) {
      URL.revokeObjectURL(imageObjectUrl);
      imageObjectUrl = null;
    }
    if (filledObjectUrl) {
      URL.revokeObjectURL(filledObjectUrl);
      filledObjectUrl = null;
    }
  }

  function clearSlabs() {
    pageSlabs = [];
    nextSlabId = 1;
    activeSlabId = null;
    canvasPanX = 0;
    canvasPanY = 0;
    endRegInteract();
    clearRegSelection();
    if (stagesRoot) {
      stagesRoot.innerHTML = "";
      applyStagesPanTransform();
    }
    syncFilmstrip();
  }

  function getSlateDisplayUrl(s) {
    if (chkUseFilled && chkUseFilled.checked && s.serverFilled) {
      return s.serverFilled;
    }
    if (s.serverOriginal) {
      return s.serverOriginal;
    }
    return s.img && s.img.getAttribute("src") ? s.img.getAttribute("src") : "";
  }

  function shortNameForFilm(fn) {
    if (!fn) {
      return "";
    }
    if (fn.length > 16) {
      return fn.substring(0, 14) + "…";
    }
    return fn;
  }

  function applyFilmLayoutOnly() {
    if (!filmstrip || !appShell) {
      return;
    }
    if (!pageSlabs.length) {
      filmstrip.setAttribute("hidden", "");
      appShell.setAttribute("data-film", "none");
      filmstrip.classList.remove("filmstrip--shut");
      if (btnFilmstripToggle) {
        btnFilmstripToggle.setAttribute("aria-pressed", "true");
      }
      return;
    }
    filmstrip.removeAttribute("hidden");
    if (filmstripOpenWide) {
      appShell.setAttribute("data-film", "open");
      filmstrip.classList.remove("filmstrip--shut");
      if (btnFilmstripToggle) {
        btnFilmstripToggle.setAttribute("aria-pressed", "true");
      }
    } else {
      appShell.setAttribute("data-film", "shut");
      filmstrip.classList.add("filmstrip--shut");
      if (btnFilmstripToggle) {
        btnFilmstripToggle.setAttribute("aria-pressed", "false");
      }
    }
  }

  function clearActiveSlateVisual() {
    if (stagesRoot) {
      var ac = stagesRoot.querySelectorAll(".doc-slab--active");
      for (var a = 0; a < ac.length; a++) {
        ac[a].classList.remove("doc-slab--active");
      }
    }
    if (filmstripList) {
      var fl = filmstripList.querySelectorAll(
        ".filmstrip__item--active, [aria-selected='true']"
      );
      for (var f = 0; f < fl.length; f++) {
        fl[f].classList.remove("filmstrip__item--active");
        fl[f].removeAttribute("aria-selected");
      }
    }
  }

  function reindexSlateHeadings() {
    pageSlabs.forEach(function (s, i) {
      if (!s.el) {
        return;
      }
      var idx = s.el.querySelector(".doc-slab__i");
      if (idx) {
        idx.textContent = "#" + (i + 1);
      }
    });
  }

  function reorderSlateInPageSlabs(from, to) {
    if (from === to) {
      return;
    }
    if (
      from < 0 ||
      to < 0 ||
      from >= pageSlabs.length ||
      to >= pageSlabs.length
    ) {
      return;
    }
    var order = pageSlabs.map(function (x) {
      return x;
    });
    var it = order.splice(from, 1)[0];
    order.splice(to, 0, it);
    for (var u = 0; u < order.length; u++) {
      pageSlabs[u] = order[u];
    }
    if (stagesRoot) {
      pageSlabs.forEach(function (s) {
        stagesRoot.appendChild(s.el);
      });
    }
    reindexSlateHeadings();
    if (jsonPreview) {
      jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
    }
    syncFilmstrip();
  }

  function setActiveSlabId(sid) {
    clearActiveSlateVisual();
    activeSlabId = sid;
    for (var i = 0; i < pageSlabs.length; i++) {
      if (pageSlabs[i].slabId === sid) {
        pageSlabs[i].el.classList.add("doc-slab--active");
        break;
      }
    }
    if (filmstripList) {
      var li = filmstripList.querySelector(
        ".filmstrip__item[data-slab-id=\"" + sid + "\"]"
      );
      if (li) {
        li.classList.add("filmstrip__item--active");
        li.setAttribute("aria-selected", "true");
      }
    }
  }

  function syncFilmstrip() {
    if (!filmstripList || !filmstrip) {
      return;
    }
    if (!pageSlabs.length) {
      filmstripList.innerHTML = "";
      clearActiveSlateVisual();
      applyFilmLayoutOnly();
      return;
    }
    applyFilmLayoutOnly();
    filmstripList.innerHTML = "";
    pageSlabs.forEach(function (s, i) {
      var li = document.createElement("li");
      li.className = "filmstrip__item";
      li.setAttribute("data-slab-id", String(s.slabId));
      li.setAttribute("data-index", String(i));
      li.setAttribute("draggable", "true");
      li.setAttribute("role", "listitem");
      if (activeSlabId != null && s.slabId === activeSlabId) {
        li.classList.add("filmstrip__item--active");
        li.setAttribute("aria-selected", "true");
      }
      var th = document.createElement("div");
      th.className = "filmstrip__th";
      var im = document.createElement("img");
      im.setAttribute("alt", "");
      im.setAttribute("draggable", "false");
      /* 右侧缩略：始终原图，便于与 OCR 框对照；主画布由 chkUseFilled + applySlateBg 决定 */
      im.src =
        (s.serverOriginal || s.serverFilled || "").trim() || "data:,";
      th.appendChild(im);
      var ns = document.createElement("span");
      ns.className = "filmstrip__n";
      var sn = shortNameForFilm(s.filename);
      ns.textContent = (i + 1) + (sn ? " · " + sn : "");
      li.appendChild(th);
      li.appendChild(ns);
      li.addEventListener("click", function (e) {
        e.preventDefault();
        var id = +li.getAttribute("data-slab-id");
        for (var j = 0; j < pageSlabs.length; j++) {
          if (pageSlabs[j].slabId === id) {
            setActiveSlabId(id);
            centerSlabInView(pageSlabs[j].img || pageSlabs[j].stage);
            return;
          }
        }
      });
      li.addEventListener("dragstart", function (e) {
        if (!e.dataTransfer) {
          return;
        }
        e.dataTransfer.setData("text/plain", li.getAttribute("data-index"));
        e.dataTransfer.effectAllowed = "move";
        li.classList.add("filmstrip__item--drag");
      });
      li.addEventListener("dragend", function () {
        li.classList.remove("filmstrip__item--drag");
        var o = filmstripList.querySelectorAll(".filmstrip__item--over");
        for (var k = 0; k < o.length; k++) {
          o[k].classList.remove("filmstrip__item--over");
        }
      });
      li.addEventListener("dragover", function (e) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "move";
        }
        li.classList.add("filmstrip__item--over");
      });
      li.addEventListener("dragleave", function (e) {
        if (!li.contains(e.relatedTarget)) {
          li.classList.remove("filmstrip__item--over");
        }
      });
      li.addEventListener("drop", function (e) {
        e.preventDefault();
        li.classList.remove("filmstrip__item--over");
        if (!e.dataTransfer) {
          return;
        }
        var f = parseInt(e.dataTransfer.getData("text/plain"), 10);
        var t = parseInt(li.getAttribute("data-index"), 10);
        if (isNaN(f) || isNaN(t)) {
          return;
        }
        reorderSlateInPageSlabs(f, t);
      });
      filmstripList.appendChild(li);
    });
  }

  function raf2(fn) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        requestAnimationFrame(fn);
      });
    } else {
      setTimeout(fn, 0);
    }
  }

  /** 将某页底图（img 优先）移到主画布视口中心；先 reflow 再双帧测量并做一次误差修正 */
  function centerSlabInView(slabEl) {
    if (!stageWrap || !slabEl || !stagesRoot) {
      return;
    }
    raf2(function () {
      reflowAllSlabs();
      function nudge() {
        var wrap = stageWrap.getBoundingClientRect();
        var box = slabEl.getBoundingClientRect();
        if (!wrap.width || !wrap.height || !box.width) {
          return;
        }
        var wx = wrap.left + wrap.width * 0.5;
        var wy = wrap.top + wrap.height * 0.5;
        var cx = box.left + box.width * 0.5;
        var cy = box.top + box.height * 0.5;
        canvasPanX += wx - cx;
        canvasPanY += wy - cy;
        applyStagesPanTransform();
      }
      nudge();
      requestAnimationFrame(function () {
        var wrap2 = stageWrap.getBoundingClientRect();
        var box2 = slabEl.getBoundingClientRect();
        if (!wrap2.width || !wrap2.height || !box2.width) {
          return;
        }
        var wx2 = wrap2.left + wrap2.width * 0.5;
        var wy2 = wrap2.top + wrap2.height * 0.5;
        var cx2 = box2.left + box2.width * 0.5;
        var cy2 = box2.top + box2.height * 0.5;
        var fixX = wx2 - cx2;
        var fixY = wy2 - cy2;
        if (Math.abs(fixX) > 0.35 || Math.abs(fixY) > 0.35) {
          canvasPanX += fixX;
          canvasPanY += fixY;
          applyStagesPanTransform();
        }
      });
    });
  }

  function ensureMarqueeEl() {
    if (!stageWrap || marqueeEl) {
      return;
    }
    marqueeEl = document.createElement("div");
    marqueeEl.className = "marquee-select";
    marqueeEl.setAttribute("aria-hidden", "true");
    marqueeEl.style.display = "none";
    stageWrap.appendChild(marqueeEl);
  }

  function updateMarqueeVisual() {
    if (!marqueeSelectState || !marqueeEl || !stageWrap) {
      return;
    }
    var m = marqueeSelectState;
    var x = Math.min(m.x0, m.x1);
    var y = Math.min(m.y0, m.y1);
    var w = Math.abs(m.x1 - m.x0);
    var h = Math.abs(m.y1 - m.y0);
    if (w < 1 && h < 1) {
      marqueeEl.style.display = "none";
      return;
    }
    marqueeEl.style.display = "block";
    marqueeEl.style.left = x + "px";
    marqueeEl.style.top = y + "px";
    marqueeEl.style.width = w + "px";
    marqueeEl.style.height = h + "px";
  }

  function finalizeMarqueeSelection(e) {
    if (!marqueeSelectState || !stageWrap) {
      return;
    }
    try {
      if (marqueeSelectState.pointerId != null) {
        stageWrap.releasePointerCapture(marqueeSelectState.pointerId);
      }
    } catch (errRel) {
      /* ignore */
    }
    stageWrap.classList.remove("is-marquee");
    if (marqueeEl) {
      marqueeEl.style.display = "none";
    }
    var x0 = marqueeSelectState.x0;
    var y0 = marqueeSelectState.y0;
    var x1 = marqueeSelectState.x1;
    var y1 = marqueeSelectState.y1;
    marqueeSelectState = null;
    var mw = Math.abs(x1 - x0);
    var mh = Math.abs(y1 - y0);
    if (mw < 5 || mh < 5) {
      return;
    }
    var mx = Math.min(x0, x1);
    var my = Math.min(y0, y1);
    var mr = { left: mx, top: my, width: mw, height: mh };
    var wrapR = stageWrap.getBoundingClientRect();
    var list = [];
    var regs = stagesRoot ? stagesRoot.querySelectorAll(".reg") : [];
    for (var ri = 0; ri < regs.length; ri++) {
      var el = regs[ri];
      var rr = el.getBoundingClientRect();
      var ai = {
        left: rr.left - wrapR.left,
        top: rr.top - wrapR.top,
        width: rr.width,
        height: rr.height,
      };
      if (rectIntersectScreen(mr, ai)) {
        var slab = slabFromRegEl(el);
        var ctx = makeRegCtx(slab, el);
        if (ctx) {
          list.push(ctx);
        }
      }
    }
    if (!list.length) {
      return;
    }
    clearRegSelection();
    selectedRegList = list;
    for (var lj = 0; lj < list.length; lj++) {
      list[lj].regEl.classList.add("reg--selected");
    }
    syncRegToolsPanel();
  }

  function whenImageReady(img, fn) {
    if (img && img.complete && img.naturalWidth) {
      fn();
    } else if (img) {
      img.addEventListener("load", fn, { once: true });
    }
  }

  function updateChkFilled() {
    if (!chkUseFilled) {
      return;
    }
    if (!pageSlabs.length) {
      chkUseFilled.disabled = true;
      return;
    }
    var allNo = pageSlabs.every(function (s) {
      return !s.serverFilled;
    });
    chkUseFilled.disabled = allNo;
    if (allNo) {
      chkUseFilled.checked = false;
    } else {
      /* 有填充图时主画布默认走填充后（与 HTML checked 一致） */
      chkUseFilled.checked = true;
    }
  }

  function buildBatchJson() {
    return {
      format: "batch_v1",
      count: pageSlabs.length,
      pages: pageSlabs.map(function (s) { return s.layout; }),
      filenames: pageSlabs.map(function (s) { return s.filename || ""; }),
    };
  }

  function qReg(slab, id) {
    return slab.overlaysEl.querySelector(
      '.reg[data-id="' + id + '"]'
    );
  }

  function regInnerEl(regRoot) {
    if (!regRoot) {
      return null;
    }
    return regRoot.querySelector(".reg__inner") || regRoot;
  }

  function getTextFromRegEl(regRoot) {
    var inner = regInnerEl(regRoot);
    return (inner && inner.textContent
      ? inner.textContent
      : ""
    ).replace(/\n/g, " ");
  }

  function primaryRegCtx() {
    var n = selectedRegList.length;
    return n ? selectedRegList[n - 1] : null;
  }

  function slabFromRegEl(regEl) {
    if (!regEl || !regEl.closest) {
      return null;
    }
    var art = regEl.closest(".doc-slab");
    if (!art) {
      return null;
    }
    for (var si = 0; si < pageSlabs.length; si++) {
      if (pageSlabs[si].el === art) {
        return pageSlabs[si];
      }
    }
    return null;
  }

  function makeRegCtx(slab, regEl) {
    if (!regEl || !slab || !slab.layout) {
      return null;
    }
    var rid = regEl.getAttribute("data-id");
    var reg = null;
    var idx = -1;
    (slab.layout.regions || []).forEach(function (r, j) {
      var id = String(r.id != null ? r.id : j);
      if (id === rid) {
        reg = r;
        idx = j;
      }
    });
    if (!reg) {
      return null;
    }
    return {
      slab: slab,
      rid: rid,
      regEl: regEl,
      reg: reg,
      index: idx,
    };
  }

  function rectIntersectScreen(a, b) {
    return !(
      a.left + a.width <= b.left ||
      b.left + b.width <= a.left ||
      a.top + a.height <= b.top ||
      b.top + b.height <= a.top
    );
  }

  function clearRegSelection() {
    try {
      var a = document.activeElement;
      if (
        a &&
        a.isContentEditable &&
        stagesRoot &&
        a.closest &&
        a.closest(".reg") &&
        stagesRoot.contains(a.closest(".reg"))
      ) {
        a.blur();
      }
    } catch (err) {
      /* ignore */
    }
    if (stagesRoot) {
      var xs = stagesRoot.querySelectorAll(".reg.reg--selected");
      for (var i = 0; i < xs.length; i++) {
        xs[i].classList.remove("reg--selected");
      }
    }
    selectedRegList = [];
    syncRegToolsPanel();
  }

  function syncStageTextBar() {
    if (!stageTextBar) {
      return;
    }
    var hasImg = hasAnyImage();
    if (!hasImg) {
      stageTextBar.hidden = true;
      return;
    }
    stageTextBar.hidden = false;
    var canAdd =
      pageSlabs.some(function (s) {
        return s.layout && s.img && s.img.naturalWidth;
      });
    if (fltAddText) {
      fltAddText.disabled = !canAdd;
    }
    var hasSel = selectedRegList.some(function (c) {
      return c.regEl && c.regEl.isConnected;
    });
    if (fltFontPreset) {
      fltFontPreset.disabled = !hasSel;
    }
    if (fltDelText) {
      fltDelText.disabled = !hasSel;
    }
    var alignBtns = document.querySelectorAll(".btn-flt-align");
    for (var ai = 0; ai < alignBtns.length; ai++) {
      alignBtns[ai].disabled = !hasSel;
      if (!hasSel) {
        alignBtns[ai].classList.remove("is-active");
      }
    }
    if (!hasSel || !fltFontPreset) {
      return;
    }
    var pr = primaryRegCtx();
    var reg = pr.reg;
    if (selectedRegList.length > 1) {
      var mix = false;
      var firstAuto = reg.font_auto === true;
      var firstDisp = 0;
      if (!firstAuto && reg.font_size_px != null) {
        firstDisp = +reg.font_size_px * (pr.slab.scale || 1);
      }
      for (var mi = 0; mi < selectedRegList.length; mi++) {
        var r2 = selectedRegList[mi].reg;
        var s2 = selectedRegList[mi].slab.scale || 1;
        if ((r2.font_auto === true) !== firstAuto) {
          mix = true;
          break;
        }
        if (!firstAuto) {
          var d2 = +r2.font_size_px * s2;
          if (Math.abs(d2 - firstDisp) > 0.6) {
            mix = true;
            break;
          }
        }
      }
      if (mix) {
        fltFontPreset.value = "";
      } else if (reg.font_auto === true) {
        fltFontPreset.value = "__auto__";
      } else {
        fltFontPreset.value = nearestFontPresetValue(firstDisp);
      }
    } else if (reg.font_auto === true) {
      fltFontPreset.value = "__auto__";
    } else {
      var scBar = pr.slab.scale || 1;
      var dispBar = +reg.font_size_px * scBar;
      fltFontPreset.value = nearestFontPresetValue(dispBar);
    }
    var innerBar = pr && regInnerEl(pr.regEl);
    var inEdit =
      selectedRegList.length === 1 &&
      innerBar &&
      document.activeElement === innerBar;
    for (var aj = 0; aj < alignBtns.length; aj++) {
      var b = alignBtns[aj];
      var da = b.getAttribute("data-align");
      var active = false;
      if (inEdit && document.queryCommandState) {
        if (da === "left") {
          active = document.queryCommandState("justifyLeft");
        } else if (da === "center") {
          active = document.queryCommandState("justifyCenter");
        } else if (da === "right") {
          active = document.queryCommandState("justifyRight");
        } else if (da === "justify") {
          active = document.queryCommandState("justifyFull");
        }
      } else {
        var imgWBar = pr.slab.img && pr.slab.img.naturalWidth;
        var hKind = detectRegBboxHAlignOnImage(reg, imgWBar);
        active = hKind != null && da === hKind;
      }
      b.classList.toggle("is-active", active);
    }
  }

  function syncRegToolsPanel() {
    syncStageTextBar();
  }

  function setRegSelection(slab, regEl, opts) {
    opts = opts || {};
    var additive = !!(opts.additive || opts.toggle);
    if (!regEl || !slab || !slab.layout) {
      return;
    }
    var ctx = makeRegCtx(slab, regEl);
    if (!ctx) {
      return;
    }
    if (additive) {
      for (var ai = 0; ai < selectedRegList.length; ai++) {
        if (selectedRegList[ai].regEl === regEl) {
          regEl.classList.remove("reg--selected");
          selectedRegList.splice(ai, 1);
          syncRegToolsPanel();
          return;
        }
      }
      selectedRegList.push(ctx);
      regEl.classList.add("reg--selected");
      syncRegToolsPanel();
      return;
    }
    if (
      selectedRegList.length === 1 &&
      selectedRegList[0].regEl === regEl &&
      selectedRegList[0].slab === slab
    ) {
      syncRegToolsPanel();
      return;
    }
    clearRegSelection();
    selectedRegList.push(ctx);
    regEl.classList.add("reg--selected");
    syncRegToolsPanel();
  }

  function rgbString(region) {
    var s = region && region.style;
    if (s && s.text_color_rgb && s.text_color_rgb.length === 3) {
      return (
        "rgb(" +
        s.text_color_rgb[0] +
        "," +
        s.text_color_rgb[1] +
        "," +
        s.text_color_rgb[2] +
        ")"
      );
    }
    return "#e6edf3";
  }

  /* 4px 在部分浏览器/高分辨率屏上中文会“看不见”；保留可读下限并允许裁切溢出 */
  var REG_FONT_MIN = 6;
  /** 与 main.css 中 .reg__inner 的 line-height 一致，用于估算行高，避免算出的字号在框里竖直裁切 */
  var REG_LINE_HEIGHT_EM = 1.45;
  /** 未指定字号时默认「小四」 */
  var DEFAULT_FONT_PX = 12;
  /** 中文常用字号（pt 约值），另含「自动适应框」 */
  var FONT_PRESETS = [
    { v: "42", label: "初号 · 42pt", px: 42 },
    { v: "36", label: "小初 · 36pt", px: 36 },
    { v: "26", label: "一号 · 26pt", px: 26 },
    { v: "24", label: "小一 · 24pt", px: 24 },
    { v: "22", label: "二号 · 22pt", px: 22 },
    { v: "18", label: "小二 · 18pt", px: 18 },
    { v: "16", label: "三号 · 16pt", px: 16 },
    { v: "15", label: "小三 · 15pt", px: 15 },
    { v: "14", label: "四号 · 14pt", px: 14 },
    { v: "12", label: "小四 · 12pt", px: 12 },
    { v: "10.5", label: "五号 · 10.5pt", px: 10.5 },
    { v: "9", label: "小五 · 9pt", px: 9 },
    { v: "__auto__", label: "自动适应框", px: 0 },
  ];

  function nearestFontPresetValue(px) {
    var n = +px;
    if (!isFinite(n) || n < 1) {
      return "12";
    }
    var bestV = String(DEFAULT_FONT_PX);
    var bestD = 1e9;
    for (var i = 0; i < FONT_PRESETS.length; i++) {
      var p = FONT_PRESETS[i];
      if (p.v === "__auto__") {
        continue;
      }
      var pv = parseFloat(p.v);
      var d = Math.abs(pv - n);
      if (d < bestD) {
        bestD = d;
        bestV = p.v;
      }
    }
    return bestV;
  }

  function fillFontPresetSelect(sel) {
    if (!sel || sel.getAttribute("data-filled")) {
      return;
    }
    var oMix = document.createElement("option");
    oMix.value = "";
    oMix.textContent = "— 多种不一致 —";
    sel.appendChild(oMix);
    FONT_PRESETS.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.v;
      o.textContent = p.label;
      sel.appendChild(o);
    });
    sel.setAttribute("data-filled", "1");
  }

  function autofitComputeSizeOnly(reg, wPx, hPx) {
    if (!reg || wPx < 0.1 || hPx < 0.1) {
      return REG_FONT_MIN + "px";
    }
    var t = (reg.text || "").replace(/\n/g, " ");
    var lh0 = reg.line_height_px || (reg.bbox && reg.bbox.height) || 16;
    if (!t.trim()) {
      return (
        String(
          Math.max(
            REG_FONT_MIN,
            (Math.min(lh0, hPx) * 0.75) | 0
          )
        ) + "px"
      );
    }
    var unit = /[\u3000-\u9fff\uff00-\uffff]/.test(t) ? 0.58 : 0.4;
    var maxF = Math.min(200, hPx, lh0 * 1.2) | 0;
    if (maxF < REG_FONT_MIN) {
      maxF = REG_FONT_MIN;
    }
    var oneLineF = ((wPx - 8) / (unit * t.length)) | 0;
    if (isFinite(oneLineF) && oneLineF > 0) {
      maxF = Math.min(maxF, Math.max(REG_FONT_MIN, oneLineF));
    }
    var f = 0;
    for (f = maxF; f >= REG_FONT_MIN; f--) {
      var lineH = f * REG_LINE_HEIGHT_EM;
      var cpl = (wPx - 8) / (unit * f);
      cpl = Math.max(0.1, cpl);
      if (t.length * unit * f <= wPx - 8) {
        if (lineH <= hPx + 1) {
          return f + "px";
        }
      } else {
        var lines = Math.ceil(t.length / cpl);
        if (lines * lineH <= hPx + 1) {
          return f + "px";
        }
      }
    }
    return REG_FONT_MIN + "px";
  }

  /**
   * 屏幕上的 CSS 字号（px）。wPx/hPx 为当前字框在屏幕上的宽高（与 applyRegElLayout 传入一致）。
   * reg.font_size_px 存的是「图像自然坐标系」下的字号，与 bbox 同单位，导出 PNG 时直接使用。
   */
  function effectiveFontPx(reg, wPx, hPx) {
    if (reg && reg.font_auto === true) {
      return (
        parseInt(autofitComputeSizeOnly(reg, wPx, hPx), 10) ||
        REG_FONT_MIN
      );
    }
    if (reg && reg.font_size_px != null && isFinite(+reg.font_size_px)) {
      var bwNat = reg.bbox && +reg.bbox.width;
      if (!bwNat || bwNat < 0.1) {
        bwNat = 1;
      }
      var disp = +reg.font_size_px * (wPx / bwNat);
      disp = Math.max(REG_FONT_MIN, Math.min(200, disp));
      var fitCap = parseInt(autofitComputeSizeOnly(reg, wPx, hPx), 10);
      if (isFinite(fitCap) && fitCap >= REG_FONT_MIN) {
        disp = Math.min(disp, fitCap);
      }
      return Math.max(REG_FONT_MIN, disp);
    }
    return (
      parseInt(autofitComputeSizeOnly(reg, wPx, hPx), 10) || REG_FONT_MIN
    );
  }

  /** 导出画布（自然分辨率）上用的字号，单位：与 bbox 相同的图像像素 */
  function fontNaturalPxForExport(reg, wNat, hNat) {
    if (reg && reg.font_auto === true) {
      return (
        parseInt(autofitComputeSizeOnly(reg, wNat, hNat), 10) || REG_FONT_MIN
      );
    }
    if (reg && reg.font_size_px != null && isFinite(+reg.font_size_px)) {
      var nat = +reg.font_size_px;
      var fitNat = parseInt(
        autofitComputeSizeOnly(reg, wNat, hNat),
        10
      );
      if (isFinite(fitNat) && fitNat >= REG_FONT_MIN) {
        nat = Math.min(nat, fitNat);
      }
      return Math.max(REG_FONT_MIN, Math.min(400, nat));
    }
    return (
      parseInt(autofitComputeSizeOnly(reg, wNat, hNat), 10) || REG_FONT_MIN
    );
  }

  function autofitFontSize(reg, wPx, hPx) {
    return effectiveFontPx(reg, wPx, hPx) + "px";
  }

  /** 字框相对背景图自然宽度的水平位置，用于未编辑时对齐按钮高亮 */
  function detectRegBboxHAlignOnImage(reg, imgW) {
    var bb = reg && reg.bbox;
    if (!bb || !isFinite(imgW) || imgW <= 0) {
      return null;
    }
    var x = +bb.x || 0;
    var bw = +bb.width || 0;
    if (bw <= 0) {
      bw = 1;
    }
    var eps = Math.max(2, imgW * 0.002);
    if (Math.abs(x) <= eps && Math.abs(+bb.width - imgW) <= eps + 1) {
      return "justify";
    }
    if (Math.abs(x - (imgW - bw) / 2) <= eps + 1) {
      return "center";
    }
    if (Math.abs(x - (imgW - bw)) <= eps + 1) {
      return "right";
    }
    if (Math.abs(x) <= eps) {
      return "left";
    }
    return null;
  }

  /** 将字框 bbox 在背景图自然宽度上左/中/右/拉满（未编辑态） */
  function applyRegBboxHAlignToImage(slab, reg, align) {
    if (!reg || !slab || !slab.img) {
      return;
    }
    var imgW = slab.img.naturalWidth;
    if (!isFinite(imgW) || imgW <= 0) {
      return;
    }
    if (!reg.bbox) {
      reg.bbox = {};
    }
    var bb = reg.bbox;
    var w = +bb.width;
    if (!isFinite(w) || w <= 0) {
      w = 1;
      bb.width = w;
    }
    if (align === "left") {
      bb.x = 0;
    } else if (align === "center") {
      bb.x = (imgW - w) / 2;
    } else if (align === "right") {
      bb.x = imgW - w;
    } else if (align === "justify") {
      bb.x = 0;
      bb.width = imgW;
    }
    if (align !== "justify" && isFinite(bb.x)) {
      bb.x = Math.max(0, Math.min(bb.x, Math.max(0, imgW - w)));
    }
  }

  function applyRegElLayout(s, reg, el) {
    if (!el || !reg) {
      return;
    }
    var b = reg.bbox || {};
    var sc = s.scale || 1;
    el.style.left = +b.x * sc + "px";
    el.style.top = +b.y * sc + "px";
    el.style.width = +b.width * sc + "px";
    el.style.height = +b.height * sc + "px";
    var inner = regInnerEl(el);
    if (inner) {
      inner.style.fontSize = autofitFontSize(
        reg,
        +b.width * sc,
        +b.height * sc
      );
      var ta = reg.text_align || "left";
      if (
        ta !== "left" &&
        ta !== "center" &&
        ta !== "right" &&
        ta !== "justify"
      ) {
        ta = "left";
      }
      inner.style.textAlign = ta;
    }
  }

  function applyTextShadowToEl(d, stageEl) {
    if (!d) {
      return;
    }
    if (stageEl && stageEl.classList.contains("use-filled")) {
      d.style.textShadow = "none";
      return;
    }
    if (chkGrid && chkGrid.checked) {
      d.style.textShadow = "0 0 1px #000,0 0 2px #000,0 0 3px #000";
    } else {
      d.style.textShadow = "none";
    }
  }

  function applySlateBg(s) {
    var p = { url: "", isFilled: false };
    if (chkUseFilled && chkUseFilled.checked && s.serverFilled) {
      p = { url: s.serverFilled, isFilled: true };
    } else if (s.serverOriginal) {
      p = { url: s.serverOriginal, isFilled: false };
    }
    if (p.url) {
      s.img.src = p.url;
    }
    s.stage.classList.toggle("use-filled", !!p.isFilled);
  }

  function updateZoomLabel() {
    if (!zoomPct) {
      return;
    }
    var t = Math.round(viewZoom * 100) + "%";
    if ("value" in zoomPct) {
      zoomPct.value = t;
    }
    zoomPct.textContent = t;
  }

  function applySlateScale(s) {
    if (!s || !s.img.naturalWidth) {
      return;
    }
    var aw = stageWrap.clientWidth;
    if (aw < 1) {
      aw = stageWrap.getBoundingClientRect().width;
    }
    if (aw < 0.1) {
      return;
    }
    var nat = s.img.naturalWidth;
    var fitW = Math.min(nat, aw);
    var displayW = fitW * viewZoom;
    if (displayW < 0.5) {
      return;
    }
    s.img.style.width = displayW + "px";
    s.img.style.maxWidth = "none";
    s.img.style.height = "auto";
    void s.stage.offsetWidth;
    var cw = s.img.getBoundingClientRect().width;
    if (!cw || !isFinite(cw) || cw < 0.1) {
      return;
    }
    s.scale = cw / nat;
    s.stage.classList.add("is-sized");
  }

  function ensureSnapLayer(s) {
    if (!s || !s.stage) {
      return null;
    }
    if (s.snapLayerEl && s.snapLayerEl.parentNode === s.stage) {
      return s.snapLayerEl;
    }
    var sl = document.createElement("div");
    sl.className = "stage-snap-layer";
    sl.setAttribute("aria-hidden", "true");
    s.stage.appendChild(sl);
    s.snapLayerEl = sl;
    return sl;
  }

  function clearSnapLines(s) {
    if (s && s.snapLayerEl) {
      s.snapLayerEl.innerHTML = "";
    }
  }

  function renderSnapLines(s, linesV, linesH) {
    var sl = ensureSnapLayer(s);
    if (!sl) {
      return;
    }
    sl.innerHTML = "";
    var sh = s.stage.clientHeight || 0;
    var sw = s.stage.clientWidth || 0;
    for (var i = 0; i < (linesV || []).length; i++) {
      var x = linesV[i];
      var d = document.createElement("div");
      d.className = "stage-snap-line stage-snap-line--v";
      d.style.left = x + "px";
      d.style.top = "0";
      d.style.height = sh + "px";
      sl.appendChild(d);
    }
    for (var j = 0; j < (linesH || []).length; j++) {
      var y = linesH[j];
      var d2 = document.createElement("div");
      d2.className = "stage-snap-line stage-snap-line--h";
      d2.style.top = y + "px";
      d2.style.left = "0";
      d2.style.width = sw + "px";
      sl.appendChild(d2);
    }
  }

  function snapMoveBBox(s, excludingReg, nx, ny, bw, bh, sc) {
    var natW = s.img.naturalWidth || 1;
    var natH = s.img.naturalHeight || 1;
    var th = Math.max(1 / sc, 5 / sc);
    var gx = [0, natW * 0.5, natW];
    var gy = [0, natH * 0.5, natH];
    (s.layout.regions || []).forEach(function (r) {
      if (r === excludingReg) {
        return;
      }
      var b = r.bbox || {};
      var lx = +b.x || 0;
      var ly = +b.y || 0;
      var lw = +b.width || 0;
      var lh = +b.height || 0;
      gx.push(lx, lx + lw * 0.5, lx + lw);
      gy.push(ly, ly + lh * 0.5, ly + lh);
    });
    var bestDx = 0;
    var bestAx = th + 1;
    var hitVx = null;
    var gxi = 0;
    for (gxi = 0; gxi < gx.length; gxi++) {
      var g = gx[gxi];
      var deltas = [nx - g, nx + bw * 0.5 - g, nx + bw - g];
      var di = 0;
      for (di = 0; di < deltas.length; di++) {
        var delta = deltas[di];
        var ad = Math.abs(delta);
        if (ad <= th && ad < bestAx) {
          bestAx = ad;
          bestDx = delta;
          hitVx = g;
        }
      }
    }
    nx -= bestDx;
    var bestDy = 0;
    var bestAy = th + 1;
    var hitVy = null;
    var gyi = 0;
    for (gyi = 0; gyi < gy.length; gyi++) {
      var g2 = gy[gyi];
      var deltas2 = [ny - g2, ny + bh * 0.5 - g2, ny + bh - g2];
      var dj = 0;
      for (dj = 0; dj < deltas2.length; dj++) {
        var delta2 = deltas2[dj];
        var ad2 = Math.abs(delta2);
        if (ad2 <= th && ad2 < bestAy) {
          bestAy = ad2;
          bestDy = delta2;
          hitVy = g2;
        }
      }
    }
    ny -= bestDy;
    nx = Math.max(0, Math.min(natW - bw, nx));
    ny = Math.max(0, Math.min(natH - bh, ny));
    var linesV =
      hitVx != null && bestAx <= th ? [hitVx * sc] : [];
    var linesH =
      hitVy != null && bestAy <= th ? [hitVy * sc] : [];
    return { x: nx, y: ny, linesV: linesV, linesH: linesH };
  }

  function endRegInteract() {
    var slabSnap = regInteractState && regInteractState.slab;
    if (regInteractState && regInteractState.capEl) {
      if (regInteractState.moveFn) {
        regInteractState.capEl.removeEventListener(
          "pointermove",
          regInteractState.moveFn
        );
        regInteractState.capEl.removeEventListener(
          "pointerup",
          regInteractState.upFn
        );
        regInteractState.capEl.removeEventListener(
          "pointercancel",
          regInteractState.upFn
        );
      }
      try {
        if (regInteractState.pointerId != null) {
          regInteractState.capEl.releasePointerCapture(
            regInteractState.pointerId
          );
        }
      } catch (err) {
        /* ignore */
      }
      if (regInteractState.regEl) {
        regInteractState.regEl.classList.remove("is-panning");
      }
    }
    regInteractState = null;
    if (slabSnap) {
      clearSnapLines(slabSnap);
    }
  }

  function applyResizeCorner(st, dx, dy) {
    var reg = st.reg;
    if (!reg.bbox) {
      reg.bbox = {};
    }
    var bb = reg.bbox;
    var natW = st.natImgW;
    var natH = st.natImgH;
    var ix = st.ix;
    var iy = st.iy;
    var iw = st.iw;
    var ih = st.ih;
    var minS = 12;
    function clampDim(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }
    switch (st.corner) {
      case "se": {
        bb.x = ix;
        bb.y = iy;
        bb.width = clampDim(iw + dx, minS, natW - ix);
        bb.height = clampDim(ih + dy, minS, natH - iy);
        break;
      }
      case "nw": {
        var nww = clampDim(iw - dx, minS, ix + iw);
        var nhh = clampDim(ih - dy, minS, iy + ih);
        bb.x = ix + iw - nww;
        bb.y = iy + ih - nhh;
        bb.width = nww;
        bb.height = nhh;
        break;
      }
      case "ne": {
        var nww2 = clampDim(iw + dx, minS, natW - ix);
        var nhh2 = clampDim(ih - dy, minS, iy + ih);
        bb.x = ix;
        bb.y = iy + ih - nhh2;
        bb.width = nww2;
        bb.height = nhh2;
        break;
      }
      case "sw": {
        var nww3 = clampDim(iw - dx, minS, ix + iw);
        var nhh3 = clampDim(ih + dy, minS, natH - iy);
        bb.x = ix + iw - nww3;
        bb.y = iy;
        bb.width = nww3;
        bb.height = nhh3;
        break;
      }
      default:
        break;
    }
    bb.x = clampDim(+bb.x || 0, 0, natW - minS);
    bb.y = clampDim(+bb.y || 0, 0, natH - minS);
    bb.width = clampDim(+bb.width || minS, minS, natW - bb.x);
    bb.height = clampDim(+bb.height || minS, minS, natH - bb.y);
  }

  function onRegInteractMove(e) {
    if (!regInteractState) {
      return;
    }
    if (
      e.pointerId != null &&
      e.pointerId !== regInteractState.pointerId
    ) {
      return;
    }
    var st = regInteractState;
    var sc = st.slab.scale || 1;
    var dx = (e.clientX - st.startClientX) / sc;
    var dy = (e.clientY - st.startClientY) / sc;
    var reg = st.reg;
    if (!reg.bbox) {
      reg.bbox = {};
    }
    var bb = reg.bbox;
    var natW = st.natImgW;
    var natH = st.natImgH;
    if (st.kind === "move") {
      var nx = st.natX + dx;
      var ny = st.natY + dy;
      var bw = +bb.width || st.iw;
      var bh = +bb.height || st.ih;
      nx = Math.max(0, Math.min(natW - bw, nx));
      ny = Math.max(0, Math.min(natH - bh, ny));
      var sn = snapMoveBBox(st.slab, reg, nx, ny, bw, bh, sc);
      bb.x = sn.x;
      bb.y = sn.y;
      renderSnapLines(st.slab, sn.linesV, sn.linesH);
    } else if (st.kind === "resize") {
      clearSnapLines(st.slab);
      applyResizeCorner(st, dx, dy);
    }
    applyRegElLayout(st.slab, reg, st.regEl);
    e.preventDefault();
  }

  function onRegInteractUp(e) {
    if (!regInteractState) {
      return;
    }
    if (
      e.pointerId != null &&
      e.pointerId !== regInteractState.pointerId
    ) {
      return;
    }
    endRegInteract();
    if (jsonPreview && pageSlabs.length) {
      jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
    }
  }

  function startRegMove(s, reg, regEl, e, anchorXY) {
    endRegInteract();
    if (selectedRegList.length > 1) {
      setRegSelection(s, regEl);
    }
    var b = reg.bbox || {};
    var cap = e.currentTarget;
    var ax =
      anchorXY && isFinite(anchorXY.x) ? anchorXY.x : e.clientX;
    var ay =
      anchorXY && isFinite(anchorXY.y) ? anchorXY.y : e.clientY;
    var moveFn = function (ev) {
      onRegInteractMove(ev);
    };
    var upFn = function (ev) {
      onRegInteractUp(ev);
    };
    regInteractState = {
      kind: "move",
      slab: s,
      reg: reg,
      regEl: regEl,
      capEl: cap,
      pointerId: e.pointerId,
      moveFn: moveFn,
      upFn: upFn,
      natX: +b.x || 0,
      natY: +b.y || 0,
      iw: +b.width || 1,
      ih: +b.height || 1,
      startClientX: ax,
      startClientY: ay,
      natImgW: s.img.naturalWidth || 1,
      natImgH: s.img.naturalHeight || 1,
    };
    cap.addEventListener("pointermove", moveFn);
    cap.addEventListener("pointerup", upFn);
    cap.addEventListener("pointercancel", upFn);
    regEl.classList.add("is-panning");
    try {
      cap.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    e.preventDefault();
  }

  function startRegResize(s, reg, regEl, corner, e) {
    endRegInteract();
    if (selectedRegList.length > 1) {
      setRegSelection(s, regEl);
    }
    var b = reg.bbox || {};
    var cap = e.currentTarget;
    var moveFn = function (ev) {
      onRegInteractMove(ev);
    };
    var upFn = function (ev) {
      onRegInteractUp(ev);
    };
    regInteractState = {
      kind: "resize",
      corner: corner,
      slab: s,
      reg: reg,
      regEl: regEl,
      capEl: cap,
      pointerId: e.pointerId,
      moveFn: moveFn,
      upFn: upFn,
      ix: +b.x || 0,
      iy: +b.y || 0,
      iw: +b.width || 1,
      ih: +b.height || 1,
      startClientX: e.clientX,
      startClientY: e.clientY,
      natImgW: s.img.naturalWidth || 1,
      natImgH: s.img.naturalHeight || 1,
    };
    cap.addEventListener("pointermove", moveFn);
    cap.addEventListener("pointerup", upFn);
    cap.addEventListener("pointercancel", upFn);
    regEl.classList.add("is-panning");
    try {
      cap.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    e.preventDefault();
  }

  /** 在 listenEl 上监听 pointer：小幅移动视为点击，超过阈值则开始拖移整框 */
  function bindRegMoveArm(s, reg, regEl, listenEl, ev) {
    var sx = ev.clientX;
    var sy = ev.clientY;
    var pid = ev.pointerId;
    var moved = false;
    function cleanupArm() {
      listenEl.removeEventListener("pointermove", onArmMove);
      listenEl.removeEventListener("pointerup", onArmUp);
      listenEl.removeEventListener("pointercancel", onArmUp);
    }
    function onArmMove(ev2) {
      if (ev2.pointerId !== pid) {
        return;
      }
      if (!moved) {
        if (
          Math.abs(ev2.clientX - sx) <= 4 &&
          Math.abs(ev2.clientY - sy) <= 4
        ) {
          return;
        }
        moved = true;
        cleanupArm();
        startRegMove(s, reg, regEl, ev2, { x: sx, y: sy });
        onRegInteractMove(ev2);
      }
    }
    function onArmUp(ev2) {
      if (ev2.pointerId !== pid) {
        return;
      }
      cleanupArm();
    }
    listenEl.addEventListener("pointermove", onArmMove);
    listenEl.addEventListener("pointerup", onArmUp);
    listenEl.addEventListener("pointercancel", onArmUp);
  }

  function focusRegInnerForEdit(innerEl) {
    if (!innerEl) {
      return;
    }
    try {
      innerEl.focus();
    } catch (err) {
      /* ignore */
    }
  }

  function wireRegChrome(s, d, reg, i) {
    var inner = d.querySelector(".reg__inner");
    var shield = d.querySelector(".reg__dragshield");
    if (!inner || !shield) {
      return;
    }
    inner.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) {
        return;
      }
      var additive = ev.ctrlKey || ev.metaKey;
      setRegSelection(s, d, { additive: additive });
      if (additive) {
        ev.stopPropagation();
        return;
      }
      if (document.activeElement === inner) {
        return;
      }
      ev.stopPropagation();
      bindRegMoveArm(s, reg, d, inner, ev);
    });
    /* 单击只选框不抢焦点；已在内层编辑时放行原生行为（拖选、移光标） */
    inner.addEventListener("mousedown", function (ev) {
      if (document.activeElement !== inner && ev.detail < 2) {
        ev.preventDefault();
      }
    });
    inner.addEventListener("dblclick", function (ev) {
      ev.stopPropagation();
      setRegSelection(s, d);
      focusRegInnerForEdit(inner);
    });
    inner.addEventListener("focus", function () {
      setRegSelection(s, d);
    });
    shield.addEventListener("dblclick", function (ev) {
      if (ev.button !== 0) {
        return;
      }
      ev.stopPropagation();
      setRegSelection(s, d);
      focusRegInnerForEdit(inner);
      try {
        var sel = window.getSelection && window.getSelection();
        if (sel && document.createRange) {
          var range = document.createRange();
          range.selectNodeContents(inner);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (err2) {
        /* ignore */
      }
    });
    /* 未进入编辑：顶条拦截指针，像 PPT 一样拖框体移动 */
    shield.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) {
        return;
      }
      ev.stopPropagation();
      var addSh = ev.ctrlKey || ev.metaKey;
      setRegSelection(s, d, { additive: addSh });
      if (addSh) {
        return;
      }
      bindRegMoveArm(s, reg, d, shield, ev);
    });
    var hzList = d.querySelectorAll(".reg__hz");
    for (var h = 0; h < hzList.length; h++) {
      (function (hz) {
        hz.addEventListener("pointerdown", function (ev) {
          ev.stopPropagation();
          setRegSelection(s, d);
          var c = hz.getAttribute("data-resize") || "se";
          startRegResize(s, reg, d, c, ev);
        });
      })(hzList[h]);
    }
    inner.addEventListener("input", function () {
      var did = d.getAttribute("data-id");
      var b = reg.bbox || {};
      var w0 = +b.width || 1;
      var h0 = +b.height || 1;
      (s.layout.regions || []).forEach(function (r, j) {
        if (String(r.id != null ? r.id : j) === did) {
          r.text = (inner.textContent || "").replace(/\n/g, " ");
          var tsc = s.scale || 1;
          inner.style.fontSize = autofitFontSize(
            r,
            w0 * tsc,
            h0 * tsc
          );
        }
      });
    });
  }

  function buildSlateOverlays(s) {
    s.overlaysEl.innerHTML = "";
    if (!s.layout) {
      return;
    }
    (s.layout.regions || []).forEach(function (reg, i) {
      if (reg.font_auto !== true) {
        if (reg.font_size_px == null || !isFinite(+reg.font_size_px)) {
          var bn = reg.bbox || {};
          reg.font_size_px = parseInt(
            autofitComputeSizeOnly(
              reg,
              +bn.width || 1,
              +bn.height || 1
            ),
            10
          ) || REG_FONT_MIN;
        }
      }
      var rid = reg.id != null ? reg.id : i;
      var d = document.createElement("div");
      d.className = "reg";
      d.setAttribute("spellcheck", "false");
      d.setAttribute("data-id", String(rid));
      d.style.color = rgbString(reg);
      d.innerHTML =
        "<div class=\"reg__inner\" contenteditable=\"true\" spellcheck=\"false\"></div>" +
        "<div class=\"reg__dragshield\" title=\"拖动移动字框；双击进入编辑\"></div>" +
        "<span class=\"reg__hz reg__hz--nw\" data-resize=\"nw\" role=\"presentation\"></span>" +
        "<span class=\"reg__hz reg__hz--ne\" data-resize=\"ne\" role=\"presentation\"></span>" +
        "<span class=\"reg__hz reg__hz--sw\" data-resize=\"sw\" role=\"presentation\"></span>" +
        "<span class=\"reg__hz reg__hz--se\" data-resize=\"se\" role=\"presentation\"></span>";
      var inner = d.querySelector(".reg__inner");
      inner.textContent = reg.text || "";
      applyRegElLayout(s, reg, d);
      applyTextShadowToEl(inner, s.stage);
      wireRegChrome(s, d, reg, i);
      s.overlaysEl.appendChild(d);
    });
  }

  function onSlabReady(s) {
    s.img.style.removeProperty("width");
    s.img.style.removeProperty("max-width");
    s.stage.classList.remove("is-sized");
    stageWrap.classList.add("visible");
    raf2(function () {
      applySlateScale(s);
      buildSlateOverlays(s);
      updateZoomLabel();
      if (stageToolbar) {
        stageToolbar.hidden = false;
      }
      applyStagesPanTransform();
      syncRegToolsPanel();
    });
  }

  function reflowAllSlabs() {
    if (!pageSlabs.length) {
      return;
    }
    var ok = false;
    pageSlabs.forEach(function (s) {
      if (!s.img.naturalWidth) {
        return;
      }
      ok = true;
      applySlateScale(s);
      if (s.layout) {
        (s.layout.regions || []).forEach(function (reg, i) {
          var rid = reg.id != null ? reg.id : i;
          var el = qReg(s, String(rid));
          if (!el) {
            return;
          }
          applyRegElLayout(s, reg, el);
        });
      }
    });
    if (ok) {
      updateZoomLabel();
    }
  }

  /* 以视区某点为锚，缩放后保持其对应内容在指针下（滚轮=指针，按钮=视区中心） */
  function applyViewZoomPanAnchor(anchorX, anchorY, oldZ, newZ) {
    if (!stageWrap || !isFinite(anchorX) || !isFinite(anchorY)) {
      return;
    }
    if (oldZ < 0.0001 || newZ < 0.0001) {
      return;
    }
    var k = newZ / oldZ;
    if (k === 1 || !isFinite(k)) {
      return;
    }
    canvasPanX = canvasPanX * k + anchorX * (1 - k);
    canvasPanY = canvasPanY * k + anchorY * (1 - k);
    applyStagesPanTransform();
  }

  function hasAnyImage() {
    return pageSlabs.some(function (s) { return s.img && s.img.naturalWidth; });
  }

  function ocrFile(file) {
    var b = new FormData();
    b.append("image", file);
    return fetch("/api/ocr", { method: "POST", body: b }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) {
          throw new Error(j.error || r.statusText);
        }
        return j;
      });
    });
  }

  function appendSlateFromJ(j, name) {
    if (!stagesRoot) {
      return;
    }
    var n = pageSlabs.length;
    var sid = nextSlabId++;
    var article = document.createElement("article");
    article.className = "doc-slab";
    article.setAttribute("data-slab-id", String(sid));
    var head = document.createElement("header");
    head.className = "doc-slab__head";
    var idx = document.createElement("span");
    idx.className = "doc-slab__i";
    idx.textContent = "#" + (n + 1);
    var fn = document.createElement("span");
    fn.className = "doc-slab__fn";
    fn.textContent = name || "未命名";
    head.appendChild(idx);
    head.appendChild(fn);
    var body = document.createElement("div");
    body.className = "doc-slab__body";
    var st = document.createElement("div");
    st.className = "stage doc-slab__stage";
    var im = document.createElement("img");
    im.className = "bg doc-slab__bg";
    im.setAttribute("alt", name || "底图");
    im.draggable = false;
    var ov = document.createElement("div");
    ov.className = "overlays";
    var snapL = document.createElement("div");
    snapL.className = "stage-snap-layer";
    snapL.setAttribute("aria-hidden", "true");
    st.appendChild(im);
    st.appendChild(ov);
    st.appendChild(snapL);
    body.appendChild(st);
    article.appendChild(head);
    article.appendChild(body);
    stagesRoot.appendChild(article);
    var slab = {
      el: article,
      slabId: sid,
      layout: j.layout,
      serverOriginal: j.imageUrl,
      serverFilled: j.filledImageUrl || null,
      filename: name || "",
      stage: st,
      img: im,
      overlaysEl: ov,
      snapLayerEl: snapL,
      scale: 1,
    };
    pageSlabs.push(slab);
    updateChkFilled();
    applySlateBg(slab);
    whenImageReady(slab.img, function () { onSlabReady(slab); });
    syncFilmstrip();
  }

  function syncSlabToLayout(s) {
    (s.layout.regions || []).forEach(function (r, i) {
      var el = qReg(s, String(r.id != null ? r.id : i));
      if (el) {
        r.text = getTextFromRegEl(el);
      }
    });
  }

  function ocrOnServer() {
    if (!fileImage || !fileImage.files || !fileImage.files.length) {
      setStatus("请先选择图片（可多选）。", "err");
      return;
    }
    var list = [];
    for (var f = 0; f < fileImage.files.length; f++) {
      var file = fileImage.files[f];
      if (file.type && file.type.indexOf("image/") === 0) {
        list.push(file);
      }
    }
    if (!list.length) {
      setStatus("没有可用的图片文件。", "err");
      return;
    }
    viewZoom = 1;
    clearObjectUrl();
    clearSlabs();
    if (jsonPreview) {
      jsonPreview.value = "";
    }
    var ocrL = btnOcr.textContent;
    btnOcr.disabled = true;
    btnOcr.textContent = "识别中…";
    var i = 0;
    var okN = 0;
    var failN = 0;
    function step() {
      if (i >= list.length) {
        btnOcr.disabled = false;
        btnOcr.textContent = ocrL;
        var m =
          "完成。成功 " + okN + " 张" + (failN ? "，失败 " + failN : "") + "。";
        if (okN) {
          setStatus(m, "ok");
        } else {
          setStatus(m, "err");
        }
        if (jsonPreview && pageSlabs.length) {
          jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
        }
        syncRegToolsPanel();
        return;
      }
      setStatus("识别中 " + (i + 1) + " / " + list.length, "working");
      ocrFile(list[i])
        .then(function (j) {
          var fcur = list[i];
          okN++;
          appendSlateFromJ(j, fcur ? fcur.name : "");
        })
        .catch(function (e) {
          failN++;
          setStatus(
            "第 " + (i + 1) + " 张失败: " + (e && e.message ? e.message : e),
            "err"
          );
        })
        .then(function () {
          i++;
          step();
        });
    }
    step();
  }

  var filmstripOcrBusy = false;

  /** 在不清空现有页的前提下，将所选图片依次 OCR 并追加到末尾 */
  function filmstripAppendOcr(fileList) {
    if (filmstripOcrBusy) {
      return;
    }
    var list = [];
    for (var fi = 0; fi < fileList.length; fi++) {
      var file = fileList[fi];
      if (file && file.type && file.type.indexOf("image/") === 0) {
        list.push(file);
      }
    }
    if (!list.length) {
      setStatus("没有可用的图片文件。", "err");
      return;
    }
    filmstripOcrBusy = true;
    if (btnFilmstripAdd) {
      btnFilmstripAdd.disabled = true;
    }
    if (btnOcr) {
      btnOcr.disabled = true;
    }
    var i = 0;
    var okN = 0;
    var failN = 0;
    function unlock() {
      filmstripOcrBusy = false;
      if (btnFilmstripAdd) {
        btnFilmstripAdd.disabled = false;
      }
      if (btnOcr) {
        btnOcr.disabled = false;
      }
      if (filmstripFileAdd) {
        filmstripFileAdd.value = "";
      }
    }
    function stepAppend() {
      if (i >= list.length) {
        unlock();
        var m =
          "已追加 " + okN + " 张" + (failN ? "，失败 " + failN + " 张" : "") + "。";
        setStatus(m, okN ? "ok" : "err");
        if (jsonPreview && pageSlabs.length) {
          jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
        }
        syncRegToolsPanel();
        return;
      }
      setStatus("追加识别 " + (i + 1) + " / " + list.length, "working");
      ocrFile(list[i])
        .then(function (j) {
          var fcur = list[i];
          okN++;
          appendSlateFromJ(j, fcur ? fcur.name : "");
        })
        .catch(function (e) {
          failN++;
          setStatus(
            "追加第 " + (i + 1) + " 张失败: " + (e && e.message ? e.message : e),
            "err"
          );
        })
        .then(function () {
          i++;
          stepAppend();
        });
    }
    stepAppend();
  }

  function downloadLayout() {
    if (!pageSlabs.length) {
      setStatus("无数据可导出", "err");
      return;
    }
    pageSlabs.forEach(syncSlabToLayout);
    var blob = new Blob([JSON.stringify(buildBatchJson(), null, 2)], {
      type: "application/json;charset=utf-8",
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "text_layout_batch.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("已下载 text_layout_batch.json", "ok");
  }

  function drawSlabPng(s, done) {
    (s.layout.regions || []).forEach(function (r, i) {
      var el = qReg(s, String(r.id != null ? r.id : i));
      if (el) {
        r.text = getTextFromRegEl(el);
      }
    });
    var w = s.img.naturalWidth;
    var h0 = s.img.naturalHeight;
    if (!w || !h0) {
      done(null);
      return;
    }
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h0;
    var ctx = c.getContext("2d");
    ctx.drawImage(s.img, 0, 0, w, h0);
    (s.layout.regions || []).forEach(function (reg) {
      var b = reg.bbox || {};
      var t = (reg.text || "").replace(/\n/g, " ").trim();
      if (!t) {
        return;
      }
      var st = reg.style;
      var rgb = st && st.text_color_rgb ? st.text_color_rgb : [230, 230, 230];
      ctx.fillStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
      var fontPx = fontNaturalPxForExport(
        reg,
        +b.width || 1,
        +b.height || 1
      );
      ctx.font = fontPx + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      var ta0 = reg.text_align || "left";
      if (
        ta0 !== "left" &&
        ta0 !== "center" &&
        ta0 !== "right" &&
        ta0 !== "justify"
      ) {
        ta0 = "left";
      }
      var taDraw = ta0 === "justify" ? "left" : ta0;
      ctx.textAlign =
        taDraw === "center"
          ? "center"
          : taDraw === "right"
            ? "right"
            : "left";
      ctx.textBaseline = "top";
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.width, b.height);
      ctx.clip();
      var tx = b.x + 2;
      if (taDraw === "center") {
        tx = b.x + b.width / 2;
      } else if (taDraw === "right") {
        tx = b.x + b.width - 2;
      }
      ctx.fillText(t, tx, b.y + 1, b.width - 4);
      ctx.restore();
    });
    c.toBlob(function (b) { done(b); });
  }

  function exportPng() {
    if (!pageSlabs.length) {
      setStatus("无图可导出", "err");
      return;
    }
    var toSave = pageSlabs.filter(function (s) {
      return s.img && s.img.naturalWidth;
    });
    if (!toSave.length) {
      setStatus("无图可导出", "err");
      return;
    }
    var idx = 0;
    var pad = function (i) { return (i < 10 ? "0" : "") + i; };
    function nextPng() {
      if (idx >= toSave.length) {
        setStatus("已保存 " + toSave.length + " 个 PNG 文件", "ok");
        return;
      }
      var s = toSave[idx];
      var i1 = idx + 1;
        drawSlabPng(s, function (blob) {
        if (!blob) {
          setStatus("第 " + i1 + " 张导出失败", "err");
        } else {
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          var base = (s.filename || "page").replace(/[\\/:*?"<>|]/g, "_");
          if (base.length > 40) {
            base = base.substring(0, 37) + "…";
          }
          a.download = "edited_" + pad(i1) + "_" + (base || "p") + ".png";
          a.click();
          URL.revokeObjectURL(a.href);
        }
        idx++;
        setTimeout(nextPng, 200);
      });
    }
    nextPng();
  }

  function basenameFromApiFileUrl(url) {
    if (!url || typeof url !== "string") {
      return null;
    }
    var m = url.match(/\/api\/file\/([^?#]+)/);
    if (!m) {
      return null;
    }
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }

  function exportPptx() {
    if (!pageSlabs.length) {
      setStatus("无图可导出", "err");
      return;
    }
    var toSave = pageSlabs.filter(function (s) {
      return s.img && s.img.naturalWidth;
    });
    if (!toSave.length) {
      setStatus("无图可导出", "err");
      return;
    }
    toSave.forEach(syncSlabToLayout);
    var backgrounds = toSave.map(function (s) {
      var u =
        chkUseFilled && chkUseFilled.checked && s.serverFilled
          ? s.serverFilled
          : s.serverOriginal ||
            (s.img && s.img.getAttribute("src")) ||
            "";
      return basenameFromApiFileUrl(u);
    });
    if (backgrounds.some(function (b) {
      return !b;
    })) {
      setStatus(
        "PPTX 仅支持本机识别后的图。请用「开始识别」后再导出。",
        "err"
      );
      return;
    }
    var pages = toSave.map(function (s) {
      var layout = JSON.parse(JSON.stringify(s.layout || {}));
      (layout.regions || []).forEach(function (reg) {
        var b = reg.bbox || {};
        var wn = +b.width || 1;
        var hn = +b.height || 1;
        reg.export_font_nat = fontNaturalPxForExport(reg, wn, hn);
      });
      return layout;
    });
    var payload = {
      format: "batch_v1",
      count: pages.length,
      pages: pages,
      filenames: toSave.map(function (s) {
        return s.filename || "";
      }),
      background_files: backgrounds,
    };
    setStatus("正在生成 PPTX…", "working");
    fetch("/api/export_pptx", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(
            function (j) {
              throw new Error((j && j.error) || r.statusText);
            },
            function () {
              throw new Error(r.statusText || "请求失败");
            }
          );
        }
        return r.blob();
      })
      .then(function (blob) {
        if (!blob || !blob.size) {
          throw new Error("空文件");
        }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "edited_layout.pptx";
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus("已下载 edited_layout.pptx", "ok");
      })
      .catch(function (e) {
        setStatus(
          "PPTX 导出失败: " + (e && e.message ? e.message : e),
          "err"
        );
      });
  }

  function applyJsonFromTextarea() {
    try {
      var j = JSON.parse(jsonPreview.value);
      if (j && j.pages && j.pages.length && j.format === "batch_v1") {
        setStatus("请通过重新识别或自行加载多图，暂不在此导入批量 JSON 画布", "ok");
        return;
      }
      if (j && j.regions && pageSlabs.length === 1) {
        pageSlabs[0].layout = j;
        onSlabReady(pageSlabs[0]);
        setStatus("已应用当前 JSON 到第 1 张", "ok");
      } else if (j && j.regions && !pageSlabs.length) {
        setStatus("请先在侧栏完成识别，再应用 JSON", "err");
      } else if (j && j.regions) {
        setStatus("多图时单页 JSON 只适用于第 1 张，请用侧栏导出的 batch 或逐张编辑", "err");
      } else {
        setStatus("JSON 格式不识别", "err");
      }
    } catch (e) {
      setStatus("JSON 无法解析: " + e.message, "err");
    }
  }

  if (chkUseFilled) {
    chkUseFilled.addEventListener("change", function () {
      if (!pageSlabs.length) {
        return;
      }
      pageSlabs.forEach(function (s) {
        applySlateBg(s);
        whenImageReady(s.img, function () { onSlabReady(s); });
      });
      syncFilmstrip();
    });
  }

  if (fileImage && btnOcr) {
    btnOcr.addEventListener("click", ocrOnServer);
  }
  if (btnLayout) {
    btnLayout.addEventListener("click", downloadLayout);
  }
  if (btnPng) {
    btnPng.addEventListener("click", exportPng);
  }
  if (btnPptx) {
    btnPptx.addEventListener("click", exportPptx);
  }
  if (btnApplyJson) {
    btnApplyJson.addEventListener("click", applyJsonFromTextarea);
  }
  if (chkGrid) {
    chkGrid.addEventListener("change", function () {
      if (!pageSlabs.length) {
        return;
      }
      pageSlabs.forEach(function (s) {
        (s.layout.regions || []).forEach(function (r, i) {
          var rid = r.id != null ? r.id : i;
          var el = qReg(s, String(rid));
          applyTextShadowToEl(regInnerEl(el), s.stage);
        });
      });
    });
  }

  function deleteSelectedRegion() {
    if (!selectedRegList.length) {
      return;
    }
    var groups = {};
    for (var gi = 0; gi < selectedRegList.length; gi++) {
      var c = selectedRegList[gi];
      if (!c.slab || !c.slab.layout || !c.slab.layout.regions) {
        continue;
      }
      if (c.index < 0) {
        continue;
      }
      var sid = c.slab.slabId;
      if (!groups[sid]) {
        groups[sid] = { slab: c.slab, idxs: [] };
      }
      groups[sid].idxs.push(c.index);
    }
    var sids = Object.keys(groups);
    for (var gk = 0; gk < sids.length; gk++) {
      var g = groups[sids[gk]];
      g.idxs.sort(function (a, b) {
        return b - a;
      });
      var seen = {};
      for (var k = 0; k < g.idxs.length; k++) {
        var ix = g.idxs[k];
        if (seen[ix]) {
          continue;
        }
        seen[ix] = 1;
        if (ix < g.slab.layout.regions.length) {
          g.slab.layout.regions.splice(ix, 1);
        }
      }
      buildSlateOverlays(g.slab);
    }
    clearRegSelection();
    if (jsonPreview && pageSlabs.length) {
      jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
    }
    syncRegToolsPanel();
  }

  function pickSlabForNewRegion() {
    if (activeSlabId != null) {
      for (var i = 0; i < pageSlabs.length; i++) {
        if (
          pageSlabs[i].slabId === activeSlabId &&
          pageSlabs[i].layout &&
          pageSlabs[i].img.naturalWidth
        ) {
          return pageSlabs[i];
        }
      }
    }
    for (var j = 0; j < pageSlabs.length; j++) {
      if (pageSlabs[j].layout && pageSlabs[j].img.naturalWidth) {
        return pageSlabs[j];
      }
    }
    return null;
  }

  function addEmptyTextRegion() {
    var s = pickSlabForNewRegion();
    if (!s || !s.layout || !s.img.naturalWidth) {
      setStatus("请先完成识别后再新增字框。", "err");
      return;
    }
    var nw = s.img.naturalWidth;
    var nh = s.img.naturalHeight;
    var regions = s.layout.regions || (s.layout.regions = []);
    var maxId = -1;
    for (var r = 0; r < regions.length; r++) {
      var id0 = regions[r].id;
      if (id0 != null && isFinite(+id0)) {
        maxId = Math.max(maxId, +id0);
      } else {
        maxId = Math.max(maxId, r);
      }
    }
    var nid = maxId + 1;
    var bw = Math.min(280, Math.round(nw * 0.38));
    var bh = Math.max(40, Math.round(nh * 0.07));
    regions.push({
      id: nid,
      text: "新文字",
      bbox: {
        x: Math.round(nw * 0.08),
        y: Math.round(nh * 0.12),
        width: bw,
        height: bh,
      },
      style: { text_color_rgb: [26, 32, 44] },
      font_size_px: parseInt(
        autofitComputeSizeOnly(
          { text: "新文字", bbox: { width: bw, height: bh } },
          bw,
          bh
        ),
        10
      ) || REG_FONT_MIN,
      text_align: "left",
      font_auto: false,
    });
    buildSlateOverlays(s);
    var newEl = qReg(s, String(nid));
    if (newEl) {
      setRegSelection(s, newEl);
      var inn = regInnerEl(newEl);
      if (inn) {
        try {
          inn.focus();
          var sel = window.getSelection && window.getSelection();
          if (sel && document.createRange) {
            var range = document.createRange();
            range.selectNodeContents(inn);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (err) {
          /* ignore */
        }
      }
    }
    if (jsonPreview) {
      jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
    }
    setStatus("已新增字框：未编辑时拖框体移动，角点缩放。", "ok");
    syncRegToolsPanel();
  }

  function applyFltFontPreset() {
    if (!selectedRegList.length || !fltFontPreset) {
      return;
    }
    var v = fltFontPreset.value;
    if (v === "" || v === "__mix__") {
      return;
    }
    for (var fi = 0; fi < selectedRegList.length; fi++) {
      var c = selectedRegList[fi];
      if (!c.reg || !c.regEl || !c.regEl.isConnected) {
        continue;
      }
      var reg = c.reg;
      if (v === "__auto__") {
        reg.font_auto = true;
        delete reg.font_size_px;
      } else {
        reg.font_auto = false;
        var n = parseFloat(v);
        if (!isFinite(n)) {
          n = 12;
        }
        var scF = c.slab.scale || 1;
        reg.font_size_px = Math.min(
          400,
          Math.max(REG_FONT_MIN, n / scF)
        );
      }
      applyRegElLayout(c.slab, reg, c.regEl);
    }
    if (jsonPreview && pageSlabs.length) {
      jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
    }
    syncStageTextBar();
  }

  function syncRegTextFromInner(ctx) {
    if (!ctx || !ctx.reg || !ctx.regEl) {
      return;
    }
    var inn = regInnerEl(ctx.regEl);
    if (!inn) {
      return;
    }
    ctx.reg.text = (inn.textContent || "").replace(/\n/g, " ");
  }

  function applyFltTextAlign(align) {
    if (!selectedRegList.length) {
      return;
    }
    var multi = selectedRegList.length > 1;
    var pr = primaryRegCtx();
    if (!pr || !pr.reg) {
      return;
    }
    var innerA = regInnerEl(pr.regEl);
    var fromInnerToolbar = alignToolbarWasRegInnerFocus;
    alignToolbarWasRegInnerFocus = false;
    var inEdit =
      !multi &&
      innerA &&
      (document.activeElement === innerA || fromInnerToolbar);
    if (inEdit && fromInnerToolbar && innerA) {
      try {
        innerA.focus();
      } catch (errF) {
        /* ignore */
      }
    }
    if (inEdit) {
      var cmd =
        align === "left"
          ? "justifyLeft"
          : align === "center"
            ? "justifyCenter"
            : align === "right"
              ? "justifyRight"
              : align === "justify"
                ? "justifyFull"
                : "";
      if (cmd) {
        try {
          document.execCommand(cmd, false, null);
        } catch (err) {
          /* ignore */
        }
        syncRegTextFromInner(pr);
        if (jsonPreview && pageSlabs.length) {
          jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
        }
        syncStageTextBar();
      }
      return;
    }
    for (var ti = 0; ti < selectedRegList.length; ti++) {
      var c = selectedRegList[ti];
      if (!c.reg || !c.regEl) {
        continue;
      }
      applyRegBboxHAlignToImage(c.slab, c.reg, align);
      applyRegElLayout(c.slab, c.reg, c.regEl);
    }
    if (jsonPreview && pageSlabs.length) {
      jsonPreview.value = JSON.stringify(buildBatchJson(), null, 2);
    }
    syncStageTextBar();
  }

  if (fltAddText) {
    fltAddText.addEventListener("click", function () {
      addEmptyTextRegion();
    });
  }
  if (fltDelText) {
    fltDelText.addEventListener("click", function () {
      deleteSelectedRegion();
    });
  }
  if (fltFontPreset) {
    fltFontPreset.addEventListener("change", applyFltFontPreset);
  }
  (function wireAlignButtons() {
    if (stageTextBar) {
      stageTextBar.addEventListener(
        "pointerdown",
        function (ev) {
          if (!ev.target || !ev.target.closest) {
            return;
          }
          if (!ev.target.closest(".btn-flt-align")) {
            return;
          }
          var prA = primaryRegCtx();
          var ia =
            selectedRegList.length === 1 &&
            prA &&
            regInnerEl(prA.regEl);
          alignToolbarWasRegInnerFocus = !!(
            ia && document.activeElement === ia
          );
        },
        true
      );
    }
    var abs = document.querySelectorAll(".btn-flt-align");
    for (var bi = 0; bi < abs.length; bi++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var al = btn.getAttribute("data-align");
          if (al) {
            applyFltTextAlign(al);
          }
        });
      })(abs[bi]);
    }
  })();

  window.addEventListener(
    "keydown",
    function (e) {
      if (!e.shiftKey || e.key !== "Delete") {
        return;
      }
      var a = document.activeElement;
      if (a && a.isContentEditable && a.closest && a.closest(".reg__inner")) {
        return;
      }
      if (!selectedRegList.length) {
        return;
      }
      e.preventDefault();
      deleteSelectedRegion();
    },
    true
  );

  window.addEventListener("resize", function () {
    if (!hasAnyImage()) {
      return;
    }
    reflowAllSlabs();
  });

  /* —— 画布手动画布：平移（左键拖底图/空白、中键、空格+左键） —— */
  var spaceForPan = false;
  var panState = null;

  function isTextEditTarget(t) {
    if (!t) {
      return false;
    }
    if (t.isContentEditable && t.closest && t.closest(".reg__inner")) {
      return true;
    }
    if (t.tagName) {
      var n = t.tagName.toLowerCase();
      if (n === "input" || n === "textarea" || n === "select" || n === "button") {
        return true;
      }
    }
    if (t.closest && t.closest("input,textarea,select,button,a,label,summary")) {
      return true;
    }
    if (t.closest && t.closest("#stageTextBar")) {
      return true;
    }
    return false;
  }

  function onSpaceKey(e) {
    if (e.code !== "Space" || e.repeat) {
      return;
    }
    if (isTextEditTarget(e.target) || isTextEditTarget(document.activeElement)) {
      return;
    }
    e.preventDefault();
    spaceForPan = true;
    if (stageWrap) {
      stageWrap.classList.add("is-space-pan");
    }
  }

  function onSpaceKeyUp(e) {
    if (e.code !== "Space") {
      return;
    }
    spaceForPan = false;
    if (stageWrap) {
      stageWrap.classList.remove("is-space-pan");
    }
  }

  function endPan() {
    if (panState) {
      try {
        if (panState.pointerId != null) {
          stageWrap.releasePointerCapture(panState.pointerId);
        }
      } catch (err) {
        /* ignore */
      }
    }
    panState = null;
    if (stageWrap) {
      stageWrap.classList.remove("is-panning");
    }
  }

  function onStagePointerDown(e) {
    if (!stageWrap || !hasAnyImage()) {
      return;
    }
    if (e.pointerType === "touch") {
      return;
    }
    if (e.button === 2) {
      return;
    }
    var t = e.target;
    /* 点画布空白（字框外）取消选中，便于继续拖画布或点选其它框 */
    if (
      (e.button === 0 || e.button === 1) &&
      t &&
      t.closest &&
      !t.closest(".reg")
    ) {
      clearRegSelection();
    }
    if (
      e.button === 0 &&
      e.altKey &&
      stagesRoot &&
      t &&
      t.closest &&
      t.closest("#stages") &&
      !t.closest(".reg") &&
      !isTextEditTarget(t)
    ) {
      e.preventDefault();
      var rMar = stageWrap.getBoundingClientRect();
      marqueeSelectState = {
        pointerId: e.pointerId,
        x0: e.clientX - rMar.left,
        y0: e.clientY - rMar.top,
        x1: e.clientX - rMar.left,
        y1: e.clientY - rMar.top,
      };
      ensureMarqueeEl();
      updateMarqueeVisual();
      try {
        stageWrap.setPointerCapture(e.pointerId);
      } catch (errCap) {
        /* ignore */
      }
      stageWrap.classList.add("is-marquee");
      return;
    }
    if (e.button === 0) {
      if (!spaceForPan) {
        if (t && t.closest && t.closest(".reg")) {
          return;
        }
        if (t && t.closest && t.closest("input, textarea, select, button, a, label, summary")) {
          return;
        }
      } else {
        e.preventDefault();
      }
    }
    if (e.button === 1) {
      e.preventDefault();
    }
    var start =
      e.button === 1 ||
      (e.button === 0 && spaceForPan) ||
      (e.button === 0 && !isTextEditTarget(t) && !t.closest(".reg"));
    if (!start) {
      return;
    }
    e.preventDefault();
    panState = {
      pX: canvasPanX,
      pY: canvasPanY,
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
    };
    if (stageWrap) {
      stageWrap.classList.add("is-panning");
    }
    try {
      stageWrap.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  }

  function onStagePointerMove(e) {
    if (marqueeSelectState) {
      if (!stageWrap) {
        return;
      }
      if (
        e.pointerId != null &&
        e.pointerId !== marqueeSelectState.pointerId
      ) {
        return;
      }
      e.preventDefault();
      var rMv = stageWrap.getBoundingClientRect();
      marqueeSelectState.x1 = e.clientX - rMv.left;
      marqueeSelectState.y1 = e.clientY - rMv.top;
      updateMarqueeVisual();
      return;
    }
    if (!panState) {
      return;
    }
    if (e.pointerId != null && e.pointerId !== panState.pointerId) {
      return;
    }
    e.preventDefault();
    /* 与「抓住画布拖动」一致：鼠标往哪拖，内容往哪跟（原先用减号等同滚动条，竖向会反） */
    canvasPanX = panState.pX + (e.clientX - panState.x);
    canvasPanY = panState.pY + (e.clientY - panState.y);
    applyStagesPanTransform();
  }

  function onStagePointerUpOrCancel(e) {
    if (marqueeSelectState) {
      if (
        e.pointerId != null &&
        e.pointerId !== marqueeSelectState.pointerId
      ) {
        return;
      }
      finalizeMarqueeSelection(e);
      return;
    }
    if (!panState) {
      return;
    }
    if (e.pointerId != null && e.pointerId !== panState.pointerId) {
      return;
    }
    endPan();
  }

  if (stageWrap) {
    stageWrap.addEventListener("pointerdown", onStagePointerDown);
    stageWrap.addEventListener("pointermove", onStagePointerMove);
    stageWrap.addEventListener("pointerup", onStagePointerUpOrCancel);
    stageWrap.addEventListener("pointercancel", onStagePointerUpOrCancel);
    window.addEventListener("pointerup", onStagePointerUpOrCancel, true);
    window.addEventListener("pointercancel", onStagePointerUpOrCancel, true);
  }
  window.addEventListener("keydown", onSpaceKey, { capture: true });
  window.addEventListener("keyup", onSpaceKeyUp, { capture: true });

  /* 滚轮：无修饰键时二维平移画布；Ctrl+滚轮缩放 */
  if (stageWrap) {
    stageWrap.addEventListener(
      "wheel",
      function (e) {
        if (!hasAnyImage()) {
          return;
        }
        if (e.ctrlKey) {
          e.preventDefault();
          var oldZ = viewZoom;
          var m = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          viewZoom = Math.max(
            VIEW_Z.min,
            Math.min(VIEW_Z.max, viewZoom * m)
          );
          if (oldZ === viewZoom) {
            return;
          }
          var r = stageWrap.getBoundingClientRect();
          var ax = e.clientX - r.left;
          var ay = e.clientY - r.top;
          reflowAllSlabs();
          applyViewZoomPanAnchor(ax, ay, oldZ, viewZoom);
          return;
        }
        /* 仅当焦点在该字框内层、且确有溢出时，滚轮才滚字框；否则平移画布（避免滑过字框就「卡住」） */
        var regHost =
          e.target.closest && e.target.closest(".reg");
        if (regHost) {
          var innerScroll = regHost.querySelector(".reg__inner");
          if (innerScroll) {
            var edFocus =
              document.activeElement === innerScroll ||
              (document.activeElement &&
                innerScroll.contains(document.activeElement));
            var oy = 8;
            var canY =
              innerScroll.scrollHeight >
              innerScroll.clientHeight + oy;
            var canX =
              innerScroll.scrollWidth >
              innerScroll.clientWidth + oy;
            if (edFocus && (canY || canX)) {
              var dy = e.deltaY;
              var dx = e.deltaX;
              if (canY && dy !== 0) {
                var atTop = innerScroll.scrollTop <= 1;
                var atBot =
                  innerScroll.scrollTop + innerScroll.clientHeight >=
                  innerScroll.scrollHeight - 2;
                if ((dy < 0 && !atTop) || (dy > 0 && !atBot)) {
                  e.preventDefault();
                  innerScroll.scrollTop += dy;
                  return;
                }
              }
              if (canX && dx !== 0) {
                var atL = innerScroll.scrollLeft <= 1;
                var atR =
                  innerScroll.scrollLeft + innerScroll.clientWidth >=
                  innerScroll.scrollWidth - 2;
                if ((dx < 0 && !atL) || (dx > 0 && !atR)) {
                  e.preventDefault();
                  innerScroll.scrollLeft += dx;
                  return;
                }
              }
            }
          }
        }
        e.preventDefault();
        /* 滚轮与「拖画布」相反：双指/滚轮方向与系统滚动一致（delta 取负）；左键拖移仍用 + */
        canvasPanX -= e.deltaX;
        canvasPanY -= e.deltaY;
        applyStagesPanTransform();
      },
      { passive: false, capture: true }
    );
  }

  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", function () {
      if (!hasAnyImage() || !stageWrap) {
        return;
      }
      var oldZ = viewZoom;
      viewZoom = Math.min(VIEW_Z.max, viewZoom * 1.2);
      if (oldZ === viewZoom) {
        return;
      }
      var r = stageWrap.getBoundingClientRect();
      reflowAllSlabs();
      applyViewZoomPanAnchor(r.width / 2, r.height / 2, oldZ, viewZoom);
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", function () {
      if (!hasAnyImage() || !stageWrap) {
        return;
      }
      var oldZ = viewZoom;
      viewZoom = Math.max(VIEW_Z.min, viewZoom / 1.2);
      if (oldZ === viewZoom) {
        return;
      }
      var r = stageWrap.getBoundingClientRect();
      reflowAllSlabs();
      applyViewZoomPanAnchor(r.width / 2, r.height / 2, oldZ, viewZoom);
    });
  }
  if (btnZoomReset) {
    btnZoomReset.addEventListener("click", function () {
      if (!hasAnyImage() || !stageWrap) {
        return;
      }
      var oldZ = viewZoom;
      viewZoom = 1;
      if (oldZ === viewZoom) {
        return;
      }
      var r = stageWrap.getBoundingClientRect();
      reflowAllSlabs();
      applyViewZoomPanAnchor(r.width / 2, r.height / 2, oldZ, viewZoom);
    });
  }

  if (btnFilmstripToggle) {
    btnFilmstripToggle.addEventListener("click", function () {
      if (!pageSlabs.length) {
        return;
      }
      filmstripOpenWide = !filmstripOpenWide;
      applyFilmLayoutOnly();
    });
  }

  if (btnFilmstripAdd && filmstripFileAdd) {
    btnFilmstripAdd.addEventListener("click", function () {
      if (filmstripOcrBusy) {
        return;
      }
      filmstripFileAdd.click();
    });
    filmstripFileAdd.addEventListener("change", function () {
      var fs = filmstripFileAdd.files;
      if (!fs || !fs.length) {
        return;
      }
      filmstripAppendOcr(Array.prototype.slice.call(fs, 0));
    });
  }
  if (filmstripFooter) {
    filmstripFooter.addEventListener("dragover", function (e) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
      filmstripFooter.classList.add("is-dragover");
    });
    filmstripFooter.addEventListener("dragleave", function (e) {
      var t = e.relatedTarget;
      if (t && filmstripFooter.contains(t)) {
        return;
      }
      filmstripFooter.classList.remove("is-dragover");
    });
    filmstripFooter.addEventListener("drop", function (e) {
      e.preventDefault();
      filmstripFooter.classList.remove("is-dragover");
      if (filmstripOcrBusy) {
        return;
      }
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (!fs || !fs.length) {
        return;
      }
      filmstripAppendOcr(Array.prototype.slice.call(fs, 0));
    });
  }

  if (fileImageName && fileImage) {
    var fileEmpty = fileImageName.getAttribute("data-empty") || "未选择";
    var syncName = function () {
      if (!fileImage.files || !fileImage.files.length) {
        fileImageName.textContent = fileEmpty;
        fileImageName.title = "";
        return;
      }
      if (fileImage.files.length === 1) {
        var g = fileImage.files[0].name;
        fileImageName.textContent = g;
        fileImageName.title = g;
        return;
      }
      var t = "已选 " + fileImage.files.length + " 张";
      fileImageName.textContent = t;
      fileImageName.title = Array.prototype.map
        .call(fileImage.files, function (f) { return f.name; })
        .join("\n");
    };
    fileImage.addEventListener("change", syncName);
  }
  if (uploadOcr && fileImage) {
    uploadOcr.addEventListener("dragover", function (e) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
      uploadOcr.classList.add("is-dragover");
    });
    uploadOcr.addEventListener("dragleave", function (e) {
      var t = e.relatedTarget;
      if (t && uploadOcr.contains(t)) {
        return;
      }
      uploadOcr.classList.remove("is-dragover");
    });
    uploadOcr.addEventListener("drop", function (e) {
      e.preventDefault();
      uploadOcr.classList.remove("is-dragover");
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (!fs || !fs.length) {
        return;
      }
      var dt = new DataTransfer();
      for (var i = 0; i < fs.length; i++) {
        if (fs[i].type && fs[i].type.indexOf("image/") === 0) {
          dt.items.add(fs[i]);
        }
      }
      if (!dt.files.length) {
        return;
      }
      try {
        fileImage.files = dt.files;
      } catch (err) {
        return;
      }
      if (fileImageName) {
        var fn = function () {
          if (!fileImage.files.length) {
            return;
          }
          if (fileImage.files.length === 1) {
            fileImageName.textContent = fileImage.files[0].name;
            fileImageName.title = fileImage.files[0].name;
          } else {
            var n2 = "已选 " + fileImage.files.length + " 张";
            fileImageName.textContent = n2;
            fileImageName.title = Array.prototype.map
              .call(fileImage.files, function (f) { return f.name; })
              .join("\n");
          }
        };
        fn();
      }
    });
  }

  fillFontPresetSelect(fltFontPreset);
})();
