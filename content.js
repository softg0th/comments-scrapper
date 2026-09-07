(() => {
  "use strict";

  const REPORT = globalThis.CommentsReport;
  const USERNAME_PATH = /^\/([a-zA-Z0-9._]+)\/?$/;
  const RESERVED_PATHS = new Set([
    "about", "accounts", "api", "challenge", "developer", "direct", "directory",
    "emails", "explore", "legal", "p", "privacy", "reel", "reels", "stories",
    "terms", "web"
  ]);
  const CONTROL_TEXT = {
    replies: [
      /view (?:all )?(?:\d+\s+)?(?:more )?repl/i,
      /view replies/i,
      /more repl/i,
      /показать (?:все )?ответ/i,
      /посмотреть (?:все )?ответ/i,
      /ещ[её].*ответ/i
    ],
    comments: [
      /load more comments/i,
      /view (?:all|more|previous) comments/i,
      /more comments/i,
      /показать (?:все|ещ[её]|предыдущие) комментар/i,
      /загрузить ещё комментар/i,
      /посмотреть .*комментар/i
    ]
  };
  const META_TEXT = /^(reply|ответить|like|likes|нравится|отметк[аи] «нравится»|see translation|показать перевод|edited|изменено)$/i;
  const RATE_LIMIT_TEXT = /try again later|please wait a few minutes|повторите попытку позже|подождите несколько минут/i;

  const state = {
    running: false,
    cancelled: false,
    message: "",
    overlay: null
  };

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function normalizedText(element) {
    return REPORT.normalizeWhitespace(element?.innerText || element?.textContent || "");
  }

  function usernameFromAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return "";
    let pathname;
    try {
      pathname = new URL(anchor.href, location.href).pathname;
    } catch {
      return "";
    }
    const match = pathname.match(USERNAME_PATH);
    if (!match || RESERVED_PATHS.has(match[1].toLowerCase())) return "";
    return match[1];
  }

  function profileFromAnchor(anchor) {
    const username = usernameFromAnchor(anchor);
    if (!username) return null;
    return {
      username,
      profileUrl: `https://www.instagram.com/${encodeURIComponent(username)}/`
    };
  }

  function visibleVideos() {
    return [...document.querySelectorAll("video")]
      .filter(isVisible)
      .map((video) => {
        const rect = video.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
        return { video, score: visibleWidth * visibleHeight };
      })
      .sort((a, b) => b.score - a.score);
  }

  function currentReelRoot() {
    const primaryVideo = visibleVideos()[0]?.video;
    if (!primaryVideo) {
      const article = [...document.querySelectorAll("article")].find(isVisible);
      return article || document.querySelector("main") || document.body;
    }

    const article = primaryVideo.closest("article");
    if (article) return article;

    let node = primaryVideo.parentElement;
    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const hasProfile = [...node.querySelectorAll('a[href]')].some((anchor) => usernameFromAnchor(anchor));
      const hasControls = node.querySelector('svg[aria-label], [role="button"]');
      if (hasProfile && hasControls && rect.height >= primaryVideo.getBoundingClientRect().height * 0.7) {
        return node;
      }
    }
    return primaryVideo.closest("main") || document.body;
  }

  function reelPermalink(root) {
    const currentUrl = location.href.split(/[?#]/)[0];
    if (REPORT.reelShortcodeFromUrl(currentUrl)) return currentUrl;

    const candidates = [
      ...root.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]'),
      ...document.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]')
    ].filter((anchor, index, list) => {
      return list.indexOf(anchor) === index && REPORT.reelShortcodeFromUrl(anchor.href);
    });
    const centerY = innerHeight / 2;
    candidates.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const aDistance = Math.abs(aRect.top + aRect.height / 2 - centerY) + (isVisible(a) ? 0 : innerHeight * 2);
      const bDistance = Math.abs(bRect.top + bRect.height / 2 - centerY) + (isVisible(b) ? 0 : innerHeight * 2);
      return aDistance - bDistance;
    });
    if (candidates[0]) {
      return new URL(candidates[0].href, location.href).href.split(/[?#]/)[0];
    }

    const metadataUrls = [
      document.querySelector('link[rel="canonical"]')?.href,
      document.querySelector('meta[property="og:url"]')?.content
    ].filter(Boolean);
    const metadataUrl = metadataUrls.find((url) => REPORT.reelShortcodeFromUrl(url));
    return metadataUrl ? new URL(metadataUrl, location.href).href.split(/[?#]/)[0] : currentUrl;
  }

  function reelShortcode(url) {
    return REPORT.reelShortcodeFromUrl(url) || "current-reel";
  }

  function extractAuthor(root) {
    const anchors = [...root.querySelectorAll("a[href]")].filter(isVisible);
    const scored = anchors
      .map((anchor, index) => {
        const username = usernameFromAnchor(anchor);
        if (!username) return null;
        const text = REPORT.normalizeWhitespace(anchor.textContent).replace(/^@/, "");
        let score = text.toLowerCase() === username.toLowerCase() ? 6 : 1;
        if (anchor.querySelector("img")) score += 2;
        if (anchor.closest("header")) score += 3;
        score -= index / 1000;
        return { username, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.username || "unknown";
  }

  function descriptionFromMeta(author) {
    if (!REPORT.reelShortcodeFromUrl(location.href)) return "";
    const content = document.querySelector('meta[property="og:description"]')?.content || "";
    if (!content) return "";

    const quoted = content.match(/[“\"]([\s\S]+)[”\"]\s*$/)?.[1];
    if (quoted) return REPORT.normalizeWhitespace(quoted);

    const authorMarker = new RegExp(`(?:@?${author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})[^:]*:\\s*`, "i");
    const split = content.split(authorMarker);
    return split.length > 1 ? REPORT.normalizeWhitespace(split.at(-1)) : "";
  }

  function candidateTextNodes(scope) {
    return [...scope.querySelectorAll('h1, span[dir="auto"], div[dir="auto"]')]
      .filter(isVisible)
      .map((element) => REPORT.normalizeWhitespace(element.innerText || element.textContent))
      .filter((text) => text.length > 1 && text.length <= 2500 && !META_TEXT.test(text));
  }

  function extractDescription(root, author) {
    const metaDescription = descriptionFromMeta(author);
    if (metaDescription) return metaDescription;

    const candidates = candidateTextNodes(root).filter((text) => {
      const plain = text.replace(/^@/, "");
      return plain.toLowerCase() !== author.toLowerCase() &&
        !/^(follow|подписаться|original audio|оригинальная аудиодорожка)$/i.test(text);
    });

    const hashtagCandidate = candidates.find((text) => text.includes("#") && text.length > 5);
    return hashtagCandidate || candidates.sort((a, b) => b.length - a.length)[0] || "";
  }

  function allClickableElements(scope = document) {
    return [...scope.querySelectorAll('button, [role="button"], a[role="button"]')]
      .filter(isVisible)
      .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true");
  }

  function accessibleControlText(element) {
    const descendantLabels = [...element.querySelectorAll("[aria-label]")]
      .map((child) => child.getAttribute("aria-label"))
      .filter(Boolean);
    return [
      normalizedText(element),
      element.getAttribute("aria-label") || "",
      ...descendantLabels
    ].join(" ");
  }

  function matchesAny(value, patterns) {
    return patterns.some((pattern) => pattern.test(value));
  }

  async function openCommentsIfNeeded(root) {
    const existingTimes = root.querySelectorAll("time").length;
    const existingReplyControl = allClickableElements(root).some((element) =>
      matchesAny(normalizedText(element), CONTROL_TEXT.replies)
    );
    if (existingTimes > 1 || existingReplyControl) return;

    const ariaPattern = /comment|комментар/i;
    const labelled = [...root.querySelectorAll('[aria-label]')]
      .filter(isVisible)
      .find((element) => ariaPattern.test(element.getAttribute("aria-label") || ""));
    const control = labelled?.closest('button, [role="button"]') || labelled;
    if (control) {
      control.click();
      await sleep(1200);
    }
  }

  function findCommentsSurface(root) {
    const candidates = [
      ...document.querySelectorAll('[role="dialog"]'),
      root,
      ...document.querySelectorAll("article")
    ].filter((element, index, list) => element && isVisible(element) && list.indexOf(element) === index);

    candidates.sort((a, b) => {
      const score = (element) => {
        const times = element.querySelectorAll("time").length;
        const controls = allClickableElements(element).filter((control) => {
          const text = accessibleControlText(control);
          return matchesAny(text, [...CONTROL_TEXT.replies, ...CONTROL_TEXT.comments]);
        }).length;
        return times * 2 + controls * 5;
      };
      return score(b) - score(a);
    });
    return candidates[0] || root;
  }

  function countLoadedCommentMarkers(surface) {
    const fingerprints = new Set();
    for (const time of surface.querySelectorAll("time")) {
      const link = time.closest("a")?.href || "";
      const parentText = REPORT.normalizeWhitespace(time.parentElement?.parentElement?.textContent || "");
      fingerprints.add(`${link}|${time.dateTime || time.textContent}|${parentText.slice(0, 120)}`);
    }
    return fingerprints.size;
  }

  function clickExpandableControls(surface) {
    const controls = allClickableElements(surface).filter((element) => {
      const value = accessibleControlText(element);
      return matchesAny(value, [...CONTROL_TEXT.replies, ...CONTROL_TEXT.comments]);
    });

    let clicked = 0;
    for (const control of controls.slice(0, 12)) {
      if (state.cancelled) break;
      control.click();
      clicked += 1;
    }
    return clicked;
  }

  function scrollCommentSurfaces(surface) {
    const scrollables = [surface, ...surface.querySelectorAll("div, ul")]
      .filter((element) => {
        if (!isVisible(element)) return false;
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 100;
      })
      .sort((a, b) => {
        const aScore = a.querySelectorAll("time").length * 100 + a.clientHeight;
        const bScore = b.querySelectorAll("time").length * 100 + b.clientHeight;
        return bScore - aScore;
      });

    for (const element of scrollables.slice(0, 3)) {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  function assertNotRateLimited(surface) {
    const text = REPORT.normalizeWhitespace(surface.innerText).slice(-4000);
    if (RATE_LIMIT_TEXT.test(text)) {
      throw new Error("Instagram временно ограничил загрузку комментариев. Попробуйте позже.");
    }
  }

  async function expandAllComments(surface) {
    let stableCycles = 0;
    let previousCount = -1;
    const maxCycles = 240;

    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      if (state.cancelled) throw new Error("Сбор отменён пользователем.");
      assertNotRateLimited(surface);

      const clicked = clickExpandableControls(surface);
      scrollCommentSurfaces(surface);
      await sleep(clicked ? 950 : 700);

      const count = countLoadedCommentMarkers(surface);
      updateProgress(`Загружено элементов: ${count}. Раскрываю комментарии и ответы…`);

      if (count === previousCount) {
        stableCycles += 1;
      } else {
        stableCycles = 0;
      }
      previousCount = count;

      if ((clicked === 0 && stableCycles >= 4) || stableCycles >= 8) return;
    }

    throw new Error("Достигнут безопасный лимит загрузки. Часть комментариев могла не успеть загрузиться.");
  }

  function findMessageText(row, username) {
    const candidates = [...row.querySelectorAll('span[dir="auto"], div[dir="auto"]')]
      .filter(isVisible)
      .filter((element) => !element.querySelector('span[dir="auto"], div[dir="auto"]'))
      .map((element) => REPORT.normalizeWhitespace(element.textContent))
      .filter((text) => {
        if (!text || META_TEXT.test(text)) return false;
        if (text.replace(/^@/, "").toLowerCase() === username.toLowerCase()) return false;
        return !/^\d+[smhdw]|^\d+\s*(сек|мин|ч|дн|нед)/i.test(text);
      });

    return candidates.sort((a, b) => b.length - a.length)[0] || "";
  }

  function findCommentRow(time, surface) {
    let node = time.parentElement;
    let fallback = null;

    while (node && node !== surface && surface.contains(node)) {
      const ownTimes = node.querySelectorAll("time").length;
      const username = [...node.querySelectorAll("a[href]")]
        .map(usernameFromAnchor)
        .find(Boolean);

      if (ownTimes === 1 && username) {
        fallback = node;
        if (findMessageText(node, username)) return node;
      }
      if (ownTimes > 1) break;
      node = node.parentElement;
    }
    return fallback;
  }

  function extractLikes(row) {
    const textParts = [...row.querySelectorAll('button, [role="button"]')]
      .map(normalizedText)
      .filter(Boolean);
    return textParts.find((text) => /(?:\d[\d,.\s]*)?\s*(likes?|отмет)/i.test(text)) || "";
  }

  function extractFlatComments(surface, description, author) {
    const seenRows = new Set();
    const comments = [];

    for (const time of surface.querySelectorAll("time")) {
      const row = findCommentRow(time, surface);
      if (!row || seenRows.has(row)) continue;
      seenRows.add(row);

      const profile = [...row.querySelectorAll("a[href]")]
        .map(profileFromAnchor)
        .find(Boolean);
      if (!profile) continue;
      const { username, profileUrl } = profile;

      const text = findMessageText(row, username);
      if (!text) continue;
      if (
        comments.length === 0 &&
        username.toLowerCase() === author.toLowerCase() &&
        REPORT.normalizeWhitespace(text) === REPORT.normalizeWhitespace(description)
      ) {
        continue;
      }

      const rect = row.getBoundingClientRect();
      comments.push({
        username,
        profileUrl,
        text,
        timestamp: time.dateTime || time.getAttribute("datetime") || time.textContent || "",
        likes: extractLikes(row),
        replies: [],
        _x: Math.round(rect.left)
      });
    }
    return comments;
  }

  function createOverlay() {
    state.overlay?.remove();
    const host = document.createElement("div");
    host.id = "reel-comments-exporter-status";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          width: 320px; padding: 16px; border: 1px solid rgba(255,255,255,.14);
          border-radius: 14px; background: rgba(18,18,22,.96); color: #f7f7f8;
          box-shadow: 0 16px 50px rgba(0,0,0,.35); font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          backdrop-filter: blur(18px);
        }
        .top { display:flex; align-items:center; gap:10px; margin-bottom:8px; font-weight:750; }
        .dot { width:9px; height:9px; flex:none; border-radius:50%; background:#d62976; box-shadow:0 0 0 5px rgba(214,41,118,.13); }
        p { margin:0; color:#c5c5cd; }
        button { margin-top:12px; padding:7px 11px; border:1px solid rgba(255,255,255,.14); border-radius:8px; background:#29292f; color:white; cursor:pointer; }
        button:hover { background:#34343c; }
      </style>
      <div class="card">
        <div class="top"><span class="dot"></span><span>Экспорт комментариев Reel</span></div>
        <p>Подготовка…</p>
        <button type="button">Отменить</button>
      </div>
    `;
    shadow.querySelector("button").addEventListener("click", () => {
      state.cancelled = true;
      shadow.querySelector("p").textContent = "Останавливаю сбор…";
    });
    document.documentElement.append(host);
    state.overlay = host;
  }

  function updateProgress(message) {
    state.message = message;
    const paragraph = state.overlay?.shadowRoot?.querySelector("p");
    if (paragraph) paragraph.textContent = message;
    chrome.runtime.sendMessage({ type: "COMMENTS_EXPORT_PROGRESS", message }, () => {
      void chrome.runtime.lastError;
    });
  }

  function finishOverlay(message, isError = false) {
    const shadow = state.overlay?.shadowRoot;
    if (!shadow) return;
    const paragraph = shadow.querySelector("p");
    const dot = shadow.querySelector(".dot");
    const button = shadow.querySelector("button");
    paragraph.textContent = message;
    dot.style.background = isError ? "#ff667d" : "#55ca7a";
    dot.style.boxShadow = `0 0 0 5px ${isError ? "rgba(255,102,125,.13)" : "rgba(85,202,122,.13)"}`;
    button.textContent = "Закрыть";
    button.onclick = () => state.overlay?.remove();
    if (!isError) window.setTimeout(() => state.overlay?.remove(), 8000);
  }

  function downloadMarkdown(markdown, fileName) {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.documentElement.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function exportCurrentReel() {
    state.running = true;
    state.cancelled = false;
    createOverlay();

    try {
      updateProgress("Определяю текущий Reel…");
      const root = currentReelRoot();
      const url = reelPermalink(root);
      const isReelsFeed = /^\/reels?\/?$/i.test(location.pathname);
      if (!REPORT.reelShortcodeFromUrl(url) && !isReelsFeed) {
        throw new Error("Не удалось определить Reel. Откройте нужный ролик или его отдельную страницу.");
      }
      const author = extractAuthor(root);
      const description = extractDescription(root, author);

      await openCommentsIfNeeded(root);
      const surface = findCommentsSurface(root);
      updateProgress("Загружаю комментарии. Это может занять несколько минут…");
      await expandAllComments(surface);

      updateProgress("Строю иерархию комментариев…");
      const flatComments = extractFlatComments(surface, description, author);
      const comments = REPORT.buildCommentHierarchy(flatComments);
      const reel = {
        url,
        author,
        description,
        comments,
        exportedAt: new Date().toISOString()
      };
      const markdown = REPORT.buildMarkdown(reel);
      const fileName = REPORT.makeFileName(author, reelShortcode(url));
      const commentCount = REPORT.countComments(comments);

      downloadMarkdown(markdown, fileName);
      finishOverlay(`Готово: скачан отчёт с ${commentCount} комментариями.`);
      return { ok: true, commentCount, fileName };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка экспорта.";
      finishOverlay(message, true);
      return { ok: false, error: message };
    } finally {
      state.running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "COMMENTS_EXPORT_STATUS") {
      sendResponse({ running: state.running, message: state.message });
      return false;
    }

    if (message?.type !== "COMMENTS_EXPORT_START") return false;
    if (state.running) {
      sendResponse({ ok: false, error: "Экспорт уже выполняется на этой вкладке." });
      return false;
    }

    exportCurrentReel().then(sendResponse);
    return true;
  });
})();
