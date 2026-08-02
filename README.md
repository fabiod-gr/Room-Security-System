# Fabio's Chopped Ass Room Security System

Y'know, it really pisses me off when people enter my room whenever I'm not home and move my shit around so I decided to vibecode this silly security system to help alleviate this problem

## Project Layout

```text
.
├── public/        # Browser dashboard files
├── server.py      # Local web/API server
├── README.md
└── .gitignore
```

## Features

- Arm and unarm the room monitor from the dashboard.
- Use an HC-SR501 PIR motion sensor on the Raspberry Pi as the recording trigger.
- Record from a USB webcam only when motion is detected while armed.
- Include audio from the webcam microphone in recorded clips.
- Upload captured clips to the server and list them on the dashboard.
- Favorite important clips so they are kept.
- Delete unwanted clips from the dashboard.
- Automatically delete non-favorited clips after 15 days.

## Raspberry Pi Setup

Wire the HC-SR501 to the Raspberry Pi 3 B+:

```text
HC-SR501 GND  -> Pi GND
HC-SR501 OUT  -> Pi physical pin 11 / BCM GPIO17
HC-SR501 VCC  -> Pi 5V
```

Install the Pi dependencies:

```bash
sudo apt update
sudo apt install -y ffmpeg python3-gpiozero
```

The server records from:

```text
Video: /dev/video0
Audio: default ALSA microphone
```

If your webcam or microphone uses a different device, set environment variables before starting the server:

```bash
export SECURITY_VIDEO_DEVICE=/dev/video0
export SECURITY_AUDIO_DEVICE=default
export SECURITY_PIR_GPIO=17
export SECURITY_CAPTURE_SECONDS=15
export SECURITY_VIDEO_SIZE=640x480
export SECURITY_FRAMERATE=15
python3 server.py
```

To find audio devices:

```bash
arecord -l
```

## Run

```powershell
python server.py
```

Open:

```text
http://localhost:8000
```

Run this on the Raspberry Pi that has the HC-SR501 and USB webcam connected. The dashboard can be opened from another device on your network, but recording is controlled by the Pi server, not by the browser.

## Stored Data

Uploaded clips and metadata are written under `data/`, which is ignored by Git.
Non-favorited clips older than 15 days are deleted when the server starts, when the dashboard loads status, or after a new clip uploads. Favorited clips are skipped by that cleanup.
