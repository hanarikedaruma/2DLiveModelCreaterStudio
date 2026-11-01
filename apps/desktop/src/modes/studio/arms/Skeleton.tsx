// 位置合わせの骨格（AT-11）。カメラの縦横比の枠に、肩・肘・手首と手の手首を描く。映像は出さない
import type { Vec2 } from '@app/schema';
import type { ActorSide, ArmDiagnostics, DiagnosticPoint } from './service';
import { BODY_PARTS, PART_LABEL, displayPoint, isVisible, partPoint, type BodyPart } from './points';

const WIDTH = 320;
const SIDES: ActorSide[] = ['left', 'right'];

export function Skeleton(props: { diagnostics: ArmDiagnostics | null; mirror: boolean; stale?: boolean }) {
  const { diagnostics, mirror } = props;
  const image = diagnostics?.image ?? { width: 4, height: 3 };
  const box = { width: WIDTH, height: Math.round((WIDTH * image.height) / image.width) };
  const at = (p: Vec2) => displayPoint(p, mirror, box);
  const point = (part: BodyPart) => partPoint(diagnostics, part);
  const line = (a: DiagnosticPoint | null, b: DiagnosticPoint | null, key: string) => {
    if (!isVisible(a) || !isVisible(b)) return null;
    const p = at(a);
    const q = at(b);
    return <line key={key} className="arms-bone" x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
  };
  return (
    <figure className="arms-skeleton" data-stale={props.stale ? 'true' : undefined}>
      <svg
        role="img"
        aria-label="肩・肘・手首の位置"
        viewBox={`0 0 ${box.width} ${box.height}`}
        width={box.width}
        height={box.height}
      >
        <rect className="arms-frame" x={0.5} y={0.5} width={box.width - 1} height={box.height - 1} />
        {line(point('leftShoulder'), point('rightShoulder'), 'shoulders')}
        {SIDES.flatMap((side) => [
          line(point(`${side}Shoulder`), point(`${side}Elbow`), `${side}-upper`),
          line(point(`${side}Elbow`), point(`${side}Wrist`), `${side}-lower`),
        ])}
        {BODY_PARTS.map((part) => {
          const p = point(part);
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
          const { x, y } = at(p);
          const visible = isVisible(p);
          return (
            <g key={part} data-part={part} data-visible={visible} data-x={x.toFixed(1)} data-y={y.toFixed(1)}>
              <title>{`${PART_LABEL[part]}${visible ? '' : '（見えていない）'}`}</title>
              {visible ? (
                <circle className="arms-joint" cx={x} cy={y} r={5} />
              ) : (
                <path
                  className="arms-joint-hidden"
                  d={`M${x - 4},${y - 4}L${x + 4},${y + 4}M${x - 4},${y + 4}L${x + 4},${y - 4}`}
                />
              )}
            </g>
          );
        })}
        {diagnostics?.hands.map((h, i) => {
          const { x, y } = at(h);
          return <rect key={i} className="arms-hand" data-part="hand" x={x - 4} y={y - 4} width={8} height={8} />;
        })}
      </svg>
      <figcaption className="studio-note">
        {mirror
          ? 'ミラーON：鏡のように表示（あなたの右手が右に出る）'
          : 'ミラーOFF：カメラから見たまま表示（あなたの右手が左に出る）'}
        {props.stale ? '。点が古い（認識が止まっている）' : ''}
      </figcaption>
    </figure>
  );
}

// 写っている点の一覧（✓ / ×）
export function VisibleParts(props: { diagnostics: ArmDiagnostics | null; parts?: BodyPart[] }) {
  const parts = props.parts ?? BODY_PARTS;
  return (
    <ul className="arms-visible" aria-label="写っている点">
      {parts.map((part) => {
        const visible = isVisible(partPoint(props.diagnostics, part));
        return (
          <li key={part} data-visible={visible}>
            {PART_LABEL[part]} {visible ? '✓' : '×'}
          </li>
        );
      })}
    </ul>
  );
}
