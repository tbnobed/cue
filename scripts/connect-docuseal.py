#!/usr/bin/env python3
"""Run on the Cue host. Prompt privately; never print or put the key in argv."""
import getpass
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

class SetupError(Exception):
    pass

CHECK = r"""
let key = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => key += chunk);
process.stdin.on('end', async () => {
  try {
    const response = await fetch('http://docuseal:3000/api/templates?limit=1', {
      headers: { 'X-Auth-Token': key },
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      console.log('DocuSeal rejected the check: HTTP ' + response.status);
      process.exitCode = 1; return;
    }
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error();
    console.log('DocuSeal API key verified.');
  } catch {
    console.log('Could not verify DocuSeal API access. Check the running DocuSeal service.');
    process.exitCode = 1;
  }
});
"""


def replace_key(content, key):
    # Single-quoted Compose dotenv values do not interpolate dollar signs.
    if not key or any(c.isspace() or ord(c) < 32 for c in key) or "'" in key:
        raise SetupError("Invalid key format. Copy the API key only, without quotes.")
    line = "DOCUSEAL_API_KEY='" + key + "'"
    pattern = r"^[ \t]*(?:export[ \t]+)?DOCUSEAL_API_KEY[ \t]*=.*$"
    content = re.sub(pattern, "", content, flags=re.MULTILINE)
    return content.rstrip() + "\n" + line + "\n"


def main():
    os.chdir(Path(__file__).resolve().parent.parent)
    target = Path(".env")
    if not target.is_file() or target.is_symlink():
        raise SetupError("Expected a regular .env file in the Cue directory.")
    if not sys.stdin.isatty():
        raise SetupError("Run this command directly in your SSH terminal for hidden key entry.")
    env = os.environ.copy()
    # A stale exported key must not override the newly saved dotenv value.
    env.pop("DOCUSEAL_API_KEY", None)
    key = getpass.getpass("Paste the self-hosted DocuSeal API key (hidden): ").strip()
    original = target.read_text()
    updated = replace_key(original, key)
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "app", "node", "-e", CHECK],
        input=key, text=True, capture_output=True, env=env,
    )
    if result.returncode:
        # Do not echo Docker/provider errors that could contain sensitive data.
        raise SetupError("API verification failed. Nothing was saved. Check the key and DocuSeal service.")
    print("DocuSeal API key verified.")
    backup_dir = Path.home() / "cue-config-backups"
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, backup = tempfile.mkstemp(prefix="before-docuseal-key-", suffix=".env", dir=backup_dir)
    with os.fdopen(fd, "w") as handle:
        handle.write(original)
        handle.flush()
        os.fsync(handle.fileno())
    fd, temp = tempfile.mkstemp(prefix=".env-docuseal-", dir=".")
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(updated)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print("Key saved privately. Configuration backup:", backup)
    result = subprocess.run(
        ["docker", "compose", "up", "-d", "--no-deps", "--force-recreate", "app"],
        capture_output=True, text=True, env=env,
    )
    if result.returncode:
        raise SetupError("Key saved, but Cue recreation failed. Inspect docker compose ps and app logs.")
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "app", "node", "-e",
         "process.exit(process.env.DOCUSEAL_API_KEY?.trim() ? 0 : 1)"],
        capture_output=True, text=True, env=env,
    )
    if result.returncode:
        raise SetupError("Cue has not loaded the key. Check Compose's DOCUSEAL_API_KEY environment entry.")
    print("Cue recreated with the API key. Refresh Admin → Integrations.")


if __name__ == "__main__":
    try:
        main()
    except SetupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError, KeyboardInterrupt):
        # Avoid unexpected exception details containing .env contents.
        print("Setup did not complete. No credentials were printed. Check the last completed step.", file=sys.stderr)
        sys.exit(1)
