// ULID（時刻 48bit + 乱数 80bit を Crockford の base32 で 26 文字にしたもの）。
// 同じミリ秒に続けて作ったときは乱数部を 1 ずつ増やし、作った順に並ぶようにする。

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

function randomSource(): RandomSource {
  const source = (globalThis as { crypto?: RandomSource }).crypto;
  if (!source) throw new Error('crypto.getRandomValues が使えない環境では ID を作れない');
  return source;
}

let lastTime = -1;
let lastRandom: number[] = [];

function freshRandom(): number[] {
  const bytes = randomSource().getRandomValues(new Uint8Array(RANDOM_LENGTH));
  return Array.from(bytes, (b) => b & 31);
}

// 末尾から 1 を足す。桁あふれしたら false
function increment(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i]!;
    if (d < 31) {
      digits[i] = d + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

function encodeTime(time: number): string {
  let t = time;
  let out = '';
  for (let i = 0; i < TIME_LENGTH; i++) {
    out = ENCODING[t % 32]! + out;
    t = Math.floor(t / 32);
  }
  return out;
}

export function newId(): string {
  let now = Date.now();
  if (now <= lastTime) {
    // 同じミリ秒（または時計が戻った）。前の値の続きにする
    now = lastTime;
    if (!increment(lastRandom)) lastRandom = freshRandom();
  } else {
    lastTime = now;
    lastRandom = freshRandom();
  }
  return encodeTime(now) + lastRandom.map((d) => ENCODING[d]!).join('');
}
