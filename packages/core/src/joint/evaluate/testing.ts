// カメラ・キャラクター素材を使わない幾何の見本。生成スクリプトと数値試験が同じ保存形式を使う。
import {
  armParameterIds,
  armParameters,
  createEmptyProject,
  defaultArmLimits,
  defaultArmTrackingSettings,
  type ArmPose,
  type ArmRig,
  type ArmSide,
  type Part,
  type Project,
  type Vec2,
} from '@app/schema';
import { forwardArmInModel } from '../math';

export function makeArmFixture(reference: ArmPose = { shoulder: 0, elbow: 0, wrist: 0 }): Project {
  const project = createEmptyProject('腕・手の技術見本');
  const part = (id: string, kind: Part['kind'], parentId: string | null): Part => ({
    id,
    kind,
    parentId,
    name: id,
    standardType: null,
    assetId: kind === 'image' ? 'arm-tech' : null,
    meshId: kind === 'image' ? id : null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
  });
  project.model.parts.push(part('body-root', 'group', null));
  project.armTracking = defaultArmTrackingSettings();
  project.model.armRigs = [];
  const image = (id: string, parent: string, vertices: Vec2[]) => {
    project.model.parts.push(part(id, 'image', parent));
    project.model.meshes.push({
      id,
      vertices,
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
      density: 'custom',
      edited: false,
    });
    project.model.drawOrder.push(id);
  };
  const quad = (a: Vec2, b: Vec2, width: number): Vec2[] => {
    const d = Math.hypot(b.x - a.x, b.y - a.y),
      x = (-(b.y - a.y) / d) * width,
      y = ((b.x - a.x) / d) * width;
    return [
      { x: a.x + x, y: a.y + y },
      { x: b.x + x, y: b.y + y },
      { x: b.x - x, y: b.y - y },
      { x: a.x - x, y: a.y - y },
    ];
  };
  for (const side of ['L', 'R'] as ArmSide[]) {
    const shoulder = { x: side === 'L' ? 378 : 222, y: 240 };
    const rig: ArmRig = {
      id: `arm-${side}`,
      side,
      enabled: true,
      parentPartId: 'body-root',
      groups: { shoulder: `shoulder-${side}`, elbow: `elbow-${side}`, wrist: `wrist-${side}` },
      joints: { shoulder, elbow: shoulder, wrist: shoulder },
      lengths: { upper: 118, lower: 108 },
      bendSign: 1,
      referencePose: { ...reference },
      restPose: { shoulder: 8, elbow: 12, wrist: 0 },
      limits: defaultArmLimits(),
      hands: {},
      restHand: 'open',
      parameters: armParameterIds(side),
    };
    rig.joints = forwardArmInModel(rig, reference);
    project.model.parts.push(
      part(rig.groups.shoulder, 'group', 'body-root'),
      part(rig.groups.elbow, 'group', rig.groups.shoulder),
      part(rig.groups.wrist, 'group', rig.groups.elbow),
    );
    image(`upper-${side}`, rig.groups.shoulder, quad(rig.joints.shoulder, rig.joints.elbow, 9));
    image(`lower-${side}`, rig.groups.elbow, quad(rig.joints.elbow, rig.joints.wrist, 8));
    for (const [i, shape] of (['open', 'fist', 'point', 'peace'] as const).entries()) {
      const id = `${shape}-${side}`,
        w = rig.joints.wrist;
      image(id, rig.groups.wrist, [
        { x: w.x - 10, y: w.y },
        { x: w.x + 10, y: w.y },
        { x: w.x + 10, y: w.y - 25 - i * 3 },
        { x: w.x - 10, y: w.y - 25 - i * 3 },
      ]);
      rig.hands[shape] = { partIds: [id], wrist: { ...w }, fingerDirection: { x: 0, y: -1 } };
    }
    project.model.parameters.push(...armParameters(rig));
    project.model.armRigs.push(rig);
  }
  // 前腕と手を顔の前へ置くための固定順。代表の顔は追従しない。
  image('face', 'body-root', [
    { x: 250, y: 100 },
    { x: 350, y: 100 },
    { x: 350, y: 220 },
    { x: 250, y: 220 },
  ]);
  project.model.drawOrder = [
    'upper-L',
    'upper-R',
    'face',
    'lower-L',
    'lower-R',
    ...project.model.drawOrder.filter((id) => /^(open|fist|point|peace)-/.test(id)),
  ];
  return project;
}
