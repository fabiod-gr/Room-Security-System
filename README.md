# Room Security System

A Raspberry Pi-based room security system that records video and audio only when motion is detected while the system is armed. The project uses an HC-SR501 PIR motion sensor as the trigger, a USB webcam for capture, and a browser dashboard for control and clip management.

## Features

- Arm and disarm the security system from a web dashboard.
- Trigger recordings from an HC-SR501 PIR motion sensor connected to Raspberry Pi GPIO.
- Record video from a USB webcam and audio from the webcam microphone with `ffmpeg`.
- Save timestamped clips locally and display them in the dashboard.
- Favorite important clips so they are excluded from automatic cleanup.
- Delete unwanted clips from the dashboard.
- Automatically delete non-favorited clips after 15 days.
- Update the dashboard automatically only when a new recording is saved.
- Provide a manual test recording button for validating webcam and microphone setup.

## Project Layout

```text
.
├── public/        # Dashboard HTML, CSS, JavaScript, and favicon
├── server.py      # Web server, API, GPIO listener, and recording logic
├── .env.example   # Example Raspberry Pi configuration
├── README.md
└── .gitignore
```

## Hardware

- Raspberry Pi 3 Model B+
- HC-SR501 PIR motion sensor
- USB webcam with built-in microphone
- Official Raspberry Pi power supply or another stable 5V supply rated for the Pi and webcam

## Wiring

Wire the HC-SR501 to the Raspberry Pi:

```text
HC-SR501 GND  -> Pi GND
HC-SR501 OUT  -> Pi physical pin 11 / BCM GPIO17
HC-SR501 VCC  -> Pi 5V
```

## Raspberry Pi Dependencies

Install the required packages on the Pi:

```bash
sudo apt update
sudo apt install -y ffmpeg python3-gpiozero v4l-utils alsa-utils
```

## Configuration

Create a `.env` file on the Raspberry Pi. Use `.env.example` as a starting point:

```env
SECURITY_VIDEO_DEVICE=/dev/video0
SECURITY_AUDIO_DEVICE=plughw:1,0
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

Change `SECURITY_DASHBOARD_PASSWORD` before exposing the dashboard outside your local network.

To find the correct webcam video device:

```bash
v4l2-ctl --list-devices
```

To find the correct webcam microphone device:

```bash
arecord -l
```

If audio causes recording failures, temporarily disable audio to isolate the issue:

```env
SECURITY_AUDIO_DEVICE=none
```

Set it back to the webcam microphone device after audio is working.

## Run

Start the server from the project directory:

```bash
python3 server.py
```

Open the dashboard:

```text
http://localhost:8000
```

From another device on the same network, use the Raspberry Pi IP address:

```text
http://<pi-ip-address>:8000
```

## Dashboard Updates

The dashboard loads the current system state when opened and when the Refresh button is clicked. It does not poll continuously. Instead, it uses a server-sent event connection and refreshes automatically only when a new recording is saved.

If a recording fails, the latest `ffmpeg` error is shown in the dashboard status panel after a manual refresh.

## Stored Data

Recordings and metadata are stored under `data/`, which is ignored by Git. Non-favorited clips older than 15 days are deleted when the server starts, when status is loaded, or after a new clip is saved. Favorited clips are skipped by cleanup.

## Remote Access

For access outside the local network, use Cloudflare Tunnel with Cloudflare Access or another authentication layer. Do not expose the dashboard publicly without authentication because it controls recording state and provides access to saved clips.

This project also includes dashboard username/password protection. Use it together with Cloudflare Access for defense in depth.
