import type { CurveGuide, Project } from '@app/schema';
import type { DeformedModel, HairContact, HairContacts } from '@app/contracts';
import { curveMeshSignature, meshPointsToDisplay, meshPointStretch } from '../deform/curveGuide';
import { closestSegments } from './contact';

export function shoulderHostReason(project: Pick<Project, 'model'>, partId: string): string | undefined {
  const part = project.model.parts.find((p) => p.id === partId);
  const mesh = project.model.meshes.find((m) => m.id === part?.meshId);
  if (part?.kind !== 'image' || !mesh?.triangles.length) return 'メッシュのある体・服の画像パーツを選んでください。';
  if (project.model.curveGuides?.some((g) => g.partId === partId && g.enabled && (g.gravity || g.dynamics?.enabled)))
    return '重力や流れ揺れを使うパーツには肩の線を取り付けられません。';
  return undefined;
}
export function evaluateShoulders(project: Project, actual: DeformedModel) {
  const active = new Map<string, HairContact>();
  const diagnostics = new Map<string, string>();
  for (const collider of project.model.shoulderColliders ?? []) {
    if (!collider.enabled) continue;
    const mesh = project.model.meshes.find((m) => m.id === collider.meshId);
    const host = project.model.parts.find((p) => p.id === collider.partId);
    const reason = shoulderHostReason(project, collider.partId);
    if (reason || host?.meshId !== collider.meshId || !mesh || curveMeshSignature(mesh) !== collider.meshSignature) {
      diagnostics.set(collider.id, reason ?? '肩のメッシュが変わりました。肩の線を描き直してください。');
      continue;
    }
    const item = actual.byPartId[collider.partId];
    if (!item) continue; // visibility, never opacity
    const stretch = meshPointStretch(mesh, item.positions, collider.points);
    const points = meshPointsToDisplay(mesh, item.positions, collider.points);
    if (!stretch || points.some((p) => !Number.isFinite(p.x + p.y))) {
      diagnostics.set(collider.id, '肩の取付先がつぶれています。体のキーやメッシュを確認してください。');
      continue;
    }
    active.set(collider.id, { id: collider.id, points, radius: collider.radius * stretch });
  }
  return { active, diagnostics };
}
export function guideContacts(guide: CurveGuide, shoulders: ReturnType<typeof evaluateShoulders>, width: number) {
  const diagnostics = (guide.collision?.colliderIds ?? []).flatMap((id) => {
    const reason = shoulders.diagnostics.get(id);
    return reason ? [{ colliderId: id, reason }] : [];
  });
  const contacts: HairContacts = {
    radius: width * (guide.collision?.thickness ?? 1),
    colliders: (guide.collision?.colliderIds ?? []).flatMap((id) =>
      shoulders.active.get(id) ? [shoulders.active.get(id)!] : [],
    ),
  };
  return { contacts, diagnostics };
}
// Test the filled free mesh, including capsule endpoints wholly inside a triangle.
export function meshContactsFit(
  positions: Float32Array,
  triangles: [number, number, number][],
  contacts: HairContacts,
): boolean {
  return meshContactPenetration(positions, triangles, contacts) <= 1e-4;
}
export function meshContactPenetration(
  positions: Float32Array,
  triangles: [number, number, number][],
  contacts: HairContacts,
): number {
  const point = (i: number) => ({ x: positions[i * 2]!, y: positions[i * 2 + 1]! });
  const inside = (p: { x: number; y: number }, vertices: ReturnType<typeof point>[]) => {
    const signs = vertices.map((a, i) => {
      const b = vertices[(i + 1) % 3]!;
      return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    });
    return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
  };
  let penetration = 0;
  for (const indices of triangles) {
    const vertices = indices.map(point);
    for (const c of contacts.colliders)
      for (let k = 1; k < c.points.length; k++) {
        const a = c.points[k - 1]!,
          b = c.points[k]!;
        if (inside(a, vertices) || inside(b, vertices)) penetration = Math.max(penetration, c.radius);
        for (let i = 0; i < vertices.length; i++)
          penetration = Math.max(
            penetration,
            c.radius - closestSegments(vertices[i]!, vertices[(i + 1) % 3]!, a, b).distance,
          );
      }
  }
  return penetration;
}
