"""Authentication module with user management and session handling."""
import hashlib
import secrets
import time
from typing import Optional, Dict
from config import config

# In-memory user storage (use a database in production)
# Format: {username: {"password_hash": str, "created_at": float}}
_users: Dict[str, Dict] = {}

# Session storage
# Format: {session_token: {"username": str, "created_at": float, "expires_at": float}}
_sessions: Dict[str, Dict] = {}

def _hash_password(password: str) -> str:
    """Hash password using SHA256 with salt."""
    salt = config.SECRET_KEY.encode()
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000).hex()

def _verify_password(password: str, password_hash: str) -> bool:
    """Verify password against hash."""
    return _hash_password(password) == password_hash

def init_default_user():
    """Initialize default admin user if not exists."""
    if config.DEFAULT_ADMIN_USERNAME not in _users:
        _users[config.DEFAULT_ADMIN_USERNAME] = {
            "password_hash": _hash_password(config.DEFAULT_ADMIN_PASSWORD),
            "created_at": time.time()
        }

def login(username: str, password: str) -> Optional[str]:
    """Authenticate user and return session token."""
    init_default_user()

    user = _users.get(username)
    if not user:
        return None

    if not _verify_password(password, user["password_hash"]):
        return None

    # Create session
    session_token = secrets.token_urlsafe(32)
    now = time.time()
    _sessions[session_token] = {
        "username": username,
        "created_at": now,
        "expires_at": now + config.SESSION_EXPIRE_SECONDS
    }

    return session_token

def verify_session(session_token: str) -> Optional[str]:
    """Verify session and return username if valid."""
    session = _sessions.get(session_token)
    if not session:
        return None

    # Check expiration
    if time.time() > session["expires_at"]:
        del _sessions[session_token]
        return None

    return session["username"]

def logout(session_token: str):
    """Remove session."""
    if session_token in _sessions:
        del _sessions[session_token]

def change_password(username: str, old_password: str, new_password: str) -> bool:
    """Change user password."""
    user = _users.get(username)
    if not user:
        return False

    if not _verify_password(old_password, user["password_hash"]):
        return False

    user["password_hash"] = _hash_password(new_password)
    return True

def get_username(session_token: str) -> Optional[str]:
    """Get username from session token."""
    return verify_session(session_token)
