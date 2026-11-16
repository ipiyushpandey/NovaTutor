#!/usr/bin/env bash
# NovaTutor — secure deployment credential setup.
#
# Prompts for the values that only you can create, writes them into the
# gitignored deploy/secrets.env, and never prints a secret back to the screen
# or to any log.
#
# Run:  bash deploy/fill-secrets.command      (or double-click on macOS)

set -euo pipefail
cd "$(dirname "$0")/.."
OUT="deploy/secrets.env"
[ -f "$OUT" ] || cp deploy/secrets.env.example "$OUT"
chmod 600 "$OUT" 2>/dev/null || true

current() { grep -E "^$1=" "$OUT" 2>/dev/null | head -1 | cut -d= -f2- ; }

# Read a value with hidden input (passwords/keys are never echoed).
ask_hidden() {
  local prompt="$1" __out="$2" val=""
  while [ -z "$val" ]; do
    printf '  %s: ' "$prompt" >&2
    IFS= read -rs val || true
    printf '\n' >&2
    [ -z "$val" ] && printf '    (required)\n' >&2
  done
  printf -v "$__out" '%s' "$val"
}

# Read a value visibly, offering the current value as the default.
ask_visible() {
  local prompt="$1" __out="$2" def="${3:-}" val=""
  if [ -n "$def" ]; then
    printf '  %s [%s]: ' "$prompt" "$def" >&2
  else
    printf '  %s: ' "$prompt" >&2
  fi
  IFS= read -r val || true
  [ -z "$val" ] && val="$def"
  printf -v "$__out" '%s' "$val"
}

clear 2>/dev/null || true
cat <<'BANNER'
============================================================
 NovaTutor deployment credentials
 Nothing you type is echoed, logged, or sent anywhere except
 the gitignored file deploy/secrets.env.
 Press Enter to keep an existing value where one is shown.
============================================================

1) Render  -> Dashboard -> Account Settings -> API Keys -> Create API Key
2) TiDB Cloud -> your Starter cluster -> Connect (host / user / password)
3) Google AI Studio -> API key
BANNER
echo

RENDER_API_KEY="$(current RENDER_API_KEY)"
DB_URL="$(current DB_URL)"
DB_USERNAME="$(current DB_USERNAME)"
DB_PASSWORD="$(current DB_PASSWORD)"
GEMINI_API_KEY="$(current GEMINI_API_KEY)"
JWT_SECRET="$(current JWT_SECRET)"
ADMIN_EMAIL="$(current ADMIN_EMAIL)"
ADMIN_PASSWORD="$(current ADMIN_PASSWORD)"

echo "[1/5] Render API key (starts with rnd_...)"
if [ -n "$RENDER_API_KEY" ]; then echo "  already set (press Enter to keep)"; fi
ask_hidden "RENDER_API_KEY" RENDER_API_KEY

echo "[2/5] Database host (TiDB Cloud: the host shown in Connect; may be a full jdbc:mysql:// URL)"
ask_visible "DB_HOST_OR_URL" DB_INPUT "$(current DB_URL)"
if [ -n "${DB_INPUT:-}" ]; then
  case "$DB_INPUT" in
    jdbc:mysql://*) DB_URL="$DB_INPUT" ;;
    mysql://*)
      # mysql://user:pass@host:port/db
      rest="${DB_INPUT#mysql://}"
      creds="${rest%%@*}"; hostpart="${rest#*@}"
      DB_USERNAME="${creds%%:*}"; DB_PASSWORD="${creds#*:}"
      hostport="${hostpart%%/*}"; dbname="${hostpart#*/}"; dbname="${dbname%%\?*}"
      DB_URL="jdbc:mysql://${hostport}/${dbname}?sslMode=VERIFY_IDENTITY&serverTimezone=Asia/Kolkata&allowPublicKeyRetrieval=true"
      ;;
    *tidbcloud.com*|*:4000*)
      hostport="${DB_INPUT%%/*}"; dbname="${DB_INPUT#*/}"; [ "$dbname" = "$DB_INPUT" ] && dbname="ai_tutor"
      case "$hostport" in *:*) ;; *) hostport="${hostport}:4000" ;; esac
      DB_URL="jdbc:mysql://${hostport}/${dbname}?sslMode=VERIFY_IDENTITY&serverTimezone=Asia/Kolkata&allowPublicKeyRetrieval=true"
      ;;
    *)
      DB_URL="jdbc:mysql://${DB_INPUT}:4000/ai_tutor?sslMode=VERIFY_IDENTITY&serverTimezone=Asia/Kolkata&allowPublicKeyRetrieval=true"
      ;;
  esac
fi

echo "[3/5] Database credentials"
ask_visible "DB_USERNAME" DB_USERNAME "$DB_USERNAME"
ask_hidden "DB_PASSWORD" DB_PASSWORD

echo "[4/5] Gemini API key (fresh key — the exposed one must not be used publicly)"
if [ -n "$GEMINI_API_KEY" ]; then echo "  already set (press Enter to keep)"; fi
ask_hidden "GEMINI_API_KEY" GEMINI_API_KEY

echo "[5/5] Owner/admin account"
ask_visible "ADMIN_EMAIL" ADMIN_EMAIL "$ADMIN_EMAIL"
if [ -n "$ADMIN_PASSWORD" ]; then
  echo "  admin password already generated (press Enter to keep it)"
  ask_visible "ADMIN_PASSWORD" ADMIN_PASSWORD "$ADMIN_PASSWORD"
else
  ask_hidden "ADMIN_PASSWORD (min 12 chars)" ADMIN_PASSWORD
fi

[ -n "$JWT_SECRET" ] || JWT_SECRET="$(openssl rand -base64 48 2>/dev/null | tr -d '\n')"
[ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD=""

# --- validation -------------------------------------------------------------
fail=0
[ -n "$RENDER_API_KEY" ] || { echo "ERROR: missing Render API key"; fail=1; }
case "$DB_URL" in jdbc:mysql://*) ;; *) echo "ERROR: database URL must start with jdbc:mysql://"; fail=1;; esac
[ -n "$DB_USERNAME" ] || { echo "ERROR: missing DB username"; fail=1; }
[ -n "$DB_PASSWORD" ] || { echo "ERROR: missing DB password"; fail=1; }
[ -n "$GEMINI_API_KEY" ] || { echo "ERROR: missing Gemini key"; fail=1; }
[ -n "$ADMIN_EMAIL" ] || { echo "ERROR: missing admin email"; fail=1; }
[ "${#ADMIN_PASSWORD}" -ge 12 ] || { echo "ERROR: admin password must be at least 12 characters"; fail=1; }
[ "${#JWT_SECRET}" -ge 32 ] || { echo "ERROR: JWT secret must be at least 32 characters"; fail=1; }
if [ "$fail" -ne 0 ]; then echo "Nothing written. Re-run the script."; exit 1; fi

umask 077
cat > "$OUT" <<EOF
# NovaTutor deployment secrets — GITIGNORED. Do not commit, do not share.
RENDER_API_KEY=${RENDER_API_KEY}
DB_URL=${DB_URL}
DB_USERNAME=${DB_USERNAME}
DB_PASSWORD=${DB_PASSWORD}
GEMINI_API_KEY=${GEMINI_API_KEY}
JWT_SECRET=${JWT_SECRET}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
CORS_ORIGINS=$(current CORS_ORIGINS)
EOF
chmod 600 "$OUT"

echo
echo "============================================================"
echo " Written to deploy/secrets.env (gitignored, chmod 600):"
for k in RENDER_API_KEY DB_URL DB_USERNAME DB_PASSWORD GEMINI_API_KEY JWT_SECRET ADMIN_EMAIL ADMIN_PASSWORD; do
  v="$(current "$k")"; [ -n "$v" ] && echo "   $k = SET" || echo "   $k = EMPTY"
done
echo "============================================================"
echo "Your admin login is ADMIN_EMAIL + (the admin password in this file)."
echo "Next: reply \"ready\" in the chat and the deployment runs."
