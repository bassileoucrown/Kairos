# Kairos by Exousia — the daily posts

Fourteen images, one a day, each one a **real screenshot of the running app**
inside a phone. This replaces the drawn-phone approach of the first series:
same argument, better evidence.

All images are **1080 × 1350 (4:5)** rendered at 2× — the tallest a feed shows
without cropping, and sharp on a phone.

Captions to post with each image are in `captions.json`, and shown beside the
image in `daily-contact-sheet.html`. Open that file to review the set; it is
self-contained and fetches nothing.

## How they are made

Two steps, in this order. Both fail loudly rather than producing something
that merely looks finished.

```
node docs/marketing/screens.js   docs/marketing/shots     # photograph the app
node docs/marketing/phones.js    docs/marketing/daily     # build the posts
node docs/marketing/sheet.js     docs/marketing/daily     # the contact sheet
```

`screens.js` starts a real server on a scratch database, signs up a principal,
pairs an assistant with an access code, hires a driver and a chef, seeds a
day, and photographs fourteen screens at a phone viewport. It asserts a
selector and a text floor per screen, because **a screen that failed to load
renders as a tidy empty state and photographs beautifully**.

`phones.js` puts each screenshot behind glass and sets the words. It measures
the rendered phone — its height, its position, how much screenshot is actually
showing — rather than the document. The first version checked `scrollHeight`
and element overlap, and **both of those checks were incapable of failing**:
they passed on fourteen posts that were blank paper with fourteen pixels of
bezel at the bottom.

Re-run `screens.js` whenever a screen changes. The posts are then one command
behind.

## The order, and why

Daily. The sequence builds an argument for somebody who sees all of them, and
each one still stands alone for somebody who sees one.

| Day | File | What it argues |
|-----|------|----------------|
| 1 | `01-today` | What the product is, from the principal's side |
| 2 | `02-workspace` | Who else it is for — and that they get a desk, not a corner |
| 3 | `03-household` | The house is in it too, and confirmation is the point |
| 4 | `04-instructions` | What the house *cannot* see. The privacy claim, shown |
| 5 | `05-booking` | How a meeting reaches the diary at all |
| 6 | `06-itinerary` | It goes further out than today |
| 7 | `07-desk` | One place for everything waiting |
| 8 | `08-pad` | The small thing, captured |
| 9 | `09-movements` | Cars, drivers, papers that lapse |
| 10 | `10-trips` | A trip is more than a flight |
| 11 | `11-team` | You decide who gets in, and for how long |
| 12 | `12-spaces` | Conversation kept with its subject |
| 13 | `13-report` | The week, for the person who was not in it |
| 14 | `14-coming` | What we have not switched on. Honesty as the closer |

Days 2, 3, 4 and 7 are about somebody who is not the principal. That is on
purpose: **Kairos is not a two-sided tool**. A principal may have several
assistants across three roles, a separate household population with its own
job titles, and a family — four audiences, four screens, and the product's
actual distinction is that it keeps them apart.

Move any of them. The order matters more than the days.

## What is deliberately not in them

No passports, no encryption, no second factor, no reveal trail, no custody, no
vault. That is the standing instruction while the product is not ready to be
asked about those in public, and it is the right call for a first month
anyway: these have to make sense to somebody who has never heard the name, and
a security claim is not the first thing that does.

Day 4 comes closest, and it stays on the right side of the line — it shows
what a driver's screen contains, which is a fact about the product, rather
than making a claim about how the vault is protected.

Nothing claims revenue, customers, or a launch date.

## Two things to check before posting

**The seeded names are fictional.** Adaeze Okonkwo, Tunde Bakare, Femi Okon,
Chidi Nwosu, Mrs Bello. No real person, no real number, no real address.

**Day 14 dates itself.** `14-coming` photographs the Coming screen, which
lists what is switched off on the deployment it was captured from. Re-run
`screens.js` before posting it if anything has been turned on since, or the
post argues honesty while showing something out of date.
