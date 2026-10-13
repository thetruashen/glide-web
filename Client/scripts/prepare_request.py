"""Validate dispatch input as data, never interpolate it into shell code."""
import base64
import json
import os
import re
from urllib.parse import urlsplit
import requests

config = json.loads(os.environ["GLIDE_REQUEST"])
response = requests.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", timeout=60)
response.raise_for_status()
version = next((v for v in response.json()["versions"] if v["id"] == config.get("version")), None)
if version is None:
    raise ValueError("Unknown official Minecraft version")
metadata = requests.get(version["url"], timeout=60)
metadata.raise_for_status()
major = metadata.json().get("javaVersion", {}).get("majorVersion", 8)
loader = config.get("loader", "vanilla")
if loader not in {"vanilla", "fabric", "quilt", "forge", "neoforge"}:
    raise ValueError("Invalid loader")
loader_version = config.get('loaderVersion') or ''
if loader_version and (loader == 'vanilla' or not re.fullmatch(r'[A-Za-z0-9_.+-]{1,80}', loader_version)):
    raise ValueError('Invalid pinned loader version')
if not re.fullmatch(r"[A-Za-z0-9_]{3,16}", config.get("username", "GlidePlayer")):
    raise ValueError("Username must be 3–16 letters, numbers or underscores")
origin = urlsplit(config.get("origin", ""))
if origin.scheme not in {"https", "http"} or not origin.netloc or origin.path not in {"", "/"}:
    raise ValueError("Invalid website origin")
if not 256 <= len(base64.b64decode(config["publicKey"], validate=True)) <= 1024:
    raise ValueError("Invalid public key")
auth = config.get("auth", "offline")
if auth not in {"offline", "microsoft", "prompt"}:
    raise ValueError("Invalid account mode")
client_id = config.get("clientId", "")
if auth == "microsoft" and client_id and not re.fullmatch(r"[0-9a-fA-F-]{36}", client_id):
    raise ValueError("Microsoft login needs a registered public-client application ID")
settings = {
    "GLIDE_MINECRAFT_VERSION": version["id"], "GLIDE_MINECRAFT_LOADER": loader,
    "GLIDE_MINECRAFT_XMX": str(max(1, min(int(config.get("memory", 4)), 8))) + "G",
    "GLIDE_OFFLINE_USERNAME": config.get("username", "GlidePlayer"), "GLIDE_AUTH_MODE": auth,
    "GLIDE_INSTANCE_NAME":str(config.get("name","Glide instance"))[:80], "GLIDE_MICROSOFT_CLIENT_ID": client_id, "GLIDE_JAVA_MAJOR": str(major),
    "GLIDE_WEB_ORIGIN": f"{origin.scheme}://{origin.netloc}", "GLIDE_RESOLUTION_PRESET": "custom",
    "GLIDE_RENDER_WIDTH": str(max(640, min(int(config.get("width", 1280)), 1920))),
    "GLIDE_RENDER_HEIGHT": str(max(360, min(int(config.get("height", 720)), 1080))),
    "GLIDE_MAX_RESTARTS": "0",
    "GLIDE_LOADER_VERSION": loader_version,
}
with open(os.environ["GITHUB_ENV"], "a") as env:
    for key, value in settings.items():
        if "\n" in value or "\r" in value:
            raise ValueError("Invalid input")
        env.write(f"{key}={value}\n")
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"java={major}\nversion={version['id']}\nloader={loader}\n")
    output.write(f"loader-cache={loader + '-' + loader_version if loader_version else loader}\n")
