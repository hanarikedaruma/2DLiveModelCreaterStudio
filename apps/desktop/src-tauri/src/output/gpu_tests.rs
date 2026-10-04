// GPU を使うテスト（Windows）。
// - 受け手の役: 共有メモリから送り手を見つけ、共有テクスチャを別のデバイスで開いてピクセルを読み、透過のまま届くかを確かめる
// - プレビューとの比べ合わせ: testdata/ の場面（WebGL のレンダラーで描いた絵と、同じフレーム・テクスチャのバイナリ）を
//   D3D11 で描き、ピクセルを比べる（±3 以内が 99% 以上）。testdata は apps/desktop/src/output/spout/compare/ で作る
// - 1920×1080 の描画の時間（cargo test -- --ignored で測る）

use super::d3d11::{create_device, read_texture, Renderer};
use super::frame::{decode_frame, decode_textures, Background, BlendMode, Frame, Item, View};
use super::image::{self, encode_png, mul_div_255};
use super::spout::{
    active_sender_name, frame_count, sender_info, sender_names, ReceiverAccess,
    DXGI_FORMAT_B8G8R8A8_UNORM,
};
use super::worker::{StartOptions, Worker};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

static NEXT: AtomicU32 = AtomicU32::new(0);

// テストごとに違う名前（同時に動くテストや、動いているアプリとぶつけない）
fn test_sender_name() -> String {
    format!(
        "2D Liver test {}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    )
}

fn push_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

// テクスチャのメッセージ（PNG を足すだけ）
fn textures_message(pngs: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut b = Vec::new();
    push_u32(&mut b, super::frame::TEXTURES_MAGIC);
    push_u32(&mut b, pngs.len() as u32);
    for (id, png) in pngs {
        push_u32(&mut b, *id);
        push_u32(&mut b, 0);
        push_u32(&mut b, 0);
        push_u32(&mut b, 0);
        push_u32(&mut b, png.len() as u32);
        b.extend_from_slice(png);
        b.resize(b.len() + (4 - png.len() % 4) % 4, 0);
    }
    push_u32(&mut b, 0);
    b
}

fn frame_message(frame: &Frame) -> Vec<u8> {
    let mut b = Vec::new();
    push_u32(&mut b, super::frame::FRAME_MAGIC);
    for v in [frame.view.scale, frame.view.offset_x, frame.view.offset_y] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    match frame.background {
        Background::Transparent => push_u32(&mut b, 0),
        Background::Color(c) => {
            push_u32(&mut b, 1);
            for v in c {
                b.extend_from_slice(&v.to_le_bytes());
            }
        }
        Background::Image(id) => {
            push_u32(&mut b, 2);
            push_u32(&mut b, id);
        }
    }
    push_u32(&mut b, frame.items.len() as u32);
    for item in &frame.items {
        push_u32(&mut b, item.part);
        push_u32(&mut b, item.texture);
        push_u32(&mut b, (item.positions.len() / 2) as u32);
        push_u32(&mut b, item.indices.len() as u32);
        for v in item.positions.iter().chain(item.uvs.iter()) {
            b.extend_from_slice(&v.to_le_bytes());
        }
        for &v in &item.indices {
            push_u32(&mut b, v);
        }
        b.extend_from_slice(&item.opacity.to_le_bytes());
        push_u32(
            &mut b,
            match item.blend {
                BlendMode::Normal => 0,
                BlendMode::Multiply => 1,
                BlendMode::Screen => 2,
                BlendMode::Add => 3,
            },
        );
        match &item.mask {
            None => {
                push_u32(&mut b, 0);
                push_u32(&mut b, 0);
            }
            Some(m) => {
                push_u32(&mut b, if m.inverted { 2 } else { 1 });
                push_u32(&mut b, m.sources.len() as u32);
                for &s in &m.sources {
                    push_u32(&mut b, s);
                }
            }
        }
    }
    b
}

fn rect(part: u32, texture: u32, r: [f32; 4], opacity: f32) -> Item {
    let [x0, y0, x1, y1] = r;
    Item {
        part,
        texture,
        positions: vec![x0, y0, x1, y0, x1, y1, x0, y1],
        uvs: vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0],
        indices: vec![0, 1, 2, 0, 2, 3],
        opacity,
        blend: BlendMode::Normal,
        mask: None,
    }
}

fn solid_png(rgba: [u8; 4]) -> Vec<u8> {
    let pixels: Vec<u8> = (0..16).flat_map(|_| rgba).collect();
    encode_png(4, 4, &pixels)
}

fn pixel(pixels: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * width + x) * 4) as usize;
    [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
}

fn close(a: [u8; 4], b: [u8; 4], tolerance: i32) -> bool {
    a.iter()
        .zip(b.iter())
        .all(|(&x, &y)| (x as i32 - y as i32).abs() <= tolerance)
}

#[test]
fn 受け手が共有メモリから送り手を見つけて透過のまま読める() {
    let name = test_sender_name();
    let (width, height) = (64u32, 32u32);
    let worker = Worker::start(StartOptions {
        sender_name: name.clone(),
        width,
        height,
    })
    .expect("送り手を作れない");
    assert_eq!(worker.started.sender_name, name);

    // 共有メモリの一覧・アクティブな送り手・送り手の情報
    assert!(
        sender_names().contains(&name),
        "一覧に無い: {:?}",
        sender_names()
    );
    assert_eq!(active_sender_name().as_deref(), Some(name.as_str()));
    let info = sender_info(&name).expect("送り手の情報が無い");
    assert_eq!(
        (info.width, info.height, info.format),
        (width, height, DXGI_FORMAT_B8G8R8A8_UNORM)
    );
    assert_ne!(info.share_handle, 0);
    assert_eq!(info.partner_id, 0);
    let path_len = info.description.iter().position(|&b| b == 0).unwrap();
    assert!(String::from_utf8_lossy(&info.description[..path_len])
        .to_lowercase()
        .ends_with(".exe"));

    // 赤の不透明・緑の不透明度 0.5・半透明の青（アルファ 128）
    worker
        .set_textures(textures_message(&[
            (1, solid_png([255, 0, 0, 255])),
            (2, solid_png([0, 255, 0, 255])),
            (3, solid_png([0, 0, 255, 128])),
        ]))
        .unwrap();
    let before = frame_count(&name).unwrap_or(0);
    let frame = Frame {
        view: View {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
        },
        background: Background::Transparent,
        items: vec![
            rect(0, 1, [8.0, 8.0, 24.0, 24.0], 1.0),
            rect(1, 2, [32.0, 8.0, 40.0, 24.0], 0.5),
            rect(2, 3, [48.0, 8.0, 56.0, 24.0], 1.0),
        ],
    };
    worker.submit(frame_message(&frame)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while frame_count(&name).unwrap_or(0) <= before {
        assert!(Instant::now() < deadline, "フレームの数が増えない");
        std::thread::sleep(Duration::from_millis(10));
    }

    // 別のデバイス（別のプロセスの受け手の代わり）で共有テクスチャを開いて読む
    let receiver = create_device(true).unwrap();
    let info = sender_info(&name).unwrap();
    let mut shared: Option<ID3D11Texture2D> = None;
    unsafe {
        receiver
            .device
            .OpenSharedResource(
                HANDLE(info.share_handle as usize as *mut core::ffi::c_void),
                &mut shared,
            )
            .expect("共有テクスチャを開けない");
    }
    let shared = shared.unwrap();
    let access = ReceiverAccess::open(&name).expect("テクスチャのミューテックスが無い");
    assert!(access.lock());
    let bgra = read_texture(&receiver.device, &receiver.context, &shared).unwrap();
    access.unlock();
    let rgba: Vec<u8> = bgra
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[2], p[1], p[0], p[3]])
        .collect();

    assert_eq!(pixel(&rgba, width, 1, 1), [0, 0, 0, 0], "背景は透明");
    assert_eq!(pixel(&rgba, width, 16, 16), [255, 0, 0, 255]);
    // 不透明度・アルファは乗算していない色とアルファで届く
    assert!(
        close(pixel(&rgba, width, 36, 16), [0, 255, 0, 128], 1),
        "{:?}",
        pixel(&rgba, width, 36, 16)
    );
    assert!(
        close(pixel(&rgba, width, 52, 16), [0, 0, 255, 128], 1),
        "{:?}",
        pixel(&rgba, width, 52, 16)
    );
    assert_eq!(pixel(&rgba, width, 60, 30), [0, 0, 0, 0]);

    worker.stop();
    assert!(!sender_names().contains(&name), "止めても一覧に残っている");
    assert!(
        sender_info(&name).is_none(),
        "止めても送り手の情報が残っている"
    );
}

#[test]
fn 同じ名前の送り手が動いていれば番号を付ける() {
    let name = test_sender_name();
    let first = Worker::start(StartOptions {
        sender_name: name.clone(),
        width: 16,
        height: 16,
    })
    .unwrap();
    let second = Worker::start(StartOptions {
        sender_name: name.clone(),
        width: 16,
        height: 16,
    })
    .unwrap();
    assert_eq!(second.started.sender_name, format!("{name}_1"));
    assert!(sender_names().contains(&format!("{name}_1")));
    second.stop();
    first.stop();
    assert!(!sender_names().iter().any(|n| n.starts_with(&name)));
}

// ---- WebGL のレンダラーとの比べ合わせ ----

fn testdata_dir() -> PathBuf {
    let here = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(file!());
    here.parent().unwrap().join("testdata")
}

struct Comparison {
    within: usize,
    total: usize,
    max_diff: i32,
}

fn compare(actual: &[u8], expected: &[u8], tolerance: i32) -> Comparison {
    let mut within = 0;
    let mut max_diff = 0;
    for (a, e) in actual
        .as_chunks::<4>()
        .0
        .iter()
        .zip(expected.as_chunks::<4>().0)
    {
        let d = a
            .iter()
            .zip(e.iter())
            .map(|(&x, &y)| (x as i32 - y as i32).abs())
            .max()
            .unwrap();
        max_diff = max_diff.max(d);
        if d <= tolerance {
            within += 1;
        }
    }
    Comparison {
        within,
        total: expected.len() / 4,
        max_diff,
    }
}

// テクスチャのメッセージ（送った順）を反映してから描く
fn render_scene(renderer: &mut Renderer, textures: &[Vec<u8>], frame: &Frame) {
    for message in textures {
        let update = decode_textures(message).unwrap();
        for id in update.removals {
            renderer.remove_texture(id);
        }
        for (id, data) in update.upserts {
            let img = image::decode(data).unwrap();
            renderer.set_texture(id, &img).unwrap();
        }
    }
    renderer.render(frame).unwrap();
    renderer.publish();
}

// <場面>.textures-0.bin、-1.bin、…（送った順）
fn scene_textures(dir: &std::path::Path, scene: &str) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    while let Ok(bytes) = std::fs::read(dir.join(format!("{scene}.textures-{}.bin", out.len()))) {
        out.push(bytes);
    }
    out
}

#[test]
fn プレビューの_webgl_と見た目が同じ() {
    let dir = testdata_dir();
    let mut scenes: Vec<String> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{} を読めない: {e}", dir.display()))
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter_map(|n| n.strip_suffix(".frame.bin").map(str::to_string))
        .collect();
    scenes.sort();
    assert!(!scenes.is_empty(), "{} に場面が無い", dir.display());
    let mut failures = Vec::new();
    for scene in &scenes {
        let frame_bytes = std::fs::read(dir.join(format!("{scene}.frame.bin"))).unwrap();
        let textures = scene_textures(&dir, scene);
        assert!(!textures.is_empty(), "{scene} のテクスチャが無い");
        let webgl_png = std::fs::read(dir.join(format!("{scene}.webgl.png"))).unwrap();
        // WebGL の絵は乗算済みの RGBA をそのまま PNG に入れてある
        let (width, height, expected) = image::decode_png(&webgl_png).unwrap();
        let frame = decode_frame(&frame_bytes).unwrap();
        let mut renderer =
            Renderer::new(create_device(true).unwrap(), width, height, false).unwrap();
        render_scene(&mut renderer, &textures, &frame);

        // 描いた絵（乗算済み）と、送る絵（乗算していない）を受け手が乗算し直したもの
        let premultiplied = renderer.read_premultiplied().unwrap();
        let sent: Vec<u8> = renderer
            .read_output()
            .unwrap()
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| {
                [
                    mul_div_255(p[0], p[3]),
                    mul_div_255(p[1], p[3]),
                    mul_div_255(p[2], p[3]),
                    p[3],
                ]
            })
            .collect();
        for (label, actual) in [("描いた絵", &premultiplied), ("送った絵", &sent)] {
            let c = compare(actual, &expected, 3);
            let ratio = c.within as f64 / c.total as f64;
            println!(
                "{scene}（{width}×{height}、{}、MSAA {}）{label}: ±3 以内 {:.4}%、最大の差 {}",
                if renderer.is_warp() { "WARP" } else { "GPU" },
                renderer.samples(),
                ratio * 100.0,
                c.max_diff
            );
            if ratio < 0.99 {
                failures.push(format!("{scene} {label}: ±3 以内が {:.3}%", ratio * 100.0));
            }
        }
        // 差を目で確かめられるように書き出す（target の下。リポジトリには入れない）
        if std::env::var_os("SPOUT_COMPARE_DUMP").is_some() {
            let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("spout-compare");
            std::fs::create_dir_all(&out).unwrap();
            std::fs::write(
                out.join(format!("{scene}.d3d11.png")),
                encode_png(width, height, &premultiplied),
            )
            .unwrap();
        }
    }
    assert!(failures.is_empty(), "{failures:?}");
}

#[test]
#[ignore = "時間を測る（cargo test -- --ignored --nocapture）"]
fn フルhdで_60fps_に間に合う() {
    let dir = testdata_dir();
    let frame_bytes = std::fs::read(dir.join("sample-model.frame.bin")).unwrap();
    let name = test_sender_name();
    let worker = Worker::start(StartOptions {
        sender_name: name.clone(),
        width: 1920,
        height: 1080,
    })
    .unwrap();
    for textures in scene_textures(&dir, "sample-model") {
        worker.set_textures(textures).unwrap();
    }
    // デコードと描画（送信のスレッドの中の時間）を測るため、フレームの数が増えるのを待ちながら送る
    let frames = 300;
    let start = Instant::now();
    let before = frame_count(&name).unwrap_or(0);
    for i in 0..frames {
        worker.submit(frame_bytes.clone()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while frame_count(&name).unwrap_or(0) < before + i + 1 {
            assert!(Instant::now() < deadline, "フレームが送られない");
            std::thread::yield_now();
        }
    }
    let per_frame = start.elapsed().as_secs_f64() * 1000.0 / frames as f64;
    println!(
        "1920×1080: 1 フレーム {per_frame:.2} ms（{:.0} fps 相当、{} 品目）",
        1000.0 / per_frame,
        decode_frame(&frame_bytes).unwrap().items.len()
    );
    worker.stop();
    assert!(per_frame < 1000.0 / 60.0, "1 フレーム {per_frame:.2} ms");
}
