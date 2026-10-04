// ホットキーのキーの文字列（例: 'Ctrl+Shift+1'）の読み書き。
// 保存する形は「修飾キー（Ctrl・Alt・Shift・Win の順）+ キー」。global-shortcut に渡すときは toAccelerator で変える

export type Modifier = 'Ctrl' | 'Alt' | 'Shift' | 'Win';

// code は KeyboardEvent.code の値（'Digit1'・'KeyA'・'F1' など）。global-shortcut もこの名前で受け付ける
export interface ParsedKeys {
  modifiers: Modifier[];
  code: string;
}

const MODIFIER_ORDER: Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Win'];

// global-shortcut（global-hotkey）の書き方。Windows キーは Super
const ACCELERATOR_MODIFIER: Record<Modifier, string> = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Win: 'Super' };

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  commandorctrl: 'Ctrl',
  cmdorctrl: 'Ctrl',
  cmdorcontrol: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  win: 'Win',
  super: 'Win',
  meta: 'Win',
  cmd: 'Win',
  command: 'Win',
};

// global-shortcut が受け付けるキー（CapsLock・NumLock は切り替えのキーなので外す）
const SUPPORTED_CODES: string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
  ...'0123456789'.split('').map((d) => `Digit${d}`),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ...'0123456789'.split('').map((d) => `Numpad${d}`),
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
  'NumpadEqual',
  'Backquote',
  'Backslash',
  'BracketLeft',
  'BracketRight',
  'Comma',
  'Equal',
  'Minus',
  'Period',
  'Quote',
  'Semicolon',
  'Slash',
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
  'Pause',
  'ScrollLock',
  'PrintScreen',
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute',
  'MediaPlayPause',
  'MediaStop',
  'MediaTrackNext',
  'MediaTrackPrevious',
];
const SUPPORTED = new Set(SUPPORTED_CODES);

// 画面に出す名前（KeyA → A、Digit1 → 1、Numpad1 → Num1、ArrowUp → Up、Escape → Esc）
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5);
  if (code === 'Escape') return 'Esc';
  return code;
}

const SYMBOL_ALIASES: Record<string, string> = {
  '`': 'Backquote',
  '\\': 'Backslash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
  '=': 'Equal',
  '-': 'Minus',
  '.': 'Period',
  "'": 'Quote',
  ';': 'Semicolon',
  '/': 'Slash',
  return: 'Enter',
  del: 'Delete',
  numpadplus: 'NumpadAdd',
  numplus: 'NumpadAdd',
};

// 小文字の名前 → code（code そのもの・画面の名前・記号のどれでも読む）
const KEY_ALIASES = new Map<string, string>();
for (const code of SUPPORTED_CODES) {
  KEY_ALIASES.set(code.toLowerCase(), code);
  KEY_ALIASES.set(keyLabel(code).toLowerCase(), code);
}
for (const [alias, code] of Object.entries(SYMBOL_ALIASES)) KEY_ALIASES.set(alias, code);

// 読めなければ null。修飾キーの大文字・小文字と順番は問わない（'shift+ctrl+1' も読む）
export function parseKeys(text: string): ParsedKeys | null {
  const tokens = text.split('+').map((t) => t.trim());
  if (tokens.some((t) => t === '')) return null;
  const keyToken = tokens.pop();
  if (keyToken === undefined) return null;
  const mods = new Set<Modifier>();
  for (const token of tokens) {
    const m = MODIFIER_ALIASES[token.toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const code = KEY_ALIASES.get(keyToken.toLowerCase());
  if (!code) return null;
  return { modifiers: MODIFIER_ORDER.filter((m) => mods.has(m)), code };
}

// 保存・表示する形（例: 'Ctrl+Shift+1'）
export function formatKeys(keys: ParsedKeys): string {
  return [...keys.modifiers, keyLabel(keys.code)].join('+');
}

// 同じキーかを比べるための形。読めなければ null
export function normalizeKeys(text: string): string | null {
  const parsed = parseKeys(text);
  return parsed ? formatKeys(parsed) : null;
}

// global-shortcut に渡す形（例: 'Control+Shift+Digit1'）
export function toAccelerator(keys: ParsedKeys): string {
  return [...keys.modifiers.map((m) => ACCELERATOR_MODIFIER[m]), keys.code].join('+');
}

// 単独で割り当ててよいキー（ふだんの入力に使わないもの）。ほかは Ctrl・Alt・Win のどれかと組み合わせる
const STANDALONE = /^(F([1-9]|1[0-9]|2[0-4])|Numpad.+|Pause|ScrollLock|Audio.+|Media.+)$/;

export function needsModifier(keys: ParsedKeys): boolean {
  if (STANDALONE.test(keys.code)) return false;
  return !keys.modifiers.some((m) => m !== 'Shift');
}

// ---- キーを押して記録する ----

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type RecordResult =
  | { type: 'partial'; text: string } // 修飾キーだけ押している（例: 'Ctrl+Shift+…'）
  | { type: 'done'; keys: string; parsed: ParsedKeys }
  | { type: 'unsupported'; text: string }; // 使えないキー

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper']);

function modifiersOf(e: KeyLike): Modifier[] {
  const on: Record<Modifier, boolean> = { Ctrl: e.ctrlKey, Alt: e.altKey, Shift: e.shiftKey, Win: e.metaKey };
  return MODIFIER_ORDER.filter((m) => on[m]);
}

export function recordKeys(e: KeyLike): RecordResult {
  const modifiers = modifiersOf(e);
  if (MODIFIER_KEYS.has(e.key) || /^(Control|Shift|Alt|Meta|OS)(Left|Right)$/.test(e.code)) {
    return { type: 'partial', text: modifiers.length > 0 ? `${modifiers.join('+')}+…` : '' };
  }
  if (!SUPPORTED.has(e.code)) {
    const name = e.key && e.key !== 'Unidentified' ? e.key : e.code || '?';
    return { type: 'unsupported', text: [...modifiers, name].join('+') };
  }
  const parsed = { modifiers, code: e.code };
  return { type: 'done', keys: formatKeys(parsed), parsed };
}
