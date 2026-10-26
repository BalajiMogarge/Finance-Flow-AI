"""Pytest test session configuration.

Guarantees tests execute against local storage and isolated resources,
independent of any developer .env settings.
"""

from __future__ import annotations

import os

# Override storage and secrets for the test suite before any app modules load
os.environ["STORAGE_BACKEND"] = "local"
os.environ["ENVIRONMENT"] = "test"
