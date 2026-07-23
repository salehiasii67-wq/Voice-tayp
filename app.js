(function () {
  "use strict";

  /* =========================================================
     PUNCTUATION PARSER SERVICE
     ========================================================= */
  const PunctuationService = (function () {
    const commandMap = [
      { phrase: "علامت سوال", insert: "؟" },
      { phrase: "علامت تعجب", insert: "!" },
      { phrase: "دو نقطه", insert: ":" },
      { phrase: "خط تیره", insert: "-" },
      { phrase: "پرانتز باز", insert: "(" },
      { phrase: "پرانتز بسته", insert: ")" },
      { phrase: "پاراگراف جدید", insert: "\n\n" },
      { phrase: "خط جدید", insert: "\n" },
      { phrase: "اسلش", insert: "/" },
      { phrase: "ویرگول", insert: "،" },
      { phrase: "نقطه", insert: "." }
    ];
    commandMap.sort((a, b) => b.phrase.length - a.phrase.length);

    function apply(text) {
      let result = text;
      for (const cmd of commandMap) {
        const re = new RegExp("\\s*" + cmd.phrase + "\\s*", "g");
        const replacement = cmd.insert === "\n" || cmd.insert === "\n\n" ? cmd.insert : cmd.insert + " ";
        result = result.split(re).join(replacement);
      }
      result = result.replace(/[ \t]{2,}/g, " ");
      result = result.replace(/ +\n/g, "\n");
      return result;
    }
    return { apply };
  })();

  /* =========================================================
     SPEECH RECOGNITION SERVICE
     Prefers the native Capacitor plugin (@capacitor-community/speech-recognition)
     when running inside the compiled Android app. Falls back to the
     browser Web Speech API when running in a plain browser (dev/testing).
     The UI never touches either API directly — only this service.
     ========================================================= */
  const SpeechService = (function () {
    const NativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition) || null;
    const isNative = !!NativePlugin;

    const WebSR = window.SpeechRecognition || window.webkitSpeechRecognition;

    let userWantsListening = false;
    let isPausedByUser = false;
    let webRecognizer = null;
    let restartTimer = null;
    let nativeListenerHandles = [];

    const callbacks = {
      onInterim: () => {},
      onFinal: () => {},
      onStateChange: () => {},
      onError: () => {}
    };

    function isSupported() {
      return isNative || !!WebSR;
    }

    /* ---------- Native (Android) path ---------- */
    async function startNative() {
      try {
        const { available } = await NativePlugin.available();
        if (!available) {
          callbacks.onError("unsupported");
          return;
        }
        const perm = await NativePlugin.checkPermissions();
        if (perm.speechRecognition !== "granted") {
          const req = await NativePlugin.requestPermissions();
          if (req.speechRecognition !== "granted") {
            userWantsListening = false;
            callbacks.onError("permission-denied");
            callbacks.onStateChange("ERROR");
            return;
          }
        }

        nativeListenerHandles.push(
          await NativePlugin.addListener("partialResults", (data) => {
            const text = (data && data.matches && data.matches[0]) || "";
            callbacks.onInterim(text);
          })
        );
        nativeListenerHandles.push(
          await NativePlugin.addListener("listeningState", (data) => {
            if (data.status === "stopped") {
              if (userWantsListening && !isPausedByUser) {
                clearTimeout(restartTimer);
                restartTimer = setTimeout(() => {
                  if (userWantsListening && !isPausedByUser) startNative();
                }, 250);
              } else {
                callbacks.onStateChange(isPausedByUser ? "PAUSED" : "STOPPED");
              }
            }
          })
        );

        await NativePlugin.start({
          language: "fa-IR",
          partialResults: true,
          popup: false
        });
        callbacks.onStateChange("LISTENING");
      } catch (e) {
        callbacks.onError(e && e.message ? e.message : "native-error");
        // controlled restart on unexpected native failure, same pattern as browser path
        if (userWantsListening && !isPausedByUser) {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            if (userWantsListening && !isPausedByUser) startNative();
          }, 400);
        }
      }
    }

    // The community plugin reports only a running partial/final transcript rather
    // than incremental final chunks, so we treat each completed native "start"
    // session's last partial as final when the session ends normally (stop/pause),
    // and otherwise stream partials as interim only — this keeps the same
    // "interim never permanently appended" contract as the web path.
    let lastNativePartial = "";

    async function stopNativeSession(commitAsFinal) {
      clearTimeout(restartTimer);
      try {
        await NativePlugin.stop();
      } catch (e) {}
      for (const h of nativeListenerHandles) {
        try { h.remove(); } catch (e) {}
      }
      nativeListenerHandles = [];
      if (commitAsFinal && lastNativePartial.trim()) {
        callbacks.onFinal(lastNativePartial);
      }
      lastNativePartial = "";
    }

    /* ---------- Browser (Web Speech API) fallback path ---------- */
    function buildWebRecognizer() {
      const rec = new WebSR();
      rec.lang = "fa-IR";
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcript = res[0].transcript;
          if (res.isFinal) {
            callbacks.onFinal(transcript);
          } else {
            interim += transcript;
          }
        }
        callbacks.onInterim(interim);
      };

      rec.onerror = (event) => {
        if (event.error === "no-speech") return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          userWantsListening = false;
          callbacks.onError("permission-denied");
          callbacks.onStateChange("ERROR");
          return;
        }
        if (event.error === "network") {
          callbacks.onError("network");
          return;
        }
        callbacks.onError(event.error);
      };

      rec.onend = () => {
        if (userWantsListening && !isPausedByUser) {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            if (userWantsListening && !isPausedByUser) startWebInternal();
          }, 250);
        } else {
          callbacks.onStateChange(isPausedByUser ? "PAUSED" : "STOPPED");
        }
      };
      return rec;
    }

    function startWebInternal() {
      try {
        webRecognizer = buildWebRecognizer();
        webRecognizer.start();
        callbacks.onStateChange("LISTENING");
      } catch (e) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (userWantsListening && !isPausedByUser) startWebInternal();
        }, 300);
      }
    }

    /* ---------- Public API (routes to native or web) ---------- */
    function start() {
      if (!isSupported()) { callbacks.onError("unsupported"); return; }
      if (userWantsListening) return;
      userWantsListening = true;
      isPausedByUser = false;
      if (isNative) startNative();
      else startWebInternal();
    }

    function pause() {
      if (!userWantsListening) return;
      isPausedByUser = true;
      if (isNative) stopNativeSession(true);
      else if (webRecognizer) { try { webRecognizer.stop(); } catch (e) {} }
      callbacks.onStateChange("PAUSED");
    }

    function resume() {
      if (!userWantsListening) return;
      isPausedByUser = false;
      if (isNative) startNative();
      else startWebInternal();
    }

    function stop() {
      userWantsListening = false;
      isPausedByUser = false;
      if (isNative) stopNativeSession(true);
      else if (webRecognizer) { try { webRecognizer.stop(); } catch (e) {} }
      callbacks.onStateChange("STOPPED");
    }

    function on(event, fn) {
      if (callbacks.hasOwnProperty(event)) callbacks[event] = fn;
    }

    // native partials come through onInterim; track last one so pause/stop can commit it
    const originalOnInterimSetter = on;
    return {
      isSupported,
      start,
      pause,
      resume,
      stop,
      on: function (event, fn) {
        if (event === "onInterim" && isNative) {
          callbacks.onInterim = (text) => {
            lastNativePartial = text;
            fn(text);
          };
          return;
        }
        if (callbacks.hasOwnProperty(event)) callbacks[event] = fn;
      }
    };
  })();

  /* =========================================================
     TRANSLATION SERVICE
     ========================================================= */
  const TranslationService = (function () {
    async function translate(persianText) {
      if (!persianText || !persianText.trim()) return "";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: "Translate the following Persian text to natural, fluent English. Preserve paragraph breaks. Reply with ONLY the translation, no preamble, no notes:\n\n" + persianText
          }]
        })
      });
      if (!response.ok) throw new Error("translation-failed");
      const data = await response.json();
      const textBlock = data.content.find((b) => b.type === "text");
      return textBlock ? textBlock.text.trim() : "";
    }
    return { translate };
  })();

  /* =========================================================
     CLIPBOARD (native-aware)
     ========================================================= */
  async function copyToClipboard(text) {
    const NativeClipboard = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Clipboard;
    if (NativeClipboard) {
      await NativeClipboard.write({ string: text });
      return;
    }
    await navigator.clipboard.writeText(text);
  }

  /* =========================================================
     UI STATE + WIRING
     ========================================================= */
  const els = {
    transcript: document.getElementById("transcript"),
    emptyState: document.getElementById("emptyState"),
    transcriptScroll: document.getElementById("transcriptScroll"),
    baseline: document.getElementById("baseline"),
    statusChip: document.getElementById("statusChip"),
    statusText: document.getElementById("statusText"),
    micBtn: document.getElementById("micBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    stopBtn: document.getElementById("stopBtn"),
    clearBtn: document.getElementById("clearBtn"),
    copyBtn: document.getElementById("copyBtn"),
    translateBtn: document.getElementById("translateBtn"),
    translatePanel: document.getElementById("translatePanel"),
    translation: document.getElementById("translation"),
    copyTranslationBtn: document.getElementById("copyTranslationBtn"),
    wordCount: document.getElementById("wordCount"),
    charCount: document.getElementById("charCount"),
    durationLabel: document.getElementById("durationLabel"),
    punctToolbar: document.getElementById("punctToolbar"),
    toast: document.getElementById("toast")
  };

  let finalTranscript = "";
  let interimBuffer = "";
  let appState = "IDLE";
  let sessionSeconds = 0;
  let durationTimer = null;
  let baselineBars = [];
  let baselineInterval = null;

  (function initBaseline() {
    for (let i = 0; i < 36; i++) {
      const bar = document.createElement("span");
      els.baseline.appendChild(bar);
      baselineBars.push(bar);
    }
  })();

  function animateBaseline(active) {
    if (active) {
      els.baseline.classList.add("active");
      baselineBars.forEach((bar) => { bar.style.height = (4 + Math.random() * 24) + "px"; });
    } else {
      els.baseline.classList.remove("active");
      baselineBars.forEach((bar) => { bar.style.height = "4px"; });
    }
  }

  function toPersianDigits(n) {
    const map = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
    return String(n).replace(/\d/g, (d) => map[d]);
  }

  function formatDuration(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return toPersianDigits(String(m).padStart(2, "0")) + ":" + toPersianDigits(String(s).padStart(2, "0"));
  }

  function updateStats() {
    const words = finalTranscript.trim() ? finalTranscript.trim().split(/\s+/).length : 0;
    els.wordCount.textContent = toPersianDigits(words);
    els.charCount.textContent = toPersianDigits(finalTranscript.length);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function renderTranscript() {
    const hasContent = finalTranscript.length > 0 || interimBuffer.length > 0;
    els.emptyState.style.display = hasContent ? "none" : "flex";
    const finalPart = finalTranscript ? '<span class="final-seg">' + escapeHtml(finalTranscript) + "</span>" : "";
    const interimPart = interimBuffer ? '<span class="interim-seg">' + escapeHtml(interimBuffer) + "</span>" : "";
    els.transcript.innerHTML = finalPart + interimPart;
    els.transcriptScroll.scrollTop = els.transcriptScroll.scrollHeight;
    updateStats();
  }

  function setStatus(state) {
    appState = state;
    els.statusChip.className = "status-chip";
    switch (state) {
      case "LISTENING":
        els.statusChip.classList.add("listening");
        els.statusText.textContent = "در حال شنیدن";
        els.micBtn.classList.add("listening");
        els.pauseBtn.disabled = false;
        els.stopBtn.disabled = false;
        animateBaseline(true);
        if (!baselineInterval) baselineInterval = setInterval(() => animateBaseline(true), 140);
        startDurationTimer();
        break;
      case "PAUSED":
        els.statusChip.classList.add("paused");
        els.statusText.textContent = "مکث شده";
        els.micBtn.classList.remove("listening");
        els.pauseBtn.disabled = false;
        els.stopBtn.disabled = false;
        animateBaseline(false);
        clearInterval(baselineInterval); baselineInterval = null;
        stopDurationTimer();
        break;
      case "STOPPED":
      case "IDLE":
        els.statusText.textContent = "آماده";
        els.micBtn.classList.remove("listening");
        els.pauseBtn.disabled = true;
        els.stopBtn.disabled = true;
        animateBaseline(false);
        clearInterval(baselineInterval); baselineInterval = null;
        stopDurationTimer();
        break;
      case "ERROR":
        els.statusChip.classList.add("error");
        els.statusText.textContent = "خطا";
        els.micBtn.classList.remove("listening");
        animateBaseline(false);
        clearInterval(baselineInterval); baselineInterval = null;
        stopDurationTimer();
        break;
    }
  }

  function startDurationTimer() {
    if (durationTimer) return;
    durationTimer = setInterval(() => {
      sessionSeconds++;
      els.durationLabel.textContent = formatDuration(sessionSeconds);
    }, 1000);
  }
  function stopDurationTimer() { clearInterval(durationTimer); durationTimer = null; }

  function showToast(msg, isError) {
    els.toast.textContent = msg;
    els.toast.classList.toggle("error", !!isError);
    els.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  SpeechService.on("onInterim", (text) => { interimBuffer = text; renderTranscript(); });

  SpeechService.on("onFinal", (rawText) => {
    if (!rawText || !rawText.trim()) return;
    const punctuated = PunctuationService.apply(rawText);
    const needsSpace = finalTranscript && !finalTranscript.endsWith("\n") && !finalTranscript.endsWith(" ");
    finalTranscript += (needsSpace ? " " : "") + punctuated;
    interimBuffer = "";
    renderTranscript();
  });

  SpeechService.on("onStateChange", (state) => { setStatus(state); });

  SpeechService.on("onError", (errType) => {
    if (errType === "unsupported") {
      showToast("تشخیص گفتار روی این دستگاه در دسترس نیست.", true);
    } else if (errType === "permission-denied") {
      showToast("دسترسی میکروفون رد شد. در تنظیمات گوشی، مجوز میکروفون را برای اپ فعال کنید.", true);
    } else if (errType === "network") {
      showToast("مشکل در اتصال شبکه.", true);
    }
  });

  els.micBtn.addEventListener("click", () => {
    if (appState === "LISTENING") SpeechService.pause();
    else if (appState === "PAUSED") SpeechService.resume();
    else {
      if (!SpeechService.isSupported()) {
        showToast("تشخیص گفتار روی این دستگاه در دسترس نیست.", true);
        return;
      }
      SpeechService.start();
    }
  });

  els.pauseBtn.addEventListener("click", () => {
    if (appState === "LISTENING") SpeechService.pause();
    else if (appState === "PAUSED") SpeechService.resume();
  });

  els.stopBtn.addEventListener("click", () => {
    SpeechService.stop();
    interimBuffer = "";
    renderTranscript();
  });

  els.clearBtn.addEventListener("click", () => {
    finalTranscript = "";
    interimBuffer = "";
    sessionSeconds = 0;
    els.durationLabel.textContent = formatDuration(0);
    els.translation.textContent = "";
    els.translatePanel.classList.remove("open");
    renderTranscript();
    showToast("متن پاک شد");
  });

  els.copyBtn.addEventListener("click", async () => {
    const text = finalTranscript.trim();
    if (!text) { showToast("متنی برای کپی وجود ندارد", true); return; }
    try { await copyToClipboard(text); showToast("متن کپی شد"); }
    catch (e) { showToast("کپی ناموفق بود", true); }
  });

  els.copyTranslationBtn.addEventListener("click", async () => {
    const text = els.translation.textContent.trim();
    if (!text) return;
    try { await copyToClipboard(text); showToast("ترجمه کپی شد"); }
    catch (e) { showToast("کپی ناموفق بود", true); }
  });

  els.translateBtn.addEventListener("click", async () => {
    const text = finalTranscript.trim();
    if (!text) { showToast("ابتدا متنی تایپ کنید", true); return; }
    els.translatePanel.classList.add("open");
    els.translation.textContent = "در حال ترجمه...";
    els.translation.classList.add("loading");
    els.translateBtn.disabled = true;
    try {
      const result = await TranslationService.translate(text);
      els.translation.classList.remove("loading");
      els.translation.textContent = result;
    } catch (e) {
      els.translation.classList.remove("loading");
      els.translation.textContent = "";
      showToast("ترجمه ناموفق بود. دوباره تلاش کنید.", true);
      els.translatePanel.classList.remove("open");
    } finally {
      els.translateBtn.disabled = false;
    }
  });

  els.punctToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".punct-btn");
    if (!btn) return;
    const insert = btn.dataset.insert === "\\n" ? "\n" : btn.dataset.insert;
    finalTranscript += insert + (insert === "\n" ? "" : " ");
    renderTranscript();
  });

  setStatus("IDLE");
  renderTranscript();

  if (!SpeechService.isSupported()) {
    setStatus("ERROR");
    els.statusText.textContent = "پشتیبانی نشده";
  }
})();
