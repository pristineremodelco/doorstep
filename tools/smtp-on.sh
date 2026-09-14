#!/usr/bin/env bash
#
# Switches Doorstep's sign-in email over to Resend.
#
# Two things change at once, because they have the same cause. Supabase's
# built-in sender allows two auth emails an hour, and it refuses template
# changes while it is in use. A custom sender lifts the limit and unlocks the
# branded email in one step.
#
# Run it once, after creating an API key in Resend:
#
#   export DOORSTEP_SMTP_PASS="re_..."
#   ./tools/smtp-on.sh
#
# The key stays in your shell. Only the reference to it is written to
# config.toml, so nothing secret reaches the repository.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF=reqvbjoxlwncuzbjmwud

if [ -z "${DOORSTEP_SMTP_PASS:-}" ]; then
  echo "Not set: DOORSTEP_SMTP_PASS"
  echo
  echo "In Resend, open API Keys and create one. Then:"
  echo
  echo "  export DOORSTEP_SMTP_PASS=\"re_...\""
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
     '# host = "smtp.resend.com"\n'
     '# port = 465\n'
     '# user = "resend"\n'
     '# pass = "env(DOORSTEP_SMTP_PASS)"\n'
     '# admin_email = "hello@doorstep.pristineremodelco.com"\n'
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
# --yes, so the push does not stop to ask. A confirmation prompt in the middle of
# a one-command script is where somebody types yes as a word, which on a Mac is
# a command of its own that prints y forever.
supabase config push --project-ref "$PROJECT_REF" --yes

# What is left depends on what is left. This used to print the same two steps
# every time, including "commit" on runs where there was nothing to commit, which
# is exactly the kind of instruction that sends somebody looking for a problem.
echo
echo "Pushed. Supabase now has the current email settings and design."
echo
echo "Check it: sign out of the app and sign in, and look at the email that arrives."
if ! git diff --quiet HEAD -- supabase/config.toml supabase/templates/magic_link.html 2>/dev/null; then
  echo
  echo "Also save it, so the repository matches what Supabase has:"
  echo "  git add supabase/config.toml supabase/templates/magic_link.html && git commit -m \"Update sign-in email\" && git push"
fi
