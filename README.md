# SecureDrop LAN Enterprise v2.4

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-brightgreen.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Framework-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![SQLite WAL](https://img.shields.io/badge/Database-SQLite%20WAL-003B57.svg)](https://www.sqlite.org/wal.html)
[![AES-GCM 256](https://img.shields.io/badge/Cryptography-AES--GCM%20256-success.svg)](https://en.wikipedia.org/wiki/Galois/Counter_Mode)

**SecureDrop LAN** is a zero-cloud local network file exchange, streaming, and clipboard synchronization platform engineered for high-security intranet deployments. It enables machines across the same Wi-Fi or wired network to transfer multi-gigabyte payloads at line speed (10Gbps+ capable) without third-party cloud infrastructure, internet connectivity, or client installations.

---

## Highlights & Capabilities

- **Modular Multi-Paged Terminal Architecture:** Clean, dedicated operational routes (`/send`, `/receive`, `/shares`, `/clipboard`, `/peers`, `/admin`) built with responsive desktop header navigation, mobile bottom navigation, and collapsible sidebar controls.
- **Layered Hardware AES-GCM Encryption:** Chunk encryption keys are derived from a composite triad via BLAKE2b:
  $$\text{Key} = \text{BLAKE2b}\Big(\text{temp\_access\_key} \,\|\, \text{user\_pass\_hash} \,\|\, \text{random\_secure\_salt}\Big) \pmod{256\text{-bit}}$$
  Raw chunks stored on disk are mathematically undecryptable even if physical storage media is compromised, while OpenSSL hardware AES-NI instructions maintain multi-gigabit throughput.
- **Client State Tracking & Interrupted Upload Recovery:** Active uploads and drafts are tracked locally across browser reloads. Interrupted transmissions prompt one-click resumption from the exact chunk offset, and completed shares retain their links, PINs, and QR codes without blowing away upon refresh.
- **Strict User Session Isolation:** Storage keys and drafts are strictly scoped to authenticated user IDs (`sd_draft_u_<id>`), guaranteeing zero data leakage (such as file titles or snippets) across account transitions.
- **Hosted Shares Terminal (`/shares`):** Dedicated creator dashboard with live countdown timers, download capacity progress, 1-click PIN/link copying, and immediate self-service revocation.
- **Immediate Physical Chunk Scrubbing:** 1-time burn-after-reading shares and expired files have their `.chunk` files physically wiped from disk immediately upon download or expiration. An automated 15-second background sweep ensures zero lingering files.
- **Enterprise Admin Cockpit with Dedicated Modals:** High-performance dashboard featuring 4 focused, paginated modals (Storage Audit, User RBAC, Background Node Pull, and Security Audit Logs) with database-level `LIMIT 25` queries and 100/200 row options.
- **Production Service Controller (`start.sh`):** Comprehensive bash controller providing background daemon launch, live status inspection, `tail -f` log streaming, graceful restarts, auto-restart crash supervisor, and persistent `systemd --user` auto-start on boot.
- **Dynamic On-the-Fly ZIP Streaming & RFC 7233:** In-flight streaming directory downloads with data descriptors (`0x0008`) and byte-range streaming (`206 Partial Content`) for immediate media scrubbing without server memory buffering.
- **Zero-Emoji Industrial Design System:** Clean typographic glyphs, geometric symbols, and vector SVG door indicators replacing all pictorial emoji fonts across themes.

---

## 🏗️ Architecture

```text
                 +---------------------------------------------------+
                 |                 Local Network (LAN)               |
                 +---------------------------------------------------+
                                      |
                +---------------------+---------------------+
                |                                           |
       [Host SecureDrop Node]                        [Remote Browser]
 +-------------------------------+             +-------------------------+
 | FastAPI Web Core (TCP :8000)  |<--- HTTP ---| Web Browser / Mobile    |
 | - Multi-Page HTML/JS Engine   |<--- WSS ----| - Clean Typography UI   |
 | - Resumable Chunk Controller  |             | - State Tracking Engine |
 | - Layered BLAKE2b AES-GCM     |             | - Web Crypto AES-GCM    |
 | - Database Pagination Engine  |             | - 4-Digit Quick PIN     |
 | - Proactive 15s Chunk Reaper  |             | - Media Lightbox Scrub  |
 |                               |             +-------------------------+
 | TCP Chunk Server (TCP :9001)  |<--- TCP ----+ [Peer SecureDrop Node]
 | - Socket streaming & TCP_NODELAY            | - Disk-to-disk node sync|
 |                               |             +-------------------------+
 | UDP Discovery (UDP :45678)    |<--- UDP ----+ [LAN Node Broadcast]
 | - Node heartbeats & discovery |
 |                               |
 | Storage Engine (SQLite WAL)   |
 | - Mapped I/O & Memory Cache   |
 +-------------------------------+
```

---

## 🔐 Security & Access Control (RBAC)

SecureDrop LAN implements strict Role-Based Access Control to enforce least-privilege principles:

| Role | Access Scope | Capabilities & Privacy Boundaries |
|---|---|---|
| **Admin** | Node Authority | Hardware telemetry, user account provisioning, access approvals, storage purging, and audit logs. Admin views display `[Audit Only]` badges and cannot decrypt or tamper with isolated zero-knowledge user payloads. |
| **Member** | Authenticated User | Chunked file upload, 4-digit PIN generation, private clipboard notes, hosted shares dashboard, and self-service revocation of owned shares. |
| **Guest** | Anonymous Visitor | Quick PIN receiver (`/receive`), direct file downloads, media lightbox preview, and anonymous file submission. Host OS identity and internal paths are strictly redacted. |

---

## 🚀 Quick Start

### 1. Installation

```bash
# Clone repository
git clone git@github.com:nexus8222/SecureDrop.git
cd SecureDrop

# Install dependencies
python3 -m pip install -r requirements.txt
```

### 2. Service Management with `start.sh`

SecureDrop includes an enterprise bash controller:

```bash
# Start server in background (daemon mode)
./start.sh

# Check real-time process status, CPU/RAM usage, and health
./start.sh status

# Follow live output logs
./start.sh logs

# Restart server with fresh code
./start.sh restart

# Gracefully stop server
./start.sh stop

# Start in foreground for debugging
./start.sh -f

# Run supervisor daemon with automatic crash recovery
./start.sh auto-restart

# Install and enable systemd user auto-start service on boot
./start.sh --install-service
```

### 3. Accessing the Web Interface

- **Host Machine:** [http://localhost:8000](http://localhost:8000)
- **Local Network Devices:** `http://<HOST-LAN-IP>:8000` (e.g. `http://10.205.12.54:8000`)

---

## ⚙️ Configuration (`.env`)

Configuration is managed via environment variables or a local `.env` file:

```bash
SECUREDROP_ADMIN_PASSWORD=change-this-password
SECUREDROP_DEVICE_NAME=SecureDrop-LAN
SECUREDROP_HOST=0.0.0.0
SECUREDROP_PORT=8000
SECUREDROP_TCP_PORT=9001
SECUREDROP_DISCOVERY_PORT=45678
```

---

## 🔌 API Reference

### Public & Transfer Routes
- `GET /api/info` — Retrieves node capabilities and sanitized session status.
- `GET /api/health` — Lightweight unauthenticated healthcheck returning HTTP 200 and uptime timestamp.
- `GET /api/shares/by-pin/{pin}` — Resolves an active share by its 4-digit numeric PIN.
- `GET /api/shares/{token}` — Returns share metadata, file manifest, and status.
- `GET /api/shares/mine` — Retrieves active shares hosted by the current user or guest creator tokens.
- `DELETE /api/shares/{token}` — Self-service share deletion and immediate physical chunk wipe.
- `DELETE /api/clipboard/{cid}` — Self-service clipboard snippet deletion and chunk wipe.
- `GET /api/shares/{token}/files/{file_id}/stream` — RFC 7233 range-compatible byte stream.
- `GET /api/shares/{token}/zip` — Dynamic streaming ZIP archive download.

### Paginated Admin Endpoints (`LIMIT :limit OFFSET :offset`)
- `GET /api/storage/shares?page=1&limit=25` — Paginated share storage list (options: 25, 100, 200).
- `GET /api/admin/users?page=1&limit=25` — Paginated user accounts list (options: 25, 100, 200).
- `GET /api/jobs?page=1&limit=25` — Paginated background node pull and transfer tasks.
- `GET /api/history?page=1&limit=25` — Paginated immutable transfer and security audit logs.
- `GET /api/storage/overview` — Summarized encrypted chunk storage volume and directory path.
- `DELETE /api/storage/all` — Purges all stored chunks and temporary files.

---

## 🛠️ Project Structure

```text
SecureDrop/
├── start.sh                            # Enterprise service controller & auto-start manager
├── bugs.txt                            # Comprehensive 19-section audit & hardening log
├── Dockerfile                          # Container specification
├── docker-compose.yml                  # Multi-container orchestration
├── requirements.txt                    # Production Python dependencies
├── requirements-termux-minimal.txt     # Termux lightweight dependencies
├── run.py                              # Server bootstrap entry point
├── docs/
│   └── termux.md                       # Android Termux deployment guide
└── securedrop/
    ├── __init__.py
    ├── main.py                         # FastAPI engine, layered crypto, pagination, reaper
    └── static/
        ├── common.js                   # Unified navigation, scoped StateManager, and theme
        ├── send.html & send.js         # Chunked upload terminal with state recovery
        ├── receive.html & receive.js   # 4-digit numeric PIN quick receiver
        ├── shares.html & shares.js     # Hosted shares dashboard & self-service revocation
        ├── share.html & share.js       # Manifest viewer, lightbox preview, and streaming
        ├── dashboard.html & dashboard.js # Admin cockpit with 4 paginated management modals
        ├── peers.html & peers.js       # UDP peer mesh radar & trust management
        ├── clipboard.html & clipboard.js # Zero-knowledge encrypted text notepad
        ├── styles.css                  # Multi-theme industrial styling & modal system
        ├── manifest.json               # Progressive Web App manifest
        └── sw.js                       # Auto-invalidating Network-First service worker
```

---

## 📄 License & Hardening Documentation

- This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
- Comprehensive vulnerability remediation, architectural specifications, and performance benchmarks are documented in [`bugs.txt`](bugs.txt).
