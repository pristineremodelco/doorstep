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

Send from **doorstep.pristineremodelco.com**, a subdomain of the business
domain, which Hostinger already runs the DNS for. That settles the domain
requirement every provider now has, and a subdomain rather than the root for two
reasons that both matter.

Reputation first. If Doorstep's mail ever got marked as spam, sending from the
root would drag the reputation of the address quotes go out from. A subdomain
keeps the two apart, which is why this is the normal practice rather than a
precaution.

And safety second. The root already carries exactly one SPF record:

    v=spf1 include:_spf.mail.hostinger.com ~all

A domain may only have one. Adding a second does not add to the first, it breaks
both, and the mail that stops arriving is the business's. Verifying a subdomain
means never touching that line: the subdomain gets its own records, and the
business email carries on regardless of anything done here.

1. In Brevo: your name, top right, then **Senders, Domains & Dedicated IPs**,
   then **Domains**, then add `doorstep.pristineremodelco.com`.
2. Brevo shows you two TXT records: a verification code, and a DKIM key at
   `mail._domainkey`. It does **not** ask for SPF unless you buy a dedicated IP,
   so the root's existing SPF line never needs touching.

   Add them in **Hostinger**, not Brevo. hPanel, Domains, pristineremodelco.com,
   DNS / Nameservers. Nothing is being registered here: a subdomain exists the
   moment a record points at it, because you already own everything under the
   domain you bought.

   The Name field is the only place this goes wrong. Hostinger appends
   `.pristineremodelco.com` to whatever you type, so Brevo's
   `mail._domainkey.doorstep.pristineremodelco.com` is entered as:

        mail._domainkey.doorstep

   Paste the whole thing and you get a record at
   `mail._domainkey.doorstep.pristineremodelco.com.pristineremodelco.com`,
   which resolves nowhere, and Brevo just says the domain is unverified without
   saying why.

3. Check what actually landed, before going back to Brevo:

        ./tools/dns-check.sh

   It reports the two records, catches the doubled-domain mistake, and confirms
   the business email on the root is untouched. Then press verify in Brevo.
   Usually minutes, occasionally an hour while DNS propagates.
4. **Settings**, **SMTP & API**, **SMTP** tab. Copy the **Login**, which looks
   like `xxxx@smtp-brevo.com`, and click **Generate a new SMTP key** for the
   password. The full key shows once.

   The password is the SMTP key. Not the Brevo account password, not an API key,
   both of which sit on the same page.
5. Put both in your shell, so neither reaches this repository:

        export DOORSTEP_SMTP_USER="the login"
        export DOORSTEP_SMTP_PASS="the key"
        export DOORSTEP_SMTP_FROM="hello@doorstep.pristineremodelco.com"

6. Prove the relay works before Doorstep is pointed at it:

        ./tools/smtp-test.sh pristineremodelco@gmail.com

7. Then switch it on and commit the config:

        ./tools/smtp-on.sh

Nothing needs to receive mail at `hello@doorstep.pristineremodelco.com` for this
to work; a reply to it would simply bounce. Worth pointing at a real mailbox
later, since somebody will eventually reply to a sign-in email.

## The catch worth knowing before you start

Brevo enables transactional sending by hand on new accounts, so credentials can
be real and the relay still refuse them until somebody there approves it. A
verified domain is what that approval usually turns on, which is the case as
soon as step 3 above is done. `./tools/smtp-test.sh` says which side of that
line you are on in one command.

If it is still refused after the domain verifies, open the help icon in Brevo,
then Support and Tickets, and ask for transactional email to be activated. A day
or two. Resend and Postmark review new accounts the same way, so switching
provider is not a way around it; the domain is.

The alternatives, if Brevo ever stops suiting: Resend gives 3,000 a month but
wants a domain it can verify, and Postmark has a small free tier with strong
deliverability. The template works with any of them.

Nothing in the app changes. The next sign-in email is branded, and the ceiling
goes from two an hour to whatever the provider allows. Supabase applies its own
limit of 30 an hour once custom SMTP is on, adjustable in the dashboard.

## What it will look like

The from address is whichever mailbox you verified, so with Brevo and a Gmail
address it reads as coming from you rather than from a domain. Brevo also adds a
small line of its own under the message on the free plan. If either matters
later, a paid Brevo plan drops the line and Resend with a real domain drops both.

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
password for that half hour — anyone holding it can sign in as them.

This works whether or not custom SMTP is ever configured.
