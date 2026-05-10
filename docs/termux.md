# Termux setup

Phone browsers can receive shares without Termux. Use Termux only when you want the Android phone to run a full SecureDrop node.

## Install packages

```bash
pkg update -y
pkg upgrade -y
pkg install -y python python-pip python-cryptography unzip openssl libffi
```

## Install lightweight dependencies

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-termux-minimal.txt
```

## Run

```bash
python run.py
```

Open on the phone:

```text
http://127.0.0.1:8000
```

Open from another LAN device:

```text
http://PHONE-LAN-IP:8000
```

## Keep the phone awake

```bash
termux-wake-lock
```

Release the wake lock:

```bash
termux-wake-unlock
```
