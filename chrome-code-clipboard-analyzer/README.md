# ClipCode Analyst (Chrome Extension)

A Chrome extension that, immediately after you copy code on any webpage, prompts you with a quick analysis of what the code does and offers suggested test cases and review questions.

## Features
- Detects when you copy code and shows a lightweight overlay with:
  - A brief, heuristic analysis of the code
  - Suggested test cases
  - Thoughtful review questions
- Works on any page (no special site integration required)
- Simple on/off toggle stored locally

## How it works
- A content script listens for the browser `copy` event and inspects the current text selection.
- If the selection looks like code (based on simple heuristics), the extension generates a panel with analysis, tests, and questions.
- No external services are used; everything is computed locally in your browser.

## Install (Load Unpacked)
1. Build steps are not required for this minimal version.
2. In content_script.js change 'YOURAPIKEY' to be your api key created on https://openrouter.ai/settings/keys
3. Open Chrome and navigate to `chrome://extensions`.
4. Enable "Developer mode" (top-right).
5. Click "Load unpacked" and select this folder.

## Usage
- Select code on any webpage and press Cmd+C / Ctrl+C.
- A small panel will appear in the top-right with the analysis.
- Use the “Copy analysis” button to copy the details to your clipboard.
- Use the “Don’t show again” toggle if you want to disable the prompt globally (you can re-enable in code by clearing storage or updating the toggle in a later UI).

## Privacy
- The extension does not send your code anywhere. All analysis is done locally.

## Limitations (Initial Version)
- Language detection and analysis are heuristic and may be imperfect.
- Suggested tests are generic and based on simple pattern matching.
- Future versions can add richer language-aware parsing and configuration options.
