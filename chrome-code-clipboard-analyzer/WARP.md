# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project overview
- ClipCode Analyst is a minimal Chrome Extension (Manifest v3). When you copy code on any web page, it shows a lightweight overlay with a quick explanation, suggested tests, and review questions. All logic runs locally in the browser; no external services.

Development and commands
- Build: none. This repo is plain JS + manifest; no bundler or package manager.
- Lint: none configured.
- Tests: none configured.
- Run locally (Load Unpacked):
  1) Open Chrome and go to chrome://extensions
  2) Enable Developer mode (top right)
  3) Click “Load unpacked” and select this folder
  4) After editing files, click the extension’s “Reload” button to pick up changes

High-level architecture
- Manifest (manifest.json)
  - manifest_version: 3
  - permissions: ["storage"]; host_permissions: ["<all_urls>"]
  - content_scripts: runs content_script.js on all pages at document_start
- Content script (content_script.js)
  - Persistent toggle
    - STORAGE_KEY = 'cca_enabled'; reads/writes chrome.storage.local to enable/disable prompts
  - Event hook
    - Listens to copy events (capturing phase). Pulls current selection text, trims, and throttles display (2.5s window)
  - Heuristic detection
    - isProbablyCode(text): checks code-like signals (keywords, braces, semicolons, indentation, average line length)
    - guessLanguage(text): lightweight regex-based detector for cpp, csharp, go, java, python, javascript, ruby, php; falls back to 'unknown'
  - Analysis pipeline
    - summarize(text, lang): produces a short summary (language, line count, presence of class/functions/imports)
    - extractFunctionInfo(text, lang): best-effort function/param parsing for javascript, python, and go
    - sampleTests(text, lang): generates a small list of example tests based on parsed functions; otherwise provides generic guidance
    - questions(text, lang): produces review questions to consider
    - analyzeCode(text): orchestrates the above and returns { language, summary, tests, questions }
  - UI rendering
    - renderPanel(analysis, code): injects a Shadow DOM panel with styles, "Copy analysis" action, a close button, and an on/off toggle; panel shows Summary, Tests, Questions, and truncated Code
    - formatForClipboard(analysis, code): creates a readable text payload for clipboard
    - Simple CSS theme and structure scoped inside Shadow DOM to avoid page conflicts
  - State and UX
    - Local throttle via STATE.lastShownAt to avoid rapid re-triggering
    - Toggle persists to chrome.storage.local and immediately updates UI

Key behaviors and constraints
- Runs on all URLs (matches "<all_urls>") and at document_start; overlay is positioned fixed in the page’s top-right corner with very high z-index
- No background/service worker, no external network calls, no content security policy relaxations required

Important from README
- Install: Load Unpacked; no build steps for this minimal version
- Privacy: no data leaves the browser
- Limitations: heuristic language/analysis; suggested tests are generic and pattern-based
