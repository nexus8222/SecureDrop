from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import gzip
import json
import os
import queue
import secrets
import shutil
import socket
import sqlite3
import struct
import threading
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import qrcode
import requests
import uvicorn
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

APP_NAME = "SecureDrop LAN"
APP_VERSION = "2.3.0"
ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
STATIC_DIR = ROOT / "static"
STORAGE_DIR = ROOT / "storage"
CHUNK_DIR = STORAGE_DIR / "chunks"
PULL_DIR = STORAGE_DIR / "pulls"
VAULT_DIR = STORAGE_DIR / "vault"
TMP_DIR = STORAGE_DIR / "tmp"
QR_DIR = STORAGE_DIR / "qr"
DB_PATH = STORAGE_DIR / "securedrop.sqlite3"

for d in [STORAGE_DIR, CHUNK_DIR, PULL_DIR, VAULT_DIR, TMP_DIR, QR_DIR]:
    d.mkdir(parents=True, exist_ok=True)

DEFAULT_WEB_PORT = int(os.environ.get("SECUREDROP_WEB_PORT", "8000"))
DEFAULT_TCP_PORT = int(os.environ.get("SECUREDROP_TCP_PORT", "9001"))
DISCOVERY_PORT = int(os.environ.get("SECUREDROP_DISCOVERY_PORT", "45678"))
DEFAULT_DEVICE_NAME = os.environ.get("SECUREDROP_DEVICE_NAME") or "SecureDrop SafeNode"


def now() -> int:
    return int(time.time())


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode())


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_join(base: Path, *parts: str) -> Path:
    candidate = base.joinpath(*parts).resolve()
    base_resolved = base.resolve()
    if not str(candidate).startswith(str(base_resolved)):
        raise HTTPException(400, "Unsafe path")
    return candidate


def get_local_ips() -> List[str]:
    ips = set()
    try:
        host = socket.gethostname()
        for item in socket.getaddrinfo(host, None, family=socket.AF_INET):
            ip = item[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(ips) or ["127.0.0.1"]


def subnet_broadcasts(ips: List[str]) -> List[str]:
    out = {"255.255.255.255"}
    for ip in ips:
        parts = ip.split(".")
        if len(parts) == 4:
            out.add(".".join(parts[:3] + ["255"]))
    return sorted(out)


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.init()

    def connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path, check_same_thread=False)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA synchronous=NORMAL")
        return con

    def init(self) -> None:
        with self.lock, self.connect() as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS settings(
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS admin_sessions(
                    token_hash TEXT PRIMARY KEY,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    ip TEXT,
                    user_agent TEXT
                );
                CREATE TABLE IF NOT EXISTS shares(
                    token TEXT PRIMARY KEY,
                    pin TEXT,
                    title TEXT,
                    mode TEXT NOT NULL DEFAULT 'files',
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER,
                    password_hash TEXT,
                    require_approval INTEGER NOT NULL DEFAULT 0,
                    delete_after_download INTEGER NOT NULL DEFAULT 0,
                    max_downloads INTEGER DEFAULT 0,
                    downloads INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'open',
                    owner_device_id TEXT,
                    meta_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS files(
                    id TEXT PRIMARY KEY,
                    share_token TEXT NOT NULL,
                    name TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    mime TEXT,
                    chunk_size INTEGER NOT NULL,
                    chunk_count INTEGER NOT NULL,
                    compression TEXT NOT NULL DEFAULT 'none',
                    file_sha256 TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY(share_token) REFERENCES shares(token) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS chunks(
                    share_token TEXT NOT NULL,
                    file_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    path TEXT NOT NULL,
                    stored_size INTEGER NOT NULL,
                    original_size INTEGER NOT NULL,
                    plaintext_sha256 TEXT NOT NULL,
                    ciphertext_sha256 TEXT NOT NULL,
                    nonce_b64 TEXT,
                    uploaded_at INTEGER NOT NULL,
                    PRIMARY KEY(file_id, chunk_index)
                );
                CREATE TABLE IF NOT EXISTS access_tickets(
                    ticket TEXT PRIMARY KEY,
                    share_token TEXT NOT NULL,
                    device_id TEXT,
                    device_name TEXT,
                    approved INTEGER NOT NULL DEFAULT 0,
                    expires_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS approvals(
                    id TEXT PRIMARY KEY,
                    share_token TEXT NOT NULL,
                    device_id TEXT,
                    device_name TEXT,
                    requester_ip TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    ticket TEXT,
                    created_at INTEGER NOT NULL,
                    decided_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS peers(
                    device_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    ips TEXT NOT NULL,
                    web_port INTEGER NOT NULL,
                    tcp_port INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL,
                    trusted INTEGER NOT NULL DEFAULT 0,
                    blocked INTEGER NOT NULL DEFAULT 0,
                    fingerprint TEXT,
                    meta_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS history(
                    id TEXT PRIMARY KEY,
                    direction TEXT NOT NULL,
                    title TEXT,
                    peer TEXT,
                    size INTEGER DEFAULT 0,
                    status TEXT NOT NULL,
                    detail TEXT,
                    created_at INTEGER NOT NULL,
                    finished_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS transfer_jobs(
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    title TEXT,
                    status TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0,
                    speed_bps REAL NOT NULL DEFAULT 0,
                    eta_seconds REAL NOT NULL DEFAULT 0,
                    detail TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    meta_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS trusted_devices(
                    device_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    trusted INTEGER NOT NULL DEFAULT 1,
                    blocked INTEGER NOT NULL DEFAULT 0,
                    fingerprint TEXT,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS clipboard_items(
                    id TEXT PRIMARY KEY,
                    text TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS users(
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member',
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at INTEGER NOT NULL,
                    last_login INTEGER
                );
                CREATE TABLE IF NOT EXISTS user_sessions(
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    ip TEXT,
                    user_agent TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                """
            )
            try:
                con.execute("ALTER TABLE shares ADD COLUMN pin TEXT")
            except Exception:
                pass
            con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_pin ON shares(pin)")

            try:
                con.execute("ALTER TABLE shares ADD COLUMN owner_user_id TEXT")
            except Exception:
                pass

            curr_name = self.get_setting("device_name")
            if not curr_name or curr_name == socket.gethostname():
                self.set_setting("device_name", os.environ.get("SECUREDROP_DEVICE_NAME") or "SecureDrop SafeNode")

            if not self.get_setting("device_id"):
                device_id = "dev_" + b64url(secrets.token_bytes(16))
                self.set_setting("device_id", device_id)
                self.set_setting("device_name", DEFAULT_DEVICE_NAME)
                self.set_setting("identity_fingerprint", hashlib.sha256(device_id.encode()).hexdigest()[:32].upper())

    def get_setting(self, key: str, default: Optional[str] = None) -> Optional[str]:
        with self.lock, self.connect() as con:
            row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return row["value"] if row else default

    def set_setting(self, key: str, value: str) -> None:
        with self.lock, self.connect() as con:
            con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, value))
            con.commit()

    def execute(self, sql: str, params: Tuple[Any, ...] = ()) -> None:
        with self.lock, self.connect() as con:
            con.execute(sql, params)
            con.commit()

    def one(self, sql: str, params: Tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
        with self.lock, self.connect() as con:
            return con.execute(sql, params).fetchone()

    def all(self, sql: str, params: Tuple[Any, ...] = ()) -> List[sqlite3.Row]:
        with self.lock, self.connect() as con:
            return con.execute(sql, params).fetchall()


db = Database(DB_PATH)


class WSManager:
    def __init__(self):
        self.clients: List[WebSocket] = []
        self.lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self.lock:
            self.clients.append(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self.lock:
            if ws in self.clients:
                self.clients.remove(ws)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        dead: List[WebSocket] = []
        async with self.lock:
            for ws in list(self.clients):
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                if ws in self.clients:
                    self.clients.remove(ws)


ws_manager = WSManager()
main_loop: Optional[asyncio.AbstractEventLoop] = None


def broadcast_from_thread(message: Dict[str, Any]) -> None:
    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(ws_manager.broadcast(message), main_loop)


class DiscoveryService:
    def __init__(self, web_port: int, tcp_port: int):
        self.web_port = web_port
        self.tcp_port = tcp_port
        self.stop_event = threading.Event()
        self.threads: List[threading.Thread] = []

    def payload(self, kind: str = "hello") -> Dict[str, Any]:
        return {
            "type": "securedrop_v2",
            "kind": kind,
            "app": APP_NAME,
            "version": APP_VERSION,
            "device_id": db.get_setting("device_id"),
            "name": db.get_setting("device_name", DEFAULT_DEVICE_NAME),
            "ips": get_local_ips(),
            "web_port": self.web_port,
            "tcp_port": self.tcp_port,
            "fingerprint": db.get_setting("identity_fingerprint"),
            "ts": now(),
        }

    def start(self) -> None:
        self.threads = [
            threading.Thread(target=self._listen, daemon=True),
            threading.Thread(target=self._announce_loop, daemon=True),
        ]
        for t in self.threads:
            t.start()

    def stop(self) -> None:
        self.stop_event.set()

    def probe(self) -> None:
        self._send("probe")

    def _send(self, kind: str) -> None:
        msg = json.dumps(self.payload(kind)).encode()
        targets = subnet_broadcasts(get_local_ips())
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.settimeout(0.2)
            for target in targets:
                try:
                    sock.sendto(msg, (target, DISCOVERY_PORT))
                except Exception:
                    pass
        finally:
            sock.close()

    def _announce_loop(self) -> None:
        while not self.stop_event.is_set():
            self._send("hello")
            self.stop_event.wait(7)

    def _listen(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.bind(("", DISCOVERY_PORT))
            sock.settimeout(1.0)
            while not self.stop_event.is_set():
                try:
                    data, addr = sock.recvfrom(65535)
                except socket.timeout:
                    continue
                except Exception:
                    continue
                try:
                    msg = json.loads(data.decode())
                except Exception:
                    continue
                if msg.get("type") != "securedrop_v2":
                    continue
                if msg.get("device_id") == db.get_setting("device_id"):
                    continue
                if msg.get("kind") == "probe":
                    self._send("hello")
                self._store_peer(msg, addr[0])
        finally:
            sock.close()

    def _store_peer(self, msg: Dict[str, Any], sender_ip: str) -> None:
        device_id = str(msg.get("device_id") or "")
        if not device_id:
            return
        ips = set(msg.get("ips") or [])
        ips.add(sender_ip)
        trusted_row = db.one("SELECT * FROM trusted_devices WHERE device_id=?", (device_id,))
        trusted = int(trusted_row["trusted"]) if trusted_row else 0
        blocked = int(trusted_row["blocked"]) if trusted_row else 0
        db.execute(
            """
            INSERT OR REPLACE INTO peers(device_id,name,ips,web_port,tcp_port,last_seen,trusted,blocked,fingerprint,meta_json)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (
                device_id,
                str(msg.get("name") or "Unknown"),
                json.dumps(sorted(ips)),
                int(msg.get("web_port") or DEFAULT_WEB_PORT),
                int(msg.get("tcp_port") or DEFAULT_TCP_PORT),
                now(),
                trusted,
                blocked,
                str(msg.get("fingerprint") or ""),
                json.dumps(msg),
            ),
        )
        broadcast_from_thread({"type": "peer_seen", "peer": peer_row_to_dict(db.one("SELECT * FROM peers WHERE device_id=?", (device_id,)))})


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def peer_row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    d = row_to_dict(row) or {}
    try:
        d["ips"] = json.loads(d.get("ips") or "[]")
    except Exception:
        d["ips"] = []
    d["urls"] = [f"http://{ip}:{d['web_port']}" for ip in d["ips"]]
    d["tcp_addresses"] = [f"{ip}:{d['tcp_port']}" for ip in d["ips"]]
    return d


@dataclass
class ChunkResponse:
    meta: Dict[str, Any]
    data: bytes


class TCPChunkServer:
    """Tiny TCP chunk server. Chunks are already encrypted by the browser.

    Protocol:
    client sends: 4-byte big-endian JSON length + JSON request
    server sends: 4-byte JSON length + JSON header + optional 8-byte data length + data
    ops: meta, chunk
    """

    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self) -> None:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            server.bind((self.host, self.port))
            server.listen(64)
            server.settimeout(1.0)
            while not self.stop_event.is_set():
                try:
                    client, addr = server.accept()
                except socket.timeout:
                    continue
                threading.Thread(target=self._handle, args=(client, addr), daemon=True).start()
        finally:
            server.close()

    def _recv_exact(self, sock: socket.socket, n: int) -> bytes:
        data = b""
        while len(data) < n:
            packet = sock.recv(n - len(data))
            if not packet:
                raise ConnectionError("socket closed")
            data += packet
        return data

    def _send_json(self, sock: socket.socket, obj: Dict[str, Any], body: Optional[bytes] = None) -> None:
        raw = json.dumps(obj).encode()
        sock.sendall(struct.pack(">I", len(raw)))
        sock.sendall(raw)
        if body is not None:
            sock.sendall(struct.pack(">Q", len(body)))
            sock.sendall(body)

    def _handle(self, sock: socket.socket, addr: Tuple[str, int]) -> None:
        try:
            raw_len = self._recv_exact(sock, 4)
            req_len = struct.unpack(">I", raw_len)[0]
            req = json.loads(self._recv_exact(sock, req_len).decode())
            op = req.get("op")
            if op == "meta":
                token = req.get("token")
                ticket = req.get("ticket")
                meta = get_share_metadata(token, ticket=ticket, include_private=False)
                self._send_json(sock, {"ok": True, "meta": meta})
            elif op == "chunk":
                token = req.get("token")
                file_id = req.get("file_id")
                chunk_index = int(req.get("chunk_index"))
                ticket = req.get("ticket")
                data, meta = read_chunk_bytes(token, file_id, chunk_index, ticket=ticket)
                self._send_json(sock, {"ok": True, "chunk": meta}, data)
            else:
                self._send_json(sock, {"ok": False, "error": "unknown op"})
        except Exception as e:
            try:
                self._send_json(sock, {"ok": False, "error": str(e)})
            except Exception:
                pass
        finally:
            try:
                sock.close()
            except Exception:
                pass


class ShareCreate(BaseModel):
    title: str = "Untitled Share"
    mode: str = "files"
    expires_seconds: Optional[int] = None
    password: Optional[str] = None
    pin: Optional[str] = None
    require_approval: bool = False
    delete_after_download: bool = False
    max_downloads: int = 0
    meta: Dict[str, Any] = Field(default_factory=dict)


class FileRegister(BaseModel):
    id: Optional[str] = None
    name: str
    relative_path: str
    size: int
    mime: Optional[str] = None
    chunk_size: int
    chunk_count: int
    compression: str = "none"
    file_sha256: Optional[str] = None


class AccessRequest(BaseModel):
    device_id: Optional[str] = None
    device_name: str = "Browser Device"
    password: Optional[str] = None


class PullStart(BaseModel):
    base_url: str
    token: str
    key_b64: str
    password: Optional[str] = None
    ticket: Optional[str] = None
    output_dir: Optional[str] = None
    parallelism: int = 4
    use_tcp: bool = False
    tcp_host: Optional[str] = None
    tcp_port: int = DEFAULT_TCP_PORT


class TrustUpdate(BaseModel):
    device_id: str
    name: Optional[str] = None
    trusted: bool = True
    blocked: bool = False
    fingerprint: Optional[str] = None


class ClipboardCreate(BaseModel):
    text: str
    expires_seconds: Optional[int] = 3600
    password: Optional[str] = None


class AuthLogin(BaseModel):
    username: Optional[str] = "admin"
    password: str


class AuthSetup(BaseModel):
    password: str


class UserLogin(BaseModel):
    username: Optional[str] = "admin"
    password: str


class UserRegister(BaseModel):
    username: str
    display_name: Optional[str] = None
    password: str


class UserCreateAdmin(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "member"


class UserRoleUpdate(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None


app = FastAPI(title=APP_NAME, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


ADMIN_COOKIE = "securedrop_admin"
ADMIN_SESSION_TTL = 7 * 24 * 3600
USER_COOKIE = "securedrop_session"
USER_SESSION_TTL = 7 * 24 * 3600


def _token_hash(token: str) -> str:
    return hashlib.sha256(("admin-session:" + token).encode()).hexdigest()


def _user_token_hash(token: str) -> str:
    return hashlib.sha256(("user-session:" + token).encode()).hexdigest()


def hash_user_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    if not salt:
        salt = b64url(secrets.token_bytes(16))
    digest = hashlib.sha256((salt + ":" + (password or "")).encode()).hexdigest()
    return digest, salt


def verify_user_password(password: str, salt: str, expected_hash: str) -> bool:
    if not salt or not expected_hash:
        return False
    digest = hashlib.sha256((salt + ":" + (password or "")).encode()).hexdigest()
    return secrets.compare_digest(digest, expected_hash)


def admin_configured() -> bool:
    return bool(db.get_setting("admin_password_hash"))


def set_admin_password(password: str) -> None:
    password = password or ""
    if len(password) < 6:
        raise HTTPException(400, "Admin password must be at least 6 characters")
    salt = b64url(secrets.token_bytes(16))
    digest = hashlib.sha256((salt + ":" + password).encode()).hexdigest()
    db.set_setting("admin_password_salt", salt)
    db.set_setting("admin_password_hash", digest)
    admin_row = db.one("SELECT * FROM users WHERE username='admin'")
    if not admin_row:
        db.execute(
            """
            INSERT OR REPLACE INTO users(id, username, display_name, password_hash, salt, role, status, created_at, last_login)
            VALUES(?,?,?,?,?,?,?,?,?)
            """,
            ("usr_admin", "admin", "Administrator", digest, salt, "admin", "active", now(), now()),
        )
    else:
        db.execute("UPDATE users SET password_hash=?, salt=? WHERE username='admin'", (digest, salt))


def ensure_admin_user() -> None:
    salt = db.get_setting("admin_password_salt")
    digest = db.get_setting("admin_password_hash")
    if not salt or not digest:
        return
    admin_row = db.one("SELECT * FROM users WHERE username='admin'")
    if not admin_row:
        db.execute(
            """
            INSERT OR REPLACE INTO users(id, username, display_name, password_hash, salt, role, status, created_at, last_login)
            VALUES(?,?,?,?,?,?,?,?,?)
            """,
            ("usr_admin", "admin", "Administrator", digest, salt, "admin", "active", now(), now()),
        )


def ensure_env_admin_password() -> None:
    env_password = os.environ.get("SECUREDROP_ADMIN_PASSWORD")
    if env_password and not admin_configured():
        set_admin_password(env_password)
    ensure_admin_user()


def verify_admin_password(password: str) -> bool:
    ensure_env_admin_password()
    salt = db.get_setting("admin_password_salt") or ""
    digest = db.get_setting("admin_password_hash") or ""
    if not salt or not digest:
        return False
    test = hashlib.sha256((salt + ":" + (password or "")).encode()).hexdigest()
    return secrets.compare_digest(digest, test)


def create_admin_session(request: Request, response: Response) -> str:
    token = "adm_" + b64url(secrets.token_bytes(32))
    db.execute(
        "INSERT INTO admin_sessions(token_hash,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?)",
        (_token_hash(token), now(), now() + ADMIN_SESSION_TTL, request.client.host if request.client else "", request.headers.get("user-agent", "")[:250]),
    )
    response.set_cookie(
        ADMIN_COOKIE,
        token,
        max_age=ADMIN_SESSION_TTL,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/",
    )
    return token


def create_user_session(user_id: str, request: Request, response: Response) -> str:
    token = "usr_tok_" + b64url(secrets.token_bytes(32))
    client_ip = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")[:250]
    db.execute(
        """
        INSERT INTO user_sessions(token_hash, user_id, created_at, expires_at, ip, user_agent)
        VALUES(?,?,?,?,?,?)
        """,
        (_user_token_hash(token), user_id, now(), now() + USER_SESSION_TTL, client_ip, user_agent),
    )
    response.set_cookie(
        USER_COOKIE,
        token,
        max_age=USER_SESSION_TTL,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/",
    )
    db.execute("UPDATE users SET last_login=? WHERE id=?", (now(), user_id))
    return token


def get_current_user(request: Request) -> Optional[Dict[str, Any]]:
    ensure_admin_user()
    token = request.cookies.get(USER_COOKIE)
    if token:
        row = db.one(
            """
            SELECT s.expires_at, u.id, u.username, u.display_name, u.role, u.status
            FROM user_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token_hash = ?
            """,
            (_user_token_hash(token),),
        )
        if row:
            if int(row["expires_at"]) < now():
                db.execute("DELETE FROM user_sessions WHERE token_hash=?", (_user_token_hash(token),))
            elif row["status"] == "active":
                return {
                    "id": row["id"],
                    "username": row["username"],
                    "display_name": row["display_name"],
                    "role": row["role"],
                    "status": row["status"],
                }

    # Check legacy admin cookie
    adm_token = request.cookies.get(ADMIN_COOKIE)
    if adm_token:
        row = db.one("SELECT * FROM admin_sessions WHERE token_hash=?", (_token_hash(adm_token),))
        if row and int(row["expires_at"]) >= now():
            admin_row = db.one("SELECT id, username, display_name, role, status FROM users WHERE username='admin'")
            if admin_row:
                return {
                    "id": admin_row["id"],
                    "username": admin_row["username"],
                    "display_name": admin_row["display_name"],
                    "role": "admin",
                    "status": "active",
                }
            return {
                "id": "usr_admin",
                "username": "admin",
                "display_name": "Administrator",
                "role": "admin",
                "status": "active",
            }
    return None


def is_admin_request(request: Request) -> bool:
    ensure_env_admin_password()
    user = get_current_user(request)
    if user and user.get("role") == "admin":
        return True

    adm_token = request.cookies.get(ADMIN_COOKIE)
    if not adm_token:
        return False
    row = db.one("SELECT * FROM admin_sessions WHERE token_hash=?", (_token_hash(adm_token),))
    if not row:
        return False
    if int(row["expires_at"]) < now():
        db.execute("DELETE FROM admin_sessions WHERE token_hash=?", (_token_hash(adm_token),))
        return False
    return True


def require_admin(request: Request) -> None:
    if not is_admin_request(request):
        raise HTTPException(401, "Admin login required")


def clear_admin_session(request: Request, response: Response) -> None:
    token = request.cookies.get(ADMIN_COOKIE)
    if token:
        db.execute("DELETE FROM admin_sessions WHERE token_hash=?", (_token_hash(token),))
    response.delete_cookie(ADMIN_COOKIE, path="/")


def clear_user_session(request: Request, response: Response) -> None:
    token = request.cookies.get(USER_COOKIE)
    if token:
        db.execute("DELETE FROM user_sessions WHERE token_hash=?", (_user_token_hash(token),))
    response.delete_cookie(USER_COOKIE, path="/")
    clear_admin_session(request, response)


def password_hash(password: str) -> str:
    return hashlib.sha256(("securedrop-v2:" + password).encode()).hexdigest()


def verify_password(row: sqlite3.Row, password: Optional[str]) -> bool:
    ph = row["password_hash"]
    if not ph:
        return True
    return bool(password) and secrets.compare_digest(ph, password_hash(password))


def share_dir(token: str) -> Path:
    return safe_join(CHUNK_DIR, token)


def server_key_setting(token: str) -> str:
    return f"server_key:{token}"


def create_server_key_for_share(token: str) -> None:
    db.set_setting(server_key_setting(token), b64url(AESGCM.generate_key(bit_length=256)))


def get_server_aes(token: str) -> AESGCM:
    key_b64 = db.get_setting(server_key_setting(token))
    if not key_b64:
        raise HTTPException(400, "This share is browser-encrypted and cannot be decrypted by the server")
    return AESGCM(b64url_decode(key_b64))


def check_share_open(row: sqlite3.Row) -> None:
    if row["status"] != "open":
        raise HTTPException(403, f"Share is {row['status']}")
    if row["expires_at"] and row["expires_at"] < now():
        db.execute("UPDATE shares SET status='expired' WHERE token=?", (row["token"],))
        raise HTTPException(410, "Share expired")
    max_downloads = int(row["max_downloads"] or 0)
    if max_downloads > 0 and int(row["downloads"] or 0) >= max_downloads:
        db.execute("UPDATE shares SET status='maxed' WHERE token=?", (row["token"],))
        raise HTTPException(403, "Download limit reached")


def validate_ticket(token: str, ticket: Optional[str]) -> bool:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    check_share_open(row)
    if not row["password_hash"] and not row["require_approval"]:
        return True
    if not ticket:
        return False
    t = db.one("SELECT * FROM access_tickets WHERE ticket=? AND share_token=?", (ticket, token))
    if not t:
        return False
    if int(t["approved"]) != 1:
        return False
    if int(t["expires_at"]) < now():
        return False
    return True


def get_share_metadata(token: str, ticket: Optional[str] = None, include_private: bool = False) -> Dict[str, Any]:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    check_share_open(row)
    locked = bool(row["password_hash"] or row["require_approval"])
    pin_val = row["pin"] if "pin" in row.keys() else None
    if locked and not validate_ticket(token, ticket):
        return {
            "token": token,
            "pin": pin_val,
            "locked": True,
            "requires_password": bool(row["password_hash"]),
            "requires_approval": bool(row["require_approval"]),
            "title": row["title"],
            "mode": row["mode"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "downloads": row["downloads"],
            "max_downloads": row["max_downloads"],
        }
    files = [row_to_dict(f) for f in db.all("SELECT * FROM files WHERE share_token=? ORDER BY relative_path", (token,))]
    for f in files:
        uploaded = db.one("SELECT COUNT(*) AS c, COALESCE(SUM(stored_size),0) AS size FROM chunks WHERE file_id=?", (f["id"],))
        f["uploaded_chunks"] = uploaded["c"] if uploaded else 0
        f["uploaded_bytes"] = uploaded["size"] if uploaded else 0
    meta = json.loads(row["meta_json"] or "{}")
    return {
        "token": token,
        "pin": pin_val,
        "locked": False,
        "requires_password": bool(row["password_hash"]),
        "requires_approval": bool(row["require_approval"]),
        "title": row["title"],
        "mode": row["mode"],
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "delete_after_download": bool(row["delete_after_download"]),
        "downloads": row["downloads"],
        "max_downloads": row["max_downloads"],
        "meta": meta,
        "files": files,
    }


def read_chunk_bytes(token: str, file_id: str, chunk_index: int, ticket: Optional[str] = None) -> Tuple[bytes, Dict[str, Any]]:
    if not validate_ticket(token, ticket):
        raise HTTPException(403, "Access denied")
    row = db.one("SELECT * FROM chunks WHERE file_id=? AND chunk_index=?", (file_id, chunk_index))
    if not row:
        raise HTTPException(404, "Chunk not found")
    path = safe_join(CHUNK_DIR, row["path"])
    if not path.exists():
        raise HTTPException(404, "Chunk missing on disk")
    data = path.read_bytes()
    if sha256_bytes(data) != row["ciphertext_sha256"]:
        raise HTTPException(500, "Ciphertext integrity mismatch")
    return data, row_to_dict(row) or {}


@app.get("/", response_class=HTMLResponse)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "send.html")


@app.get("/send", response_class=HTMLResponse)
async def send_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "send.html")


@app.get("/receive", response_class=HTMLResponse)
async def receive_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "receive.html")


@app.get("/share/{token}", response_class=HTMLResponse)
async def share_page(token: str) -> FileResponse:
    return FileResponse(STATIC_DIR / "share.html")


@app.get("/admin", response_class=HTMLResponse)
async def admin_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "dashboard.html")


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "dashboard.html")


@app.get("/peers", response_class=HTMLResponse)
async def peers_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "peers.html")


@app.get("/clipboard", response_class=HTMLResponse)
async def clipboard_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "clipboard.html")


@app.get("/manifest.json")
async def manifest() -> FileResponse:
    return FileResponse(STATIC_DIR / "manifest.json")


@app.get("/sw.js")
async def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "sw.js")


@app.get("/api/auth/status")
async def auth_status(request: Request) -> Dict[str, Any]:
    ensure_env_admin_password()
    configured = admin_configured()
    user = get_current_user(request)
    admin = is_admin_request(request)
    role = "admin" if admin else (user.get("role") if user else "guest")
    return {
        "configured": configured,
        "role": role,
        "is_admin": admin,
        "authenticated": bool(user),
        "user": user or {"id": "guest", "username": "guest", "display_name": "Guest User", "role": "guest"},
        "can_setup": not configured,
        "guest_permissions": ["send", "receive"],
        "admin_permissions": ["approvals", "peers", "queue", "history", "storage", "settings", "users"],
    }


@app.get("/api/auth/me")
async def auth_me(request: Request) -> Dict[str, Any]:
    user = get_current_user(request)
    if not user:
        return {
            "authenticated": False,
            "user": {
                "id": "guest",
                "username": "guest",
                "display_name": "Guest User",
                "role": "guest",
            },
        }
    return {
        "authenticated": True,
        "user": user,
    }


@app.post("/api/auth/setup")
async def auth_setup(data: AuthSetup, request: Request, response: Response) -> Dict[str, Any]:
    ensure_env_admin_password()
    if admin_configured():
        raise HTTPException(409, "Admin password is already configured")
    set_admin_password(data.password)
    create_admin_session(request, response)
    user_row = db.one("SELECT * FROM users WHERE username='admin'")
    if user_row:
        create_user_session(user_row["id"], request, response)
    return {"ok": True, "role": "admin"}


@app.post("/api/auth/login")
async def auth_login(data: UserLogin, request: Request, response: Response) -> Dict[str, Any]:
    ensure_env_admin_password()
    username = (data.username or "admin").strip()
    password = data.password or ""

    # Check in users table first
    user_row = db.one("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", (username,))
    if not user_row and username.lower() == "admin":
        if verify_admin_password(password):
            ensure_admin_user()
            user_row = db.one("SELECT * FROM users WHERE username='admin'")

    if not user_row:
        # Check admin fallback
        if username.lower() == "admin" and verify_admin_password(password):
            create_admin_session(request, response)
            return {"ok": True, "role": "admin", "user": {"id": "usr_admin", "username": "admin", "display_name": "Administrator", "role": "admin"}}
        raise HTTPException(401, "Invalid username or password")

    if user_row["status"] != "active":
        raise HTTPException(403, "Account is disabled")

    if not verify_user_password(password, user_row["salt"], user_row["password_hash"]):
        raise HTTPException(401, "Invalid username or password")

    create_user_session(user_row["id"], request, response)
    if user_row["role"] == "admin":
        create_admin_session(request, response)

    return {
        "ok": True,
        "role": user_row["role"],
        "user": {
            "id": user_row["id"],
            "username": user_row["username"],
            "display_name": user_row["display_name"],
            "role": user_row["role"],
        },
    }


@app.post("/api/auth/register")
async def auth_register(data: UserRegister, request: Request, response: Response) -> Dict[str, Any]:
    ensure_env_admin_password()
    username = (data.username or "").strip()
    if not username or len(username) < 3 or len(username) > 32:
        raise HTTPException(400, "Username must be between 3 and 32 characters")
    if not all(c.isalnum() or c in "_-." for c in username):
        raise HTTPException(400, "Username contains invalid characters")
    password = data.password or ""
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    existing = db.one("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,))
    if existing:
        raise HTTPException(409, "Username is already taken")

    display_name = (data.display_name or "").strip() or username
    digest, salt = hash_user_password(password)
    user_id = "usr_" + b64url(secrets.token_bytes(10))

    user_count_row = db.one("SELECT COUNT(*) AS c FROM users")
    total_users = user_count_row["c"] if user_count_row else 0
    role = "admin" if total_users == 0 else "member"

    db.execute(
        """
        INSERT INTO users(id, username, display_name, password_hash, salt, role, status, created_at, last_login)
        VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (user_id, username, display_name, digest, salt, role, "active", now(), now()),
    )

    create_user_session(user_id, request, response)
    if role == "admin":
        if not admin_configured():
            set_admin_password(password)
        create_admin_session(request, response)

    return {
        "ok": True,
        "role": role,
        "user": {
            "id": user_id,
            "username": username,
            "display_name": display_name,
            "role": role,
        },
    }


@app.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response) -> Dict[str, Any]:
    clear_user_session(request, response)
    return {"ok": True, "role": "guest"}


@app.get("/api/admin/users")
async def admin_list_users(request: Request) -> Dict[str, Any]:
    require_admin(request)
    rows = db.all(
        """
        SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at, u.last_login,
               (SELECT COUNT(*) FROM shares s WHERE s.owner_user_id = u.id) AS share_count
        FROM users u
        ORDER BY u.created_at ASC
        """
    )
    return {"ok": True, "users": [dict(r) for r in rows]}


@app.post("/api/admin/users")
async def admin_create_user(data: UserCreateAdmin, request: Request) -> Dict[str, Any]:
    require_admin(request)
    username = (data.username or "").strip()
    if not username or len(username) < 3:
        raise HTTPException(400, "Username too short (minimum 3 chars)")
    if not data.password or len(data.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    existing = db.one("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,))
    if existing:
        raise HTTPException(409, "Username already exists")
    role = data.role if data.role in ["admin", "member", "guest"] else "member"
    digest, salt = hash_user_password(data.password)
    user_id = "usr_" + b64url(secrets.token_bytes(10))
    display_name = data.display_name.strip() or username
    db.execute(
        """
        INSERT INTO users(id, username, display_name, password_hash, salt, role, status, created_at)
        VALUES(?,?,?,?,?,?,?,?)
        """,
        (user_id, username, display_name, digest, salt, role, "active", now()),
    )
    return {"ok": True, "user_id": user_id}


@app.put("/api/admin/users/{user_id}/role")
async def admin_update_user_role(user_id: str, data: UserRoleUpdate, request: Request) -> Dict[str, Any]:
    require_admin(request)
    target = db.one("SELECT * FROM users WHERE id=?", (user_id,))
    if not target:
        raise HTTPException(404, "User not found")
    if data.role:
        if data.role not in ["admin", "member", "guest"]:
            raise HTTPException(400, "Invalid role")
        db.execute("UPDATE users SET role=? WHERE id=?", (data.role, user_id))
    if data.status:
        if data.status not in ["active", "disabled"]:
            raise HTTPException(400, "Invalid status")
        db.execute("UPDATE users SET status=? WHERE id=?", (data.status, user_id))
    return {"ok": True}


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: str, request: Request) -> Dict[str, Any]:
    require_admin(request)
    current_user = get_current_user(request)
    if current_user and current_user.get("id") == user_id:
        raise HTTPException(400, "Cannot delete your own account")
    if user_id == "usr_admin":
        raise HTTPException(400, "Cannot delete root admin account")
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws_manager.connect(ws)
    try:
        await ws.send_json({"type": "hello", "app": APP_NAME, "version": APP_VERSION, "device_id": db.get_setting("device_id")})
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                msg = {"type": "raw", "text": data}
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong", "ts": now()})
    except WebSocketDisconnect:
        await ws_manager.disconnect(ws)


@app.get("/api/info")
async def api_info(request: Request) -> Dict[str, Any]:
    ips = get_local_ips()
    web_port = getattr(request.app.state, "web_port", DEFAULT_WEB_PORT)
    tcp_port = getattr(request.app.state, "tcp_port", DEFAULT_TCP_PORT)
    client_host = request.client.host if request.client else None
    current_user = get_current_user(request)
    admin = is_admin_request(request)
    role = "admin" if admin else (current_user.get("role") if current_user else "guest")

    # Isolate server OS identity: guests and remote browsers see neutral "SecureDrop LAN"
    device_name = db.get_setting("device_name", "SecureDrop SafeNode")
    if not admin:
        device_name = "SecureDrop LAN"
        device_id = "node"
    else:
        device_id = db.get_setting("device_id")

    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "device_id": device_id,
        "device_name": device_name,
        "fingerprint": db.get_setting("identity_fingerprint") if admin else None,
        "node_ips": ips if admin else ([ips[0]] if ips else ["127.0.0.1"]),
        "web_port": web_port,
        "tcp_port": tcp_port,
        "web_urls": [f"http://{ip}:{web_port}" for ip in ips],
        "tcp_addresses": [f"{ip}:{tcp_port}" for ip in ips] if admin else [],
        "browser_client_ip": client_host,
        "discovery_port": DISCOVERY_PORT if admin else None,
        "role": role,
        "user": current_user or {
            "id": "guest",
            "username": "guest",
            "display_name": "Guest User",
            "role": "guest",
        },
        "admin_configured": admin_configured(),
        "storage_dir": str(STORAGE_DIR) if admin else None,
    }


@app.post("/api/settings/device-name")
async def set_device_name(payload: Dict[str, str], request: Request) -> Dict[str, Any]:
    require_admin(request)
    name = (payload.get("name") or "").strip()[:80]
    if not name:
        raise HTTPException(400, "Name required")
    db.set_setting("device_name", name)
    return {"ok": True, "device_name": name}


@app.get("/api/optimizer")
async def optimizer() -> Dict[str, Any]:
    ips = get_local_ips()
    wifi_like = True
    chunk_size = 4 * 1024 * 1024
    streams = 4
    if any(ip.startswith("10.") for ip in ips):
        streams = 6
    return {
        "recommended_chunk_size": chunk_size,
        "recommended_parallel_streams": streams,
        "compression": "auto",
        "rules": {
            "compress_extensions": ["txt", "csv", "json", "xml", "html", "css", "js", "py", "java", "c", "cpp", "log", "sql", "md"],
            "skip_compression_extensions": ["zip", "7z", "rar", "mp4", "mkv", "jpg", "jpeg", "png", "webp", "iso", "gz", "zst", "pdf"],
        },
        "note": "Browser will auto-compress only when CompressionStream is supported and file type benefits from compression.",
    }


@app.get("/api/discovery/peers")
async def list_peers(request: Request) -> Dict[str, Any]:
    require_admin(request)
    cutoff = now() - 60
    rows = db.all("SELECT * FROM peers WHERE last_seen>=? ORDER BY trusted DESC, last_seen DESC", (cutoff,))
    return {"peers": [peer_row_to_dict(r) for r in rows]}


@app.post("/api/discovery/probe")
async def probe(request: Request) -> Dict[str, Any]:
    require_admin(request)
    discovery: DiscoveryService = app.state.discovery
    discovery.probe()
    return {"ok": True, "message": "Probe broadcast sent", "broadcasts": subnet_broadcasts(get_local_ips())}


@app.post("/api/trust")
async def trust_device(item: TrustUpdate, request: Request) -> Dict[str, Any]:
    require_admin(request)
    db.execute(
        "INSERT OR REPLACE INTO trusted_devices(device_id,name,trusted,blocked,fingerprint,updated_at) VALUES(?,?,?,?,?,?)",
        (item.device_id, item.name or item.device_id, int(item.trusted), int(item.blocked), item.fingerprint or "", now()),
    )
    row = db.one("SELECT * FROM peers WHERE device_id=?", (item.device_id,))
    if row:
        db.execute("UPDATE peers SET trusted=?, blocked=? WHERE device_id=?", (int(item.trusted), int(item.blocked), item.device_id))
    return {"ok": True}


@app.get("/api/trust")
async def list_trust(request: Request) -> Dict[str, Any]:
    require_admin(request)
    return {"devices": [row_to_dict(r) for r in db.all("SELECT * FROM trusted_devices ORDER BY updated_at DESC")]}


def generate_unique_pin() -> str:
    for _ in range(200):
        pin = f"{secrets.randbelow(9000) + 1000}"
        row = db.one("SELECT token FROM shares WHERE pin=? AND status='open'", (pin,))
        if not row:
            return pin
    return f"{secrets.randbelow(900000) + 100000}"


@app.post("/api/shares")
async def create_share(data: ShareCreate, request: Request) -> Dict[str, Any]:
    token = b64url(secrets.token_bytes(10))
    pin = data.pin or generate_unique_pin()
    exp = now() + data.expires_seconds if data.expires_seconds else None
    ph = password_hash(data.password) if data.password else None
    user = get_current_user(request)
    owner_user_id = user["id"] if user else None
    db.execute(
        """
        INSERT INTO shares(token,pin,title,mode,created_at,expires_at,password_hash,require_approval,delete_after_download,max_downloads,owner_device_id,owner_user_id,meta_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            token,
            pin,
            data.title,
            data.mode,
            now(),
            exp,
            ph,
            int(data.require_approval),
            int(data.delete_after_download),
            int(data.max_downloads or 0),
            db.get_setting("device_id"),
            owner_user_id,
            json.dumps(data.meta or {}),
        ),
    )
    share_dir(token).mkdir(parents=True, exist_ok=True)
    meta = data.meta or {}
    if meta.get("server_encrypted") or meta.get("encryption_mode") == "server-aes-gcm-compat":
        create_server_key_for_share(token)
    db.execute(
        "INSERT INTO history(id,direction,title,peer,status,detail,created_at) VALUES(?,?,?,?,?,?,?)",
        ("hist_" + b64url(secrets.token_bytes(8)), "created", data.title, request.client.host if request.client else "local", "open", f"Share {token} (PIN: {pin}) created", now()),
    )
    await ws_manager.broadcast({"type": "share_created", "token": token, "title": data.title, "pin": pin})
    return {"ok": True, "token": token, "pin": pin}


@app.post("/api/shares/{token}/files")
async def register_file(token: str, f: FileRegister) -> Dict[str, Any]:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    check_share_open(row)
    file_id = f.id or "file_" + b64url(secrets.token_bytes(12))
    db.execute(
        """
        INSERT OR REPLACE INTO files(id,share_token,name,relative_path,size,mime,chunk_size,chunk_count,compression,file_sha256,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
        """,
        (file_id, token, f.name, f.relative_path, int(f.size), f.mime or "", int(f.chunk_size), int(f.chunk_count), f.compression, f.file_sha256, now()),
    )
    return {"ok": True, "file_id": file_id}


@app.get("/api/shares/{token}/files/{file_id}/status")
async def file_status(token: str, file_id: str) -> Dict[str, Any]:
    f = db.one("SELECT * FROM files WHERE id=? AND share_token=?", (file_id, token))
    if not f:
        raise HTTPException(404, "File not found")
    chunks = db.all("SELECT chunk_index, stored_size, plaintext_sha256 FROM chunks WHERE file_id=? ORDER BY chunk_index", (file_id,))
    return {"file_id": file_id, "chunk_count": f["chunk_count"], "uploaded": [row_to_dict(c) for c in chunks]}


@app.put("/api/shares/{token}/files/{file_id}/chunks/{chunk_index}")
async def upload_chunk(token: str, file_id: str, chunk_index: int, request: Request) -> Dict[str, Any]:
    share = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not share:
        raise HTTPException(404, "Share not found")
    check_share_open(share)
    f = db.one("SELECT * FROM files WHERE id=? AND share_token=?", (file_id, token))
    if not f:
        raise HTTPException(404, "File not found")
    if chunk_index < 0 or chunk_index >= int(f["chunk_count"]):
        raise HTTPException(400, "Invalid chunk index")
    meta_raw = request.headers.get("x-chunk-meta")
    if not meta_raw:
        raise HTTPException(400, "Missing x-chunk-meta")
    try:
        meta = json.loads(base64.b64decode(meta_raw).decode())
    except Exception as e:
        raise HTTPException(400, f"Bad chunk metadata: {e}")
    body = await request.body()
    ciphertext_sha = sha256_bytes(body)
    expected = meta.get("ciphertext_sha256")
    if expected and expected != ciphertext_sha:
        raise HTTPException(400, "Ciphertext SHA256 mismatch")
    rel = f"{token}/{file_id}/{chunk_index:012d}.chunk"
    path = safe_join(CHUNK_DIR, rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(path)
    db.execute(
        """
        INSERT OR REPLACE INTO chunks(share_token,file_id,chunk_index,path,stored_size,original_size,plaintext_sha256,ciphertext_sha256,nonce_b64,uploaded_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        """,
        (
            token,
            file_id,
            chunk_index,
            rel,
            len(body),
            int(meta.get("original_size") or 0),
            str(meta.get("plaintext_sha256") or ""),
            ciphertext_sha,
            str(meta.get("nonce_b64") or ""),
            now(),
        ),
    )
    uploaded = db.one("SELECT COUNT(*) AS c, COALESCE(SUM(stored_size),0) AS bytes FROM chunks WHERE file_id=?", (file_id,))
    await ws_manager.broadcast({"type": "chunk_uploaded", "token": token, "file_id": file_id, "chunk_index": chunk_index, "uploaded_chunks": uploaded["c"], "uploaded_bytes": uploaded["bytes"]})
    return {"ok": True, "chunk_index": chunk_index, "stored_size": len(body), "ciphertext_sha256": ciphertext_sha}


@app.put("/api/shares/{token}/files/{file_id}/chunks/{chunk_index}/plain")
async def upload_plain_chunk_server_encrypted(token: str, file_id: str, chunk_index: int, request: Request) -> Dict[str, Any]:
    """HTTP-LAN compatibility endpoint.

    Some mobile browsers disable Web Crypto on http://LAN-IP origins. This endpoint lets the
    local Python node encrypt chunks at rest using AES-GCM so the app still works without
    Termux or HTTPS. For true browser E2E encryption, open through localhost/HTTPS.
    """
    share = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not share:
        raise HTTPException(404, "Share not found")
    check_share_open(share)
    aes = get_server_aes(token)
    f = db.one("SELECT * FROM files WHERE id=? AND share_token=?", (file_id, token))
    if not f:
        raise HTTPException(404, "File not found")
    if chunk_index < 0 or chunk_index >= int(f["chunk_count"]):
        raise HTTPException(400, "Invalid chunk index")
    plain = await request.body()
    plaintext_sha = sha256_bytes(plain)
    expected_plain = request.headers.get("x-plaintext-sha256")
    if expected_plain and expected_plain != plaintext_sha:
        raise HTTPException(400, "Plaintext SHA256 mismatch")
    nonce = secrets.token_bytes(12)
    encrypted = nonce + aes.encrypt(nonce, plain, None)
    ciphertext_sha = sha256_bytes(encrypted)
    rel = f"{token}/{file_id}/{chunk_index:012d}.chunk"
    path = safe_join(CHUNK_DIR, rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(encrypted)
    tmp.replace(path)
    db.execute(
        """
        INSERT OR REPLACE INTO chunks(share_token,file_id,chunk_index,path,stored_size,original_size,plaintext_sha256,ciphertext_sha256,nonce_b64,uploaded_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        """,
        (token, file_id, chunk_index, rel, len(encrypted), len(plain), plaintext_sha, ciphertext_sha, b64url(nonce), now()),
    )
    uploaded = db.one("SELECT COUNT(*) AS c, COALESCE(SUM(stored_size),0) AS bytes FROM chunks WHERE file_id=?", (file_id,))
    await ws_manager.broadcast({"type": "chunk_uploaded", "token": token, "file_id": file_id, "chunk_index": chunk_index, "uploaded_chunks": uploaded["c"], "uploaded_bytes": uploaded["bytes"]})
    return {"ok": True, "chunk_index": chunk_index, "stored_size": len(encrypted), "plaintext_sha256": plaintext_sha, "ciphertext_sha256": ciphertext_sha}


@app.get("/api/shares/{token}")
async def share_meta(token: str, ticket: Optional[str] = None) -> Dict[str, Any]:
    return get_share_metadata(token, ticket=ticket)


@app.post("/api/shares/{token}/unlock")
async def unlock_share(token: str, data: AccessRequest, request: Request) -> Dict[str, Any]:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    check_share_open(row)
    if row["password_hash"] and not verify_password(row, data.password):
        raise HTTPException(403, "Wrong password")
    ticket = "tkt_" + b64url(secrets.token_bytes(18))
    approved = 1 if not row["require_approval"] else 0
    db.execute(
        "INSERT INTO access_tickets(ticket,share_token,device_id,device_name,approved,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
        (ticket, token, data.device_id or "browser", data.device_name, approved, now() + 3600, now()),
    )
    approval_id = None
    if row["require_approval"]:
        approval_id = "apv_" + b64url(secrets.token_bytes(10))
        db.execute(
            "INSERT INTO approvals(id,share_token,device_id,device_name,requester_ip,status,ticket,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (approval_id, token, data.device_id or "browser", data.device_name, request.client.host if request.client else "unknown", "pending", ticket, now()),
        )
        await ws_manager.broadcast({"type": "approval_requested", "approval_id": approval_id, "token": token, "share_title": row["title"], "device_name": data.device_name, "requester_ip": request.client.host if request.client else "unknown"})
        return {"ok": True, "pending_approval": True, "approval_id": approval_id, "ticket": ticket}
    return {"ok": True, "ticket": ticket, "pending_approval": False}


@app.get("/api/approvals")
async def list_approvals(request: Request, history: bool = False) -> Dict[str, Any]:
    require_admin(request)
    if history:
        rows = db.all("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100")
    else:
        rows = db.all("SELECT * FROM approvals WHERE status='pending' ORDER BY created_at DESC LIMIT 50")
    return {"approvals": [row_to_dict(r) for r in rows], "history": history}


@app.post("/api/approvals/{approval_id}/{decision}")
async def decide_approval(approval_id: str, decision: str, request: Request) -> Dict[str, Any]:
    require_admin(request)
    if decision not in {"accept", "reject"}:
        raise HTTPException(400, "Decision must be accept or reject")
    row = db.one("SELECT * FROM approvals WHERE id=?", (approval_id,))
    if not row:
        raise HTTPException(404, "Approval not found")
    status = "accepted" if decision == "accept" else "rejected"
    db.execute("UPDATE approvals SET status=?, decided_at=? WHERE id=?", (status, now(), approval_id))
    if decision == "accept" and row["ticket"]:
        db.execute("UPDATE access_tickets SET approved=1 WHERE ticket=?", (row["ticket"],))
    await ws_manager.broadcast({"type": "approval_decided", "approval_id": approval_id, "status": status, "ticket": row["ticket"]})
    return {"ok": True, "status": status}


@app.get("/api/shares/{token}/files/{file_id}/chunks/{chunk_index}")
async def download_chunk(token: str, file_id: str, chunk_index: int, ticket: Optional[str] = None) -> Response:
    data, meta = read_chunk_bytes(token, file_id, chunk_index, ticket=ticket)
    headers = {"x-chunk-meta": b64url(json.dumps(meta).encode()), "cache-control": "no-store"}
    return Response(content=data, media_type="application/octet-stream", headers=headers)


@app.get("/api/shares/{token}/files/{file_id}/chunks/{chunk_index}/plain")
async def download_plain_chunk_server_decrypted(token: str, file_id: str, chunk_index: int, ticket: Optional[str] = None) -> Response:
    encrypted, meta = read_chunk_bytes(token, file_id, chunk_index, ticket=ticket)
    aes = get_server_aes(token)
    if len(encrypted) < 13:
        raise HTTPException(500, "Encrypted chunk is invalid")
    nonce = encrypted[:12]
    cipher = encrypted[12:]
    try:
        plain = aes.decrypt(nonce, cipher, None)
    except Exception:
        raise HTTPException(500, "Server-side AES-GCM decrypt failed")
    if meta.get("plaintext_sha256") and sha256_bytes(plain) != meta.get("plaintext_sha256"):
        raise HTTPException(500, "Plaintext integrity mismatch")
    response_meta = dict(meta)
    response_meta["server_decrypted"] = True
    response_meta["compression"] = "none"
    headers = {"x-chunk-meta": b64url(json.dumps(response_meta).encode()), "cache-control": "no-store"}
    return Response(content=plain, media_type="application/octet-stream", headers=headers)


def parse_range_header(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    if not range_header or not range_header.startswith("bytes="):
        return None
    try:
        parts = range_header[6:].split("-")
        if len(parts) != 2:
            return None
        start_str, end_str = parts[0].strip(), parts[1].strip()
        if start_str and end_str:
            start = int(start_str)
            end = int(end_str)
        elif start_str:
            start = int(start_str)
            end = file_size - 1
        elif end_str:
            suffix = int(end_str)
            start = max(0, file_size - suffix)
            end = file_size - 1
        else:
            return None
        if start < 0 or start > end or start >= file_size:
            return None
        end = min(end, file_size - 1)
        return (start, end)
    except Exception:
        return None


def read_decrypted_chunk(token: str, file_row: sqlite3.Row, chunk_index: int, key_bytes: Optional[bytes] = None, ticket: Optional[str] = None) -> bytes:
    data, meta = read_chunk_bytes(token, file_row["id"], chunk_index, ticket=ticket)
    if key_bytes:
        nonce = data[:12]
        cipher = data[12:]
        plain = AESGCM(key_bytes).decrypt(nonce, cipher, None)
    else:
        key_b64 = db.get_setting(server_key_setting(token))
        if key_b64:
            aes = AESGCM(b64url_decode(key_b64))
            nonce = data[:12]
            cipher = data[12:]
            plain = aes.decrypt(nonce, cipher, None)
        else:
            raise HTTPException(400, "Decryption key required. Provide #key fragment or ?key= parameter.")

    if meta.get("compression") == "gzip":
        plain = gzip.decompress(plain)
    if meta.get("plaintext_sha256") and sha256_bytes(plain) != meta.get("plaintext_sha256"):
        raise HTTPException(500, "Plaintext integrity mismatch")
    return plain


@app.get("/api/shares/by-pin/{pin}")
async def get_share_by_pin(pin: str) -> Dict[str, Any]:
    row = db.one("SELECT * FROM shares WHERE pin=? AND status='open'", (pin,))
    if not row:
        raise HTTPException(404, "No active share found with this PIN")
    check_share_open(row)
    return {
        "ok": True,
        "token": row["token"],
        "title": row["title"],
        "pin": row["pin"],
        "requires_password": bool(row["password_hash"]),
        "requires_approval": bool(row["require_approval"])
    }


@app.get("/api/shares/{token}/files/{file_id}/stream")
async def stream_file(
    token: str,
    file_id: str,
    request: Request,
    ticket: Optional[str] = None,
    key: Optional[str] = None,
    download: bool = False
) -> Response:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    check_share_open(row)
    if not validate_ticket(token, ticket):
        raise HTTPException(403, "Access denied")

    file_row = db.one("SELECT * FROM files WHERE id=? AND share_token=?", (file_id, token))
    if not file_row:
        raise HTTPException(404, "File not found")

    file_size = int(file_row["size"])
    chunk_size = int(file_row["chunk_size"])
    chunk_count = int(file_row["chunk_count"])
    mime_type = file_row["mime"] or "application/octet-stream"

    key_str = key or request.headers.get("x-decrypt-key")
    key_bytes = b64url_decode(key_str) if key_str else None

    range_header = request.headers.get("range")
    range_tuple = parse_range_header(range_header, file_size) if range_header else None

    filename = file_row["name"] or "download"
    disposition = "attachment" if download else "inline"

    if range_tuple:
        start, end = range_tuple
        content_length = end - start + 1

        async def range_generator():
            for idx in range(chunk_count):
                c_start = idx * chunk_size
                c_end = min((idx + 1) * chunk_size - 1, file_size - 1)
                if c_end < start or c_start > end:
                    continue
                slice_start = max(0, start - c_start)
                slice_end = min(c_end - c_start + 1, end - c_start + 1)
                plain = read_decrypted_chunk(token, file_row, idx, key_bytes, ticket=ticket)
                sliced = plain[slice_start:slice_end]
                offset = 0
                while offset < len(sliced):
                    chunk = sliced[offset:offset + 65536]
                    yield chunk
                    offset += len(chunk)

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-cache"
        }
        return StreamingResponse(range_generator(), status_code=206, media_type=mime_type, headers=headers)
    else:
        async def full_generator():
            for idx in range(chunk_count):
                plain = read_decrypted_chunk(token, file_row, idx, key_bytes, ticket=ticket)
                offset = 0
                while offset < len(plain):
                    chunk = plain[offset:offset + 65536]
                    yield chunk
                    offset += len(chunk)

        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-cache"
        }
        return StreamingResponse(full_generator(), status_code=200, media_type=mime_type, headers=headers)


@app.get("/api/shares/{token}/files/{file_id}/preview")
async def preview_file(
    token: str,
    file_id: str,
    request: Request,
    ticket: Optional[str] = None,
    key: Optional[str] = None,
    inline: bool = True
) -> Response:
    return await stream_file(token, file_id, request, ticket=ticket, key=key, download=not inline)


@app.get("/api/shares/{token}/zip")
async def stream_zip(
    token: str,
    request: Request,
    ticket: Optional[str] = None,
    key: Optional[str] = None
) -> Response:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    check_share_open(row)
    if not validate_ticket(token, ticket):
        raise HTTPException(403, "Access denied")

    files = db.all("SELECT * FROM files WHERE share_token=? ORDER BY relative_path", (token,))
    if not files:
        raise HTTPException(404, "No files in share")

    key_str = key or request.headers.get("x-decrypt-key")
    key_bytes = b64url_decode(key_str) if key_str else None

    share_title = row["title"] or f"securedrop_{token}"
    safe_title = "".join(c for c in share_title if c.isalnum() or c in ("-", "_", " ")).strip() or token

    async def zip_generator():
        entries = []
        offset = 0

        for f in files:
            name_str = f["relative_path"] or f["name"] or f["id"]
            name_bytes = name_str.encode("utf-8")
            file_size = int(f["size"])
            chunk_count = int(f["chunk_count"])
            local_offset = offset

            local_header = struct.pack(
                "<4sHHHHHIIIHH",
                b"PK\x03\x04",
                20,
                0x0008,
                0,
                0,
                0,
                0,
                0,
                0,
                len(name_bytes),
                0
            )
            yield local_header
            yield name_bytes
            offset += len(local_header) + len(name_bytes)

            crc = 0
            for c_idx in range(chunk_count):
                plain = read_decrypted_chunk(token, f, c_idx, key_bytes, ticket=ticket)
                crc = zlib.crc32(plain, crc) & 0xffffffff
                yield plain
                offset += len(plain)

            desc = struct.pack("<4sIII", b"PK\x07\x08", crc, file_size, file_size)
            yield desc
            offset += len(desc)

            entries.append((name_bytes, crc, file_size, local_offset))

        cd_start = offset
        for name_bytes, crc, file_size, local_offset in entries:
            cd_header = struct.pack(
                "<4sHHHHHHIIIHHHHHII",
                b"PK\x01\x02",
                20,
                20,
                0x0008,
                0,
                0,
                0,
                crc,
                file_size,
                file_size,
                len(name_bytes),
                0,
                0,
                0,
                0,
                0,
                local_offset
            )
            yield cd_header
            yield name_bytes
            offset += len(cd_header) + len(name_bytes)

        cd_size = offset - cd_start
        eocd = struct.pack(
            "<4sHHHHIIH",
            b"PK\x05\x06",
            0,
            0,
            len(entries),
            len(entries),
            cd_size,
            cd_start,
            0
        )
        yield eocd

    headers = {
        "Content-Disposition": f'attachment; filename="{safe_title}.zip"',
        "Cache-Control": "no-cache"
    }
    return StreamingResponse(zip_generator(), status_code=200, media_type="application/zip", headers=headers)


@app.get("/api/system/stats")
async def system_stats(request: Request) -> Dict[str, Any]:
    require_admin(request)
    storage_stat = shutil.disk_usage(STORAGE_DIR)
    share_count = db.one("SELECT COUNT(*) AS c FROM shares")["c"]
    chunk_count = db.one("SELECT COUNT(*) AS c FROM chunks")["c"]
    history_count = db.one("SELECT COUNT(*) AS c FROM history")["c"]
    return {
        "storage": {
            "total_bytes": storage_stat.total,
            "used_bytes": storage_stat.used,
            "free_bytes": storage_stat.free
        },
        "shares_count": share_count,
        "chunks_count": chunk_count,
        "history_count": history_count,
        "uptime": now()
    }


@app.post("/api/shares/{token}/download-complete")
async def download_complete(token: str, ticket: Optional[str] = None) -> Dict[str, Any]:
    if not validate_ticket(token, ticket):
        raise HTTPException(403, "Access denied")
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    downloads = int(row["downloads"] or 0) + 1
    db.execute("UPDATE shares SET downloads=? WHERE token=?", (downloads, token))
    db.execute(
        "INSERT INTO history(id,direction,title,status,detail,created_at,finished_at) VALUES(?,?,?,?,?,?,?)",
        ("hist_" + b64url(secrets.token_bytes(8)), "downloaded", row["title"], "done", f"Share {token} download completed", now(), now()),
    )
    if row["delete_after_download"]:
        db.execute("UPDATE shares SET status='deleted_after_download' WHERE token=?", (token,))
    await ws_manager.broadcast({"type": "download_complete", "token": token, "downloads": downloads})
    return {"ok": True, "downloads": downloads}


@app.get("/api/shares/{token}/qr")
async def share_qr(token: str, request: Request, key: Optional[str] = None) -> FileResponse:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    host = request.headers.get("host") or f"127.0.0.1:{getattr(request.app.state, 'web_port', DEFAULT_WEB_PORT)}"
    url = f"http://{host}/share/{token}"
    if key:
        url += f"#key={key}"
    img = qrcode.make(url)
    path = safe_join(QR_DIR, f"{token}.png")
    img.save(path)
    return FileResponse(path, media_type="image/png")


@app.get("/api/shares")
async def list_shares(request: Request) -> Dict[str, Any]:
    user = get_current_user(request)
    admin = is_admin_request(request)
    if not admin and not user:
        raise HTTPException(401, "Authentication required to inspect shares")

    if admin:
        rows = db.all("SELECT * FROM shares ORDER BY created_at DESC LIMIT 100")
    else:
        rows = db.all("SELECT * FROM shares WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 100", (user["id"],))

    out = []
    for r in rows:
        d = row_to_dict(r) or {}
        files = db.one("SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM files WHERE share_token=?", (r["token"],))
        chunks = db.one("SELECT COUNT(*) AS c, COALESCE(SUM(stored_size),0) AS s FROM chunks WHERE share_token=?", (r["token"],))
        d["file_count"] = files["c"] if files else 0
        d["total_size"] = files["s"] if files else 0
        d["stored_size"] = chunks["s"] if chunks else 0
        d.pop("password_hash", None)
        out.append(d)
    return {"shares": out}


@app.delete("/api/shares/{token}")
async def delete_share(token: str, request: Request) -> Dict[str, Any]:
    user = get_current_user(request)
    admin = is_admin_request(request)
    if not admin and not user:
        raise HTTPException(401, "Authentication required")

    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")

    if not admin and row["owner_user_id"] != user["id"]:
        raise HTTPException(403, "Permission denied: you cannot delete another user's share")

    db.execute("UPDATE shares SET status='deleted' WHERE token=?", (token,))
    path = share_dir(token)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    await ws_manager.broadcast({"type": "share_deleted", "token": token})
    return {"ok": True}


@app.get("/api/history")
async def history(request: Request) -> Dict[str, Any]:
    require_admin(request)
    return {"history": [row_to_dict(r) for r in db.all("SELECT * FROM history ORDER BY created_at DESC LIMIT 200")]}


@app.get("/api/jobs")
async def jobs(request: Request) -> Dict[str, Any]:
    require_admin(request)
    return {"jobs": [row_to_dict(r) for r in db.all("SELECT * FROM transfer_jobs ORDER BY updated_at DESC LIMIT 100")]}


def update_job(job_id: str, **kwargs: Any) -> None:
    allowed = {"status", "progress", "speed_bps", "eta_seconds", "detail", "meta_json"}
    fields = []
    params: List[Any] = []
    for k, v in kwargs.items():
        if k in allowed:
            fields.append(f"{k}=?")
            params.append(v)
    fields.append("updated_at=?")
    params.append(now())
    params.append(job_id)
    db.execute(f"UPDATE transfer_jobs SET {', '.join(fields)} WHERE id=?", tuple(params))
    row = db.one("SELECT * FROM transfer_jobs WHERE id=?", (job_id,))
    broadcast_from_thread({"type": "job_update", "job": row_to_dict(row)})


def decrypt_chunk_python(key: bytes, encrypted_payload: bytes) -> bytes:
    nonce = encrypted_payload[:12]
    ciphertext = encrypted_payload[12:]
    return AESGCM(key).decrypt(nonce, ciphertext, None)


def pull_worker(job_id: str, cfg: PullStart) -> None:
    start = time.time()
    out_base = safe_join(PULL_DIR, cfg.output_dir or f"pull_{cfg.token}_{int(start)}")
    out_base.mkdir(parents=True, exist_ok=True)
    done_bytes = 0
    try:
        key = b64url_decode(cfg.key_b64)
        ticket = cfg.ticket
        if not ticket:
            unlock_payload = {"device_id": db.get_setting("device_id"), "device_name": db.get_setting("device_name"), "password": cfg.password}
            r = requests.post(f"{cfg.base_url.rstrip('/')}/api/shares/{cfg.token}/unlock", json=unlock_payload, timeout=20)
            r.raise_for_status()
            ticket = r.json().get("ticket")
        meta_url = f"{cfg.base_url.rstrip('/')}/api/shares/{cfg.token}?ticket={ticket or ''}"
        meta = requests.get(meta_url, timeout=20).json()
        if meta.get("locked"):
            raise RuntimeError("Share locked or approval still pending")
        files = meta.get("files", [])
        total_plain = sum(int(f.get("size") or 0) for f in files)
        state_path = out_base / ".securedrop_resume.json"
        state = {"files": {}}
        if state_path.exists():
            try:
                state = json.loads(state_path.read_text())
            except Exception:
                state = {"files": {}}

        for f in files:
            file_id = f["id"]
            rel_path = f.get("relative_path") or f.get("name") or file_id
            target = safe_join(out_base, rel_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            file_state = state.setdefault("files", {}).setdefault(file_id, {"chunks": []})
            completed = set(file_state.get("chunks") or [])
            mode = "r+b" if target.exists() else "w+b"
            with open(target, mode) as fp:
                for idx in range(int(f["chunk_count"])):
                    if idx in completed:
                        continue
                    chunk_url = f"{cfg.base_url.rstrip('/')}/api/shares/{cfg.token}/files/{file_id}/chunks/{idx}?ticket={ticket or ''}"
                    rr = requests.get(chunk_url, timeout=120)
                    rr.raise_for_status()
                    chunk_meta_header = rr.headers.get('x-chunk-meta') or ''
                    chunk_meta = {}
                    if chunk_meta_header:
                        try:
                            chunk_meta = json.loads(b64url_decode(chunk_meta_header).decode())
                        except Exception:
                            chunk_meta = {}
                    plain = decrypt_chunk_python(key, rr.content)
                    if chunk_meta.get('compression') == 'gzip':
                        plain = gzip.decompress(plain)
                    elif chunk_meta.get('compression') not in (None, '', 'none'):
                        raise RuntimeError(f"Unsupported compression: {chunk_meta.get('compression')}")
                    if chunk_meta.get('plaintext_sha256') and sha256_bytes(plain) != chunk_meta.get('plaintext_sha256'):
                        raise RuntimeError(f"Plaintext integrity failed for {rel_path} chunk {idx}")
                    fp.seek(idx * int(f["chunk_size"]))
                    fp.write(plain)
                    completed.add(idx)
                    file_state["chunks"] = sorted(completed)
                    state_path.write_text(json.dumps(state, indent=2))
                    done_bytes += len(plain)
                    elapsed = max(time.time() - start, 0.001)
                    speed = done_bytes / elapsed
                    progress = (done_bytes / total_plain * 100) if total_plain else 0
                    eta = ((total_plain - done_bytes) / speed) if speed else 0
                    update_job(job_id, status="running", progress=progress, speed_bps=speed, eta_seconds=eta, detail=f"Pulling {rel_path} chunk {idx+1}/{f['chunk_count']}")
        update_job(job_id, status="done", progress=100, speed_bps=0, eta_seconds=0, detail=f"Saved to {out_base}")
        db.execute(
            "INSERT INTO history(id,direction,title,peer,size,status,detail,created_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?)",
            ("hist_" + b64url(secrets.token_bytes(8)), "pulled", meta.get("title"), cfg.base_url, total_plain, "done", str(out_base), now(), now()),
        )
    except Exception as e:
        update_job(job_id, status="failed", detail=str(e))


@app.post("/api/pulls/start")
async def start_pull(cfg: PullStart, request: Request) -> Dict[str, Any]:
    require_admin(request)
    job_id = "job_" + b64url(secrets.token_bytes(10))
    db.execute(
        "INSERT INTO transfer_jobs(id,kind,title,status,progress,detail,created_at,updated_at,meta_json) VALUES(?,?,?,?,?,?,?,?,?)",
        (job_id, "pull", f"Pull {cfg.token}", "queued", 0, "Queued", now(), now(), cfg.model_dump_json()),
    )
    threading.Thread(target=pull_worker, args=(job_id, cfg), daemon=True).start()
    return {"ok": True, "job_id": job_id}


@app.post("/api/clipboard")
async def create_clipboard(data: ClipboardCreate) -> Dict[str, Any]:
    cid = "clip_" + b64url(secrets.token_bytes(8))
    exp = now() + data.expires_seconds if data.expires_seconds else None
    db.execute("INSERT INTO clipboard_items(id,text,created_at,expires_at) VALUES(?,?,?,?)", (cid, data.text, now(), exp))
    # Also create a normal share so clipboard can use same receive flow.
    token = b64url(secrets.token_bytes(10))
    ph = password_hash(data.password) if data.password else None
    meta = {"clipboard_id": cid, "text_preview": data.text[:120]}
    db.execute(
        "INSERT INTO shares(token,title,mode,created_at,expires_at,password_hash,meta_json) VALUES(?,?,?,?,?,?,?)",
        (token, "Clipboard Text", "clipboard", now(), exp, ph, json.dumps(meta)),
    )
    return {"ok": True, "clipboard_id": cid, "token": token, "text": data.text}


@app.get("/api/clipboard/{cid}")
async def read_clipboard(cid: str) -> Dict[str, Any]:
    row = db.one("SELECT * FROM clipboard_items WHERE id=?", (cid,))
    if not row:
        raise HTTPException(404, "Clipboard item not found")
    if row["expires_at"] and int(row["expires_at"]) < now():
        raise HTTPException(410, "Clipboard item expired")
    return {"id": cid, "text": row["text"], "created_at": row["created_at"], "expires_at": row["expires_at"]}


@app.get("/api/vault")
async def vault_status(request: Request) -> Dict[str, Any]:
    require_admin(request)
    shares = db.all("SELECT token,title,status,created_at,expires_at FROM shares ORDER BY created_at DESC LIMIT 100")
    total = 0
    for p in CHUNK_DIR.rglob("*.chunk"):
        try:
            total += p.stat().st_size
        except Exception:
            pass
    return {
        "encrypted_storage_bytes": total,
        "shares": [row_to_dict(s) for s in shares],
        "note": "Vault stores browser-encrypted chunks. File keys are kept in share URL fragments, not in the database.",
    }


def _share_storage_rows() -> List[Dict[str, Any]]:
    rows = db.all("SELECT * FROM shares ORDER BY created_at DESC LIMIT 500")
    out: List[Dict[str, Any]] = []
    for r in rows:
        d = row_to_dict(r) or {}
        files = db.one("SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM files WHERE share_token=?", (r["token"],))
        chunks = db.one("SELECT COUNT(*) AS c, COALESCE(SUM(stored_size),0) AS s FROM chunks WHERE share_token=?", (r["token"],))
        d["file_count"] = files["c"] if files else 0
        d["total_size"] = files["s"] if files else 0
        d["chunk_count"] = chunks["c"] if chunks else 0
        d["stored_size"] = chunks["s"] if chunks else 0
        d.pop("password_hash", None)
        out.append(d)
    return out


def _delete_share_data(token: str) -> None:
    path = share_dir(token)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    qr_path = safe_join(QR_DIR, f"{token}.png")
    if qr_path.exists():
        try:
            qr_path.unlink()
        except Exception:
            pass
    db.execute("DELETE FROM chunks WHERE share_token=?", (token,))
    db.execute("DELETE FROM files WHERE share_token=?", (token,))
    db.execute("DELETE FROM access_tickets WHERE share_token=?", (token,))
    db.execute("DELETE FROM approvals WHERE share_token=?", (token,))
    db.execute("UPDATE shares SET status='deleted' WHERE token=?", (token,))


@app.get("/api/storage/overview")
async def storage_overview(request: Request) -> Dict[str, Any]:
    require_admin(request)
    rows = _share_storage_rows()
    chunk_bytes = 0
    tmp_bytes = 0
    for p in CHUNK_DIR.rglob("*.chunk"):
        try:
            chunk_bytes += p.stat().st_size
        except Exception:
            pass
    for p in TMP_DIR.rglob("*"):
        try:
            if p.is_file():
                tmp_bytes += p.stat().st_size
        except Exception:
            pass
    return {
        "storage_dir": str(STORAGE_DIR),
        "encrypted_chunk_bytes": chunk_bytes,
        "tmp_bytes": tmp_bytes,
        "share_count": len(rows),
        "shares": rows,
    }


@app.delete("/api/storage/shares/{token}")
async def storage_delete_share(token: str, request: Request) -> Dict[str, Any]:
    require_admin(request)
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    _delete_share_data(token)
    await ws_manager.broadcast({"type": "share_deleted", "token": token})
    return {"ok": True, "token": token}


@app.delete("/api/storage/all")
async def storage_delete_all(request: Request) -> Dict[str, Any]:
    require_admin(request)
    tokens = [r["token"] for r in db.all("SELECT token FROM shares")]
    for token in tokens:
        _delete_share_data(token)
    for directory in [TMP_DIR, QR_DIR]:
        for p in directory.rglob("*"):
            try:
                if p.is_file():
                    p.unlink()
            except Exception:
                pass
    await ws_manager.broadcast({"type": "storage_cleared", "count": len(tokens)})
    return {"ok": True, "deleted_shares": len(tokens)}


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str, request: Request) -> Dict[str, Any]:
    require_admin(request)
    db.execute("DELETE FROM transfer_jobs WHERE id=?", (job_id,))
    return {"ok": True}


@app.delete("/api/jobs")
async def clear_jobs(request: Request) -> Dict[str, Any]:
    require_admin(request)
    db.execute("DELETE FROM transfer_jobs")
    return {"ok": True}


@app.get("/api/integrity/{token}")
async def integrity(token: str) -> Dict[str, Any]:
    row = db.one("SELECT * FROM shares WHERE token=?", (token,))
    if not row:
        raise HTTPException(404, "Share not found")
    files = []
    corrupted = 0
    for f in db.all("SELECT * FROM files WHERE share_token=?", (token,)):
        chunks = []
        for c in db.all("SELECT * FROM chunks WHERE file_id=? ORDER BY chunk_index", (f["id"],)):
            path = safe_join(CHUNK_DIR, c["path"])
            ok = path.exists() and sha256_bytes(path.read_bytes()) == c["ciphertext_sha256"]
            if not ok:
                corrupted += 1
            chunks.append({"chunk_index": c["chunk_index"], "stored_size": c["stored_size"], "ciphertext_ok": ok, "plaintext_sha256": c["plaintext_sha256"]})
        files.append({"file": row_to_dict(f), "chunks": chunks, "uploaded_chunks": len(chunks), "expected_chunks": f["chunk_count"]})
    return {"token": token, "files": files, "corrupted_chunks": corrupted}


def create_app(web_port: int, tcp_port: int) -> FastAPI:
    app.state.web_port = web_port
    app.state.tcp_port = tcp_port
    app.state.discovery = DiscoveryService(web_port, tcp_port)
    app.state.tcp_server = TCPChunkServer("0.0.0.0", tcp_port)
    return app


@app.on_event("startup")
async def on_startup() -> None:
    global main_loop
    main_loop = asyncio.get_running_loop()
    if not hasattr(app.state, "discovery"):
        create_app(DEFAULT_WEB_PORT, DEFAULT_TCP_PORT)
    app.state.discovery.start()
    app.state.tcp_server.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    if hasattr(app.state, "discovery"):
        app.state.discovery.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="SecureDrop LAN v2")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_WEB_PORT)
    parser.add_argument("--tcp-port", type=int, default=DEFAULT_TCP_PORT)
    parser.add_argument("--device-name", default=None)
    args = parser.parse_args()
    if args.device_name:
        db.set_setting("device_name", args.device_name)
    create_app(args.port, args.tcp_port)
    print(f"\n{APP_NAME} v{APP_VERSION}")
    print(f"Device: {db.get_setting('device_name')} ({db.get_setting('device_id')})")
    for url in [f"http://{ip}:{args.port}" for ip in get_local_ips()]:
        print(f"Web: {url}")
    for addr in [f"{ip}:{args.tcp_port}" for ip in get_local_ips()]:
        print(f"TCP: {addr}")
    print(f"Discovery UDP: {DISCOVERY_PORT}\n")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
