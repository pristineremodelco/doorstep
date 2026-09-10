#!/usr/bin/env bash
#
# Switches Doorstep's sign-in email over to Brevo.
#
# Two things change at once, because they have the same cause. Supabase's
# built-in sender allows two auth emails an hour, and it refuses template
# changes while it is in use. A custom sender lifts the limit and unlocks the
# branded email in one step.
#
# Run it once, after generating an SMTP key in Brevo:
#
#   export DOORSTEP_SMTP_USER="the login from Brevo's SMTP & API page"
#   export DOORSTEP_SMTP_PASS="the key from that page"
#   ./tools/smtp-on.sh
#
# The two values stay in your shell. Only the reference to them is written to
# config.toml, so nothing secret reaches the repository.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF=reqvbjoxlwncuzbjmwud

missing=()
[ -n "${DOORSTEP_SMTP_USER:-}" ] || missing+=(DOORSTEP_SMTP_USER)
[ -n "${DOORSTEP_SMTP_PASS:-}" ] || missing+=(DOORSTEP_SMTP_PASS)
if [ ${#missing[@]} -gt 0 ]; then
  echo "Not set: ${missing[*]}"
  echo
  echo "In Brevo, open SMTP & API and generate an SMTP key. That page shows a"
  echo "login and the key itself. Then:"
  echo
  echo "  export DOORSTEP_SMTP_USER=\"the login\""
  echo "  export DOORSTEP_SMTP_PASS=\"the key\""
  echo "  ./tools/smtp-on.sh"
  exit 1
fi

python3 - <<'PY'
import pathlib, sys

p = pathlib.Path('supabase/config.toml')
t = p.read_text()

blocks = [
    ('# [auth.email.smtp]\n'
     '# enabled = true\n'
     '# host = "smtp-relay.brevo.com"\n'
     '# port = 587\n'
     '# user = "env(DOORSTEP_SMTP_USER)"\n'
     '# pass = "env(DOORSTEP_SMTP_PASS)"\n'
     '# admin_email = "pristineremodelco@gmail.com"\n'
     '# sender_name = "Doorstep"\n'),
    ('# [auth.email.template.magic_link]\n'
     '# subject = "Your Doorstep code"\n'
     '# content_path = "./supabase/templates/magic_link.html"\n'),
]

changed = False
for b in blocks:
    if b in t:
        t = t.replace(b, ''.join(l[2:] if l.startswith('# ') else l
                                for l in b.splitlines(keepends=True)))
        changed = True
    elif b.replace('# ', '') not in t:
        sys.exit('config.toml does not look like the version this script knows. '
                 'Switch the two blocks on by hand instead.')

if changed:
    p.write_text(t)
    print('config.toml: SMTP and the branded template switched on')
else:
    print('config.toml: already switched on, pushing anyway')
PY

echo
supabase config push --project-ref "$PROJECT_REF"

cat <<'DONE'

Pushed. Two things left:

  1. Send yourself a sign-in link from the app and check it arrives. If nothing
     turns up, the login was wrong; fix it and run this again. A bad login fails
     at send time rather than quietly, so you will know within a minute.
  2. git commit supabase/config.toml, so the repository matches the project.
DONE
