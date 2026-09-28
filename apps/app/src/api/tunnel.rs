//! Встроенный мультиплексированный сетевой туннель Bedringh (нативный Rust-аналог ProximaMP Sidecar).
//!
//! Реализует архитектуру Reverse-Proxy Relay из ProximaClient без тяжёлого GraalVM-сайдкара:
//! - Подключение к VDS по WebSocket (`/relay`) с автоматическим переподключением (`ReconnectingTunnel`).
//! - Выделение и сохранение реального публичного TCP/UDP порта на VDS (`30000..30500`).
//! - Мультиплексирование потоков игроков по протоколу `TunnelFrame` (`OPEN_STREAM`, `DATA`, `CLOSE_STREAM`, `UDP_DATA`).
//! - Горячая смена локального порта (`tunnel_set_local_port`) без разрыва публичного адреса.
//! - Локальный клиентский мост (`127.0.0.1:<port>`) для входа в 1 клик из лаунчера без раскрытия IP VDS.

use crate::api::Result;
use base64::Engine;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering},
        Arc, LazyLock,
    },
    time::{Duration, Instant},
};
use tauri::plugin::TauriPlugin;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{mpsc, oneshot, RwLock},
};

const FRAME_OPEN_STREAM: u8 = 0x01;
const FRAME_DATA: u8 = 0x02;
const FRAME_CLOSE_STREAM: u8 = 0x03;
const FRAME_UDP_DATA: u8 = 0x04;

fn encode_frame(frame_type: u8, stream_id: u32, payload: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(5 + payload.len());
    buf.push(frame_type);
    buf.extend_from_slice(&stream_id.to_be_bytes());
    buf.extend_from_slice(payload);
    buf
}

fn decode_frame(data: &[u8]) -> Option<(u8, u32, &[u8])> {
    if data.len() < 5 {
        return None;
    }
    let frame_type = data[0];
    let stream_id = u32::from_be_bytes([data[1], data[2], data[3], data[4]]);
    Some((frame_type, stream_id, &data[5..]))
}

// ─────────────────────────────────────────────────────────────────────
// Состояние активных туннелей хоста и клиентских мостов
// ─────────────────────────────────────────────────────────────────────

struct HostTunnelHandle {
    session_id: String,
    edition: String,
    local_port: Arc<AtomicU16>,
    public_port: Arc<AtomicU16>,
    connected: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
    active_streams: Arc<AtomicUsize>,
    bytes_rx: Arc<AtomicU64>,
    bytes_tx: Arc<AtomicU64>,
    ping_ms: Arc<AtomicU64>,
    task: tokio::task::JoinHandle<()>,
}

struct ClientBridgeHandle {
    session_id: String,
    local_port: u16,
    stop_flag: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}

static HOST_TUNNELS: LazyLock<DashMap<String, Arc<HostTunnelHandle>>> = LazyLock::new(DashMap::new);
static CLIENT_BRIDGES: LazyLock<DashMap<String, Arc<ClientBridgeHandle>>> =
    LazyLock::new(DashMap::new);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatusInfo {
    pub session_id: String,
    pub edition: String,
    pub local_port: u16,
    pub public_port: u16,
    pub connected: bool,
    pub active_streams: usize,
    pub bytes_rx: u64,
    pub bytes_tx: u64,
    pub ping_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClientBridgeInfo {
    pub session_id: String,
    pub local_port: u16,
    pub local_address: String,
}

pub fn init<R: tauri::Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("tunnel")
        .invoke_handler(tauri::generate_handler![
            tunnel_open,
            tunnel_close,
            tunnel_set_local_port,
            tunnel_status,
            tunnel_list,
            tunnel_probe_ping,
            tunnel_connect_client,
            tunnel_disconnect_client,
        ])
        .build()
}

// ─────────────────────────────────────────────────────────────────────
// Минималистичный быстрый клиент WebSocket (RFC 6455 поверх TcpStream)
// ─────────────────────────────────────────────────────────────────────

enum WsFrame {
    Text(String),
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    Close,
}

fn parse_relay_host_port(relay_url: &str) -> (String, u16, String) {
    let trimmed = relay_url.trim().trim_end_matches('/');
    if let Ok(parsed) = url::Url::parse(trimmed) {
        let host = parsed.host_str().unwrap_or("bedringh.duckdns.org").to_string();
        let port = parsed.port().unwrap_or(7700);
        let path = if parsed.path().is_empty() || parsed.path() == "/" {
            "/relay".to_string()
        } else if parsed.path().ends_with("/relay") {
            parsed.path().to_string()
        } else {
            format!("{}/relay", parsed.path().trim_end_matches('/'))
        };
        (host, port, path)
    } else {
        ("bedringh.duckdns.org".to_string(), 7700, "/relay".to_string())
    }
}

async fn ws_connect(relay_url: &str) -> std::io::Result<(TcpStream, Vec<u8>)> {
    let (host, port, path) = parse_relay_host_port(relay_url);
    let addr = format!("{host}:{port}");
    let mut stream = tokio::time::timeout(Duration::from_secs(6), TcpStream::connect(&addr))
        .await
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "connect timeout"))??;
    let _ = stream.set_nodelay(true);

    let mut key_bytes = [0u8; 16];
    for (i, b) in key_bytes.iter_mut().enumerate() {
        *b = (Instant::now().elapsed().subsec_nanos() as u8)
            .wrapping_add((i as u8).wrapping_mul(37))
            ^ 0x5A;
    }
    let sec_key = base64::engine::general_purpose::STANDARD.encode(key_bytes);

    let req = format!(
        "GET {path} HTTP/1.1\r\n\
         Host: {host}:{port}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: {sec_key}\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n"
    );

    stream.write_all(req.as_bytes()).await?;

    let mut resp_buf = Vec::with_capacity(1024);
    let mut tmp = [0u8; 512];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(6), stream.read(&mut tmp))
            .await
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "handshake timeout"))??;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "EOF during WS handshake",
            ));
        }
        resp_buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = resp_buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let header_str = String::from_utf8_lossy(&resp_buf[..pos]);
            if !header_str.starts_with("HTTP/1.1 101") && !header_str.starts_with("HTTP/1.0 101") {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::ConnectionRefused,
                    format!("WS upgrade failed: {}", header_str.lines().next().unwrap_or("")),
                ));
            }
            let leftover = resp_buf[pos + 4..].to_vec();
            return Ok((stream, leftover));
        }
        if resp_buf.len() > 8192 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "WS handshake header too large",
            ));
        }
    }
}

/// Запись клиентского WebSocket-фрейма (по RFC 6455 клиент обязан маскировать фреймы)
fn encode_ws_client_frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let len = payload.len();
    let mut frame = Vec::with_capacity(14 + len);
    frame.push(0x80 | (opcode & 0x0F)); // FIN=1 + opcode

    let mask_key: [u8; 4] = [0x37, 0xFA, 0x21, 0x3D];
    if len <= 125 {
        frame.push(0x80 | (len as u8));
    } else if len <= 65535 {
        frame.push(0x80 | 126);
        frame.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        frame.push(0x80 | 127);
        frame.extend_from_slice(&(len as u64).to_be_bytes());
    }

    frame.extend_from_slice(&mask_key);
    for (i, &b) in payload.iter().enumerate() {
        frame.push(b ^ mask_key[i & 3]);
    }
    frame
}

struct WsReader {
    rd: tokio::net::tcp::OwnedReadHalf,
    buf: Vec<u8>,
}

impl WsReader {
    fn new(rd: tokio::net::tcp::OwnedReadHalf, initial: Vec<u8>) -> Self {
        Self { rd, buf: initial }
    }

    async fn fill_exact(&mut self, needed: usize) -> std::io::Result<()> {
        let mut tmp = [0u8; 16384];
        while self.buf.len() < needed {
            let n = self.rd.read(&mut tmp).await?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "WS EOF",
                ));
            }
            self.buf.extend_from_slice(&tmp[..n]);
        }
        Ok(())
    }

    async fn next_frame(&mut self) -> std::io::Result<WsFrame> {
        self.fill_exact(2).await?;
        let b0 = self.buf[0];
        let b1 = self.buf[1];
        let opcode = b0 & 0x0F;
        let masked = (b1 & 0x80) != 0;
        let mut payload_len = (b1 & 0x7F) as usize;
        let mut offset = 2;

        if payload_len == 126 {
            self.fill_exact(offset + 2).await?;
            payload_len = u16::from_be_bytes([self.buf[2], self.buf[3]]) as usize;
            offset += 2;
        } else if payload_len == 127 {
            self.fill_exact(offset + 8).await?;
            let mut arr = [0u8; 8];
            arr.copy_from_slice(&self.buf[2..10]);
            payload_len = u64::from_be_bytes(arr) as usize;
            offset += 8;
        }

        let mask_key = if masked {
            self.fill_exact(offset + 4).await?;
            let k = [
                self.buf[offset],
                self.buf[offset + 1],
                self.buf[offset + 2],
                self.buf[offset + 3],
            ];
            offset += 4;
            Some(k)
        } else {
            None
        };

        self.fill_exact(offset + payload_len).await?;
        let mut payload = self.buf[offset..offset + payload_len].to_vec();
        self.buf.drain(..offset + payload_len);

        if let Some(k) = mask_key {
            for (i, b) in payload.iter_mut().enumerate() {
                *b ^= k[i & 3];
            }
        }

        match opcode {
            0x1 => Ok(WsFrame::Text(
                String::from_utf8_lossy(&payload).into_owned(),
            )),
            0x2 => Ok(WsFrame::Binary(payload)),
            0x8 => Ok(WsFrame::Close),
            0x9 => Ok(WsFrame::Ping(payload)),
            0xA => Ok(WsFrame::Pong(payload)),
            _ => Ok(WsFrame::Binary(payload)),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Команды Tauri плагина `tunnel`
// ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisteredResponse {
    #[serde(rename = "type")]
    msg_type: String,
    public_port: Option<u16>,
}

/// Открыть туннель хоста к VDS (как `tunnel.open` в ProximaClient).
#[tauri::command]
pub async fn tunnel_open(
    session_id: String,
    local_port: u16,
    edition: String,
    relay_url: String,
    preferred_port: Option<u16>,
) -> Result<TunnelStatusInfo> {
    // Если уже есть туннель с таким session_id — просто обновляем порт и возвращаем статус
    if let Some(existing) = HOST_TUNNELS.get(&session_id) {
        existing.local_port.store(local_port, Ordering::Relaxed);
        return Ok(TunnelStatusInfo {
            session_id: existing.session_id.clone(),
            edition: existing.edition.clone(),
            local_port,
            public_port: existing.public_port.load(Ordering::Relaxed),
            connected: existing.connected.load(Ordering::Relaxed),
            active_streams: existing.active_streams.load(Ordering::Relaxed),
            bytes_rx: existing.bytes_rx.load(Ordering::Relaxed),
            bytes_tx: existing.bytes_tx.load(Ordering::Relaxed),
            ping_ms: existing.ping_ms.load(Ordering::Relaxed),
        });
    }

    let local_port_atomic = Arc::new(AtomicU16::new(local_port));
    let public_port_atomic = Arc::new(AtomicU16::new(preferred_port.unwrap_or(0)));
    let connected_atomic = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::new(AtomicBool::new(false));
    let active_streams = Arc::new(AtomicUsize::new(0));
    let bytes_rx = Arc::new(AtomicU64::new(0));
    let bytes_tx = Arc::new(AtomicU64::new(0));
    let ping_ms = Arc::new(AtomicU64::new(0));

    let (first_reg_tx, first_reg_rx) = oneshot::channel::<u16>();
    let mut first_reg_tx_opt = Some(first_reg_tx);

    let sid_clone = session_id.clone();
    let lp_clone = local_port_atomic.clone();
    let pp_clone = public_port_atomic.clone();
    let conn_clone = connected_atomic.clone();
    let stop_clone = stop_flag.clone();
    let streams_clone = active_streams.clone();
    let rx_clone = bytes_rx.clone();
    let tx_clone = bytes_tx.clone();
    let ping_clone = ping_ms.clone();

    let task = tokio::spawn(async move {
        while !stop_clone.load(Ordering::Relaxed) {
            let connect_start = Instant::now();
            match ws_connect(&relay_url).await {
                Ok((stream, leftover)) => {
                    let rtt = connect_start.elapsed().as_millis() as u64;
                    ping_clone.store(rtt.max(1), Ordering::Relaxed);

                    let (rd_half, mut wr_half) = stream.into_split();
                    let mut ws_rd = WsReader::new(rd_half, leftover);

                    let pref = {
                        let p = pp_clone.load(Ordering::Relaxed);
                        if p > 0 { Some(p) } else { preferred_port }
                    };
                    let reg_json = json!({
                        "type": "host_register",
                        "session_id": sid_clone,
                        "preferred_port": pref,
                    })
                    .to_string();

                    let reg_frame = encode_ws_client_frame(0x1, reg_json.as_bytes());
                    if wr_half.write_all(&reg_frame).await.is_err() {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        continue;
                    }

                    // Ждём ответа Registered
                    if let Ok(Ok(WsFrame::Text(txt))) =
                        tokio::time::timeout(Duration::from_secs(6), ws_rd.next_frame()).await
                    {
                        if let Ok(resp) = serde_json::from_str::<RegisteredResponse>(&txt) {
                            if resp.msg_type == "registered" {
                                let pub_port = resp.public_port.unwrap_or(0);
                                pp_clone.store(pub_port, Ordering::Relaxed);
                                conn_clone.store(true, Ordering::Relaxed);
                                if let Some(tx_once) = first_reg_tx_opt.take() {
                                    let _ = tx_once.send(pub_port);
                                }
                                tracing::info!(
                                    "Bedringh Tunnel connected: session={} local_port={} public_port={}",
                                    sid_clone,
                                    lp_clone.load(Ordering::Relaxed),
                                    pub_port
                                );
                            }
                        }
                    }

                    if !conn_clone.load(Ordering::Relaxed) {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        continue;
                    }

                    // Канал отправки WS-фреймов к VDS
                    let (ws_out_tx, mut ws_out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
                    // Активные локальные TCP потоки: stream_id -> mpsc::UnboundedSender<Vec<u8>>
                    let local_tcp_streams: Arc<RwLock<HashMap<u32, mpsc::UnboundedSender<Vec<u8>>>>> =
                        Arc::new(RwLock::new(HashMap::new()));
                    // Активные локальные UDP сокеты (для Bedrock): stream_id -> Arc<UdpSocket>
                    let local_udp_sockets: Arc<RwLock<HashMap<u32, Arc<UdpSocket>>>> =
                        Arc::new(RwLock::new(HashMap::new()));

                    let mut ping_interval = tokio::time::interval(Duration::from_secs(15));
                    ping_interval.tick().await;
                    let mut last_ping_sent = Instant::now();

                    loop {
                        if stop_clone.load(Ordering::Relaxed) {
                            break;
                        }
                        tokio::select! {
                            frame_res = ws_rd.next_frame() => {
                                let Ok(frame) = frame_res else { break };
                                match frame {
                                    WsFrame::Close => break,
                                    WsFrame::Ping(d) => {
                                        let pong = encode_ws_client_frame(0xA, &d);
                                        let _ = ws_out_tx.send(pong);
                                    }
                                    WsFrame::Pong(_) => {
                                        let rtt = last_ping_sent.elapsed().as_millis() as u64;
                                        ping_clone.store(rtt.max(1), Ordering::Relaxed);
                                    }
                                    WsFrame::Binary(bytes) => {
                                        rx_clone.fetch_add(bytes.len() as u64, Ordering::Relaxed);
                                        if let Some((ftype, stream_id, payload)) = decode_frame(&bytes) {
                                            match ftype {
                                                FRAME_OPEN_STREAM => {
                                                    let target_port = lp_clone.load(Ordering::Relaxed);
                                                    let streams_map = local_tcp_streams.clone();
                                                    let ws_tx = ws_out_tx.clone();
                                                    let active_cnt = streams_clone.clone();
                                                    let tx_counter = tx_clone.clone();

                                                    tokio::spawn(async move {
                                                        match TcpStream::connect(("127.0.0.1", target_port)).await {
                                                            Ok(mut local_stream) => {
                                                                let _ = local_stream.set_nodelay(true);
                                                                let (to_local_tx, mut to_local_rx) = mpsc::unbounded_channel::<Vec<u8>>();
                                                                streams_map.write().await.insert(stream_id, to_local_tx);
                                                                active_cnt.store(streams_map.read().await.len(), Ordering::Relaxed);

                                                                let (mut l_rd, mut l_wr) = local_stream.split();
                                                                let mut buf = vec![0u8; 32 * 1024];

                                                                loop {
                                                                    tokio::select! {
                                                                        res = l_rd.read(&mut buf) => {
                                                                            match res {
                                                                                Ok(0) | Err(_) => break,
                                                                                Ok(n) => {
                                                                                    tx_counter.fetch_add(n as u64, Ordering::Relaxed);
                                                                                    let tframe = encode_frame(FRAME_DATA, stream_id, &buf[..n]);
                                                                                    let ws_bin = encode_ws_client_frame(0x2, &tframe);
                                                                                    if ws_tx.send(ws_bin).is_err() {
                                                                                        break;
                                                                                    }
                                                                                }
                                                                            }
                                                                        }
                                                                        data = to_local_rx.recv() => {
                                                                            let Some(data) = data else { break };
                                                                            if l_wr.write_all(&data).await.is_err() {
                                                                                break;
                                                                            }
                                                                        }
                                                                    }
                                                                }

                                                                streams_map.write().await.remove(&stream_id);
                                                                active_cnt.store(streams_map.read().await.len(), Ordering::Relaxed);
                                                                let cframe = encode_frame(FRAME_CLOSE_STREAM, stream_id, &[]);
                                                                let _ = ws_tx.send(encode_ws_client_frame(0x2, &cframe));
                                                            }
                                                            Err(e) => {
                                                                tracing::warn!("Tunnel failed to connect to local 127.0.0.1:{target_port}: {e}");
                                                                let cframe = encode_frame(FRAME_CLOSE_STREAM, stream_id, &[]);
                                                                let _ = ws_tx.send(encode_ws_client_frame(0x2, &cframe));
                                                            }
                                                        }
                                                    });
                                                }
                                                FRAME_DATA => {
                                                    let map = local_tcp_streams.read().await;
                                                    if let Some(tx) = map.get(&stream_id) {
                                                        let _ = tx.send(payload.to_vec());
                                                    }
                                                }
                                                FRAME_CLOSE_STREAM => {
                                                    local_tcp_streams.write().await.remove(&stream_id);
                                                    streams_clone.store(local_tcp_streams.read().await.len(), Ordering::Relaxed);
                                                }
                                                FRAME_UDP_DATA => {
                                                    let target_port = lp_clone.load(Ordering::Relaxed);
                                                    let udp_sock = {
                                                        let map = local_udp_sockets.read().await;
                                                        map.get(&stream_id).cloned()
                                                    };
                                                    let sock = if let Some(s) = udp_sock {
                                                        s
                                                    } else if let Ok(s) = UdpSocket::bind("127.0.0.1:0").await {
                                                        let _ = s.connect(("127.0.0.1", target_port)).await;
                                                        let arc_s = Arc::new(s);
                                                        local_udp_sockets.write().await.insert(stream_id, arc_s.clone());
                                                        let s_recv = arc_s.clone();
                                                        let ws_tx = ws_out_tx.clone();
                                                        let tx_counter = tx_clone.clone();
                                                        tokio::spawn(async move {
                                                            let mut ubuf = vec![0u8; 65535];
                                                            while let Ok(n) = s_recv.recv(&mut ubuf).await {
                                                                tx_counter.fetch_add(n as u64, Ordering::Relaxed);
                                                                let tframe = encode_frame(FRAME_UDP_DATA, stream_id, &ubuf[..n]);
                                                                if ws_tx.send(encode_ws_client_frame(0x2, &tframe)).is_err() {
                                                                    break;
                                                                }
                                                            }
                                                        });
                                                        arc_s
                                                    } else {
                                                        continue;
                                                    };
                                                    let _ = sock.send(payload).await;
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            out_msg = ws_out_rx.recv() => {
                                let Some(raw_ws) = out_msg else { break };
                                if wr_half.write_all(&raw_ws).await.is_err() {
                                    break;
                                }
                            }
                            _ = ping_interval.tick() => {
                                last_ping_sent = Instant::now();
                                let ping_frame = encode_ws_client_frame(0x9, b"p");
                                if wr_half.write_all(&ping_frame).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }

                    conn_clone.store(false, Ordering::Relaxed);
                    streams_clone.store(0, Ordering::Relaxed);
                }
                Err(e) => {
                    tracing::warn!("Bedringh Tunnel connect error ({relay_url}): {e}");
                }
            }

            if stop_clone.load(Ordering::Relaxed) {
                break;
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });

    // Ждём до 4 секунд первичной регистрации на VDS, чтобы сразу вернуть выделенный публичный порт
    let allocated_port = tokio::time::timeout(Duration::from_secs(4), first_reg_rx)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_else(|| public_port_atomic.load(Ordering::Relaxed));

    let handle = Arc::new(HostTunnelHandle {
        session_id: session_id.clone(),
        edition: edition.clone(),
        local_port: local_port_atomic,
        public_port: public_port_atomic,
        connected: connected_atomic.clone(),
        stop_flag,
        active_streams: active_streams.clone(),
        bytes_rx: bytes_rx.clone(),
        bytes_tx: bytes_tx.clone(),
        ping_ms: ping_ms.clone(),
        task,
    });

    HOST_TUNNELS.insert(session_id.clone(), handle);

    Ok(TunnelStatusInfo {
        session_id,
        edition,
        local_port,
        public_port: allocated_port,
        connected: connected_atomic.load(Ordering::Relaxed),
        active_streams: active_streams.load(Ordering::Relaxed),
        bytes_rx: bytes_rx.load(Ordering::Relaxed),
        bytes_tx: bytes_tx.load(Ordering::Relaxed),
        ping_ms: ping_ms.load(Ordering::Relaxed),
    })
}

/// Закрыть туннель хоста (аналог `tunnel.close` в ProximaClient).
#[tauri::command]
pub async fn tunnel_close(session_id: String) -> Result<bool> {
    if let Some((_, handle)) = HOST_TUNNELS.remove(&session_id) {
        handle.stop_flag.store(true, Ordering::Relaxed);
        handle.task.abort();
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Горячая смена локального порта без разрыва публичного адреса (аналог `tunnel.setLocalPort` в ProximaClient).
#[tauri::command]
pub async fn tunnel_set_local_port(session_id: String, local_port: u16) -> Result<bool> {
    if let Some(handle) = HOST_TUNNELS.get(&session_id) {
        handle.local_port.store(local_port, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Получить статус конкретного туннеля хоста.
#[tauri::command]
pub async fn tunnel_status(session_id: String) -> Result<Option<TunnelStatusInfo>> {
    if let Some(h) = HOST_TUNNELS.get(&session_id) {
        Ok(Some(TunnelStatusInfo {
            session_id: h.session_id.clone(),
            edition: h.edition.clone(),
            local_port: h.local_port.load(Ordering::Relaxed),
            public_port: h.public_port.load(Ordering::Relaxed),
            connected: h.connected.load(Ordering::Relaxed),
            active_streams: h.active_streams.load(Ordering::Relaxed),
            bytes_rx: h.bytes_rx.load(Ordering::Relaxed),
            bytes_tx: h.bytes_tx.load(Ordering::Relaxed),
            ping_ms: h.ping_ms.load(Ordering::Relaxed),
        }))
    } else {
        Ok(None)
    }
}

/// Список всех активных туннелей хоста в лаунчере.
#[tauri::command]
pub async fn tunnel_list() -> Result<Vec<TunnelStatusInfo>> {
    let list = HOST_TUNNELS
        .iter()
        .map(|entry| {
            let h = entry.value();
            TunnelStatusInfo {
                session_id: h.session_id.clone(),
                edition: h.edition.clone(),
                local_port: h.local_port.load(Ordering::Relaxed),
                public_port: h.public_port.load(Ordering::Relaxed),
                connected: h.connected.load(Ordering::Relaxed),
                active_streams: h.active_streams.load(Ordering::Relaxed),
                bytes_rx: h.bytes_rx.load(Ordering::Relaxed),
                bytes_tx: h.bytes_tx.load(Ordering::Relaxed),
                ping_ms: h.ping_ms.load(Ordering::Relaxed),
            }
        })
        .collect();
    Ok(list)
}

/// Замер пинга (RTT в мс) до VDS-узла (аналог `tunnel.probeCandidates` в ProximaClient).
#[tauri::command]
pub async fn tunnel_probe_ping(relay_url: String) -> Result<Option<u64>> {
    let (host, port, _) = parse_relay_host_port(&relay_url);
    let addr = format!("{host}:{port}");
    let start = Instant::now();
    match tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => Ok(Some((start.elapsed().as_millis() as u64).max(1))),
        _ => Ok(None),
    }
}

/// Поднять локальный TCP-мост (`127.0.0.1:<port>`) на ПК игрока для подключения к хосту через VDS без раскрытия IP VDS.
#[tauri::command]
pub async fn tunnel_connect_client(
    session_id: String,
    relay_url: String,
    preferred_local_port: Option<u16>,
) -> Result<ClientBridgeInfo> {
    if let Some(existing) = CLIENT_BRIDGES.get(&session_id) {
        return Ok(ClientBridgeInfo {
            session_id: existing.session_id.clone(),
            local_port: existing.local_port,
            local_address: format!("127.0.0.1:{}", existing.local_port),
        });
    }

    // Пытаемся занять preferred_local_port или любой свободный локальный порт
    let listener = if let Some(p) = preferred_local_port {
        match TcpListener::bind(("127.0.0.1", p)).await {
            Ok(l) => l,
            Err(_) => TcpListener::bind(("127.0.0.1", 0)).await?,
        }
    } else {
        TcpListener::bind(("127.0.0.1", 0)).await?
    };

    let local_port = listener.local_addr()?.port();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();
    let sid_clone = session_id.clone();

    let task = tokio::spawn(async move {
        loop {
            if stop_clone.load(Ordering::Relaxed) {
                break;
            }
            let Ok((mut mc_stream, _peer)) = listener.accept().await else {
                break;
            };
            let _ = mc_stream.set_nodelay(true);
            let relay = relay_url.clone();
            let sid = sid_clone.clone();

            tokio::spawn(async move {
                let Ok((ws_stream, leftover)) = ws_connect(&relay).await else {
                    return;
                };
                let (ws_rd_half, mut ws_wr_half) = ws_stream.into_split();
                let mut ws_rd = WsReader::new(ws_rd_half, leftover);

                let join_json = json!({
                    "type": "client_join",
                    "session_id": sid,
                })
                .to_string();

                if ws_wr_half
                    .write_all(&encode_ws_client_frame(0x1, join_json.as_bytes()))
                    .await
                    .is_err()
                {
                    return;
                }

                // Ждём ответа Linked от VDS
                match tokio::time::timeout(Duration::from_secs(5), ws_rd.next_frame()).await {
                    Ok(Ok(WsFrame::Text(txt))) if txt.contains("\"linked\"") => {}
                    _ => return,
                }

                let (mut mc_rd, mut mc_wr) = mc_stream.split();
                let mut buf = vec![0u8; 32 * 1024];

                loop {
                    tokio::select! {
                        res = mc_rd.read(&mut buf) => {
                            match res {
                                Ok(0) | Err(_) => break,
                                Ok(n) => {
                                    let ws_bin = encode_ws_client_frame(0x2, &buf[..n]);
                                    if ws_wr_half.write_all(&ws_bin).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                        frame = ws_rd.next_frame() => {
                            let Ok(frame) = frame else { break };
                            match frame {
                                WsFrame::Binary(data) => {
                                    if mc_wr.write_all(&data).await.is_err() {
                                        break;
                                    }
                                }
                                WsFrame::Ping(d) => {
                                    let _ = ws_wr_half.write_all(&encode_ws_client_frame(0xA, &d)).await;
                                }
                                WsFrame::Close => break,
                                _ => {}
                            }
                        }
                    }
                }
            });
        }
    });

    let handle = Arc::new(ClientBridgeHandle {
        session_id: session_id.clone(),
        local_port,
        stop_flag,
        task,
    });
    CLIENT_BRIDGES.insert(session_id.clone(), handle);

    Ok(ClientBridgeInfo {
        session_id,
        local_port,
        local_address: format!("127.0.0.1:{local_port}"),
    })
}

/// Остановить локальный TCP-мост клиента.
#[tauri::command]
pub async fn tunnel_disconnect_client(session_id: String) -> Result<bool> {
    if let Some((_, h)) = CLIENT_BRIDGES.remove(&session_id) {
        h.stop_flag.store(true, Ordering::Relaxed);
        h.task.abort();
        Ok(true)
    } else {
        Ok(false)
    }
}
