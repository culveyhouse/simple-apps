# Stickynote

Sticky note board app inside the `Simple Apps` repo.

Intent:
- runs as a simple HTML, CSS, and JS app
- works locally in a browser with no build step
- can also be linked from the repo homepage for GitHub Pages

Files:
- `index.html`: app shell and board markup
- `styles.css`: fridge board, sticky note, and control styling
- `app.js`: note creation, editing, layering, dragging, and save logic

How it saves:
- every board change autosaves into browser storage for quick local persistence
- `Save JSON` downloads a board save file you can keep in this folder
- `Load JSON` restores the board from a prior save file
- `Bind Save File` tries to keep a chosen JSON file in sync when the browser allows file-handle access

Open `index.html` in a modern desktop browser to use it locally.
