# Motion Sensor Activated Room Security System

A self-hosted, motion-triggered room security system for Raspberry Pi. It watches an HC-SR501 PIR sensor, records short video and optional audio clips from a USB webcam, and provides a password-protected web dashboard for managing recordings.

The camera is opened only while a recording is being made. Recordings and configuration stay on the Raspberry Pi unless you choose to expose the dashboard through a separate remote-access service.

## Background

This project initially started as a joke. I had a bit of a silly problem being that for some reason my room at my parents' house has become a tourist attraction among people who come visit mainly because of all the wacky memorabilia I have collected. Since I'm a college student I'm not really in my room as much as I once was since most of my time is spent on campus and I wanted a way to keep my room safe while I'm gone. So I decided to create a security system using components readily available to me being a Raspberry Pi 3B+, a PIR motion sensor, and a crappy old webcam. The Pi was a leftover from my Programming for EE class's final project, the motion sensor came in an arduino kit that I had bought, and the webcam came from the dark depths of my closet.

## Features

- Arm and disarm motion detection from a browser.
- Record video and optional audio when motion is detected.
- Create manual test recordings from the dashboard.
- Browse recordings normally or group them into date-based dropdowns.
- Filter recordings by new, favorite, motion, or test status.
- Play, download, favorite, select, and delete recordings.
- Automatically delete non-favorite recordings after 15 days.
- Require a dashboard username and password.
- Notify an open dashboard when a new recording is saved.
- Show overall health, temperature, power, storage, and connected-device status.
- Run automatically at boot with `systemd`.

## Requirements

### Hardware

- A Raspberry Pi with a 40-pin GPIO header. The project was developed on a Raspberry Pi 3 Model B+, but similar models should also work.
- A Raspberry Pi-compatible power supply with enough capacity for the Pi and USB webcam.
- An HC-SR501 PIR motion sensor.
- A USB webcam supported by Video4Linux2. A built-in microphone is optional.
- Three female-to-female jumper wires.
- A heatsink or fan is recommended when recording at higher resolutions.

### Software

- Raspberry Pi OS or another Debian-based Raspberry Pi distribution.
- Python 3.9 or newer.
- `ffmpeg`, `gpiozero`, Video4Linux utilities, ALSA utilities, and Git.

No Python virtual environment or third-party `pip` packages are required on Raspberry Pi OS when `python3-gpiozero` is installed through `apt`.

## Wiring

Shut down and disconnect power from the Pi before changing GPIO wiring.

| HC-SR501 pin | Raspberry Pi connection |
| --- | --- |
| `VCC` | 5V, physical pin 2 or 4 |
| `OUT` | BCM GPIO17, physical pin 11 |
| `GND` | Ground, for example physical pin 6 |

The default configuration uses BCM numbering, so `SECURITY_PIR_GPIO=17` means BCM GPIO17—not physical pin 17. If you use another GPIO, move the `OUT` wire and update the configuration to match.

## Installation

Update the Pi and install the dependencies:

```bash
sudo apt update
sudo apt install -y git ffmpeg python3-gpiozero v4l-utils alsa-utils
```

Clone the repository:

```bash
git clone https://github.com/fabiod-gr/Room-Security-System.git
cd Room-Security-System
```

Give the current user access to the camera, microphone, and GPIO devices, then log out and back in so the group changes take effect:

```bash
sudo usermod -aG video,audio,gpio "$USER"
```

## Find the Camera and Microphone

List the available video devices:

```bash
v4l2-ctl --list-devices
```

After identifying the webcam device, list the resolutions, frame rates, and input formats it supports. Replace `/dev/video0` if necessary:

```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

List available audio capture devices:

```bash
arecord -l
```

Device numbers are machine-specific and can change when USB devices are moved. Do not assume the values from `.env.example` match a different Pi or webcam.

## Configuration

Create a local configuration file:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

At minimum, verify the video device, audio device, video mode, and dashboard password:

```env
SECURITY_VIDEO_DEVICE=/dev/video0
SECURITY_AUDIO_DEVICE=plughw:1,0
SECURITY_PIR_GPIO=17
SECURITY_CAPTURE_SECONDS=15
SECURITY_VIDEO_WARMUP_SECONDS=0.5
SECURITY_VIDEO_SIZE=640x480
SECURITY_FRAMERATE=15
SECURITY_RECORD_COOLDOWN_SECONDS=10
SECURITY_INPUT_FORMAT=mjpeg
SECURITY_DASHBOARD_USERNAME=admin
SECURITY_DASHBOARD_PASSWORD=replace-with-a-long-random-password
SECURITY_SESSION_MAX_AGE_SECONDS=86400
```

| Setting | Purpose |
| --- | --- |
| `SECURITY_VIDEO_DEVICE` | Video device reported by `v4l2-ctl`, commonly `/dev/video0`. |
| `SECURITY_AUDIO_DEVICE` | ALSA capture device reported by `arecord -l`. Set it to `none` to record without audio. |
| `SECURITY_PIR_GPIO` | BCM GPIO number connected to the PIR sensor's `OUT` pin. |
| `SECURITY_CAPTURE_SECONDS` | Length of each saved recording in seconds. |
| `SECURITY_VIDEO_WARMUP_SECONDS` | Initial webcam frames to discard while exposure settles. Set it to `0` to disable trimming. |
| `SECURITY_VIDEO_SIZE` | A resolution supported by the selected webcam mode, such as `640x480` or `1280x720`. |
| `SECURITY_FRAMERATE` | A frame rate supported at the selected resolution. Use a number such as `15`, without an extra `=`. |
| `SECURITY_RECORD_COOLDOWN_SECONDS` | Minimum delay before another recording can begin. |
| `SECURITY_INPUT_FORMAT` | Webcam input format, commonly `mjpeg`; it must appear in the `v4l2-ctl` output. |
| `SECURITY_DASHBOARD_USERNAME` | Username for the built-in dashboard login. |
| `SECURITY_DASHBOARD_PASSWORD` | Dashboard password. Never commit the `.env` file or reuse an important password. |
| `SECURITY_SESSION_MAX_AGE_SECONDS` | Maximum login-session lifetime in seconds. |

The warm-up interval is additional capture time: a 15-second recording with a 0.5-second warm-up runs the webcam for about 15.5 seconds but still saves a 15-second clip.

For initial setup, start with `640x480` at 15 FPS. Once that works, try a higher resolution listed by `v4l2-ctl`. Higher resolutions use more CPU, storage, and USB bandwidth.

## First Run

Start the application from the repository directory:

```bash
python3 server.py
```

The server listens on port 8000. Open one of these addresses:

```text
http://localhost:8000
http://PI_IP_ADDRESS:8000
```

Find the Pi's local IP address with:

```bash
hostname -I
```

Log in, click **Test Recording**, wait for it to finish, and refresh the dashboard. Confirm that video and audio work before enabling motion-triggered recording.

Stop a manually started server with `Ctrl+C`.

## Run Automatically at Boot

First record the values printed by these commands:

```bash
whoami
pwd
```

Create a service file:

```bash
sudo nano /etc/systemd/system/room-security.service
```

Paste the following configuration, replacing `YOUR_LINUX_USER` and `/absolute/path/to/Room-Security-System` with the values from `whoami` and `pwd`:

```ini
[Unit]
Description=Room Security System
After=network.target sound.target

[Service]
Type=simple
User=YOUR_LINUX_USER
WorkingDirectory=/absolute/path/to/Room-Security-System
ExecStart=/usr/bin/python3 /absolute/path/to/Room-Security-System/server.py
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now room-security
sudo systemctl status room-security
```

Follow its logs with:

```bash
sudo journalctl -u room-security -f
```

## Updating an Existing Installation

From the repository directory:

```bash
git pull --ff-only origin main
sudo systemctl restart room-security
sudo systemctl status room-security
```

Perform a hard refresh in the browser after an update so it loads the latest dashboard files. The ignored `.env` and `data/` paths are not replaced by `git pull`.

## Recordings and Cleanup

The application creates the `data/` directory automatically. It contains recording files, metadata, and the armed state, and is intentionally ignored by Git.

Non-favorite recordings older than 15 days are deleted when the server starts, when dashboard status is loaded, and after a new recording is saved. Favorite recordings are excluded from automatic cleanup. Back up important recordings somewhere else; this project is not a substitute for a redundant storage system.

## Remote Access

The built-in server uses plain HTTP and is intended for a trusted local network. Do not forward port 8000 directly to the public internet.

For remote access, place the application behind an authenticated HTTPS service such as Cloudflare Tunnel with Cloudflare Access. Keep the built-in dashboard password enabled as an additional layer. Remote-access software must be installed and maintained separately from this repository.

## Troubleshooting

### The service does not start

```bash
sudo systemctl status room-security
sudo journalctl -u room-security -n 100 --no-pager
```

Check that `User`, `WorkingDirectory`, and `ExecStart` in the service file contain real values rather than the example placeholders.

### The webcam does not turn on

```bash
ls -l /dev/video*
v4l2-ctl --list-devices
sudo fuser -v /dev/video0
```

Verify that `SECURITY_VIDEO_DEVICE` exists, the service user belongs to the `video` group, and another program is not using the device.

### FFmpeg rejects the video mode

```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext
```

Select a resolution, frame rate, and input-format combination shown together in that output. Check `.env` values for accidental extra characters—for example, use `SECURITY_FRAMERATE=15`, not `SECURITY_FRAMERATE=15=`.

### Video works but audio fails

Temporarily disable audio:

```env
SECURITY_AUDIO_DEVICE=none
```

If recording then succeeds, use `arecord -l` to find the correct microphone and update `SECURITY_AUDIO_DEVICE`.

### Recordings begin with black frames

Increase the warm-up trim slightly and restart the service:

```env
SECURITY_VIDEO_WARMUP_SECONDS=1.0
```

### Motion detection does not work

- Confirm that the dashboard is armed.
- Confirm the sensor wiring and BCM GPIO number.
- Allow roughly one minute for an HC-SR501 to stabilize after power-on.
- Adjust the sensor's physical sensitivity and delay controls if present.
- Check the service logs for a GPIO initialization error.

### The Pi is slow or unstable while recording

Start with `640x480` at 15 FPS, use a suitable power supply, and add cooling. Check temperature and power/throttling history:

```bash
vcgencmd measure_temp
vcgencmd get_throttled
```

`throttled=0x0` means no under-voltage or throttling condition is currently recorded.

## Project Layout

```text
.
|-- public/        # Dashboard HTML, CSS, JavaScript, and favicon
|-- server.py      # Web server, authentication, GPIO listener, and recording logic
|-- .env.example   # Configuration template
|-- README.md      # Installation and operating guide
`-- .gitignore
```

## Security Notes

- Replace the example dashboard password before use.
- Keep `.env` private and never commit it.
- Do not expose the built-in HTTP server directly to the internet.
- Install operating-system security updates regularly.
- Treat downloaded recordings as sensitive data.

## What's next for this Project?

I'm for sure going to redesign the enclosure. The one I've got at the moment is a literal box with some airflow but it could be a lot better. I also designed it in Tinkercad which was fine at first but since finishing the initial draft of this goofy project I've learned how to use REAL CAD softwares so I'm definitely going to go back and redesign it.

I also might go back and add some easter eggs or silly things in the dashboard itself.
