# What was built

Banana Detailing's CRM started as a copy of a window-cleaning CRM. This is what changed
on the way to a car-detailing one, in the order it happened.

## Made it a separate app

- **Own storage namespace.** All keys moved `servicepro.*` → `banana.*`. Chrome shares one
  `localStorage` store across every `file://` page, so without this the two CRMs would have
  overwritten each other. Legacy-key migration disabled so it can never adopt the other
  CRM's data.
- **Stripped 379 lines of the original owner's data and business shape** — a baked-in list
  of ~190 real customers with phone numbers, three one-off data imports, the commissions
  leaderboard, and startup "repairs" aimed at their records (one of which deletes every
  lead on first run).
- **Rebranded** throughout: title, sidebar wordmark, favicon, theme colour.

## Detailing, not window cleaning

- **Service catalogue** rewritten — Express Wash & Wax through Ceramic Coating, ten
  services with prices.
- **Vehicle** is a first-class field on every job, shown on job cards and the week strip,
  and prefilled from that client's last job.
- **Car-make suggestions** on the vehicle field: "merc" or "benz" both reach
  Mercedes-Benz. Only the word under the cursor is replaced, so "2019 merc" becomes
  "2019 Mercedes-Benz".
- **Two parsing bugs** inherited from the original: "interior"/"exterior" were swallowed as
  notes before the service matcher ran, so an interior detail silently became a Full
  Detail; "washed" shadowed the Express Wash & Wax keyword.

## Schedule

- **Rolling 7-day strip**, ported from the owner's own Flyra app rather than guessed at:
  horizontal day columns, jobs as cards with time / name / price, blue booked, green done.
  Seven days from the selected day, not a fixed week.
- **Double-tap a day** to book into it — new job, new client, that date filled in.
- Day view and the month grid were both built and then removed on request.

## Jobs

- **New job starts with a new client typed inline** (name, phone, address), with
  "Existing client instead…" to pick from the book. Opening from a client's card, or
  editing, starts on the picker.
- **Services list instead of one service.** A row per service with its own price, `×` to
  drop it, "＋ Add service…" for upsells, running total. `j.services` is the truth;
  `j.service` and `j.price` stay in step as the joined name and the sum, so every existing
  reader keeps working.
- **Book / ✓ Completed / ↩ Not done** replaced "Save Job". Undoing a completion clears the
  collected amount and logs what it was.
- **Call · Text · Confirm** moved to the top of the client and job sheets.
- Removed: Status, Pay method, Collected, Mark paid in full, the quote sheet and its
  signature pad, the Remind button, text templates, AI quick add, the side-panel buttons.

## Client confirmation

- **Confirm button texts the client** a short message plus a link. The booking rides in the
  link itself, base64url-encoded — no server, no database.
- **Hosted confirmation page** carrying the mark, the booking, the price and the terms,
  themed in the brand's brown / cream / butter.
- **14-clause service terms**, modelled on real detailing agreements and liability waivers:
  scope, access and utilities, personal belongings, condition on arrival, extra work quoted
  first, achievable results, mechanical and electrical exclusion, a liability cap, weather,
  cancellation, lateness, payment, photo consent, and what confirming means.
- **Late-cancellation fee** is a Settings field. It fills the terms and shows as its own
  line with the actual amount for that booking.
- **On Agree** the page emails the business a written record and opens an SMS receipt back
  to them.
- **Auto-confirm**: a small Cloudflare worker (`relay/`) takes the client's agreement and
  the CRM polls it every minute, ticking the job by itself.

## Money and reporting

- **$5,000 per month goal**, replacing a $50k annual one. Each month stands on its own
  against it rather than accumulating.
- Greeting rotates between the owner's name and a few nicknames.

## Groundwork

- **Sample data** — five clients and a week of jobs so nothing looks broken on first open,
  every record tagged, with a one-click wipe in Settings that removes exactly those.
- **Test gate** — `node tests/run-tests.js`, 67 checks, no dependencies. Covers dates,
  money, the catalogue, the seed, the confirm payload, settings backfill, and assertions
  that the removed features stay removed.
- **Installable** — manifest and icons, so it adds to a phone's home screen properly.
- **Published** at `reflex08.github.io/banana-detailing/`, separate from the owner's own
  business repo.

## Bugs found and fixed along the way

- Confirmation emails silently never sent: `normalize()` backfilled some business fields
  but not `notify`, so the link carried an empty address and the page skipped the send.
- Seeding never ran for anyone whose database had already been saved empty.
- `closeJob()` read a field that does not exist while a new client is being typed.
- The confirmed tick disappeared once a job was completed.
- Day columns bound both `click` and `pointerup` for iOS, so one tap arrived twice.
