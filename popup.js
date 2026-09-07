(() => {
  "use strict";

  const button = document.querySelector("#export-button");
  const status = document.querySelector("#status");
  const label = button.querySelector(".button-label");
  const platformLabel = document.querySelector("#platform-label");

  function setBusy(isBusy) {
    button.disabled = isBusy;
    button.classList.toggle("busy", isBusy);
    label.textContent = isBusy ? "Идёт сбор…" : "Скачать отчёт";
  }

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.className = `status ${kind}`.trim();
  }

  function platformFromUrl(url) {
    if (/^https:\/\/(?:www\.)?instagram\.com\//i.test(url || "")) return "Instagram";
    if (/^https:\/\/(?:www\.|m\.)?tiktok\.com\//i.test(url || "")) return "TikTok";
    return "";
  }

  async function getActiveSupportedTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const platform = platformFromUrl(tab?.url);
    if (!tab?.id || !platform) {
      throw new Error("Откройте вкладку Instagram Reel или TikTok с нужным видео.");
    }
    return { ...tab, platform };
  }

  async function sendToTab(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      throw new Error(
        "Не удалось подключиться к странице. Обновите вкладку после установки расширения."
      );
    }
  }

  button.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Ищу текущее видео…");

    try {
      const tab = await getActiveSupportedTab();
      platformLabel.textContent = tab.platform.toUpperCase();
      const response = await sendToTab(tab.id, { type: "COMMENTS_EXPORT_START" });

      if (!response?.ok) {
        throw new Error(response?.error || "Не удалось сформировать отчёт.");
      }

      setStatus(
        `Готово: ${response.commentCount} комментариев. Файл ${response.fileName} скачан.`,
        "success"
      );
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "COMMENTS_EXPORT_PROGRESS") return;
    setBusy(true);
    setStatus(message.message || "Идёт сбор комментариев…");
  });

  (async () => {
    try {
      const tab = await getActiveSupportedTab();
      platformLabel.textContent = tab.platform.toUpperCase();
      const response = await sendToTab(tab.id, { type: "COMMENTS_EXPORT_STATUS" });
      if (response?.running) {
        setBusy(true);
        setStatus(response.message || "Идёт сбор комментариев…");
      }
    } catch {
      // The click handler will show a concrete error if the user tries to export.
    }
  })();
})();
