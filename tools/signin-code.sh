#!/usr/bin/env bash
#
# Makes a sign-in code for somebody, without sending an email.
#
# Supabase's built-in sender allows two auth emails an hour across the whole
# project. Run into that and the ordinary way in is shut: no email, so no link
# and no code, and nothing on the sign-in screen can help. This asks the admin
# API for the code directly, which sends nothing and so cannot be rate limited.
#
#   ./tools/signin-code.sh jonemontlyn@gmail.com
#
# Read the code out to them. On their phone: enter their address, tap
# "I already have a code", type it in. It works once and expires in 30 minutes.
#
# Treat the code as their password for those 30 minutes. Anyone holding it can
# sign in as them, so say it to them directly rather than leaving it anywhere.

set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "Usage: ./tools/signin-code.sh someone@example.com"
  exit 1
fi

if [ ! -f .supabase-service-key.txt ]; then
  echo "No .supabase-service-key.txt here. This has to run from the project."
  exit 1
fi

SERVICE_KEY="$(cat .supabase-service-key.txt)" EMAIL="$EMAIL" node -e '
import("./node_modules/@supabase/supabase-js/dist/index.cjs").then(async (m) => {
  const admin = m.createClient(
    "https://reqvbjoxlwncuzbjmwud.supabase.co",
    process.env.SERVICE_KEY,
    { auth: { persistSession: false } }
  )
  const email = process.env.EMAIL
  const { data: users, error: le } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (le) { console.error("Could not read the account list:", le.message); process.exit(1) }
  const found = users.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase())
  if (!found) {
    console.error("No account for " + email + ".")
    console.error("Accounts that exist: " + users.users.map((u) => u.email).join(", "))
    process.exit(1)
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (error) { console.error("Could not make a code:", error.message); process.exit(1) }
  console.log("")
  console.log("  Code for " + email + ":  " + data.properties.email_otp)
  console.log("")
  console.log("  On their phone: type the address, tap \"I already have a code\",")
  console.log("  then this. Good for 30 minutes, once.")
  console.log("")
})
'
