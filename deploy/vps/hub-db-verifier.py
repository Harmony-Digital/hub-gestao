#!/usr/bin/env python3
"""Verificador SCRAM-SHA-256 do Postgres para uma senha lida da entrada padrão.

Uso na VPS (a senha nunca aparece na tela nem em argumentos de processo):
    printf '%s\n' "$senha" | python3 hub-db-verifier.py

O Postgres guarda o verificador como veio; o texto da senha nunca chega ao banco.
Só biblioteca padrão. Formato: SCRAM-SHA-256$<iterações>:<sal>$<StoredKey>:<ServerKey>.
"""

import base64
import hashlib
import hmac
import os
import sys

ITERATIONS = 4096


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def main() -> int:
    password = sys.stdin.readline().rstrip("\n")
    if len(password) < 32 or not password.isascii():
        print("Senha ausente, curta demais ou fora de ASCII.", file=sys.stderr)
        return 1
    salt = os.urandom(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    client_key = hmac.new(salted, b"Client Key", "sha256").digest()
    server_key = hmac.new(salted, b"Server Key", "sha256").digest()
    stored_key = hashlib.sha256(client_key).digest()
    print(
        f"SCRAM-SHA-256${ITERATIONS}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
