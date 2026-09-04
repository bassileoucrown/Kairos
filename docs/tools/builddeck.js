// Builds the Kairos training course from the captured screens.
//
// The pictures are real: every one came out of the running build, driven
// through the real UI against a seeded office. See capture.js. This file only
// arranges them and writes the teaching around them.
const fs = require('fs');
const path = require('path');

// Derived from where this file sits. capture.js writes into the same place.
const ROOT = path.join(__dirname, '..', '..');
const DIR = process.env.KAIROS_DECK_OUT
  ? path.dirname(process.env.KAIROS_DECK_OUT)
  : path.join(ROOT, 'docs', 'tools', 'build');
const DECK = process.env.KAIROS_DECK_OUT || path.join(DIR, 'deck');
const OUT = path.join(DIR, 'kairos-course.html');

const img = (n) => `data:image/jpeg;base64,${fs.readFileSync(path.join(DECK, 'small', `${n}.jpg`)).toString('base64')}`;
const vid = (n) => `data:video/webm;base64,${fs.readFileSync(path.join(DECK, 'clips', `${n}.webm`)).toString('base64')}`;
const has = (n) => fs.existsSync(path.join(DECK, 'shots', `${n}.jpg`));
let CROPPED = [];
try { CROPPED = JSON.parse(fs.readFileSync(path.join(DECK, 'small', 'cropped.json'), 'utf8')); }
catch { /* no crop manifest: nothing was long enough to need one */ }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// **bold** and *quiet* in the prose, because writing <strong> forty times is
// how a content file stops being readable by the person maintaining it.
const rich = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*(.+?)\*/g, '$1<em>$2</em>');

// ── The course ─────────────────────────────────────────────────────────────
//
// ROLES. Every lesson is tagged with who it is for, because a driver being
// taught the whole product learns none of it. The chips at the top filter.
const P = 'principal', A = 'assistant', S = 'staff', V = 'visitor';

const CH = [
  {
    n: 1,
    id: 'start',
    title: 'Getting in',
    blurb: 'From nothing to a working account. Six screens, and the only one that '
      + 'needs thought is the handle.',
    lessons: [
      {
        shot: '01-landing', roles: [P, A, S], title: 'The front door',
        what: 'What anybody sees before they sign in.',
        steps: [
          'Open the address you were given.',
          'Sign in if you have an account. Create one if you do not.',
        ],
        note: 'Signing up is open on purpose. An account on its own reaches nothing — every screen '
          + 'is scoped to a principal, and a stranger who signs up sees their own empty calendar '
          + 'and no trace of anybody else. The compartments are the security, not the front door.',
      },
      {
        shot: '02-signup', roles: [P, A], title: 'Which of the two you are',
        what: 'The first question, because the app is a different shape for each.',
        steps: [
          'Choose **Principal** if the diary being kept is yours.',
          'Choose **Assistant** if you keep somebody else’s — PA, EA or Chief of Staff.',
          'Name, email, password. Nothing else is asked at this point.',
        ],
        note: 'A principal lands on their day. An assistant lands on their worklist across every '
          + 'principal they run. Picking wrongly is not fatal — it changes where you arrive, not '
          + 'what you can reach.',
      },
      {
        shot: '03-onboarding-profile-empty', roles: [P, A, S], title: 'Choosing your handle',
        what: 'What colleagues will call you inside Kairos, and the address your booking page lives at.',
        steps: [
          'The box is **empty on purpose**. Nothing is derived from your name and nothing is filled in for you.',
          'Type the name you want. Letters, numbers and hyphens.',
          'Set your timezone — every time on every other screen is drawn from it.',
        ],
        note: 'A handle is yours **for good**. Kairos remembers every handle anybody has ever held, so '
          + 'that a released one can never be picked up by a stranger who would inherit every @you '
          + 'ever written. That is also why nothing is chosen for you: a name nobody picked would '
          + 'have been spent permanently on their behalf.',
      },
      {
        shot: '04-onboarding-handle-taken', roles: [P, A, S], title: 'Taken, and free',
        what: 'It tells you while you type rather than after you press the button.',
        steps: [
          'Type a name. After a moment it says whether it is free.',
          'A taken one says so in the same words the app uses when you submit.',
        ],
        note: 'It never says *who* has it. Whether somebody holds a name now or held it in 2023 is a '
          + 'fact about a stranger’s account, and this app does not confirm those.',
        pair: '05-onboarding-handle-free',
      },
      {
        shot: '06-onboarding-connect', roles: [P, A], title: 'Who you work with',
        what: 'The one question that matters as much to an assistant as to a principal.',
        steps: [
          'A principal names the assistant they want to appoint.',
          'An assistant names their principal by handle.',
          'An assistant whose principal is **not on Kairos at all** says so here — and gets the whole app anyway.',
        ],
        note: 'That last branch is the Desk. The assistant keeps a record on the principal’s behalf and '
          + 'does the whole job; when the principal eventually joins, they sign up normally with their '
          + 'own address and are connected by handle. Work crosses afterwards, one item at a time.',
      },
      {
        shot: '07-onboarding-meeting-type', roles: [P], title: 'The first thing people can book',
        what: 'So the booking page is not empty on day one.',
        steps: [
          'Give it a name and a length.',
          'Add more later from Settings. This one is only to get you started.',
        ],
      },
      {
        shot: '08-first-day', roles: [P, A, S], title: 'The first day',
        what: 'A brand new account, before anything is in it.',
        steps: [
          'Every screen carries a short note saying what it does and how to use it.',
          'It is open the first time you reach a feature and folds to one line after.',
          'Press the heading to open it again at any time.',
        ],
        note: 'There used to be a single note on this screen listing four things to try. It was read '
          + 'once, on the screen that explains itself best, and said nothing on the twenty-nine '
          + 'others. Thirty-nine features now each carry their own.',
      },
    ],
  },
  {
    n: 2,
    id: 'day',
    title: 'The day',
    blurb: 'The four screens somebody opens every morning.',
    lessons: [
      {
        shot: '10-today', roles: [P, A], title: 'Today',
        what: 'The shape of one day — not a list of five cards.',
        steps: [
          'Read the **band at the top** first: what is happening now, and how long is left.',
          'The **spine** below is the day in order, and the space between two entries is proportional to the gap between them.',
          'The **now marker** shows where you are in it.',
          'Anything needing a decision is in the right-hand column. Press it to deal with it.',
        ],
        note: 'A list of five entries tells you there are five things. It does not tell you four are '
          + 'before noon and the fifth is at seven — which is the thing you actually want to know at '
          + 'breakfast, and the thing a diary is for.',
        pair: '10b-today-full',
      },
      {
        shot: '11-today-folded', roles: [P, A], title: 'Folding the guidance away',
        what: 'The note stays findable without taking up the screen.',
        steps: [
          'Press **What Today does** to fold it.',
          'Folded, it is one line with a summary. Press it again to open.',
          'It remembers per feature, in this browser only.',
        ],
      },
      {
        shot: '12-itinerary', roles: [A], title: 'The Itinerary',
        what: 'Where the day is built: meetings, cars, meals, the school run — not only bookings.',
        steps: [
          'Pick a day.',
          'Add what is happening. Give it a place and the leg before it can be timed.',
          'Move an appointment and everybody affected is told.',
        ],
        note: 'An assistant can build a day as a **draft** the principal cannot see yet, and publish it '
          + 'when it is ready.',
      },
      {
        shot: '18-catch-up', roles: [P, A], title: 'While you were away',
        what: 'What happened since you last looked, ordered by what would be worst to have missed.',
        steps: [
          'Open it after any absence — a weekend, a flight, four days out.',
          'A decision filed without you comes first, because you are already working under it.',
          'A chatty room comes last. Press any line to go to the thing itself.',
        ],
        note: 'It counts from when you last had Kairos open, so you never have to pick a date. It is '
          + 'also **not scoped to one principal** — an assistant who has been away has been away from '
          + 'all of them.',
      },
      {
        shot: '19-pad', roles: [P, A], title: 'The Pad',
        what: 'One line, captured before it is lost, sorted out afterwards.',
        steps: [
          'Type the thought. Press enter. Nothing else is asked of you at that moment.',
          'Come back later and turn a line into a task, a diary entry or a message.',
          'The toggle says in words who can read it — private, or on the office pad.',
        ],
        note: 'A thought arrives walking out of a meeting. If capturing it costs a form, it is not captured.',
      },
    ],
  },
  {
    n: 3,
    id: 'away',
    title: 'Getting there',
    blurb: 'Trips are where somebody is going. Movements are how they get there on the ground. '
      + 'They are two screens because most journeys belong to no trip at all.',
    lessons: [
      {
        shot: '13-trips', roles: [A], title: 'Trips',
        what: 'A period away — flights, hotels, visas, and who to call at the far end.',
        steps: [
          'Build a trip with its dates and destination.',
          'Add the legs and the stays.',
          'Confirm it, and the whole day redraws in the destination’s timezone.',
        ],
        note: 'A trip can be marked **private**. A private trip is genuinely *absent* to the office — no '
          + 'title, no destination, no dates. Not redacted, absent. Exactly one bit crosses: the day '
          + 'shows as unavailable, so nobody books a call over a family holiday in good faith.',
      },
      {
        shot: '14-trip-detail', roles: [P, A], title: 'Inside a trip',
        what: 'Everything a day sheet cannot answer.',
        steps: [
          'The legs, in order, in the right timezone at both ends.',
          '**Who else is going**, and **who to call there**.',
          'Documents checked against the trip’s own dates — a passport with four months left is in date today and still turns you away at check-in.',
          '**Getting there and around** lists the cars filed under this trip.',
        ],
        note: 'The cars are shown to fewer people than the trip is. A movement admits the principal and '
          + 'whoever arranged it — narrower than the office — so somebody the principal shared this '
          + 'trip with sees the trip in full and the cars not at all. An escort roster is not a travel detail.',
      },
      {
        shot: '15-movements', roles: [A], title: 'Movements',
        what: 'Getting the principal there on the ground — the journey, the car, the driver, and whether they arrived.',
        steps: [
          'Add a journey with a pickup, a destination and a time.',
          'Say how long it should take. Without that, Kairos records the journey but cannot tell you when nobody has confirmed an arrival.',
          'Assign a driver and a car.',
          'If it leaves during a trip, it offers to file it under that trip.',
        ],
        note: 'Most movements are not trips: the school run, the office to a meeting across Lagos, the '
          + 'airport at 5am. Filing them under Trips would mean inventing an empty trip to hold the one '
          + 'journey that mattered — and that is the journey nobody would bother to file.',
      },
      {
        shot: '16-fleet', roles: [A], title: 'The cars',
        what: 'The fleet, with the papers and when each runs out.',
        steps: [
          'Add a car: a name, a plate, a make.',
          'Add its insurance, roadworthiness, licence and permits with their expiry dates.',
          'Each gets the same verdict a passport gets — in date, nearly out, expired.',
        ],
        pair: '17-drivers',
      },
    ],
    clip: {
      roles: [P, A, S],
      name: 'guidance', title: 'Guidance moving with you',
      what: 'The same panel on three different screens, each describing the feature it is on.',
    },
  },
  {
    n: 4,
    id: 'desk',
    title: 'The assistant’s desk',
    blurb: 'Nine sections of one job. An assistant lives here.',
    lessons: [
      {
        shot: '40-workspace', roles: [A], title: 'The Workspace',
        what: 'What is outstanding across every principal you run, without picking one first.',
        steps: [
          'Start the day here rather than in the switcher.',
          'Each line says whose it is. Pressing it takes you there and sets the principal for you.',
        ],
        note: 'Making somebody choose a principal before the app will say anything is the small friction '
          + 'that turns a tool into a chore.',
      },
      {
        shot: '41-desk', roles: [A], title: 'The Desk',
        what: 'Every section of the work for one principal, with what is waiting in each.',
        steps: [
          'The overview shows all sections at once.',
          'Press one to open it. The tab strip then moves you between them.',
          '**The whole desk** brings you back.',
        ],
      },
      {
        shot: '42-approvals', roles: [A], title: 'Approvals',
        what: 'Requests for the principal’s time that need a decision before they become appointments.',
        steps: [
          '**Accept** — it lands in the diary and the asker is told.',
          '**Decline** — the slot is released.',
          '**Counter** — propose a different time. It goes back to whoever asked, and they accept or counter again.',
        ],
        note: 'Which requests arrive here is set by the meeting type’s access tier. A stranger booking an '
          + 'Introduction goes straight into the diary; a board member booking a Board matter holds the '
          + 'slot and waits.',
      },
      {
        shot: '43-contacts', roles: [A], title: 'Contacts',
        what: 'Who the principal deals with, and what an assistant needs to remember about each.',
        steps: [
          'Add a person, with the things nobody writes down — how they take their coffee, who their assistant is.',
          'Set the relationship tier. It decides what they can book.',
          'Birthdays and anniversaries go on the same record; the band at the top shows what is coming.',
        ],
      },
      {
        shot: '44-instructions', roles: [P, A], title: 'Standing instructions',
        what: 'What this principal always wants, so it is not asked twice.',
        steps: [
          'Write the rule once — never Mondays before ten, always a window seat, no dinners in the week.',
          'Anybody working for this principal reads the same list.',
        ],
      },
      {
        shot: '45-briefs', roles: [A], title: 'Briefs',
        what: 'The note the principal reads in the car.',
        steps: [
          'Build a brief against an appointment.',
          'What is already held about that person and that thread is pulled in rather than retyped.',
        ],
      },
      {
        shot: '46-assist', roles: [A], title: 'AI Assist',
        what: 'Finding a time in plain words, and a contents page for everything else Assist does.',
        steps: [
          'Type when you want something — “an hour with Emeka next week, mornings”.',
          'It filters real open slots and offers them.',
          'The list below says what else Assist can do and which screen each one lives on.',
        ],
        note: 'Finding a time **uses no model at all**. It filters the same computed slots the public '
          + 'booking page uses, which is precisely why it cannot invent a time that does not exist. '
          + 'And nothing Assist does ever sends or files on its own: what comes back is a draft, and it '
          + 'is yours to accept, change or throw away.',
      },
      {
        shot: '47-comms', roles: [A], title: 'Comms',
        what: 'Messages going out on the principal’s behalf.',
        steps: [
          'Draft here.',
          'If the principal has delegated sending to you, you send.',
          'If not, it goes to them to approve.',
        ],
        note: 'Approved or not, a draft is a draft: nothing leaves without a person pressing send.',
      },
      {
        shot: '48-correspondence', roles: [A], title: 'Correspondence',
        what: 'What has come in for the principal, and what each thing needs.',
        steps: [
          'Read what has arrived.',
          'Mark what it needs — the principal, you, later, or nothing.',
          'Draft a reply against a message. It stays a draft.',
        ],
        note: 'Nothing is visible to an assistant unless the principal opens it to them, one conversation '
          + 'at a time. Being somebody’s assistant does not put you in their mail.',
      },
      {
        shot: '49-bookings', roles: [A], title: 'Bookings',
        what: 'Everything already agreed, and what has been asked to change.',
        steps: [
          'Open one to see who is coming, what was asked for, and any notes.',
          'Cancel or reschedule from here; whoever booked it is told.',
        ],
      },
      {
        shot: '20-report', roles: [P, A], title: 'The Report',
        what: 'What the period actually held — and what has had no attention.',
        steps: [
          'Pick any dates you like. The figures redraw for exactly that range.',
          'It carries the access log: who looked at what.',
          'Open records nobody answered are listed, and clickable straight through.',
        ],
      },
    ],
    clip: {
      roles: [A],
      name: 'desk', title: 'Moving around the desk',
      what: 'The overview, into a section, and back out again.',
    },
  },
  {
    n: 5,
    id: 'work',
    title: 'Work that is not the diary',
    blurb: 'Rooms, records, projects and tasks — for offices where things get decided.',
    lessons: [
      {
        shot: '28-spaces', roles: [P, A], title: 'Spaces',
        what: 'One space per piece of work: its rooms, its projects, its people.',
        steps: [
          'Make a space and choose its context — Work, Personal or Private.',
          'Add the people who belong in it.',
          'Open a room to talk.',
        ],
        note: 'Spaces are **sealed from each other**. Being in one tells you nothing about any other, and '
          + 'a Private space cannot be shared even by a future bug — there is no code path that writes '
          + 'a member row on one.',
        pair: '29-space',
      },
      {
        shot: '36-thread', roles: [P, A], title: 'A room, and its two registers',
        what: 'What was said, and what was decided — in the same place, kept apart.',
        steps: [
          'Talk normally. Everything goes into the **said** register.',
          'When something is settled, **promote** that line into the record.',
          'A promoted record can be corrected until somebody acknowledges it. After that it can only be **superseded**, never edited.',
          'Turn any line into a task from the same menu.',
        ],
        note: 'Editing a decision out from under somebody who has agreed to it is exactly what the lock '
          + 'exists to stop. The formal record is produced *by* the informal conversation instead of '
          + 'being written separately afterwards — which is the only version anybody actually keeps up.',
      },
      {
        shot: '37-project', roles: [P, A], title: 'Projects and stages',
        what: 'Work in stages, where the stage moves on what was decided rather than on a dropdown.',
        steps: [
          'Give the project its stages.',
          'Each stage has its rooms.',
          'Promote a decision in one and the stage moves. File a blocker and it holds until answered.',
        ],
      },
      {
        shot: '30-tasks', roles: [P, A], title: 'Tasks',
        what: 'Everything assigned to you, across every space and every principal.',
        steps: [
          'Work down the list.',
          'A task carries where it came from, so you can open the room behind it.',
          'Give it a date and it will chase you before the deadline, with the lead time set by how costly missing it is.',
        ],
      },
      {
        shot: '31-archive', roles: [A], title: 'The Archive',
        what: 'What the office decided was worth keeping after the rooms had finished.',
        steps: [
          '**Keep** a message from a room and a copy lands here, safe from that room being deleted.',
          '**Archive** a document and the original is filed here rather than copied.',
        ],
        note: 'Two different things under one heading, and they got here by different routes on purpose: '
          + 'a kept message is a copy so that deleting the conversation cannot take it; an archived '
          + 'document is the original, because copying it would mean two passport numbers where there '
          + 'should be one.',
      },
    ],
  },
  {
    n: 6,
    id: 'house',
    title: 'The household',
    blurb: 'The driver, the cook, the house manager — and the screen they see.',
    lessons: [
      {
        shot: '27-household', roles: [P, A], title: 'Household',
        what: 'What each member of staff was told, and whether they have said they got it.',
        steps: [
          'Add the driver, the cook, the housekeeper.',
          'Send an instruction to one of them, with a time if it has one.',
          'Watch for the acknowledgement.',
        ],
        note: 'An instruction nobody acknowledged is a hope, not an instruction. That is the whole feature.',
      },
      {
        shot: '50-staff', roles: [S], title: 'The staff member’s screen',
        what: 'What a driver sees — and deliberately the whole of it.',
        steps: [
          'Read the list: what you are doing, and where.',
          'Press **Got it** on each.',
          'Reply if something has changed.',
        ],
        note: 'Everything else the app does is somebody else’s business, and none of it is reachable from '
          + 'here because none of it is reachable from their account at all. A driver at six in the '
          + 'morning wants one question answered.',
      },
      {
        shot: '32-connections', roles: [A], title: 'Connections',
        what: 'Reaching the assistant on the other side, when two principals need to be in a room.',
        steps: [
          'Get their handle from a signature or from them directly.',
          'Add it, and they accept.',
          'Once connected you can propose times across both diaries.',
        ],
        note: 'There is **no search here and there never will be**. A directory of who is on Kairos, and '
          + 'who they run, is itself the sensitive thing. A handle you have no connection to returns '
          + 'nothing at all — indistinguishable from a typo.',
      },
    ],
  },
  {
    n: 7,
    id: 'custody',
    title: 'Custody',
    blurb: 'The part that is not scheduling: passports, NINs, and who is allowed to see them.',
    lessons: [
      {
        shot: '21-essentials', roles: [P, A], title: 'Essentials',
        what: 'The details an assistant is asked for constantly — passport numbers, NIN, air miles, seat preferences.',
        steps: [
          'Add one detail. It is encrypted before it is stored, with the key held outside the database.',
          'Opening this asks for the principal’s access code, every time.',
          'Grant a specific person access to a specific *kind* of detail, not to all of it.',
          'Every reveal is written down and shows in the Report.',
        ],
        note: 'A scheduling delegate genuinely **cannot** see a BVN — it is structural, not a permission '
          + 'flag. And AI never reads or writes here under any instruction: the vault is off limits to '
          + 'it entirely, and it refuses rather than asks.',
      },
      {
        shot: '22-security', roles: [P, A, S], title: 'Security',
        what: 'Who is signed in as you, on what, and the codes that guard the sensitive parts.',
        steps: [
          'Review signed-in devices. Sign out any you do not recognise.',
          'Set the **access code** that guards Essentials.',
          'Set the **security question** that guards signing other devices out.',
          'Turn on two-factor and keep the recovery codes somewhere that is not this app.',
        ],
        note: 'No code is asked for at sign-in by default. A code at the front door protects everything '
          + 'and is paid on every login, which is what makes people switch it off — and an account with '
          + 'it off protects nothing. Spending it on the vault instead means a stolen password reaches a '
          + 'calendar and still cannot read a passport number.',
      },
      {
        shot: '23-team', roles: [P], title: 'Team',
        what: 'Appointing the people who work for you, and deciding what each can reach.',
        steps: [
          'Invite by email or handle. They accept and appear in your team.',
          'Set what each one can do — scheduling only, or scheduling and the rest.',
          'Or set a **pairing code** you say down the phone, which expires.',
        ],
        note: 'A delegate handling scheduling does not get the sensitive detail. That is the separation '
          + 'the whole product is built on.',
      },
    ],
  },
  {
    n: 8,
    id: 'booked',
    title: 'Being booked',
    blurb: 'What outsiders see, and the controls behind it.',
    lessons: [
      {
        shot: '60-booking-page', roles: [P, A, V], title: 'Your booking page',
        what: 'What an outsider sees at your handle.',
        steps: [
          'Send them the link, or a link to one particular meeting type.',
          'They pick a type, then a time.',
        ],
        pair: '61-booking-slots',
      },
      {
        shot: '24-meeting-types', roles: [P, A], title: 'Meeting types',
        what: 'What you offer: a length, a format, and who may book it.',
        steps: [
          'Create a type and set its length.',
          'Choose the **access tier** — a stranger and a board member are not routed the same way.',
          'Copy its own link and send it to whoever should use that one.',
        ],
      },
      {
        shot: '25-availability', roles: [P, A], title: 'Availability',
        what: 'When you can be booked, and how much of it can be taken.',
        steps: [
          'Set blocks per weekday. More than one block a day is allowed.',
          'Cap how many meetings any one block can take, so a free morning is not eaten whole.',
          'Set the breather after each appointment.',
          'Set how far ahead the diary is open.',
        ],
        note: 'This decides what outsiders can see and book. It does not hide anything already in the diary.',
      },
      {
        shot: '26-calendar', roles: [P, A], title: 'The month',
        what: 'Everything booked, colour-coded by meeting type.',
        steps: [
          'Use it to find the shape of a month rather than the detail of a day.',
          'Press any block to open the appointment.',
        ],
      },
    ],
    clip: {
      roles: [P, A, V],
      name: 'booking', title: 'An outsider booking a time',
      what: 'The whole visitor flow, from the page to the form.',
    },
  },
  {
    n: 9,
    id: 'honest',
    title: 'What is not built yet',
    blurb: 'Kairos says so rather than failing. This chapter is short because the list is the point.',
    lessons: [
      {
        shot: '33-coming', roles: [P, A, S], title: 'Coming',
        what: 'Everything designed but not working yet, and exactly what each one is waiting on.',
        steps: [
          'An entry saying **needs a key** is waiting on this deployment — somebody sets a credential and it goes live.',
          'An entry saying **soon** is waiting on us.',
          'The notice and the feature read the same environment, so a notice disappears the moment the thing behind it starts working.',
        ],
        note: 'No screen decides for itself whether something works. A page that hardcodes “coming soon” '
          + 'keeps saying it after the credential is set, and a page that hardcodes nothing quietly '
          + 'offers a button that does nothing. Both are how a product loses the right to be believed '
          + 'about anything else.',
      },
      {
        shot: '35-concierge', roles: [P, A], title: 'The concierge desk',
        what: 'Built visibly, marked plainly, and not open.',
        steps: [
          'It takes no request it cannot fulfil.',
        ],
        note: 'It is waiting on contracted, vetted people rather than on code, so it carries no date. '
          + 'That is a different promise from “needs a credential”, and it is said differently.',
      },
      {
        shot: '34-notices', roles: [P, A, S], title: 'Notices',
        what: 'What the people running the pilot have said, kept out of your inbox.',
        steps: ['Read and move on. Nothing here needs a reply.'],
      },
    ],
  },
];

// The rules that hold everywhere, stated once at the end rather than repeated
// under every screen they govern.
const RULES = [
  ['Security is not a tier',
    'Every safety property is present at every plan, including the free one. Encryption at rest, '
    + 'two-factor, the second factor on the vault, the structural separation between scheduling and '
    + 'custody. A company holding passports cannot sell the lock separately from the box.'],
  ['Safety is never gated',
    'Arrival alarms, the duress signal and driver papers running out are never behind a plan. An '
    + 'arrival alarm only exists for a journey that exists, so recording a journey is not gated '
    + 'either — gating it would silence a panic button to sell a feature.'],
  ['AI never sends and never pretends',
    'Every AI ask returns a draft. A person sends. Nothing is filed, sent or booked by anything but '
    + 'a person, and the vault is off limits to it entirely — it refuses rather than asks.'],
  ['A thing you cannot see is absent, not refused',
    'A space you are not in returns *not found*, not *forbidden*. A private trip has no title, no '
    + 'destination and no dates rather than a redacted row. Being told what you are not allowed to '
    + 'see is itself information.'],
  ['Nothing is read back to you as a lock',
    'Reading anything already stored is never gated, and taking your records out is never gated. '
    + 'Dropping a plan never locks you out of your own records.'],
  ['A partial view says that it is partial',
    'A stand-in given one day’s access to a journey is told, in words and with a count, that they are '
    + 'not seeing all of it. Silently redacted data is worse than none — the reader assumes they are '
    + 'seeing everything and reports “there is no escort” to somebody who needed to know there was.'],
];

// ── Render ────────────────────────────────────────────────────────────────
const chip = (r) => `<span class="chip chip-${r}">${{ [P]: 'Principal', [A]: 'Assistant', [S]: 'Staff', [V]: 'Visitor' }[r]}</span>`;

function frame(name, caption) {
  if (!has(name)) return '';
  const cut = CROPPED.includes(name);
  return `<figure class="frame">
    <button class="shot" type="button" data-full="${name}" aria-label="Enlarge: ${esc(caption || name)}">
      <img src="${img(name)}" alt="${esc(caption || name)}" loading="lazy" decoding="async">
    </button>
    ${cut ? '<p class="cap">The top of a longer screen — it continues below the fold.</p>' : ''}
  </figure>`;
}

function lesson(l, ci, li) {
  const num = `${ci}.${li}`;
  return `<article class="lesson" id="l-${l.shot}" data-roles="${l.roles.join(' ')}">
    <header class="lesson-head">
      <span class="num">${num}</span>
      <div>
        <h3>${rich(l.title)}</h3>
        <p class="what">${rich(l.what)}</p>
      </div>
      <div class="chips">${l.roles.map(chip).join('')}</div>
    </header>
    ${frame(l.shot, l.title)}
    ${l.pair ? frame(l.pair, l.title + ' (continued)') : ''}
    <ol class="steps">${l.steps.map((s) => `<li>${rich(s)}</li>`).join('')}</ol>
    ${l.note ? `<aside class="note"><span class="note-label">Worth knowing</span><p>${rich(l.note)}</p></aside>` : ''}
  </article>`;
}

function clipBlock(c) {
  const p = path.join(DECK, 'clips', `${c.name}.webm`);
  if (!fs.existsSync(p)) return '';
  const kb = Math.round(fs.statSync(p).size / 1024);
  return `<article class="lesson is-clip" data-roles="${(c.roles || [P, A]).join(' ')}">
    <header class="lesson-head">
      <span class="num">▶</span>
      <div><h3>${rich(c.title)}</h3><p class="what">${rich(c.what)}</p></div>
    </header>
    <p class="cap">Screen recording · <code>${c.name}.webm</code> · ${kb}KB · delivered as a file
      alongside this course. No sound.</p>
  </article>`;
}

const chapters = CH.map((c) => `
  <section class="chapter" id="${c.id}">
    <header class="chapter-head">
      <span class="ch-num">Chapter ${c.n}</span>
      <h2>${rich(c.title)}</h2>
      <p class="blurb">${rich(c.blurb)}</p>
    </header>
    ${c.lessons.map((l, i) => lesson(l, c.n, i + 1)).join('')}
    ${c.clip ? clipBlock(c.clip) : ''}
  </section>`).join('');

const toc = CH.map((c) => `<li><a href="#${c.id}"><span class="toc-n">${c.n}</span>${esc(c.title)}</a>
  <ul class="toc-sub">${c.lessons.map((l, i) => `<li><a href="#l-${l.shot}">${esc(l.title)}</a></li>`).join('')}</ul></li>`).join('');

const count = CH.reduce((a, c) => a + c.lessons.length, 0);

const html = `<title>The Kairos Course</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- LOADED WITHOUT BLOCKING THE PAGE. A stylesheet link is render-blocking, so
     a reader whose network cannot reach Google — a corporate proxy, a bad
     connection, a region that blocks it — gets a blank page for as long as the
     request takes to give up. Measured here at 12.5 seconds of a 12.7 second
     load; with the request cut, the same page renders in 277ms. So it arrives
     as a print stylesheet, which the browser fetches without waiting for, and
     the script at the foot promotes it once the document is up. Every family
     below already declares a real fallback, so a font that never arrives costs
     the page its typeface and nothing else. -->
<link id="webfont" rel="stylesheet" media="print"
  href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --ink:#151A1D; --body:#33393B; --muted:#6B6659;
  --paper:#F5F2EC; --card:#FFFFFF; --mat:#FBFAF7;
  --line:#E1DDD2; --line-soft:#EDEAE2;
  --green:#3E6357; --green-deep:#22392F; --green-soft:#E7EFEB;
  --clay:#A8443A; --gold:#8A6A24;
  --rail:#22392F; --rail-ink:#EAE7DF; --rail-dim:#9FB3AA;
  --shadow:0 1px 2px rgba(21,26,29,.05), 0 8px 24px rgba(21,26,29,.05);
  --serif:'Newsreader',Georgia,'Times New Roman',serif;
  --sans:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ink:#EDEAE3; --body:#C6C2B8; --muted:#948E80;
    --paper:#12171A; --card:#1A2023; --mat:#F5F2EC;
    --line:#2C3437; --line-soft:#232A2D;
    --green:#7FB0A0; --green-deep:#0E1A16; --green-soft:#1B2A25;
    --clay:#D9776C; --gold:#C9A227;
    --rail:#0E1A16; --rail-ink:#E4E0D8; --rail-dim:#8AA79B;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 28px rgba(0,0,0,.35);
  }
}
:root[data-theme="dark"]{
  --ink:#EDEAE3; --body:#C6C2B8; --muted:#948E80;
  --paper:#12171A; --card:#1A2023; --mat:#F5F2EC;
  --line:#2C3437; --line-soft:#232A2D;
  --green:#7FB0A0; --green-deep:#0E1A16; --green-soft:#1B2A25;
  --clay:#D9776C; --gold:#C9A227;
  --rail:#0E1A16; --rail-ink:#E4E0D8; --rail-dim:#8AA79B;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 28px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--body);font-family:var(--sans);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}

/* ── masthead ─────────────────────────────────────────── */
.mast{background:var(--rail);color:var(--rail-ink);padding:56px 28px 44px}
.mast-in{max-width:1180px;margin:0 auto}
.eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--rail-dim);margin:0 0 14px}
.mast h1{font-family:var(--serif);font-weight:400;font-size:clamp(2.4rem,6vw,4.2rem);
  line-height:1.02;margin:0 0 16px;text-wrap:balance;letter-spacing:-.015em}
.mast .lede{font-size:1.08rem;max-width:60ch;color:var(--rail-ink);opacity:.88;margin:0 0 26px}
.mast-facts{display:flex;flex-wrap:wrap;gap:26px;font-family:var(--mono);font-size:.78rem;
  color:var(--rail-dim);border-top:1px solid rgba(255,255,255,.12);padding-top:18px}
.mast-facts b{display:block;font-family:var(--sans);font-size:1.5rem;font-weight:500;
  color:var(--rail-ink);line-height:1.2;font-variant-numeric:tabular-nums}

/* ── shell ────────────────────────────────────────────── */
.shell{max-width:1180px;margin:0 auto;padding:0 28px 96px;
  display:grid;grid-template-columns:236px minmax(0,1fr);gap:44px;align-items:start}
.rail{position:sticky;top:20px;padding-top:34px;max-height:calc(100vh - 40px);overflow-y:auto}
.rail h4{font-family:var(--mono);font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);margin:0 0 12px}
.toc,.toc-sub{list-style:none;margin:0;padding:0}
.toc>li{margin-bottom:10px}
.toc>li>a{display:flex;gap:9px;align-items:baseline;font-weight:600;font-size:.9rem;
  color:var(--ink);text-decoration:none;padding:3px 0}
.toc-n{font-family:var(--mono);font-size:.72rem;color:var(--green);flex:0 0 auto}
.toc>li>a:hover,.toc-sub a:hover{color:var(--green)}
.toc>li.on>a{color:var(--green)}
.toc-sub{margin:2px 0 0 22px;display:none}
.toc>li.on .toc-sub{display:block}
.toc-sub a{display:block;font-size:.82rem;color:var(--muted);text-decoration:none;padding:2px 0;
  border-left:1px solid var(--line);padding-left:10px;margin-left:-1px}
.toc-sub a:hover{border-left-color:var(--green)}

/* ── filter ───────────────────────────────────────────── */
.filter{margin:34px 0 0;padding:16px 18px;background:var(--card);border:1px solid var(--line);
  border-radius:12px}
.filter p{margin:0 0 10px;font-size:.84rem;color:var(--muted)}
.filter-count{font-family:var(--mono);font-size:.78rem;color:var(--green)}
.filter-row{display:flex;flex-wrap:wrap;gap:7px}
.fbtn{font:inherit;font-size:.8rem;font-weight:500;padding:5px 12px;border-radius:999px;cursor:pointer;
  background:transparent;color:var(--body);border:1px solid var(--line)}
.fbtn:hover{border-color:var(--green);color:var(--green)}
.fbtn[aria-pressed="true"]{background:var(--green);border-color:var(--green);color:#fff}
:root[data-theme="dark"] .fbtn[aria-pressed="true"],
:root:not([data-theme="light"]) .fbtn[aria-pressed="true"]{color:#0E1A16}

/* ── chapters ─────────────────────────────────────────── */
.chapter{padding-top:64px;scroll-margin-top:20px}
.chapter-head{border-top:2px solid var(--ink);padding-top:18px;margin-bottom:8px}
.ch-num{font-family:var(--mono);font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;
  color:var(--green)}
.chapter-head h2{font-family:var(--serif);font-weight:400;font-size:clamp(1.9rem,4vw,2.9rem);
  margin:6px 0 10px;color:var(--ink);letter-spacing:-.01em;text-wrap:balance}
.blurb{margin:0;max-width:62ch;font-size:1.02rem}

.lesson{background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:24px;margin-top:26px;box-shadow:var(--shadow);scroll-margin-top:20px;
  content-visibility:auto;contain-intrinsic-size:auto 760px}
.lesson[hidden]{display:none!important}
.lesson-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:start}
.num{font-family:var(--mono);font-size:.82rem;color:var(--green);padding-top:5px;
  font-variant-numeric:tabular-nums}
.lesson-head h3{font-family:var(--serif);font-weight:600;font-size:1.32rem;margin:0;color:var(--ink);
  letter-spacing:-.005em;text-wrap:balance}
.what{margin:5px 0 0;color:var(--muted);font-size:.94rem}
.chips{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.chip{font-family:var(--mono);font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;
  padding:3px 8px;border-radius:999px;background:var(--green-soft);color:var(--green);white-space:nowrap}

/* The screenshot always sits on a light mat, in both themes: these are
   pictures of a light interface, and floating one on a dark ground makes it
   glare like a torch. */
.frame{margin:18px 0 0;background:var(--mat);border:1px solid var(--line);border-radius:10px;
  padding:10px;overflow:hidden}
.shot{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in;border-radius:6px;
  overflow:hidden;line-height:0}
.shot img,.frame video{display:block;width:100%;height:auto;border-radius:6px}
.shot:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.cap{margin:8px 0 0;font-size:.78rem;color:var(--muted);font-family:var(--mono)}

.steps{margin:20px 0 0;padding:0;list-style:none;counter-reset:s}
.steps li{counter-increment:s;position:relative;padding-left:30px;margin-bottom:9px;font-size:.96rem}
.steps li::before{content:counter(s);position:absolute;left:0;top:1px;font-family:var(--mono);
  font-size:.72rem;color:var(--green);border:1px solid var(--line);border-radius:50%;
  width:20px;height:20px;display:grid;place-items:center}
.steps strong{color:var(--ink);font-weight:600}

.note{margin:20px 0 0;padding:14px 16px;background:var(--green-soft);border-radius:10px;
  border-left:3px solid var(--green)}
.note-label{font-family:var(--mono);font-size:.66rem;letter-spacing:.13em;text-transform:uppercase;
  color:var(--green);display:block;margin-bottom:5px}
.note p{margin:0;font-size:.92rem}
.note strong,.note em{color:var(--ink)}

/* ── the rules ────────────────────────────────────────── */
.rules{margin-top:26px;display:grid;gap:14px}
.rule{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;
  border-top:3px solid var(--green)}
.rule h3{font-family:var(--serif);font-weight:600;font-size:1.18rem;margin:0 0 7px;color:var(--ink)}
.rule p{margin:0;font-size:.95rem}

.cast{margin-top:22px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
.cast h3{font-family:var(--serif);font-weight:600;font-size:1.18rem;margin:0 0 4px;color:var(--ink)}
.cast dl{margin:14px 0 0;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:.93rem}
.cast dt{font-family:var(--mono);font-size:.8rem;color:var(--green);white-space:nowrap}
.cast dd{margin:0}

.foot{max-width:1180px;margin:0 auto;padding:40px 28px 80px;color:var(--muted);font-size:.86rem;
  border-top:1px solid var(--line)}
.foot strong{color:var(--ink)}

/* ── lightbox ─────────────────────────────────────────── */
.lb{position:fixed;inset:0;background:rgba(10,14,16,.94);z-index:60;display:none;
  padding:24px;overflow:auto}
.lb.on{display:block}
.lb img{display:block;max-width:1400px;width:100%;margin:0 auto;border-radius:8px}
.lb-close{position:fixed;top:16px;right:20px;font:inherit;font-family:var(--mono);font-size:.8rem;
  background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.25);
  padding:7px 14px;border-radius:999px;cursor:pointer}

@media (max-width:900px){
  .shell{grid-template-columns:1fr;gap:0}
  .rail{position:static;max-height:none;padding-top:26px}
  .toc-sub{display:none!important}
  .lesson-head{grid-template-columns:auto minmax(0,1fr)}
  .chips{grid-column:1/-1;justify-content:flex-start;margin-top:2px}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{
  .rail,.filter,.lb{display:none}
  .shell{display:block;padding:0}
  .lesson{break-inside:avoid;box-shadow:none}
  .mast{background:none;color:#000}
}
</style>

<header class="mast">
  <div class="mast-in">
    <p class="eyebrow">Kairos by Exousia · Training</p>
    <h1>How to use Kairos</h1>
    <p class="lede">Every screen in the product, photographed from the running build, with what it
      does and the moves that get you from arriving to having done something. Written to be worked
      through once and kept as a reference.</p>
    <div class="mast-facts">
      <div><b>${count}</b> lessons</div>
      <div><b>${CH.length}</b> chapters</div>
      <div><b>${fs.readdirSync(path.join(DECK, 'shots')).length}</b> real screens</div>
      <div><b>3</b> recordings <span style="opacity:.7">(files)</span></div>
    </div>
  </div>
</header>

<div class="shell">
  <nav class="rail" aria-label="Contents">
    <h4>Contents</h4>
    <ul class="toc">${toc}
      <li><a href="#rules"><span class="toc-n">·</span>The rules that never bend</a></li>
    </ul>
    <div class="filter">
      <p>Teaching one role? Show only what they need.</p>
      <p class="filter-count" id="fcount" aria-live="polite"></p>
      <div class="filter-row" role="group" aria-label="Filter by role">
        <button class="fbtn" type="button" data-role="all" aria-pressed="true">Everything</button>
        <button class="fbtn" type="button" data-role="principal" aria-pressed="false">Principal</button>
        <button class="fbtn" type="button" data-role="assistant" aria-pressed="false">Assistant</button>
        <button class="fbtn" type="button" data-role="staff" aria-pressed="false">Staff</button>
        <button class="fbtn" type="button" data-role="visitor" aria-pressed="false">Visitor</button>
      </div>
    </div>
  </nav>

  <main>
    <section class="chapter" id="how" style="padding-top:34px">
      <header class="chapter-head">
        <span class="ch-num">Before you start</span>
        <h2>How to use this</h2>
        <p class="blurb">Work down it once in order. After that, use the contents on the left, or the
          role filter if you are teaching one person one job.</p>
      </header>
      <div class="cast">
        <h3>The office in the pictures</h3>
        <p class="what">Every screenshot is of a real account with real records in it, because an empty
          screen teaches nothing. The same four people appear throughout.</p>
        <dl>
          <dt>Adaeze Okonkwo</dt><dd>The principal. A Lagos executive with a board trip to Abuja this week.</dd>
          <dt>Ngozi Bello</dt><dd>Her assistant. Keeps the diary, works the approvals, arranges the cars.</dd>
          <dt>Tunde Bakare</dt><dd>The driver. Has an account that shows him one thing: what he is doing today.</dd>
          <dt>Emeka Nwosu</dt><dd>Counsel, on the outside. Books time through the public page.</dd>
        </dl>
      </div>
      <div class="cast" style="margin-top:14px">
        <h3>Three things to know before the first screen</h3>
        <dl>
          <dt>Scoped</dt><dd>Almost every screen is scoped to <em>one principal</em>. The switcher in the
            navigation decides which, and changing it redraws the screen for them.</dd>
          <dt>Guided</dt><dd>Every feature carries its own note saying what it does and how to use it —
            open the first time you reach it, folded to one line after.</dd>
          <dt>Honest</dt><dd>Anything not working yet says so where it would appear, and says what it is
            waiting on. Nothing in Kairos offers a button that quietly does nothing.</dd>
        </dl>
      </div>
    </section>

    ${chapters}

    <section class="chapter" id="rules">
      <header class="chapter-head">
        <span class="ch-num">Finally</span>
        <h2>The rules that never bend</h2>
        <p class="blurb">These hold on every screen above, at every plan, for everybody. They are stated
          once here rather than repeated under each feature they govern.</p>
      </header>
      <div class="rules">
        ${RULES.map(([h, b]) => `<div class="rule"><h3>${rich(h)}</h3><p>${rich(b)}</p></div>`).join('')}
      </div>
    </section>
  </main>
</div>

<footer class="foot">
  <p><strong>Kairos by Exousia</strong> — Exousia Prime Emporium Ltd, Lagos. Every screenshot and
  recording in this course came out of the running build, driven through the real interface against a
  seeded account. Nothing here is a mockup, so a screen that changes shows as changed the next time
  this is rebuilt.</p>
  <p>Some features are named on their screens as not working yet. Where that is so, this course says
  which and what each is waiting on, rather than teaching something that will not happen.</p>
</footer>

<div class="lb" id="lb"><button class="lb-close" type="button" id="lbx">Close ✕</button><img id="lbi" alt=""></div>

<script>
(function(){
  // Promote the webfont now the page is drawn. See the comment on the link.
  var gf=document.getElementById('webfont'); if(gf) gf.media='all';

  // Lightbox: teaching from a screenshot means being able to read it.
  var lb=document.getElementById('lb'),lbi=document.getElementById('lbi');
  document.addEventListener('click',function(e){
    var b=e.target.closest('.shot'); if(!b) return;
    lbi.src=b.querySelector('img').src; lbi.alt=b.querySelector('img').alt; lb.classList.add('on');
    document.body.style.overflow='hidden';
  });
  function shut(){lb.classList.remove('on');lbi.src='';document.body.style.overflow='';}
  document.getElementById('lbx').addEventListener('click',shut);
  lb.addEventListener('click',function(e){if(e.target===lb)shut();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')shut();});

  // Role filter. A chapter with nothing left in it goes too, so the reader is
  // never scrolling past empty headings.
  var btns=[].slice.call(document.querySelectorAll('.fbtn'));
  btns.forEach(function(b){b.addEventListener('click',function(){
    var role=b.dataset.role;
    btns.forEach(function(o){o.setAttribute('aria-pressed',String(o===b));});
    document.querySelectorAll('.lesson[data-roles]').forEach(function(l){
      l.hidden = role!=='all' && l.dataset.roles.split(' ').indexOf(role)<0;
    });
    document.querySelectorAll('.chapter').forEach(function(c){
      var any=c.querySelector('.lesson[data-roles]');
      if(!any) return;
      var live=[].slice.call(c.querySelectorAll('.lesson[data-roles]')).some(function(l){return !l.hidden;});
      c.hidden=!live;
    });
    var all=document.querySelectorAll('.lesson[data-roles]');
    var shown=[].slice.call(all).filter(function(l){return !l.hidden;}).length;
    var out=document.getElementById('fcount');
    if(out) out.textContent = role==='all'
      ? 'Showing all ' + all.length + ' lessons.'
      : 'Showing ' + shown + ' of ' + all.length + ' lessons.';
  });});

  // Which chapter you are in.
  var links={};
  document.querySelectorAll('.toc>li>a').forEach(function(a){
    var id=a.getAttribute('href').slice(1); links[id]=a.parentElement;
  });
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(en){
        var li=links[en.target.id]; if(!li) return;
        if(en.isIntersecting){
          Object.keys(links).forEach(function(k){links[k].classList.remove('on');});
          li.classList.add('on');
        }
      });
    },{rootMargin:'-15% 0px -70% 0px'});
    document.querySelectorAll('.chapter[id]').forEach(function(c){io.observe(c);});
  }
})();
</script>`;

fs.writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB), ${count} lessons`);
