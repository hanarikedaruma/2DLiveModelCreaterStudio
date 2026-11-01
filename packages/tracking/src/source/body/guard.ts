// Worker の中で、ページの外への fetch と XHR を止める（AT-04）。
// MediaPipe は推定器を閉じたときと60秒ごとに利用状況を fetch で送ろうとする（AT-01 の NetLog で確認）。
// Worker を blob の URL で包んでページの CSP を引き継がせるのが本命で、これは CSP が効かなかったときの二重の備え。

export interface NetAttempt {
  url: string;
  method: string;
}

export interface GuardScope {
  fetch: typeof fetch;
  location: { href: string };
  XMLHttpRequest?: { prototype: { open: (...args: never[]) => unknown } };
}

// ページと同じ起点か。blob の URL（blob:http://…）の起点は、作ったページの起点になる
function sameOrigin(url: URL, base: string): boolean {
  return url.origin === new URL(base).origin;
}

export function installNetworkGuard(scope: GuardScope, report: (attempt: NetAttempt) => void): void {
  const base = scope.location.href;
  const nativeFetch = scope.fetch.bind(scope);
  scope.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'object' && 'url' in input ? input.url : String(input), base);
    if (!sameOrigin(url, base)) {
      report({ url: url.origin + url.pathname, method: init?.method ?? 'GET' });
      return Promise.reject(new TypeError('アプリの外への通信は止めている'));
    }
    return nativeFetch(input, init);
  }) as typeof fetch;
  const prototype = scope.XMLHttpRequest?.prototype as
    { open: (method: string, url: string | URL, ...rest: unknown[]) => unknown } | undefined;
  if (!prototype) return;
  const nativeOpen = prototype.open;
  prototype.open = function (this: unknown, method: string, url: string | URL, ...rest: unknown[]) {
    const target = new URL(String(url), base);
    if (!sameOrigin(target, base)) {
      report({ url: target.origin + target.pathname, method });
      throw new TypeError('アプリの外への通信は止めている');
    }
    return nativeOpen.call(this, method, url, ...rest);
  };
}
