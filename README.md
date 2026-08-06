# Room Security System

A Raspberry Pi-based motion-triggered security system for a room. The system uses an HC-SR501 PIR motion sensor to detect movement, records video and audio from a USB webcam only when armed, and provides a password-protected web dashboard for viewing and managing captured clips.

## Overview

This project was designed to reduce unnecessary webcam runtime while still capturing useful security footage. Instead of keeping the camera active continuously, the Raspberry Pi monitors a PIR motion sensor through GPIO. When motion is detected and the system is armed, the Pi records a short video/audio clip with `ffmpeg`, stores it locally, and makes it available through the dashboard.

## Features

- Arm and disarm the system from a browser dashboard.
- Detect motion with an HC-SR501 PIR sensor connected to Raspberry Pi GPIO.
- Record video from a USB webcam and audio from the webcam microphone.
- Save clips with timestamp-based filenames.
- View, download, favorite, and delete recordings from the dashboard.
- Protect recordings from cleanup by marking them as favorites.
- Automatically delete non-favorited clips after 15 days.
- Require dashboard username/password authentication.
- Refresh the dashboard automatically only when a new clip is saved.
- Provide a manual test recording button for hardware validation.
- Support remote access through Cloudflare Tunnel and Cloudflare Access.

## Hardware

- Raspberry Pi 3 Model B+
- HC-SR501 PIR motion sensor
- USB webcam with built-in microphone, tested with a Logitech C270
- Official Raspberry Pi power supply or another stable 5V supply rated for the Pi and webcam
- Female-to-female jumper wires

## Project Layout

```text
.
|-- public/        # Dashboard HTML, CSS, JavaScript, and favicon
|-- server.py      # Web server, API, GPIO listener, and recording logic
|-- .env.example   # Example Raspberry Pi configuration
|-- README.md
`-- .gitignore
```

## Wiring

Wire the HC-SR501 PIR sensor to the Raspberry Pi:

```text
HC-SR501 GND  -> Pi GND
HC-SR501 OUT  -> Pi physical pin 11 / BCM GPIO17
HC-SR501 VCC  -> Pi 5V
```

The project defaults to BCM GPIO17, which corresponds to physical pin 11 on the Raspberry Pi 3 Model B+.

## Raspberry Pi Setup

Install the required packages:

```bash
sudo apt update
sudo apt install -y ffmpeg python3-gpiozero v4l-utils alsa-utils
```

Confirm the webcam is detected:

```bash
v4l2-ctl --list-devices
```

Confirm the webcam microphone device:

```bash
arecord -l
```

## Configuration

Create a `.env` file on the Raspberry Pi. Use `.env.example` as a starting point:

```env
SECURITY_VIDEO_DEVICE=/dev/video0
SECURITY_AUDIO_DEVICE=plughw:2,0
SECURITY_PIR_GPIO=17
SECURITY_CAPTURE_SECONDS=15
SECURITY_VIDEO_SIZE=640x480
SECURITY_FRAMERATE=15
SECURITY_RECORD_COOLDOWN_SECONDS=10
SECURITY_INPUT_FORMAT=mjpeg
SECURITY_DASHBOARD_USERNAME=admin
SECURITY_DASHBOARD_PASSWORD=change-this-password
SECURITY_SESSION_MAX_AGE_SECONDS=86400
```

Before using the dashboard remotely, change:

```env
SECURITY_DASHBOARD_PASSWORD=change-this-password
```

to a strong private password.

If audio causes recording failures, temporarily disable audio:

```env
SECURITY_AUDIO_DEVICE=none
```

If video-only recording works, update `SECURITY_AUDIO_DEVICE` with the correct microphone device from `arecord -l`.

## Running The Server

Start the system from the project directory:

```bash
python3 server.py
```

Open the dashboard locally on the Pi:

```text
http://localhost:8000
```

From another device on the same network, use the Pi IP address:

```text
http://<pi-ip-address>:8000
```

To find the Pi IP address:

```bash
hostname -I
```

## Dashboard Behavior

The dashboard loads system state when opened and when the Refresh button is clicked. It does not continuously poll. Instead, the server sends an event when a new recording is saved, and the dashboard refreshes automatically at that point.

The dashboard includes:

- Armed/unarmed status
- Motion and recording status
- Manual test recording button
- Clip playback
- Clip download
- Favorite and delete controls
- Latest recording error display

## Storage

Recordings and metadata are stored in:

```text
data/
```

The `data/` directory is ignored by Git. Non-favorited clips older than 15 days are deleted when the server starts, when status is loaded, or after a new clip is saved. Favorited clips are excluded from automatic cleanup.

## Remote Access

For remote access, use Cloudflare Tunnel to expose the local dashboard through a domain, for example:

```text
https://security.example.com
```

Recommended remote access layers:

- Cloudflare Tunnel for public routing without opening router ports
- Cloudflare Access for identity-based access control
- Built-in dashboard username/password authentication

Do not expose the dashboard publicly without authentication. The dashboard controls the armed state and provides access to saved recordings.

## Running On Boot

For unattended operation, run the server as a `systemd` service on the Raspberry Pi. The service should point to the project directory and execute:

```bash
python3 server.py
```

Cloudflare Tunnel should also be enabled as a service so both the dashboard and tunnel restart automatically after the Pi boots.

## Troubleshooting

Check power health:

```bash
vcgencmd get_throttled
```

Expected result:

```text
throttled=0x0
```

Check available video devices:

```bash
ls /dev/video*
v4l2-ctl --list-devices
```

Check available audio devices:

```bash
arecord -l
```

View service logs if running under `systemd`:

```bash
sudo journalctl -u room-security -f
sudo journalctl -u cloudflared -f
```

## Resume Summary

This project demonstrates embedded hardware integration, GPIO event handling, Linux service deployment, video/audio capture, local web application development, authentication, storage management, and secure remote access.
