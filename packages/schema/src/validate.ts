import { z } from 'zod';
import { BLEND_MODES, BLEND_OPS, PARAMETER_GROUP_IDS, STANDARD_PART_TYPES, TRACKING_INPUTS } from './rules';
import type {
  Animation,
  Asset,
  Binding,
  Environment,
  Expression,
  Hotkey,
  LipSync,
  Mesh,
  Model,
  Parameter,
  ParameterGroup,
  ParameterKey,
  Part,
  Physics,
  Project,
  Scene,
  TrackingMapping,
  TransformDelta,
  Vec2,
  Warp,
} from './types';

// ---- 検証の失敗 ----

export interface ValidationIssue {
  path: string; // 例: model.parts[3].pivot.x
  message: string;
}

export class ProjectValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(what: string, issues: ValidationIssue[]) {
    const shown = issues.slice(0, 5).map((i) => `${i.path || '(全体)'}: ${i.message}`);
    if (issues.length > shown.length) shown.push(`ほか ${issues.length - shown.length} 件`);
    super(`${what}の形が正しくない\n${shown.join('\n')}`);
    this.name = 'ProjectValidationError';
    this.issues = issues;
  }
}

// ['model', 'parts', 3, 'pivot', 'x'] → 'model.parts[3].pivot.x'
export function formatPath(path: (string | number)[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(key)) out += out ? `.${key}` : key;
    else out += `[${JSON.stringify(key)}]`;
  }
  return out;
}

const TYPE_NAMES: Record<string, string> = {
  string: '文字列',
  number: '数値',
  nan: 'NaN',
  integer: '整数',
  boolean: '真偽値',
  object: 'オブジェクト',
  array: '配列',
  null: 'null',
  undefined: '無し',
};
const typeName = (t: string) => TYPE_NAMES[t] ?? t;

const errorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: `必須の項目が無い（${typeName(issue.expected)}）` };
      return { message: `${typeName(issue.expected)}であるべきところが${typeName(issue.received)}` };
    case z.ZodIssueCode.invalid_literal:
      return { message: `${JSON.stringify(issue.expected)} であるべき` };
    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `${issue.options.map((o) => JSON.stringify(o)).join(' / ')} のどれかであるべきところが ${JSON.stringify(issue.received)}`,
      };
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `${issue.options.map((o) => JSON.stringify(o)).join(' / ')} のどれかであるべき` };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'array') return { message: `要素が ${issue.minimum} 個以上であるべき` };
      if (issue.type === 'string') return { message: '空にできない' };
      return { message: `${issue.inclusive ? '' : 'より大きい、'}${issue.minimum} 以上であるべき` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'array') return { message: `要素が ${issue.maximum} 個以下であるべき` };
      return { message: `${issue.maximum} 以下であるべき` };
    case z.ZodIssueCode.not_finite:
      return { message: '有限の数値であるべき' };
    case z.ZodIssueCode.invalid_union:
      return { message: 'どの形にも合わない' };
    default:
      return { message: ctx.defaultError };
  }
};

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: formatPath(i.path), message: i.message }));
}

// ---- 部品のスキーマ ----

const id = z.string().min(1);
const num = z.number().finite();
const unit = num.min(0).max(1); // 0..1
const nonNegative = num.min(0);

const vec2: z.ZodType<Vec2> = z.object({ x: num, y: num });
const blendMode = z.enum(BLEND_MODES);
const parameterGroupId = z.enum(PARAMETER_GROUP_IDS);

const asset: z.ZodType<Asset> = z.object({
  id,
  path: z.string().min(1),
  hash: z.string(),
  width: nonNegative,
  height: nonNegative,
  offset: vec2,
  canvasSize: z.object({ width: nonNegative, height: nonNegative }),
  source: z.object({
    kind: z.enum(['psd', 'png']),
    file: z.string(),
    layerName: z.string().optional(),
    layerPath: z.array(z.string()).optional(),
    hidden: z.boolean().optional(),
  }),
  sourceBlendMode: blendMode,
  sourceOpacity: unit,
});

const part: z.ZodType<Part> = z.object({
  id,
  name: z.string(),
  kind: z.enum(['image', 'group']),
  standardType: z.enum(STANDARD_PART_TYPES).nullable(),
  assetId: id.nullable(),
  meshId: id.nullable(),
  parentId: id.nullable(),
  position: vec2,
  rotation: num,
  scale: vec2,
  pivot: vec2,
  opacity: unit,
  blendMode,
  depth: num,
  mask: z.object({ sourcePartIds: z.array(id), inverted: z.boolean() }).nullable(),
  physicsId: id.nullable(),
  visible: z.boolean(),
  locked: z.boolean(),
});

const mesh: z.ZodType<Mesh> = z
  .object({
    id,
    vertices: z.array(vec2),
    uvs: z.array(vec2),
    triangles: z.array(z.tuple([num.int().min(0), num.int().min(0), num.int().min(0)])),
    density: z.enum(['light', 'standard', 'smooth', 'custom']),
    edited: z.boolean(),
  })
  .superRefine((m, ctx) => {
    if (m.uvs.length !== m.vertices.length) {
      ctx.addIssue({ code: 'custom', path: ['uvs'], message: `頂点（${m.vertices.length} 個）と同じ数であるべき` });
    }
    m.triangles.forEach((t, i) => {
      t.forEach((v, j) => {
        if (v >= m.vertices.length) {
          ctx.addIssue({ code: 'custom', path: ['triangles', i, j], message: `頂点の番号が範囲外（${v}）` });
        }
      });
    });
  });

const warp: z.ZodType<Warp> = z
  .object({
    id,
    partId: id,
    columns: num.int().min(1),
    rows: num.int().min(1),
    bounds: z.object({ x: num, y: num, width: nonNegative, height: nonNegative }),
    points: z.array(vec2),
  })
  .superRefine((w, ctx) => {
    const expected = (w.columns + 1) * (w.rows + 1);
    if (w.points.length !== expected) {
      ctx.addIssue({ code: 'custom', path: ['points'], message: `(columns+1)×(rows+1) = ${expected} 個であるべき` });
    }
  });

const parameterGroup: z.ZodType<ParameterGroup> = z.object({ id: parameterGroupId, name: z.string() });

const parameter: z.ZodType<Parameter> = z
  .object({
    id,
    name: z.string(),
    groupId: parameterGroupId,
    min: num,
    max: num,
    default: num,
    standard: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (!(p.min < p.max)) ctx.addIssue({ code: 'custom', path: ['max'], message: 'min より大きいべき' });
    if (p.default < p.min || p.default > p.max) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: 'min 〜 max の範囲であるべき' });
    }
  });

const transformDelta: z.ZodType<TransformDelta> = z.object({
  position: vec2,
  rotation: num,
  scale: vec2,
  opacity: num,
});

const parameterKey: z.ZodType<ParameterKey> = z.object({
  coords: z.array(num),
  delta: z.union([transformDelta, z.array(vec2)]),
  source: z.enum(['manual', 'auto', 'generated', 'combined']),
  locked: z.boolean(),
});

const TARGET_TYPE_OF_CHANNEL = { transform: 'part', vertices: 'mesh', warpPoints: 'warp' } as const;

const binding: z.ZodType<Binding> = z
  .object({
    id,
    target: z.object({ type: z.enum(['part', 'mesh', 'warp']), id }),
    channel: z.enum(['transform', 'vertices', 'warpPoints']),
    parameterIds: z.array(id).min(1).max(2),
    keyValues: z.array(z.array(num)),
    keys: z.array(parameterKey),
    generation: z.enum(['linear', 'depth', 'rotate', 'surface', 'ease']),
    divisions: num.int().min(1).nullable(),
    controlsOpacity: z.boolean().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.target.type !== TARGET_TYPE_OF_CHANNEL[b.channel]) {
      ctx.addIssue({
        code: 'custom',
        path: ['target', 'type'],
        message: `channel '${b.channel}' の対象は '${TARGET_TYPE_OF_CHANNEL[b.channel]}' であるべき`,
      });
    }
    if (b.controlsOpacity && b.channel !== 'transform') {
      ctx.addIssue({ code: 'custom', path: ['controlsOpacity'], message: 'transform のバインディングでだけ使える' });
    }
    const n = b.parameterIds.length;
    if (b.keyValues.length !== n) {
      ctx.addIssue({ code: 'custom', path: ['keyValues'], message: `parameterIds と同じ数（${n}）であるべき` });
    }
    b.keyValues.forEach((values, i) => {
      for (let j = 1; j < values.length; j++) {
        if (values[j]! <= values[j - 1]!) {
          ctx.addIssue({ code: 'custom', path: ['keyValues', i, j], message: '昇順であるべき' });
          break;
        }
      }
    });
    b.keys.forEach((k, i) => {
      if (k.coords.length !== n) {
        ctx.addIssue({
          code: 'custom',
          path: ['keys', i, 'coords'],
          message: `parameterIds と同じ数（${n}）であるべき`,
        });
      }
      const isTransform = !Array.isArray(k.delta);
      if (isTransform !== (b.channel === 'transform')) {
        ctx.addIssue({
          code: 'custom',
          path: ['keys', i, 'delta'],
          message: b.channel === 'transform' ? 'TransformDelta であるべき' : '頂点・制御点ごとの差分（配列）であるべき',
        });
      }
      // 不透明度のバインディングのキーの opacity は、パーツ自身の不透明度（絶対値）
      if (b.controlsOpacity && isTransform) {
        const opacity = (k.delta as TransformDelta).opacity;
        if (opacity < 0 || opacity > 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['keys', i, 'delta', 'opacity'],
            message: '不透明度のバインディングでは 0..1 であるべき',
          });
        }
      }
    });
  });

const lipSync: z.ZodType<LipSync> = z.object({
  mouthSource: z.enum(['max', 'micOnly', 'cameraOnly']),
  strength: z.enum(['low', 'standard', 'high']),
  vowels: z.array(z.object({ vowel: z.enum(['closed', 'a', 'i', 'u', 'e', 'o']), values: z.record(z.string(), num) })),
});

function uniqueIds<T extends { id: string }>(items: T[], path: string, ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id))
      ctx.addIssue({ code: 'custom', path: [path, i, 'id'], message: `id が重複している（${item.id}）` });
    seen.add(item.id);
  });
}

const model: z.ZodType<Model> = z
  .object({
    parts: z.array(part),
    meshes: z.array(mesh),
    warps: z.array(warp),
    drawOrder: z.array(id),
    parameters: z.array(parameter),
    parameterGroups: z.array(parameterGroup),
    bindings: z.array(binding),
    lipSync,
    setupHints: z.object({ closedLineL: z.array(vec2).nullable(), closedLineR: z.array(vec2).nullable() }),
  })
  .superRefine((m, ctx) => {
    uniqueIds(m.parts, 'parts', ctx);
    uniqueIds(m.meshes, 'meshes', ctx);
    uniqueIds(m.warps, 'warps', ctx);
    uniqueIds(m.parameters, 'parameters', ctx);
    uniqueIds(m.bindings, 'bindings', ctx);
  });

const expression: z.ZodType<Expression> = z.object({
  id,
  name: z.string(),
  entries: z.array(z.object({ parameterId: id, value: num, blend: z.enum(BLEND_OPS) })),
  fadeIn: nonNegative,
  fadeOut: nonNegative,
});

const animation: z.ZodType<Animation> = z.object({
  id,
  name: z.string(),
  duration: nonNegative,
  speed: nonNegative,
  loop: z.boolean(),
  periodic: z.boolean(),
  tracks: z.array(
    z.object({
      parameterId: id,
      keyframes: z.array(z.object({ time: nonNegative, value: num, curve: z.enum(['linear', 'smooth', 'step']) })),
    }),
  ),
  affectedGroups: z.array(parameterGroupId),
  restart: z.enum(['restart', 'ignore']),
  transition: z.object({
    preset: z.enum(['auto', 'quick', 'natural', 'slow', 'custom']),
    blendIn: nonNegative,
    blendOut: nonNegative,
    curve: z.enum(['linear', 'smooth']),
    blendMode: z.enum(['override', 'addToTracking']),
    keepLipSync: z.boolean(),
    keepPhysics: z.boolean(),
    returnToTracking: z.boolean(),
  }),
});

const physics: z.ZodType<Physics> = z.object({
  id,
  partId: id,
  preset: z.enum(['hair', 'cloth', 'ribbon', 'accessory']),
  strength: unit,
  direction: z.enum(['horizontal', 'vertical', 'both']),
  length: nonNegative,
  spring: num,
  damping: num,
  gravity: num,
  inertia: num,
  range: num,
  inputs: z.array(z.object({ parameterId: id, weight: num })),
  outputParameterId: id,
});

const trackingMapping: z.ZodType<TrackingMapping> = z.object({
  input: z.enum(TRACKING_INPUTS),
  parameterId: id,
  inputRange: z.tuple([num, num]),
  outputRange: z.tuple([num, num]),
  invert: z.boolean(),
  curve: z.enum(['linear', 'smooth']),
  smoothing: unit,
  deadZone: nonNegative,
});

const scene: z.ZodType<Scene> = z.object({
  id,
  name: z.string(),
  background: z.discriminatedUnion('type', [
    z.object({ type: z.literal('transparent') }),
    z.object({ type: z.literal('color'), color: z.string() }),
    z.object({ type: z.literal('image'), path: z.string() }),
  ]),
  modelTransform: z.object({ position: vec2, scale: num }),
  expressionIds: z.array(id),
  periodicAnimationIds: z.array(id),
});

const hotkey: z.ZodType<Hotkey> = z.object({
  id,
  keys: z.string(),
  action: z.enum(['expression', 'scene', 'background', 'animation', 'parameter', 'pauseTracking', 'recalibrate']),
  targetId: id.nullable(),
  mode: z.enum(['toggle', 'hold']),
});

export const projectSchema: z.ZodType<Project> = z
  .object({
    schemaVersion: num.int(),
    id,
    name: z.string(),
    assets: z.array(asset),
    model,
    expressions: z.array(expression),
    animations: z.array(animation),
    physics: z.array(physics),
    trackingMappings: z.array(trackingMapping),
    studio: z.object({ scenes: z.array(scene), activeSceneId: id.nullable(), hotkeys: z.array(hotkey) }),
  })
  .superRefine((p, ctx) => {
    uniqueIds(p.assets, 'assets', ctx);
    uniqueIds(p.expressions, 'expressions', ctx);
    uniqueIds(p.animations, 'animations', ctx);
    uniqueIds(p.physics, 'physics', ctx);
  });

const uiLevel = z.enum(['easy', 'detail']);

export const environmentSchema: z.ZodType<Environment> = z.object({
  cameraDeviceId: z.string().nullable(),
  cameraCapture: z.object({
    mode: z.enum(['auto', 'manual']),
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(4320),
    fps: z.number().int().min(1).max(120),
  }),
  mirror: z.boolean(),
  calibration: z
    .object({
      neutral: z.object({ yaw: num, pitch: num, roll: num }),
      eyeClosed: z.object({ l: num, r: num }),
      mouthOpenMax: num,
    })
    .nullable(),
  microphoneDeviceId: z.string().nullable(),
  silenceThreshold: num,
  trackingPreset: z.enum(['stable', 'standard', 'large', 'custom']),
  eyeTracking: z.boolean(),
  trackingCustom: z.object({
    minCutoff: num.positive(),
    beta: num.nonnegative(),
    gain: num.nonnegative(),
    deadZone: num.nonnegative(),
  }),
  bodyFollowStrength: z.enum(['low', 'standard', 'high']),
  expressionMode: z.enum(['stack', 'single']),
  output: z.object({
    method: z.enum(['window', 'spout2']),
    width: num.int().min(1),
    height: num.int().min(1),
    fps: num.min(1),
  }),
  uiLevel: z.object({ modeling: uiLevel, animation: uiLevel, studio: uiLevel }),
  lastProjectDir: z.string().nullable(),
});

// ---- 検証の関数 ----

export function validateProject(json: unknown): Project {
  const result = projectSchema.safeParse(json, { errorMap });
  if (!result.success) throw new ProjectValidationError('プロジェクト', toIssues(result.error));
  return result.data;
}

export function validateEnvironment(json: unknown): Environment {
  const result = environmentSchema.safeParse(json, { errorMap });
  if (!result.success) throw new ProjectValidationError('環境設定', toIssues(result.error));
  return result.data;
}
