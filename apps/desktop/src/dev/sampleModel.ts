// fixtures/sample-model（カード03）を開く。開発中の確認用
import { loadProjectJson, newId, type Mesh, type Project } from '@app/schema';
import type { Services } from '@app/contracts';
import { emitAppEvent } from '../shell/events';

const projectJson = import.meta.glob<string>('../../../../fixtures/sample-model/project.json', {
  query: '?raw',
  import: 'default',
});
const pngUrls = import.meta.glob<string>('../../../../fixtures/sample-model/assets/*.png', {
  query: '?url',
  import: 'default',
});

const BASE = '../../../../fixtures/sample-model/';

// サンプルは割り当てだけ済んだ状態でメッシュが無い。本物の変形はメッシュのあるパーツしか描かないので、ここで作る
function withMeshes(services: Services, project: Project): Project {
  const meshes: Mesh[] = [...project.model.meshes];
  const parts = project.model.parts.map((part) => {
    if (part.kind !== 'image' || part.meshId || !part.assetId) return part;
    const asset = project.assets.find((a) => a.id === part.assetId);
    const alpha = services.assets.getImageData(part.assetId);
    if (!asset || !alpha) return part;
    const mesh: Mesh = {
      id: newId(),
      ...services.meshGenerator.generate(alpha, asset.offset, 'standard'),
      density: 'standard',
      edited: false,
    };
    meshes.push(mesh);
    return { ...part, meshId: mesh.id };
  });
  return { ...project, model: { ...project.model, parts, meshes } };
}

export async function loadSampleModel(services: Services): Promise<void> {
  const loadText = projectJson[`${BASE}project.json`];
  if (!loadText) throw new Error('fixtures/sample-model/project.json が無い');
  const project = loadProjectJson(await loadText());
  await Promise.all(
    project.assets.map(async (asset) => {
      const loadUrl = pngUrls[BASE + asset.path];
      if (!loadUrl) throw new Error(`素材が無い: ${asset.path}`);
      const response = await fetch(await loadUrl());
      await services.assets.put(asset.id, new Uint8Array(await response.arrayBuffer()));
    }),
  );
  const loaded = withMeshes(services, project);
  services.store.load(loaded);
  emitAppEvent('projectLoaded', loaded);
}
