"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

require("../report.js");

const {
  buildCommentHierarchy,
  buildCommentHierarchyByLevel,
  buildMarkdown,
  countComments,
  makeFileName,
  normalizeWhitespace,
  profileUrl,
  reelShortcodeFromUrl
} = globalThis.CommentsReport;

test("counts comments at every nesting level", () => {
  const comments = [
    {
      replies: [
        { replies: [] },
        { replies: [{ replies: [] }] }
      ]
    },
    { replies: [] }
  ];

  assert.equal(countComments(comments), 5);
});

test("renders author, description and nested replies", () => {
  const markdown = buildMarkdown({
    url: "https://www.instagram.com/reel/ABC123/",
    author: "reel.author",
    description: "Первая строка\nВторая строка",
    exportedAt: "2026-08-05T15:00:00.000Z",
    comments: [
      {
        username: "parent_user",
        profileUrl: "https://www.instagram.com/parent_user/",
        text: "Основной комментарий",
        timestamp: "2026-08-05T14:00:00.000Z",
        replies: [
          {
            username: "reply_user",
            profileUrl: "https://www.instagram.com/reply_user/",
            text: "Ответ",
            timestamp: "2026-08-05T14:05:00.000Z",
            replies: []
          }
        ]
      }
    ]
  });

  assert.match(markdown, /# Instagram Reel — @reel\.author/);
  assert.match(markdown, /> Первая строка\n> Вторая строка/);
  assert.match(markdown, /- \*\*\[@parent\\_user\]\(https:\/\/www\.instagram\.com\/parent_user\/\)\*\*/);
  assert.match(markdown, /  - \*\*\[@reply\\_user\]\(https:\/\/www\.instagram\.com\/reply_user\/\)\*\*/);
  assert.match(markdown, /- \*\*Комментариев:\*\* 2/);
});

test("escapes inline markdown in usernames and creates a safe file name", () => {
  const markdown = buildMarkdown({
    author: "name_with_star*",
    comments: [],
    exportedAt: "2026-08-05T15:00:00.000Z"
  });

  assert.match(markdown, /@name\\_with\\_star\\\*/);
  assert.equal(
    makeFileName("unsafe/user", "ABC-123", new Date("2026-08-05T00:00:00.000Z")),
    "instagram-reel_unsafe_user_ABC-123_2026-08-05.md"
  );
});

test("normalizes non-breaking spaces and line whitespace", () => {
  assert.equal(normalizeWhitespace("  one\u00a0 two  \n  three "), "one two\nthree");
});

test("recognizes singular and plural Instagram Reel URLs", () => {
  assert.equal(reelShortcodeFromUrl("https://www.instagram.com/reel/ABC_123/"), "ABC_123");
  assert.equal(reelShortcodeFromUrl("https://www.instagram.com/reels/XYZ-789/?utm_source=test"), "XYZ-789");
  assert.equal(reelShortcodeFromUrl("https://www.instagram.com/reels/"), "");
  assert.equal(reelShortcodeFromUrl("https://www.instagram.com/p/POST123/"), "");
});

test("builds canonical Instagram profile links", () => {
  assert.equal(profileUrl("commenter"), "https://www.instagram.com/commenter/");
  assert.equal(profileUrl("@name.with_dot"), "https://www.instagram.com/name.with_dot/");
  assert.equal(
    profileUrl("safe_user", "https://malicious.example/profile"),
    "https://www.instagram.com/safe_user/"
  );
});

test("renders a TikTok report with TikTok profile links", () => {
  const markdown = buildMarkdown({
    platform: "tiktok",
    url: "https://www.tiktok.com/@creator/video/1234567890",
    author: "creator",
    description: "Описание TikTok",
    exportedAt: "2026-09-07T10:00:00.000Z",
    comments: [{
      username: "viewer.one",
      profileUrl: "https://www.tiktok.com/@viewer.one",
      text: "Комментарий",
      replies: [{ username: "viewer_two", text: "Ответ", replies: [] }]
    }]
  });

  assert.match(markdown, /# TikTok Video — @creator/);
  assert.match(markdown, /\[@viewer\.one\]\(https:\/\/www\.tiktok\.com\/@viewer\.one\)/);
  assert.match(markdown, /\[@viewer\\_two\]\(https:\/\/www\.tiktok\.com\/@viewer_two\)/);
  assert.equal(
    makeFileName("creator", "1234567890", new Date("2026-09-07T00:00:00.000Z"), "tiktok"),
    "tiktok-video_creator_1234567890_2026-09-07.md"
  );
});

test("uses the explicit supported platform for profile links", () => {
  assert.equal(
    profileUrl("user", "https://www.tiktok.com/@user", "instagram"),
    "https://www.tiktok.com/@user"
  );
  assert.equal(profileUrl("user", "", "tiktok"), "https://www.tiktok.com/@user");
});

test("builds TikTok reply branches from explicit comment levels", () => {
  const comments = buildCommentHierarchyByLevel([
    { username: "root_one", text: "root", _level: 1 },
    { username: "reply_one", text: "reply", _level: 2 },
    { username: "reply_two", text: "reply", _level: 2 },
    { username: "root_two", text: "root", _level: 1 },
    { username: "reply_three", text: "reply", _level: 2 }
  ]);

  assert.equal(comments.length, 2);
  assert.deepEqual(
    comments[0].replies.map((comment) => comment.username),
    ["reply_one", "reply_two"]
  );
  assert.equal(comments[1].replies[0].username, "reply_three");
});

test("builds a hierarchy from Instagram's visual indentation", () => {
  const comments = buildCommentHierarchy([
    { username: "first", text: "root", _x: 100 },
    { username: "reply_one", profileUrl: "https://www.instagram.com/reply_one/", text: "reply", _x: 140 },
    { username: "reply_two", text: "reply", _x: 140 },
    { username: "nested", text: "nested reply", _x: 180 },
    { username: "second", text: "root", _x: 100 }
  ]);

  assert.equal(comments.length, 2);
  assert.deepEqual(
    comments[0].replies.map((comment) => comment.username),
    ["reply_one", "reply_two"]
  );
  assert.equal(comments[0].replies[1].replies[0].username, "nested");
  assert.equal(comments[0].replies[0].profileUrl, "https://www.instagram.com/reply_one/");
  assert.equal(comments[1].username, "second");
});
