(() => {
  "use strict";

  const REPORT = globalThis.CommentsReport;
  const COMMENT_MARKER_SELECTOR =
    '[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]';
  const COMMENT_CONTROL_PATTERN =
    /view (?:more|all|\d+)?\s*repl|show (?:more|all|\d+)?\s*repl|more comments|view more|посмотреть.*ответ|показать.*ответ|ещ[её].*ответ|ещ[её].*комментар/i;
  const META_TEXT_PATTERN =
    /^(reply|ответить|like|likes?|нравится|report|пожаловаться|view more|show more|see translation|показать перевод)$/i;
  const RATE_LIMIT_PATTERN =
    /too many attempts|try again later|something went wrong|слишком много попыток|повторите попытку позже/i;

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

  function parseVideoUrl(value) {
    try {
      const url = new URL(value, location.href);
      const match = url.pathname.match(/^\/@([^/]+)\/video\/(\d+)(?:\/|$)/i);
      if (!match) return null;
      return {
        author: decodeURIComponent(match[1]),
        id: match[2],
        url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`
      };
    } catch {
      return null;
    }
  }

  function profileFromAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    try {
      const url = new URL(anchor.href, location.href);
      const match = url.pathname.match(/^\/@([^/]+)(?:\/|$)/);
      if (!match) return null;
      const username = decodeURIComponent(match[1]);
      return {
        username,
        profileUrl: `https://www.tiktok.com/@${encodeURIComponent(username)}`
      };
    } catch {
      return null;
    }
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

  function currentVideoRoot() {
    const video = visibleVideos()[0]?.video;
    if (!video) return document.querySelector("main") || document.body;

    const knownRoot = video.closest(
      '[data-e2e="browse-video"], [data-e2e="feed-video"], ' +
      '[data-e2e="recommend-list-item-container"], article'
    );
    if (knownRoot) return knownRoot;

    let node = video.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const hasProfile = [...node.querySelectorAll('a[href*="/@"]')]
        .some((anchor) => profileFromAnchor(anchor));
      const hasActions = node.querySelector(
        '[data-e2e="comment-icon"], [data-e2e="like-icon"], button, [role="button"]'
      );
      if (hasProfile && hasActions) return node;
    }
    return video.closest("main") || document.body;
  }

  function videoPermalink(root) {
    const current = parseVideoUrl(location.href);
    if (current) return current;

    const candidates = [
      ...root.querySelectorAll('a[href*="/video/"]'),
      ...document.querySelectorAll('a[href*="/video/"]')
    ]
      .map((anchor) => ({ anchor, video: parseVideoUrl(anchor.href) }))
      .filter(({ video }, index, list) => {
        return video && list.findIndex((item) => item.video?.url === video.url) === index;
      });

    const centerY = innerHeight / 2;
    candidates.sort((a, b) => {
      const aRect = a.anchor.getBoundingClientRect();
      const bRect = b.anchor.getBoundingClientRect();
      const aDistance = Math.abs(aRect.top + aRect.height / 2 - centerY) +
        (isVisible(a.anchor) ? 0 : innerHeight * 2);
      const bDistance = Math.abs(bRect.top + bRect.height / 2 - centerY) +
        (isVisible(b.anchor) ? 0 : innerHeight * 2);
      return aDistance - bDistance;
    });
    if (candidates[0]) return candidates[0].video;

    const metadataUrls = [
      document.querySelector('link[rel="canonical"]')?.href,
      document.querySelector('meta[property="og:url"]')?.content
    ].filter(Boolean);
    return metadataUrls.map(parseVideoUrl).find(Boolean) || null;
  }

  function extractAuthor(root, video) {
    if (video?.author) return video.author;
    const profile = [...root.querySelectorAll('a[href*="/@"]')]
      .map(profileFromAnchor)
      .find(Boolean);
    return profile?.username || "unknown";
  }

  function extractDescription(root) {
    const selectors = [
      '[data-e2e="browse-video-desc"]',
      '[data-e2e="video-desc"]',
      '[data-e2e="video-title"]',
      'h1[data-e2e]'
    ];
    for (const selector of selectors) {
      const text = normalizedText(root.querySelector(selector));
      if (text) return text;
    }

    const meta = document.querySelector('meta[property="og:description"]')?.content || "";
    return REPORT.normalizeWhitespace(meta);
  }

  function commentMarkers(surface) {
    return [...surface.querySelectorAll(COMMENT_MARKER_SELECTOR)];
  }

  function findCommentsSurface(root) {
    const selectors = [
      '[data-e2e="comment-list"]',
      '[data-e2e="comment-list-container"]',
      '[data-e2e="comments-list"]',
      'div[class*="DivCommentListContainer"]',
      '[role="dialog"]'
    ];
    const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    candidates.push(root);

    const unique = candidates.filter((element, index, list) => {
      return element && isVisible(element) && list.indexOf(element) === index;
    });
    unique.sort((a, b) => scoreCommentsSurface(b) - scoreCommentsSurface(a));
    return unique[0] || root;
  }

  function scoreCommentsSurface(element) {
    const markers = commentMarkers(element).length;
    const profiles = [...element.querySelectorAll('a[href*="/@"]')]
      .filter((anchor) => profileFromAnchor(anchor)).length;
    return markers * 20 + profiles * 2;
  }

  async function openCommentsIfNeeded(root) {
    if (commentMarkers(findCommentsSurface(root)).length) return;

    const directControl = root.querySelector(
      '[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"], ' +
      '[data-e2e="comment-button"]'
    );
    const labelledControl = [...root.querySelectorAll('button, [role="button"], [aria-label]')]
      .filter(isVisible)
      .find((element) => {
        const label = `${element.getAttribute("aria-label") || ""} ${normalizedText(element)}`;
        return /comments?|комментар/i.test(label);
      });
    const control = directControl?.closest('button, [role="button"]') || directControl || labelledControl;
    if (control && isVisible(control)) {
      control.click();
      await sleep(1400);
    }
  }

  function expandableControls(surface) {
    const direct = [...surface.querySelectorAll(
      '[data-e2e^="view-more-"], [data-e2e*="view-repl"], [data-e2e*="more-comment"]'
    )];
    const textual = [...surface.querySelectorAll('button, [role="button"], p, span')]
      .filter((element) => COMMENT_CONTROL_PATTERN.test(normalizedText(element)));
    return [...new Set([...direct, ...textual])]
      .filter(isVisible)
      .filter((element) => element.getAttribute("aria-disabled") !== "true");
  }

  function clickExpandableControls(surface) {
    let clicked = 0;
    for (const element of expandableControls(surface).slice(0, 20)) {
      if (state.cancelled) break;
      const control = element.closest('button, [role="button"]') || element;
      control.click();
      clicked += 1;
    }
    return clicked;
  }

  function scrollComments(surface) {
    const scrollables = [surface, ...surface.querySelectorAll("div, ul")]
      .filter((element) => {
        if (!isVisible(element)) return false;
        const style = getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 100;
      })
      .sort((a, b) => {
        const aScore = scoreCommentsSurface(a) * 100 + a.clientHeight;
        const bScore = scoreCommentsSurface(b) * 100 + b.clientHeight;
        return bScore - aScore;
      });

    for (const element of scrollables.slice(0, 2)) {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  function loadedCommentCount(surface) {
    const markers = commentMarkers(surface);
    if (markers.length) return markers.length;
    return [...surface.querySelectorAll('a[href*="/@"]')]
      .filter((anchor) => profileFromAnchor(anchor)).length;
  }

  async function expandAllComments(surface) {
    let previousCount = -1;
    let stableCycles = 0;

    for (let cycle = 0; cycle < 240; cycle += 1) {
      if (state.cancelled) throw new Error("Сбор отменён пользователем.");
      const tail = normalizedText(surface).slice(-4000);
      if (RATE_LIMIT_PATTERN.test(tail)) {
        throw new Error("TikTok временно ограничил загрузку комментариев. Попробуйте позже.");
      }

      const clicked = clickExpandableControls(surface);
      scrollComments(surface);
      await sleep(clicked ? 900 : 700);

      const count = loadedCommentCount(surface);
      updateProgress(`Загружено элементов: ${count}. Раскрываю комментарии и ответы…`);
      stableCycles = count === previousCount ? stableCycles + 1 : 0;
      previousCount = count;

      if ((clicked === 0 && stableCycles >= 4) || stableCycles >= 8) return;
    }

    throw new Error("Достигнут безопасный лимит загрузки. Часть комментариев могла не загрузиться.");
  }

  function findMarkerRow(marker, surface) {
    let node = marker;
    while (node && node !== surface) {
      const profiles = [...node.querySelectorAll('a[href*="/@"]')]
        .filter((anchor) => profileFromAnchor(anchor));
      if (profiles.length) return node;
      node = node.parentElement;
    }
    return marker;
  }

  function belongsToMarker(element, marker) {
    const owner = element.closest(COMMENT_MARKER_SELECTOR);
    return !owner || owner === marker;
  }

  function looksLikeMetadata(text, username) {
    if (!text || META_TEXT_PATTERN.test(text)) return true;
    if (text.replace(/^@/, "").toLowerCase() === username.toLowerCase()) return true;
    if (/^(?:\d+[smhdw]|\d+\s*(?:сек|мин|ч|дн|нед)|\d{1,2}[-/.]\d{1,2})$/i.test(text)) return true;
    if (/^\d[\d,.\s]*\s*(?:likes?|лайк|отмет)/i.test(text)) return true;
    return false;
  }

  function extractCommentText(row, marker, username) {
    const profileLabels = [...row.querySelectorAll('a[href*="/@"]')]
      .map((anchor) => normalizedText(anchor).toLowerCase())
      .filter(Boolean);
    const candidates = [
      ...row.querySelectorAll('[data-e2e="comment-text"], p, span[dir="auto"]')
    ]
      .filter((element) => belongsToMarker(element, marker))
      .filter((element) => !element.closest('a[href*="/@"], button, [role="button"]'))
      .filter((element) => !/username|comment-time|like-count/i.test(element.getAttribute("data-e2e") || ""))
      .filter((element) => !element.querySelector("p, span[dir=\"auto\"]"))
      .map((element) => normalizedText(element))
      .filter((text) => !profileLabels.includes(text.toLowerCase()))
      .filter((text) => !looksLikeMetadata(text, username));

    const ownText = normalizedText(marker);
    const isStandaloneTextMarker = /^(P|SPAN)$/.test(marker.tagName) &&
      !marker.querySelector('a[href*="/@"]') &&
      !marker.querySelector(COMMENT_MARKER_SELECTOR);
    if (isStandaloneTextMarker && !looksLikeMetadata(ownText, username)) {
      candidates.push(ownText);
    }
    return [...new Set(candidates)].sort((a, b) => b.length - a.length)[0] || "";
  }

  function extractCommentTime(row, marker) {
    const element = [...row.querySelectorAll('[data-e2e^="comment-time"], time')]
      .find((candidate) => belongsToMarker(candidate, marker));
    return element?.dateTime || element?.getAttribute("datetime") || normalizedText(element);
  }

  function extractCommentLikes(row, marker) {
    const element = [...row.querySelectorAll(
      '[data-e2e="comment-like-count"], [data-e2e*="like-count"]'
    )].find((candidate) => belongsToMarker(candidate, marker));
    return normalizedText(element);
  }

  function extractFromMarkers(surface) {
    const comments = [];
    const seenRows = new Set();

    for (const marker of commentMarkers(surface)) {
      const row = findMarkerRow(marker, surface);
      if (seenRows.has(row)) continue;
      seenRows.add(row);

      const profile = [...row.querySelectorAll('a[href*="/@"]')]
        .map(profileFromAnchor)
        .find(Boolean);
      if (!profile) continue;

      const text = extractCommentText(row, marker, profile.username);
      if (!text) continue;
      const level = marker.getAttribute("data-e2e")?.endsWith("-2") ? 2 : 1;
      comments.push({
        ...profile,
        text,
        timestamp: extractCommentTime(row, marker),
        likes: extractCommentLikes(row, marker),
        replies: [],
        _level: level
      });
    }
    return comments;
  }

  function extractFallbackComments(surface) {
    const comments = [];
    const seenRows = new Set();

    for (const anchor of surface.querySelectorAll('a[href*="/@"]')) {
      const profile = profileFromAnchor(anchor);
      if (!profile) continue;

      let row = anchor.parentElement;
      while (row && row !== surface) {
        const paragraphs = row.querySelectorAll("p");
        const profiles = row.querySelectorAll('a[href*="/@"]');
        if (paragraphs.length && profiles.length === 1) break;
        row = row.parentElement;
      }
      if (!row || row === surface || seenRows.has(row)) continue;
      seenRows.add(row);

      const text = [...row.querySelectorAll("p")]
        .map((element) => normalizedText(element))
        .filter((value) => !looksLikeMetadata(value, profile.username))
        .sort((a, b) => b.length - a.length)[0];
      if (!text) continue;

      const isReply = Boolean(row.closest('[class*="Reply"], [data-e2e*="reply"]'));
      comments.push({
        ...profile,
        text,
        timestamp: normalizedText(row.querySelector("time")),
        likes: normalizedText(row.querySelector('[data-e2e*="like-count"]')),
        replies: [],
        _level: isReply ? 2 : 1
      });
    }
    return comments;
  }

  function createOverlay() {
    state.overlay?.remove();
    const host = document.createElement("div");
    host.id = "tiktok-comments-exporter-status";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card { width:320px; padding:16px; border:1px solid rgba(255,255,255,.14); border-radius:14px;
          background:rgba(20,20,22,.96); color:#f7f7f8; box-shadow:0 16px 50px rgba(0,0,0,.35);
          font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; backdrop-filter:blur(18px); }
        .top { display:flex; align-items:center; gap:10px; margin-bottom:8px; font-weight:750; }
        .dot { width:9px; height:9px; flex:none; border-radius:50%; background:#fe2c55;
          box-shadow:3px 0 0 #25f4ee, 0 0 0 5px rgba(254,44,85,.12); }
        p { margin:0; color:#c5c5cd; }
        button { margin-top:12px; padding:7px 11px; border:1px solid rgba(255,255,255,.14); border-radius:8px;
          background:#29292f; color:white; cursor:pointer; }
      </style>
      <div class="card">
        <div class="top"><span class="dot"></span><span>Экспорт комментариев TikTok</span></div>
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

  async function exportCurrentVideo() {
    state.running = true;
    state.cancelled = false;
    createOverlay();

    try {
      updateProgress("Определяю текущее видео TikTok…");
      const root = currentVideoRoot();
      const video = videoPermalink(root);
      if (!video) {
        throw new Error("Не удалось определить видео. Откройте отдельную страницу TikTok вида /@user/video/id.");
      }

      const author = extractAuthor(root, video);
      const description = extractDescription(root);
      await openCommentsIfNeeded(root);
      const surface = findCommentsSurface(root);

      updateProgress("Загружаю комментарии TikTok. Это может занять несколько минут…");
      await expandAllComments(surface);
      updateProgress("Строю иерархию комментариев…");

      const extracted = extractFromMarkers(surface);
      const flatComments = extracted.length ? extracted : extractFallbackComments(surface);
      const comments = REPORT.buildCommentHierarchyByLevel(flatComments);
      const report = {
        platform: "tiktok",
        url: video.url,
        author,
        description,
        comments,
        exportedAt: new Date().toISOString()
      };
      const markdown = REPORT.buildMarkdown(report);
      const fileName = REPORT.makeFileName(author, video.id, new Date(), "tiktok");
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

    exportCurrentVideo().then(sendResponse);
    return true;
  });
})();
