#!/usr/bin/env bash
#
# Sends one email through Brevo, before Doorstep is pointed at it.
#
# Worth doing first because a new Brevo account does not necessarily have
# transactional sending switched on. They review accounts by hand, and until
# they approve yours the credentials are real but the relay refuses them. If
# that is going to happen it should happen here, where the only thing that
# breaks is a test, rather than after Supabase has been reconfigured and the
# next person to sign in gets nothing.
#
#   export DOORSTEP_SMTP_USER="the login from SMTP & API"
#   export DOORSTEP_SMTP_PASS="the key from that page"
#   ./tools/smtp-test.sh you@example.com

set -uo pipefail

TO="${1:-pristineremodelco@gmail.com}"
FROM="${DOORSTEP_SMTP_FROM:-pristineremodelco@gmail.com}"

if [ -z "${DOORSTEP_SMTP_USER:-}" ] || [ -z "${DOORSTEP_SMTP_PASS:-}" ]; then
  echo "Set DOORSTEP_SMTP_USER and DOORSTEP_SMTP_PASS first."
  echo
  echo "In Brevo: your name, top right, then Settings, then SMTP & API, then the"
  echo "SMTP tab. The Login is on that page and looks like xxxx@smtp-brevo.com."
  echo "Generate a new SMTP key for the password; the full key is shown once."
  exit 1
fi

body=$(mktemp)
trap 'rm -f "$body"' EXIT
cat > "$body" <<EOF
From: Doorstep <$FROM>
To: <$TO>
Subject: Doorstep can reach Brevo
Date: $(date -R)

If this arrived, the relay accepted the credentials and Doorstep's sign-in
email can go through it. Next step is ./tools/smtp-on.sh
EOF

echo "Sending as $FROM to $TO via smtp-relay.brevo.com ..."
out=$(curl --silent --show-error --ssl-reqd \
  --url "smtp://smtp-relay.brevo.com:587" \
  --user "$DOORSTEP_SMTP_USER:$DOORSTEP_SMTP_PASS" \
  --mail-from "$FROM" --mail-rcpt "$TO" \
  --upload-file "$body" 2>&1)
code=$?

if [ $code -eq 0 ]; then
  echo "Accepted. Check $TO, and the junk folder if it is not in the inbox."
  echo "Then run ./tools/smtp-on.sh"
  exit 0
fi

echo "Refused: $out"
echo
case "$out" in
  *535*|*[Aa]uthentication*)
    echo "The credentials were rejected. Two usual causes:"
    echo "  - The password must be the SMTP key, not your Brevo account password"
    echo "    and not an API key. They are different things on the same page."
    echo "  - A new account may not have transactional sending switched on yet."
    echo "    Brevo enables it by hand. Open the help icon in Brevo, then Support"
    echo "    and Tickets, and ask them to activate transactional email. It"
    echo "    usually takes a day or two, and they often want a verified domain"
    echo "    before they will."
    ;;
  *[Ss]ender*|*553*|*550*)
    echo "The From address is not a verified sender. In Brevo, open Senders,"
    echo "Domains & Dedicated IPs and verify $FROM, then try again."
    ;;
esac
exit $code
