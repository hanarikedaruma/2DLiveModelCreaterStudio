// ショートカットの文字列（例: 'Ctrl+Shift+Z'）とキーボードイベントの照合

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

interface Shortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // 小文字
}

export function parseShortcut(text: string): Shortcut {
  const parts = text.split('+').map((s) => s.trim());
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    ctrl: mods.has('ctrl') || mods.has('cmd') || mods.has('meta'),
    shift: mods.has('shift'),
    alt: mods.has('alt'),
    key: key.toLowerCase(),
  };
}

export function matchesShortcut(e: KeyLike, text: string): boolean {
  const s = parseShortcut(text);
  return (
    (e.ctrlKey || e.metaKey) === s.ctrl && e.shiftKey === s.shift && e.altKey === s.alt && e.key.toLowerCase() === s.key
  );
}

// 入力欄で打っているときはショートカットを横取りしない
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const editable = el.closest('[contenteditable]');
  if (editable && editable.getAttribute('contenteditable') !== 'false') return true;
  if (el.tagName.toLowerCase() === 'textarea') return true;
  if (el.tagName.toLowerCase() !== 'input') return false;
  return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes((el as HTMLInputElement).type);
}
