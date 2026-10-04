// D3D11 の描画。規則は WebGL のレンダラー（packages/render/src/webgl-renderer.ts・shaders.ts・blend.ts）と同じ:
// - 色はすべて乗算済みアルファ。素材はミップマップを作り、線形（ミップも線形）で引く
// - マスクは画面と同じ大きさの 1 チャンネルのテクスチャに、マスク元のアルファ × 不透明度を MAX で描く（範囲の和）。
//   本描画では画素の位置で読み、反転なら 1 − m を掛ける
// - 合成: 通常 (1, 1−αs)、乗算 (dst, 1−αs)、スクリーン (1, 1−s)、加算 (1, 1)。アルファにも同じ係数
// - プレビューの canvas（antialias: true）と同じく 4× の MSAA で描き、解決する
// 解決した絵（乗算済み）を、乗算していない BGRA8 にして共有テクスチャへ書く（OBS の Spout2 のプラグインの既定の合成に合わせる）

use super::frame::{BlendMode, Frame};
use super::image::Image;
use super::plan::{plan_frame, view_to_clip, MaskUse, FLOATS_PER_VERTEX};
use std::collections::HashMap;
use windows::core::{Interface, PCSTR};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::Fxc::{D3DCompile, D3DCOMPILE_OPTIMIZATION_LEVEL3};
use windows::Win32::Graphics::Direct3D::{
    ID3DBlob, D3D_DRIVER_TYPE, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP, D3D_FEATURE_LEVEL,
    D3D_FEATURE_LEVEL_10_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
    D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST,
};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R32G32_FLOAT, DXGI_FORMAT_R32_UINT,
    DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_FORMAT_R8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{IDXGIAdapter, IDXGIResource};

const SHADERS: &str = r#"
cbuffer Params : register(b0) {
    float2 u_scale;
    float2 u_offset;
    float u_opacity;
    int u_maskMode;
    float2 u_pad;
};
Texture2D u_texture : register(t0);
Texture2D<float> u_mask : register(t1);
SamplerState u_sampler : register(s0);

struct VsIn { float2 position : POSITION; float2 uv : TEXCOORD0; };
struct PsIn { float4 position : SV_Position; float2 uv : TEXCOORD0; };

PsIn vs_main(VsIn i) {
    PsIn o;
    o.position = float4(i.position * u_scale + u_offset, 0.0, 1.0);
    o.uv = i.uv;
    return o;
}

float4 ps_draw(PsIn i) : SV_Target {
    float4 color = u_texture.Sample(u_sampler, i.uv) * u_opacity;
    if (u_maskMode != 0) {
        float m = u_mask.Load(int3(int2(i.position.xy), 0));
        color *= u_maskMode == 2 ? 1.0 - m : m;
    }
    return color;
}

float4 ps_mask(PsIn i) : SV_Target {
    return float4(u_texture.Sample(u_sampler, i.uv).a * u_opacity, 0.0, 0.0, 0.0);
}

PsIn vs_full(uint id : SV_VertexID) {
    PsIn o;
    float2 p = float2((id << 1) & 2, id & 2);
    o.position = float4(p * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
    o.uv = p;
    return o;
}

float4 ps_straight(PsIn i) : SV_Target {
    float4 c = u_texture.Load(int3(int2(i.position.xy), 0));
    return c.a > 0.0 ? float4(c.rgb / c.a, c.a) : float4(0.0, 0.0, 0.0, 0.0);
}
"#;

pub const MSAA_SAMPLES: u32 = 4;

fn err(what: &str) -> impl Fn(windows::core::Error) -> String + '_ {
    move |e| format!("{what}: {e}")
}

pub struct Gpu {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    #[cfg_attr(not(test), allow(dead_code))]
    pub warp: bool,
}

// GPU（既定のアダプター）で D3D11 を使う。allow_warp なら、使えないときにソフトウェアの描画（WARP）にする（テスト用）
pub fn create_device(allow_warp: bool) -> Result<Gpu, String> {
    let mut last = String::new();
    let drivers: &[D3D_DRIVER_TYPE] = if allow_warp {
        &[D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP]
    } else {
        &[D3D_DRIVER_TYPE_HARDWARE]
    };
    for &driver in drivers {
        for levels in [
            &[
                D3D_FEATURE_LEVEL_11_1,
                D3D_FEATURE_LEVEL_11_0,
                D3D_FEATURE_LEVEL_10_1,
                D3D_FEATURE_LEVEL_10_0,
            ][..],
            &[
                D3D_FEATURE_LEVEL_11_0,
                D3D_FEATURE_LEVEL_10_1,
                D3D_FEATURE_LEVEL_10_0,
            ][..],
        ] {
            let mut device = None;
            let mut context = None;
            let mut level = D3D_FEATURE_LEVEL::default();
            let r = unsafe {
                D3D11CreateDevice(
                    None::<&IDXGIAdapter>,
                    driver,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    Some(levels),
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    Some(&mut level),
                    Some(&mut context),
                )
            };
            match (r, device, context) {
                (Ok(()), Some(device), Some(context)) => {
                    return Ok(Gpu {
                        device,
                        context,
                        warp: driver == D3D_DRIVER_TYPE_WARP,
                    })
                }
                (Err(e), _, _) => last = e.to_string(),
                _ => last = "デバイスが返らない".into(),
            }
        }
    }
    Err(format!("D3D11 のデバイスを作れない: {last}"))
}

fn compile(source: &str, entry: &str, target: &str) -> Result<Vec<u8>, String> {
    let entry_c = std::ffi::CString::new(entry).unwrap();
    let target_c = std::ffi::CString::new(target).unwrap();
    let mut code: Option<ID3DBlob> = None;
    let mut errors: Option<ID3DBlob> = None;
    let r = unsafe {
        D3DCompile(
            source.as_ptr().cast(),
            source.len(),
            PCSTR::null(),
            None,
            None,
            PCSTR(entry_c.as_ptr().cast()),
            PCSTR(target_c.as_ptr().cast()),
            D3DCOMPILE_OPTIMIZATION_LEVEL3,
            0,
            &mut code,
            Some(&mut errors),
        )
    };
    let blob_bytes = |b: &ID3DBlob| unsafe {
        std::slice::from_raw_parts(b.GetBufferPointer().cast::<u8>(), b.GetBufferSize()).to_vec()
    };
    match (r, code) {
        (Ok(()), Some(code)) => Ok(blob_bytes(&code)),
        (r, _) => {
            let log = errors
                .map(|e| String::from_utf8_lossy(&blob_bytes(&e)).into_owned())
                .unwrap_or_default();
            Err(format!(
                "シェーダー {entry} のコンパイルに失敗した: {r:?} {log}"
            ))
        }
    }
}

struct GpuTexture {
    _texture: ID3D11Texture2D,
    srv: ID3D11ShaderResourceView,
    width: u32,
    height: u32,
}

struct Target {
    texture: ID3D11Texture2D,
    rtv: ID3D11RenderTargetView,
    srv: Option<ID3D11ShaderResourceView>,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Constants {
    scale: [f32; 2],
    offset: [f32; 2],
    opacity: f32,
    mask_mode: i32,
    pad: [f32; 2],
}

struct DynamicBuffer {
    buffer: Option<ID3D11Buffer>,
    capacity: usize, // バイト
    bind: D3D11_BIND_FLAG,
}

pub struct Renderer {
    gpu: Gpu,
    width: u32,
    height: u32,
    samples: u32,
    color: Target,            // 描き先（MSAA のときは複数サンプル）
    resolved: Option<Target>, // MSAA を解決したもの（乗算済み）
    output: Target,           // 送るもの（乗算していない BGRA8。shared なら共有テクスチャ）
    masks: Vec<Target>,
    vs: ID3D11VertexShader,
    vs_full: ID3D11VertexShader,
    ps_draw: ID3D11PixelShader,
    ps_mask: ID3D11PixelShader,
    ps_straight: ID3D11PixelShader,
    layout: ID3D11InputLayout,
    blend_normal: ID3D11BlendState,
    blend_multiply: ID3D11BlendState,
    blend_screen: ID3D11BlendState,
    blend_add: ID3D11BlendState,
    blend_max: ID3D11BlendState,
    blend_none: ID3D11BlendState,
    raster: ID3D11RasterizerState,
    sampler: ID3D11SamplerState,
    vertices: DynamicBuffer,
    indices: DynamicBuffer,
    constants: ID3D11Buffer,
    textures: HashMap<u32, GpuTexture>,
    max_texture_size: u32,
}

fn texture_desc(
    width: u32,
    height: u32,
    format: DXGI_FORMAT,
    samples: u32,
    bind: u32,
    misc: u32,
) -> D3D11_TEXTURE2D_DESC {
    D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: format,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: samples,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: bind,
        CPUAccessFlags: 0,
        MiscFlags: misc,
    }
}

fn blend_state(
    device: &ID3D11Device,
    enable: bool,
    color: (D3D11_BLEND, D3D11_BLEND),
    alpha: (D3D11_BLEND, D3D11_BLEND),
    op: D3D11_BLEND_OP,
) -> Result<ID3D11BlendState, String> {
    let mut desc = D3D11_BLEND_DESC::default();
    desc.RenderTarget[0] = D3D11_RENDER_TARGET_BLEND_DESC {
        BlendEnable: enable.into(),
        SrcBlend: color.0,
        DestBlend: color.1,
        BlendOp: op,
        SrcBlendAlpha: alpha.0,
        DestBlendAlpha: alpha.1,
        BlendOpAlpha: op,
        RenderTargetWriteMask: D3D11_COLOR_WRITE_ENABLE_ALL.0 as u8,
    };
    let mut state = None;
    unsafe { device.CreateBlendState(&desc, Some(&mut state)) }
        .map_err(err("合成の設定を作れない"))?;
    state.ok_or_else(|| "合成の設定を作れない".into())
}

impl Renderer {
    // width × height の透過の絵を描く。shared なら送り先を他のプロセスと共有できるテクスチャにする
    pub fn new(gpu: Gpu, width: u32, height: u32, shared: bool) -> Result<Self, String> {
        if width == 0 || height == 0 || width > 16384 || height > 16384 {
            return Err(format!("出力の大きさが合わない: {width}×{height}"));
        }
        let device = gpu.device.clone();
        let vs_code = compile(SHADERS, "vs_main", "vs_4_0")?;
        let create_vs = |code: &[u8]| -> Result<ID3D11VertexShader, String> {
            let mut s = None;
            unsafe { device.CreateVertexShader(code, None, Some(&mut s)) }
                .map_err(err("シェーダーを作れない"))?;
            s.ok_or_else(|| "シェーダーを作れない".into())
        };
        let create_ps = |entry: &str| -> Result<ID3D11PixelShader, String> {
            let code = compile(SHADERS, entry, "ps_4_0")?;
            let mut s = None;
            unsafe { device.CreatePixelShader(&code, None, Some(&mut s)) }
                .map_err(err("シェーダーを作れない"))?;
            s.ok_or_else(|| "シェーダーを作れない".into())
        };
        let vs = create_vs(&vs_code)?;
        let vs_full = create_vs(&compile(SHADERS, "vs_full", "vs_4_0")?)?;
        let ps_draw = create_ps("ps_draw")?;
        let ps_mask = create_ps("ps_mask")?;
        let ps_straight = create_ps("ps_straight")?;
        let elements = [
            D3D11_INPUT_ELEMENT_DESC {
                SemanticName: PCSTR(c"POSITION".as_ptr().cast()),
                SemanticIndex: 0,
                Format: DXGI_FORMAT_R32G32_FLOAT,
                InputSlot: 0,
                AlignedByteOffset: 0,
                InputSlotClass: D3D11_INPUT_PER_VERTEX_DATA,
                InstanceDataStepRate: 0,
            },
            D3D11_INPUT_ELEMENT_DESC {
                SemanticName: PCSTR(c"TEXCOORD".as_ptr().cast()),
                SemanticIndex: 0,
                Format: DXGI_FORMAT_R32G32_FLOAT,
                InputSlot: 0,
                AlignedByteOffset: 8,
                InputSlotClass: D3D11_INPUT_PER_VERTEX_DATA,
                InstanceDataStepRate: 0,
            },
        ];
        let mut layout = None;
        unsafe { device.CreateInputLayout(&elements, &vs_code, Some(&mut layout)) }
            .map_err(err("頂点の形式を作れない"))?;

        let one = (D3D11_BLEND_ONE, D3D11_BLEND_ONE);
        let blend_normal = blend_state(
            &device,
            true,
            (D3D11_BLEND_ONE, D3D11_BLEND_INV_SRC_ALPHA),
            (D3D11_BLEND_ONE, D3D11_BLEND_INV_SRC_ALPHA),
            D3D11_BLEND_OP_ADD,
        )?;
        // アルファのチャンネルには色の係数が使えないので、同じ意味のアルファの係数にする（DST_COLOR → DEST_ALPHA など）
        let blend_multiply = blend_state(
            &device,
            true,
            (D3D11_BLEND_DEST_COLOR, D3D11_BLEND_INV_SRC_ALPHA),
            (D3D11_BLEND_DEST_ALPHA, D3D11_BLEND_INV_SRC_ALPHA),
            D3D11_BLEND_OP_ADD,
        )?;
        let blend_screen = blend_state(
            &device,
            true,
            (D3D11_BLEND_ONE, D3D11_BLEND_INV_SRC_COLOR),
            (D3D11_BLEND_ONE, D3D11_BLEND_INV_SRC_ALPHA),
            D3D11_BLEND_OP_ADD,
        )?;
        let blend_add = blend_state(&device, true, one, one, D3D11_BLEND_OP_ADD)?;
        let blend_max = blend_state(&device, true, one, one, D3D11_BLEND_OP_MAX)?;
        let blend_none = blend_state(&device, false, one, one, D3D11_BLEND_OP_ADD)?;

        let raster_desc = D3D11_RASTERIZER_DESC {
            FillMode: D3D11_FILL_SOLID,
            CullMode: D3D11_CULL_NONE,
            FrontCounterClockwise: false.into(),
            DepthBias: 0,
            DepthBiasClamp: 0.0,
            SlopeScaledDepthBias: 0.0,
            DepthClipEnable: true.into(),
            ScissorEnable: false.into(),
            MultisampleEnable: true.into(),
            AntialiasedLineEnable: false.into(),
        };
        let mut raster = None;
        unsafe { device.CreateRasterizerState(&raster_desc, Some(&mut raster)) }
            .map_err(err("ラスタライザーの設定を作れない"))?;
        let sampler_desc = D3D11_SAMPLER_DESC {
            Filter: D3D11_FILTER_MIN_MAG_MIP_LINEAR,
            AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
            AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
            AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
            MipLODBias: 0.0,
            MaxAnisotropy: 1,
            ComparisonFunc: D3D11_COMPARISON_NEVER,
            BorderColor: [0.0; 4],
            MinLOD: 0.0,
            MaxLOD: f32::MAX,
        };
        let mut sampler = None;
        unsafe { device.CreateSamplerState(&sampler_desc, Some(&mut sampler)) }
            .map_err(err("サンプラーを作れない"))?;
        let constants_desc = D3D11_BUFFER_DESC {
            ByteWidth: std::mem::size_of::<Constants>() as u32,
            Usage: D3D11_USAGE_DYNAMIC,
            BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
            CPUAccessFlags: D3D11_CPU_ACCESS_WRITE.0 as u32,
            MiscFlags: 0,
            StructureByteStride: 0,
        };
        let mut constants = None;
        unsafe { device.CreateBuffer(&constants_desc, None, Some(&mut constants)) }
            .map_err(err("定数のバッファを作れない"))?;

        // 4× の MSAA が使えなければ 1 サンプルで描く
        let quality = unsafe {
            device.CheckMultisampleQualityLevels(DXGI_FORMAT_R8G8B8A8_UNORM, MSAA_SAMPLES)
        }
        .unwrap_or(0);
        let samples = if quality > 0 { MSAA_SAMPLES } else { 1 };
        let max_texture_size = if unsafe { device.GetFeatureLevel() }.0 >= D3D_FEATURE_LEVEL_11_0.0
        {
            16384
        } else {
            8192
        };

        let rt = D3D11_BIND_RENDER_TARGET.0 as u32;
        let sr = D3D11_BIND_SHADER_RESOURCE.0 as u32;
        let color = if samples > 1 {
            Self::target(
                &device,
                texture_desc(width, height, DXGI_FORMAT_R8G8B8A8_UNORM, samples, rt, 0),
                false,
            )?
        } else {
            Self::target(
                &device,
                texture_desc(width, height, DXGI_FORMAT_R8G8B8A8_UNORM, 1, rt | sr, 0),
                true,
            )?
        };
        let resolved = if samples > 1 {
            Some(Self::target(
                &device,
                texture_desc(width, height, DXGI_FORMAT_R8G8B8A8_UNORM, 1, rt | sr, 0),
                true,
            )?)
        } else {
            None
        };
        let misc = if shared {
            D3D11_RESOURCE_MISC_SHARED.0 as u32
        } else {
            0
        };
        let output = Self::target(
            &device,
            texture_desc(width, height, DXGI_FORMAT_B8G8R8A8_UNORM, 1, rt | sr, misc),
            false,
        )?;

        Ok(Self {
            gpu,
            width,
            height,
            samples,
            color,
            resolved,
            output,
            masks: Vec::new(),
            vs,
            vs_full,
            ps_draw,
            ps_mask,
            ps_straight,
            layout: layout.ok_or("頂点の形式を作れない")?,
            blend_normal,
            blend_multiply,
            blend_screen,
            blend_add,
            blend_max,
            blend_none,
            raster: raster.ok_or("ラスタライザーの設定を作れない")?,
            sampler: sampler.ok_or("サンプラーを作れない")?,
            vertices: DynamicBuffer {
                buffer: None,
                capacity: 0,
                bind: D3D11_BIND_VERTEX_BUFFER,
            },
            indices: DynamicBuffer {
                buffer: None,
                capacity: 0,
                bind: D3D11_BIND_INDEX_BUFFER,
            },
            constants: constants.ok_or("定数のバッファを作れない")?,
            textures: HashMap::new(),
            max_texture_size,
        })
    }

    fn target(
        device: &ID3D11Device,
        desc: D3D11_TEXTURE2D_DESC,
        srv: bool,
    ) -> Result<Target, String> {
        let mut texture = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture)) }
            .map_err(err("描き先のテクスチャを作れない"))?;
        let texture: ID3D11Texture2D = texture.ok_or("描き先のテクスチャを作れない")?;
        let mut rtv = None;
        unsafe { device.CreateRenderTargetView(&texture, None, Some(&mut rtv)) }
            .map_err(err("描き先を作れない"))?;
        let srv = if srv {
            let mut view = None;
            unsafe { device.CreateShaderResourceView(&texture, None, Some(&mut view)) }
                .map_err(err("テクスチャの読み口を作れない"))?;
            view
        } else {
            None
        };
        Ok(Target {
            texture,
            rtv: rtv.ok_or("描き先を作れない")?,
            srv,
        })
    }

    pub fn samples(&self) -> u32 {
        self.samples
    }

    #[cfg(test)]
    pub fn is_warp(&self) -> bool {
        self.gpu.warp
    }

    // 送り先のテクスチャ（共有テクスチャ）の DXGI の共有ハンドル（Spout は 32 ビットで渡す）
    pub fn share_handle(&self) -> Result<u32, String> {
        let resource: IDXGIResource = self
            .output
            .texture
            .cast()
            .map_err(err("共有テクスチャを開けない"))?;
        let handle =
            unsafe { resource.GetSharedHandle() }.map_err(err("共有ハンドルを取れない"))?;
        Ok(handle.0 as usize as u32)
    }

    // 乗算済みの画像からミップマップつきのテクスチャを作る（同じ番号のものは差し替える）
    pub fn set_texture(&mut self, id: u32, image: &Image) -> Result<(), String> {
        self.textures.remove(&id);
        if image.width == 0 || image.height == 0 {
            return Err(format!("画像が空なので描かない（テクスチャ {id}）"));
        }
        if image.width > self.max_texture_size || image.height > self.max_texture_size {
            return Err(format!(
                "画像がテクスチャの上限（{}px）を超えるので描かない（テクスチャ {id}、{}×{}）",
                self.max_texture_size, image.width, image.height
            ));
        }
        let device = &self.gpu.device;
        let mut desc = texture_desc(
            image.width,
            image.height,
            DXGI_FORMAT_R8G8B8A8_UNORM,
            1,
            (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0) as u32,
            D3D11_RESOURCE_MISC_GENERATE_MIPS.0 as u32,
        );
        desc.MipLevels = 0; // すべての段
        let mut texture = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture)) }
            .map_err(err("テクスチャを作れない"))?;
        let texture: ID3D11Texture2D = texture.ok_or("テクスチャを作れない")?;
        let mut srv = None;
        unsafe { device.CreateShaderResourceView(&texture, None, Some(&mut srv)) }
            .map_err(err("テクスチャの読み口を作れない"))?;
        let srv: ID3D11ShaderResourceView = srv.ok_or("テクスチャの読み口を作れない")?;
        unsafe {
            self.gpu.context.UpdateSubresource(
                &texture,
                0,
                None,
                image.pixels.as_ptr().cast(),
                image.width * 4,
                0,
            );
            self.gpu.context.GenerateMips(&srv);
        }
        self.textures.insert(
            id,
            GpuTexture {
                _texture: texture,
                srv,
                width: image.width,
                height: image.height,
            },
        );
        Ok(())
    }

    pub fn remove_texture(&mut self, id: u32) {
        self.textures.remove(&id);
    }

    fn upload(&mut self, which: Which, data: &[u8]) -> Result<(), String> {
        let buffer = match which {
            Which::Vertices => &mut self.vertices,
            Which::Indices => &mut self.indices,
        };
        if buffer.capacity < data.len() || buffer.buffer.is_none() {
            let mut capacity = buffer.capacity.max(64 * 1024);
            while capacity < data.len() {
                capacity *= 2;
            }
            let desc = D3D11_BUFFER_DESC {
                ByteWidth: capacity as u32,
                Usage: D3D11_USAGE_DYNAMIC,
                BindFlags: buffer.bind.0 as u32,
                CPUAccessFlags: D3D11_CPU_ACCESS_WRITE.0 as u32,
                MiscFlags: 0,
                StructureByteStride: 0,
            };
            let mut b = None;
            unsafe { self.gpu.device.CreateBuffer(&desc, None, Some(&mut b)) }
                .map_err(err("頂点のバッファを作れない"))?;
            buffer.buffer = b;
            buffer.capacity = capacity;
        }
        let b = buffer.buffer.as_ref().ok_or("頂点のバッファが無い")?;
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.gpu
                .context
                .Map(b, 0, D3D11_MAP_WRITE_DISCARD, 0, Some(&mut mapped))
                .map_err(err("バッファに書けない"))?;
            std::ptr::copy_nonoverlapping(data.as_ptr(), mapped.pData.cast::<u8>(), data.len());
            self.gpu.context.Unmap(b, 0);
        }
        Ok(())
    }

    fn set_constants(&self, c: Constants) -> Result<(), String> {
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.gpu
                .context
                .Map(
                    &self.constants,
                    0,
                    D3D11_MAP_WRITE_DISCARD,
                    0,
                    Some(&mut mapped),
                )
                .map_err(err("定数を書けない"))?;
            std::ptr::write_unaligned(mapped.pData.cast::<Constants>(), c);
            self.gpu.context.Unmap(&self.constants, 0);
        }
        Ok(())
    }

    fn mask_target(&mut self, index: usize) -> Result<(), String> {
        while self.masks.len() <= index {
            let rt = D3D11_BIND_RENDER_TARGET.0 as u32;
            let sr = D3D11_BIND_SHADER_RESOURCE.0 as u32;
            let desc = texture_desc(self.width, self.height, DXGI_FORMAT_R8_UNORM, 1, rt | sr, 0);
            let t = Self::target(&self.gpu.device, desc, true)?;
            self.masks.push(t);
        }
        Ok(())
    }

    fn blend_for(&self, mode: BlendMode) -> &ID3D11BlendState {
        match mode {
            BlendMode::Normal => &self.blend_normal,
            BlendMode::Multiply => &self.blend_multiply,
            BlendMode::Screen => &self.blend_screen,
            BlendMode::Add => &self.blend_add,
        }
    }

    // 1フレームを描く（乗算済みの絵ができる。送るのは publish）
    pub fn render(&mut self, frame: &Frame) -> Result<(), String> {
        let background_size = match frame.background {
            super::frame::Background::Image(id) => {
                self.textures.get(&id).map(|t| (t.width, t.height))
            }
            _ => None,
        };
        let plan = plan_frame(
            frame,
            (self.width, self.height),
            |id| self.textures.contains_key(&id),
            background_size,
        );
        let vertex_bytes: Vec<u8> = plan.vertices.iter().flat_map(|v| v.to_le_bytes()).collect();
        let index_bytes: Vec<u8> = plan.indices.iter().flat_map(|v| v.to_le_bytes()).collect();
        self.upload(Which::Vertices, &vertex_bytes)?;
        self.upload(Which::Indices, &index_bytes)?;
        for i in 0..plan.masks.len() {
            self.mask_target(i)?;
        }

        let ctx = &self.gpu.context;
        let viewport = D3D11_VIEWPORT {
            TopLeftX: 0.0,
            TopLeftY: 0.0,
            Width: self.width as f32,
            Height: self.height as f32,
            MinDepth: 0.0,
            MaxDepth: 1.0,
        };
        let stride = (FLOATS_PER_VERTEX * 4) as u32;
        let offset = 0u32;
        let (scale, clip_offset) = view_to_clip(&frame.view, self.width, self.height);
        let item_constants = |opacity: f32, mask_mode: i32| Constants {
            scale,
            offset: clip_offset,
            opacity,
            mask_mode,
            pad: [0.0; 2],
        };
        unsafe {
            ctx.ClearState();
            ctx.IASetInputLayout(&self.layout);
            ctx.IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            ctx.IASetVertexBuffers(
                0,
                1,
                Some(&self.vertices.buffer.clone()),
                Some(&stride),
                Some(&offset),
            );
            ctx.IASetIndexBuffer(self.indices.buffer.as_ref(), DXGI_FORMAT_R32_UINT, 0);
            ctx.VSSetShader(&self.vs, None);
            ctx.VSSetConstantBuffers(0, Some(&[Some(self.constants.clone())]));
            ctx.PSSetConstantBuffers(0, Some(&[Some(self.constants.clone())]));
            ctx.PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
            ctx.RSSetState(&self.raster);
            ctx.RSSetViewports(Some(&[viewport]));
        }

        // マスク
        if !plan.masks.is_empty() {
            unsafe {
                ctx.PSSetShader(&self.ps_mask, None);
                ctx.OMSetBlendState(&self.blend_max, None, 0xffff_ffff);
            }
            for (m, sources) in plan.masks.iter().enumerate() {
                let target = &self.masks[m];
                unsafe {
                    ctx.OMSetRenderTargets(Some(&[Some(target.rtv.clone())]), None);
                    ctx.ClearRenderTargetView(&target.rtv, &[0.0; 4]);
                }
                for &s in sources {
                    let p = plan.prepared[s];
                    let Some(texture) = self.textures.get(&p.texture) else {
                        continue;
                    };
                    self.set_constants(item_constants(p.opacity, 0))?;
                    unsafe {
                        ctx.PSSetShaderResources(0, Some(&[Some(texture.srv.clone())]));
                        ctx.DrawIndexed(p.count, p.first, 0);
                    }
                }
            }
        }

        // 背景 → 品目
        unsafe {
            ctx.OMSetRenderTargets(Some(&[Some(self.color.rtv.clone())]), None);
            ctx.ClearRenderTargetView(&self.color.rtv, &plan.clear);
            ctx.PSSetShader(&self.ps_draw, None);
        }
        if let Some(texture) = plan.background_image.and_then(|id| self.textures.get(&id)) {
            self.set_constants(Constants {
                scale: [1.0, 1.0],
                offset: [0.0, 0.0],
                opacity: 1.0,
                mask_mode: 0,
                pad: [0.0; 2],
            })?;
            unsafe {
                ctx.OMSetBlendState(&self.blend_normal, None, 0xffff_ffff);
                ctx.PSSetShaderResources(0, Some(&[Some(texture.srv.clone()), None]));
                ctx.DrawIndexed(6, 0, 0);
            }
        }
        for d in &plan.draws {
            let p = plan.prepared[d.prepared];
            let Some(texture) = self.textures.get(&p.texture) else {
                continue;
            };
            let (mode, mask) = match d.mask {
                MaskUse::None => (0, None),
                MaskUse::Normal(m) => (1, self.masks[m].srv.clone()),
                MaskUse::Inverted(m) => (2, self.masks[m].srv.clone()),
            };
            self.set_constants(item_constants(p.opacity, mode))?;
            unsafe {
                ctx.OMSetBlendState(self.blend_for(d.blend), None, 0xffff_ffff);
                ctx.PSSetShaderResources(0, Some(&[Some(texture.srv.clone()), mask]));
                ctx.DrawIndexed(p.count, p.first, 0);
            }
        }
        unsafe {
            ctx.PSSetShaderResources(0, Some(&[None, None]));
            ctx.OMSetRenderTargets(None, None);
            if let Some(resolved) = &self.resolved {
                ctx.ResolveSubresource(
                    &resolved.texture,
                    0,
                    &self.color.texture,
                    0,
                    DXGI_FORMAT_R8G8B8A8_UNORM,
                );
            }
        }
        Ok(())
    }

    // 描いた絵を、乗算していない BGRA8 にして送り先へ書く（共有テクスチャのミューテックスを持っている間に呼ぶ）
    pub fn publish(&self) {
        let source = self.resolved.as_ref().unwrap_or(&self.color);
        let ctx = &self.gpu.context;
        let viewport = D3D11_VIEWPORT {
            TopLeftX: 0.0,
            TopLeftY: 0.0,
            Width: self.width as f32,
            Height: self.height as f32,
            MinDepth: 0.0,
            MaxDepth: 1.0,
        };
        unsafe {
            ctx.ClearState();
            ctx.IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            ctx.VSSetShader(&self.vs_full, None);
            ctx.PSSetShader(&self.ps_straight, None);
            ctx.PSSetShaderResources(0, Some(std::slice::from_ref(&source.srv)));
            ctx.OMSetBlendState(&self.blend_none, None, 0xffff_ffff);
            ctx.RSSetState(&self.raster);
            ctx.RSSetViewports(Some(&[viewport]));
            ctx.OMSetRenderTargets(Some(&[Some(self.output.rtv.clone())]), None);
            ctx.Draw(3, 0);
            ctx.PSSetShaderResources(0, Some(&[None]));
            ctx.OMSetRenderTargets(None, None);
            ctx.Flush();
        }
    }

    // 描いた絵（乗算済みの RGBA8）を読む（テスト用）
    #[cfg(test)]
    pub fn read_premultiplied(&self) -> Result<Vec<u8>, String> {
        let source = self.resolved.as_ref().unwrap_or(&self.color);
        read_texture(&self.gpu.device, &self.gpu.context, &source.texture)
    }

    // 送り先（乗算していない BGRA8）を RGBA8 にして読む（テスト用）
    #[cfg(test)]
    pub fn read_output(&self) -> Result<Vec<u8>, String> {
        let mut pixels = read_texture(&self.gpu.device, &self.gpu.context, &self.output.texture)?;
        for p in pixels.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
        }
        Ok(pixels)
    }
}

enum Which {
    Vertices,
    Indices,
}

// テクスチャを CPU で読む（1 サンプルのもの）。行の詰め物は取り除く（テスト用）
#[cfg(test)]
pub fn read_texture(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    texture: &ID3D11Texture2D,
) -> Result<Vec<u8>, String> {
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: desc.Width,
        Height: desc.Height,
        MipLevels: 1,
        ArraySize: 1,
        Format: desc.Format,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging = None;
    unsafe { device.CreateTexture2D(&staging_desc, None, Some(&mut staging)) }
        .map_err(err("読み出し用のテクスチャを作れない"))?;
    let staging: ID3D11Texture2D = staging.ok_or("読み出し用のテクスチャを作れない")?;
    let row = desc.Width as usize * 4;
    let mut out = vec![0u8; row * desc.Height as usize];
    unsafe {
        context.CopyResource(&staging, texture);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context
            .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .map_err(err("テクスチャを読めない"))?;
        for y in 0..desc.Height as usize {
            let src = std::slice::from_raw_parts(
                mapped.pData.cast::<u8>().add(y * mapped.RowPitch as usize),
                row,
            );
            out[y * row..(y + 1) * row].copy_from_slice(src);
        }
        context.Unmap(&staging, 0);
    }
    Ok(out)
}
