#!/usr/bin/env python3
"""Every feature in Kairos, divided into the six named plans."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mkdocx import para, table, build

S = os.path.dirname(os.path.abspath(__file__))
# Statuses taken from the app's own capability register, which distinguishes
# state 'needs_key' (built, waiting on a credential) from state 'soon' (the
# seam and the honest refusal exist; the integration itself does not). Calling
# the second sort 'needs keys' would promise that a credential switches it on.
LIVE, KEYS, WIRE, PART = 'Live', 'Needs keys', 'Not wired', 'Partly built'
SOON, SEAM = 'Not built', 'Settings only'

RUNGS = [
    ('FREE', 'Let people book me.',
     'Everything a person needs to be bookable and to run their own diary. No card, '
     'so nothing metered is included.', [
        ('~Account and identity', '', ''),
        ('Sign up, sign in, sign out', 'Free to join; no access code required to sign in.', LIVE),
        ('Password reset by email', 'Forgot and reset, by emailed link.', LIVE),
        ('Your handle', 'An @name from the start, changeable later.', LIVE),
        ('Profile and public link', 'Your name, your slug, your timezone.', LIVE),
        ('Onboarding by account type', 'A principal and an assistant are asked different things.', LIVE),
        ('~Being booked', '', ''),
        ('Your booking page', 'The public page people book you through.', LIVE),
        ('Meeting types', 'As many as you like, each with its own copyable link.', LIVE),
        ('Editing a meeting type', 'Changed, not deleted and retyped.', LIVE),
        ('Availability blocks', 'Several per day, not one window.', LIVE),
        ('Availability by length', 'Different lengths in different blocks, with a cap per block.', LIVE),
        ('How far ahead the diary is open', 'A decision, and it binds the diary.', LIVE),
        ('A breather after every appointment', 'So the day is not booked wall to wall.', LIVE),
        ('The booker is told when it ends', 'Not only when it starts.', LIVE),
        ('Access tiers on a meeting type', 'Who may book which type, and which need approving.', LIVE),
        ('Format picker', 'The booker says how they would like to meet.', LIVE),
        ('Request and counter', 'A time can be proposed back rather than refused.', LIVE),
        ('Accept or withdraw', 'From the booker’s side, without an account.', LIVE),
        ('Reschedule or cancel', 'From the booker’s side, without an account.', LIVE),
        ('In-app video', 'A room for video meeting types.', LIVE),
        ('~Your day', '', ''),
        ('Today', 'The day’s shape, with the now line and the gaps.', LIVE),
        ('The itinerary', 'A day planner that travel understands.', LIVE),
        ('Editing an entry in place', 'Corrected, not deleted and retyped.', LIVE),
        ('Days that have gone say so', 'Past entries marked done rather than only greyed.', LIVE),
        ('Running late', 'Says it once and the rest of the day moves.', LIVE),
        ('Move, length, cancel, notes', 'On an appointment, from the day sheet as well as its own page.', LIVE),
        ('The calendar', 'The month, colour-coded.', LIVE),
        ('Nearly up, and over', 'Warned in-app while a meeting is running.', LIVE),
        ('~Getting somewhere', '', ''),
        ('Record a journey', 'Where somebody went, and when.', LIVE),
        ('Watch a journey happen', 'En route, while it is happening.', LIVE),
        ('Arrival confirmation', 'And the alarm when nobody confirms.', LIVE),
        ('The duress signal', 'A panic button.', LIVE),
        ('Driver papers running out', 'Warned before a licence lapses, not after.', LIVE),
        ('The driver’s card', 'What the driver holds, naming nobody.', LIVE),
        ('~Housekeeping', '', ''),
        ('Notifications', 'Web push to the device.', LIVE),
        ('Announcements', 'What the operator wants everybody to know.', LIVE),
        ('Tell us', 'Feedback, from a list or typed in their own words.', LIVE),
     ]),

    ('STANDARD', 'Run my own day, and keep my own papers.',
     'The first paid rung. One person, running themselves, keeping documents that '
     'matter. No second person is involved yet.', [
        ('The essentials vault', 'Identity documents and the details behind them, held properly.', LIVE),
        ('Sensitivity decided per field', 'Not per document — a passport number and its expiry are not the same risk.', LIVE),
        ('Attach a scan', 'The image itself, not only the number.', SOON),
        ('Contact intelligence', 'Who they are, how you know them, what matters.', LIVE),
        ('Relationship calendar', 'Birthdays and anniversaries, before they pass.', LIVE),
        ('Tasks and reminders', 'Including a task raised straight from a message.', LIVE),
        ('The pad', 'Quick lines, and rewording one rather than binning it.', LIVE),
        ('Trips', 'A journey built from the screen that shows it.', LIVE),
        ('Personal trips stay personal', 'Off the office entirely, unless you say otherwise.', LIVE),
        ('Whether a visa is required', 'Checked before the trip, not at the desk.', SOON),
        ('Vehicles, drivers and standing runs', 'The fleet. The journey itself is never charged for.', LIVE),
        ('Being unavailable', 'For hours, a day, a week, or longer.', LIVE),
        ('When you are at your best', 'Suggested times, from how the days actually run.', LIVE),
        ('What needs you', 'The things waiting on you, in one place.', LIVE),
        ('The week ahead', 'What is coming, and what has had no attention.', LIVE),
        ('While you were away', 'What happened, gathered rather than scrolled for.', LIVE),
        ('Reports on demand', 'Any dates you like, not only the week.', LIVE),
        ('Forward a confirmation', 'Email an airline confirmation in and it lands on the day.', SOON),
        ('Calendar sync', 'Two ways, with the calendar already in use.', SEAM),
        ('The direct line', 'A private way through to you.', WIRE),
        ('Your own weekly report', 'The week, as a document you can send on.', WIRE),
     ]),

    ('PLUS', 'Run it with the people who work for me.',
     'The assistant product. Everything that involves a second person acting for '
     'the principal — and where most of Kairos actually lives.', [
        ('~The people who work for you', '', ''),
        ('Bringing on an assistant', 'A PA, EA or Chief of Staff, by invitation.', LIVE),
        ('Roles, and what each may see', 'A delegate handling scheduling does not thereby see documents.', LIVE),
        ('The access code', 'Set by the principal, and only for granting account access.', LIVE),
        ('The approval queue', 'Bookings that need a decision before they are real.', LIVE),
        ('Working as the principal', 'The switcher, and everything scoped to whom you are acting for.', LIVE),
        ('~Working together', '', ''),
        ('Spaces', 'Rooms that stay separate from each other.', LIVE),
        ('Projects and stages', 'With the stage’s state driven by what is recorded in it.', LIVE),
        ('Threads', 'Two registers — talk, and the record — and promoting one to the other.', LIVE),
        ('Records', 'Decisions, blockers and sign-offs, kept as such.', LIVE),
        ('Something open that nobody answered', 'Flagged in the report, and clickable through to it.', LIVE),
        ('Mentions', 'Being named, and knowing you were.', LIVE),
        ('Archive or delete', 'A task, a project, a thread — with the record kept either way.', LIVE),
        ('~Correspondence', '', ''),
        ('Correspondence handled for you', 'An assistant working the principal’s mail.', LIVE),
        ('Private by default', 'Nothing is visible to an assistant unless it is opened to them.', LIVE),
        ('A per-thread override', 'One conversation opened, or one barred, without changing the rest.', LIVE),
        ('Triage and prioritise', 'Sorted into what needs the principal and what does not.', LIVE),
        ('Drafts, and who may send', 'The permission exists; nothing consumes it yet, so nothing sends.', PART),
        ('~The rest of the office', '', ''),
        ('Minutes of meetings', 'Filed against the meeting they belong to.', LIVE),
        ('Record a meeting and transcribe it', 'With consent, and the audio deleted if transcription fails.', KEYS),
        ('Household staff', 'And the instructions each of them holds.', LIVE),
        ('Access log in the report', 'Who looked at what.', LIVE),
        ('WhatsApp', 'Notifications where people actually read them.', SEAM),
        ('Voice notes', 'Spoken rather than typed.', WIRE),
        ('The archive', 'Everything put away, still findable.', WIRE),
        ('Reports across the office', 'Everyone on the team, individually or together.', WIRE),
     ]),

    ('EXECUTIVE', 'Work across other people’s offices.',
     'One thing, not a grab bag: reaching beyond your own office.', [
        ('Brief builder', 'The note before a meeting, about who you are meeting.', LIVE),
        ('Connections between offices', 'Naming who you work with — and only they can let you in.', LIVE),
        ('Finding somebody by handle', 'Reachable even when they are not yet in your network.', LIVE),
        ('The concierge desk', 'Arrangements made on your behalf.', SOON),
        ('Documents held for other people', 'Custody for somebody who is not you.', WIRE),
     ]),

    ('FAMILY OFFICE', 'More than one principal.',
     'The same office serving several people, each with their own everything.', [
        ('More than one principal', 'Several principals under one office, kept apart.', WIRE),
     ]),

    ('ENTERPRISE', 'Inside an institution.',
     'What an institution’s IT department asks for before anything else.', [
        ('Single sign-on', 'The institution’s own identity provider.', WIRE),
        ('Connectors', 'Into whatever the institution already runs.', KEYS),
     ]),
]

NEVER = [
    ('Movement safety', 'Duress, arrival alarms, and driver papers running out. Silencing an '
     'alarm over an invoice is indefensible at any price.'),
    ('Reading what is stored', 'Dropping from Plus to Standard keeps every document and every '
     'trip already put in. You simply cannot add more.'),
    ('Account security', 'Two-factor, devices, sign-out, the security question, the access code. '
     'A plan that could switch these off would turn a lapsed card into a way in.'),
    ('Taking your records out', 'Export, and closing the account. A product that is hard to '
     'leave has stopped competing on being good.'),
]

METERED = [
    ('AI Assist', 'asks', '0', '50', '250', '1,000', '3,000', '10,000'),
    ('Recording and transcription', 'hours', '0', '2', '10', '40', '120', '400'),
    ('Travel time with live traffic', 'lookups', '0', '100', '500', '2,000', '6,000', '20,000'),
    ('Live flight status', 'lookups', '0', '50', '250', '1,000', '3,000', '10,000'),
]

AI_ASKS = [
    ('Compose in the principal’s voice', 'Never sends. A draft is a draft.'),
    ('Rework what is already written', 'Tone, length, register.'),
    ('Summarise a long conversation', 'The thread you came back to.'),
    ('What happened while you were away', 'In a paragraph rather than a list.'),
    ('The briefing note before a meeting', 'Who, why, and what was last said.'),
    ('Turn what was agreed into tasks', 'From the minute, with owners.'),
    ('Triage correspondence', 'What needs the principal, and what does not.'),
    ('A reply in the principal’s voice', 'Sent only where sending is delegated.'),
    ('What is worth knowing about next week', 'Ahead of it, not during it.'),
    ('Spot decisions in a conversation', 'Offered as records, never filed unasked.'),
]

b = []
b.append(para('Every Feature, By Plan', style='Title'))
b.append(para('Kairos by Exousia — Exousia Prime Emporium Ltd, Lagos   ·   '
              'Free · Standard · Plus · Executive · Family Office · Enterprise   '
              '·   1 September 2026', style='Sub'))

b.append(table([([('**Nothing is locked today.** Every check runs, records what it *would* '
                   'have refused, and lets the request through. Refusal needs '
                   '`PLAN_ENFORCEMENT=on`, which is set nowhere but the test suite. This '
                   'document is a proposal about where the lines belong, not a description '
                   'of what the app currently stops anybody doing.', 1)], {'shade': 'FFF8DC'})],
              [9638]))

b.append(para('How to read it', style='Heading1'))
b.append(para('Each rung includes everything below it. A rung is the question it answers, not '
              'a bundle of features — which is what stops the list drifting into whatever '
              'felt premium that week.'))
b.append(table([
    ([('Status', 1), ('Means', 1)], {'shade': 'E8E8E8', 'bold': True, 'header': True}),
    (['Live', 'Built, working, and reachable on a screen today.'], {}),
    (['Needs keys', 'Built, but waiting on a credential or an outside service. Shows in the '
                    'app as unavailable and names what it is waiting for.'], {}),
    (['Not wired', 'Named on this sheet, but no route asks about it. Works for everybody on '
                   'every plan, and would keep working even with enforcement on. Each is a '
                   'pricing decision: wire it, or take it off the sheet.'], {}),
    (['Not built', 'The control is on the screen and says so honestly, but the work behind '
                  'it is still to do. A credential alone will not switch it on.'], {}),
    (['Settings only', 'The settings and the seam exist and report themselves as not '
                      'configured. The integration itself is unwritten.'], {}),
    (['Partly built', 'Some of it exists. Said plainly rather than counted as done.'], {}),
], [1900, 7738]))

for name, question, blurb, rows in RUNGS:
    b.append(para(f'{name} — “{question}”', style='Heading1'))
    b.append(para(blurb, style='Note'))
    trs = [([('Feature', 1), ('What it is', 1), ('Status', 1)],
            {'shade': 'E8E8E8', 'bold': True, 'header': True, 'center': (2,)})]
    for feat, what, status in rows:
        if feat.startswith('~'):
            trs.append(([(feat[1:], 3)], {'shade': 'EFEFEF', 'bold': True}))
        else:
            trs.append(([feat, what, status], {'center': (2,)}))
    b.append(table(trs, [2850, 5288, 1500]))

b.append(para('Outside the ladder — four things no plan may withhold', style='Heading1'))
b.append(para('Enumerated in code rather than left as a principle, and a test fails if any of '
              'them ever appears on a rung above.', style='Note'))
b.append(table([([('What', 1), ('Why it is not for sale', 1)],
                 {'shade': 'E8E8E8', 'bold': True, 'header': True})]
               + [([k, v], {}) for k, v in NEVER], [2400, 7238]))
b.append(para('The trap inside that third one', style='Heading2'))
b.append(para('An arrival alarm only exists for a journey that exists. Gating *create a '
              'journey* would silence a panic button while this sheet still read as though '
              'only a paid convenience were involved. So the **fleet** is charged for — cars, '
              'drivers, standing weekly runs — and the **journey** never is. Recording where '
              'somebody went, and being warned when nobody confirmed they arrived, works on '
              'Free.'))

b.append(para('Measured, not ranked', style='Heading1'))
b.append(para('Everything on the ladder costs us almost nothing per use, so placing it is a '
              'decision about who the product is for. These four are invoiced to us per use. '
              'A Standard account recording two meetings a year costs less to run than a Plus '
              'office recording forty — ranking them would charge the wrong people. Monthly, '
              'and frank guesses meant to be measured rather than asserted.'))
b.append(table([([('Metered', 1), ('Unit', 1), ('Free', 1), ('Standard', 1), ('Plus', 1),
                  ('Executive', 1), ('Family', 1), ('Enterprise', 1)],
                 {'shade': 'E8E8E8', 'bold': True, 'header': True, 'center': tuple(range(1, 8))})]
               + [(list(r), {'center': tuple(range(1, 8))}) for r in METERED],
               [2500, 900, 900, 1150, 1000, 1250, 1000, 938]))
b.append(para('Free is zero across the board because there is no card to stop a bill. Metering '
              'records use today but stops nobody: a limit enforced before it is measured is a '
              'limit invented.', style='Note'))

b.append(para('What one AI ask buys', style='Heading2'))
b.append(para('Ten separate asks share the one allowance. All of them refuse anything from the '
              'essentials vault outright, and none of them ever sends on its own.', style='Note'))
b.append(table([([('The ask', 1), ('Note', 1)], {'shade': 'E8E8E8', 'bold': True, 'header': True})]
               + [([k, v], {}) for k, v in AI_ASKS], [3400, 6238]))

b.append(para('One thing to settle before this is built', style='Heading1'))
b.append(para('The code calls the first two paid rungs `principal` and `office`, and treats '
              '`standard` and `plus` as **aliases pointing at them** — the older names, kept so '
              'that a deploy could never silently re-price anybody. Adopting Standard and Plus '
              'as the real names is therefore a rename rather than a redesign: the rungs, the '
              'ranks and every feature placement stay exactly as they are here, and the two '
              'aliases reverse direction. Worth doing deliberately and once, because the names '
              'end up in stored account rows.'))
b.append(para('A note on the word “plan”', style='Heading2'))
b.append(para('The commercial word is **plan**. “Tier” already means a meeting type’s access '
              'tier and a contact’s relationship tier; a third meaning would make every '
              'conversation about any of them ambiguous.'))

out = build(''.join(b), os.path.join(S, 'Kairos Features By Plan.docx'))
n = sum(1 for _, _, _, rows in RUNGS for f, _, _ in rows if not f.startswith('~'))
counts = {}
for _, _, _, rows in RUNGS:
    for f, _, s in rows:
        if not f.startswith('~'):
            counts[s] = counts.get(s, 0) + 1
print(f'wrote {out} ({os.path.getsize(out):,} bytes)')
print(f'features={n}  ' + '  '.join(f'{k}={v}' for k, v in sorted(counts.items())))
print('rungs=' + str(len(RUNGS)) + ' never_gated=' + str(len(NEVER))
      + ' metered=' + str(len(METERED)) + ' ai_asks=' + str(len(AI_ASKS)))
