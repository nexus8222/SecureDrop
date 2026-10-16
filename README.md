# SecureDrop LAN

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-brightgreen.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Framework-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![SQLite WAL](https://img.shields.io/badge/Database-SQLite%20WAL-003B57.svg)](https://www.sqlite.org/wal.html)

**SecureDrop LAN** is a high-performance, zero-cloud local network file exchange, media streaming, and clipboard synchronization platform. Built for security-conscious peer-to-peer and team environments, it enables devices across the same Wi-Fi or wired network to transfer multi-gigabyte payloads at line speed without third-party cloud dependencies, internet connectivity, or client installations.

---

## ⚡ Highlights

- **Multi-Paged Architecture:** Clean, dedicated operational pages (`/send`, `/receive`, `/share/{token}`, `/dashboard`, `/peers`, `/clipboard`) replacing legacy monolithic single-tab congestion.
- **RFC 7233 Range & Direct Streaming:** Native byte-range streaming (`206 Partial Content`) allowing immediate video/audio scrubbing and browser downloads without RAM buffering.
- **Dynamic On-the-Fly ZIP Streaming:** One-click directory/bundle downloads generated dynamically in-flight using ZIP data descriptors (`0x0008`) with near-zero memory footprint.
- **4-Digit Quick PIN Access:** Instant 4-digit numeric code resolution for receivers—eliminates manual typing of long cryptographic URLs on mobile devices.
- **Enterprise RBAC & Identity Isolation:** Full Role-Based Access Control (**Admin**, **Member**, **Guest**) with session isolation. Internal server hostnames (e.g. Linux OS identity) are completely concealed from guest nodes.
- **Industrial Anti-Slop UI:** Obsidian dark palette (`#07090d`, `#141b26`), monospace telemetry, live chunk allocation matrix, and tactile interactive controls. Zero generic AI pastel templates or blurry glowing orbs.
- **Responsive Mobile Engine:** Native off-canvas slide drawer, bottom thumb touch navigation bar, fluid card tables, and viewport stabilization (no iOS Safari auto-zoom).
- **Dual Cryptographic Protection:** Client-side AES-GCM (Zero-Knowledge) on secure browser contexts (`localhost` / HTTPS) with seamless server-side cryptographic fallback for plain HTTP mobile LAN access.

---

## 🏗️ Architecture

```
                 +---------------------------------------------------+
                 |                 Local Network (LAN)               |
                 +---------------------------------------------------+
                                      |
                +---------------------+---------------------+
                |                                           |
       [Host Python Node]                            [Remote Device]
 +-------------------------------+             +-------------------------+
 | FastAPI Web Core (TCP :8000)  |<--- HTTP ---| Web Browser / Mobile    |
 | - Multi-Page HTML/JS Engine   |<--- WSS ----| - Industrial UI Engine  |
 | - On-the-Fly ZIP Streaming    |             | - Web Crypto AES-GCM    |
 | - HTTP Range (206) Streaming  |             | - 4-Digit PIN Access    |
 | - RBAC & Session Auth         |             | - Media Lightbox Scrub  |
 | - Real-time WebSocket Bus     |             +-------------------------+
 |                               |
 | TCP Chunk Server (TCP :9001)  |<--- TCP ----+ [Peer SecureDrop Node]
 | - Raw socket chunk transfers  |
 |                               |
 | UDP Discovery (UDP :45678)    |<--- UDP ----+ [LAN Node Broadcast]
 | - Node beacons & heartbeat    |
 |                               |
 | Storage Engine (SQLite WAL)   |
 | - Chunks & Metadata Store     |
 +-------------------------------+
```

---

## 🔐 Security & Access Control (RBAC)

SecureDrop LAN implements production-grade Role-Based Access Control to enforce least-privilege principles and isolate sensitive network metadata:

| Role | Access Scope | Permissions & Capabilities |
|---|---|---|
| **Admin** | Full Node Authority | Hardware telemetry, user account provisioning, access approvals, storage purging, audit logs, and global share deletion. |
| **Member** | Authenticated User | Payload upload, 4-digit PIN generation, private clipboard, and user-isolated share lifecycle (can only view and delete owned shares). |
| **Guest** | Anonymous Visitor | Quick PIN connect (`/receive`), direct file downloads, media lightbox preview, and public file submission. Network topology and server OS hostname are concealed. |

### Identity Concealment
Previous sharing utilities leak host machine hostnames and internal path structures to arbitrary clients on the local network. SecureDrop LAN abstracts all node responses:
- Remote devices only receive generic identifiers (`device_name: "SecureDrop LAN"`, `device_id: "node"`).
- Storage directory paths, UDP broadcast endpoints, and TCP interfaces are strictly redacted from unauthenticated callers.

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10 or newer
- Devices connected to the same local network subnet

### Installation

```bash
# Clone the repository
git clone https://github.com/nexus8222/SecureDrop.git
cd SecureDrop

# Install dependencies
python3 -m pip install -r requirements.txt

# Run the node
python3 run.py
```

### Accessing the Web Interface
- **Host Machine:** [http://localhost:8000](http://localhost:8000)
- **Local Network Devices:** `http://<HOST-LAN-IP>:8000` (e.g., `http://192.168.1.50:8000`)

### Initial Administrator Setup
On initial startup, navigate to the web dashboard and set up an administrator account, or pre-configure via environment variable:

```bash
export SECUREDROP_ADMIN_PASSWORD='your-secure-admin-password'
python3 run.py
```

---

## 📦 Docker Deployment

Run with Docker Compose for instant containerized deployment:

```bash
docker-compose up -d
```

Or using Docker CLI directly:

```bash
docker run -d \
  -p 8000:8000 \
  -p 9001:9001 \
  -p 45678:45678/udp \
  -v $(pwd)/securedrop/storage:/app/securedrop/storage \
  -e SECUREDROP_ADMIN_PASSWORD="your-secure-admin-password" \
  --name securedrop \
  nexus8222/securedrop
```

---

## 📱 Mobile & Termux Support

SecureDrop LAN is engineered to run seamlessly on Android devices via Termux with minimal dependencies:

```bash
pkg update && pkg install python
pip install -r requirements-termux-minimal.txt
python run.py
```

See [docs/termux.md](docs/termux.md) for background daemon setup and wake-lock instructions.

---

## 🔌 API Reference

### Public Endpoints
- `GET /api/info` — Retrieves node capabilities and current user session info (sanitized for guests).
- `GET /api/shares/by-pin/{pin}` — Resolves an active share by its 4-digit PIN.
- `GET /api/shares/{token}` — Returns share metadata, file manifest, and status.
- `GET /api/shares/{token}/files/{file_id}/stream` — RFC 7233 range-compatible byte stream.
- `GET /api/shares/{token}/files/{file_id}/preview` — Media preview endpoint.
- `GET /api/shares/{token}/zip` — Dynamic streaming ZIP archive download.

### Authentication & RBAC
- `POST /api/auth/register` — Registers a new user account.
- `POST /api/auth/login` — Authenticates user credentials and establishes HTTP session.
- `POST /api/auth/logout` — Terminates user and admin sessions.
- `GET /api/auth/me` — Inspects the authenticated user profile and active permissions.

### Admin Cockpit (Requires Admin Privileges)
- `GET /api/admin/users` — Lists all registered accounts and share counts.
- `POST /api/admin/users` — Provisions new member or administrator accounts.
- `PUT /api/admin/users/{user_id}/role` — Updates role (`admin`, `member`, `guest`) or status.
- `DELETE /api/admin/users/{user_id}` — Deletes a user account.
- `GET /api/storage/overview` — Reports chunk distribution, disk usage, and storage health.
- `DELETE /api/storage/all` — Purges all stored chunks and temporary files.

---

## 🛠️ Project Structure

```text
SecureDrop/
├── Dockerfile                          # Container specification
├── docker-compose.yml                  # Multi-container orchestration
├── requirements.txt                    # Production Python dependencies
├── requirements-termux-minimal.txt     # Termux lightweight dependencies
├── run.py                              # Server bootstrap entry point
├── docs/
│   └── termux.md                       # Android Termux deployment guide
└── securedrop/
    ├── __init__.py
    ├── main.py                         # FastAPI engine, RBAC, streaming, discovery
    └── static/
        ├── common.js                   # Unified navigation, crypto, and auth engine
        ├── send.html & send.js         # Transmission engine & chunk allocation visualizer
        ├── receive.html & receive.js   # 4-digit tactile PIN quick receiver
        ├── share.html & share.js       # Manifest viewer, lightbox preview, and streaming
        ├── dashboard.html & dashboard.js # Admin cockpit, telemetry, and RBAC console
        ├── peers.html & peers.js       # UDP peer mesh discovery & trust management
        ├── clipboard.html & clipboard.js # Encrypted peer-to-peer clipboard sync
        ├── styles.css                  # Industrial engineering design system
        ├── manifest.json               # Progressive Web App manifest
        └── sw.js                       # Offline capability & service worker cache
```

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
