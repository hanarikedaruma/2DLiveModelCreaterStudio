// 素材のサムネイル。PNG を object URL（無い環境では data URL）にして <img> で出す
import { useEffect, useState } from 'react';
import type { AssetRepository } from '@app/contracts';

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function pngToUrl(png: Uint8Array): { url: string; revoke(): void } {
  if (typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  return { url: `data:image/png;base64,${bytesToBase64(png)}`, revoke: () => {} };
}

// assets.put のたびに描き直すための番号
export function useAssetRepoVersion(repo: AssetRepository): number {
  const [version, setVersion] = useState(0);
  useEffect(() => repo.subscribe(() => setVersion((v) => v + 1)), [repo]);
  return version;
}

function usePngUrl(png: Uint8Array | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!png) {
      setUrl(null);
      return;
    }
    const made = pngToUrl(png);
    setUrl(made.url);
    return made.revoke;
  }, [png]);
  return url;
}

export function AssetThumb({ repo, assetId, alt }: { repo: AssetRepository; assetId: string; alt: string }) {
  useAssetRepoVersion(repo);
  const url = usePngUrl(repo.getPng(assetId));
  return (
    <span className="asset-thumb">
      {url ? <img src={url} alt={alt} draggable={false} /> : <span className="asset-thumb-empty" aria-hidden />}
    </span>
  );
}
