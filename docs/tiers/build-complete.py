#!/usr/bin/env python3
"""Complete Kairos Tiers and Pricing.

The 19 August tier sheet is the pivot: its six tiers, its Naira pricing, its
security rule and its arguments are kept. Everything built since is folded into
the tier it belongs to, and a second way in — the assistant whose principal is
not on Kairos — is added as its own lane.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mkdocx import para, table, build

S = os.path.dirname(os.path.abspath(__file__))
NEW = '  [new since 19 Aug]'
SOON = '  [before launch]'
KEY = '  [built · needs a key]'
DESK = '  [needs a desk]'
WIRE = '  [not wired yet]'
BUILD = '  [to build]'
DONE = '  [built since]'


def bullets(items):
    return [para('•  ' + t, style='ListParagraph') for t in items]


def price(seats, monthly, dollars, yearly):
    return table([([('Who it carries', 1), ('Per month', 1), ('Per year', 1)],
                   {'shade': 'E8E8E8', 'bold': True, 'header': True, 'center': (1, 2)}),
                  ([seats, f'{monthly}  ({dollars})', yearly], {'center': (1, 2)})],
                 [4400, 2800, 2438])


b = []
b.append(para('Complete Kairos Tiers and Pricing', style='Title'))
b.append(para('Kairos by Exousia — Exousia Prime Emporium Ltd, Lagos   ·   3 September 2026   '
              '·   The 19 August tier sheet, brought up to date', style='Sub'))

b.append(table([([('**What this is.** The tier sheet of 19 August is the pivot: its six tiers, '
                   'its Naira pricing, its one rule about security and its arguments are kept as '
                   'they were. Everything built since — movements, correspondence, minutes, '
                   'recording, the pad, catch-up, the archive, the week ahead and the rest — is '
                   'folded into the tier it belongs to and marked *new since 19 Aug*. A second '
                   'way in has been added: the assistant whose principal is not on Kairos at '
                   'all.\n\n'
                   '**Nothing is enforced today.** Every check runs and records what it would '
                   'have refused, then lets the request through. This is a proposal about where '
                   'the lines belong, not a description of what the app currently stops anybody '
                   'doing.', 1)], {'shade': 'FFF8DC'})], [9638]))

# ── The rule ───────────────────────────────────────────────────────────────
b.append(para('One rule first: security is not a tier', style='Heading1'))
b.append(para('Every safety property in Kairos is present at every tier, including Free. That is '
              'a product decision, not an oversight, and it is worth saying out loud in the '
              'market Exousia sells into.'))
b += bullets([
    'Encryption at rest for anything sensitive, with the key held outside the database.',
    'Two-factor authentication, recovery codes, and the choice of where the code is demanded.',
    'A second factor on the vault, so a stolen password reaches a calendar and no further.',
    'Structural separation — a scheduling delegate cannot see a BVN, at any price.',
    'Honest failure: a thing you cannot see is absent, not refused.',
    'Signing another device out carries a security question set at onboarding, not a code.' + NEW,
    'Duress, arrival alarms and driver papers running out are never gated.' + NEW,
    'Reading back anything already stored is never gated — dropping a tier never locks your own records.' + NEW,
    'Taking your records out is never gated.' + NEW,
])
b.append(para('A company holding passports and BVNs cannot sell the lock separately from the '
              'box. What scales across tiers is **how many people, how many principals, and how '
              'much surface** — never how well the account is defended.'))
b.append(para('The trap inside the safety rule', style='Heading2'))
b.append(para('An arrival alarm only exists for a journey that exists. Gating *create a journey* '
              'would silence a panic button while the sheet still read as though only a paid '
              'convenience were involved. So the **fleet** is charged for — cars, drivers, '
              'standing weekly runs — and the **journey** never is. Recording where somebody '
              'went, and being warned when nobody confirmed they arrived, works on Free.' + NEW))

# ── Two ways in ────────────────────────────────────────────────────────────
b.append(para('Two ways in', style='Heading1'))
b.append(para('The August sheet assumed the principal buys and invites their assistant. That is '
              'the right assumption for most of the market and it is unchanged. But a large part '
              'of the actual buying population is the assistant, and plenty of them work for '
              'somebody who will never open an app. Charging per principal makes that person '
              'unreachable, which is a packaging problem rather than a product one.'))
b.append(table([
    ([('', 1), ('Principal-led', 1), ('Assistant-led — the Desk', 1)],
     {'shade': 'E8E8E8', 'bold': True, 'header': True}),
    (['Who pays', 'The principal.', 'The assistant.'], {}),
    (['Who is on the app', 'Principal and assistants.', 'The assistant. The principal need never sign in.'], {}),
    (['Priced by', 'One principal, N assistant seats.', 'One assistant, N principals kept.'], {}),
    (['Tiers', 'Free, Standard, Plus, Executive, Family Office, Enterprise.',
      'Desk Standard, Desk Plus, Desk Chambers.'], {}),
    (['When it converts', '—', 'The principal joins on their own terms, with their own address, '
      'and appoints the assistant by handle. Work crosses when the assistant moves it, item by '
      'item. The desk stops paying for that principal; nobody is charged twice.'], {}),
], [1700, 3800, 4138]))

# ── The tiers ──────────────────────────────────────────────────────────────
b.append(para('Tier 1 — Free', style='Heading1'))
b.append(para('A professional with no assistant, or somebody trying Kairos before trusting it '
              'with anything.', style='Note'))
b.append(price('1 person · no assistants', '₦0', '$0', 'free — no card, no expiry, no trial clock'))
b += bullets([
    '**A page people can book** at your handle, with your own meeting types — two of them at this tier.',
    '**Weekly availability**, including several blocks in one day, so a real morning-and-afternoon pattern fits.',
    '**Availability by length, with a cap per block**, so a thirty-minute slot and a two-hour one are not the same decision.' + NEW,
    '**How far ahead the diary is open**, as a decision that binds the diary.' + NEW,
    '**A breather after every appointment**, so the day is not booked wall to wall.' + NEW,
    '**Timezone handling that is actually correct** at both ends: the visitor picks their zone, sees your times in it, and yours is shown alongside.',
    '**The visitor reschedules or cancels themselves**, without going through you.',
    '**The booker says how they would like to meet**, and the office answers.' + NEW,
    '**Request and counter** — a time can be proposed back rather than refused.' + NEW,
    '**Accept or withdraw from the booker’s side**, without an account.' + NEW,
    '**Calendar view** of everything booked, colour-coded by meeting type.',
    '**Video rooms** generated for video meeting types.',
    '**Today and your own itinerary** — flights, cars, dinners, not just bookings.',
    '**Today as the day’s shape**, with the now line, the gaps and what is already done.' + NEW,
    '**Correcting an entry in place**, rather than deleting it and typing it again.' + NEW,
    '**Running late on your own day**, said once, with the rest of the day moving behind it.' + NEW,
    '**Nearly up, and over** — warned in-app while a meeting is still running.' + NEW,
    '**Recording a journey, arrival alarms and the duress signal** — safety, never gated.' + NEW,
    '**The driver’s card**, which names nobody.' + NEW,
    '**A handle you choose yourself**, from an empty box — nothing is derived from your name and nothing is filled in for you. It is yours for good, so nobody is handed one.' + NEW,
    '**Every feature says what it does and how to use it**, on itself, folded away once you have read it.' + NEW,
    '**Two-factor authentication and recovery codes.**',
    '**Email confirmations** to both sides, recorded either way.',
])
b.append(para('Not here: an assistant, the identity vault, spaces, trips. Free is a working '
              'scheduling page, not a crippled version of the real product.'))

b.append(para('Tier 2 — Standard', style='Heading1'))
b.append(para('One principal with one person helping them, and documents worth keeping properly.',
              style='Note'))
b.append(price('1 principal · 1 assistant', '₦8,000', '≈ $5', '₦80,000 — two months free'))
b.append(para('Everything in Free, plus', style='Note'))
b += bullets([
    '**Unlimited meeting types**, and the **four access tiers** — a stranger and a board member are not routed the same way.',
    '**An approval queue**: Tier 3 and 4 requests hold the slot and wait for a yes.',
    '**One assistant seat** — PA, EA, Chief of Staff, or a scheduling-only Delegate.',
    '**Bring them on without email**: you choose a pairing code, say it down the phone, and it expires.',
    '**Contact intelligence** — notes, relationship tier, and history derived from real bookings.',
    '**The relationship calendar**: birthdays and anniversaries surfaced before they pass.',
    '**Tasks and reminders that arrive before a deadline**, with the lead time set by how costly missing it is.',
    '**The direct line** — a private channel to your assistant that is not your personal number.' + WIRE,
    '**The essentials vault**: passport, NIN, BVN, licences, medical, insurance — encrypted, and revealed only against a second factor.',
    '**Per-field sensitivity**, so a scheduling delegate genuinely cannot see the sensitive ones.',
    '**Attaching the scan itself**, not only the number.' + SOON,
    '**The pad** — quick lines, and rewording one rather than binning it and retyping.' + NEW,
    '**Trips as your own**, with personal trips kept off the office entirely unless you say otherwise.' + NEW,
    '**Vehicles, drivers and standing weekly runs** — the fleet.' + NEW,
    '**Being unavailable** for hours, a day, a week, or longer.' + NEW,
    '**When you are at your best**, suggested from how the days actually run.' + NEW,
    '**What needs you**, gathered into one place rather than hunted for.' + NEW,
    '**The week ahead**, including what has had no attention.' + NEW,
    '**While you were away** — what happened, gathered rather than scrolled back through.' + NEW,
    '**Reports for any dates you like**, called for on demand rather than waiting for the week.' + NEW,
    '**Your own weekly report**, as a document you can send to a lawyer or an accountant.' + NEW + WIRE,
    '**Two-way calendar sync** with Google and Outlook.' + SOON,
    '**WhatsApp confirmations and reminders**, on the channel this market actually reads.' + SOON,
    '**Whether a visa is required**, checked before the trip rather than at the desk.' + SOON,
    '**Forward a confirmation** and the journey builds itself.' + SOON,
])
b.append(para('This is where the product stops being a booking page. The vault is the reason to '
              'pay at all — a free calendar link exists everywhere; custody of a BVN does not. '
              'Calendar sync sits here rather than higher because a diary that does not read '
              'your existing Outlook will double-book you, and that breaks the core promise of '
              'the first paid tier.'))

b.append(para('Tier 3 — Plus', style='Heading1'))
b.append(para('A principal who travels, runs projects, and has an office diary and a private one '
              'kept by two different people.', style='Note'))
b.append(price('1 principal · 2 assistants + 5 household staff', '₦15,000', '≈ $9',
               '₦150,000 — two months free'))
b.append(para('Everything in Standard, plus', style='Note'))
b += bullets([
    '**Spaces** — Work, Personal, Private — where Private cannot be shared even by a future bug, because nothing in the code can attach a member to it.',
    '**The two registers**: the formal record is produced *by* the informal conversation instead of written separately from it.',
    '**Projects and stages**, where a stage’s status is driven by records rather than by a dropdown anyone can set to green.',
    '**Records** — decisions, blockers and sign-offs, kept as such.' + NEW,
    '**Something open that nobody answered**, flagged in the report and clickable straight through to it.' + NEW,
    '**Mentions** — being named, and knowing you were.' + NEW,
    '**Archiving or deleting a task, project or thread**, with the record kept either way.' + NEW,
    '**Trips as real objects** — a confirmed trip redraws your whole day in the destination’s timezone.',
    '**The journey builder**: the flight, the car to the airport, the hotel check-out, the transfer at the far end, all from one form.',
    '**Ground handling that admits you are away from home**, and refuses to save without somebody callable at 2am.',
    '**Travellers, local contacts and document expiry checked against the trip’s own dates.**',
    '**Your visas checked against each trip** — including the one people miss: valid on the way out and not on the way back.',
    '**Airport pickup without a name board**: a per-trip phrase, a driver’s card carrying no surname, and a rotating signal both phones show at once.',
    '**Watching a journey while it happens**, and the alarm when nobody confirms an arrival.' + NEW,
    '**Cars filed under the trip they belong to** — a journey leaving during a trip offers to go under it, and the trip shows what is getting them there and around. Private trips are never proposed, only ever chosen.' + NEW,
    '**Correspondence handled for you** — an assistant working the principal’s mail.' + NEW,
    '**Private by default, with a per-thread override** — nothing is visible to an assistant unless it is opened to them, one conversation at a time.' + NEW,
    '**Triage, categorise and prioritise**, so what reaches the principal is what needs them.' + NEW,
    '**Minutes of meetings**, filed against the meeting they belong to.' + NEW,
    '**The access log in the report** — who looked at what.' + NEW,
    '**Household staff with their own accounts** — the driver, the cook, the house manager — reading only the standing instructions that concern them.',
    '**Travel time with live traffic** — the drive asked of the road at the hour it happens.' + KEY,
    '**Recording a meeting and transcribing it**, with everyone told, the audio encrypted before it leaves the server and deleted on a clock.' + KEY,
    '**Voice notes** on the direct line, encrypted, gone after 30 days, and markable done without a word being written.' + WIRE,
    '**The archive** — everything put away, still findable.' + NEW + WIRE,
    '**Reports across the office**, individually or for the whole team.' + NEW + WIRE,
    '**AI Assist** — describe a meeting in plain language and get real open slots, draft messages, and dictate instead of typing.' + KEY,
    '**A contents page for Assist**, listing every ask and the screen it lives on, built from the register rather than a typed list — because the asks sit where the work is, which is the right place to use them and the worst place to find them.' + NEW,
])

b.append(para('Tier 4 — Executive', style='Heading1'))
b.append(para('A principal with an actual office: a Chief of Staff, household staff, and a diary '
              'other offices negotiate with.', style='Note'))
b.append(price('1 principal · unlimited assistants and staff', '₦25,000', '≈ $15',
               '₦250,000 — two months free'))
b.append(para('Everything in Plus, plus', style='Note'))
b += bullets([
    '**Unlimited assistant seats and unlimited household staff.**',
    '**The instructions vault staff actually read** — standing orders for the driver, the cook, the house manager.',
    '**Connections**: your assistants deal with other principals’ assistants directly, without either principal in the thread.',
    '**Finding somebody by handle** even when they are not yet in your network, so long as they are on Kairos.' + NEW,
    '**Running late across other people’s diaries** — one delay replans everything downstream and tells whoever else is affected.' + NEW,
    '**Brief builder** with pre-fill from real contact history: who they are, what happened last time, what matters.',
    '**Broadcast notices** to your whole team, one direction, no reply thread.',
    '**Documents held for other people** — a spouse’s passport, a child’s yellow fever card — under the same custody rules as your own.' + WIRE,
    '**Full custody controls**: where the second factor is demanded, how long a step-up lasts, and a log of every reveal.',
    '**Live flight status driving the delay cascade automatically.**' + KEY,
    '**Unlimited document storage**, including documents held for other people.' + SOON,
    '**Notices to the whole office over WhatsApp**, one direction, no reply thread.' + SOON,
    '**Priority support.**',
    '**The concierge desk**, included when it opens.' + DESK,
])

b.append(para('Tier 5 — Family Office', style='Heading1'))
b.append(para('Several principals under one roof, sharing staff, needing to stay separate from '
              'each other.', style='Note'))
b.append(price('Many principals · shared staff pool', '₦120,000', '≈ $75',
               '₦1,200,000 — two months free'))
b += bullets([
    '**Multiple principals on one account**, with a shared staff pool and one switcher, so a Chief of Staff running three family members never has to guess whose day they are editing.' + WIRE,
    '**Isolation between principals is structural, not a permission flag** — the same property that makes a Private space unshareable applies between family members.',
    '**Consolidated approvals, tasks and travel** across every principal in the office.',
    '**Your own database schema**, so the family’s rows are not in a shared table with anybody else’s.',
    '**Optional dedicated deployment, and an encryption key you hold** rather than one we hold for you.',
    '**Audit export and retention policy** you set.',
    '**Staff onboarding and training**, because the constraint at this size is people, not software.',
    '**A named concierge desk.**' + DESK,
])

b.append(para('Tier 6 — Enterprise', style='Heading1'))
b.append(para('Many principals across an organisation.', style='Note'))
b.append(price('Many principals across an organisation', 'Custom', 'quoted',
               'annual contract, invoiced, PO accepted'))
b += bullets([
    '**Single sign-on and directory sync**, so an executive who joins or leaves is provisioned and de-provisioned with everyone else rather than by hand.' + WIRE,
    '**An admin console** — seats, roles and principals managed centrally, in bulk, by somebody who is not any of those principals’ assistant.',
    '**Your own deployment**, in your own cloud account or on your own hardware, with the encryption key held by your security team and not by Exousia.',
    '**A signed data processing agreement, an NDPR pack, and answers to your security questionnaire.**',
    '**Connectors** into whatever the institution already runs.' + KEY,
    '**Optional white-label**, where the executive floor sees the institution’s name rather than ours.',
])

# ── The Desk ───────────────────────────────────────────────────────────────
b.append(para('The Desk — for an assistant whose principal is not on Kairos', style='Heading1'))
b.append(para('A PA, EA or Chief of Staff does the same work whether or not their principal ever '
              'signs in. They keep the diary, build the trips, hold the papers, brief before '
              'meetings, chase what is owed and write the minutes. Today all of that hangs off a '
              'principal who must have an account, which makes the most motivated buyer in the '
              'market the one person who cannot buy.'))
b.append(para('The Desk inverts the seat maths: the assistant subscribes, and a principal is a '
              'record they keep rather than a person who logs in.'))
b.append(table([
    ([('Desk tier', 1), ('Who it carries', 1), ('Per month', 1), ('Per year', 1)],
     {'shade': 'E8E8E8', 'bold': True, 'header': True, 'center': (2, 3)}),
    (['Desk Standard', '1 assistant · 1 principal kept', '₦8,000  (≈ $5)', '₦80,000'], {'center': (2, 3)}),
    (['Desk Plus', '1 assistant · up to 3 principals kept', '₦15,000  (≈ $9)', '₦150,000'], {'center': (2, 3)}),
    (['Desk Chambers', 'several assistants sharing a pool of principals', '₦25,000  (≈ $15)', '₦250,000'], {'center': (2, 3)}),
    (['Extra principal', 'beyond what the tier carries', '₦4,000  (≈ $2.50)', '—'], {'center': (2, 3)}),
], [2000, 3600, 2100, 1938]))
b.append(para('Feature for feature, a Desk tier carries what the matching principal-led tier '
              'carries. The difference is only who is counted, and what the principal’s absence '
              'genuinely makes impossible.'))

b.append(para('What works with no principal on the app', style='Heading2'))
b += bullets([
    'The diary and the day sheet, kept on the principal’s behalf.',
    'The booking page, run at the principal’s handle by the assistant.',
    'Trips, the journey builder, visas, ground handling and airport pickup.',
    'Movements — the fleet, journeys, arrival alarms, the duress signal, driver papers.',
    'Tasks, the pad, contacts, the relationship calendar.',
    'Minutes, reports, the access log, the week ahead.',
    'Household staff and the instructions they read.',
    'Spaces and projects, as the assistant’s own workroom.',
])
b.append(para('What does not, and why', style='Heading2'))
b += bullets([
    '**The approval queue.** There is nobody to approve. So a Desk records at setup whether the assistant decides alone or holds requests in a list the principal is told about by other means.',
    '**The direct line.** It is a line *to* the principal. It has no far end until they join.',
    '**Drafts for approval.** The standing rule is that AI never sends and never pretends, and that an assistant who is not delegated sends drafts to the principal. With no principal account there is nobody to approve, so sending must be **explicitly delegated in writing at setup** or the desk drafts only.',
    '**Consent-gated recording.** A meeting is recorded only with everyone told. That consent cannot be given by an absent principal on their own behalf.',
    '**Personal trips.** The choice of who knows the principal’s whereabouts is theirs, so on a held record it defaults closed.',
])
b.append(para('The vault, and the one honest caveat', style='Heading2'))
b.append(table([([('**Decided, and built.** Essentials do not open on a held record. With no '
                   'principal on the app there is no second factor of theirs to stand behind '
                   'the documents, and they would rest on the assistant’s — which is not the '
                   'promise this sheet makes everywhere else. So nothing is kept there to be '
                   'weaker about. When the principal joins and sets a second factor of their '
                   'own, they keep their papers in their own account.', 1)],
                {'shade': 'FFF8DC'})], [9638]))
b.append(para('Joining, and not being charged twice', style='Heading2'))
b.append(para('A principal joins when they choose, on their own terms and with their own '
              'address. Nothing about the held record obliges them and they are never told it '
              'exists. They appoint the assistant the ordinary way, by handle, approving it '
              'themselves — the flow that already existed. From that point the work happens in '
              'their account.' + DONE))
b.append(para('**Joining is not a merge.** What came before does not follow them on its own: a '
              'held record is the assistant’s working record, and tipping a month of it onto '
              'somebody’s first screen would be both a shock and a disclosure. Things cross one '
              'at a time, to a principal the assistant actively works for, because somebody '
              'chose to move them.' + DONE))
b.append(para('From that month the desk no longer pays for that principal — they are on their '
              'own plan and the assistant occupies a seat in it. The assistant is never '
              'penalised for bringing the principal on, which is the only way this lane feeds '
              'the main one rather than competing with it.'))

b.append(para('If only the assistant is on the app, how it has to be shaped', style='Heading2'))
b.append(para('The tiers say what a Desk may reach. This says how the product has to be '
              'arranged for one to work, which is a different question and the one that '
              'decides whether the lane is any good.'))
b.append(para('1. It holds nothing worth taking', style='Heading3'))
b.append(para('An earlier design required the principal’s email as the route back to them, '
              'so the record was held in escrow rather than owned. It was dropped, and the '
              'reason is stronger than friction: an assistant typing their employer’s contact '
              'details into a company that person has never agreed to deal with is disclosing '
              'somebody else’s data at the very first step. For a product that holds '
              'passports, that is the wrong thing to ask on the first screen.' + DONE))
b.append(para('What replaces it is that a held record carries nothing that would hurt to lose. '
              '**Essentials do not open on one at all.** Everywhere else in Kairos documents sit '
              'behind the principal’s own second factor; a held record has no principal on the '
              'app, so they would rest on the assistant’s instead — a materially weaker thing, '
              'and selling it as the same thing is how a custody product loses its only '
              'argument. The vault says so rather than appearing empty.' + DONE))
b.append(para('**The cost, stated plainly.** With no address on file there is no route back to '
              'the principal at all. An assistant who leaves before their principal ever joins '
              'takes that record with them and nobody can reclaim it. The shut vault is what '
              'makes that survivable rather than serious, and it is the reason essentials must '
              'never be opened on a held record later without restoring a route back at the '
              'same time.'))

b.append(para('2. The landing surface inverts', style='Heading3'))
b.append(para('A principal-led account opens on their day. An assistant-led one has to open on '
              'the assistant\u2019s own worklist — across every principal at once: what needs a '
              'decision, what is being waited on, what is slipping. **Built.** The switcher now '
              'names what is waiting against each principal, so the question is answered without '
              'switching — and switching is not free, since it re-scopes every screen, which '
              'meant the act of checking moved you off what you were doing. It helps an '
              'assistant on an ordinary principal-led account today, with no Desk in sight.' + NEW))
b.append(para('3. A standing brief replaces the approval loop', style='Heading3'))
b.append(para('With nobody to approve, the queue needs a different engine, in two parts. A '
              '**standing brief** the assistant records once — who gets through, what is '
              'declined, what always warrants a call first — so routine decisions resolve by '
              'rule, which is how a good assistant already works. And a **hold list** for '
              'everything else, sent out of band as a daily digest the principal answers however '
              'they normally answer, with the decision marked back. The assistant is then '
              'carrying a decision made elsewhere rather than inventing consent.' + BUILD))
b.append(para('4. The deliverable is a document, because nobody logs in', style='Heading3'))
b.append(para('In principal-led, the app is the output. Here the output is what the assistant '
              'hands over: the day sheet, the week ahead, the brief before a meeting, the minute '
              'after it. That makes the two report features currently unwired — your own weekly '
              'report, and reports across the office — matter considerably more in this lane '
              'than in the main one, and they are the first thing to wire.' + WIRE))
b.append(para('5. The kept principal needs an identity without an account', style='Heading3'))
b.append(para('Handle, booking page, slug and timezone all live on the user row today. A '
              'principal who is not a user still needs a bookable page at their own handle, and '
              'their diary still has to be read in their timezone rather than the '
              'assistant\u2019s. This is the bulk of the work and the reason the lane is not a '
              'switch.' + BUILD))

b.append(para('What has to be built first', style='Heading2'))
b += bullets([
    'A principal that is not a user. Done differently, and far more cheaply, than the plan above supposed: a kept principal IS a users row with a password nothing can match, so every owner-scoped query in fifty route modules works on it unchanged.' + DONE,
    'A way for the principal to arrive. Done, and deliberately not a claim: they join on their own terms and appoint the assistant by handle, which is a flow that already existed.' + DONE,
    'The vault shut on a held record, so what cannot be protected properly is simply not kept there.' + DONE,
    'Handing work across one item at a time, and only to a principal the assistant actually works for.' + DONE,
    'A way in from a screen. Onboarding now offers "They are not on Kairos" and drops the assistant straight into the switcher with that principal selected.' + DONE,
    'Desk-scoped billing, and the fold-in when a kept principal subscribes.' + BUILD,
    'A setup-time record of what the desk may decide alone — approvals and sending — captured in writing rather than assumed.' + BUILD,
])

# ── Money ──────────────────────────────────────────────────────────────────
b.append(para('What the Desk changed about the tiers', style='Heading1'))
b.append(para('Building it moved three things, and one of them was a mistake worth naming.'))
b.append(table([
    ([('What', 1), ('Change', 1)], {'shade': 'E8E8E8', 'bold': True, 'header': True}),
    (['Taking on a principal who is not on Kairos',
      'Its own line on **Standard**, not part of "bringing on an assistant". Those look alike '
      'and are opposites: one is a principal paying to add people to their office, the other '
      'is a single assistant paying to do their job alone. It was first gated as the former, '
      'which put it on Plus — and would have made the assistant-led lane cost twice what it '
      'is meant to, out of reach of exactly the buyer it exists for.'], {}),
    (['The Desk lane', 'Three of its five build items are done. It is no longer a proposal '
      'resting on unbuilt foundations; what remains is billing and the written delegation.'], {}),
    (['A principal joining', 'Not a claim at all. They sign up normally, with an address nobody '
      'else supplied, and are connected by handle — the flow that already existed for principals '
      'who are on Kairos. Work crosses afterwards, item by item.'], {}),
], [3000, 6638]))
b.append(para('What has NOT changed', style='Heading2'))
b.append(para('Every feature placement above stands. The Desk does not move anything between '
              'rungs — it adds a second way to arrive at them, priced by how many principals an '
              'assistant keeps rather than how many assistants a principal has. A Desk tier '
              'carries what its matching rung carries, minus only what genuinely cannot work '
              'without a principal to act.'))

b.append(para('Added since 1 September', style='Heading1'))
b.append(para('Four things built after the last edition. None of them moves a feature between '
              'rungs; three land where the thing they touch already sat, and one reaches every '
              'tier because it is part of arriving at all.'))
b.append(table([
    ([('What', 1), ('Where it lands', 1)], {'shade': 'E8E8E8', 'bold': True, 'header': True}),
    (['Choosing your own handle',
      '**Free**, and therefore everywhere. Signing up used to take a handle out of your name — '
      '@adaeze-okonkwo — and write it into the permanent record of who has held what. A handle '
      'is kept for good in Kairos, so that spent a name nobody had chosen and burnt it for '
      'every future Adaeze Okonkwo the moment this one picked something else. The box is empty '
      'now, it says whether a name is free while you type, and registration does not go on '
      'without one.'], {}),
    (['Every feature explaining itself',
      '**Free**, and therefore everywhere. One orientation note on the landing screen was read '
      'once, on the screen that explains itself best, and said nothing on the twenty-nine '
      'others. Thirty-nine features now each say what they do and the two-to-four moves that '
      'get somebody from arriving to having done something — open the first time, folded after. '
      'Built from a register, joined to the same one that knows what is switched off, so a '
      'panel can never tell a tester to try something this deployment does not have.'], {}),
    (['Cars filed under trips',
      '**Plus**, where trips already are. The link existed in the database from the day '
      'movements were built and nothing ever set it or read it. Trips and Movements stay two '
      'screens — most journeys belong to no trip, and the fleet belongs to none at all — but a '
      'journey leaving during a trip now offers to go under it, and the trip shows the cars.'], {}),
    (['A contents page for Assist',
      '**Plus**, where AI Assist already is. Its asks were put deliberately where the work is — '
      'the briefing on the appointment, the triage on the correspondence — which is the right '
      'place to use them and the worst place to discover them. Somebody opening AI Assist saw a '
      'box for finding a time and concluded that was all of it.'], {}),
], [3000, 6638]))
b.append(para('One rule these did not bend', style='Heading2'))
b.append(para('A private trip is **never proposed** as the trip a car belongs to. Volunteering '
              '"is this part of the Barbados trip?" is the app saying out loud that there is a '
              'Barbados trip — and saying it to whoever is booking the car, who may not be the '
              'person who booked the holiday. It can still be chosen deliberately, and the '
              'screen then says what that does and does not change. The two access rules stay '
              'apart in both directions: a movement admits the principal and whoever arranged '
              'it, so somebody the principal shared a trip with sees the trip in full and the '
              'cars not at all — and a stand-in with a day\'s sight of one journey gets no trip '
              'on it, not even an id.'))

b.append(para('How the money works', style='Heading1'))
b.append(para('Priced in Naira; the dollar figure is only a translation', style='Heading2'))
b.append(para('Every price here is set in Naira. The dollar amounts beside them are a rounded '
              'conversion for diaspora cards, not a second price list. If the rate moves, the '
              'Naira price is the one that holds.'))
b.append(para('A year costs ten months', style='Heading2'))
b.append(para('Annual billing takes two months off at every listed tier — ₦80,000, ₦150,000, '
              '₦250,000, ₦1,200,000 — and the same on every Desk tier.'))
b.append(para('Extra seats, scaled to the tier they sit on', style='Heading2'))
b.append(para('Beyond what a tier includes: an additional assistant is ₦4,000 a month and an '
              'additional household staff account is ₦1,000. On a Desk, an additional principal '
              'is ₦4,000 — the same figure from the other side of the same relationship.'))
b.append(para('Fair use, because six things here cost money per use', style='Heading2'))
b.append(para('WhatsApp bills per conversation, transcription per minute, storage per gigabyte, '
              'flight data and traffic per lookup, and the model per ask. Those are metered '
              'rather than ranked, because a Standard account recording two meetings a year '
              'costs less to run than a Plus office recording forty, and ranking them would '
              'charge the wrong people.'))
b.append(table([([('Metered', 1), ('Unit', 1), ('Free', 1), ('Standard', 1), ('Plus', 1),
                  ('Executive', 1), ('Family', 1), ('Enterprise', 1)],
                 {'shade': 'E8E8E8', 'bold': True, 'header': True, 'center': tuple(range(1, 8))}),
                (['AI Assist', 'asks', '0', '50', '250', '1,000', '3,000', '10,000'], {'center': tuple(range(1, 8))}),
                (['Recording and transcription', 'hours', '0', '2', '10', '40', '120', '400'], {'center': tuple(range(1, 8))}),
                (['Travel time', 'lookups', '0', '100', '500', '2,000', '6,000', '20,000'], {'center': tuple(range(1, 8))}),
                (['Live flight status', 'lookups', '0', '50', '250', '1,000', '3,000', '10,000'], {'center': tuple(range(1, 8))}),
                ], [2500, 900, 900, 1150, 1000, 1250, 1000, 938]))
b.append(para('A Desk carries the allowance of the tier it matches. Free is zero across the '
              'board because there is no card to stop a bill. Metering records use today but '
              'stops nobody: a limit enforced before it is measured is a limit invented.',
              style='Note'))
b.append(para('The top two are quoted, not listed', style='Heading2'))
b.append(para('Family Office is listed at ₦120,000 for a family with a shared office. Enterprise '
              'is not listed at all: the questions that decide it — how many principals, whose '
              'hardware, whose key, which questionnaire — are answered in a conversation, and a '
              'number on a page would only be wrong.'))

# ── Arguments ──────────────────────────────────────────────────────────────
b.append(para('What is worth arguing about', style='Heading1'))
for h, t in [
    ('The vault at ₦8,000 is the aggressive move, and the right one',
     'Custody is the reason to pay, and putting it in the first paid tier means the first '
     'thing somebody pays for is the thing they cannot get free anywhere else. The alternative '
     '— holding it back to Plus — makes Standard a calendar with extra steps.'),
    ('The ladder is flat at the bottom and steep in the middle',
     '₦8,000 to ₦15,000 to ₦25,000 are close enough that nobody agonises over the step, which '
     'is good for getting people in and bad for revenue per account. The jump to ₦120,000 is '
     'where the money is, and it is a different sale.'),
    ('Almost nobody has three assistants — but plenty have a driver',
     'Household staff seats are the quiet reason Plus converts to Executive, not assistant '
     'seats. The instructions vault is what the driver and the cook actually open.'),
    ('Seats are the honest meter, not usage',
     'Charging by how much somebody uses their own diary punishes the accounts that adopt '
     'hardest. Seats track the value and are legible on an invoice.'),
    ('The Desk is the bottom-up motion, and it must not undercut the main one',
     'An assistant paying ₦8,000 to keep one principal is the same money as that principal '
     'paying ₦8,000 — so the lane cannibalises nothing. It only becomes a discount if a desk '
     'keeps several principals cheaply, which is why extra principals are priced at ₦4,000 '
     'rather than bundled.' + NEW),
    ('A held record is a weaker promise, so it is given nothing to be weak about',
     'The temptation is to sell the Desk as identical to the principal-led product. It is not: '
     'nobody on the app owns that record but the assistant. Rather than dress that up, the vault '
     'is shut on it — which costs the lane nothing a PA needs day to day, and keeps the custody '
     'promise true everywhere it is made.' + NEW),
    ('Nigeria-specific fields belong in every paid tier',
     'NIN and BVN are not a premium feature in this market; they are the ordinary contents of '
     'a wallet. Putting them behind a higher tier would read as not understanding the customer.'),
]:
    b.append(para(h, style='Heading2'))
    b.append(para(t))

# ── Not working yet ────────────────────────────────────────────────────────
b.append(para('What is not working yet, said plainly', style='Heading1'))
b.append(para('Four kinds of not-yet, and only two of them can carry a date.', style='Note'))
b.append(table([
    ([('Kind', 1), ('What it means', 1), ('Count', 1)],
     {'shade': 'E8E8E8', 'bold': True, 'header': True, 'center': (2,)}),
    (['Built · needs a key', 'Works the moment a credential is set: travel time, live flight '
      'status, meeting recording and transcription, AI Assist, connectors.', '5'], {'center': (2,)}),
    (['Before launch', 'Dated work you can plan around: calendar sync, WhatsApp, visa '
      'requirement lookup, forwarding a confirmation, attaching a scan, unlimited storage.', '6'], {'center': (2,)}),
    (['Not wired yet', 'Named on this sheet but no route asks, so it currently works for '
      'everybody on every plan: the direct line, your own weekly report, voice notes, the '
      'archive, office-wide reports, documents held for others, multiple principals, '
      'single sign-on.', '8'], {'center': (2,)}),
    (['Needs a desk', 'Waits on contracted people rather than on code, so it carries no date: '
      'the concierge desk.', '1'], {'center': (2,)}),
    (['To build', 'What is left of the Desk lane: desk-scoped billing, and the written '
      'delegation recorded at setup. The principal-who-is-not-a-user, the way in from a screen, '
      'the shut vault and handing work across are done.', '2'], {'center': (2,)}),
], [2100, 6338, 1200]))
b.append(para('One more, said plainly because it is easy to miss: correspondence can be read, '
              'triaged and prioritised, and the permission that says who may send exists — but '
              'nothing consumes it yet, so **nothing sends**. Drafting and sending is the '
              'largest unbuilt piece inside a tier that is otherwise finished.'))

b.append(para('A note on the word', style='Heading1'))
b.append(para('The commercial word is **plan** or **tier**, and this sheet uses tier because that '
              'is what the August sheet used and what the market says. Inside the product the '
              'word is overloaded — a meeting type has an access tier and a contact has a '
              'relationship tier — so the code calls this a plan. Worth knowing when reading '
              'both.'))

out = build(''.join(b), os.path.join(S, 'Complete Kairos Tiers and Pricing.docx'))
print(f'wrote {out} ({os.path.getsize(out):,} bytes)')
