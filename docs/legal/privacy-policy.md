# Privacy Policy — Kairos

**Exousia Prime Emporium Ltd**
Draft — not yet reviewed by counsel. See `README.md` in this directory.

Last updated: [DECIDE — date of publication]

---

## 1. Who we are

Kairos is a scheduling and custody platform operated by **Exousia Prime
Emporium Ltd**, a company registered in Nigeria ([DECIDE — RC number and
registered address]).

In this policy, "we" and "us" mean Exousia Prime Emporium Ltd. "You" means
whoever is reading — and which parts apply to you depends on how you arrived,
so §2 says that first.

## 2. Three kinds of people, and why the difference matters

Kairos is used by three groups, and we hold a different relationship with
each. This is not a formality: it decides who you ask when you want your
data changed or removed.

**Principals** — executives, private individuals and family offices who hold
an account. For your own account details we are the **controller**: we decide
what is collected and why, and you come to us.

**Assistants** — PAs, EAs, Chiefs of Staff and household staff, who hold their
own account and are granted access to a principal's. For your own account
details we are again the controller.

**Everyone else in a principal's records** — the people they meet, the
contacts their assistant keeps, the household members they employ, and anyone
who books time through a public booking link. For that information we are a
**processor**: the principal decides what is kept and for how long, and we
hold it on their instructions.

If you are in the third group and want your information corrected or removed,
**ask the principal or their office first** — they control it, and they can act
immediately. We will help if they cannot be reached, and we will act ourselves
where the law requires it of us regardless. Our address is in §12.

## 3. What we collect

### 3.1 From people who hold an account

- **Identity and sign-in:** name, email address, a one-way hash of your
  password (never the password), your public booking handle, timezone, and
  whether you signed up as a principal or an assistant.
- **Sessions and devices:** for each active sign-in, the browser's
  user-agent string, the IP address most recently seen, when it was last
  used, and when it expires. This is what lets you see where you are signed in
  and end a session on a phone you no longer have.
- **Two-factor and recovery:** if you turn it on, a secret shared with your
  authenticator app, single-use recovery codes, and the security question and
  answer you set. The answer is stored hashed, not in the clear.

### 3.2 What is put into an account

Kairos exists to hold a working diary, so most of what it stores is entered by
a principal or their assistant:

- **The diary:** meetings, calls, flights, trains, cars, hotels, meals and
  personal entries — with times, places, destinations, booking references and
  notes.
- **Bookings:** who booked, their email, the meeting type, the format agreed,
  any notes they sent, and a record of what was proposed, countered, approved,
  declined, rescheduled or cancelled.
- **Contacts:** name, email, how well the principal knows them, birthdays and
  anniversaries, and the office's private notes about them.
- **Briefs, instructions and messages:** preparation notes, standing
  instructions to household staff, and messages between a principal and their
  team, including voice notes.
- **Trips and travel:** itineraries, travellers, and — where the relevant
  services are switched on — journey estimates and visa requirements.
- **Essentials:** identity and travel details, which may include passport
  numbers, policy numbers and similar. §4 covers how these are treated,
  because they are treated differently.
- **Household:** members of a principal's household staff, their job titles,
  the instructions given to them and their replies.
- **Work:** spaces, threads, projects, stages and tasks.

### 3.3 From people who book time

If you book through a principal's public link, we store the name, email
address and any notes you provide, the time you chose, and the format of the
meeting. You are given a link to manage that booking. **That link is the key
to it** — anyone holding it can view, reschedule or cancel the booking, so
treat it as private.

### 3.4 What we do not collect

We do not run analytics, advertising or third-party tracking scripts. There
are none in the application. We do not build profiles of you, we do not sell
data, and we do not use what is in an account to train machine-learning
models.

## 4. Identity documents and other sensitive details

Some of what Kairos holds is materially more sensitive than a lunch
appointment, and it is handled differently:

- **Sensitive fields are encrypted before they are written down**, with a key
  held by the running service and never stored in the database. A stolen copy
  of the database is, for these fields, unreadable text.
- **The same is true of voice notes**, which are additionally given an expiry
  and deleted after it.
- **Revealing a sensitive value is logged** — who looked, whose record, which
  field, and when. A principal can see that log. It is deliberately kept even
  after the underlying record is deleted, so the history of who saw what
  cannot be erased by deleting the thing they saw.
- **Reaching a sensitive value can require re-authentication**, separately from
  being signed in.
- **An assistant granted scheduling access does not thereby get identity
  documents.** Access to sensitive material is granted deliberately and
  separately.

If no encryption key is configured on a deployment, Kairos **refuses to store
sensitive fields at all** and says so, rather than storing them unprotected.

## 5. Why we hold it, and on what basis

| What | Why | Lawful basis |
|---|---|---|
| Account and sign-in details | To give you an account and keep it yours | Performance of a contract |
| Sessions, devices, IP addresses | To keep the account secure and let you end sessions | Legitimate interests (security) |
| Rate-limiting records | To resist password guessing and abuse | Legitimate interests (security) |
| Diary, contacts, briefs, tasks | To provide the service you are paying for or using | Performance of a contract |
| Essentials and identity details | Because a principal asked us to hold them | Consent, and the principal's instruction |
| Booking details | To arrange the meeting you asked for | Performance of a contract; legitimate interests |
| Service email (invites, confirmations, reminders) | To make the arrangement work | Performance of a contract |
| The access log | To keep an honest record of who saw sensitive material | Legal obligation and legitimate interests |

We do not send marketing email. If that changes, we will ask first, and it
will be a separate choice from using the product.

## 6. Who else touches it

Kairos runs on other people's infrastructure. These are our processors:

| Provider | What they do | What they see |
|---|---|---|
| **Render** | Hosting and the database | Everything stored, as the operator of the servers |
| **Resend** | Sends service email | Recipient addresses and the content of those emails |
| **Jitsi Meet (8x8)** at `meet.jit.si` | Video meetings | The call itself, on their infrastructure and under their privacy policy — we do not record or store it |
| **Maps provider** *(only if enabled)* | Journey time estimates | The start and end points of a journey |
| **Flight data provider** *(only if enabled)* | Live flight status | Flight numbers and dates |

Where the last two are not configured, Kairos says so in the interface rather
than pretending, and nothing is sent to them.

We do not sell personal data or share it with advertisers. We disclose it to
anyone else only where the law compels us, and we will tell the affected
account unless we are legally prevented.

## 7. How long we keep it

- **While the account is open**, its contents are kept until deleted from
  within the product. Diary entries, contacts and messages are yours to remove
  at any time.
- **Voice notes** are deleted automatically when they expire, whether or not
  anybody has listened to them.
- **Sessions** expire on their own, and end immediately when signed out.
- **When an account is closed**, we delete it and the records that belong to
  it. The product tells you what will be lost before you confirm. Deletion is
  permanent and there is no recovery path.
- **Backups** may hold a copy for a short period after deletion, and are
  overwritten in the ordinary cycle: [DECIDE — state the real backup
  retention once a paid database with backups is in place].
- **The access log** outlives the records it refers to, for the reason given
  in §4.

[DECIDE — a stated maximum, e.g. "we delete closed accounts entirely within
30 days". Pick a number you can actually meet, and then meet it.]

## 8. Where it is held

Kairos runs on Render's infrastructure in [DECIDE — the region your service
and database are actually deployed in]. If you are in the European Economic
Area or the United Kingdom and your data is processed outside it, that
transfer relies on Standard Contractual Clauses with the providers listed in
§6.

## 9. How it is protected

- Passwords are stored as one-way hashes; we cannot read them.
- Sensitive fields and voice notes are encrypted at rest with a key held
  outside the database (§4).
- The session cookie is `HttpOnly` and `SameSite=Lax`, so it cannot be read by
  scripts in the page, and is marked `Secure` when served over HTTPS.
- Sign-in, access codes, security questions and identity-document access are
  rate-limited against guessing.
- Two-factor authentication is available and is required for sensitive
  actions once enabled. Signing out other devices is protected by a security
  question rather than a code, because the code is often on the phone that
  went missing.
- Assistants get only the access a principal grants, and a principal can see
  and withdraw it.

No system is perfectly secure, and we do not claim otherwise. If a breach
affects you we will tell you and the relevant regulator as the law requires.

## 10. Cookies

One cookie: `kairos_session`, which keeps you signed in. It is essential to
the service and there is no way to use an account without it. We set no
analytics, advertising or tracking cookies.

The application also uses your browser's local storage for small conveniences
— which calendar length you last chose, which alerts you have already seen.
That never leaves your device.

## 11. Your rights

Under the Nigeria Data Protection Act and, where it applies to you, the UK and
EU GDPR, you may ask us to:

- give you a copy of what we hold about you;
- correct it if it is wrong;
- delete it;
- restrict or object to how we use it;
- provide it in a portable form;
- withdraw consent, where consent is the basis we relied on.

We answer within 30 days. There is no charge unless a request is repetitive or
excessive, and we will say so before charging rather than after.

**If your information is in a principal's records** — as a contact, a booker,
a household member — see §2: ask the principal's office first, as they control
it and can act faster than we can.

You may also complain to the **Nigeria Data Protection Commission**, or to
your local supervisory authority if you are in the UK or EEA. We would rather
you came to us first, but that is your choice, not a condition.

## 12. Contacting us

[DECIDE — a monitored address, e.g. privacy@<your domain>]
Exousia Prime Emporium Ltd, [DECIDE — registered address], Lagos, Nigeria.

[DECIDE — whether a Data Protection Officer is designated and named here.
Given that Kairos holds identity documents as a core function, take advice on
whether the NDPR requires one.]

## 13. Children

Kairos is not for children and we do not knowingly hold data about anyone
under 18 as an account holder. A principal's records may name family members,
including children, where the principal has chosen to record them; that is
their decision and their responsibility as controller.

## 14. Changes

When we change this policy we will update the date at the top and, where the
change materially affects you, tell account holders in the product before it
takes effect. We will not quietly widen what we do with your data and rely on
you not re-reading the page.
