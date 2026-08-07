# WORD SANCTUARY GLOBAL (WSG)
## Master Blueprint

**WSOS · GLOBAL · Super Admin**
The Multi-Installation Ministry Operating Platform
*Exousia Prime Emporium Ltd*

---

> **Honest note on this document:** This Blueprint consolidates real architectural decisions and real code that were produced across an earlier build conversation. It distinguishes clearly between what was **CONFIRMED & BUILT**, what was **DECIDED but not yet built**, and what was **STILL OPEN** when that conversation ended. Nothing here is invented or assumed beyond what was actually established.

---

## Contents

1. [What This System Is](#1-what-this-system-is)
2. [Technical Architecture](#2-technical-architecture)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Shared Infrastructure — What Connects the Three Apps](#4-shared-infrastructure--what-connects-the-three-apps)
5. [What Was Actually Built — Real Code, Not Just Architecture](#5-what-was-actually-built--real-code-not-just-architecture)
6. [GLOBAL App — Full Feature Set (as scoped)](#6-global-app--full-feature-set-as-scoped)
7. [Where Features Belong — The Discipleship Tracker Precedent](#7-where-features-belong--the-discipleship-tracker-precedent)
8. [Strategic Position — Why This Should Not Be Sold](#8-strategic-position--why-this-should-not-be-sold)
9. [Consolidated Open Questions Before Resuming Build Work](#9-consolidated-open-questions-before-resuming-build-work)

---

## 1. What This System Is

Word Sanctuary Global (WSG) is not one application — it is a connected platform of three distinct apps, sharing one backend, one database, and a real-time broadcast layer. It exists to run the entire multi-installation ministry as a single, connected system, rather than as separate, disconnected tools per installation.

This is a fundamentally different and larger system than Sanctum (the single-service "Church OS" covering Service Builder, AI Storyboard, and Kingdom Intelligence for running one service well). WSG is about running the whole ministry — every installation, every member, every leader — as one connected platform.

### 1.1 The Three Apps

| App | Purpose | Identity / Theme |
|---|---|---|
| **Word Sanctuary OS (WSOS)** | Internal church management — operations for each WSL installation | Blue — pastoral, operational |
| **GLOBAL** | Online community app — for members joining from anywhere, no church code required | Cyan — warm, member-facing, belonging |
| **WSG Super Admin** | Platform control layer — oversight and override across all installations | Gold / Navy — authority |

> **CONFIRMED & BUILT:** The three-app identity, purpose split, and colour theming above were explicitly confirmed in the build conversation, including the reasoning: *"WSG Admin (gold/navy) is authority, WSOS (blue) is pastoral/operational, GLOBAL (cyan) is community and belonging."*

---

## 2. Technical Architecture

### 2.1 Stack

| Layer | Technology |
|---|---|
| Frontend (Web) | React |
| Frontend (Mobile) | React Native |
| Backend | NestJS + Node.js |
| Database | PostgreSQL — single, multi-tenant |
| Real-time | Socket.io |
| Authentication | JWT, hybrid — separate per app, with a WSG master key |
| File Storage | AWS S3 |
| Payments | Paystack + Flutterwave + Stripe — all three, confirmed |
| Notifications | FCM (push), Termii (SMS), SendGrid (email) |

> **CONFIRMED & BUILT:** This entire stack table reflects explicit confirmed decisions from the build conversation, not assumptions — including the specific choice of all three payment gateways rather than starting with one, and AWS S3 (rather than Cloudflare R2) for file hosting.

### 2.2 Database Strategy

Single PostgreSQL database, multi-tenant, with row-level security enforced per installation. This was a deliberate choice over separate databases per installation — it allows WSOS and GLOBAL to report cleanly into WSG while keeping each installation's data properly isolated at the application layer.

> **CONFIRMED & BUILT:** *"Recommendation confirmed: single PostgreSQL database, multi-tenant, row-level security per installation."* The risk noted at the time: a bug could theoretically expose one installation's data to another — mitigated by NestJS guards enforcing row-level security policies.

### 2.3 Authentication Strategy

Each app was designed to have its own independent login system rather than one shared login across all three:

- A Word Sanctuary Lagos member logs in with WSL credentials that only work on WSOS.
- A GLOBAL member logs in with GLOBAL credentials that only work on GLOBAL — no church code required.
- A WSG Admin logs in with WSG credentials, valid only on the Super Admin platform, carrying a master key for override access across all installations.

> **STILL OPEN:** The authentication strategy explanation had just been given, with Option A (separate auth per app) presented as the recommended path, when the captured thread ends. Final explicit sign-off on this option — as opposed to a shared or single-sign-on alternative — should be confirmed before backend auth work resumes.

---

## 3. Monorepo Structure

A single repository containing all three apps and their shared packages, confirmed and scaffolded:

```
wordsanctuary/
├── apps/
│   ├── wsos/          (html, css, react, nodejs, nestjs)  — port 3001
│   ├── global/        (html, css, react, nodejs, nestjs)  — port 3002
│   └── wsg-admin/     (html, css, react, nodejs, nestjs)  — port 3003
└── packages/
    ├── shared-types/       TypeScript types used across all apps
    ├── shared-ui/          Shared React components
    ├── broadcast-service/  WebSocket broadcast infrastructure
    └── auth/               Shared authentication utilities
```

> **CONFIRMED & BUILT:** This exact structure was scaffolded with real directories created via bash — not merely planned. Each app folder contains `html`, `css`, `react/src` (components, screens, hooks, context, utils), `nodejs` (routes, controllers, middleware, services, config), and `nestjs/src` (modules, guards, dto, entities, services, config).

> **DECIDED, NOT YET BUILT:** A root `README.md` and `package.json` were drafted with quick-start commands (`npm run dev:all`, `npm run dev:wsos`, etc.) and a database setup sequence (`npx prisma migrate dev`, `npx prisma db seed`) — confirming Prisma as the intended ORM/migration tool, though this was not separately debated as its own decision point.

---

## 4. Shared Infrastructure — What Connects the Three Apps

### 4.1 Shared Types

A `shared-types` package defines TypeScript interfaces used identically across WSOS, GLOBAL, and WSG Admin, so the three apps never disagree about the shape of the same data. Confirmed real interfaces include `Participant` (memberId, installationId, appType, joinedAt), `ChatMessage`, `ParticipantCount` (with per-app breakdown), and `AnnouncementPayload` (for platform-wide announcements with scope and installation targeting).

### 4.2 The Broadcast Service — Cross-App Real-Time Layer

This is the most architecturally important shared piece, and the one with working demonstrated code: a session (for example, a prayer session) started from any one of the three apps broadcasts live, via Socket.io, to all three simultaneously.

- WSG Super Admin can start a session that broadcasts globally — to all apps.
- A GLOBAL CEO or Minister can start a session for the GLOBAL app, or optionally broadcast to all apps.
- A WSL HOI or Pastor can start a session that broadcasts to their own installation's WSOS by default.
- Any HOI can start a session scoped to their installation only.

Regardless of which app a member joins from, they see the same chat feed, the same prayer points, and the same live participant count. Attendance is logged separately per app per member — so a Lagos member's attendance is recorded in WSOS, and a GLOBAL member's attendance is recorded in GLOBAL, even though it is the same shared session.

> **CONFIRMED & BUILT:** This is not just a design decision — a working `PrayerScreen.tsx` was actually built and demonstrated, connecting to a shared Socket.io `/prayer` namespace, with real event handlers for session start, join, chat, attendance updates, and session end. This is the clearest evidence of genuine cross-app functionality, not just planning.

---

## 5. What Was Actually Built — Real Code, Not Just Architecture

This section lists only what real, working code was produced and verified in the build conversation. See the accompanying code handoff document for the actual files.

### 5.1 GLOBAL App

- Theme tokens — confirmed cyan identity (accent `#3FC6D9`), fully specified colour palette for ink, surface, text, and status colours.
- `AuthScreen.tsx` — a combined login/register screen, deliberately simpler than WSOS's (no church code required), with a toggle between sign-in and join modes.
- `PrayerScreen.tsx` — a fully wired live Prayer Room screen, connected to the shared broadcast Socket.io namespace, with session start/join/chat/end all implemented.
- `index.html` and `manifest.json` — PWA-ready entry files, themed and titled correctly ("Word Sanctuary GLOBAL — Church Without Borders").

### 5.2 WSOS App

- `index.html` and `manifest.json` — PWA-ready entry files ("Word Sanctuary OS — Church Management System").
- NestJS backend `package.json` — dependencies confirmed and listed (see code handoff), including `auth`, `broadcast-service`, and `shared-types` as internal linked packages.

> **STILL OPEN:** No WSOS screen-level UI code (equivalent to GLOBAL's `AuthScreen` or `PrayerScreen`) was found in the captured thread. The GLOBAL app is further along in actual screen implementation than WSOS at this point.

### 5.3 WSG Super Admin App

> **STILL OPEN:** No Super Admin-specific screen code was found in the captured thread beyond its inclusion in the monorepo scaffold and its role in the broadcast/auth architecture. This app appears to be the least implemented of the three at the point this thread was captured.

---

## 6. GLOBAL App — Full Feature Set (as scoped)

Referenced as a complete standalone app scope, distinct from WSOS upgrades:

- Member portal
- Integration journey — a structured onboarding path for new GLOBAL members
- Preliminary classes
- Department system
- Follow-up module
- Integration score — tracking how embedded a member becomes in the community over time
- CEO / Minister / HOD dashboards
- Chatbot guidance
- Giving portal

> **DECIDED, NOT YET BUILT:** This feature list was explicitly scoped and confirmed as "complete standalone app" content, alongside a parallel note that WSOS itself needed upgrades: GLOBAL visible as a distinct installation type, integration funnel metrics, and at-risk member counts. None of these individual features have confirmed working code beyond `AuthScreen` and `PrayerScreen`.

---

## 7. Where Features Belong — The Discipleship Tracker Precedent

A useful worked example exists for how to decide which app a new feature belongs in, established when a Discipleship Tracker request was being placed correctly:

| Question Asked | Answer | Conclusion |
|---|---|---|
| Is the data internal WSL operations, or public-facing? | Internal — HODs are internal WSL leaders | Not GLOBAL |
| Is this administrative (platform-wide) or operational (one installation)? | Operational — FTG tracking and foundation training progress is installation-level data | Not WSG Super Admin |
| Where do the intended users (HODs) already work? | WSOS | WSOS |

The reusable principle: **internal + operational + installation-scoped → WSOS**. **Public-facing + community → GLOBAL**. **Platform-wide + administrative → WSG Super Admin**. This same test should be applied to any future feature request before deciding which app it belongs in.

---

## 8. Strategic Position — Why This Should Not Be Sold

In a later strategic review of Bassileou's full venture portfolio, this system was assessed as follows:

| Assessment | Finding |
|---|---|
| Current state | 106-file NestJS + React + PostgreSQL monorepo, fully scaffolded, real backend architecture across three distinct apps |
| Sellable today? | Yes — the most technically substantial asset in the portfolio |
| Realistic value if sold | ₦15M – ₦60M+, depending on buyer |
| Strategic cost of selling | Very high — this is Word Sanctuary's own operating infrastructure |
| Verdict | Do not sell under any circumstances |

The reasoning: this is the nervous system of the ministry's own operations. Even if a buyer allowed continued use post-sale, the ministry would become dependent on an external party for its own operational infrastructure — a strategic risk that outweighs any sale price.

---

## 9. Consolidated Open Questions Before Resuming Build Work

Pulled together from across the captured thread — these should be resolved before backend or further screen work resumes:

1. **Final sign-off on the authentication strategy** — separate auth per app (Option A) was recommended and being explained, but explicit confirmation was not captured.
2. **WSOS screen-level UI** — no equivalent to GLOBAL's `AuthScreen`/`PrayerScreen` exists yet; WSOS needs its own screen implementation pass.
3. **WSG Super Admin screens** — essentially unbuilt at the UI level; needs its own dedicated design and build pass.
4. **Confirm Prisma as the ORM** — implied by the migrate/seed commands in the README draft, but not separately debated as its own decision.
5. **Confirm current build status** — this Blueprint reflects a snapshot from a past session; a fresh check of what exists on disk or in a live repository is recommended before assuming this scaffold is still the latest state.

---

*Word Sanctuary Global (WSG)*
*Master Blueprint · WSOS · GLOBAL · Super Admin · Exousia Prime Emporium Ltd*
