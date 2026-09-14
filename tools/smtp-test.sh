#!/usr/bin/env bash
#
# Sends one email through Resend, before Doorstep is pointed at it.
#
# If the domain is not verified yet, or the key is wrong, this is where it should
# surface: here only a test fails, rather than the next person trying to sign in.
#
#   export DOORSTEP_SMTP_PASS="re_..."
#   ./tools/smtp-test.sh pristineremodelco@gmail.com

set -uo pipefail

TO="${1:-pristineremodelco@gmail.com}"
FROM="${DOORSTEP_SMTP_FROM:-hello@doorstep.pristineremodelco.com}"

if [ -z "${DOORSTEP_SMTP_PASS:-}" ]; then
  echo "Set DOORSTEP_SMTP_PASS to a Resend API key first (Resend, API Keys)."
  exit 1
fi

body=$(mktemp)
trap 'rm -f "$body"' EXIT
cat > "$body" <<EOF
From: Doorstep <$FROM>
To: <$TO>
Subject: Doorstep can reach Resend
Date: $(date -R)

If this arrived, Doorstep's sign-in email can go through Resend.
Next step is ./tools/smtp-on.sh
EOF

echo "Sending as $FROM to $TO via smtp.resend.com ..."
out=$(curl --silent --show-error \
  --url "smtps://smtp.resend.com:465" \
  --user "resend:$DOORSTEP_SMTP_PASS" \
  --mail-from "$FROM" --mail-rcpt "$TO" \
  --upload-file "$body" 2>&1)
code=$?

if [ $code -eq 0 ]; then
  echo "Accepted. Check $TO, and junk if it is not in the inbox."
  echo "Then run ./tools/smtp-on.sh"
  exit 0
fi

echo "Refused: $out"
echo
case "$out" in
  *535*|*[Aa]uthentication*|*[Uu]nauthori*)
    echo "The key was rejected. Check DOORSTEP_SMTP_PASS is the whole API key,"
    echo "starting re_, with sending access." ;;
  *[Dd]omain*|*[Vv]erif*|*450*|*550*|*553*)
    echo "The domain is not verified yet. Run ./tools/dns-check.sh, and check"
    echo "Resend shows doorstep.pristineremodelco.com as Verified." ;;
esac
exit $code
