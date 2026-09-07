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

Pick a provider with a permanent free tier:

| | free allowance | needs a domain |
|---|---|---|
| Brevo | 300 a day | no, verifies a single address |
| Resend | 3,000 a month | yes |
| Postmark | small | yes |

**Brevo is the one to start with**, because it will verify a single email
address rather than a whole domain. Sign up, verify `pristineremodelco@gmail.com`
as a sender, and take the SMTP login and key from their dashboard.

Then, in `supabase/config.toml`, fill in and uncomment the `[auth.email.smtp]`
block and the `[auth.email.template.magic_link]` block under it, put the SMTP
key in your environment, and push:

    export DOORSTEP_SMTP_PASS="the key from the provider"
    supabase config push

Nothing in the app changes. The next sign-in email is branded, and the ceiling
goes from two an hour to whatever the provider allows. Supabase applies its own
limit of 30 an hour once custom SMTP is on, adjustable in the dashboard.

## What it will look like

The from address is whichever mailbox you verified, so with Brevo and a Gmail
address it reads as coming from you rather than from a domain. If that matters,
Resend with a real domain is the better end state, and the same template works
either way.

## Why the email leads with a code

A link is the one thing that cannot sign in a home screen app on an iPhone. The
installed app has its own storage, separate from Safari, and a link tapped in
Mail opens Safari. So the session lands in the browser and the app stays signed
out, however many times somebody taps it. A code is typed into whichever window
is actually open.

Until custom SMTP is configured, the app works around this by accepting the link
pasted in, which does the same job.
