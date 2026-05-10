# SecureDrop LAN

SecureDrop LAN is a browser-first local network file sharing application. It lets devices on the same LAN create share links, upload large files in chunks, approve downloads, and manage stored data from an admin dashboard.

The project is designed for local use on trusted networks. It supports browser-only receive/download, admin and guest modes, share expiry, password-protected shares, queue tracking, LAN discovery, and server-side storage management.

## Features

- Browser-based send and receive flow
- Large-file chunk upload and download
- Share links and QR codes
- Browser-only receive mode for phones and tablets
- Admin and guest sandboxing
- Approval requests with request history
- Password-protected shares
- Expiring shares, max download limits, and delete-after-download
- Server storage dashboard with selective delete and delete all
- Browser queue and backend job tracking
- Transfer history
- LAN peer discovery with UDP probe support
- Trusted and blocked device records
- Clipboard/text sharing
- WebSocket updates for transfer and approval events
- Docker support
- Termux-friendly minimal dependency option

## Project structure

```text
securedrop-lan/
├── securedrop/
│   ├── main.py
│   └── static/
│       ├── app.js
│       ├── index.html
│       ├── manifest.json
│       ├── styles.css
│       └── sw.js
├── docs/
│   └── termux.md
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── requirements-termux-minimal.txt
└── run.py
```

## Requirements

- Python 3.10 or newer
- Devices connected to the same local network
- A modern browser for the web UI

## Quick start

```bash
python3 -m pip install -r requirements.txt
python3 run.py
```

Open the app on the host device:

```text
http://localhost:8000
```

Open it from another device on the same LAN:

```text
http://HOST-LAN-IP:8000
```

Example:

```text
http://192.168.1.10:8000
```

## Admin setup

On first run, open the web UI and create an admin password from the login prompt.

You can also set the admin password using an environment variable:

```bash
SECUREDROP_ADMIN_PASSWORD='change-this-password' python3 run.py
```

Guest users can use send and receive flows only. Admin users can access approvals, peers, queue, history, storage, and settings.

## Ports

| Service | Protocol | Port |
|---|---:|---:|
| Web UI and API | TCP | 8000 |
| TCP chunk service | TCP | 9001 |
| LAN discovery | UDP | 45678 |

If LAN discovery does not work, allow these ports in your firewall and use the manual IP flow as a fallback.

## Docker

```bash
docker compose up --build
```

The compose file uses host networking so LAN discovery and local IP sharing work correctly.

## Termux note

Phone browsers can receive/download shares without Termux. Termux is only needed if you want the phone itself to run a full SecureDrop node. See [`docs/termux.md`](docs/termux.md).

## Security notes

- Shares can require approval before download.
- Shares can be password protected.
- Stored chunks are encrypted by the node when browser Web Crypto is not available.
- Browser end-to-end mode depends on Web Crypto support. Some mobile browsers disable Web Crypto on plain `http://LAN-IP` origins.
- For stronger browser-side cryptography, use `localhost`, HTTPS, or a native mobile client.

## Storage

The application stores runtime data under:

```text
securedrop/storage/
```

This folder is ignored by Git and should not be committed.

Use the admin Storage page to view, delete selected shares, or delete all stored server data.

## Development

Run with reload:

```bash
uvicorn securedrop.main:app --host 0.0.0.0 --port 8000 --reload
```

Basic syntax check:

```bash
python3 -m compileall securedrop run.py
```

## Status

This is a LAN-first development build. It is suitable for local testing and controlled networks. It is not intended as an internet-exposed public file sharing service without additional hardening such as HTTPS, authentication review, rate limiting, audit logging, and relay isolation.
