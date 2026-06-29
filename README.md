# Room Security System

A small webcam security dashboard that runs locally in your browser and stores captured video clips on the Python server.

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
- Start a webcam feed directly in the browser.
- Detect motion while armed and record short WebM video clips.
- Manually record a clip at any time after the camera starts.
- Upload captured clips to the server and list them on the dashboard.
- Favorite important clips so they are kept.
- Automatically delete non-favorited clips after 30 days.

## Run

```powershell
python server.py
```

Open:

```text
http://localhost:8000
```

Browser webcam access works on `localhost`. If you want to open the dashboard from another device, use HTTPS or a trusted tunnel because most browsers block camera access on plain HTTP remote addresses.

## Stored Data

Uploaded clips and metadata are written under `data/`, which is ignored by Git.
Non-favorited clips older than 30 days are deleted when the server starts, when the dashboard loads status, or after a new clip uploads. Favorited clips are skipped by that cleanup.

## Notes

This is a practical starter system, not a hardened security product. For real unattended use, add authentication, HTTPS, storage limits, and a way to run the server as a background service.
