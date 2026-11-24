"""Wachtwoord-hashing.

Werkzeug kiest standaard scrypt, maar de Python van macOS (LibreSSL) heeft
geen hashlib.scrypt. PBKDF2-SHA256 met 600.000 rondes (OWASP 2023) werkt
overal. check_password_hash herkent de methode uit de hash zelf.
"""

from werkzeug.security import check_password_hash, generate_password_hash

METHOD = "pbkdf2:sha256:600000"


def hash_password(password):
    return generate_password_hash(password, method=METHOD)


def verify_password(password_hash, password):
    return check_password_hash(password_hash, password)
