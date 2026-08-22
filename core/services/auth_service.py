"""
Authentication service.

Phase D — auth is gone.

``get_current_user`` returns a synthetic in-memory ``User`` (a tiny
dataclass that mirrors the old ORM shape so existing route signatures
keep type-checking). No database hit, no token validation, no password
hashing — those concepts no longer exist in the codebase.

The module is kept around so routes that do
``current_user: User = Depends(get_current_user)`` continue to work without
each one being rewritten.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional


# Stable identity used everywhere a created_by/user_id was previously stored.
# Routes no longer write FKs to a users table (the table is gone), but the
# value remains exposed so audit-style "who did it" logging can still be
# done locally if a route wants to.
LOCAL_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
LOCAL_USER_EMAIL = "local@datahandler.local"


@dataclass(frozen=True)
class User:
    """The shape that routes still type their ``current_user`` parameter as.

    Intentionally a plain dataclass — there is no users table behind it.
    """
    id: uuid.UUID
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool


_LOCAL_USER = User(
    id=LOCAL_USER_ID,
    email=LOCAL_USER_EMAIL,
    full_name="Local User",
    role="superadmin",   # Vestigial — no checks read it. Kept until callers stop expecting a string.
    is_active=True,
)


async def get_current_user() -> User:
    """Return the synthetic local user.

    Async because every FastAPI dependency in the codebase awaits it; the
    body itself does no I/O.
    """
    return _LOCAL_USER
