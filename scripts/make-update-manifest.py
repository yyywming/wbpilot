#!/usr/bin/env python3
"""Generate the WB Pilot update manifest (latest.json).

Usage:
  python scripts/make-update-manifest.py \
    --version 1.0.1 \
    --file release/WBPilot-Setup-1.0.1.exe \
    --base-url https://your-host.example/wbpilot \
    [--notes "更新说明"] [--out release/latest.json]

The manifest format consumed by the app:
  {"version": "1.0.1", "url": "https://…/WBPilot-Setup-1.0.1.exe", "sha256": "…", "notes": "…"}
"""
import argparse
import hashlib
import json
import os


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True, help='x.y.z')
    parser.add_argument('--file', required=True, help='installer path')
    parser.add_argument('--base-url', required=True, help='directory URL that hosts the installer (https)')
    parser.add_argument('--url', default='', help='explicit installer URL (overrides --base-url)')
    parser.add_argument('--notes', default='', help='release notes shown in the app')
    parser.add_argument('--out', default='release/latest.json')
    args = parser.parse_args()

    if not os.path.isfile(args.file):
        raise SystemExit(f'installer not found: {args.file}')
    url = args.url or (args.base_url.rstrip('/') + '/' + os.path.basename(args.file))
    if not (url.startswith('https://') or url.startswith('http://127.0.0.1') or url.startswith('http://localhost')):
        raise SystemExit('installer URL must be https (localhost http allowed for testing)')

    manifest = {
        'version': args.version,
        'url': url,
        'sha256': sha256_of(args.file),
        'notes': args.notes,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
