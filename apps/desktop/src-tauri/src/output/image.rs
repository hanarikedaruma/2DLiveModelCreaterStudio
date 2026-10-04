// 素材の画像を読み、乗算済みアルファの RGBA8 にする。
// ブラウザの createImageBitmap（premultiplyAlpha: 'premultiply'、colorSpaceConversion: 'none'）と同じく、
// 色空間・ガンマは変えず、乗算は round(c × a / 255) にする

use super::frame::TextureData;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>, // 乗算済みの RGBA8。左上から行ごと
}

const DECODE_LIMIT_BYTES: usize = 1 << 30;

// round(c × a / 255)（Skia の SkMulDiv255Round と同じ式）
pub fn mul_div_255(c: u8, a: u8) -> u8 {
    let prod = c as u32 * a as u32 + 128;
    ((prod + (prod >> 8)) >> 8) as u8
}

pub fn premultiply(pixels: &mut [u8]) {
    for p in pixels.as_chunks_mut::<4>().0 {
        let a = p[3];
        if a == 255 {
            continue;
        }
        p[0] = mul_div_255(p[0], a);
        p[1] = mul_div_255(p[1], a);
        p[2] = mul_div_255(p[2], a);
    }
}

pub fn decode(data: TextureData) -> Result<Image, String> {
    let (width, height, mut pixels) = match data {
        TextureData::Rgba {
            width,
            height,
            pixels,
        } => (width, height, pixels),
        TextureData::Png(bytes) => decode_png(&bytes)?,
    };
    premultiply(&mut pixels);
    Ok(Image {
        width,
        height,
        pixels,
    })
}

// PNG を乗算していない RGBA8 にする（パレット・グレースケール・16 ビット・tRNS も RGBA8 に広げる）
pub fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new_with_limits(
        std::io::Cursor::new(bytes),
        png::Limits {
            bytes: DECODE_LIMIT_BYTES,
        },
    );
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("PNG を読めない: {e}"))?;
    let size = reader.output_buffer_size().ok_or("PNG が大きすぎる")?;
    let mut buf = vec![0; size];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("PNG を読めない: {e}"))?;
    let (w, h) = (info.width as usize, info.height as usize);
    let channels = match info.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return Err("PNG のパレットを広げられない".into()),
    };
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        let row = &buf[y * info.line_size..y * info.line_size + w * channels];
        let dst = &mut out[y * w * 4..(y + 1) * w * 4];
        for (x, d) in dst.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let s = &row[x * channels..(x + 1) * channels];
            let rgba = match channels {
                1 => [s[0], s[0], s[0], 255],
                2 => [s[0], s[0], s[0], s[1]],
                3 => [s[0], s[1], s[2], 255],
                _ => [s[0], s[1], s[2], s[3]],
            };
            d.copy_from_slice(&rgba);
        }
    }
    Ok((info.width, info.height, out))
}

#[cfg(test)]
pub(crate) fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(rgba).unwrap();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 乗算は四捨五入() {
        assert_eq!(mul_div_255(255, 255), 255);
        assert_eq!(mul_div_255(255, 128), 128);
        assert_eq!(mul_div_255(100, 128), 50); // 50.196…
        assert_eq!(mul_div_255(1, 127), 0); // 0.498…
        assert_eq!(mul_div_255(1, 128), 1); // 0.501…
        for c in 0..=255u32 {
            for a in 0..=255u32 {
                let exact = (c * a) as f64 / 255.0;
                assert_eq!(
                    mul_div_255(c as u8, a as u8) as f64,
                    exact.round(),
                    "{c} × {a}"
                );
            }
        }
    }

    #[test]
    fn png_を乗算済みの_rgba_にする() {
        let png = encode_png(2, 1, &[255, 0, 0, 255, 200, 100, 50, 128]);
        let image = decode(TextureData::Png(png)).unwrap();
        assert_eq!((image.width, image.height), (2, 1));
        assert_eq!(image.pixels, vec![255, 0, 0, 255, 100, 50, 25, 128]);
    }

    #[test]
    fn グレースケールと_rgb_も読む() {
        let mut gray = Vec::new();
        {
            let mut e = png::Encoder::new(&mut gray, 2, 1);
            e.set_color(png::ColorType::GrayscaleAlpha);
            let mut w = e.write_header().unwrap();
            w.write_image_data(&[200, 255, 100, 0]).unwrap();
        }
        assert_eq!(
            decode_png(&gray).unwrap().2,
            vec![200, 200, 200, 255, 100, 100, 100, 0]
        );
        let mut rgb = Vec::new();
        {
            let mut e = png::Encoder::new(&mut rgb, 1, 1);
            e.set_color(png::ColorType::Rgb);
            let mut w = e.write_header().unwrap();
            w.write_image_data(&[1, 2, 3]).unwrap();
        }
        assert_eq!(decode_png(&rgb).unwrap().2, vec![1, 2, 3, 255]);
    }

    #[test]
    fn 壊れた_png_はエラー() {
        assert!(decode(TextureData::Png(vec![1, 2, 3])).is_err());
    }

    #[test]
    fn rgba_はそのまま乗算する() {
        let image = decode(TextureData::Rgba {
            width: 1,
            height: 1,
            pixels: vec![255, 255, 255, 0],
        })
        .unwrap();
        assert_eq!(image.pixels, vec![0, 0, 0, 0]);
    }
}
