// cdt2d（制約付きドロネー三角形分割）の型。パッケージに型が無いので、ここに1つだけ置く。
// 使うファイルの先頭で `/// <reference path="<repo>/types/cdt2d.d.ts" />` を相対パスで書く
// （どの TypeScript のプロジェクトから読まれても、同じ宣言が1つだけ入るようにするため）
declare module 'cdt2d' {
  interface Cdt2dOptions {
    delaunay?: boolean; // ドロネー条件を満たすように辺を入れ替える（既定 true）
    interior?: boolean; // 制約の辺で囲まれた内側の三角形を返す（既定 true）
    exterior?: boolean; // 外側の三角形を返す（既定 true。輪郭の外を捨てるときは false）
    infinity?: boolean; // 無限遠点を含む三角形を返す（既定 false）
  }
  function cdt2d(points: [number, number][], options?: Cdt2dOptions): [number, number, number][];
  function cdt2d(
    points: [number, number][],
    edges: [number, number][],
    options?: Cdt2dOptions,
  ): [number, number, number][];
  export default cdt2d;
}
