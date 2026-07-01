# NCE Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static iPad-friendly NCE learning web app that avoids Apple signing while preserving the core reader, audio, captions, exercises, and progress workflows.

**Architecture:** Create a self-contained `webapp/` static PWA. Resources are imported from iCloud Drive via browser file/folder selection, indexed client-side, and cached as browser blobs when directory handles are not available. Learning state lives in IndexedDB/localStorage so reinstalling native apps does not affect the web app.

**Tech Stack:** HTML, CSS, vanilla JavaScript modules, IndexedDB, PDF.js CDN, Web Audio/HTMLAudioElement, Service Worker.

---

### Task 1: Static App Shell

**Files:**
- Create: `webapp/index.html`
- Create: `webapp/styles.css`
- Create: `webapp/manifest.webmanifest`
- Create: `webapp/sw.js`

- [ ] Add a three-pane iPad layout with sidebar, PDF canvas area, and study panel.
- [ ] Add PWA manifest and service worker for app-shell caching.
- [ ] Verify by serving `webapp/` and opening `http://localhost:5173`.

### Task 2: Resource Import and Persistence

**Files:**
- Create: `webapp/src/storage.js`
- Create: `webapp/src/resource-index.js`
- Create: `webapp/src/lrc.js`

- [ ] Implement IndexedDB stores for resources and learning state.
- [ ] Implement folder/file import from `webkitdirectory`/multiple file input and optional `showDirectoryPicker`.
- [ ] Parse NCE PDF, MP3, and LRC filenames into books and lessons, including `001&002` lesson ranges.

### Task 3: Reader Runtime

**Files:**
- Create: `webapp/src/app.js`

- [ ] Render collapsible books and lessons.
- [ ] Use PDF.js to render target pages matching the native app page map.
- [ ] Use `<audio>` to play MP3 files and parsed LRC captions to follow playback.
- [ ] Save selected lesson, completed lessons, exercise answers, and notes.

### Task 4: Verification

**Files:**
- Modify: `webapp/README.md`

- [ ] Run a local static server.
- [ ] Verify app shell loads.
- [ ] Verify import controls are visible and no JavaScript module import errors occur.
- [ ] Document iPad Safari limitations and installation steps.
