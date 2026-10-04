// reference.webgl.ts が使う Vitest のブラウザモードのファイルの読み書き（@vitest/browser/context）の型。
// @vitest/browser は @app/render にしか入っていないので、apps/desktop の型検査ではここで使う分だけを書く。
// 動かすときは Vitest が本物を渡す（vitest.webgl.config.ts）
declare module '@vitest/browser/context' {
  type Encoding = 'utf8' | 'utf-8' | 'base64';
  export const commands: {
    // パスは設定の root（apps/desktop）からの相対
    readFile(path: string, options?: Encoding | { encoding?: Encoding }): Promise<string>;
    writeFile(path: string, content: string, options?: Encoding | { encoding?: Encoding }): Promise<void>;
  };
}
