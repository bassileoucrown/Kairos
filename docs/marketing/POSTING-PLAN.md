# Kairos by Exousia — four weeks of posts

Sixteen images, four a week, built to be posted in order. Each one stands on
its own for somebody who scrolls past a single post, but read in sequence they
build an argument: what it is → who runs it → how it works → why it matters.

All images are **1080 × 1350 (4:5)** rendered at 2× — the tallest a feed shows
without cropping, and sharp on a phone.

## What is deliberately not in them

No passports, no encryption, no second factor, no reveal trail, no custody.
That is the owner's instruction while the product is not ready to be asked
about those in public. It is also the right call for a first month: these have
to be understood by somebody who has never heard the name, and a security
claim is not the first thing that makes sense to a stranger.

Nothing here claims revenue, customers, or a launch date.

## Suggested cadence

Monday, Tuesday, Thursday, Saturday. Move anything; the order matters more
than the days. Post 16 asks for a reply, so put it where you can answer.

---

## Week 1 — What it is

**01 · One diary. Two people.** *(start here)*
> Most calendars are built for whoever is doing the booking.
> Kairos by Exousia is built for the person whose time is being spent — and
> the person who protects it.
> New from Exousia, in Lagos.

**02 · Open it once. Know the whole day.**
> Your day, in order, with what is happening now at the top — and when to
> leave, not only when to arrive.
> What would you want on this screen?

**03 · A desk of your own.**
> If you run someone's diary, you know the problem: you do the work, and the
> tool gives you a corner of somebody else's calendar.
> Kairos gives you a desk.

**04 · How a meeting reaches the diary.**
> Someone asks. The desk decides. It lands on the day.
> No inbox archaeology, no double-booking, no "did you see my message?"

## Week 2 — For the people who run the diary

**05 · Not everyone who finds your link should get your Tuesday.**
> A stranger and a board member should not be treated the same way.
> Some meetings confirm themselves. Some become a request your assistant
> answers.

**06 · Everything waiting on you, in one place.**
> PAs, EAs, Chiefs of Staff: how many places do you currently have to check
> before you know what needs an answer today?

**07 · You run three diaries. You should not need three logins.**
> Built for a Chief of Staff, not only for a PA.
> One desk, every principal you look after.

**08 · Late is usually a travel problem, not a diary problem.**
> Kairos reads the road at the hour you actually leave — not a number somebody
> typed in once and never changed.
> Anyone who drives in Lagos knows why this matters.

## Week 3 — The day itself

**09 · Two screens. The same diary.**
> The principal reads their day. The assistant runs it.
> Same diary, two very different jobs.

**10 · It drafts. You send.**
> Kairos will write the reply, catch you up on what you missed, and read the
> week ahead.
> It never sends anything as you. That is not a setting — it is how it is
> built.

**11 · A trip is more than a flight time.**
> Where you are going, who is driving, what time the car leaves, and who to
> call at the other end — held together as one thing.

**12 · Built for how work actually happens in Lagos.**
> Not a Silicon Valley calendar with a Nigerian flag on it.
> Works when the network is poor. Reads well on a phone. Written in the
> English an office here actually uses.

## Week 4 — Why it exists

**13 · Your assistant runs your diary. Not the rest of your life.**
> The short version.

**14 · Who decides what goes into your week?**
> For most busy people the honest answer is: whoever asked most recently.
> Kairos is for people who would rather it were a decision.

**15 · The principal is not the only user.**
> Every scheduling tool is built for the person doing the booking.
> We built the other side.

**16 · We are letting a few offices in.** *(call to action)*
> If you run a principal's diary — or somebody runs yours — we would like you
> to try it and tell us where it is wrong.
> Comment or send a message and we will get you in.

---

## Rebuilding these

```
node docs/marketing/series.js docs/marketing/out
```

Edit the `POSTS` array in `series.js` — palette, frame and wordmark are defined
once at the top, so a brand change is one edit and one re-run.

The renderer **fails the run if any post overflows its canvas.** The canvas is
a fixed pixel size, so content past it is cropped silently and the image still
looks finished — the first infographic lost its entire footer that way and
looked perfectly fine until it was measured.

## Also in this folder

- `intro-4x5.png` — the fuller introduction with both device diagrams
- `infographic-4x5.png` / `infographic-1x1.png` — the detailed version. **These
  two do mention custody and encryption**, so they are for a deck, a DM to
  someone who has asked a real question, or a website — not the feed, until
  you decide those claims are ready to be public.

## Notes before posting

- The screens in these are **illustrations, not screenshots**. They are
  faithful to the real layout, but drawn. If someone asks for a live demo,
  that is a conversation, not an image.
- The fonts are baked into the PNGs, so they look identical everywhere. If
  Exousia licenses a brand typeface, change `--serif` / `--sans` at the top of
  `series.js` and re-run.
- There is no logo mark — the wordmark is set in type. Send one and it can go
  in the header.
