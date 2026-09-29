#!/usr/bin/env python3
"""Steak by Dabbah — menu admin server.

Pure Python standard library (3.8+), no installs required.

    python3 server.py                      # http://127.0.0.1:8080/admin/
    python3 server.py --host 0.0.0.0 --port 8080

Public, read-only API for the menu website:
    GET /api/menu            -> visible categories/items + restaurant info + texts

Admin API (cookie session, see /admin/):
    GET  /api/admin/status
    POST /api/admin/setup    {password}                (only when no password exists yet)
    POST /api/admin/login    {password}
    POST /api/admin/logout
    GET  /api/admin/menu
    PUT  /api/admin/menu     {data, revision}
    GET  /api/admin/backups
    POST /api/admin/backups/restore {name}
    POST /api/admin/password {current, new}
"""

import argparse
import copy
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

# realpath so the static-file containment check (also realpath-based) works from symlinked dirs
ROOT = os.path.dirname(os.path.realpath(__file__))
PUBLIC_DIR = os.path.join(ROOT, "public")
# Live data (menu edits, password, backups) lives outside Git. On a host with a mounted disk,
# point SBD_DATA_DIR at that disk so it survives redeploys.
DATA_DIR = os.path.realpath(os.environ.get("SBD_DATA_DIR") or os.path.join(ROOT, "data"))
SEED_FILE = os.path.join(ROOT, "data", "original-menu.json")  # tracked in Git: the starting menu
MENU_FILE = os.path.join(DATA_DIR, "menu.json")
AUTH_FILE = os.path.join(DATA_DIR, "auth.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

MAX_BACKUPS = 60
MAX_BODY = 2 * 1024 * 1024
SESSION_TTL = 12 * 3600
COOKIE_NAME = "sbd_admin"
PBKDF2_ITERATIONS = 240_000
MIN_PASSWORD = 8

LANGS = ("ar", "he", "en")
ICONS = ("appetizer", "flame", "pasta", "burger", "fish", "kids", "addons", "drink", "default")
TAGS = ("signature", "popular", "sharing")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PHONE_RE = re.compile(r"^\+?[0-9]{6,15}$")
BACKUP_RE = re.compile(r"^menu-\d{8}-\d{6}-\d{2}\.json$")

TEXT_KEYS = (
    "menu", "tagline", "taglineSub", "search", "searchOpen", "searchClose", "clear", "all",
    "filters", "resultsOne", "resultsTwo", "resultsFew", "resultsMany", "noResultsTitle",
    "noResultsBody", "showAll", "signature", "popular", "sharing", "reviewsTitle",
    "reviewsCount", "rate", "call", "whatsapp", "directions", "top", "language", "instagram",
    "facebook", "maps", "skipIntro", "hours", "hoursDays", "hoursTime", "rights",
)
PLACEHOLDER_KEYS = ("resultsFew", "resultsMany", "reviewsCount")

lock = threading.Lock()
sessions = {}  # token -> expiry timestamp
login_failures = {}  # ip -> (count, locked_until)
TRUST_PROXY = False  # set by --trust-proxy: take the client IP from X-Forwarded-For


# --------------------------------------------------------------------------- storage

def _reject_constant(name):
    raise ValueError("%s is not allowed" % name)


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def revision_of(data):
    raw = json.dumps(data, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def make_backup():
    if not os.path.exists(MENU_FILE):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    # menu-YYYYmmdd-HHMMSS-NN.json in UTC: always sorts oldest → newest (no DST jumps), even within one second.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    n = 1
    name = "menu-%s-%02d.json" % (stamp, n)
    while os.path.exists(os.path.join(BACKUP_DIR, name)) and n < 99:
        n += 1
        name = "menu-%s-%02d.json" % (stamp, n)
    with open(MENU_FILE, "rb") as src, open(os.path.join(BACKUP_DIR, name), "wb") as dst:
        dst.write(src.read())
    backups = sorted(f for f in os.listdir(BACKUP_DIR) if BACKUP_RE.match(f))
    for old in backups[:-MAX_BACKUPS]:
        os.remove(os.path.join(BACKUP_DIR, old))
    return name


def list_backups():
    if not os.path.isdir(BACKUP_DIR):
        return []
    out = []
    for f in sorted((f for f in os.listdir(BACKUP_DIR) if BACKUP_RE.match(f)), reverse=True):
        p = os.path.join(BACKUP_DIR, f)
        info = {"name": f, "size": os.path.getsize(p), "modified": int(os.path.getmtime(p))}
        try:
            d = read_json(p)
            info["categories"] = len(d.get("categories", []))
            info["items"] = sum(len(c.get("items", [])) for c in d.get("categories", []))
        except (ValueError, OSError, AttributeError, TypeError):
            info["corrupt"] = True
        out.append(info)
    return out


# --------------------------------------------------------------------------- validation

def _is_str(v, max_len, required=True):
    if not isinstance(v, str):
        return False
    if required and not v.strip():
        return False
    return len(v) <= max_len


def _is_https(v):
    return isinstance(v, str) and len(v) <= 500 and re.match(r"^https://[^\s]+$", v) is not None


def normalize(data):
    """Trim strings and drop empty optional fields so saved JSON stays clean."""
    d = copy.deepcopy(data)
    for c in d.get("categories") if isinstance(d.get("categories"), list) else []:
        if not isinstance(c, dict):
            continue
        for lang in LANGS:
            if isinstance(c.get("name_" + lang), str):
                c["name_" + lang] = c["name_" + lang].strip()
        for it in c.get("items", []) if isinstance(c.get("items"), list) else []:
            if not isinstance(it, dict):
                continue
            for lang in LANGS:
                for f in ("name_", "description_"):
                    k = f + lang
                    if isinstance(it.get(k), str):
                        it[k] = it[k].strip()
            if all(not it.get("description_" + l) for l in LANGS):
                for l in LANGS:
                    it.pop("description_" + l, None)
            if not it.get("tag"):
                it.pop("tag", None)
            if isinstance(it.get("price"), float) and it["price"].is_integer():
                it["price"] = int(it["price"])
    r = d.get("restaurant")
    if isinstance(r, dict):
        for k, v in list(r.items()):
            if isinstance(v, str):
                r[k] = v.strip()
    t = d.get("texts")
    if isinstance(t, dict):
        for entry in t.values():
            if isinstance(entry, dict):
                for l in LANGS:
                    if isinstance(entry.get(l), str):
                        entry[l] = entry[l].strip()
    return d


def validate(data):
    errors = []
    if not isinstance(data, dict):
        return ["Menu data must be an object."]

    # restaurant
    r = data.get("restaurant")
    if not isinstance(r, dict):
        errors.append("restaurant: missing.")
    else:
        if not _is_str(r.get("name"), 80):
            errors.append("restaurant.name: required.")
        if not (isinstance(r.get("phone"), str) and PHONE_RE.match(r["phone"])):
            errors.append("restaurant.phone: digits only, optional leading +, 6–15 digits.")
        if not _is_str(r.get("phoneDisplay"), 30):
            errors.append("restaurant.phoneDisplay: required.")
        for k in ("whatsapp", "instagram", "facebook", "mapsUrl", "reviewsUrl"):
            if not _is_https(r.get(k)):
                errors.append("restaurant.%s: must be a https:// link." % k)
        rating = r.get("rating")
        if isinstance(rating, bool) or not isinstance(rating, (int, float)) or not math.isfinite(rating) or not 0 <= rating <= 5:
            errors.append("restaurant.rating: number between 0 and 5.")
        rc = r.get("reviewCount")
        if isinstance(rc, bool) or not isinstance(rc, int) or rc < 0:
            errors.append("restaurant.reviewCount: whole number, 0 or more.")
        if not _is_str(r.get("currency"), 5):
            errors.append("restaurant.currency: required.")

    # texts
    t = data.get("texts")
    if not isinstance(t, dict):
        errors.append("texts: missing.")
    else:
        for key in TEXT_KEYS:
            entry = t.get(key)
            if not isinstance(entry, dict):
                errors.append("texts.%s: missing." % key)
                continue
            for l in LANGS:
                if not _is_str(entry.get(l), 300):
                    errors.append("texts.%s.%s: required." % (key, l))
                elif key in PLACEHOLDER_KEYS and "{n}" not in entry[l]:
                    errors.append("texts.%s.%s: must contain {n}." % (key, l))
        extra = set(t) - set(TEXT_KEYS)
        if extra:
            errors.append("texts: unknown keys %s." % ", ".join(sorted(extra)))

    # categories & items
    cats = data.get("categories")
    if not isinstance(cats, list):
        errors.append("categories: must be a list.")
        return errors
    cat_ids, item_ids = set(), set()
    for ci, c in enumerate(cats):
        where = "categories[%d]" % ci
        if not isinstance(c, dict):
            errors.append(where + ": must be an object.")
            continue
        cid = c.get("id")
        if not (isinstance(cid, str) and SLUG_RE.match(cid)):
            errors.append(where + ".id: lowercase letters, numbers and dashes only.")
        elif cid in cat_ids:
            errors.append(where + ".id: duplicate '%s'." % cid)
        else:
            cat_ids.add(cid)
            where = "category '%s'" % cid
        for l in LANGS:
            if not _is_str(c.get("name_" + l), 80):
                errors.append("%s: name_%s required (max 80)." % (where, l))
        if c.get("icon") not in ICONS:
            errors.append(where + ": unknown icon.")
        if not isinstance(c.get("visible", True), bool):
            errors.append(where + ": visible must be true/false.")
        items = c.get("items")
        if not isinstance(items, list):
            errors.append(where + ": items must be a list.")
            continue
        for ii, it in enumerate(items):
            iw = "%s item %d" % (where, ii + 1)
            if not isinstance(it, dict):
                errors.append(iw + ": must be an object.")
                continue
            iid = it.get("id")
            if not (isinstance(iid, str) and SLUG_RE.match(iid)):
                errors.append(iw + ".id: lowercase letters, numbers and dashes only.")
            elif iid in item_ids:
                errors.append(iw + ".id: duplicate '%s'." % iid)
            else:
                item_ids.add(iid)
                iw = "item '%s'" % iid
            for l in LANGS:
                if not _is_str(it.get("name_" + l), 120):
                    errors.append("%s: name_%s required (max 120)." % (iw, l))
            descs = [it.get("description_" + l) for l in LANGS]
            if any(d is not None for d in descs):
                if not all(_is_str(d, 300) for d in descs):
                    errors.append(iw + ": description must be filled in all three languages or left empty.")
            price = it.get("price")
            if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price < 0 or price > 100000:
                errors.append(iw + ": price must be a number between 0 and 100000.")
            elif abs(price * 100 - round(price * 100)) > 1e-6:  # tolerance: 19.99 * 100 == 1998.9999999999998
                errors.append(iw + ": price has more than 2 decimals.")
            if "tag" in it and it["tag"] not in TAGS:
                errors.append(iw + ": unknown tag.")
            if not isinstance(it.get("visible", True), bool):
                errors.append(iw + ": visible must be true/false.")
            allowed = {"id", "price", "tag", "visible"} | {f + l for f in ("name_", "description_") for l in LANGS}
            extra = set(it) - allowed
            if extra:
                errors.append(iw + ": unknown fields %s." % ", ".join(sorted(extra)))
    return errors


def public_view(data):
    """Strip hidden categories/items and the admin-only `visible` flag."""
    out = {"restaurant": data["restaurant"], "texts": data["texts"], "categories": []}
    for c in data["categories"]:
        if c.get("visible", True) is False:
            continue
        items = [
            {k: v for k, v in it.items() if k != "visible"}
            for it in c["items"]
            if it.get("visible", True) is not False
        ]
        if not items:  # a category whose dishes are all hidden would show as an empty section
            continue
        cat = {k: v for k, v in c.items() if k not in ("items", "visible")}
        cat["items"] = items
        out["categories"].append(cat)
    return out


# --------------------------------------------------------------------------- auth

def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return {"salt": salt, "hash": digest.hex(), "iterations": PBKDF2_ITERATIONS}


def check_password(password):
    if not os.path.exists(AUTH_FILE):
        return False
    auth = read_json(AUTH_FILE)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(auth["salt"]), int(auth.get("iterations", PBKDF2_ITERATIONS))
    )
    return hmac.compare_digest(digest.hex(), auth["hash"])


def password_problem(pw):
    if not isinstance(pw, str) or len(pw) < MIN_PASSWORD:
        return "Password must be at least %d characters." % MIN_PASSWORD
    if len(pw) > 200:
        return "Password is too long."
    return None


# --------------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "SBDAdmin/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (datetime.now().strftime("%H:%M:%S"), fmt % args))

    # -- helpers
    def send_json(self, status, payload, extra_headers=None, cors=False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cors:
            self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def error(self, status, message, **extra):
        payload = {"error": message}
        payload.update(extra)
        self.send_json(status, payload)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > MAX_BODY:
            raise ValueError("Request too large.")
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw.decode("utf-8") or "{}", parse_constant=_reject_constant)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Invalid JSON.")

    def client_ip(self):
        if TRUST_PROXY:
            # the proxy appends the real peer address as the last X-Forwarded-For entry
            fwd = (self.headers.get("X-Forwarded-For") or "").split(",")[-1].strip()
            if fwd:
                return fwd
        return self.client_address[0]

    def session_token(self):
        # Parsed by hand: SimpleCookie stops at the first cookie it can't parse (e.g. a JSON value
        # set by another app on the same host) and would silently drop ours.
        for part in (self.headers.get("Cookie") or "").split(";"):
            name, sep, value = part.strip().partition("=")
            if sep and name == COOKIE_NAME and value:
                return value
        return None

    def is_authed(self):
        token = self.session_token()
        if not token:
            return False
        with lock:
            exp = sessions.get(token)
            if not exp or exp < time.time():
                sessions.pop(token, None)
                return False
            sessions[token] = time.time() + SESSION_TTL
        return True

    def cookie_header(self, token, max_age):
        secure = TRUST_PROXY and (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"
        return "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d%s" % (
            COOKIE_NAME, token, max_age, "; Secure" if secure else "")

    def new_session(self):
        token = secrets.token_urlsafe(32)
        with lock:
            now = time.time()
            for t, exp in list(sessions.items()):
                if exp < now:
                    del sessions[t]
            sessions[token] = now + SESSION_TTL
        return token

    def csrf_ok(self):
        # Browsers cannot send this header cross-site without a CORS preflight, which we never allow.
        return self.headers.get("X-SBD-Admin") == "1"

    # -- routing
    def do_OPTIONS(self):
        if urlparse(self.path).path == "/api/menu":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.end_headers()
        else:
            self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
            self.end_headers()

    def run_safely(self, fn):
        """Turn unexpected exceptions into a JSON 500 instead of a dropped connection."""
        try:
            fn()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            try:
                self.error(500, "Server error.")
            except Exception:
                pass

    def do_HEAD(self):
        self.run_safely(self.handle_read)

    def do_GET(self):
        self.run_safely(self.handle_read)

    def handle_read(self):
        path = urlparse(self.path).path
        if path == "/api/menu":
            with lock:
                data = read_json(MENU_FILE)
            return self.send_json(200, public_view(data), cors=True)
        if path == "/api/admin/status":
            return self.send_json(200, {"setupRequired": not os.path.exists(AUTH_FILE), "authenticated": self.is_authed()})
        if path.startswith("/api/admin/"):
            if not self.is_authed():
                return self.error(401, "Not signed in.")
            if path == "/api/admin/menu":
                with lock:
                    data = read_json(MENU_FILE)
                return self.send_json(200, {"data": data, "revision": revision_of(data)})
            if path == "/api/admin/backups":
                return self.send_json(200, {"backups": list_backups()})
            if path.startswith("/api/admin/backups/"):
                name = unquote(path[len("/api/admin/backups/"):])
                if not BACKUP_RE.match(name) or not os.path.exists(os.path.join(BACKUP_DIR, name)):
                    return self.error(404, "Backup not found.")
                try:
                    backup = read_json(os.path.join(BACKUP_DIR, name))
                except ValueError:
                    return self.error(400, "Backup file is corrupt.")
                return self.send_json(200, {"data": backup})
            return self.error(404, "Not found.")
        if path.startswith("/api/"):
            return self.error(404, "Not found.")
        return self.serve_static(path)

    def do_POST(self):
        self.run_safely(self.handle_write)

    def do_PUT(self):
        self.run_safely(self.handle_write)

    def handle_write(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/admin/"):
            return self.error(405, "Method not allowed.")
        if not self.csrf_ok():
            return self.error(403, "Missing admin header.")
        try:
            body = self.read_body()
        except ValueError as e:
            return self.error(400, str(e))
        if not isinstance(body, dict):
            return self.error(400, "Invalid request.")

        if path == "/api/admin/setup" and self.command == "POST":
            problem = password_problem(body.get("password"))
            if problem:
                return self.error(400, problem)
            with lock:
                if os.path.exists(AUTH_FILE):
                    return self.error(409, "A password is already set.")
                write_json_atomic(AUTH_FILE, hash_password(body["password"]))
            token = self.new_session()
            return self.send_json(200, {"ok": True}, [("Set-Cookie", self.cookie_header(token, SESSION_TTL))])

        if path == "/api/admin/login" and self.command == "POST":
            ip = self.client_ip()
            with lock:
                count, until = login_failures.get(ip, (0, 0))
            if until > time.time():
                return self.error(429, "Too many attempts. Try again in a minute.", retryAfter=int(until - time.time()) + 1)
            pw = body.get("password")
            if isinstance(pw, str) and check_password(pw):
                with lock:
                    login_failures.pop(ip, None)
                token = self.new_session()
                return self.send_json(200, {"ok": True}, [("Set-Cookie", self.cookie_header(token, SESSION_TTL))])
            with lock:
                count = login_failures.get(ip, (0, 0))[0] + 1
                login_failures[ip] = (0, time.time() + 60) if count >= 5 else (count, 0)
            time.sleep(0.4)
            return self.error(401, "Wrong password.")

        if path == "/api/admin/logout" and self.command == "POST":
            token = self.session_token()
            with lock:
                sessions.pop(token, None)
            return self.send_json(200, {"ok": True}, [("Set-Cookie", self.cookie_header("", 0))])

        if not self.is_authed():
            return self.error(401, "Not signed in.")

        if path == "/api/admin/menu" and self.command == "PUT":
            data = body.get("data")
            data = normalize(data) if isinstance(data, dict) else data
            errors = validate(data)
            if errors:
                return self.error(400, "Validation failed.", details=errors)
            with lock:
                current = read_json(MENU_FILE)
                if body.get("revision") != revision_of(current) and not body.get("force"):
                    return self.error(409, "The menu was changed somewhere else.", revision=revision_of(current))
                backup = make_backup()
                write_json_atomic(MENU_FILE, data)
            return self.send_json(200, {"ok": True, "revision": revision_of(data), "backup": backup, "data": data})

        if path == "/api/admin/backups/restore" and self.command == "POST":
            name = body.get("name")
            if not isinstance(name, str) or not BACKUP_RE.match(name):
                return self.error(400, "Invalid backup name.")
            p = os.path.join(BACKUP_DIR, name)
            if not os.path.exists(p):
                return self.error(404, "Backup not found.")
            try:
                raw = read_json(p)
            except ValueError:
                return self.error(400, "Backup file is corrupt.")
            data = normalize(raw) if isinstance(raw, dict) else raw
            errors = validate(data)
            if errors:
                return self.error(400, "Backup failed validation.", details=errors)
            with lock:
                make_backup()
                write_json_atomic(MENU_FILE, data)
            return self.send_json(200, {"ok": True, "revision": revision_of(data), "data": data})

        if path == "/api/admin/password" and self.command == "POST":
            if not isinstance(body.get("current"), str) or not check_password(body["current"]):
                return self.error(400, "Current password is wrong.")
            problem = password_problem(body.get("new"))
            if problem:
                return self.error(400, problem)
            with lock:
                write_json_atomic(AUTH_FILE, hash_password(body["new"]))
                keep = self.session_token()
                for t in list(sessions):
                    if t != keep:
                        del sessions[t]
            return self.send_json(200, {"ok": True})

        return self.error(404, "Not found.")

    def serve_static(self, path):
        if path in ("", "/"):
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/admin/")
            self.end_headers()
            return
        rel = unquote(path).lstrip("/")
        full = os.path.realpath(os.path.join(PUBLIC_DIR, rel))
        if not (full == PUBLIC_DIR or full.startswith(PUBLIC_DIR + os.sep)):
            return self.error(404, "Not found.")
        if os.path.isdir(full):
            if not path.endswith("/"):
                self.send_response(HTTPStatus.MOVED_PERMANENTLY)
                self.send_header("Location", path + "/")
                self.end_headers()
                return
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self.error(404, "Not found.")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if full.endswith(".html") and os.sep + "admin" + os.sep in full:
            self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Steak by Dabbah menu admin")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    parser.add_argument("--trust-proxy", action="store_true",
                        help="behind a reverse proxy: use X-Forwarded-For as the client IP for login rate limiting")
    args = parser.parse_args()
    global TRUST_PROXY
    TRUST_PROXY = args.trust_proxy

    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(MENU_FILE):
        if not os.path.exists(SEED_FILE):
            sys.exit("No menu found: %s and %s are both missing." % (MENU_FILE, SEED_FILE))
        write_json_atomic(MENU_FILE, read_json(SEED_FILE))  # first run: start from the original menu
        print("Created %s from the original menu." % MENU_FILE, flush=True)
    errors = validate(read_json(MENU_FILE))
    if errors:
        sys.exit("%s is invalid:" % MENU_FILE + "\n  " + "\n  ".join(errors))
    env_pw = os.environ.get("ADMIN_PASSWORD")
    if env_pw and not os.path.exists(AUTH_FILE):
        problem = password_problem(env_pw)
        if problem:
            sys.exit("ADMIN_PASSWORD: " + problem)
        write_json_atomic(AUTH_FILE, hash_password(env_pw))

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    # 127.0.0.1, not "localhost": localhost may resolve to ::1, where a different server could be listening
    shown = "127.0.0.1" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    lines = [
        "Steak by Dabbah admin running:",
        "  Admin panel : http://%s:%d/admin/" % (shown, args.port),
        "  Menu preview: http://%s:%d/menu/" % (shown, args.port),
        "  Public API  : http://%s:%d/api/menu" % (shown, args.port),
    ]
    if not os.path.exists(AUTH_FILE):
        lines.append("  First visit to the admin panel will ask you to create a password.")
    lines.append("Press Ctrl+C to stop.")
    print("\n".join(lines), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
