import { newId } from './ids';
import { SCHEMA_VERSION } from './migrate';
import { PARAMETER_GROUPS, standardParametersFor, type StandardPhase } from './rules';
import type { Environment, Model, Project, Scene } from './types';

export function createEmptyScene(name: string): Scene {
  return {
    id: newId(),
    name,
    background: { type: 'transparent' },
    modelTransform: { position: { x: 0, y: 0 }, scale: 1 },
    expressionIds: [],
    periodicAnimationIds: [],
  };
}

// MVP の標準パラメータと全パラメータグループ入り。studio は空のシーン1つ
export function createEmptyProject(name: string): Project {
  const scene = createEmptyScene('シーン 1');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    assets: [],
    model: {
      parts: [],
      meshes: [],
      warps: [],
      drawOrder: [],
      parameters: standardParametersFor('mvp').map((p) => ({ ...p })),
      parameterGroups: PARAMETER_GROUPS.map((g) => ({ ...g })),
      bindings: [],
      lipSync: { mouthSource: 'max', strength: 'standard', vowels: [] },
      setupHints: { closedLineL: null, closedLineR: null },
    },
    expressions: [],
    animations: [],
    physics: [],
    trackingMappings: [],
    studio: { scenes: [scene], activeSceneId: scene.id, hotkeys: [] },
  };
}

// 足りない標準パラメータだけを表の順に末尾へ足す（'step1' は MVP と STEP1、'step2' はすべて）。
// 足したパラメータのグループが無ければそれも足す。何も足さないときは同じ参照を返す
export function ensureStandardParameters(model: Model, phase: StandardPhase): Model {
  const have = new Set(model.parameters.map((p) => p.id));
  const missing = standardParametersFor(phase).filter((p) => !have.has(p.id));
  if (missing.length === 0) return model;

  const haveGroups = new Set(model.parameterGroups.map((g) => g.id));
  const neededGroups = PARAMETER_GROUPS.filter((g) => !haveGroups.has(g.id) && missing.some((p) => p.groupId === g.id));
  return {
    ...model,
    parameters: [...model.parameters, ...missing.map((p) => ({ ...p }))],
    parameterGroups: neededGroups.length
      ? [...model.parameterGroups, ...neededGroups.map((g) => ({ ...g }))]
      : model.parameterGroups,
  };
}

// PC ごとの設定の既定値
export function createDefaultEnvironment(): Environment {
  return {
    cameraDeviceId: null,
    cameraCapture: { mode: 'auto', width: 640, height: 480, fps: 60 },
    mirror: true,
    calibration: null,
    microphoneDeviceId: null,
    silenceThreshold: -50,
    trackingPreset: 'standard',
    eyeTracking: true,
    trackingCustom: { minCutoff: 1, beta: 0.02, gain: 1, deadZone: 0.5 },
    bodyFollowStrength: 'standard',
    expressionMode: 'stack',
    output: { method: 'window', width: 1920, height: 1080, fps: 60 },
    uiLevel: { modeling: 'easy', animation: 'easy', studio: 'easy' },
    lastProjectDir: null,
  };
}
