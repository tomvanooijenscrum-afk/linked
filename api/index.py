"""Ingang voor Vercel: alle /api/*-verzoeken gaan naar de Flask-app.

De webpagina's zelf serveert Vercel als statische bestanden (zie vercel.json).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.app import create_app  # noqa: E402

app = create_app()
