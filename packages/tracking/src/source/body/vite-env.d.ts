// Vite の ?worker&url（Worker を別のファイルに組み立て、その URL を返す）
declare module '*?worker&url' {
  const url: string;
  export default url;
}
