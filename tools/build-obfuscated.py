#!/usr/bin/env python3
"""Build script: obfuscate Python sources → build Docker image with encrypted code.

Usage:
  python3 tools/build-obfuscated.py          # obfuscate + build Docker image
  python3 tools/build-obfuscated.py --no-docker  # only obfuscate, no build
  python3 tools/build-obfuscated.py --clean      # remove obfuscated output

Output: dist/obfuscated/ contains the encrypted deployable code.
"""
import argparse
import base64
import os
import secrets
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "obfuscated"
ENTRY_SOURCE = ROOT / "app.py"
ENTRY_TARGET = DIST / "app.py"
FRONTEND_SRC = ROOT / "frontend"
FRONTEND_DST = DIST / "frontend"


def xor_mask(data: bytes, key: bytes) -> bytes:
    """Simple XOR with expanded key."""
    key_len = len(key)
    return bytes(data[i] ^ key[i % key_len] for i in range(len(data)))


def obfuscate_file(src: Path, dst: Path, seed: bytes):
    """Read source Python file, produce an obfuscated loader that
    decrypts and executes the original source at runtime."""
    original = src.read_bytes()

    # Layer 1: compress
    compressed = zlib.compress(original, level=9)

    # Layer 2: XOR mask with seed
    masked = xor_mask(compressed, seed)

    # Layer 3: base85 encode
    encoded = base64.b85encode(masked).decode("ascii")

    # Generate a unique variable name for the embedded payload
    var = "x" + secrets.token_hex(4)

    # Build the loader script. It's intentionally obfuscated to deter casual reading.
    loader = f'''#!/usr/bin/env python3
import base64,zlib,sys,os
S=bytes.fromhex("{"".join(f"{b:02x}" for b in seed)}")
d=base64.b85decode({repr(encoded)}.encode())
c=zlib.decompress(bytes(d[i]^S[i%len(S)] for i in range(len(d))))
g={{"__file__":os.path.abspath(__file__),"__name__":"__main__"}}
exec(compile(c,os.path.abspath(__file__),"exec"),g,g)
'''

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(loader)
    print(f"  obfuscated: {src.name} → {dst.name} ({len(original)} → {dst.stat().st_size} bytes)")


def write_dockerfile():
    """Generate Dockerfile for obfuscated build."""
    dockerfile = DIST / "Dockerfile"
    dockerfile.write_text(f'''# Production Dockerfile — obfuscated build
FROM python:3.11-slim

RUN pip install --no-cache-dir flask 2>/dev/null || true
RUN mkdir -p /data /host
WORKDIR /app

COPY app.py /app/app.py
COPY frontend/ /app/frontend/

ENV FML_HOST=0.0.0.0
ENV FML_PORT=8080
ENV FML_DB=/data/data.sqlite3

VOLUME ["/data"]
EXPOSE 8080

CMD ["python3", "app.py"]
''')
    print(f"  generated: {dockerfile}")


def write_docker_compose():
    """Generate docker-compose.obfuscated.yml."""
    compose = DIST / "docker-compose.yml"
    compose.write_text('''# Obfuscated production docker-compose
version: "3.9"
services:
  frp-manager-lite:
    build: .
    container_name: frp-manager-lite
    restart: unless-stopped
    ports:
      - "${FML_PUBLISH_BIND:-127.0.0.1}:${FML_PUBLISH_PORT:-18081}:8080"
    env_file:
      - .env
    volumes:
      - frp-manager-lite-data:/data
      - /etc/machine-id:/host/machine-id:ro

volumes:
  frp-manager-lite-data:
''')
    print(f"  generated: {compose}")


def build_docker():
    """Build Docker image from obfuscated code."""
    import subprocess
    os.chdir(DIST)
    subprocess.run(["docker", "build", "-t", "frp-manager-lite:latest", "."], check=True)


def clean():
    """Remove obfuscated output."""
    import shutil
    if DIST.exists():
        shutil.rmtree(DIST)
        print(f"Removed {DIST}")
    else:
        print("Nothing to clean")


def main():
    parser = argparse.ArgumentParser(description="Obfuscate and build frp-manager-lite")
    parser.add_argument("--no-docker", action="store_true", help="Skip Docker build")
    parser.add_argument("--clean", action="store_true", help="Remove obfuscated output")
    parser.add_argument("--seed", type=str, default="", help="Obfuscation seed hex (64 chars)")
    args = parser.parse_args()

    if args.clean:
        clean()
        return

    # Clean previous
    if DIST.exists():
        clean()

    # Derive seed from env or generate random one
    seed_hex = args.seed or os.environ.get("OBFUSCATION_SEED", "")
    if len(seed_hex) < 64:
        seed_hex = secrets.token_hex(32)
    if len(seed_hex) % 2 != 0:
        seed_hex = seed_hex[:-1]
    seed = bytes.fromhex(seed_hex)

    print(f"Seed: {seed_hex[:16]}…")
    print("Obfuscating…")

    # Obfuscate Python source
    obfuscate_file(ENTRY_SOURCE, ENTRY_TARGET, seed)

    # Frontend: copy JS/CSS/HTML as-is — browser code can't be hidden anyway
    for f in FRONTEND_SRC.iterdir():
        if not f.is_file():
            continue
        if f.name == "app.js" or f.suffix in {".html", ".css"}:
            if f.name == "app.js":
                # Light minification: strip comments and blank lines only
                js_content = f.read_text()
                # Remove // comments (but not URLs with //)
                lines = []
                for line in js_content.split('\n'):
                    stripped = line.strip()
                    if stripped.startswith('//'):
                        continue
                    if not stripped and not line.endswith('\n'):
                        continue
                    lines.append(line.strip('\t'))
                minified = '\n'.join(lines)
                target = FRONTEND_DST / f.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(minified)
                print(f"  minified: {f.name} ({len(js_content)} → {len(minified)} chars)")
            else:
                target = FRONTEND_DST / f.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(f.read_bytes())
                print(f"  copied: {f.name}")

    # Copy .env.example, README, deploy/
    for f in [".env.example", "README.md", "DEPLOY.md", "deploy"]:
        src = ROOT / f
        if src.is_file():
            target = DIST / f
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(src.read_bytes())
            print(f"  copied: {f}")
        elif src.is_dir():
            import shutil
            target = DIST / f
            shutil.copytree(src, target, dirs_exist_ok=True)
            print(f"  copied dir: {f}")

    # Generate Docker artifacts
    write_dockerfile()
    write_docker_compose()

    if not args.no_docker:
        print("\nBuilding Docker image…")
        build_docker()

    print(f"\nDone. Obfuscated build in {DIST}")
    print(f"To deploy: cd {DIST} && docker compose up -d")


if __name__ == "__main__":
    main()
