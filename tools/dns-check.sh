#!/usr/bin/env bash
#
# Checks that Resend's DNS records for the sending subdomain have landed, and
# landed where they should.
#
#   ./tools/dns-check.sh

set -uo pipefail

SUB="${1:-doorstep.pristineremodelco.com}"
ROOT="$(echo "$SUB" | rev | cut -d. -f1,2 | rev)"
R="dig +short @1.1.1.1"

ok () { printf '  \033[32m%s\033[0m %s\n' "yes" "$1"; }
no () { printf '  \033[33m%s\033[0m %s\n' " no" "$1"; }

echo "Sending subdomain: $SUB"
echo

echo "DKIM   (TXT, Name: resend._domainkey.${SUB%.$ROOT})"
[ -n "$($R TXT "resend._domainkey.$SUB")" ] && ok "found" || no "not there yet"

echo
echo "SPF    (TXT, Name: send.${SUB%.$ROOT})"
spf=$($R TXT "send.$SUB" | grep "v=spf1" || true)
[ -n "$spf" ] && ok "found: $spf" || no "not there yet"

echo
echo "Bounce (MX,  Name: send.${SUB%.$ROOT})"
mx=$($R MX "send.$SUB" || true)
[ -n "$mx" ] && ok "found: $mx" || no "not there yet"

echo
echo "Name field entered correctly (domain not typed twice)"
if [ -n "$($R TXT "resend._domainkey.$SUB.$ROOT")$($R TXT "send.$SUB.$ROOT")" ]; then
  no "a record ended up under .$ROOT.$ROOT"
  echo "     Enter only the part shown in brackets above; Hostinger adds .$ROOT."
else
  ok "no doubled-up records"
fi

echo
echo "Business mail on $ROOT, which none of this touches"
n=$($R TXT "$ROOT" | grep -c "v=spf1" || true)
[ "$n" = "1" ] && ok "one SPF record, unchanged" || no "$n SPF records on $ROOT"
[ -n "$($R MX "$ROOT")" ] && ok "MX records present" || no "no MX on $ROOT"

echo
echo "When the first three say yes, press Verify in Resend."
