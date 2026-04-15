const STORAGE_KEY = 'stickynote.board.v1';
const DOWNLOAD_NAME = 'stickynote-board.json';
const NOTE_SIZE = 220;
const SAVE_DEBOUNCE_MS = 180;
const FILE_SYNC_DEBOUNCE_MS = 280;
const PALETTE = [
  { paper: '#F9E8A9', tab: '#F0D883', ink: '#4E4330' },
  { paper: '#F7DCE8', tab: '#E8BDD0', ink: '#553948' },
  { paper: '#D9F1F0', tab: '#B7E2E0', ink: '#2D5452' },
  { paper: '#DDE6FA', tab: '#BECDED', ink: '#334865' },
  { paper: '#F8E4D8', tab: '#EECCB7', ink: '#5C453A' },
  { paper: '#E5F4D8', tab: '#CBE9B6', ink: '#3D5538' }
];

const state = {
  notes: [],
  selectedNoteId: null,
  activeEditId: null,
  boardReady: false,
  boundFileHandle: null,
  boundFileName: '',
  lastLocalSaveAt: null,
  lastFileSaveAt: null,
  saveTimer: null,
  fileSyncTimer: null,
  statusMessage: 'Board waking up...'
};

const board = document.getElementById('board');
const noteTemplate = document.getElementById('note-template');
const statusText = document.getElementById('status-text');
const newNoteButton = document.getElementById('new-note-button');
const saveJsonButton = document.getElementById('save-json-button');
const loadJsonButton = document.getElementById('load-json-button');
const bindFileButton = document.getElementById('bind-file-button');
const syncFileButton = document.getElementById('sync-file-button');
const clearBoardButton = document.getElementById('clear-board-button');
const loadFileInput = document.getElementById('load-file-input');

initialize();

function initialize() {
  bindEvents();
  restoreBoard();
  state.boardReady = true;
  renderBoard();
  updateStatus();
}

function bindEvents() {
  newNoteButton.addEventListener('click', () => createNote(true));
  saveJsonButton.addEventListener('click', downloadBoardJson);
  loadJsonButton.addEventListener('click', () => loadFileInput.click());
  bindFileButton.addEventListener('click', bindSaveFile);
  syncFileButton.addEventListener('click', () => syncBoardToBoundFile(true));
  clearBoardButton.addEventListener('click', clearBoard);
  loadFileInput.addEventListener('change', importBoardFromInput);
  window.addEventListener('resize', renderBoard);
}

function createNote(startEditing) {
  const placement = getCenteredPlacement();
  const palette = randomItem(PALETTE);
  const note = {
    id: generateId(),
    text: '',
    x: placement.x,
    y: placement.y,
    rotation: randomBetween(-9, 9),
    tabSide: Math.random() < 0.5 ? 'left' : 'right',
    paper: palette.paper,
    tab: palette.tab,
    ink: palette.ink,
    z: getTopZ() + 1,
    updatedAt: new Date().toISOString()
  };

  state.notes.push(note);
  state.selectedNoteId = note.id;
  state.activeEditId = startEditing ? note.id : null;
  commitStateChange('New note created.');

  if (startEditing) {
    focusEditorSoon(note.id, true);
  }
}

function getCenteredPlacement() {
  const rect = board.getBoundingClientRect();
  const width = rect.width || 900;
  const height = rect.height || 620;
  const rangeX = Math.min(180, width * 0.18);
  const rangeY = Math.min(140, height * 0.16);
  const x = clamp((width / 2) - (NOTE_SIZE / 2) + randomBetween(-rangeX, rangeX), 18, Math.max(18, width - NOTE_SIZE - 18));
  const y = clamp((height / 2) - (NOTE_SIZE / 2) + randomBetween(-rangeY, rangeY), 18, Math.max(18, height - NOTE_SIZE - 28));
  return { x, y };
}

function restoreBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.statusMessage = 'Fresh board. Create your first note.';
      return;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.notes)) {
      throw new Error('Invalid save data');
    }

    state.notes = parsed.notes.map(normalizeNote).filter(Boolean);
    normalizeZOrder();
    state.lastLocalSaveAt = parsed.savedAt || null;
    state.statusMessage = state.notes.length
      ? 'Restored board from local autosave.'
      : 'Local autosave loaded. Board is empty.';
  } catch (error) {
    console.warn('Could not restore board.', error);
    state.statusMessage = 'Could not restore prior board. Starting clean.';
  }
}

function normalizeNote(note) {
  if (!note || typeof note !== 'object') {
    return null;
  }

  const palette = PALETTE.find((entry) => entry.paper === note.paper) || randomItem(PALETTE);
  return {
    id: String(note.id || generateId()),
    text: typeof note.text === 'string' ? note.text : '',
    x: Number.isFinite(note.x) ? note.x : 30,
    y: Number.isFinite(note.y) ? note.y : 30,
    rotation: Number.isFinite(note.rotation) ? note.rotation : 0,
    tabSide: note.tabSide === 'right' ? 'right' : 'left',
    paper: typeof note.paper === 'string' ? note.paper : palette.paper,
    tab: typeof note.tab === 'string' ? note.tab : palette.tab,
    ink: typeof note.ink === 'string' ? note.ink : palette.ink,
    z: Number.isFinite(note.z) ? note.z : getTopZ() + 1,
    updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : new Date().toISOString()
  };
}

function renderBoard() {
  board.innerHTML = '';

  if (!state.notes.length) {
    board.appendChild(buildEmptyState());
    updateStatus();
    return;
  }

  const sortedNotes = [...state.notes].sort((a, b) => a.z - b.z);
  for (const note of sortedNotes) {
    board.appendChild(buildNoteElement(note));
  }

  updateStatus();
}

function buildEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'empty-board';
  empty.innerHTML = '<strong>No sticky notes yet.</strong><span>Press New Note to toss one near the middle of the board.</span>';
  return empty;
}

function buildNoteElement(note) {
  const fragment = noteTemplate.content.cloneNode(true);
  const noteElement = fragment.querySelector('.note');
  const display = fragment.querySelector('.note-display');
  const editor = fragment.querySelector('.note-editor');
  const dragTab = fragment.querySelector('.drag-tab');
  const actionButtons = fragment.querySelectorAll('.layer-button');

  noteElement.dataset.id = note.id;
  noteElement.dataset.tabSide = note.tabSide;
  noteElement.style.left = `${note.x}px`;
  noteElement.style.top = `${note.y}px`;
  noteElement.style.transform = `rotate(${note.rotation}deg)`;
  noteElement.style.zIndex = String(note.z);
  noteElement.style.setProperty('--note-paper', note.paper);
  noteElement.style.setProperty('--note-tab', note.tab);
  noteElement.style.setProperty('--note-ink', note.ink);

  if (state.selectedNoteId === note.id) {
    noteElement.classList.add('selected');
  }

  if (state.activeEditId === note.id) {
    noteElement.classList.add('editing');
  }

  display.textContent = note.text;
  display.classList.toggle('empty', !note.text.trim());
  editor.value = note.text;

  noteElement.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.drag-tab') || event.target.closest('.layer-button')) {
      return;
    }
    state.selectedNoteId = note.id;
    setSelectedNoteInDom(note.id);
  });

  display.addEventListener('click', () => startEditing(note.id));
  display.addEventListener('dblclick', () => startEditing(note.id));
  noteElement.addEventListener('keydown', (event) => handleNoteKeyboard(event, note.id));

  editor.addEventListener('keydown', (event) => handleEditorKeydown(event, note.id));
  editor.addEventListener('blur', () => {
    if (state.activeEditId === note.id) {
      saveEditorValue(note.id, editor.value);
    }
  });

  dragTab.addEventListener('pointerdown', (event) => beginDrag(event, note.id));

  for (const button of actionButtons) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handleNoteAction(note.id, button.dataset.action);
    });
  }

  queueMicrotask(() => {
    if (state.activeEditId === note.id) {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }
  });

  return fragment;
}

function setSelectedNoteInDom(noteId) {
  for (const element of board.querySelectorAll('.note.selected')) {
    element.classList.remove('selected');
  }

  const selected = board.querySelector(`[data-id="${noteId}"]`);
  if (selected) {
    selected.classList.add('selected');
  }
}

function handleNoteKeyboard(event, noteId) {
  if (event.target.closest('.note-editor')) {
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    startEditing(noteId);
    return;
  }

  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    startEditing(noteId, event.key);
  }
}

function startEditing(noteId, seedText) {
  const note = getNote(noteId);
  if (!note) {
    return;
  }

  state.selectedNoteId = noteId;
  state.activeEditId = noteId;
  renderBoard();
  focusEditorSoon(noteId, false, seedText);
}

function focusEditorSoon(noteId, replaceText, seedText) {
  requestAnimationFrame(() => {
    const noteElement = board.querySelector(`[data-id="${noteId}"]`);
    if (!noteElement) {
      return;
    }
    const editor = noteElement.querySelector('.note-editor');
    editor.focus();

    if (replaceText) {
      editor.setSelectionRange(editor.value.length, editor.value.length);
      return;
    }

    if (typeof seedText === 'string' && seedText.length === 1) {
      editor.value = seedText;
      editor.setSelectionRange(1, 1);
      return;
    }

    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

function handleEditorKeydown(event, noteId) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    saveEditorValue(noteId, event.currentTarget.value);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    state.activeEditId = null;
    renderBoard();
  }
}

function saveEditorValue(noteId, value) {
  const note = getNote(noteId);
  if (!note) {
    return;
  }

  note.text = value.trimEnd();
  note.updatedAt = new Date().toISOString();
  state.activeEditId = null;
  state.selectedNoteId = noteId;
  commitStateChange('Note saved.');
}

function handleNoteAction(noteId, action) {
  state.selectedNoteId = noteId;

  if (action === 'front') {
    moveToFront(noteId);
    commitStateChange('Moved note to the front.');
    return;
  }

  if (action === 'back') {
    moveToBack(noteId);
    commitStateChange('Moved note to the back.');
    return;
  }

  if (action === 'delete') {
    deleteNote(noteId);
  }
}

function moveToFront(noteId) {
  const note = getNote(noteId);
  if (!note) {
    return;
  }
  note.z = getTopZ() + 1;
  normalizeZOrder();
}

function moveToBack(noteId) {
  const note = getNote(noteId);
  if (!note) {
    return;
  }
  note.z = getLowestZ() - 1;
  normalizeZOrder();
}

function deleteNote(noteId) {
  state.notes = state.notes.filter((note) => note.id !== noteId);
  if (state.selectedNoteId === noteId) {
    state.selectedNoteId = state.notes.at(-1)?.id || null;
  }
  if (state.activeEditId === noteId) {
    state.activeEditId = null;
  }
  normalizeZOrder();
  commitStateChange('Note deleted.');
}

function beginDrag(event, noteId) {
  event.preventDefault();
  const note = getNote(noteId);
  const noteElement = board.querySelector(`[data-id="${noteId}"]`);
  if (!note || !noteElement) {
    return;
  }

  if (state.activeEditId === noteId) {
    const editor = noteElement.querySelector('.note-editor');
    if (editor) {
      note.text = editor.value.trimEnd();
      note.updatedAt = new Date().toISOString();
    }
  }

  state.selectedNoteId = noteId;
  state.activeEditId = null;
  noteElement.classList.remove('editing');
  noteElement.classList.add('dragging', 'selected');

  const startX = event.clientX;
  const startY = event.clientY;
  const originalX = note.x;
  const originalY = note.y;

  const onPointerMove = (moveEvent) => {
    const boardRect = board.getBoundingClientRect();
    const nextX = clamp(originalX + (moveEvent.clientX - startX), 0, Math.max(0, boardRect.width - noteElement.offsetWidth));
    const nextY = clamp(originalY + (moveEvent.clientY - startY), 0, Math.max(0, boardRect.height - noteElement.offsetHeight - 10));
    note.x = nextX;
    note.y = nextY;
    note.updatedAt = new Date().toISOString();
    noteElement.style.left = `${nextX}px`;
    noteElement.style.top = `${nextY}px`;
    scheduleLocalSave('Dragging note...');
  };

  const stopDragging = () => {
    noteElement.classList.remove('dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stopDragging);
    window.removeEventListener('pointercancel', stopDragging);
    commitStateChange('Note moved.');
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
  setSelectedNoteInDom(noteId);
}

function commitStateChange(message) {
  window.clearTimeout(state.saveTimer);
  normalizeZOrder();
  persistLocally(message);
  renderBoard();
  scheduleFileSync();
}

function scheduleLocalSave(message) {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => persistLocally(message), SAVE_DEBOUNCE_MS);
}

function persistLocally(message) {
  const payload = serializeBoard();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  state.lastLocalSaveAt = payload.savedAt;
  if (message) {
    state.statusMessage = message;
  }
  updateStatus();
}

function scheduleFileSync() {
  if (!state.boundFileHandle) {
    return;
  }
  window.clearTimeout(state.fileSyncTimer);
  state.fileSyncTimer = window.setTimeout(() => {
    syncBoardToBoundFile(false);
  }, FILE_SYNC_DEBOUNCE_MS);
}

async function bindSaveFile() {
  if (typeof window.showSaveFilePicker !== 'function') {
    state.statusMessage = 'This browser does not expose a bindable save file here. Use Save JSON instead.';
    updateStatus();
    return;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: DOWNLOAD_NAME,
      types: [{
        description: 'JSON board save',
        accept: { 'application/json': ['.json'] }
      }]
    });

    state.boundFileHandle = handle;
    state.boundFileName = handle.name;
    state.statusMessage = `Bound save file: ${handle.name}`;
    updateStatus();
    await syncBoardToBoundFile(true);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Could not bind save file.', error);
      state.statusMessage = 'Could not bind a save file. Save JSON still works.';
      updateStatus();
    }
  }
}

async function syncBoardToBoundFile(manual) {
  if (!state.boundFileHandle) {
    if (manual) {
      state.statusMessage = 'No bound save file yet. Use Bind Save File or Save JSON.';
      updateStatus();
    }
    return;
  }

  try {
    const writable = await state.boundFileHandle.createWritable();
    await writable.write(JSON.stringify(serializeBoard(), null, 2));
    await writable.close();
    state.lastFileSaveAt = new Date().toISOString();
    state.statusMessage = `Synced board to ${state.boundFileName}.`;
    updateStatus();
  } catch (error) {
    console.warn('Could not sync board to file.', error);
    state.statusMessage = 'File sync failed. Local autosave still succeeded.';
    updateStatus();
  }
}

function downloadBoardJson() {
  const blob = new Blob([JSON.stringify(serializeBoard(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = DOWNLOAD_NAME;
  link.click();
  URL.revokeObjectURL(url);
  state.statusMessage = `Downloaded ${DOWNLOAD_NAME}.`;
  updateStatus();
}

function importBoardFromInput(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || !Array.isArray(parsed.notes)) {
        throw new Error('Save file is missing a notes array.');
      }
      state.notes = parsed.notes.map(normalizeNote).filter(Boolean);
      state.selectedNoteId = state.notes.at(-1)?.id || null;
      state.activeEditId = null;
      normalizeZOrder();
      commitStateChange(`Loaded ${file.name}.`);
    } catch (error) {
      console.warn('Could not load JSON file.', error);
      state.statusMessage = 'That JSON file could not be loaded.';
      updateStatus();
    } finally {
      loadFileInput.value = '';
    }
  };
  reader.readAsText(file);
}

function clearBoard() {
  const confirmed = window.confirm('Clear every sticky note from the board?');
  if (!confirmed) {
    return;
  }

  state.notes = [];
  state.selectedNoteId = null;
  state.activeEditId = null;
  commitStateChange('Board cleared.');
}

function serializeBoard() {
  return {
    app: 'stickynote',
    version: 1,
    savedAt: new Date().toISOString(),
    notes: state.notes
      .map((note) => ({ ...note }))
      .sort((a, b) => a.z - b.z)
  };
}

function updateStatus() {
  const parts = [state.statusMessage];
  if (state.lastLocalSaveAt) {
    parts.push(`Local autosave ${formatTime(state.lastLocalSaveAt)}`);
  }
  if (state.boundFileName) {
    const fileText = state.lastFileSaveAt
      ? `Bound file ${state.boundFileName} synced ${formatTime(state.lastFileSaveAt)}`
      : `Bound file ${state.boundFileName} waiting for sync`;
    parts.push(fileText);
  } else {
    parts.push('No bound save file yet');
  }

  statusText.textContent = parts.join(' | ');
  syncFileButton.disabled = !state.boundFileHandle;
}

function normalizeZOrder() {
  const ordered = [...state.notes].sort((a, b) => a.z - b.z);
  ordered.forEach((note, index) => {
    note.z = index + 1;
  });
}

function getNote(noteId) {
  return state.notes.find((note) => note.id === noteId) || null;
}

function getTopZ() {
  return state.notes.reduce((max, note) => Math.max(max, note.z || 0), 0);
}

function getLowestZ() {
  return state.notes.reduce((lowest, note) => Math.min(lowest, note.z || 0), 0);
}

function randomBetween(min, max) {
  return Math.round(Math.random() * (max - min) + min);
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function generateId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(value));
  } catch {
    return value;
  }
}