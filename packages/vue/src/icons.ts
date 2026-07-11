/**
 * Inline SVG bodies, rendered inside a shared `<svg class="ue-ico" viewBox="0 0 24 24">`.
 * Stroke follows `currentColor`, so icons inherit whatever colour the button has.
 * Keeping them as markup strings avoids 40 one-line component files.
 */
export const ICONS: Record<string, string> = {
  bold: '<path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/>',
  italic:
    '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/>',
  strike:
    '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  codeBlock:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="9.5 10 7 12.5 9.5 15"/><polyline points="14.5 10 17 12.5 14.5 15"/>',
  quote:
    '<path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.3 4.2-4 5"/><path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.3 4.2-4 5"/>',
  bulletList:
    '<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.5" fill="currentColor" stroke="none"/>',
  orderedList:
    '<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 4.5 5.5 4v5"/><line x1="3.8" y1="9" x2="6" y2="9"/><path d="M3.5 15a1.4 1.4 0 0 1 2.6.7c0 1-2.4 1.6-2.6 3.3h2.7"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-4.5-4.5L7 20"/>',
  table:
    '<rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="20"/><line x1="15" y1="9" x2="15" y2="20"/>',
  columns:
    '<rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/>',
  hr: '<line x1="4" y1="12" x2="20" y2="12"/>',
  clear:
    '<path d="M4 7V5h13v2"/><path d="M12 5 8 19"/><line x1="5" y1="19" x2="11" y2="19"/><line x1="15" y1="14" x2="20" y2="19"/><line x1="20" y1="14" x2="15" y2="19"/>',
  undo: '<path d="M9 14 5 10l4-4"/><path d="M5 10h10a4 4 0 0 1 0 8h-1"/>',
  redo: '<path d="M15 14l4-4-4-4"/><path d="M19 10H9a4 4 0 0 0 0 8h1"/>',
  rotateCw: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 4 21 9 16 9"/>',
  rotateCcw: '<path d="M3 12a9 9 0 1 0 2.64-6.36"/><polyline points="3 4 3 9 8 9"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  alignLeft:
    '<line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="10" x2="14" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="4" y1="20" x2="14" y2="20"/>',
  alignCenter:
    '<line x1="4" y1="5" x2="20" y2="5"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="7" y1="20" x2="17" y2="20"/>',
  alignRight:
    '<line x1="4" y1="5" x2="20" y2="5"/><line x1="10" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="20" x2="20" y2="20"/>',
  caption:
    '<rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="7" y1="20" x2="17" y2="20"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  merge: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M9 12h6"/>',
  split: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><line x1="12" y1="5" x2="12" y2="19"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.8 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.7 1.8-1.7H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="16.5" cy="11" r="1.2" fill="currentColor" stroke="none"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  h1: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M15 10.5 17.5 9v9"/>',
  h2: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M15 10a2 2 0 1 1 3.6 1.2L15 18h4"/>',
  h3: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M15 9.5a2 2 0 1 1 2.4 2.5A2 2 0 1 1 15 15"/>',
  arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/>',
  arrowDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/>',
  arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
  flipH: '<path d="M12 3v18"/><path d="M8 7 4 12l4 5V7Z"/><path d="M16 7l4 5-4 5V7Z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 8 12 4l5 4H7Z"/><path d="M7 16l5 4 5-4H7Z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>'
};
