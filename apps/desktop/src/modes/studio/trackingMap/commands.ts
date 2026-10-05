// トラッキングの割り当て（I-042）。Project.trackingSetup（標準・カスタム・無効と、同じパラメータへの割り当ての
// 合わせ方）と Project.trackingMappings（カスタムの一覧）を変えるコマンド。どれも1回の Undo
import type {
  Parameter,
  Project,
  TrackingCombineMethod,
  TrackingInput,
  TrackingMapping,
  TrackingSetup,
} from '@app/schema';
import type { Command } from '@app/contracts';
import { createDefaultTrackingMappings } from '@app/tracking';

export const TRACKING_MAP_LABEL = 'トラッキングの割り当て';

export const TRACKING_INPUT_LABELS: Record<TrackingInput, string> = {
  faceYaw: '顔の左右',
  facePitch: '顔の上下',
  faceRoll: '顔の傾き',
  eyeOpenL: '左目の開き',
  eyeOpenR: '右目の開き',
  eyeBallX: '視線の左右',
  eyeBallY: '視線の上下',
  mouthOpen: '口の開き',
  mouthForm: '口の形',
  mouthWidth: '口の横幅',
  browY: '眉の上下',
};

// 入力ごとの値の範囲（既定のマッピングと同じ）。入力を選び直したら入力の範囲をこれにする
export const TRACKING_INPUT_RANGES: Record<TrackingInput, [number, number]> = {
  faceYaw: [-30, 30],
  facePitch: [-30, 30],
  faceRoll: [-30, 30],
  eyeOpenL: [0, 1],
  eyeOpenR: [0, 1],
  eyeBallX: [-1, 1],
  eyeBallY: [-1, 1],
  mouthOpen: [0, 1],
  mouthForm: [-1, 1],
  mouthWidth: [-1, 1],
  browY: [-1, 1],
};

export const COMBINE_LABELS: Record<TrackingCombineMethod, string> = {
  add: '加算（重み × 値の和）',
  average: '重み付き平均',
  priority: '優先（上の割り当て）',
};

export const TRACKING_MODE_LABELS: Record<TrackingSetup['mode'], string> = {
  standard: '標準',
  custom: 'カスタム',
  off: '無効',
};

function command(apply: (project: Project) => Project): Command {
  return { label: TRACKING_MAP_LABEL, apply };
}

function withMappings(project: Project, mappings: TrackingMapping[]): Project {
  return { ...project, trackingMappings: mappings };
}

// 既定のマッピングのうち、モデルにあるパラメータへのもの（カスタムの一覧の始まり・標準の一覧に戻すとき）
export function standardMappings(project: Project): TrackingMapping[] {
  const ids = new Set(project.model.parameters.map((p) => p.id));
  return createDefaultTrackingMappings().filter((m) => ids.has(m.parameterId));
}

// 使い方を変える。カスタムにしたとき一覧が空なら、標準の割り当てから始める（標準を足場にユーザー定義を足せるように）。
// 一覧はどの使い方でも残す
export function setModeCommand(mode: TrackingSetup['mode']): Command {
  return command((project) => {
    if (project.trackingSetup.mode === mode) return project;
    const next = { ...project, trackingSetup: { ...project.trackingSetup, mode } };
    return mode === 'custom' && project.trackingMappings.length === 0
      ? withMappings(next, standardMappings(project))
      : next;
  });
}

// カスタムの一覧を標準の割り当てに戻す（合わせ方の設定も消す）
export function resetToStandardCommand(): Command {
  return command((project) => ({
    ...withMappings(project, standardMappings(project)),
    trackingSetup: { ...project.trackingSetup, combine: [] },
  }));
}

// 足す割り当て。ユーザー定義のパラメータがあれば最初のもの、無ければ顔の左右へ、顔の左右の入力から
export function newMapping(parameters: readonly Parameter[]): TrackingMapping {
  const parameter =
    parameters.find((p) => !p.standard) ?? parameters.find((p) => p.id === 'FaceAngleX') ?? parameters[0];
  return {
    input: 'faceYaw',
    parameterId: parameter?.id ?? 'FaceAngleX',
    inputRange: [...TRACKING_INPUT_RANGES.faceYaw],
    outputRange: parameter ? [parameter.min, parameter.max] : [-30, 30],
    invert: false,
    curve: 'linear',
    smoothing: 0.5,
    deadZone: 0,
    weight: 1,
  };
}

export function addMappingCommand(): Command {
  return command((project) =>
    withMappings(project, [...project.trackingMappings, newMapping(project.model.parameters)]),
  );
}

// i 番目を変える。入力を変えたら入力の範囲をその入力の範囲に、パラメータを変えたら出力の範囲をその範囲にする
export function updateMappingCommand(index: number, patch: Partial<TrackingMapping>): Command {
  return command((project) => {
    const current = project.trackingMappings[index];
    if (!current) return project;
    let next: TrackingMapping = { ...current, ...patch };
    if (patch.input && patch.input !== current.input && !patch.inputRange) {
      next = { ...next, inputRange: [...TRACKING_INPUT_RANGES[patch.input]] };
    }
    if (patch.parameterId && patch.parameterId !== current.parameterId && !patch.outputRange) {
      const parameter = project.model.parameters.find((p) => p.id === patch.parameterId);
      if (parameter) next = { ...next, outputRange: [parameter.min, parameter.max] };
    }
    const mappings = project.trackingMappings.slice();
    mappings[index] = next;
    return withMappings(project, mappings);
  });
}

export function removeMappingCommand(index: number): Command {
  return command((project) =>
    index < 0 || index >= project.trackingMappings.length
      ? project
      : withMappings(
          project,
          project.trackingMappings.filter((_, i) => i !== index),
        ),
  );
}

// i 番目を上（−1）・下（+1）へ。優先の合わせ方では上にあるものが効く
export function moveMappingCommand(index: number, delta: -1 | 1): Command {
  return command((project) => {
    const to = index + delta;
    const list = project.trackingMappings;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return project;
    const mappings = list.slice();
    [mappings[index], mappings[to]] = [mappings[to]!, mappings[index]!];
    return withMappings(project, mappings);
  });
}

export function setCombineCommand(parameterId: string, method: TrackingCombineMethod): Command {
  return command((project) => {
    const others = project.trackingSetup.combine.filter((c) => c.parameterId !== parameterId);
    // 加算は既定なので、一覧には入れない
    const combine = method === 'add' ? others : [...others, { parameterId, method }];
    return { ...project, trackingSetup: { ...project.trackingSetup, combine } };
  });
}

export function combineOf(setup: TrackingSetup, parameterId: string): TrackingCombineMethod {
  return setup.combine.find((c) => c.parameterId === parameterId)?.method ?? 'add';
}

// 2つ以上の割り当てがあるパラメータ（一覧の順）
export function sharedParameters(project: Project): string[] {
  const count = new Map<string, number>();
  for (const m of project.trackingMappings) count.set(m.parameterId, (count.get(m.parameterId) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([id]) => id);
}
