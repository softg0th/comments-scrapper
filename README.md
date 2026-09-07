# Instagram & TikTok Comments Exporter

English | [Русский](README.ru.md)

A Manifest V3 extension for Chromium browsers that exports data from the current Instagram Reel or TikTok video:

- the creator's username;
- the video description;
- all comments available on the page;
- nested replies;
- clickable profile links for commenters and reply authors.

The extension downloads the result as a Markdown file.

## Install for development

1. Open `chrome://extensions` in Chrome, Edge, Brave, or another Chromium browser.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository's directory.
5. Reload any Instagram or TikTok tabs that were already open.

## Usage

1. Sign in to Instagram or TikTok in the browser.
2. Open the video you want to export:
   - Instagram: open a Reel page (`/reel/.../` or `/reels/.../`) or stop on a video in the `/reels/` feed;
   - TikTok: open a page matching `/@username/video/id`. A dedicated video page gives the most reliable results.
3. Click the extension icon, then click **Скачать отчёт**.
4. Wait for the export to finish. The page shows progress and a cancel button while comments load.

The extension expands the available comment and reply controls, scrolls the comment panel, and stops after several passes return no new data. The TikTok collector uses `data-e2e` attributes with DOM-based fallbacks.

## Report format

```md
# Instagram Reel — @author

- **Ссылка:** https://www.instagram.com/reel/SHORTCODE/
- **Автор:** @author
- **Дата экспорта:** 05.08.2026, 18:50 GMT+3
- **Комментариев:** 3

## Описание

> Описание ролика

## Комментарии

- **[@commenter](https://www.instagram.com/commenter/)** · 05.08.2026, 17:10 GMT+3
  > Комментарий
  - **[@reply_author](https://www.instagram.com/reply_author/)** · 05.08.2026, 17:15 GMT+3
    > Ответ
```

## Limitations

- The extension reads the page DOM. Instagram and TikTok can change their markup, which may require selector updates.
- The export contains only comments available to the current account in the web interface. It cannot retrieve hidden, deleted, restricted, or unloaded data.
- Videos with many comments may take several minutes to process. A cycle limit prevents the collector from running indefinitely.
- Dedicated Reel and TikTok video pages produce the most reliable results.

Only process data that you are allowed to access and use. Follow the platforms' terms and applicable privacy rules.

## Project structure

- `manifest.json` — Manifest V3 configuration;
- `icons/` — browser icons in 16, 32, 48, and 128 px sizes;
- `popup.html`, `popup.css`, `popup.js` — extension popup;
- `content.js` — Instagram comment loader and parser;
- `tiktok.js` — TikTok comment loader and parser;
- `report.js` — Markdown report generator;
- `tests/report.test.js` — report and hierarchy tests.

## Checks

Run the syntax checks and tests with Node.js:

```bash
node --check popup.js
node --check content.js
node --check tiktok.js
node --check report.js
node --test tests/report.test.js
```
