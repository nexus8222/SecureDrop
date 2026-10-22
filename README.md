# SecureDrop LAN Enterprise v2.5

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-brightgreen.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Framework-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![React 18](https://img.shields.io/badge/Frontend-React%2018%20%2B%20Vite%20%2B%20Tailwind-61dafb.svg)](https://react.dev/)
[![SQLite WAL](https://img.shields.io/badge/Database-SQLite%20WAL-003B57.svg)](https://www.sqlite.org/wal.html)
[![AES-GCM 256](https://img.shields.io/badge/Cryptography-AES--GCM%20256-success.svg)](https://en.wikipedia.org/wiki/Galois/Counter_Mode)

**SecureDrop LAN Enterprise** is a high-performance local network file exchange, live collaborative drop-box, and secure communication hub engineered for air-gapped intranet deployments. It enables nodes across the same Wi-Fi or wired network to transfer multi-gigabyte payloads at line speed (10Gbps+ capable) without third-party cloud infrastructure, external internet connectivity, or client installations.

---

## ⚡ Highlights & Key Features (v2.5 Enterprise)

1. **Modern React + Vite + Tailwind SPA Frontend:**
   - Single-page application featuring dark/light modes, collapsible navigation sidebar, zero emojis, and crisp SVG symbols (including door logout).
   - Instant client-side state preservation and transfer recovery.
2. **Multi-Peer Collaborative Live Rooms (Drop-Boxes):**
   - Live drop-box spaces (`/rooms`) where peers concurrently drop, view, and retrieve files with real-time WebSocket feeds.
3. **Direct & Group Sharing:**
   - Share directly with collaborative groups or search team members by username with multi-select distribution.
   - Incoming payloads delivered directly to dedicated **Direct Shares Inbox** (`/inbox`).
4. **Resumable Chunk Engine & Checkpoints:**
   - Multi-worker concurrent chunk uploader with exponential backoff retry.
   - Endpoint `/api/shares/{token}/chunks-status` queries received chunks; browser reloads resume transfers seamlessly without re-uploading completed chunks.
5. **Multicast UDP Discovery Upgrade (`239.255.45.67:45678`):**
   - Zero-config IGMP multicast with structured network-interface binding across all non-loopback interfaces and broadcast fallback.
   - Unrestricted LAN peer radar open to all users and guests.
6. **Goofy Persistent Guest Usernames & Encryption:**
   - Automatically provisions humorous, unique guest usernames (e.g. `VelvetOtter_314`, `NeonCapybara_775`) persisted in browser cookies.
   - Full WebCrypto AES-GCM 256 client encryption for guests.
7. **Directional Clipboard Push & Ephemeral LAN Chat:**
   - Push clipboard text directly into a target peer's clipboard history over the local mesh.
   - Ephemeral chat drawer for coordination and one-time credentials.
8. **Automated Linux Host Watch-Folder (`securedrop/watch/`):**
   - Background daemon monitoring `securedrop/watch/`, automatically chunking, encrypting, and converting dropped files into active shares with PINs and QR codes.
9. **Hard Storage Allocation Quotas (RBAC):**
   - Enforced storage ceilings: Members (50 GB), Guests (2 GB), Admins (Unlimited).
   - Displayed with live real-time storage gauges in the top navigation bar.
10. **Device Authentication Handshake (SAS PIN):**
    - Short Authentication String 4-digit PIN cryptographic pairing between network devices.
11. **Structured JSON Manifest Pre-Flight:**
    - Manifest payload exchanged before streaming, allowing receivers to inspect file names, directories, MIME types, and sizes.
12. **Media Slideshow & Audio Playlist Mode:**
    - Image lightbox with auto-advancing slideshow.
    - Continuous audio player and RFC 7233 byte-range video streaming.
13. **Enterprise Admin Cockpit with 4 Paginated Modals:**
    - Server Storage Audit, User RBAC Governance, Background Node Pulls, and Security Audit Logs with 25 / 100 / 200 row database pagination.

---

## 🏗️ Architecture

```text
                 +---------------------------------------------------+
                 |                 Local Network (LAN)               |
                 +---------------------------------------------------+
                                       |
                +----------------------+----------------------+
                |                                             |
       [Host SecureDrop Node]                          [Remote Device]
 +-------------------------------+              +----------------------------+
 | FastAPI Web Core (TCP :8000)  |<--- HTTP ----| React 18 + Vite SPA        |
 | - React SPA Dist Bundle       |<--- WSS -----| - Send, Receive, Inbox     |
 | - Resumable Chunk Controller  |              | - Live Rooms Drop-Boxes    |
 | - Layered BLAKE2b AES-GCM     |              | - LAN Radar & Chat Overlay |
 | - Groups & Direct Shares      |              | - State Checkpoint Engine  |
 | - Watch-Folder Daemon         |              | - WebCrypto E2EE 256-bit   |
 | - Proactive 15s Chunk Reaper  |              | - 4-Digit Quick PIN        |
 |                               |              | - Screen WakeLock API      |
 | TCP Chunk Server (TCP :9001)  |<--- TCP -----+----------------------------+
 | - Socket streaming & NODELAY  |
 |                               |              +----------------------------+
 | UDP Discovery (239.255.45.67) |<-- Multicast-+ [Peer SecureDrop Nodes]    |
 | - IGMP interface-bound radar  |              | - Ephemeral mesh discovery |
 |                               |              +----------------------------+
 | Storage Engine (SQLite WAL)   |
 | - Hard Quotas: 50GB / 2GB     |
 +-------------------------------+
```

---

## 🔐 Security & Access Control (RBAC)

| Role | Storage Ceiling | Capabilities & Privacy Boundaries |
|---|---|---|
| **Admin** | Unlimited | Hardware telemetry, user account provisioning, access approvals, storage purging, and audit logs. Admin views display `[Audit Only]` badges and cannot decrypt isolated zero-knowledge user payloads. |
| **Member** | 50 GB Active | Chunked file upload, direct group sharing, user search distribution, collaborative live rooms, and hosted shares revocation. |
| **Guest** | 2 GB Temporary | Goofy persistent username (`VelvetOtter_314`), quick PIN receiver (`/receive`), client E2EE encryption, live rooms drop-box participation, and direct shares inbox. |

---

## 🚀 Quick Start

### 1. Installation

```bash
# Clone repository
git clone git@github.com:nexus8222/SecureDrop.git
cd SecureDrop

# Install Python backend dependencies
python3 -m pip install -r requirements.txt

# (Optional) Build React frontend (pre-built bundle included in securedrop/static/dist)
cd frontend && npm install && npm run build && cd ..
```

### 2. Service Management with `start.sh`

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
```

### 3. Accessing the Web Interface

- **Host Machine:** [http://localhost:8000](http://localhost:8000)
- **Local Network Devices:** `http://<HOST-LAN-IP>:8000` (e.g. `http://10.205.12.54:8000`)

---

## 🔌 API Reference

### Collaboration & Direct Sharing
- `GET /api/groups` — List collaborative groups the user belongs to.
- `POST /api/groups` — Create a new collaborative group.
- `GET /api/groups/{id}/members` — List members in a group.
- `POST /api/groups/{id}/members` — Add member to group.
- `GET /api/users/search?q={query}` — Search active users by username or display name.
- `POST /api/shares/direct` — Distribute a share directly to groups and/or usernames.
- `GET /api/shares/direct/inbox` — Retrieve direct incoming payloads for current user or groups.

### Collaborative Live Rooms & Ephemeral Chat
- `GET /api/rooms` — List active collaborative drop-boxes.
- `POST /api/rooms` — Host a new live collaborative room.
- `GET /api/rooms/{id}` — View room items and files.
- `POST /api/rooms/{id}/items` — Drop a share into a room (triggers real-time WebSocket broadcast).
- `GET /api/chat/{channel}` — Get recent chat messages for a channel.
- `POST /api/chat/{channel}` — Post an ephemeral message to a chat channel.

### Transfer & Reliability Engine
- `GET /api/shares/{token}/chunks-status` — Query uploaded vs missing chunks for resumable streaming.
- `POST /api/shares/{token}/manifest` — Store pre-flight structured JSON manifest.
- `GET /api/shares/{token}/manifest` — Inspect manifest before downloading.
- `POST /api/clipboard/push` — Directionally push text to a target peer's clipboard.
- `POST /api/peers/pair/request` — Initiate SAS 4-digit PIN pairing request.
- `POST /api/peers/pair/verify` — Verify SAS 4-digit PIN code.

### Paginated Admin Endpoints (`LIMIT :limit OFFSET :offset`)
- `GET /api/storage/shares?page=1&limit=25` — Paginated share storage list (options: 25, 100, 200).
- `GET /api/admin/users?page=1&limit=25` — Paginated user accounts list (options: 25, 100, 200).
- `GET /api/jobs?page=1&limit=25` — Paginated background node pull and transfer tasks.
- `GET /api/history?page=1&limit=25` — Paginated immutable transfer and security audit logs.

---

## 📄 License & Hardening Documentation

- This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
- Comprehensive vulnerability remediation, architectural specifications, and performance benchmarks are documented in [`bugs.txt`](bugs.txt).
