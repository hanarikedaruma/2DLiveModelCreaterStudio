// Tauri の WebView の中で JS を評価する（開発中の確認用）。
// 使い方: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 を付けて pnpm tauri dev を起動し、
//   node tools/dev/cdp-eval.mjs "window.__studio.services.store.get().name"
const expr = process.argv[2] ?? 'document.title';
const port = process.env.CDP_PORT ?? '9223';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page =
  targets.find((t) => t.type === 'page' && /localhost:1420|tauri\.localhost/.test(t.url) && !/\/output/.test(t.url)) ??
  targets.find((t) => t.type === 'page');
if (!page) {
  console.log(JSON.stringify(targets, null, 2));
  throw new Error('no page target');
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const send = (method, params) =>
  new Promise((resolve) => {
    const myId = ++id;
    const onMessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === myId) {
        ws.removeEventListener('message', onMessage);
        resolve(msg);
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
const res = await send('Runtime.evaluate', {
  expression: `(async () => { ${expr.includes('return') ? expr : `return (${expr})`} })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log(
  JSON.stringify(
    {
      url: page.url,
      result: res.result?.result?.value,
      exception: res.result?.exceptionDetails?.exception?.description,
    },
    null,
    2,
  ),
);
ws.close();
