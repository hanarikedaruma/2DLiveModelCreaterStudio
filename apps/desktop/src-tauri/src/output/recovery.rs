use super::frame::{Frame, TextureData};
use super::image::{self, Image};
use std::collections::HashMap;

pub trait Backend {
    fn device_error(&self) -> Option<String>;
    fn set_texture(&mut self, id: u32, image: &Image) -> Result<(), String>;
    fn remove_texture(&mut self, id: u32);
    fn render(&mut self, frame: &Frame) -> Result<bool, String>;
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub state: String,
    pub message: Option<String>,
    pub sent_frames: u64,
    pub failures: u64,
    pub recoveries: u64,
    pub elapsed_seconds: f64,
    pub send_fps: f64,
}

pub struct RecoveringOutput<B> {
    backend: Option<B>,
    textures: HashMap<u32, TextureData>,
    status: RecoveryStatus,
    retry_at: u64,
    streak: u32,
}

impl<B: Backend> RecoveringOutput<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend: Some(backend),
            textures: HashMap::new(),
            retry_at: 0,
            streak: 0,
            status: RecoveryStatus {
                state: "running".into(),
                message: None,
                sent_frames: 0,
                failures: 0,
                recoveries: 0,
                elapsed_seconds: 0.0,
                send_fps: 0.0,
            },
        }
    }
    pub fn backend(&self) -> Option<&B> {
        self.backend.as_ref()
    }
    pub fn status(&self, now_ms: u64) -> RecoveryStatus {
        let mut status = self.status.clone();
        status.elapsed_seconds = now_ms as f64 / 1000.0;
        status.send_fps = if now_ms > 0 {
            status.sent_frames as f64 * 1000.0 / now_ms as f64
        } else {
            0.0
        };
        status
    }
    fn fail(&mut self, message: String, now_ms: u64) {
        self.backend.take();
        self.status.failures += 1;
        self.status.state = "recovering".into();
        self.status.message = Some(message);
        self.streak = self.streak.saturating_add(1);
        self.retry_at =
            now_ms.saturating_add((100u64 << self.streak.min(7).saturating_sub(1)).min(5000));
    }
    pub fn remove_texture(&mut self, id: u32) {
        self.textures.remove(&id);
        if let Some(backend) = self.backend.as_mut() {
            backend.remove_texture(id);
        }
    }
    pub fn set_texture(&mut self, id: u32, data: TextureData, now_ms: u64) -> Result<(), String> {
        // PNGは圧縮したバイトで保持する。復旧のために全素材のRGBAを常駐させない。
        let image = match image::decode(data.clone()) {
            Ok(image) => image,
            Err(e) => {
                self.remove_texture(id);
                return Err(e);
            }
        };
        self.textures.insert(id, data);
        if let Some(backend) = self.backend.as_mut() {
            if let Err(e) = backend.set_texture(id, &image) {
                self.fail(e.clone(), now_ms);
                return Err(e);
            }
        }
        Ok(())
    }
    pub fn render(
        &mut self,
        frame: &Frame,
        now_ms: u64,
        mut open: impl FnMut() -> Result<B, String>,
    ) {
        if let Some(e) = self.backend.as_ref().and_then(Backend::device_error) {
            self.fail(e, now_ms);
        }
        if self.backend.is_none() {
            if now_ms < self.retry_at {
                return;
            }
            let restored = open().and_then(|mut backend| {
                for (&id, data) in &self.textures {
                    backend.set_texture(id, &image::decode(data.clone())?)?;
                }
                Ok(backend)
            });
            match restored {
                Ok(backend) => {
                    self.backend = Some(backend);
                    self.status.recoveries += 1;
                }
                Err(e) => {
                    self.fail(e, now_ms);
                    return;
                }
            }
        }
        let result = self.backend.as_mut().unwrap().render(frame);
        match result {
            Ok(sent) => {
                if sent {
                    self.status.sent_frames += 1;
                }
                self.status.state = "running".into();
                self.status.message = None;
                self.streak = 0;
            }
            Err(e) => self.fail(e, now_ms),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::frame::{Background, View};
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;
    #[derive(Default)]
    struct Probe {
        uploads: Vec<u32>,
        sent: usize,
        drops: usize,
    }
    struct Fake {
        probe: Rc<RefCell<Probe>>,
        lost: bool,
        fail_render: bool,
        busy: bool,
    }
    impl Drop for Fake {
        fn drop(&mut self) {
            self.probe.borrow_mut().drops += 1;
        }
    }
    impl Backend for Fake {
        fn device_error(&self) -> Option<String> {
            self.lost.then(|| "DXGI_ERROR_DEVICE_REMOVED".into())
        }
        fn set_texture(&mut self, id: u32, _: &Image) -> Result<(), String> {
            self.probe.borrow_mut().uploads.push(id);
            Ok(())
        }
        fn remove_texture(&mut self, _: u32) {}
        fn render(&mut self, _: &Frame) -> Result<bool, String> {
            if self.fail_render {
                Err("DXGI_ERROR_DEVICE_RESET".into())
            } else if self.busy {
                Ok(false)
            } else {
                self.probe.borrow_mut().sent += 1;
                Ok(true)
            }
        }
    }
    fn frame() -> Frame {
        Frame {
            view: View {
                scale: 1.0,
                offset_x: 0.0,
                offset_y: 0.0,
            },
            background: Background::Transparent,
            items: vec![],
        }
    }
    fn image() -> TextureData {
        TextureData::Rgba {
            width: 1,
            height: 1,
            pixels: vec![0; 4],
        }
    }
    fn fake(probe: &Rc<RefCell<Probe>>) -> Fake {
        Fake {
            probe: probe.clone(),
            lost: false,
            fail_render: false,
            busy: false,
        }
    }
    #[test]
    fn デバイス消失から素材と最新の更新を復元して送信する() {
        let probe = Rc::new(RefCell::new(Probe::default()));
        let mut backend = fake(&probe);
        backend.lost = true;
        let mut output = RecoveringOutput::new(backend);
        output.set_texture(1, image(), 0).unwrap();
        output.render(&frame(), 0, || Ok(fake(&probe)));
        assert_eq!(probe.borrow().drops, 1);
        output.remove_texture(1);
        output.set_texture(2, image(), 50).unwrap();
        output.render(&frame(), 99, || panic!("早過ぎる再試行"));
        output.render(&frame(), 100, || Ok(fake(&probe)));
        assert_eq!(probe.borrow().uploads, vec![1, 2]);
        assert_eq!(output.status(100).state, "running");
        assert_eq!(output.status(100).sent_frames, 1);
        assert_eq!(output.status(100).failures, 1);
        assert_eq!(output.status(100).recoveries, 1);
    }
    #[test]
    fn 復旧が続けて失敗すると間隔を広げ停止せずに再試行する() {
        let probe = Rc::new(RefCell::new(Probe::default()));
        let mut backend = fake(&probe);
        backend.fail_render = true;
        let mut output = RecoveringOutput::new(backend);
        output.render(&frame(), 0, || Ok(fake(&probe)));
        output.render(&frame(), 100, || Err("復旧失敗".into()));
        output.render(&frame(), 299, || panic!("200msを待つ"));
        output.render(&frame(), 300, || Err("復旧失敗".into()));
        output.render(&frame(), 699, || panic!("400msを待つ"));
        output.render(&frame(), 700, || Ok(fake(&probe)));
        assert_eq!(output.status(700).failures, 3);
        assert_eq!(output.status(700).sent_frames, 1);
        assert_eq!(output.status(700).message, None);
    }
    #[test]
    fn 受け手が読んでいるフレームは送信数にも失敗数にも数えない() {
        let probe = Rc::new(RefCell::new(Probe::default()));
        let mut backend = fake(&probe);
        backend.busy = true;
        let mut output = RecoveringOutput::new(backend);
        output.render(&frame(), 100, || panic!());
        assert_eq!(output.status(100).sent_frames, 0);
        assert_eq!(output.status(100).failures, 0);
    }
}
