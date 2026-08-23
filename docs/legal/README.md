# Legal drafts

Two documents, written against what the code in this repository actually
does rather than against a template:

- `privacy-policy.md`
- `terms-of-service.md`

## Read this before publishing either of them

**These are drafts. They have not been reviewed by a lawyer, and I am not
one.** They are accurate about the software — every claim about what is
stored, encrypted, shared or deleted was checked against `app/server/schema.sql`
and the code that writes to it — but being accurate about the software is
only half of a legal document. The other half is whether the obligations,
carve-outs and liability positions are right for a Nigerian company holding
identity documents for high-net-worth individuals, and that needs somebody
qualified.

Budget for a review by:

1. **A Nigerian-qualified data protection lawyer**, on NDPR compliance —
   including whether Exousia needs to file an annual audit return with the
   NDPC, and whether a Data Protection Officer must be designated.
2. **Someone on EU/UK GDPR**, the moment a principal or booker is in Europe.
   Both are reached by the public booking page from day one, so this is
   likelier than it sounds.

## Decisions the drafts could not make for you

Each is marked `[DECIDE]` in the text. They are commercial or operational
choices, not writing problems:

| Decision | Where | Notes |
|---|---|---|
| Registered address | Both | Exousia Prime Emporium Ltd's registered office |
| Contact address for privacy requests | Privacy §12 | A monitored mailbox, e.g. `privacy@` |
| Governing law and venue | Terms §14 | Lagos assumed; confirm |
| Retention period after account closure | Privacy §7 | 30 days is drafted; pick deliberately |
| Whether a DPO is designated | Privacy §12 | NDPR may require it given the data class |
| Paid plans, pricing, refunds | Terms §5 | Drafted as free-for-now; rewrite when charging |
| Where the database physically sits | Privacy §8 | Depends on your Render region — check it |

## Keeping them true

The value of these documents is that they describe this system, so they go
stale when the system changes. Re-read them when any of the following
happens, because each one changes a factual claim in the privacy policy:

- A new table storing personal data is added to `schema.sql`
- A capability in `app/server/lib/capabilities.js` goes live — particularly
  **document scans**, **transcription**, **inbound email** and **the
  concierge desk**, each of which introduces either a new category of data or
  a new third party
- The email, hosting, video or maps provider changes
- Analytics or any third-party script is added to the client (there are none
  today, and the privacy policy says so)
