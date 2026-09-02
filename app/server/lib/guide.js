const capabilities = require('./capabilities');

// What each feature does, and how to use it — said on the feature itself.
//
// WHY THIS REPLACED THE NOTE ON TODAY. There was one panel, on the landing
// screen, listing four things worth trying in the first week. It had the two
// faults a single orientation note always has. It was read once, on the one
// screen that needed it least — Today explains itself — and it was silent
// everywhere else, so somebody who opened Correspondence or the Archive or the
// approvals queue got no help at the moment they actually had the question.
// And it aged: a list of four things could not grow with a product that now
// has thirty screens without becoming a document nobody finishes.
//
// So the guidance moved to where the work is, which is the same principle the
// AI asks already follow. Each feature says what it can do and how to use it,
// on itself, at the moment somebody is standing in front of it.
//
// TWO SENTENCES AND A SHORT LIST, never a tour. `does` is one sentence: what
// this thing is for, in the words somebody would use for it themselves. `how`
// is the two to four moves that get a person from arriving to having done
// something real. Anything longer is a manual, and a manual on a screen is a
// manual nobody reads.
//
// `note` is optional and is for the one thing that would otherwise be a
// surprise — who can see this, what it will not do, what it costs. It is not a
// place for more instructions.
//
// BUILT ON THE SERVER, and joined to the capability register below, for the
// reason capabilities.js gives: a screen that carries its own hardcoded
// guidance eventually describes a feature that has moved or been switched on.
// Anything on this screen that is not working yet is answered from the same
// register the notice itself reads, so the guidance and the truth cannot
// drift apart.
//
// `screen` names the capability screen this feature sits on, where there is
// one. Most features have none, because most features work.

const GUIDE = {
  // ---- The day -------------------------------------------------------
  today: {
    title: 'Today',
    does: 'The shape of one day — what is running now, what is next, and what is waiting on you.',
    how: [
      'Read the band at the top first: it tells you what is happening now and how long is left.',
      'The spine below is the day in order, with a marker showing where now sits in it.',
      'Anything needing a decision appears in the column on the right. Press it to deal with it.',
      'Use Plan the day to add or move something.',
    ],
    note: 'This screen is scoped to one principal. Switch principals in the nav and it redraws for them.',
  },
  catch_up: {
    title: 'While you were away',
    does: 'Everything that happened since you last looked, ordered by what would be worst to have missed.',
    how: [
      'Open it after any absence — a weekend, a flight, four days out.',
      'Decisions filed without you come first, because you are already working under them.',
      'Press any line to go to the thing itself.',
    ],
    note: 'Not scoped to one principal: an assistant who has been away has been away from all of them.',
    screen: 'catch_up',
  },
  itinerary: {
    title: 'Itinerary',
    does: 'The day planner: appointments, travel between them, and everything that is not a meeting.',
    how: [
      'Pick a day, then add what is happening — a meeting, a call, a school run, a block of quiet.',
      'Give something a place and the leg before it can be timed.',
      'Drag or use Move to shift an appointment; anybody affected is told.',
    ],
    screen: 'itinerary',
  },
  pad: {
    title: 'Pad',
    does: 'One line, captured before it is lost, and sorted out afterwards.',
    how: [
      'Type the thought and press enter. Nothing else is asked of you at that moment — that is the point.',
      'Come back later and turn a line into a task, a diary entry or a message.',
    ],
    note: 'Private by default. The toggle on each line says in words who can read it.',
  },
  trips: {
    title: 'Trips',
    does: 'A journey away — flights, hotels, the visas it needs and what shifts if it slips.',
    how: [
      'Build a trip, then add the legs and the stays.',
      'Check visas against the passports held in Essentials.',
      'When a leg moves, everything downstream of it is re-timed rather than left wrong.',
    ],
    screen: 'trips',
  },
  movements: {
    title: 'Movements',
    does: 'Getting the principal there on the ground — the journey, the car, and the driver who does it.',
    how: [
      'Add a journey with a pickup, a destination and a time.',
      'Assign a driver and a vehicle; the driver gets their own card with just that journey on it.',
      'The card can be opened without an account, so a driver does not need to be a user.',
    ],
    note: 'A driver sees only their own journey. They never see the diary it came from.',
  },
  calendar: {
    title: 'Calendar',
    does: 'The whole month at once, colour-coded, for the principal you are set to.',
    how: [
      'Use it to find the shape of a month rather than the detail of a day.',
      'Press any block to open the appointment.',
    ],
  },
  concierge: {
    title: 'Concierge',
    does: 'Somebody who takes a request and comes back with it done.',
    how: [
      'This one is not open yet, and it says so rather than taking a request it cannot fulfil.',
    ],
    note: 'Waiting on contracted people rather than on code, so it carries no date.',
    screen: 'concierge',
  },

  // ---- The desk ------------------------------------------------------
  workspace: {
    title: 'Workspace',
    does: 'What is outstanding across every principal you run, without picking one first.',
    how: [
      'Start your day here rather than in the switcher.',
      'Each line says whose it is; pressing it takes you there and sets the principal for you.',
    ],
  },
  desk: {
    title: 'The desk',
    does: 'Every section of the assistant\'s work for one principal, on one screen.',
    how: [
      'The overview shows all sections at once with what is waiting in each.',
      'Press one to open it. The tab strip then moves you between them.',
      'The whole desk button brings you back.',
    ],
  },
  approvals: {
    title: 'Approvals',
    does: 'Requests for the principal\'s time that need a decision before they become appointments.',
    how: [
      'Accept, decline, or counter with a different time.',
      'A counter goes back to whoever asked; they accept or counter again.',
      'Nothing lands in the diary until somebody has said yes.',
    ],
  },
  bookings: {
    title: 'Bookings',
    does: 'Everything already agreed, and what has been asked to change.',
    how: [
      'Open one to see who is coming, what was asked for, and any notes.',
      'Cancel or reschedule from here; whoever booked it is told.',
    ],
  },
  availability: {
    title: 'Availability',
    does: 'When the principal can be booked, and how much of it can be taken.',
    how: [
      'Set blocks per weekday. More than one block a day is allowed.',
      'Cap how many meetings any one block can take, so a free morning is not eaten whole.',
      'A breather after each appointment is set here and applies everywhere.',
    ],
    note: 'This decides what outsiders can see and book. It does not hide anything already in the diary.',
  },
  meeting_types: {
    title: 'Meeting Types',
    does: 'What the principal offers — a length, a format, and who is allowed to book it.',
    how: [
      'Create a type, set its length, and choose the tier that can book it.',
      'Each type has its own link. Copy it and send it to whoever should use that one.',
      'A higher tier means the request comes to Approvals rather than straight into the diary.',
    ],
  },
  contacts: {
    title: 'Contacts',
    does: 'Who the principal deals with, and what an assistant needs to remember about each of them.',
    how: [
      'Add a person, then add the things nobody writes down — how they take their coffee, who their assistant is.',
      'Birthdays and anniversaries go on the same record; the band at the top shows what is coming.',
    ],
  },
  briefs: {
    title: 'Briefs',
    does: 'The note the principal reads in the car — who they are meeting, and what is outstanding.',
    how: [
      'Build a brief against an appointment.',
      'What is already held about that person and that thread is pulled in rather than retyped.',
    ],
  },
  instructions: {
    title: 'Instructions',
    does: 'Standing instructions: what this principal always wants, so it is not asked twice.',
    how: [
      'Write the rule once — never Mondays before ten, always a window seat, no dinners in the week.',
      'Anybody working for this principal reads the same list.',
    ],
  },
  comms: {
    title: 'Comms',
    does: 'Messages going out on the principal\'s behalf, and whether they were approved.',
    how: [
      'Draft here. Nothing is sent by anything but a person.',
      'If you have been delegated to send, you send. If not, it goes to the principal to approve.',
    ],
    note: 'Approved or not, a draft is a draft: nothing leaves without somebody pressing send.',
  },
  ai_assist: {
    title: 'AI Assist',
    does: 'Finding a time in plain words, and a contents page for everything else Assist does.',
    how: [
      'Type when you want something — "an hour with Ade next week, mornings" — and it filters real open slots.',
      'The list below says what else Assist can do and which screen each one lives on.',
    ],
    note: 'Finding a time uses no model at all: it filters the same computed slots the booking page uses, so it cannot invent a time that does not exist.',
    screen: 'ai_assist',
  },
  report: {
    title: 'Report',
    does: 'What the period actually held — meetings, hours, who took them, and what moved.',
    how: [
      'Pick a period. The figures redraw for exactly that range.',
      'Use it to answer where the week went, not to find a particular meeting.',
    ],
    screen: 'report',
  },
  correspondence: {
    title: 'Correspondence',
    does: 'What has come in for the principal, and what each thing needs.',
    how: [
      'Read what has arrived and mark what it needs — the principal, you, later, or nothing.',
      'Draft a reply against a message; it stays a draft.',
    ],
    screen: 'mail',
  },

  // ---- Work ----------------------------------------------------------
  spaces: {
    title: 'Spaces',
    does: 'A place per piece of work, holding its rooms, its projects and the people in it.',
    how: [
      'Make a space, add the people who belong in it, then open a room to talk.',
      'A project inside a space has stages, and the stages move on what is decided in the rooms.',
    ],
    note: 'Spaces are sealed from each other. Being in one tells you nothing about any other.',
  },
  thread: {
    title: 'A room',
    does: 'A conversation with two registers: what was said, and what was decided.',
    how: [
      'Talk normally. Everything goes into the said register.',
      'When something is settled, promote that line into the record. It then cannot be edited.',
      'Turn a line into a task from the same menu.',
    ],
    note: 'Promoting is deliberate and permanent — that is what makes the record worth anything.',
    screen: 'thread',
  },
  space: {
    title: 'A space',
    does: 'One piece of work: its rooms, its projects, and the people allowed in it.',
    how: [
      'Open a room to talk, or a project to see where the work has got to.',
      'Add somebody to the space and they see it all; leave them out and they see none of it.',
    ],
    note: 'Membership is per space. Being in this one says nothing about any other.',
  },
  project: {
    title: 'A project',
    does: 'Work in stages, where the stages move on what was actually decided rather than on somebody ticking a box.',
    how: [
      'Give the project its stages.',
      'Each stage has its rooms. Promote a decision in one and the stage moves.',
      'A blocker filed in a room holds the stage until it is answered.',
    ],
  },
  appointment: {
    title: 'An appointment',
    does: 'One meeting in full — who is coming, what was asked for, the notes, and the minute afterwards.',
    how: [
      'Open it from Today or the Calendar.',
      'Add notes before, and the minute after.',
      'Move it from here and everybody affected is told.',
    ],
    screen: 'appointment',
  },
  operator: {
    title: 'The pilot',
    does: 'What testers have reported and what has gone wrong, for whoever is running the pilot.',
    how: [
      'Read what came in through Tell us, with the screen it came from.',
      'Faults are listed with their message; reports carry no one\'s written content.',
    ],
    note: 'Only accounts marked as running the pilot can reach this at all.',
  },
  tasks: {
    title: 'Tasks',
    does: 'Everything assigned to you, across every space and every principal.',
    how: [
      'Work down the list. A task carries where it came from, so you can open the room behind it.',
      'Give it a date and it will chase you.',
    ],
  },
  archive: {
    title: 'Archive',
    does: 'What the office decided was worth keeping after the rooms it was said in had finished.',
    how: [
      'Keep a message from a room and a copy lands here, safe from that room being deleted.',
      'Archive a document and the original is filed here rather than copied.',
    ],
  },

  // ---- The house -----------------------------------------------------
  household: {
    title: 'Household',
    does: 'The staff at home — what each was told, and whether they have said they got it.',
    how: [
      'Add the driver, the cook, the housekeeper.',
      'Send an instruction to one of them and watch for the acknowledgement.',
    ],
    note: 'An instruction nobody acknowledged is a hope, not an instruction. That is the whole feature.',
  },
  my_instructions: {
    title: 'My instructions',
    does: 'What you are doing today, and one tap to say you have got it.',
    how: [
      'Read the list. Press Got it on each.',
      'That is the whole screen, on purpose.',
    ],
  },
  connections: {
    title: 'Connections',
    does: 'Reaching the assistant on the other side, when two principals need to be in a room.',
    how: [
      'Get their handle from a signature or from them directly, and add it.',
      'Once connected you can propose times across both diaries.',
    ],
    note: 'There is no search here and there never will be — a directory of who runs whom is itself the sensitive thing.',
  },

  // ---- Account -------------------------------------------------------
  essentials: {
    title: 'Essentials',
    does: 'The details an assistant is asked for constantly — passport numbers, air miles, seat preferences.',
    how: [
      'Add one detail. It is encrypted before it is stored.',
      'Grant a specific person access to a specific kind of detail, not to all of it.',
      'Opening this asks for the principal\'s code, every time.',
    ],
    note: 'AI never reads or writes here, under any instruction. The vault is off limits to it entirely.',
    screen: 'vault',
  },
  settings: {
    title: 'Settings',
    does: 'Your name, your timezone, your handle, and how the app reaches you.',
    how: [
      'Set your timezone first — every time on every other screen is drawn from it.',
      'Connectors shows what this deployment has been given credentials for.',
    ],
    screen: 'settings',
  },
  security: {
    title: 'Security',
    does: 'Who is signed in as you, on what, and the codes that guard the sensitive parts.',
    how: [
      'Review signed-in devices and sign out any you do not recognise.',
      'Set the access code that guards Essentials, and the security question that guards signing others out.',
    ],
    note: 'No code is asked for at sign-in. Codes guard sensitive features, not the front door.',
  },
  members: {
    title: 'Team',
    does: 'Appointing the people who work for you, and deciding what each of them can reach.',
    how: [
      'Invite by handle. They accept and appear in your team.',
      'Set what each one can do — scheduling only, or scheduling and the rest.',
      'A delegate handling scheduling does not get the sensitive detail.',
    ],
  },
  outbox: {
    title: 'Outbox',
    does: 'Every message Kairos has sent on your behalf, and whether it actually went.',
    how: [
      'Use it to check that an invitation or a reminder really left.',
      'On a deployment with no mail credentials it shows what would have been sent.',
    ],
  },
  notices: {
    title: 'Notices',
    does: 'What the people running the pilot have said, kept out of your inbox.',
    how: ['Read and move on. Nothing here needs a reply.'],
  },
  coming: {
    title: 'Coming',
    does: 'Everything designed but not working yet, and exactly what each one is waiting on.',
    how: [
      'Read it to know what is real today and what is not.',
      'An entry saying "needs a key" is waiting on this deployment. One saying "soon" is waiting on us.',
    ],
  },
};

/** One feature, with anything on its screen that is not working yet. */
function forFeature(id) {
  const g = GUIDE[id];
  if (!g) return null;
  return {
    id,
    title: g.title,
    does: g.does,
    how: g.how,
    note: g.note || null,
    // Joined here rather than fetched separately so a screen makes one request
    // and cannot end up showing guidance for a feature it has just been told
    // is unavailable.
    notYet: g.screen ? capabilities.list(g.screen).filter((c) => !c.available) : [],
  };
}

/** Every feature, for a contents page or a test that walks the lot. */
function list() {
  return Object.keys(GUIDE).map(forFeature);
}

module.exports = { forFeature, list, IDS: Object.keys(GUIDE) };
