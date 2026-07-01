# NCE Pad Reader Web

Static PWA version of the NCEPadReader app. It avoids Apple developer signing because it runs in the browser and can be added to the iPad Home Screen from Safari.

Production URL:

```text
https://coderleexl.github.io/NCE-English/
```

The app loads the hosted New Concept English resource manifest from GitHub Pages by default. Manual import remains available as a fallback when the hosted resource index is unavailable.

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
4. Lessons load automatically from the hosted resource library.

Learning state, notes, exercise answers, and completed lessons are stored locally in browser storage. The hosted PDFs, MP3s, and LRC files are fetched from GitHub as needed. If the hosted library is unavailable, tap `+` and choose a local `New-Concept-English` folder or select the PDF/MP3/LRC files.

## Current Scope

- Four-book lesson tree
- `Lesson 1-2` style lesson labels
- Continuous PDF scrolling with lazy PDF.js rendering
- MP3 playback
- LRC synchronized captions
- Dynamic vocabulary chips
- Lesson-level Done state
- Exercises answer areas
- Lesson notes
- PWA app shell caching with network-first updates
