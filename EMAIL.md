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

Brevo, which is what `supabase/config.toml` is already set up for. 300 emails a
day free, permanently, no card, and it will verify a single email address rather
than needing a whole domain.

1. Sign up at brevo.com. Verify `pristineremodelco@gmail.com` as a sender:
   your name in the top right, **Senders, Domains & Dedicated IPs**, **Senders**,
   **Add a sender**. They email a confirmation link.
2. Your name in the top right, **Settings**, **SMTP & API**, **SMTP** tab.
   The **Login** is on that page and looks like `xxxx@smtp-brevo.com`. Click
   **Generate a new SMTP key** for the password. The full key is shown once, so
   copy it then.

   The password is the SMTP key. It is not your Brevo account password and it is
   not an API key, both of which live nearby and neither of which will work.
3. Put both in your shell, so neither is ever written into this repo:

        export DOORSTEP_SMTP_USER="the login from that page"
        export DOORSTEP_SMTP_PASS="the key from that page"

4. Send one test email through Brevo before touching Supabase:

        ./tools/smtp-test.sh pristineremodelco@gmail.com

   This exists because of the catch below: a new Brevo account does not
   necessarily have transactional sending switched on, and the failure is much
   easier to read here than after Doorstep has been repointed.

5. Run the switch-on script:

        ./tools/smtp-on.sh

   It uncomments the two blocks at the bottom of `supabase/config.toml` and
   pushes in one step. That matters more than it looks: `supabase config push`
   resets anything the file does not mention, and doing this by hand has
   already wiped this project's rate limits and MFA setting once.

6. Send yourself a sign-in link from the app and check it arrives, then commit
   config.toml.

## The catch worth knowing before you start

Brevo enables transactional sending by hand on new accounts. The credentials can
be perfectly real and the relay still refuses them until somebody there approves
the account, and reports are that they often want a verified domain before they
will. That runs against the reason Brevo was picked here, which was that it
verifies a single address rather than a whole domain.

So the honest position is: verifying one address is enough to *create* the
credentials, and may not be enough to *use* them. `./tools/smtp-test.sh` answers
that in one command. If it is refused, the choices are to open a support ticket
in Brevo (help icon, then Support and Tickets, asking for transactional email to
be activated — a day or two), or to buy a domain, which settles it here and at
Resend and Postmark too, all of which review new accounts the same way.

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
