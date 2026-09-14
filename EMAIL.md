# The sign-in email

Two problems, one fix.

**It is unbranded.** It arrives from Supabase, and nobody signing up has heard
of Supabase. A branded version is written and waiting at
`supabase/templates/magic_link.html`: the Doorstep mark, the name, a code in
large type, and a Come In button in the app's own colour.

**It is limited to two emails an hour.** This is the more urgent one and it has
not bitten yet. Supabase's built-in sender allows two auth emails per hour and
their own documentation says it is not for production. Two is nothing. One
person signing up and one mistyping their address exhausts it, and the next
person is refused with a rate limit error they can do nothing about.

Supabase refuses template changes on the free plan while the built-in sender is
in use, so both problems have the same cause and the same fix: any custom SMTP
provider, free.

## Setting it up

Resend, sending from **doorstep.pristineremodelco.com**. Brevo was tried first and
could not be finished: for a subdomain it wants NS records, and Hostinger's DNS
editor has no NS type. Resend needs only TXT and MX, both of which Hostinger has.
Free for 3,000 emails a month.

A subdomain rather than the root keeps Doorstep's mail reputation apart from the
business address, and means the root's own SPF and MX records are never touched.

**In Resend**

1. Sign up at resend.com.
2. **Domains**, **Add Domain**, enter `doorstep.pristineremodelco.com`.
3. It lists three records. Keep that tab open.

**In Hostinger**: hPanel, Domains, pristineremodelco.com, DNS / Nameservers,
Manage DNS records. For each of Resend's records:

4. **Type**: what Resend shows.
5. **Name**: Resend's host with `.pristineremodelco.com` taken off the end.
6. **Value**: paste exactly. For the MX, **Priority** 10.
7. **Add Record**.

They come out as:

| Type | Name | Value |
|---|---|---|
| TXT | `resend._domainkey.doorstep` | the long key Resend shows |
| TXT | `send.doorstep` | `v=spf1 include:amazonses.com ~all` |
| MX  | `send.doorstep` | Resend's mail server, priority 10 |

**Check, then verify**

    ./tools/dns-check.sh

8. When the first three say yes, press **Verify** in Resend.

**Switch Doorstep over**

9. Resend, **API Keys**, **Create API Key**. Copy it; it starts `re_`.

        export DOORSTEP_SMTP_PASS="re_..."
        ./tools/smtp-test.sh pristineremodelco@gmail.com
        ./tools/smtp-on.sh
        git add supabase/config.toml && git commit -m "Send sign-in email through Resend" && git push

## What it will look like

It arrives from **Doorstep** <hello@doorstep.pristineremodelco.com>, with the
branded template and no provider footer.

## Why the email leads with a code

A link is the one thing that cannot sign in a home screen app on an iPhone. The
installed app has its own storage, separate from Safari, and a link tapped in
Mail opens Safari. So the session lands in the browser and the app stays signed
out, however many times somebody taps it. A code is typed into whichever window
is actually open.

Until custom SMTP is configured, the app works around this by accepting the link
pasted in, which does the same job.

## Locked out right now

If the two an hour limit has shut somebody out, they do not have to wait. Ask
the admin API for a code, which sends no email and so cannot be rate limited:

    ./tools/signin-code.sh jonemontlyn@gmail.com

Read the code out to them. On their phone: type their address, tap **I already
have a code**, type it in. Good once, for thirty minutes. Treat it as their
password for that half hour: anyone holding it can sign in as them.

This works whether or not custom SMTP is ever configured.
