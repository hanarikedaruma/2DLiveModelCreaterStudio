// JS（apps/desktop/src/output/spout/wire.ts）から届くバイナリを読む。値はすべてリトルエンディアン。
//
// フレーム（'SPF1'）:
//   magic u32, view.scale f32, view.offset.x f32, view.offset.y f32,
//   背景の種類 u32（0: 透明、1: 色 → r g b a の f32（乗算していない 0..1）、2: 画像 → テクスチャの番号 u32）,
//   品目数 u32, 品目ごとに:
//     partId の番号 u32, テクスチャ（assetId）の番号 u32（無ければ NO_TEXTURE）, 頂点数 n u32, 索引の数 m u32,
//     positions f32 × 2n, uvs f32 × 2n, indices u32 × m, opacity f32,
//     blendMode u32（0: 通常、1: 乗算、2: スクリーン、3: 加算）, マスク u32（0: なし、1: マスク、2: 反転マスク）,
//     マスク元の数 k u32, マスク元の partId の番号 u32 × k
//
// テクスチャ（'SPT1'）:
//   magic u32, 足す・差し替える数 u32, それぞれ:
//     テクスチャの番号 u32, 種類 u32（0: PNG、1: 乗算していない RGBA8）, 幅 u32, 高さ u32（PNG は 0）,
//     バイト数 u32, バイト列（4 バイトの境界まで 0 で埋める）
//   消す数 u32, 消すテクスチャの番号 u32 × 数

pub const FRAME_MAGIC: u32 = u32::from_le_bytes(*b"SPF1");
pub const TEXTURES_MAGIC: u32 = u32::from_le_bytes(*b"SPT1");
#[cfg_attr(not(test), allow(dead_code))] // JS が送っていない素材に付ける番号（どのテクスチャとも合わないので描かない）
pub const NO_TEXTURE: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub scale: f32,
    pub offset_x: f32,
    pub offset_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Background {
    Transparent,
    Color([f32; 4]), // 乗算していない 0..1
    Image(u32),      // テクスチャの番号
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Add,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Mask {
    pub sources: Vec<u32>, // マスク元の partId の番号
    pub inverted: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub part: u32,
    pub texture: u32,
    pub positions: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
    pub opacity: f32,
    pub blend: BlendMode,
    pub mask: Option<Mask>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    pub view: View,
    pub background: Background,
    pub items: Vec<Item>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextureData {
    Png(Vec<u8>),
    Rgba {
        width: u32,
        height: u32,
        pixels: Vec<u8>,
    }, // 乗算していない
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextureUpdate {
    pub upserts: Vec<(u32, TextureData)>,
    pub removals: Vec<u32>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn take(&mut self, n: usize, what: &str) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(n).filter(|&e| e <= self.bytes.len());
        match end {
            Some(end) => {
                let s = &self.bytes[self.at..end];
                self.at = end;
                Ok(s)
            }
            None => Err(format!(
                "{what} の途中でデータが終わった（{} バイト目）",
                self.at
            )),
        }
    }

    fn u32(&mut self, what: &str) -> Result<u32, String> {
        let b = self.take(4, what)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f32(&mut self, what: &str) -> Result<f32, String> {
        Ok(f32::from_bits(self.u32(what)?))
    }

    // 数を読み、残りのバイト数で足りるかを先に確かめる（壊れたデータで大きな領域を取らない）
    fn count(&mut self, unit: usize, what: &str) -> Result<usize, String> {
        let n = self.u32(what)? as usize;
        let need = n
            .checked_mul(unit)
            .ok_or_else(|| format!("{what} が大きすぎる"))?;
        if need > self.bytes.len() - self.at {
            return Err(format!("{what}（{n}）が残りのデータより多い"));
        }
        Ok(n)
    }

    fn f32s(&mut self, n: usize, what: &str) -> Result<Vec<f32>, String> {
        let b = self.take(n * 4, what)?;
        Ok(b.as_chunks::<4>()
            .0
            .iter()
            .map(|c| f32::from_le_bytes(*c))
            .collect())
    }

    fn u32s(&mut self, n: usize, what: &str) -> Result<Vec<u32>, String> {
        let b = self.take(n * 4, what)?;
        Ok(b.as_chunks::<4>()
            .0
            .iter()
            .map(|c| u32::from_le_bytes(*c))
            .collect())
    }

    fn finish(&self, what: &str) -> Result<(), String> {
        if self.at == self.bytes.len() {
            Ok(())
        } else {
            Err(format!(
                "{what} のあとに余分なデータがある（{} バイト）",
                self.bytes.len() - self.at
            ))
        }
    }
}

pub fn decode_frame(bytes: &[u8]) -> Result<Frame, String> {
    let mut r = Reader::new(bytes);
    if r.u32("先頭")? != FRAME_MAGIC {
        return Err("フレームのデータではない（先頭が SPF1 でない）".into());
    }
    let view = View {
        scale: r.f32("view")?,
        offset_x: r.f32("view")?,
        offset_y: r.f32("view")?,
    };
    let background = match r.u32("背景の種類")? {
        0 => Background::Transparent,
        1 => Background::Color([
            r.f32("背景の色")?,
            r.f32("背景の色")?,
            r.f32("背景の色")?,
            r.f32("背景の色")?,
        ]),
        2 => Background::Image(r.u32("背景の画像")?),
        other => return Err(format!("知らない背景の種類: {other}")),
    };
    // 品目は少なくとも 32 バイト（番号・数・opacity・blend・mask・k）
    let count = r.count(32, "品目数")?;
    let mut items = Vec::with_capacity(count);
    for _ in 0..count {
        let part = r.u32("partId の番号")?;
        let texture = r.u32("テクスチャの番号")?;
        let n = r.count(16, "頂点数")?;
        let m = r.count(4, "索引の数")?;
        let positions = r.f32s(n * 2, "positions")?;
        let uvs = r.f32s(n * 2, "uvs")?;
        let indices = r.u32s(m, "indices")?;
        let opacity = r.f32("opacity")?;
        let blend = match r.u32("blendMode")? {
            1 => BlendMode::Multiply,
            2 => BlendMode::Screen,
            3 => BlendMode::Add,
            _ => BlendMode::Normal, // 知らない値は通常（WebGL のレンダラーと同じ）
        };
        let mask_mode = r.u32("マスク")?;
        let k = r.count(4, "マスク元の数")?;
        let sources = r.u32s(k, "マスク元")?;
        let mask = match mask_mode {
            0 => None,
            1 => Some(Mask {
                sources,
                inverted: false,
            }),
            2 => Some(Mask {
                sources,
                inverted: true,
            }),
            other => return Err(format!("知らないマスクの種類: {other}")),
        };
        items.push(Item {
            part,
            texture,
            positions,
            uvs,
            indices,
            opacity,
            blend,
            mask,
        });
    }
    r.finish("フレーム")?;
    Ok(Frame {
        view,
        background,
        items,
    })
}

pub fn decode_textures(bytes: &[u8]) -> Result<TextureUpdate, String> {
    let mut r = Reader::new(bytes);
    if r.u32("先頭")? != TEXTURES_MAGIC {
        return Err("テクスチャのデータではない（先頭が SPT1 でない）".into());
    }
    let count = r.count(20, "テクスチャの数")?;
    let mut upserts = Vec::with_capacity(count);
    for _ in 0..count {
        let id = r.u32("テクスチャの番号")?;
        let kind = r.u32("テクスチャの種類")?;
        let width = r.u32("幅")?;
        let height = r.u32("高さ")?;
        let len = r.count(1, "バイト数")?;
        let data = r.take(len, "テクスチャのデータ")?.to_vec();
        r.take((4 - len % 4) % 4, "埋め草")?;
        let texture = match kind {
            0 => TextureData::Png(data),
            1 => {
                let expected = (width as u64) * (height as u64) * 4;
                if expected != len as u64 {
                    return Err(format!("RGBA のバイト数が幅 × 高さ × 4 と合わない（{width}×{height}、{len} バイト）"));
                }
                TextureData::Rgba {
                    width,
                    height,
                    pixels: data,
                }
            }
            other => return Err(format!("知らないテクスチャの種類: {other}")),
        };
        upserts.push((id, texture));
    }
    let removals_count = r.count(4, "消す数")?;
    let removals = r.u32s(removals_count, "消すテクスチャの番号")?;
    r.finish("テクスチャ")?;
    Ok(TextureUpdate { upserts, removals })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_u32(out: &mut Vec<u8>, v: u32) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    fn push_f32(out: &mut Vec<u8>, v: f32) {
        out.extend_from_slice(&v.to_le_bytes());
    }

    fn sample_frame() -> Vec<u8> {
        let mut b = Vec::new();
        push_u32(&mut b, FRAME_MAGIC);
        for v in [2.0, 10.0, -5.0] {
            push_f32(&mut b, v);
        }
        push_u32(&mut b, 1);
        for v in [1.0, 0.5, 0.0, 1.0] {
            push_f32(&mut b, v);
        }
        push_u32(&mut b, 1); // 品目数
        push_u32(&mut b, 3); // part
        push_u32(&mut b, 7); // texture
        push_u32(&mut b, 3); // 頂点数
        push_u32(&mut b, 3); // 索引の数
        for v in [0.0, 0.0, 10.0, 0.0, 0.0, 10.0] {
            push_f32(&mut b, v);
        }
        for v in [0.0, 0.0, 1.0, 0.0, 0.0, 1.0] {
            push_f32(&mut b, v);
        }
        for v in [0, 1, 2] {
            push_u32(&mut b, v);
        }
        push_f32(&mut b, 0.5);
        push_u32(&mut b, 2); // screen
        push_u32(&mut b, 2); // 反転マスク
        push_u32(&mut b, 2);
        push_u32(&mut b, 4);
        push_u32(&mut b, 5);
        b
    }

    #[test]
    fn フレームを読む() {
        let frame = decode_frame(&sample_frame()).unwrap();
        assert_eq!(
            frame.view,
            View {
                scale: 2.0,
                offset_x: 10.0,
                offset_y: -5.0
            }
        );
        assert_eq!(frame.background, Background::Color([1.0, 0.5, 0.0, 1.0]));
        assert_eq!(frame.items.len(), 1);
        let item = &frame.items[0];
        assert_eq!((item.part, item.texture), (3, 7));
        assert_eq!(item.positions, vec![0.0, 0.0, 10.0, 0.0, 0.0, 10.0]);
        assert_eq!(item.indices, vec![0, 1, 2]);
        assert_eq!(item.opacity, 0.5);
        assert_eq!(item.blend, BlendMode::Screen);
        assert_eq!(
            item.mask,
            Some(Mask {
                sources: vec![4, 5],
                inverted: true
            })
        );
    }

    #[test]
    fn 途中で切れたフレームや余分なデータは読まない() {
        let bytes = sample_frame();
        for len in [0, 3, 10, 30, bytes.len() - 1] {
            assert!(
                decode_frame(&bytes[..len]).is_err(),
                "{len} バイトで読めてしまった"
            );
        }
        let mut longer = bytes.clone();
        longer.push(0);
        assert!(decode_frame(&longer).is_err());
        let mut wrong = bytes;
        wrong[0] = b'X';
        assert!(decode_frame(&wrong).is_err());
    }

    #[test]
    fn 大きすぎる数で領域を取らない() {
        let mut b = Vec::new();
        push_u32(&mut b, FRAME_MAGIC);
        for v in [1.0, 0.0, 0.0] {
            push_f32(&mut b, v);
        }
        push_u32(&mut b, 0);
        push_u32(&mut b, u32::MAX); // 品目数
        assert!(decode_frame(&b).unwrap_err().contains("品目数"));
    }

    // testdata の 16 進のテキスト（空白・改行は読み飛ばす）
    fn testdata_hex(name: &str) -> Vec<u8> {
        let here = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(file!());
        let path = here.parent().unwrap().join("testdata").join(name);
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{} を読めない: {e}", path.display()));
        let digits: Vec<u8> = text.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
        digits
            .as_chunks::<2>()
            .0
            .iter()
            .map(|h| u8::from_str_radix(std::str::from_utf8(h).unwrap(), 16).unwrap())
            .collect()
    }

    // apps/desktop/src/output/spout/compare/wireSample.ts の中身を JS がエンコードしたもの
    #[test]
    fn js_のエンコードを読む() {
        let frame = decode_frame(&testdata_hex("wire-sample-frame.hex")).unwrap();
        assert_eq!(
            frame.view,
            View {
                scale: 2.0,
                offset_x: 10.0,
                offset_y: -5.0
            }
        );
        assert_eq!(frame.background, Background::Color([1.0, 0.5, 0.0, 1.0]));
        let quad_uvs = vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0];
        assert_eq!(
            frame.items,
            vec![
                Item {
                    part: 0,
                    texture: 0,
                    positions: vec![0.0, 0.0, 10.0, 0.0, 10.0, 10.0],
                    uvs: quad_uvs.clone(),
                    indices: vec![0, 1, 2],
                    opacity: 0.75,
                    blend: BlendMode::Normal,
                    mask: None,
                },
                Item {
                    part: 1,
                    texture: 1,
                    positions: vec![1.5, 2.5, 3.5, 4.5, 5.5, 6.5],
                    uvs: quad_uvs.clone(),
                    indices: vec![0, 1, 2],
                    opacity: 1.0,
                    blend: BlendMode::Screen,
                    mask: Some(Mask {
                        sources: vec![0, 2],
                        inverted: true
                    }),
                },
                Item {
                    part: 3,
                    texture: NO_TEXTURE,
                    positions: vec![0.0, 0.0, 10.0, 0.0, 10.0, 10.0],
                    uvs: quad_uvs,
                    indices: vec![0, 1, 2],
                    opacity: 1.0,
                    blend: BlendMode::Add,
                    mask: None,
                },
            ]
        );
        let textures = decode_textures(&testdata_hex("wire-sample-textures.hex")).unwrap();
        assert_eq!(
            textures,
            TextureUpdate {
                upserts: vec![
                    (0, TextureData::Png(vec![137, 80, 78, 71, 13])),
                    (
                        5,
                        TextureData::Rgba {
                            width: 2,
                            height: 1,
                            pixels: vec![255, 0, 0, 255, 0, 0, 255, 128]
                        }
                    ),
                ],
                removals: vec![1],
            }
        );
    }

    #[test]
    fn テクスチャを読む() {
        let mut b = Vec::new();
        push_u32(&mut b, TEXTURES_MAGIC);
        push_u32(&mut b, 2);
        push_u32(&mut b, 1);
        push_u32(&mut b, 0);
        push_u32(&mut b, 0);
        push_u32(&mut b, 0);
        push_u32(&mut b, 5);
        b.extend_from_slice(&[1, 2, 3, 4, 5, 0, 0, 0]);
        push_u32(&mut b, 9);
        push_u32(&mut b, 1);
        push_u32(&mut b, 1);
        push_u32(&mut b, 1);
        push_u32(&mut b, 4);
        b.extend_from_slice(&[10, 20, 30, 40]);
        push_u32(&mut b, 1);
        push_u32(&mut b, 4);
        let t = decode_textures(&b).unwrap();
        assert_eq!(
            t.upserts,
            vec![
                (1, TextureData::Png(vec![1, 2, 3, 4, 5])),
                (
                    9,
                    TextureData::Rgba {
                        width: 1,
                        height: 1,
                        pixels: vec![10, 20, 30, 40]
                    }
                ),
            ]
        );
        assert_eq!(t.removals, vec![4]);
    }
}
