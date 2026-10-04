// 1フレームの描き方を決める（GPU を使わない部分）。規則は WebGL のレンダラー（packages/render/src/webgl-renderer.ts）と同じ:
// - 画像（テクスチャ）が無い品目、頂点・索引が空の品目、頂点の数を超える索引がある品目は描かない（マスク元にもならない）
// - 索引は 3 の倍数に切り詰める
// - マスクはマスク元の組（重複と並びによらない）ごとに1回だけ作る。マスク元は partId が同じ最初の品目で、
//   不透明度が 0 より大きいものだけ。マスク元がどれも無い組は空のマスク（ふつうのマスクは描かない、反転は 1 − 0 = 1 でそのまま描く）
// - 不透明度は 0..1 に収め、0 以下の品目は描かない

use super::frame::{Background, BlendMode, Frame, View};
use std::collections::{BTreeSet, HashMap};

pub const FLOATS_PER_VERTEX: usize = 4; // x, y, u, v

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UvRect {
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
}

pub const FULL_UV: UvRect = UvRect {
    u0: 0.0,
    v0: 0.0,
    u1: 1.0,
    v1: 1.0,
};

// 頂点・索引のバッファの中の範囲
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Prepared {
    pub item: usize, // frame.items の番号
    pub texture: u32,
    pub first: u32, // 索引のバッファの中の先頭
    pub count: u32,
    pub opacity: f32, // 0..1 に収めた値
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MaskUse {
    None,
    Normal(usize),   // masks の番号
    Inverted(usize), // masks の番号
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Draw {
    pub prepared: usize,
    pub blend: BlendMode,
    pub mask: MaskUse,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    // 頂点（x, y, u, v）。先頭の 4 つは背景の四角形（クリップ座標）、索引は 0..6
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>, // 頂点のバッファの中の番号（品目の先頭の頂点の番号を足してある）
    pub prepared: Vec<Prepared>,
    pub masks: Vec<Vec<usize>>, // マスクごとのマスク元（prepared の番号）。空のものは無い
    pub draws: Vec<Draw>,
    pub background_image: Option<u32>,
    pub clear: [f32; 4], // 乗算済み
}

pub fn clamp01(n: f32) -> f32 {
    if n > 0.0 {
        if n < 1.0 {
            n
        } else {
            1.0
        }
    } else {
        0.0 // NaN も 0
    }
}

// キャンバス座標 → クリップ座標の一次式（clip = p × scale + offset）。画面の y は下向き、クリップ座標の y は上向き
pub fn view_to_clip(view: &View, width: u32, height: u32) -> ([f32; 2], [f32; 2]) {
    let (w, h) = (width as f32, height as f32);
    (
        [2.0 * view.scale / w, -2.0 * view.scale / h],
        [2.0 * view.offset_x / w - 1.0, 1.0 - 2.0 * view.offset_y / h],
    )
}

// 縦横比を保って全体を覆うときに見える、画像の中の範囲（uv）
pub fn cover_uv(image: (u32, u32), target: (u32, u32)) -> UvRect {
    let (iw, ih) = (image.0 as f64, image.1 as f64);
    let (tw, th) = (target.0 as f64, target.1 as f64);
    if !(iw > 0.0 && ih > 0.0 && tw > 0.0 && th > 0.0) {
        return FULL_UV;
    }
    let image_aspect = iw / ih;
    let target_aspect = tw / th;
    if image_aspect > target_aspect {
        let w = target_aspect / image_aspect;
        return UvRect {
            u0: ((1.0 - w) / 2.0) as f32,
            v0: 0.0,
            u1: ((1.0 + w) / 2.0) as f32,
            v1: 1.0,
        };
    }
    let h = image_aspect / target_aspect;
    UvRect {
        u0: 0.0,
        v0: ((1.0 - h) / 2.0) as f32,
        u1: 1.0,
        v1: ((1.0 + h) / 2.0) as f32,
    }
}

// has_texture: その番号のテクスチャを描けるか。background_size: 背景の画像の大きさ（画像の背景で、画像があるとき）
pub fn plan_frame(
    frame: &Frame,
    target: (u32, u32),
    has_texture: impl Fn(u32) -> bool,
    background_size: Option<(u32, u32)>,
) -> Plan {
    let mut vertex_count = 4;
    let mut index_count = 6;
    for item in &frame.items {
        vertex_count += item.positions.len() / 2;
        index_count += item.indices.len();
    }
    let mut vertices = Vec::with_capacity(vertex_count * FLOATS_PER_VERTEX);
    let mut indices = Vec::with_capacity(index_count);

    let background_image = match frame.background {
        Background::Image(id) if has_texture(id) && background_size.is_some() => Some(id),
        _ => None,
    };
    let uv = match (background_image, background_size) {
        (Some(_), Some(size)) => cover_uv(size, target),
        _ => FULL_UV,
    };
    // 左上・右上・右下・左下
    vertices.extend_from_slice(&[
        -1.0, 1.0, uv.u0, uv.v0, 1.0, 1.0, uv.u1, uv.v0, 1.0, -1.0, uv.u1, uv.v1, -1.0, -1.0,
        uv.u0, uv.v1,
    ]);
    indices.extend_from_slice(&[0, 1, 2, 0, 2, 3]);

    let mut prepared = Vec::new();
    let mut base = 4u32;
    for (i, item) in frame.items.iter().enumerate() {
        if !has_texture(item.texture) {
            continue; // 画像がまだ無い品目は描かない
        }
        let n = item.positions.len().min(item.uvs.len()) / 2;
        let count = item.indices.len() - item.indices.len() % 3;
        if n == 0 || count == 0 {
            continue;
        }
        if item.indices[..count].iter().any(|&k| k as usize >= n) {
            continue; // 頂点の数を超える索引
        }
        let first = indices.len() as u32;
        indices.extend(item.indices[..count].iter().map(|&k| k + base));
        for v in 0..n {
            vertices.extend_from_slice(&[
                item.positions[2 * v],
                item.positions[2 * v + 1],
                item.uvs[2 * v],
                item.uvs[2 * v + 1],
            ]);
        }
        prepared.push(Prepared {
            item: i,
            texture: item.texture,
            first,
            count: count as u32,
            opacity: clamp01(item.opacity),
        });
        base += n as u32;
    }

    // マスク元の組ごとのマスク
    let mut by_part: HashMap<u32, usize> = HashMap::new();
    for (p, q) in prepared.iter().enumerate() {
        by_part.entry(frame.items[q.item].part).or_insert(p);
    }
    let mut masks: Vec<Vec<usize>> = Vec::new();
    let mut by_key: HashMap<BTreeSet<u32>, Option<usize>> = HashMap::new();
    let mut draws = Vec::new();
    for (p, q) in prepared.iter().enumerate() {
        let item = &frame.items[q.item];
        let mask = match &item.mask {
            None => MaskUse::None,
            Some(mask) => {
                let key: BTreeSet<u32> = mask.sources.iter().copied().collect();
                let target = *by_key.entry(key).or_insert_with(|| {
                    let mut seen = BTreeSet::new();
                    let sources: Vec<usize> = mask
                        .sources
                        .iter()
                        .filter(|id| seen.insert(**id))
                        .filter_map(|id| by_part.get(id).copied())
                        .filter(|&s| prepared[s].opacity > 0.0)
                        .collect();
                    if sources.is_empty() {
                        None
                    } else {
                        masks.push(sources);
                        Some(masks.len() - 1)
                    }
                });
                match (target, mask.inverted) {
                    (Some(m), false) => MaskUse::Normal(m),
                    (Some(m), true) => MaskUse::Inverted(m),
                    (None, false) => continue, // 空のマスク
                    (None, true) => MaskUse::None,
                }
            }
        };
        if q.opacity <= 0.0 {
            continue;
        }
        draws.push(Draw {
            prepared: p,
            blend: item.blend,
            mask,
        });
    }
    // 描かない品目のためだけのマスクは作らない（WebGL は作るが、結果は同じ）
    let used: BTreeSet<usize> = draws
        .iter()
        .filter_map(|d| match d.mask {
            MaskUse::Normal(m) | MaskUse::Inverted(m) => Some(m),
            MaskUse::None => None,
        })
        .collect();
    if used.len() != masks.len() {
        let mut renumber = vec![usize::MAX; masks.len()];
        let mut kept = Vec::with_capacity(used.len());
        for (old, sources) in masks.into_iter().enumerate() {
            if used.contains(&old) {
                renumber[old] = kept.len();
                kept.push(sources);
            }
        }
        masks = kept;
        for d in &mut draws {
            d.mask = match d.mask {
                MaskUse::Normal(m) => MaskUse::Normal(renumber[m]),
                MaskUse::Inverted(m) => MaskUse::Inverted(renumber[m]),
                MaskUse::None => MaskUse::None,
            };
        }
    }

    let clear = match frame.background {
        Background::Color([r, g, b, a]) => {
            let a = clamp01(a);
            [clamp01(r) * a, clamp01(g) * a, clamp01(b) * a, a]
        }
        _ => [0.0; 4],
    };
    Plan {
        vertices,
        indices,
        prepared,
        masks,
        draws,
        background_image,
        clear,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::frame::{Item, Mask};

    fn quad(part: u32, texture: u32, x: f32) -> Item {
        Item {
            part,
            texture,
            positions: vec![x, 0.0, x + 10.0, 0.0, x + 10.0, 10.0, x, 10.0],
            uvs: vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0],
            indices: vec![0, 1, 2, 0, 2, 3],
            opacity: 1.0,
            blend: BlendMode::Normal,
            mask: None,
        }
    }

    fn frame(items: Vec<Item>) -> Frame {
        Frame {
            view: View {
                scale: 1.0,
                offset_x: 0.0,
                offset_y: 0.0,
            },
            background: Background::Transparent,
            items,
        }
    }

    #[test]
    fn 背景の四角形のあとに品目の頂点を並べ索引を直す() {
        let plan = plan_frame(
            &frame(vec![quad(0, 0, 0.0), quad(1, 1, 20.0)]),
            (100, 100),
            |_| true,
            None,
        );
        assert_eq!(plan.vertices.len(), (4 + 8) * FLOATS_PER_VERTEX);
        assert_eq!(&plan.indices[..6], &[0, 1, 2, 0, 2, 3]);
        assert_eq!(&plan.indices[6..12], &[4, 5, 6, 4, 6, 7]);
        assert_eq!(&plan.indices[12..], &[8, 9, 10, 8, 10, 11]);
        assert_eq!(plan.prepared[1].first, 12);
        assert_eq!(plan.draws.len(), 2);
    }

    #[test]
    fn 描けない品目を飛ばす() {
        let mut bad_index = quad(2, 0, 0.0);
        bad_index.indices[2] = 4;
        let mut empty = quad(3, 0, 0.0);
        empty.indices.clear();
        let mut ragged = quad(4, 0, 0.0);
        ragged.indices.truncate(4); // 3 つに切り詰める
        let mut hidden = quad(5, 0, 0.0);
        hidden.opacity = f32::NAN;
        let plan = plan_frame(
            &frame(vec![quad(1, 9, 0.0), bad_index, empty, ragged, hidden]),
            (100, 100),
            |t| t != 9,
            None,
        );
        assert_eq!(
            plan.prepared.iter().map(|p| p.item).collect::<Vec<_>>(),
            vec![3, 4]
        );
        assert_eq!(plan.prepared[0].count, 3);
        assert_eq!(
            plan.draws.iter().map(|d| d.prepared).collect::<Vec<_>>(),
            vec![0]
        ); // 不透明度 NaN は 0
    }

    #[test]
    fn マスクは組ごとに1回だけ作り空のマスクを扱う() {
        let mut a = quad(10, 0, 0.0);
        a.mask = Some(Mask {
            sources: vec![1, 2, 1],
            inverted: false,
        });
        let mut b = quad(11, 0, 0.0);
        b.mask = Some(Mask {
            sources: vec![2, 1],
            inverted: true,
        });
        let mut c = quad(12, 0, 0.0);
        c.mask = Some(Mask {
            sources: vec![99],
            inverted: false,
        }); // 無い → 描かない
        let mut d = quad(13, 0, 0.0);
        d.mask = Some(Mask {
            sources: vec![99],
            inverted: true,
        }); // 無い → そのまま描く
        let mut zero = quad(2, 0, 0.0);
        zero.opacity = 0.0; // 不透明度 0 はマスク元にならない
        let plan = plan_frame(
            &frame(vec![quad(1, 0, 0.0), zero, a, b, c, d]),
            (100, 100),
            |_| true,
            None,
        );
        assert_eq!(plan.masks, vec![vec![0]]);
        let masks: Vec<_> = plan
            .draws
            .iter()
            .map(|d| (plan.prepared[d.prepared].item, d.mask))
            .collect();
        assert_eq!(
            masks,
            vec![
                (0, MaskUse::None),
                (2, MaskUse::Normal(0)),
                (3, MaskUse::Inverted(0)),
                (5, MaskUse::None)
            ]
        );
    }

    #[test]
    fn マスク元は同じ_part_の最初の品目() {
        let mut later = quad(1, 0, 50.0);
        later.opacity = 0.5;
        let mut masked = quad(7, 0, 0.0);
        masked.mask = Some(Mask {
            sources: vec![1],
            inverted: false,
        });
        let plan = plan_frame(
            &frame(vec![quad(1, 0, 0.0), later, masked]),
            (100, 100),
            |_| true,
            None,
        );
        assert_eq!(plan.masks, vec![vec![0]]);
    }

    #[test]
    fn 背景の色は乗算済みで消す() {
        let mut f = frame(vec![]);
        f.background = Background::Color([1.0, 0.5, 0.0, 0.5]);
        assert_eq!(
            plan_frame(&f, (10, 10), |_| true, None).clear,
            [0.5, 0.25, 0.0, 0.5]
        );
    }

    #[test]
    fn 背景の画像は覆うように切り取る() {
        let mut f = frame(vec![]);
        f.background = Background::Image(3);
        let plan = plan_frame(&f, (200, 100), |_| true, Some((100, 100)));
        assert_eq!(plan.background_image, Some(3));
        assert_eq!(&plan.vertices[0..4], &[-1.0, 1.0, 0.0, 0.25]);
        assert_eq!(&plan.vertices[8..12], &[1.0, -1.0, 1.0, 0.75]);
        // 画像が無ければ描かない
        assert_eq!(
            plan_frame(&f, (200, 100), |_| false, Some((100, 100))).background_image,
            None
        );
    }

    #[test]
    fn view_からクリップ座標の式を作る() {
        let (s, o) = view_to_clip(
            &View {
                scale: 2.0,
                offset_x: 50.0,
                offset_y: 25.0,
            },
            100,
            50,
        );
        assert_eq!(s, [0.04, -0.08]);
        assert_eq!(o, [0.0, 0.0]);
    }
}
