(() => {
  "use strict";

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  function reelShortcodeFromUrl(value) {
    try {
      const pathname = new URL(value, "https://www.instagram.com/").pathname;
      return pathname.match(/^\/reels?\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function escapeInline(value) {
    return normalizeWhitespace(value).replace(/([\\`*_{}\[\]<>])/g, "\\$1");
  }

  function profileUrl(username, explicitUrl = "", platform = "instagram") {
    const normalizedUsername = String(username || "").replace(/^@/, "").trim();
    if (!normalizedUsername) return "";

    try {
      const parsed = new URL(explicitUrl);
      if (parsed.hostname === "tiktok.com" || parsed.hostname.endsWith(".tiktok.com")) {
        return `https://www.tiktok.com/@${encodeURIComponent(normalizedUsername)}`;
      }
      if (parsed.hostname === "instagram.com" || parsed.hostname === "www.instagram.com") {
        return `https://www.instagram.com/${encodeURIComponent(normalizedUsername)}/`;
      }
    } catch {
      // Use the requested platform when an explicit URL is absent or invalid.
    }

    if (platform === "tiktok") {
      return `https://www.tiktok.com/@${encodeURIComponent(normalizedUsername)}`;
    }
    return `https://www.instagram.com/${encodeURIComponent(normalizedUsername)}/`;
  }

  function safeTextBlock(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return ["> _Нет текста_\n"];
    return normalized.split("\n").map((line) => `> ${line || " "}\n`);
  }

  function formatTimestamp(value) {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return normalizeWhitespace(value);
    return new Intl.DateTimeFormat("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(parsed);
  }

  function countComments(comments) {
    return comments.reduce(
      (sum, comment) => sum + 1 + countComments(comment.replies || []),
      0
    );
  }

  function buildCommentHierarchy(flatComments, indentThreshold = 14) {
    const roots = [];
    const stack = [];

    for (const source of flatComments) {
      const comment = { ...source, replies: [] };
      while (stack.length && comment._x <= stack.at(-1)._x + indentThreshold) {
        stack.pop();
      }

      const parent = stack.at(-1);
      if (parent) parent.replies.push(comment);
      else roots.push(comment);
      stack.push(comment);
    }

    const clean = (comment) => ({
      username: comment.username,
      profileUrl: comment.profileUrl,
      text: comment.text,
      timestamp: comment.timestamp,
      likes: comment.likes,
      replies: comment.replies.map(clean)
    });
    return roots.map(clean);
  }

  function buildCommentHierarchyByLevel(flatComments) {
    const roots = [];
    const stack = [];

    for (const source of flatComments) {
      const level = Math.max(1, Number(source._level) || 1);
      const comment = {
        username: source.username,
        profileUrl: source.profileUrl,
        text: source.text,
        timestamp: source.timestamp,
        likes: source.likes,
        replies: []
      };

      stack.length = Math.min(stack.length, level - 1);
      const parent = level > 1 ? stack.at(-1) : null;
      if (parent) parent.replies.push(comment);
      else roots.push(comment);
      stack[level - 1] = comment;
      stack.length = level;
    }

    return roots;
  }

  function renderComment(comment, depth = 0, platform = "instagram") {
    const indent = "  ".repeat(depth);
    const username = comment.username ? `@${escapeInline(comment.username)}` : "неизвестный автор";
    const url = profileUrl(comment.username, comment.profileUrl, platform);
    const author = url ? `[${username}](${url})` : username;
    const details = [];
    if (comment.timestamp) details.push(formatTimestamp(comment.timestamp));
    if (comment.likes) details.push(escapeInline(comment.likes));

    const lines = [
      `${indent}- **${author}**${details.length ? ` · ${details.join(" · ")}` : ""}\n`
    ];

    for (const textLine of safeTextBlock(comment.text)) {
      lines.push(`${indent}  ${textLine}`);
    }

    for (const reply of comment.replies || []) {
      lines.push(renderComment(reply, depth + 1, platform));
    }

    return lines.join("");
  }

  function buildMarkdown(video) {
    const comments = video.comments || [];
    const total = countComments(comments);
    const platform = video.platform === "tiktok" ? "tiktok" : "instagram";
    const documentTitle = platform === "tiktok" ? "TikTok Video" : "Instagram Reel";
    const author = video.author ? `@${escapeInline(video.author)}` : "не определён";
    const exportedAt = formatTimestamp(video.exportedAt || new Date().toISOString());

    const output = [
      `# ${documentTitle} — ${author}\n\n`,
      `- **Ссылка:** ${video.url || "не определена"}\n`,
      `- **Автор:** ${author}\n`,
      `- **Дата экспорта:** ${exportedAt}\n`,
      `- **Комментариев:** ${total}\n\n`,
      "## Описание\n\n",
      ...safeTextBlock(video.description),
      "\n## Комментарии\n\n"
    ];

    if (!comments.length) {
      output.push("_Комментарии не найдены или недоступны._\n");
    } else {
      for (const comment of comments) output.push(renderComment(comment, 0, platform));
    }

    return output.join("");
  }

  function makeFileName(author, shortcode, date = new Date(), platform = "instagram") {
    const day = date.toISOString().slice(0, 10);
    const safeAuthor = String(author || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
    const safeShortcode = String(shortcode || "reel").replace(/[^a-zA-Z0-9_-]+/g, "") || "reel";
    const prefix = platform === "tiktok" ? "tiktok-video" : "instagram-reel";
    return `${prefix}_${safeAuthor}_${safeShortcode}_${day}.md`;
  }

  const reportApi = {
    buildCommentHierarchy,
    buildCommentHierarchyByLevel,
    buildMarkdown,
    countComments,
    makeFileName,
    normalizeWhitespace,
    profileUrl,
    reelShortcodeFromUrl
  };
  globalThis.CommentsReport = reportApi;
  globalThis.InstagramReport = reportApi;
})();
