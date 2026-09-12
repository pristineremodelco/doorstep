#!/usr/bin/env bash
#
# Checks whether the DNS records for the sending subdomain have actually
# landed, and landed in the right place.
#
#   ./tools/dns-check.sh
#
# The mistake this catches is the only one people really make here. Brevo shows
# a record named something like mail._domainkey.doorstep.pristineremodelco.com.
# Some DNS editors want that whole string; Hostinger's wants only the part in
# front of the domain, and pasting the whole thing gives you a record living at
# mail._domainkey.doorstep.pristineremodelco.com.pristineremodelco.com, which
# resolves nowhere. Brevo then just says the domain is not verified, without
# saying why.

set -uo pipefail

SUB="${1:-doorstep.pristineremodelco.com}"
ROOT="$(echo "$SUB" | rev | cut -d. -f1,2 | rev)"
R="dig +short @1.1.1.1"

echo "Sending subdomain: $SUB"
echo "Root domain:       $ROOT"
echo

ok () { printf '  \033[32m%s\033[0m %s\n' "yes" "$1"; }
no () { printf '  \033[33m%s\033[0m %s\n' " no" "$1"; }

echo "Brevo verification code"
code=$($R TXT "$SUB" | grep -i "brevo" || true)
[ -n "$code" ] && ok "found: $code" || no "no brevo-code TXT on $SUB yet"

echo
echo "DKIM"
dkim=$($R TXT "mail._domainkey.$SUB" || true)
[ -n "$dkim" ] && ok "found at mail._domainkey.$SUB" || no "nothing at mail._domainkey.$SUB"

echo
echo "The name-field mistake"
doubled=$($R TXT "mail._domainkey.$SUB.$ROOT" || true)
if [ -n "$doubled" ]; then
  no "a record exists at mail._domainkey.$SUB.$ROOT"
  echo "     The domain got typed twice. In Hostinger's Name field enter only"
  echo "     mail._domainkey.${SUB%.$ROOT} — it adds .$ROOT for you."
else
  ok "no doubled-up record"
fi

echo
echo "The business mail on $ROOT, which none of this should touch"
spf=$($R TXT "$ROOT" | grep -c "v=spf1" || true)
case "$spf" in
  1) ok "exactly one SPF record, as it should be" ;;
  0) no "no SPF record at all on $ROOT — that is a change from before" ;;
  *) no "$spf SPF records on $ROOT. Only one is allowed and more than one" ;;
esac
[ "$spf" -gt 1 ] && echo "     breaks all of them. Remove the one you added; Brevo does not need it."
mx=$($R MX "$ROOT" | wc -l | tr -d ' ')
[ "$mx" -gt 0 ] && ok "$mx MX records still present" || no "no MX on $ROOT — business email would be down"

echo
echo "Once the first two say yes, Brevo will verify the domain."
