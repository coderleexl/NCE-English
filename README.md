# NCE Pad Reader Web

Static PWA version of the NCEPadReader app. It avoids Apple developer signing because it runs in the browser and can be added to the iPad Home Screen from Safari.

## Run Locally

```bash
cd webapp
python3 -m http.server 5173
```

Open:

```text
http://localhost:5173
```

From another device on the same network, replace `localhost` with the Mac IP address.

## iPad Use

1. Open the app URL in Safari.
2. Tap Share, then Add to Home Screen.
3. Open the installed web app.
4. Tap `+` and choose the `New-Concept-English` folder or select the PDF/MP3/LRC files.

The app caches imported resource files in browser storage and stores learning state locally. iPadOS Safari does not expose the same persistent external folder handle API as Chromium browsers, so the web app uses browser storage as the persistence layer after import.

## Current Scope

- Four-book lesson tree
- `Lesson 1-2` style lesson labels
- PDF page rendering with PDF.js
- MP3 playback
- LRC synchronized captions
- Dynamic vocabulary chips
- Lesson-level Done state
- Exercises answer areas
- Lesson notes
- PWA app shell caching
