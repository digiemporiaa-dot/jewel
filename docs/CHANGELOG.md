# Changelog

## The checkout email field was blank for the people who had already given it · 2026-08-26

One prop was missing. `app/(storefront)/checkout/page.tsx` fetched the customer
and passed their name and their verified status, but never passed
`customer.email` — so `CheckoutClient` initialised the field to `''` with
nothing able to fill it, and the OTP step had already disabled the box. A
signed-in customer saw an empty field they could not type into.

It only became fatal when email became required. The empty string went into
Razorpay's prefill, the widget validated it at open time, and the customer got
"Enter a valid email" on the screen they were trying to pay on — with no field
anywhere they could correct it.

### Pre-filled, and locked only when it is proven

`customerEmail` and `verifiedEmail` are separate props because they answer
different questions. `customerEmail` is the address on the record and decides
what the field starts with. `verifiedEmail` is whether an OTP has proven it, and
only that locks the field.

Three states, and each behaves differently on purpose:

| | field | asks for a code |
|---|---|---|
| verified | pre-filled, **read-only**, "Not you?" | no |
| on record, never verified | pre-filled, **editable** | yes |
| nothing on record | empty, **editable**, required | yes |

Locking an *unverified* address would be the wrong call: it is a starting point
somebody may need to correct, and checkout is the one moment they are looking
at it. Locking a verified one is right for the opposite reason — retyping it
here would send the confirmation somewhere the account cannot be signed into,
and leave the account's own address stale.

### `readOnly`, not `disabled`

A disabled input drops out of the tab order, cannot be selected or copied, and
reads to a screen reader as unavailable — none of which is true of a value that
is present and correct. It also renders greyed out, which looks like a broken
form rather than a settled field.

The locked field keeps full-strength ink on a faint tint with a slightly firmer
border. Measured in the browser: `rgb(22, 21, 19)` on `rgb(241, 236, 228)` —
legible at a glance as fixed rather than washed out.

Changing it is a link to `/my-account`, not an inline edit. The address is the
sign-in identifier; editing it mid-order would leave the account pointing at the
old one.

### The prefill is read back, not passed forward

`prefill.email` was `d.contactEmail || ''` — the form value, and an empty string
when the form had none. It now reads the customer row:

```ts
prefill: { …, email: await storedEmail(customerId, d.contactEmail), … }
```

`storedEmail` falls back to the submitted value rather than to an empty string,
because a blank prefill is the exact failure this exists to prevent. The
best-effort write above it is now **awaited** — it was fire-and-forget, and the
read could lose that race, which would put a legacy customer's newly collected
address into their record but not in front of them at the payment widget. It
still swallows its own errors, so a contested phone number cannot fail an order
that is ready to pay.

The legacy backfill needs no new code: that same write already saves the
collected address, so the next visit pre-fills.

### Two smaller things found alongside

The place-order button did not check the email at all, so an empty required
field just moved the failure to the payment screen. And the error for a missing
session still said "Please verify your phone number first", which stopped being
true when email became the identifier.

### The lock is tied to the value, not to the claim

`emailLocked` requires a non-empty field as well as a verified session.

The prop wiring alone would have been enough to fix the reported bug, but the
half that made it unrecoverable was not the blank field — it was that the blank
field could not be typed into. Deriving the lock from `verifiedEmail` alone
leaves that reachable in principle: any future path that produces a session
claiming a verified address while the field is empty gets a customer with
nothing to pay with and no way to fix it. Requiring a value means an empty box
is always editable, whatever the session claims, and the test suite reconstructs
the original bug to prove it fails.

### Verified in a browser

```
GUEST                     value ""                         readOnly false  required true   OTP asked
SIGNED IN, VERIFIED       value "co-…@example.com"          readOnly true   disabled false  no OTP
                          ink rgb(22,21,19) on rgb(241,236,228)   "Not you?" → /my-account
```

and an order placed end to end on the pre-filled address reached
`/order/MJ20260826-BFF16A` with no validation error anywhere.

The two remaining states — an address on record that was never verified, and a
signed-in customer with no address at all — are defensive branches that the live
UI cannot currently reach, because a session can only be established by
verifying an email. They are covered by rendering `CheckoutClient` directly with
those props.


## Email is the identifier; the phone is required and unproven · 2026-08-26

Both are mandatory at every path that creates a customer. Only one of them is
verified, and it is no longer the one it used to be.

### The identifier moved

Sign-in was a code sent to a mobile number. It is now a code sent to an email
address — on `/signup`, at checkout, and on the account page. `Customer.email`
carries a new `emailVerified` flag and is what a session is keyed to.

`phoneVerified` stays, and stays `false` for everyone created from now on. It is
not dead weight: it is the honest record of which numbers were ever actually
proven, and the customers verified before this change should not silently lose
that.

### Both columns stay nullable, and that is the point

`Customer.phone` was `String @unique`, NOT NULL. It is nullable now. Every form
and every server action requires both fields; the columns record what is
actually true. A NOT NULL phone column would have either failed the migration or
forced a fabricated number onto a real record — and a fabricated phone number is
worse than a missing one, because somebody eventually dials it.

`emailVerified` is added defaulting to false and **is not backfilled**. Nobody's
address had been proven at the moment of the migration, and inventing that on
the field sign-in now depends on would be the one lie that actually matters
here.

### Phone validation, because nothing else will catch it

A number nothing verifies is a number a courier finds out about. There were
**four** implementations of "is this an Indian mobile" in the codebase — in
`lib/sms/provider.ts`, in the checkout schema, in the spin action, and in the
signup schema — each slightly different, and none of them able to tell a real
number from `9999999999`.

There is one now, in `lib/validations/phone.ts`, and the other three import it.
`lib/sms/provider.ts` re-exports it rather than defining it, so `lib/otp.ts` and
the gateway clients did not have to move.

It does three things a regex did not:

- **Normalises.** `+91 98100 12345`, `098100-12345` and `919810012345` all
  become `9810012345`. Ten digits, not the gateway's `91`-prefixed form —
  every `Customer` row and every `where: { phone }` in this codebase uses ten
  digits, and switching would have orphaned all of them behind a key nothing
  looks them up by.
- **Formats for display.** `+91 98100 12345` in the admin; the column keeps its
  ten digits.
- **Refuses placeholders.** One digit repeated, and ascending or descending runs
  — which is how `9876543210`, the placeholder mobile number of the entire
  Indian internet, gets in. Nothing else is guessed at: a filter working on a
  hunch turns a paying customer away at checkout, and that is the worse failure.

### Codes go where they can arrive

`OTP_CHANNELS` lists the channels a code may be sent on, defaulting to email
alone. `lib/otp.ts` gained an email branch beside the SMS one — the phone path
is unchanged and comes back the day the variable includes it. Until then a
phone target is refused with a sentence that says to use email, rather than a
code that silently never arrives.

An unparseable value falls back to email rather than switching everything off. A
typo in an environment variable must not disable sign-in.

### Where the line moved at checkout, and where it did not

Email and phone are required on the order form now. Gender, date of birth and
anniversary are still refused there, and
`tests/profile-not-required-at-checkout.test.ts` still fails if anybody adds
them — a customer holding a ₹70,000 cart is not asked for their birthday.

One assertion in that file was reversed on purpose, and says so in place: it
used to prove an order could be placed with no email. It cannot, because an
order with no address leaves a customer who cannot get back into the account
the order is attached to.

### Chasing the records that predate the rule

The admin customer list gained a **Missing email or phone** filter and shows the
gap on the row — a formatted number or "No phone", the address or "No email",
and small badges for the rest of the profile. Every path that creates a customer
now requires both, so anything on that list was made before the rule: by the old
phone-only checkout, or by the spin wheel, which asks for a number and nothing
else.

**The wheel was left asking for a number alone.** Adding an email box to a
pop-up that interrupts somebody is a different decision from requiring one on a
form they chose to open, and it was not part of this change. Its rows appear on
the chase list, which is what that list is for. It does now use the shared phone
rule, so it can no longer mint a coupon bound to `9999999999`.

### Two collisions this creates, and what happens

A customer who ordered through the old phone-only checkout has a record keyed on
their number with no address on it. When they sign up by email, a second record
is made — and their number is already taken by the first.

That is **refused with a message that puts a person in front of it**, not merged.
Merging two customers means moving orders, carts, wishlists, reviews and won
coupons between them, and getting it wrong loses somebody's purchase history.
The Prisma unique-violation catch now reads which column lost the race, because
telling somebody their email is taken when it was their phone sends them to
change the wrong field.

At checkout the same write is attempted and allowed to fail quietly, falling
back to saving the name and email alone. A number already held by another record
must not block an order that is otherwise ready to pay.

### Verified end to end

Against a running production build, with SMTP unconfigured so the code goes to
the mail log:

```
step 1 asks for       : Email address
code delivered        : yes, to test-…@example.com
step 2 asks for phone : true
junk phone refused    : true      (9999999999)
real phone accepted   : true      (+91 98100 12399)
```

and the row it wrote:

```
emailVerified : true          phone         : "9810012399"
phoneVerified : false         termsAcceptedAt: set
```

The admin list: 19 customers, 10 on the missing-details filter, every one of
them genuinely missing something, phones rendered `+91 98100 12345`.

### Two protected files were edited

`lib/otp.ts` and `lib/sms/provider.ts` are on the do-not-touch list, and both
changed. Neither could be avoided: email cannot be OTP-verified without a
delivery branch in the first, and "reuse the existing normaliser" cannot be done
from a client component while the second is `server-only`. Both edits are
additive — the SMS dispatch path is untouched, and the provider's exported
surface is identical.


## The logo is on the site now, not only in the database · 2026-08-26

`StoreSetting.logoUrl` had been a column since the schema was written. The
admin had a field for it, the field uploaded to storage, the value saved — and
the header rendered `{store.brandName}` as text and ignored it. So did the
footer. An operator could upload a logo, watch it save, and find the site
unchanged, with no reason to suspect the field rather than the file.

That is the worse failure mode. A missing field is a gap somebody reports; a
field that saves and does nothing is one they believe is done.

### What was actually missing

Two of the four items in the report were already wired, and it is worth saying
which, because the fix is smaller than it looked:

- **The favicon was already feeding page metadata** (`app/layout.tsx`), and the
  admin was **already using the shared `ImageUploadField`** rather than a plain
  URL box. Both were done earlier in this project.
- **The logo was rendered nowhere visible.** It reached `Organization.logo` in
  the structured data and stood in as the OG image fallback — so it was "used"
  in a grep and invisible on the page.

### One mark, both ends of the page

`components/layout/BrandMark.tsx` takes a brand name and an optional logo and
renders whichever exists. Three things it has to get right:

**Height, never width.** A logo arrives at whatever aspect ratio the brand has.
Fixing the width squashes a wide wordmark and balloons a tall crest. Fixing the
height matches how the wordmark it replaces was sized and lets the width fall
out of the artwork. Confirmed against a 600×120 file: rendered 200×40 on
desktop and 140×28 on mobile — the same 5:1, both times.

**The box is the same size either way.** The wrapper reserves the height before
anything loads, so a logo arriving late cannot push the nav down. Measured with
a logo and without: header 101px on mobile and 226px on desktop in both states,
with `<main>` starting at the identical offset.

**The brand name keeps its job.** It is the `alt` text, so the mark is still
readable to a screen reader and still says something if the file 404s; it is
still the OG site name and the structured-data name; and it is still what
renders when there is no logo.

Both header layouts are wired — there are two `<Link>` blocks, a mobile row and
a desktop one, and doing only the one you happen to be looking at is the easy
mistake. A test counts them.

The header is `relative`, not sticky, and has no scrolled variant, so there is
no second background for the logo to survive. Said here rather than silently
skipped.

### The footer is velvet, and that matters

A mark drawn in a dark brand colour passes every inspection in a white header
and then vanishes on the footer. `StoreSetting.logoUrlDark` exists for that,
falling back to `logoUrl` — which is right for the many logos that are already
light or reversed.

The migration adds the column nullable and **does not backfill it from
`logoUrl`**. Copying the value across would be a lie dressed as a default: it
would claim somebody had checked the logo against a dark background when nobody
had.

### Caught at upload, not in production

The admin now previews each logo on a light swatch and a dark one, side by side,
because the form itself is white and that is exactly the inspection a
disappearing logo passes. It also measures the file: under 200px on the long
edge, it says the logo will look soft in the header. An SVG is exempt — it is
resolution-independent, and calling it blurry would be wrong.

Verified in the admin against three files: an 80×24 PNG measured and warned, a
600×120 PNG measured and passed, an SVG measured and passed.

### The favicon, checked rather than assumed

`faviconMetadata` is split out of the root layout so the rule can be asserted:
an unset favicon emits **no** `icons` key at all. `icon: ''` would resolve to
the current URL, so the browser requests the page as its own icon and shows a
blank tab — worse than the built-in default it replaced. Live: three icon links
with a favicon set, zero without.


## The wheel now stops on the prize it announces · 2026-08-26

The pointer was resting between two segments. Three separate causes, each able
to produce that on its own, and all three were live.

### 1. Position was derived from display text

```ts
const index = Math.max(0, segments.findIndex((s) => s.label === res.label));
```

A label is not an identity. Two segments may legitimately share one — "Better
luck next time" twice is an ordinary wheel — and an operator editing a label
between a page loading and a customer spinning breaks the match. When the search
missed, `Math.max(0, -1)` turned the miss into segment 0 and the wheel animated
confidently to the wrong prize while the dialog announced another.

The draw now returns a **position**. `pickSegmentIndex` gives the index into the
campaign's ordered segment list, `SpinOutcome` carries it as `segmentIndex`, and
the animation uses it directly. The label travels alongside for display only.

The client checks the position is real before using it — an integer, in range —
and cross-checks the label at that index as a tripwire for the two lists having
drifted apart. The label is never used to *find* the wedge; it only reports that
the wheel rendered here and the wheel weighted there are no longer the same
wheel. When either check fails, the animation is skipped and the result panel is
shown directly, with the mismatch logged. A wheel that skips its flourish is a
small disappointment; a wheel that points confidently at the wrong prize on a
page awarding real money is something else.

### 2. Every label was drawn a quarter-turn from its own wedge

The wedge colours come from a `conic-gradient`, which starts at 12 o'clock —
where the pointer is — so segment `i` is centred at `i·slice + slice/2`. The
label element is `inset-0` with its text pushed to the right edge, so before any
rotation it already sits at **3 o'clock**. Rotating it by the midpoint alone
added 90° to a position that was already 90° round.

Measured in a browser on a six-segment wheel: every label rendered exactly 90°
clockwise of the wedge it named. The pointer came to rest on the correct
*colour* every time — and the *text* under it belonged to a segment two places
away. Where the offset was not a whole number of wedges (three, five and nine
segments) the text under the pointer straddled a boundary, which is precisely
"the pointer stops between two segments".

`labelRotation` subtracts the 90° the layout already contributes. The flip that
keeps left-hand labels the right way up is judged on the rotation the text
actually receives, not on the midpoint — those now differ, and using the wrong
one turns half the wheel upside down.

### 3. The wheel idled on a boundary

`useState(0)`. Zero degrees is not the centre of segment 0; it is the edge
before it. So before any spin the pointer sat exactly half a slice off centre —
and it stayed there for anyone whose spin was **refused**. Already spun, rate
limited, bad number: the error path sets the phase back to idle and never sets a
rotation, so the customer pressed the button and watched a pointer sitting
between two prizes on a wheel that had not moved at all. That is the version of
this bug most customers would have met.

The wheel now idles at `restingRotation(0, count, 0)`, with the first wedge
centred. Rotation is `null` until a spin decides otherwise, so "no spin yet" is
a state rather than a coordinate that happens to be wrong.

### The arithmetic lives somewhere it can be checked

`lib/spin/geometry.ts` holds all of it, pure. `tests/spin-geometry.test.ts`
asserts, for 3, 4, 5, 6, 8 and 9 segments and every segment of each: the winning
midpoint lands within a degree of the pointer; it clears both wedge boundaries;
each segment gets a distinct angle; each label sits on its own wedge; and the
reduced-motion path lands on the identical angle modulo 360, differing only by
the whole turns nobody can see. `pointerOffsetDegrees` is written as an
independent inverse rather than a restatement, so the test checks the maths
instead of echoing it.

Both defects were reintroduced deliberately to confirm the tests fail: the old
label rotation fails 6 assertions, an off-by-half-a-slice resting angle fails 13.

### Verified in a browser, twice over

Every segment of every wheel size, wedge colour sampled under the pointer and
the nearest label measured: **35 of 35 correct, 0° off centre**. With the
shipped label rotation restored, the same harness reports the right colour and
the wrong text for all of them.

Then against the running app, on the real twelve-segment campaign — comparing
the label under the pointer with the `SpinResult` row the server wrote:

```
MATCH awarded "₹500 off"   | pointer on "₹500 off"   (0° off centre)
MATCH awarded "₹900 off"   | pointer on "₹900 off"   (0° off centre)
MATCH awarded "₹700 off"   | pointer on "₹700 off"   (0° off centre)
MATCH awarded "₹700 off"   | pointer on "₹700 off"   (0° off centre)
MATCH awarded "₹1100 off"  | pointer on "₹1100 off"  (0° off centre)
MATCH awarded "₹400 off"   | pointer on "₹400 off"   (0° off centre)
```

An earlier run of the same check is what exposed the third cause: seven spins
matched at 0°, and the eighth — rejected by the rate limit, so never animated —
reported 15° off centre on a wheel whose slice is 30°. Exactly a boundary.


## The courier assigned a waybill; we recorded "undefined" · 2026-08-26

Shiprocket assigned AWB 14112366393092 via Xpressbees Surface and moved the
shipment to READY TO SHIP. Our admin recorded `AWB assigned: undefined
(undefined)` and left the panel showing PENDING and dashes. The API call worked.
Only our reading of the reply failed.

### Why it was silent

The client destructured one assumed shape:

```ts
const data = await this.api<{ response: { data: { awb_code: string; courier_name: string } } }>(...)
return { awb: data.response.data.awb_code, courier: data.response.data.courier_name };
```

Shiprocket does not always answer that way — the nesting varies with
`awb_assign_status`, with shipments that already carry an AWB, and between
courier types. When it differed the destructure produced `undefined`, and
`undefined` went into the `Shipment` row.

That is where it went quiet. Prisma reads an `undefined` field as *"leave this
column alone"*, so the update succeeded, changed nothing, and reported success.
The row kept its nulls, the panel rendered them as dashes, and the order looked
like one where nobody had pressed the button yet — while a courier was on the
way to collect it. The only visible trace was the timeline, and only because
template literals are less forgiving than Prisma: interpolating `undefined`
prints the word.

The type signature was load-bearing in the wrong direction. `AwbResult.awb` was
`string`, so TypeScript believed a value was always there and never asked the
caller what to do if it was not.

### Look everywhere; return null when it is not there

`lib/shipping/parse.ts` searches each known nesting — `response.data`, `data`,
`tracking_data.shipment_track[0]`, the envelope itself — for each known spelling
— `awb_code`, `awb`, `awb_number` — and returns `null` when none of them holds
anything usable. Scope order beats key order: a reply that carries the real
answer under `response.data` may also have a stale generic field of the same
name at the top level.

It rejects `"undefined"` and `"null"` arriving as *text*, which is not
hypothetical — an encoder upstream turning a missing value into a string is the
same bug one hop earlier, and it should not survive the hop.

The tracking envelopes are in that same scope list rather than being unwrapped
at each call site, because the recovery path below reads a *tracking* reply to
repair an *assignment*: both shapes have to be legible to one reader.

`AwbResult`, `CreateShipmentResult` and `PickupResult` are nullable now. The
compiler asks the question the old types answered for it.

### Nothing half-written

No AWB in the reply means no write at all. The shipment stays `PENDING`, no
timeline entry claims an assignment, the whole reply body goes to the log once
at error level so the actual shape is visible, and the admin says what happened
and what to do about it. A silently stored `undefined` is worse than a visible
failure: the failure is recoverable in a minute, the silence is discovered when
a customer asks where their order is.

The same applies to the other three calls, which had the same assumption:

- `createShipment` refuses to save a row with no courier reference — `orderId`
  is unique on `Shipment`, so a useless row would block every retry
- `schedulePickup` no longer turns a missing date into `new Date()`, which
  presented today as the courier's answer; null is the truth and renders as a dash
- `track` reads the head of `shipment_track` when it is there and the envelope
  when it is not, falling back to `UNKNOWN` — which maps to `PENDING` — rather
  than moving an order on evidence we do not have

The timeline note is now written from the row after it is saved, not from the
provider payload. That is what made the old note able to announce an assignment
that never landed.

### Repairing the order that exposed this

"Refresh from courier" on the Shipment panel re-reads the AWB, courier and
status using the shipment reference stored when the shipment was created. It is
deliberately not "Refresh tracking", which needs an AWB before it can ask about
one — useless precisely when the AWB is the thing that went missing.

Without it the only route to a correct row would be booking a second shipment
against an order a courier is already collecting.

Where a shipment exists with no waybill the panel now says so in words —
"AWB not recorded — check the courier dashboard" — because a row of dashes reads
as "nothing has happened yet". Timeline entries written before this fix are
scrubbed at render, so the historical record stays intact without showing staff
the word "undefined".

### Verified

Driven through the browser against a stubbed courier, on an order set up to
match the live one — a shipment with a provider reference, no AWB, and the
`AWB assigned: undefined (undefined)` entry in its timeline:

```
BEFORE          panel says "undefined": false   AWB row shows a dash: true
                warning note shown: true        timeline: AWB assigned: — (—)
NO-AWB REPLY    refused with a reason: true     still PENDING: true
                tells staff what to do: true
AFTER REFRESH   AWB now shown: true             courier now shown: true
                warning note gone: true
                timeline: AWB assigned: 14112366393092 (Xpressbees Surface) — recovered from the courier
```

The database-backed tests mark themselves *skipped* without Postgres rather than
returning early and reporting green — an early return makes a suite that proves
nothing look identical to one that passed, which is the same shape of mistake as
the bug it is testing. Confirmed by pointing them at a stopped database, and by
removing the guard under test and watching all six fail.


## A wrong password should not lock the courier account · 2026-08-26

`SHIPROCKET_PASSWORD` was wrong in production. Every press of "Create shipment"
called `/auth/login` again, every call counted as another failed attempt, and
Shiprocket eventually answered:

```
{"message":"User blocked due to too many failed login attempts.","status_code":403}
```

The API user was locked, which needs Shiprocket's support to undo, and blocks
every order rather than the one being worked on. Separately, each failure threw
out of the server action and replaced `/admin/orders/[id]` with "We hit an
unexpected snag", so staff lost the order they were reading as well.

Two defects, and the second was hiding the first: with the page gone, nobody
could see what the courier had actually said.

### The request is the damage

`lib/shipping/auth-breaker.ts` is a small state machine that decides when to
stop asking. After two consecutive credential refusals it opens for fifteen
minutes; a reply saying the account is *blocked* opens it for an hour, on the
first sighting rather than the second — waiting for a second attempt would spend
another login on an account that is already locked, which can only extend the
lockout.

Transient failures — a 500, a timeout, a gateway error — never open it. Refusing
to ship for an hour over the provider's bad afternoon would be its own outage.
They also do not *reset* the count: a 500 arriving between two 401s is no
evidence the password became correct. Only a successful login clears it.

The trade being made is explicit. A shipment delayed until somebody fixes a
password is recoverable in minutes; a locked account is recoverable only through
somebody else's support queue.

The token cache moved from the instance to module scope, keyed off the `exp`
claim in the token rather than a guessed hour, and concurrent callers now share
one in-flight login instead of each starting their own. Reading `exp` is not a
signature check and must not be mistaken for one — the only decision made from
that number is when to ask for a new token.

### Three failures, three different sentences

`HTTP 401` in an admin panel tells whoever is standing at the counter nothing.
Each case now says who can fix it:

- **locked** — only Shiprocket support can clear it, and retrying makes it worse
- **wrong credentials** — names `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD`
- **their outage** — try again shortly, and no cooldown is imposed

Where attempts are paused the message says until when, in IST, so nobody stands
there clicking a dead button. The provider's raw body is logged, not displayed.

### One guard, not six

Five of the six shipment actions carried their own `try`/`catch`. The sixth —
"Create shipment", the one staff press first — did not, which is why a courier
error reached the root error boundary. All six now share one `guarded()`
wrapper. The defect was never the missing `catch`; it was that a `catch` could
go missing at all, so a seventh action written next year gets this for free.
`tests/shipping-auth.test.ts` fails if any exported action stops routing through
it — checked by reintroducing the original bug and watching the test go red.

The reconciliation cron stops its whole pass on a login refusal rather than
carrying on through the queue. Two hundred shipments meant two hundred failed
logins in a single run, which made the cron a faster route to a lockout than the
admin buttons ever were.

### Measured, not assumed

Six presses of "Create shipment" against a courier stubbed to refuse, driven
through the real server, the real action and the real error boundary — before
the fix and after:

| | before | after |
|---|---|---|
| logins sent to Shiprocket | 6 | 1 |
| error boundary hit | 6 / 6 | 0 / 6 |
| order still on screen | 0 / 6 | 6 / 6 |
| message shown to staff | none | names the cause and the fix |

With a plain wrong password rather than a lockout, the same six presses send two
logins and stop. With working credentials, one login, one shipment, and the
button correctly disappears.


## A second door for the Shiprocket webhook · 2026-08-26

Shiprocket's webhook dashboard refuses to save any URL whose text contains
"shiprocket", "sr" or "kr", answering "Address is not allowed". Our endpoint
lived at `/api/webhooks/shiprocket`, so the integration could not be registered
with them at all — not a fault in the endpoint, which exports POST, is publicly
reachable and authenticates on `x-api-key`, but in their input validation.

`/api/webhooks/logistics` is the same endpoint under a name their form accepts.
Two characters is a short banned substring, so the name is checked in
`tests/webhook-alias.test.ts` rather than trusted: the test asserts the served
path against all three, and asserts the constant it checks is the folder that
actually serves it — otherwise a rename would leave the check passing against a
string nothing routes.

### One handler, two routes

The alias re-exports:

```ts
export { POST } from '../shiprocket/route';
export const dynamic = 'force-dynamic';
```

Nothing is copied. A change to token comparison, event recording or status
mapping lands on both paths or neither, which is the point — a duplicated
handler would take the next fix on one path only, and nobody would notice until
a delivery status stopped moving. The segment config is declared rather than
re-exported because Next reads it by static analysis of the segment's own file
and does not follow re-exports.

The original path is untouched and still works. Anything already pointed at it
keeps working.

### Idempotency spans both paths

Both record `provider: 'shiprocket'`, so the event key is the same on either
door. Verified against a running build: the same event delivered to `/logistics`
and then to `/shiprocket` produced one `WebhookEvent` row with `attempts: 1`, the
second call answering `{"ok":true,"duplicate":true}`. A provider retry that
lands on the other path is recognised, not processed twice.

Both paths were exercised end to end and behave identically — 401 with no token,
401 with a wrong one, 400 on malformed JSON, 200 on a valid event, and a
duplicate on replay.

### Note on the domain

Their validator reads the whole URL, not the path. A deployment domain
containing "sr" or "kr" would be refused whatever the route is called; that is
documented in `DEPLOYMENT.md` and `VERCEL.md` next to the URL to paste.


## Spin wheel: an exit that works, and a palette that reads · 2026-08-26

### The win screen had no way out

Winning a prize left the customer stuck. The losing branch closed the dialog;
the winning branch — the one that matters — offered a "Start shopping" link that
navigated underneath a dialog that never unmounted.

To be precise about what was and wasn't broken: the `done` cookie *was* being
written. `spinAction` sets it server-side the moment a prize is awarded, so a
customer who reloaded the page never saw the wheel again. What failed was
narrower and only visible in the tab you were already in — the dialog stayed
mounted, and `notifyCookieChange()` fired only from inside `close()`, so the
client hook kept serving the pre-spin value for the rest of that session.

Both branches now share one exit:

```ts
const finish = useCallback((href?: string) => {
  close('done');
  if (href) router.push(href);
}, [close, router]);
```

One function, two callers, no branch that can forget. The win screen also gained
a "Copy code" button — a coupon you can see but not select is a coupon you
retype wrong — and a line saying the code is saved to the account, because the
old screen implied the code existed only for as long as it was on screen. The
clipboard call degrades quietly: on an insecure origin `navigator.clipboard` is
undefined and the button simply stays "Copy code" rather than claiming a copy
that never happened.

### Twelve colours, each one checked

`SEGMENT_COLOURS` held five. A twelve-segment wheel — the schema maximum — wrapped
around and put `paper` next to `paper`, which reads as one fat wedge rather than
two prizes. The list is now twelve, exactly the maximum, so the fallback cycle
never wraps and no wheel can repeat a colour.

The five originals are unchanged in name and position. One changed in substance:
`brass` shipped with white label text at **3.58:1**, below the 4.5:1 WCAG AA
threshold for normal text. It now takes ink at **5.10:1**. That was a live defect
in the existing palette, not something the new colours introduced.

`tests/spin.test.ts` computes relative luminance and contrast for every pairing
rather than trusting a comment next to the hex, and asserts the cycle is
collision-free at every segment count the schema permits.

### The marquee stopped claiming a timestamp

The rate strip carried "as on <date>" next to each rate. A scrolling marquee is
the wrong surface for a precise claim: it moves, it truncates on narrow screens,
and the reader has no way to hold it still and check. The stamp is gone from the
strip; the rates remain.

Where the timestamp actually matters it is untouched. The product page price
breakup panel — the surface where a price is committed to — still shows
"Rate as of …" against the rate that priced that item. That panel is static,
expandable, and tied to a specific number, which is what a timestamp needs to be
useful rather than decorative.

The staleness guard is independent of the display and stays: a rate too old to
trust still suppresses the strip entirely rather than scrolling a stale number.

The admin `showTimestamp` toggle is removed rather than left switched to nothing
— a control that changes no pixel is the same lie the dead campaign switches
told. `RateTickerSettings.showTimestamp` stays in the schema, documented as no
longer read, so the operator's stored preference survives if the strip ever
wants it back.


## A complete customer profile · 2026-08-25

Gender joins name, email and date of birth as a required field on `/signup` and
in the My Account prompt. Anniversary stays optional.

### The column stays nullable

`Customer.gender` becomes a `Gender` enum — `MALE | FEMALE | OTHER` — and stays
**nullable**, even though the form requires it. Every customer created by the
checkout OTP path before the profile form existed has no gender, and a NOT NULL
column would either fail the migration or force a fabricated value onto a real
person's record. The requirement lives in the form and the server action; the
column reflects what is actually known.

Existing free-text values move across only where they map cleanly — `male`/`m`/
`man`, `female`/`f`/`woman`, `other`/`o`/`non-binary`. Anything ambiguous becomes
null rather than being guessed into a bucket, because a wrong value here is worse
than a missing one: it looks like an answer the customer gave.

### Checkout is untouched, and that is load-bearing

Profile completion belongs on `/signup` and `/my-account`. A customer with a
₹70,000 cart being asked for their date of birth before paying is an abandoned
cart, and every existing customer has an incomplete profile by definition.

`tests/profile-not-required-at-checkout.test.ts` is the guard rail rather than a
comment: it asserts the checkout schema contains no profile field, that profile
fields sent to it are stripped rather than honoured, and — by reading the source —
that neither `lib/orders.ts` nor the checkout action ever consults gender, date
of birth or anniversary. It fails the moment somebody adds one.

Confirmed in a browser too: a customer with null gender, null date of birth, null
email and null name completed checkout and placed order `MJ20260825-ABC039`.

### The prompt is dismissible now

It was not before, which was wrong for a banner aimed almost entirely at people
who never filled in a form and never agreed to anything. It closes, stays closed
for the visit, and says plainly that none of it is needed to place an order.
Dismissal lives in `sessionStorage`: somebody returning next week probably meant
"not now" rather than "never", and a `localStorage` entry would hide it for good
on a shared machine.

### DPDP

Each field states its purpose beside itself — date of birth for a birthday offer,
anniversary for an anniversary offer, gender for relevant recommendations — and
those strings are shared with the tests so the promise and the field cannot
drift. Marketing consent stays a separate unticked box: collecting a date of
birth is not consent to be marketed to. An under-18 date of birth still gets an
account and still gets no marketing consent.

### Verified, not assumed

The campaign cron was run against real values: `{"birthdays":1,"anniversaries":1}`
— both fired, and the legacy record with nulls and no opt-in correctly received
nothing.

## Admin datetimes are IST, and the terms box is real · 2026-08-25

### The scheduling bug

A `datetime-local` input submits a bare wall clock — `2026-08-25T14:26` — with
no offset on it. `new Date(thatString)` therefore parsed it in the *container's*
timezone, which in production is UTC. A campaign the shop set for 2:26 PM did
not start until 7:56 PM IST, and an active, correctly configured wheel simply
did not appear on the storefront.

`lib/utils/datetime.ts` now owns both directions: every admin-entered wall clock
is read as IST and stored as the UTC instant it names, and every stored instant
is rendered back into IST for the input. What the shop types is what the shop
sees.

Applied everywhere one of these fields is read or written — spin campaigns,
coupon start/end, CMS scheduled publish, blog publish date, CRM follow-up due
date. There were already **four** copies of `toLocalInput` scattered across those
screens, which is the drift this consolidates; all four are gone.

Each field is now labelled **IST**, because a bare "Starts" box gives a shop no
way to know which clock it is answering in — which is how this went unnoticed.

**Not** fixed with `TZ=Asia/Kolkata` on the container. That would move every date
comparison in the app at once, including the many already written against UTC:
the birthday match in `lib/campaigns`, the IST day buckets in
`lib/admin/date-range`, the UTC-midnight dates of birth. It would hide the same
bug elsewhere rather than fix it here.

A fixed +05:30 offset is correct rather than a shortcut — India has observed no
daylight saving since 1945 and has one zone, so `Intl` gymnastics would buy
nothing and add a way to be wrong.

Verified against the reported case: `2026-08-25T14:26` stores as
`2026-08-25T08:56:00.000Z`, reads back as `2026-08-25T14:26`, and the campaign is
active at 14:30 IST.

### Terms and conditions

The signup form now requires accepting the Terms & Conditions and Privacy
Policy, with both linked. Acceptance is stored as `Customer.termsAcceptedAt` — a
timestamp rather than a boolean, because the question that gets asked later is
*which version* somebody accepted, and a `true` cannot answer it. Null stays null
for the records created implicitly by an OTP at checkout: nobody showed those
customers any terms, and backfilling a consent they never gave would be worse
than leaving the gap visible.

Required is enforced in the schema, not only by the browser's `required`
attribute — a form post can skip the browser entirely.

**Marketing consent stays a separate, optional, unticked box.** Folding it into
the required one was the obvious simplification and is the one thing that must
not happen: the DPDP Act wants that consent free and specific, and consent nobody
could refuse without losing their account is neither. It would also have quietly
emptied the birthday campaign's audience, which only ever writes to customers who
opted in. A test asserts that accepting the terms leaves `marketingOptIn` false.

## The wheel is the shop's now, and four holes are closed · 2026-08-24

### Security

**Unauthenticated order tampering.** `abandonPayment` took an order id and no
proof of anything, and `confirmCheckoutPayment` guarded ownership with
`if (customerId && order.customerId && …)` — which passes whenever either side is
null. Both reach `markPaymentFailed`, which releases the order's reserved stock
and flips it to FAILED, so anyone holding an order id could kill a stranger's
in-flight checkout. `abandonPayment` had no callers at all, which is worth saying
plainly: **an exported server action is a live endpoint whether or not anything
in the app calls it.** Every order created through checkout has a `customerId`,
so both now demand a match and fail closed.

**A spin could steal an established customer's turn.** Typing a real customer's
number into the popup consumed the one spin they were entitled to and minted a
coupon in their name. A number that has been through OTP now has to sign in;
numbers the shop has never seen keep the frictionless path the design is for.

**Junk customer rows from probing.** The record was created before the per-phone
and per-IP limits ran, so a thousand probes left a thousand rows. It is created
inside `spin`, once every limit has passed. Soft-deleted rows are no longer
reused either — an erased customer must not be reattached by a stranger typing
their old number.

**An email-enumeration oracle.** `completeSignup` had no rate limit and answers
"already registered" truthfully, so one verified session could test any address
against the customer list. Limited per customer and per IP.

Also: `setSpinCookie` is no longer exported, for the same reason as
`abandonPayment`.

One thing I looked for and did not find: the security headers were already
complete in `next.config.mjs` under `source: '/(.*)'`. An earlier version of this
change added them again in middleware, which only produced a duplicate HSTS
header with a weaker max-age. Reverted.

### A prize could be lost

Closing the wheel mid-spin destroyed the only copy of a code that had already
been issued and could never be won again. Closing now reveals the prize instead —
the result screen it lands on is itself dismissible, so nothing is trapped — and
won offers are listed on `/my-account`, so a modal is no longer the only place a
code exists.

### The wheel is the shop's

Eyebrow, heading, subheading, button label, win and lose wording, an extra terms
line, an image, the popup background and a colour per segment, all from the
admin. Every field is plain text or a fixed token: no HTML box, no CSS box, no
colour picker. Tailwind cannot see a class built by interpolation, so a free
colour field would be missing from the stylesheet as well as being an injection
surface — the tokens resolve to literal hex on the server, paired with a readable
text colour so contrast is not left to whoever picks a shade.

**Existing coupons can go on the wheel.** A segment can borrow its terms from a
coupon created in the Coupons screen. It is a *template*: the terms are read when
somebody wins and a fresh single-use code is minted, locked to the winner's
number. Handing out the shared code would produce one coupon every winner holds,
bound to nobody. The scope and cap are re-checked at win time, not only when the
campaign was saved, so editing that coupon afterwards cannot smuggle an
order-total discount onto the wheel; a coupon that has become unusable records a
loss rather than crashing.

### Three things the screenshot showed that the tests did not

The pointer and the wheel rim were fixed velvet, and vanished entirely the moment
a shop could choose a velvet popup. Labels past 180° rendered upside-down — which
is where half the prizes on a five-segment wheel sit. And the dwell trigger
counted from whenever the campaign query returned rather than from page load.

`activeCampaign` is now cached under a tag busted on save; it was a database
query on every page view for every visitor who had not dismissed the wheel.

## Spin to win, without the dark patterns · 2026-08-24

A wheel offering up to 10% off a first order. Two rules decide the whole design.

### The server picks the prize

The browser asks to spin, the server draws, mints the coupon and returns the
result, and the animation eases to the segment it was told about. A
client-chosen outcome would be a fairness problem and a way to mint yourself a
coupon, in that order of how it would be found and the reverse order of what it
would cost.

`randomInt(0, totalWeight)` is crypto-grade and, taking an integer bound, has no
modulo bias. `pickSegment` walks the cumulative range and clamps an out-of-range
roll — falling through the loop would have made every stray roll win the last
prize, a rigged wheel produced by an off-by-one.

The advertised odds come from the same weights the draw uses, so the disclosure
cannot drift from what happens. Weighted odds are permitted under the CCPA
dark-pattern guidelines; misrepresenting them is not. Four wheels are refused
outright by the schema: one with a segment of weight zero (drawn, shown, and
unwinnable), one where a single segment holds all the weight, one where every
outcome wins, and one with fewer than two segments.

Losing spins are recorded. Without them the results screen would report a 100%
win rate and the odds actually delivered could never be checked against the ones
advertised.

### A prize is a real coupon, and the scope is the money

Everything goes through the existing coupon engine — same validation at
checkout, same redemption counting, same audit trail. A second discount path
would be a second place for a ₹40,000 mistake to live.

`ORDER_TOTAL` and `METAL_VALUE` are not offered at all. Gold sells at the live
rate with effectively no markup, so 10% off a ₹4,00,000 necklace is ₹40,000
of which almost none is margin. Making charges and stone value are the only
scopes on the form, and a percentage without a rupee cap is rejected — an
uncapped percentage on a jewellery cart is unbounded downside on one spin.

### One spin per number, checked where the number is proven

The limit is per phone, via the customer record that phone owns — not per
browser session, because a cookie is cleared in two clicks. A hashed IP is the
second line, set well above one spin so it stops scripted farming rather than a
family sharing a connection. `ipHash` is an HMAC with the app secret, never the
address: an IP is personal data and nothing here needs one to answer "has this
source spun twenty times today".

No OTP at popup time — paying for an SMS to open a modal is a bill on every
bounce. Instead the code carries `boundPhone` and `checkCouponWindow` refuses it
on any other number, **including when no number has been verified at all**. That
last part is the one that matters: failing open would mean a won code forwarded
to a friend works perfectly as long as nobody signs in. The verified number is
read from the customer record inside `evaluateCoupon` rather than passed in, so
a new call site cannot forget it and quietly unlock every bound code.

### Where it may appear

Never on the cart, the checkout or an order page — an interstitial over a
payment flow costs more in abandoned baskets than the coupon earns. Never on
first paint. Desktop opens on exit intent; mobile has no cursor to leave the
viewport, so it waits for 30 seconds or half the page and arrives as a bottom
sheet rather than the full-screen interstitial Google demotes. Dismissed pauses
it for 30 days, spinning ends it for good.

Escape closes it, focus is trapped while it is open and returned to where it
came from, and `prefers-reduced-motion` gets the answer without the spin.

### The bug this nearly shipped with

The first working version wrote the "you have spun" cookie on success — and that
same cookie is what suppresses the wheel. The dialog unmounted at the instant the
prize was awarded, so the customer never saw what they had won. Fixed by
snapshotting the offer when the wheel opens: once open, the dialog owns its data
and nothing outside can pull it out from under them.

It is the second time in this pair of changes that the state recording "you are
finished" also destroyed the message explaining what just happened, and both were
found by driving the flow in a browser rather than by a test.

## A real signup, and consent that means something · 2026-08-24

A customer record used to appear out of nowhere: the OTP at checkout created one
with a phone number and nothing else. No name, no email, no date of birth — so
the birthday campaign had nobody to send to and the shop knew nothing about
anyone who had bought from it.

`/signup` collects the rest, and `/my-account` prompts for it when it is missing.
No migration: every column already existed on `Customer` and nothing wrote to
them.

### The order of the two steps is the design

Verify the phone, *then* take the details. The number is the identity key for
every order, coupon and OTP in the system, so it is proven before anything is
attached to it, and the submitted form carries no phone field at all — it comes
from the session the OTP established. Accepting it from the request body would
let anyone claim any number's account.

An existing record is filled in rather than refused. Somebody who has already
ordered as a guest has a row keyed on that number; signing up should complete it,
not collide with it.

### Three DPDP obligations, in the code rather than in a policy page

**Consent is free, specific and informed.** Marketing is its own unticked box,
never folded into the submit button. "By creating an account you agree to receive
offers" is a condition of service, not a choice — so `marketingOptIn` defaults to
`false` and an absent checkbox reads as a refusal, which is what an unticked box
actually submits.

**Purpose limitation.** The reason for asking a date of birth is written beside
the field, and `DOB_PURPOSE` is that exact sentence, shared by the form and the
tests so the promise and the code cannot drift apart.

**Children.** Marketing to under-18s needs verifiable parental consent, which a
checkbox is not. A minor who ticks the box gets the account — refusing that would
be the worse outcome — and is told plainly that the emails were not switched on,
rather than having a silent `false` written where they think they said yes.

That last one was nearly delivered broken. The first build called
`router.refresh()` after saving; the page's server component then saw a complete
profile and redirected to the account page, taking the explanation off screen
before anyone could read it. Caught by driving the flow as a 12-year-old would
in a real browser, not by a test.

### Date of birth is stored at UTC midnight, deliberately

`lib/campaigns` matches a birthday with `dob.getMonth()` and `dob.getDate()`, so
how the value is anchored decides whether the email lands on the right day.
`new Date('1990-05-14')` is UTC midnight and correct;
`new Date('1990-05-14T00:00:00+05:30')` is the 13th in UTC and would wish every
Indian customer a day early. `parseDateOnly` pins it, and rejects dates that
`Date` would otherwise roll over — 30 February silently becoming 2 March is a
birthday offer sent on the wrong day with nothing anywhere to explain it.

### Email uniqueness, handled rather than thrown

Checked first for a message worth reading, then the Postgres unique violation is
caught as a backstop. Both paths, because neither alone is enough: the check
loses to a concurrent signup, and the catch alone turns the common case into a
stack trace. The check deliberately does *not* filter `deletedAt` — the index
covers soft-deleted rows too, so filtering would let the check pass and the
insert fail.

## Playfair Display and Montserrat · 2026-08-23

Headings move from Bodoni Moda to **Playfair Display**, body text from Jost to
**Montserrat**, across the website. Invoices and emails are untouched and should
stay that way: a PDF would have to embed the font file, and email clients cannot
be relied on to load a webfont, so both keep their own stacks.

The variables are now named by role — `--font-heading` and `--font-body` — rather
than by family. Nothing outside `app/layout.tsx` names a typeface, so the next
jeweller this template is deployed for is a two-line change.

`next/font` downloads and self-hosts both families at build time, so there is
still no request to fonts.googleapis.com and nothing for the CSP to allow. The
italic axis is not loaded: the hero's one italic word disappeared when the
homepage became CMS content, and nothing else on the site sets a heading in
italic. Nine font files, 268 KB.

### Three layout bugs the wider face exposed

Montserrat is a good deal wider than Jost at the same size, which pushed three
existing weak spots over the edge. Each was measured with the webfonts
neutralised, so the numbers separate "already broken" from "broken by this":

| Where | Before | With Montserrat | Cause |
|---|---|---|---|
| Desktop category nav | 16px over at 1280px | 33px over | `justify-center` on a non-wrapping row clipped **both** ends — "New Arrivals" rendered as "vals" |
| Footer newsletter | 22px over at 320px | 49px over | `flex-1` without `min-w-0`; the input would not shrink below its content width |
| Product sticky bar | fitted | "Buy Now" broke over two lines | uppercase + `0.12em` tracking, no `nowrap` |

The nav now wraps to a second row instead of truncating, which is also the right
answer as a shop adds categories. Every storefront page was then swept at 320,
390 and 1280px: page-level horizontal overflow is zero everywhere.

## Four campaign switches that were connected to nothing · 2026-08-23

Reported from the shop: the campaigns screen "doesn't work, won't edit, won't
open." Both halves of that were true, and the second one was the serious one.

### The switches lied

Seven automations were listed. Only three — abandoned cart, birthday,
anniversary — were ever consulted before sending. The other four were not:

| Campaign | What the switch did | What actually happened |
|---|---|---|
| New customer welcome | wrote `isActive: false` | welcome email sent anyway |
| Back in stock | wrote `isActive: false` | back-in-stock email sent anyway |
| Price drop | wrote `isActive: false` | price-drop email sent anyway |
| Order shipped & delivered | wrote `isActive: false` | both sent anyway |

An operator turned one off, got "Saved", and stopped looking. That is worse than
having no switch: a missing control sends you to find another way, a lying one
does not.

All four now call `isCampaignEnabled` before doing anything. Two rules in that
check, both chosen so the failure mode is a send rather than a silence:

- **No row means on.** A shop that never opened the screen keeps today's
  behaviour, and switching something off stays a deliberate act.
- **An unreadable row means on.** A database hiccup must not quietly stop the
  shop telling a customer their parcel shipped.

For back-in-stock and price-drop the guard sits *before* the queue is read, not
inside the loop. Those two senders clear `notifyBackInStock` and rewrite
`priceAtAdd` as they go; a guard in the wrong place would have consumed every
waiting request while sending nothing — the same defect that was caught in these
senders once before, for the same reason.

Order shipped/delivered is transactional and can still be switched off, because
a shop that tracks parcels over WhatsApp has a real reason to. The card now says
plainly what switching it off costs the customer.

### The cards were dead ends

A heading, a checkbox and a Save button. Nothing to read, nothing to open, and no
route to the wording. On a phone the panel explaining that wording lives under
Marketing → Email Templates sits below all seven cards, so the honest experience
was scrolling past four blank boxes.

Each card now carries its description, when it fires, which cron drives it (or
that it needs none), and an **Edit wording →** link straight to its own template.

`lib/campaigns/registry.ts` holds that table — type, template key, trigger,
transactional — and both the admin screen and the senders read it. Adding a
campaign means adding a row and calling the check; there is no longer a way to
add a switch without wiring it, because `tests/campaign-registry.test.ts` asserts
every listed campaign is consulted somewhere in the senders.

### Two silent failures made visible

- **No SMTP.** The warning existed on the templates page only, so a shop could
  switch five campaigns on here and never learn that none of them can send. It is
  now the first thing on the campaigns screen, and repeated on any card that is
  switched on while mail is unconfigured.
- **Timing fields on campaigns that have none.** Only abandoned cart has delays
  the code reads. A test asserts the editor offers them nowhere else.

`tests/campaign-switch.test.ts` calls the senders for real with the database and
mailer stubbed: switch off, nothing sent and no state consumed; switch on, sent
and the flag cleared.

## The homepage becomes content · 2026-08-23

The busiest page on the site was a hardcoded React component. Changing the hero
picture or the headline meant editing `app/(storefront)/page.tsx` and
redeploying — and the hero had no image support at all, just a coloured panel
with the brand name in it. For a build that gets redeployed for other jewellers
with configuration changes only, that is the wrong shape: the design is the
template, the words and pictures belong to the shop.

The homepage is now the CMS page with the reserved slug `home`, served at `/`.

### One design, two sources

The blueprint in `lib/cms/home.ts` is both the default homepage and the thing
"Set up homepage" copies into the database. A shop that has never opened the CMS
renders it from memory; a shop that has, renders its own rows. There is no
hardcoded homepage sitting beside a CMS one, quietly drifting out of step.

That property was checked rather than assumed: the rendered text of `/` with no
`home` row is byte-for-byte identical to `/` immediately after setting one up.
Clicking the button costs a jeweller nothing and gains them the controls.

Draft status is the way back. Unpublishing the homepage falls through to the
blueprint instead of 404ing the shop's front door, which is what makes it safe
to unpublish one while reworking it.

### What was missing before blocks could express it

- **`CATEGORY_GRID`** — a new block type (migration
  `20260823010000_add_category_grid_block`). "Shop by Category" was the one band
  no existing block could produce. It reads categories live, so adding one to the
  catalogue puts it on the homepage without anyone editing a block.
- **A second hero button.** The design always had two — shop the catalogue, or
  come to the showroom — and a jeweller whose real business is walk-ins would
  have lost the second one. Optional: leave both fields blank for one button.
- **Eyebrow and "View all" on product grids**, which the hardcoded rows had and
  the block did not.
- **Wishlist state in CMS product grids.** `savedIds` is now threaded into
  `BlockRenderer` from the page, once per request rather than once per grid.

### Two addresses for one page is duplicate content

`/pages/home` permanently redirects to `/` (308, thrown from `generateMetadata`
so the status is set before anything is flushed). The sitemap excludes the `home`
slug — `/` is already a static entry — and the SEO report audits it at `/` under
its own **Homepage** kind rather than at an address that only redirects.

The homepage's canonical is deliberately *not* overridable from the SEO panel.
`noIndex`, title, description and OG image all apply; the canonical does not,
because `/` is the canonical home of the site by definition and a typo in that
field would point the front door at someone else's.

### Guard rails

- The slug is read-only in the editor **and** refused server-side. Renaming it
  would silently drop the shop back to the default with no clue why, and `/` is
  not a target the redirect table can express.
- The homepage cannot be deleted — it holds every edit ever made to it, and
  unpublishing already achieves the same visible result.
- `bootstrapHomepage` is idempotent like the rest of `prisma/bootstrap.ts`: it
  creates the page when missing and never touches one that exists.

### Verified in a browser, not just in tests

Signed into the admin, opened the homepage editor, confirmed the slug is
read-only and the delete button absent, changed the hero heading through the form
and watched `/` change. Separately: deleted the row, confirmed `/` still rendered
the full page, clicked **Set up homepage**, and got all eight blocks back.

## Next 16 · 2026-08-23

Ten high-severity advisories, all transitive through Next 15 — `postcss`
source-map path traversal and the `sharp`/libvips CVEs — and every one of them
only fixed by the major. Taken deliberately rather than left in the report.

Three left, covering two distinct issues, and neither is reachable:

- **nodemailer**, no fix published. It needs a message-level `raw` option;
  `sendMail` is called with `from`, `to`, `subject`, `html` and `text`.
- **deepmerge-ts**, via `prisma`'s config loader, which parses our own config
  file at CLI start. The fix is Prisma 7 — a second major, on top of this one,
  and not something to fold into the same change. The Prisma CLI has to stay in
  production dependencies because `prisma migrate deploy` runs at container start.

### What the major actually changed here

**`revalidateTag` split in two.** It now takes a cache-life profile and marks a
tag stale; `updateTag` expires one immediately with read-your-own-writes
semantics. All four cache-bust helpers — marketing tags, navigation, rate ticker,
SEO settings — are called only from Server Actions, which is the only place
`updateTag` is allowed, and "the admin just saved, the next render must see it"
is exactly what it is for.

This is the change that could have failed silently, so it was checked in a
browser rather than assumed: saving the ticker message and the SEO title each
reached the storefront on the next request.

**`next lint` was removed.** The rules are unchanged — `next/core-web-vitals`,
exactly what `.eslintrc.json` extended — but they run through the ESLint CLI now.
`eslint-config-next` 16 publishes flat config directly, so no compatibility shim
is involved.

### Three React 19 rule violations in existing code

The new `react-hooks/set-state-in-effect` rule caught three real ones. All fixed
properly rather than silenced:

- **ConsentBanner** and **TagScripts** each read the consent cookie in an effect
  and called `setState`. That renders twice, and on the component that decides
  whether third-party scripts load at all, the first of those renders is the one
  where they have not loaded yet. Both now read through one shared
  `useSyncExternalStore` — with `null` as the server snapshot, because a server
  cannot read `document.cookie` and saying so is what keeps hydration honest. The
  duplication between the two went with it.
- **ProductImage** reset a `failed` boolean in an effect on every `src` change.
  It now tracks *which src failed*, so `failed` is derived and a new src is
  un-failed with no effect at all. The SSR-404-before-hydration check moved from
  an effect to a ref callback, which is where it belongs: it runs when the
  element attaches, and it no longer costs a second render on every product card
  on the page.

`tsconfig.json` picks up Next 16's `jsx: "react-jsx"` and its dev types path.

Verified on a real build: every storefront and admin route, 404s still returning
404 after the earlier `loading.tsx` fix, middleware still applying the CSP and
the admin redirect, the consent banner accepting and staying dismissed, the rate
marquee still animating, add-to-bag through to the cart, admin sign-in and the
product list. No JavaScript errors — the only 404s are the seed's placeholder
image paths, which the monogram fallback is there to handle.

650 tests passing.

## The two silent failures now say so · 2026-08-23

Two things stood between this build and a working shop, and neither produced an
error anywhere: **nothing was calling the cron endpoints**, and **SMTP was
unconfigured**. Both were reported in every hand-over as operator notes, which is
another way of saying nobody would find them.

They are configuration, not code. What was missing was the code that says so.

### Every scheduled run is now recorded

A `JobRun` row per job — last run, status, message, duration, run count —
rewritten on every call, success *or* failure. The failure case matters as much:
a job running hourly and failing every time looks identical to a healthy one if
only successes are written down.

That is what makes the distinction possible at all. Without it, a scheduler
nobody ever configured looks exactly like a shop where nothing needed doing.

### A health panel on the first screen an operator opens

The admin dashboard now leads with what is quietly broken, and only for staff who
could act on it — a dispatch user cannot fix SMTP:

- **Email** — no SMTP means nothing is sent, including order confirmations.
- **Scheduler** — every job listed with when it last ran. *Never run* means it was
  never wired up; a run count that stops moving means it stopped.
- **Metal rates** — a live rate more than two days old is being quoted to
  shoppers as today's, and every price on the site derives from it.
- **Payments** — missing Razorpay keys, and separately a missing webhook secret,
  which means an order paid for while the browser was closed is never marked paid.
- **Customer sign-in** — OTP still writing codes to the server log, so no
  customer can sign in or check out as a returning one.
- **OTP debug numbers** — anyone with log access can sign in as those numbers.
- **Storage** and **analytics**, as warnings rather than failures.

Every entry names the remedy. A warning with no remedy is noise.

### And the scheduler config, ready to paste

`docs/DEPLOYMENT.md` gains a copy-paste crontab, a `vercel.json` equivalent, the
note that `03:30` UTC is 09:00 IST because cron runs in the server's timezone,
and a "confirming it actually runs" step pointing at the new panel.

Verified live: with nothing configured the dashboard flags email, the scheduler
and customer sign-in, and lists all four jobs as never run. Calling two endpoints
with the secret recorded both — status, duration and a summary of what they did —
and the panel updated to match.

650 tests passing.

## Saved addresses, and the gateway's own record of a payment · 2026-08-22

Two columns the audit found unused turned out to be one missing feature and one
missing safeguard.

### The `Address` model had never had a row written to it

`Address` — with an `isDefault` flag — has existed since the first schema, and
nothing ever wrote to it. There was no address book, no `/my-account/addresses`,
and checkout snapshotted an address onto the order and forgot it. A returning
customer retyped their full address on every purchase, which at these values is
where an order is abandoned: nobody re-enters a Delhi address to spend ₹1.2 lakh
a second time.

The comment in the checkout action said it best. It read *"persist the
contact/address on the customer for reuse"* and saved the name and the email.

Now: an address book under **My account → Addresses** (add, edit, remove, set
default), the default filled into checkout on arrival, a picker for the others,
and "Somewhere else" for a new one. Editing a prefilled field detaches it from
the saved address, so an amended address is a new one rather than a silent edit
to a saved entry.

Every order also remembers its address, deduplicated on line 1 and pincode —
ordering three times from home leaves one row, not three. Best-effort: a
saved-address write must never fail a checkout.

**Ownership lives in the `where` clause**, not in a check before it. An address
id in a form field is a guess at somebody else's id until the query proves
otherwise, and `updateMany`/`deleteMany` scoped by `customerId` simply match
nothing. There are tests for exactly that.

**Exactly one default**, enforced inside the transaction that sets it: two would
make checkout's preselection arbitrary. The first address saved becomes the
default whether or not it was asked for — otherwise the feature does nothing on
the order that matters most, the second one. Deleting the default promotes the
next most recent.

### `Payment.rawPayload` was never filled

A chargeback arrives months later and is argued from the gateway's record — the
method, the card network, the acquirer reference. `WebhookEvent` keeps the
envelope, but it is keyed by event and pruned by event age. The payment entity
is now stored on the payment row it belongs to, and it is written only: every
amount and status decision still comes from our own rows.

Tests: 10 new, against a real database because ownership and the single-default
invariant are enforced in SQL rather than in application logic. 650 passing.

## Repo audit · 2026-08-22

A full pass over the repository rather than over a feature. Four things found,
all fixed.

### Every dynamic storefront route was returning 200 for a missing page

Reported twice before as affecting `/p/*` and `/pages/*`; it was actually
**products, categories, CMS pages and blog posts** — every route backed by a
database lookup. Only genuinely unmatched top-level paths 404'd correctly.

The cause was not `notFound()`, `force-dynamic` or `generateMetadata`. Probe
routes exercising each of those in isolation returned a correct 404. It was
`app/(storefront)/loading.tsx`: a `loading.tsx` creates a Suspense boundary, and
the shell is flushed — **committing a 200** — before the page below it finishes
its database work. `notFound()` then rendered the not-found screen inside an
already-successful response. Removing that one file fixed all four routes at
once, confirmed by measurement.

That also explains why it looked inconsistent: a page fast enough to resolve
before the flush 404'd correctly, and a page waiting on Prisma did not.

The skeleton now lives on `/search`, which is the only storefront grid that
cannot 404 — a query with no matches is a valid page saying so. It was showing a
product-grid skeleton in front of single product pages and blog posts anyway.

`generateMetadata` in all four routes now calls `notFound()` instead of returning
a "Not found" title, which is honest about what is happening and holds if a
Suspense boundary is ever reintroduced above them.

### A hard delete left loaded in the drawer

`deleteProduct` — a real `prisma.product.delete` — was replaced by
`softDeleteProduct` and then left behind: exported, called by nothing, sitting in
the module the product admin already imports. Wiring it back up would null the
`productId` of every order line that referenced the product, which is precisely
what the soft delete exists to prevent. Deleted rather than deprecated.

### One JSON-LD site skipped the escaper

`serialiseJsonLd` exists so a value containing `</script>` cannot close the tag
early and have the rest parsed as HTML. Three of the four JSON-LD sites used it.
The blog post's `Article` block used raw `JSON.stringify`, with the post title,
excerpt and author name — all operator input — inside it.

### Six environment variables the code reads and `.env.example` never mentioned

`SMS_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `OTP_DEBUG_PHONES`,
`SITE_URL` and `INTERNAL_BASE_URL`. On a resale deployment the first three mean
**no customer can sign in or check out** — OTP silently falls back to printing
codes to the server log. Documented, with a warning that `OTP_DEBUG_PHONES` is a
sign-in bypass for any number listed, and with the cron endpoints and their
intervals spelled out where the secret is defined.

`docs/ADMIN.md` was 42 commits behind and described none of Phase 3. Rewritten
to cover what the console actually does, plus the two things that are
configuration rather than code and without which a live shop is broken.

### Checked and found clean

No `any`, no `eval`/`new Function`/`innerHTML`, no TODO or FIXME markers, no
`@ts-ignore`. No secret reaches a client component — the Meta CAPI token is
passed pre-masked. `.env` is untracked. No schema drift: 14 migrations, database
up to date. The remaining unused exports are harmless.

**Dependencies:** 10 high-severity advisories, all transitive through Next 15 —
`postcss` and `sharp`, fixed by a Next 16 major upgrade, which is a decision to
take deliberately rather than at the end of an audit. The `nodemailer` advisory
has no fix available and is **not reachable here**: it requires a message-level
`raw` option, and `sendMail` is called with only `from`, `to`, `subject`, `html`
and `text`.

640 tests passing.

## Phase 3 · Item 8 completion — video inside written content · 2026-08-22

The spec asked for video in the standalone block **and inside RICH_TEXT blocks
and blog bodies**. Only the block shipped, so a journal post about a collection
could not show the collection moving.

### A line that is nothing but an address

Both surfaces are plain text, one paragraph per line, and deliberately so: there
is no HTML editor anywhere in this admin, because a free-form markup field on a
site that also processes checkout is the card-skimming vector this whole feature
was built to avoid.

So a video is a line containing **only** its address. Nothing new is accepted —
the line goes through the same `parseVideo` as the product field and the VIDEO
block, and the iframe is still built in code. The only thing added is *where* an
address may appear.

A paragraph that mentions a link in passing stays a paragraph. Otherwise a
sentence about a video becomes an unexplained player dropped into the middle of
the prose, and the sentence disappears.

A pasted embed snippet is a paragraph containing angle brackets, printed as the
text it is. Verified live: the `<iframe …>` a shopper sees on the page is
literally that text, and there is no frame in the DOM.

### The CSP had to learn about them

`videoFrameHosts` scanned products and VIDEO blocks. A video inside a blog body
is an embed too, and a `frame-src` that does not know about it means the player
is blocked with nothing on screen to explain why. The scan now covers RICH_TEXT
block bodies and published post bodies as well — confirmed by the live run, where
the blog-body video played with no CSP violation.

`components/storefront/Prose.tsx` is shared by both surfaces so they cannot
disagree about what a line means, and `splitProse` is pure, so the renderer and
the CSP scan read the same content the same way.

Tests: 8 new. 640 passing overall.

## Phase 3 · Item 4 completion — the five templates that were never built · 2026-08-22

The spec named ten template keys. Six shipped. The missing five —
`ORDER_SHIPPED`, `ORDER_DELIVERED`, `BACK_IN_STOCK`, `PRICE_DROP` and
`NEW_CUSTOMER` — were not templates a client could not edit. They were emails
**the shop never sent at all**.

### Two of them were designed into the schema and left unwired

`WishlistItem.notifyBackInStock`, `notifyPriceDrop` and `priceAtAdd` have been
columns since the wishlist was built, carrying a comment saying what they were
for. Nothing ever read them. Somebody who asked to be told a ₹1.2 lakh necklace
was back was never told, and the shop had no idea it was failing to.

`lib/wishlist/notify.ts` sends both, triggered where the fact becomes true:

- **Back in stock** fires from `setStock`, on the *crossing* from nothing to
  something. Topping up from 2 to 5 is not "back", and a piece that already had
  stock must not email anybody.
- **Price drop** fires from `recomputeProductPrices`, for the products whose
  `priceFrom` actually fell. Metal rates move both ways; only one direction is
  news.

Both are self-limiting, which is what stops a cron turning them into a spam
generator: back-in-stock clears its flag when sent, and a price drop rewrites
`priceAtAdd` to the new price so the next email needs a *further* fall rather
than firing every night the price sits below where it started.

### The bug in that, caught before it shipped

`sendTemplate` returns `false` rather than throwing when mail is unconfigured —
which is this shop's current state. The first version cleared the flag and moved
the baseline regardless. The first cron run would have consumed every waiting
back-in-stock request and reset every price baseline, sent nothing, and left
nothing looking broken. Both writes are now conditional on delivery.

### Shipped and delivered come from the courier

Both fire from `applyShipmentStatus`, on the transition rather than the state —
couriers repeat a status happily, and a customer told four times that their
parcel has shipped stops reading anything the shop sends. The tracking link is
the shop's own page, not the courier's: it works without the customer knowing
who carried the parcel, and it survives a change of provider.

### Welcome, guarded

Sent from the appointment booking path — the one moment a customer record is
created with an email and no order behind it. `sendWelcome` also refuses to send
to anybody with an order, so however it is wired later it cannot land beside a
receipt. A welcome arriving in the same minute as an order confirmation reads as
a broken shop.

A test now asserts every key the spec names exists, that every template declares
each variable its own copy uses (an undeclared placeholder renders as literal
`{{price}}` in an inbox), and that the per-template whitelist did not widen as
the set grew.

Tests: 14 new. 632 passing overall.

## Phase 3 · Item 6 completion — the SEO fields nothing could reach · 2026-08-22

`ogImageUrl`, `canonicalUrl` and `noIndex` have been columns on Product,
Category, Collection, CmsPage and BlogPost since they were added. The resolver
read all three, the sitemap honoured `noIndex`, the OG fallback chain looked for
`ogImageUrl` — and **no admin form could set any of them**. Half of item 6 was
plumbing to a tap that did not exist.

`components/admin/SeoPanel.tsx` is that tap: title with a 60-character counter,
description with 160, social image through the shared uploader, canonical
override and a hide-from-search checkbox. One component in all five editors,
because the fields are identical and five copies would drift into five
different validations.

### Warnings where the mistake is made

- **Off-site canonical.** `canonicalise` already rewrites one to this origin, so
  the damage was never done — but the operator was left believing a value was in
  force that was not. The panel says so as it is typed, and `auditSeo` reports it
  on the SEO screen.
- **Social image too small.** Measured in the browser from the preview that is
  already loading: `naturalWidth`/`naturalHeight` against 1200×630. No server
  round trip, and it catches the common case of a 400px product thumbnail reused
  as a social card.
- **Hidden but published.** Ticking noIndex on a live page warns immediately.
  Silent deindexing costs months of traffic before anybody notices.

`lib/validations/seo-fields.ts` holds the schema once. A blank field is stored as
`null` rather than `''`, or the fallback chain — entity, then first product image
or blog cover, then the site default — would never run. `canonicalUrl` and
`ogImageUrl` both refuse `javascript:` and `data:`, because one ends up in a
`<link rel="canonical">` and the other in an `<img src>`.

### `twitterHandle`

The last field the spec asked for and the schema lacked. Cards were being emitted
with no site attribution. Pasting a profile URL or leaving off the `@` both
normalise to `@handle` on save — a card attributed to
`https://twitter.com/mayajewellers` is attributed to nothing.

Verified live: a saved title, description and social image reach the storefront
`<head>`; ticking noIndex produces `noindex, nofollow, nocache` and drops the page
from `sitemap.xml`; and all five editors carry the panel.

Tests: 8 new. 618 passing overall.

## Phase 3 · Item 13 — Delete, soft rather than literal · 2026-08-22

| Entity | What happens |
|---|---|
| Product | Soft delete — off the storefront and out of the admin lists, restorable |
| Customer | Soft delete, optionally with the personal details erased |
| Order | Archive only. There is no delete, and there will not be one |
| Lead | Genuinely deleted |

### Why nothing with money attached is really deleted

GST invoices have to be retained for years. Deleting a customer row breaks the
foreign key of every order that person placed and takes the sales history with
it. Refund and chargeback disputes surface months later needing the original
record. An order that was cancelled is not an order that never happened, and the
difference matters to whoever files the return.

A lead is the exception, and it goes for the opposite reason: it carries no
invoice, no payment and no accounting consequence, so keeping a soft-deleted copy
of somebody's phone number forever would be hoarding rather than caution. The
audit entry keeps the before-state so the deletion can still be accounted for.

### The cascade, and the part of it that is not a cascade

Soft-deleting a product deactivates its variants. Its **inventory rows are left
exactly as they are** and excluded from the stock screens by query instead: the
pieces may still be in the safe, and zeroing a stock count to tidy a listing
destroys a number nobody can recover. An inventory row still counted against a
product nobody can see corrupts stock reports just as badly, so the exclusion is
the fix — non-destructively.

A restored product comes back **as a draft**, not back on sale. Whoever restores
it decides when it goes live rather than discovering it already has.

### `deletedAt` excluded everywhere, and one place it deliberately is not

Every reader was changed: listings, search, the product page, related products,
the sitemap, the SEO report, the coupon engine, the appointment picker, the
wishlist, price recompute, the rate-change impact preview, the video CSP host
scan, the customer session, the campaign audience and the dashboard counters.
Storefront queries carry `deletedAt: null` *alongside* `isActive: true` rather
than relying on soft delete having switched the flag — two independent conditions
mean an update path that flips `isActive` back on cannot resurrect a deleted
product.

The campaign audience matters most: sending a birthday email to somebody who
asked to be erased is the single worst way for an erasure to fail.

The exception is the **SKU and slug uniqueness check**, which still sees deleted
products, because they keep those values — an order line from last year points at
that row. Without it, re-creating a deleted product would fail on a bare unique
constraint with nothing to explain it. It now says the SKU belongs to a deleted
product and suggests restoring it.

### Erasure, done properly

Erasing a customer replaces name, phone, email, gender, date of birth and
anniversary, clears the marketing opt-in, and stamps `anonymisedAt`. The row
survives, so every order still has a parent and the accounting records are
intact. `phone` is unique and not nullable, so it becomes `removed-<id>` —
unmistakably not a phone number and impossible to collide. This is one-way, and
the confirmation says so; restore is offered only for a customer who was hidden
rather than erased.

### Two-step confirmation that cannot be answered by reflex

"Are you sure?" is answered yes without reading it. Removing a product requires
typing its SKU; removing a customer, their phone number; deleting a lead, their
phone or name. The typed value is **re-checked on the server**, because a
confirmation only the browser enforces is not one.

Every removal writes an audit entry with the before-state — verified live for all
six actions. An archive view on products, orders and customers makes the whole
thing honest: removing something that quietly cannot be found again is a delete
with extra steps.

Tests: 12 new, run against a real database because the guarantees are about what
queries return and which foreign keys survive. 610 passing overall.

## Phase 3 · Item 12 — Date filters for orders and leads · 2026-08-22

From/to filtering on the orders and CRM lists, with presets, totals and CSV
export. Everything lives in the URL, so "last month's orders" is a link a
manager can send to somebody rather than a screenshot.

### The whole point is the timezone

The database stores UTC. A naive `createdAt <= '2026-08-22'` drops everything
placed after 6:30pm IST on the last day of the range — five and a half hours of
orders, on the busiest part of the busiest day. The client does not report it as
a bug; they report it as "yesterday's orders are missing", usually a week later,
usually while looking at a figure they have already sent to their accountant.

So a day here is an **IST day**: `2026-08-22` runs from `2026-08-21T18:30:00Z` up
to, but not including, `2026-08-22T18:30:00Z`. The bound is exclusive rather than
`23:59:59.999`, which silently drops the last millisecond. India has no daylight
saving, so the offset is a constant and nothing depends on the server's timezone
or its ICU data. There is a test for an order placed at 11:45pm IST, and the live
run confirmed it lands inside "Today".

Presets follow IST too: at 8pm UTC — 1:30am IST the next day — "Today" is
tomorrow's date, which is what the evening shift needs it to be.

### Totals that say what they include

Orders show count and value for the range, and separately how much of it came
from cancelled or returned orders. "₹4.2 lakh this month" that quietly includes
three cancellations is the figure somebody forwards to their accountant. Leads
show the pipeline value and, when only some carry an estimate, how many of them
it covers — a figure standing for three of forty leads is not a pipeline value.

Orders filter on `placedAt` and leads on `createdAt`: leads-this-month means
leads that *arrived* this month, and filtering on the touch date would drag in a
two-year-old lead somebody rang yesterday.

### Filters survive each other

`withParams` rebuilds the query string keeping everything already in it. The
pagination links were previously written as `?page=2` and nothing else, so
turning a page dropped the status and the search — the total said one thing and
page two showed another. Changing the range always returns to page one, since
landing on page 7 of a two-page range shows an empty table that reads as "no
orders".

CSV export honours the same filters and is capped rather than paginated: an
export of page one is not an export. Leads keep their ownership scope, so a sales
executive exports only their own — an export route that forgets the scope is a
way to read the whole pipeline through a URL. Both write an audit entry, because
both carry customer names and phone numbers out of the system. Dates are exported
as ISO, which sorts correctly in a spreadsheet and cannot be reinterpreted by
somebody else's locale.

### A pre-existing fault this feature ran into

Clicking a preset did nothing perhaps a third of the time. Soft navigation to the
**same route with different search params** intermittently aborts its RSC stream
here, leaving the router on the old URL. It is not new: the CRM pipeline cards,
which shipped long before this work, fail the same way — measured at 4 of 6
clicks landing. `prefetch={false}` did not fix it.

The filter links, the pipeline cards and the pagination links are now plain
`<a>` elements, so the browser navigates normally. A full page load in an admin
table costs nothing worth having; a filter that ignores a click costs trust in
the numbers. Fifteen consecutive navigations landed after the change, against
roughly two in three before it. The underlying router behaviour is worth a
separate look.

Tests: 28 new. 598 passing overall.

## Phase 3 · Item 11 — Hallmark, certificate and size guide · 2026-08-22

### The certification was stored and never really shown

`Product.certification` has held "BIS Hallmark 916" or "IGI Certified" since the
catalogue was built, and appeared as one grey row at the bottom of the
specification table. In this category that is a purchase-decision factor, not a
footnote: a 22K chain with no visible hallmark is a chain somebody has to take on
trust, and a diamond with a report number they can check is a different purchase
from one without.

It now sits beside the price. `parseCertification` reads the free text a jeweller
typed and recognises BIS, IGI, GIA, HRD and SGL, the BIS purity marks (916 is
shown as "916 · 22K", because "916" on its own reads as a number rather than a
purity), and HUIDs and report numbers.

`ProductDiamond.certification` is read too, so a ring hallmarked on the gold and
certified on the stone shows both. Several stones sharing one report number show
it once.

### Nothing is asserted on the shop's behalf

A number is linked only where the issuer publishes a page that checks it. GIA's
report check takes the number in the query string, so it is pre-filled; IGI's
does not, so the link goes to their verification page with the number beside it
to copy. **BIS gets no link at all** — there is no per-HUID web lookup, the
number is checked in the BIS Care app, and saying that is more use than a link to
a homepage. A verification link that lands nowhere is a trust signal that fails.
Issuers we have no check page for show the number and no link, and there is a
test that keeps it that way.

Text this does not recognise is printed as the jeweller wrote it rather than
dressed up as a certificate.

The admin field now asks for the number: "BIS Hallmark 916 HUID AZ4K9P", "GIA
2141438171". Including it is what makes the badge verifiable.

### Size guide, beside the sizes

Wrong-size orders are the main avoidable return here, and it is the one question
a photograph cannot answer. The chart opens over the buy box from the size
selector — a separate page loses the shopper mid-decision — as a native
`<dialog>`, which gets focus trapping, Escape and the top layer from the browser
rather than from a hundred lines that would get one of them wrong.

Indian ring sizes 6–26 and the standard bangle scale, each with diameter and
circumference, plus how to measure with a thread. Circumference is derived from
diameter rather than typed as a second column: two hand-typed columns are two
columns that can disagree, and a millimetre of disagreement is a returned ring.

Which chart a product offers is derived from its category and name, not a new
column, so it works on the catalogue that exists rather than one somebody has to
backfill. Live verification caught the first version matching nothing at all —
the pattern was singular and every category slug is plural ("gold-rings",
"bangles"). It also confirmed the boundary that matters: **earrings are not
offered a ring chart**, despite ending in the same five letters.

Tests: 24 new. 570 passing overall.

## Phase 3 · Item 10 — Live rate marquee · 2026-08-22

A scrolling strip of current metal rates across the top of the site, with the
time they were set.

### It cannot hold a rate

The one design decision that matters: `RateTickerSettings` has no rate column,
and the settings form has no rate field. The strip renders whichever `MetalRate`
rows are `isCurrent` — the same append-only rows the pricing engine prices from.
A second place to type a gold rate is how a shop advertises one number and
charges another, and the customer who notices is holding a screenshot. There is a
test asserting no key matching `/rate/i` exists in the settings.

### "As on" is the oldest rate, not the newest

Taking the newest would let one freshly updated purity vouch for three stale ones
sitting beside it. The timestamp travels along the strip with the rates rather
than sitting in a corner, so whichever part is on screen has the time next to it.

Past 48 hours the strip stops quoting numbers and says the rates are being
updated. Every price on the site derives from these figures; a rate carrying last
week's date undermines the whole catalogue.

### A CSS animation, not `<marquee>`

`<marquee>` is obsolete, cannot be paused, ignores reduced-motion and behaves
differently in every browser. The track holds two identical copies and translates
by exactly half its width, so the loop is seamless. The second copy is
`aria-hidden`, so a screen reader hears the rates once.

It pauses on hover and on focus-within — a rate nobody can read is decoration.
Under `prefers-reduced-motion` the animation is stopped at the start rather than
frozen mid-scroll (the site-wide reduced-motion rule collapses durations to
nothing, which would have left it stuck), the duplicate copy is hidden and the
strip scrolls by hand instead.

The bar is a fixed 36px in every state — rates, no rates, or updating — so it
cannot shift the page as content arrives. A CLS jump at the very top of the
document is the worst place for one.

### Admin control, without handing over CSS

On/off, which purities and in what order, speed, background and an optional
message. Background is a **token name** validated against a closed list, not a
colour; speed is clamped to 15–180 seconds, because faster is unreadable and
slower reads as broken. The operator's choice reaches the page as one number in a
custom property.

The header's hardcoded "BIS Hallmarked · Certified Diamonds · Pan-India Delivery"
is now that optional message, seeded rather than compiled in — one less
brand-specific string in the code for a resale deployment to find.

### Caught in live verification, not by the tests

`unstable_cache` stores its result as JSON, so a `Date` goes in and a string
comes back. `effectiveFrom` was typed as `Date`, compiled cleanly, passed its
unit tests, and threw `getTime is not a function` on the first real page load.
The type now says ISO string, which is what actually crosses that boundary, and a
test round-trips a row through `JSON.parse(JSON.stringify(...))` to keep it
honest.

Rates are read through a cache tag that a rate change busts, so the strip is
current without the client polling for it.

Tests: 28 new. 546 passing overall.

## Phase 3 · Item 9 — One image field, everywhere · 2026-08-22

Uploading a picture used to be a product-editor privilege. The CMS, the blog, the
categories and collections, the social image and the brand settings all took a
URL and nothing else, which meant every non-product image had to be hosted
somewhere else first.

### One upload path, not a second one

`components/admin/ImageUploadField.tsx` is the whole surface: a preview, an
address input, an upload button, a progress bar and — where the model has
somewhere to keep it — an alt-text field. Every screen uses it. The rule that
mattered while building it was to extract the existing uploader rather than write
a new one, because a second uploader means a second set of type and size rules,
and the second set is always the one that goes stale.

The limits now live in `lib/uploads/constraints.ts`, which has no `server-only`
and no Node import, so the browser and the presign route check the same numbers
and produce the same wording. The browser check is a courtesy — it refuses a 9 MB
photo in the same second instead of after the upload — and the server check is
the one that counts.

`fetch` reports no upload progress, so the PUT goes through `XMLHttpRequest`. On
a shop's connection an 8 MB photo is otherwise a silent minute, and a silent
minute is when somebody clicks the button again.

### Three things that were quietly wrong

**The upload prefix was a free string.** It is interpolated into the object key
as `${prefix}/${uuid}.${ext}`, so `../../` was a path the caller chose. It is now
a closed list of seven folders, rejected at the route and defaulted at the
storage layer.

**The presign route demanded `products.manage`.** Correct when the product
editor was the only uploader; now it accepts any of the six permissions that
legitimately put an image on a screen. Dispatch still cannot write to the bucket.

**Product images had optional alt text**, and the upload path filled it with the
file name. "IMG_4823.jpg" is worse than blank because it looks like the field was
filled in. Alt text is now required by `imageSchema`, and the Add button stays
disabled until there is some.

Where a model has no alt column — a category image, a blog cover — the field says
where the description comes from instead of pretending to store one: the category
name, the post title. Hero and image-and-text blocks gained a real `imageAlt`,
which the renderer prefers over the heading.

### Addresses are checked, not trusted

A pasted image address ends up in a `src`. `checkImageUrl` accepts https and
site-relative paths and refuses `javascript:`, `data:` and protocol-relative
addresses, in the product schema, the CMS block schemas, the category and
collection actions and the store settings. SVG uploads stay refused: an SVG is a
document that can carry script, and served from the product-photo bucket it would
be stored XSS with a `.svg` extension.

### Two fields that existed but could never be set

`StoreSetting.logoUrl` has been read by the header and by the Organization
structured data since the schema was written, and `faviconUrl` by nothing at all.
Neither had an admin field. Both do now, and the favicon is wired into the root
layout's `icons`, so uploading one changes something.

The hero block's `mobileImageUrl` had the same problem — in the schema since the
hero was built, absent from the editor, unrendered. It now has a field and a
mobile-only element, because a crop that works at 1280px rarely works at 360px.

Tests: 22 new, covering the type and size gate, the prefix whitelist, address
validation, required alt text and the CMS image fields. 518 passing overall.

## Phase 3 · Item 8 — Video embeds · 2026-08-22

Products and CMS pages can carry a YouTube or Vimeo video.

### The rule: no embed code, ever

An admin field that accepts markup and puts it on a customer-facing page is the
same vector as a "paste your tracking script here" box — and a video field is
exactly where somebody would assume it is harmless. So an operator supplies a
**web address or an ID**, `parseVideo` validates it, and the iframe is built in
code from a fixed template.

Pasting an embed snippet is **rejected, not parsed**. Extracting the `src` out of
it would be friendlier and would teach precisely the wrong habit; the next field
to accept markup would be the one that mattered. The rejection says what to do
instead.

What is refused, with a reason: anything containing angle brackets, other video
hosts, lookalike hostnames (`youtube.com.evil.example`), non-http schemes, and
YouTube URLs that carry no video id. What is accepted: watch, share, embed,
Shorts, mobile and no-cookie URLs, Vimeo plain, player and channel URLs, a bare
id of either kind, and a host with no scheme — because that is how people paste.

The address is stored canonically as `provider:id`, so nothing downstream ever
re-parses a URL, and a value written straight into the database still has to
pass the same parser before it renders.

### Nothing third-party loads until somebody asks

Until the play button is pressed there is no iframe on the page — only an image
and a button. The usual argument is performance; the one that decides it here is
that an embed loaded on sight is a third-party frame running on every product
page view, and this shop's consent banner covers marketing tags, not a player
somebody dropped into a page.

YouTube goes through **youtube-nocookie.com**, which sets no tracking cookie
before play, with `rel=0` so the end cards stay on the shop's own channel rather
than offering a competitor's video. Vimeo gets `dnt=1`. The iframe is granted
exactly the permissions a player needs — notably not camera, microphone,
geolocation or payment — and there is a `<noscript>` link out for anyone whose
browser will not run it.

Vimeo has no thumbnail at a predictable address, so it shows the shop's own
placeholder rather than pulling in a third-party thumbnail proxy nobody agreed
to. An operator can supply a still instead.

### frame-src widens only when there is something to frame

The two embed hosts are added to the policy **only when the shop actually has a
video**, unioned into the same 30-second lookup the marketing-tag hosts already
use so the Edge makes one request rather than two. A permanently widened
`frame-src` is a permanently widened attack surface for the majority of shops
that never embed anything.

It fails closed: a database error means no hosts, so an embed does not render.
Failing open would mean widening the policy on a blip — a security decision made
by accident.

### Verified

`tsc` clean, `next build` clean, lint clean, **496 tests across 28 files** (38
new). End to end against a production build:

- with no video configured, `frame-src` was untouched: `https://api.razorpay.com
  https://checkout.razorpay.com`;
- after configuring one it became `… https://www.youtube-nocookie.com`;
- the product page served **zero iframes** before the click, with the poster,
  play button and `<noscript>` fallback present;
- clicking play produced one iframe on `https://www.youtube-nocookie.com` with
  `autoplay=1`, and **no CSP violations**;
- pasting `<iframe src="…youtube.com/embed/…">` into the admin was refused;
- pasting `https://youtu.be/…?t=30` was accepted and stored as
  `youtube:dQw4w9WgXcQ`.

## Phase 3 · Item 7 — URL redirects · 2026-08-22

Renaming a product broke every link to it that already existed: in Google's
index, in a customer's WhatsApp history, and in whatever the shop paid to
advertise. Nobody remembers to add a redirect by hand at the moment they are
busy renaming something, so the shop does not.

### Automatic on every rename

Changing the address of a product, category, collection, page or journal post now
raises a 301 from the old path. Best-effort and never throws: losing a redirect
is a shame, but failing the rename the operator actually asked for would be
worse.

### Resolved on the Edge

The middleware consults an in-memory map before anything else runs — a renamed
page must not render its 404 first, and there is no point authenticating a
request that is about to be sent elsewhere. The map is fetched from an internal
route handler and memoised for 30 seconds per isolate, the same arrangement the
marketing-tag CSP uses: an admin's change is live within half a minute rather
than instantly, in exchange for not querying the database on every request to
the site.

Failure is contained. A lookup error keeps the last known good map rather than
dropping every redirect over a blip; with nothing cached, an empty map means
renamed pages 404 — bad, but the site keeps serving, which is the only safe way
for something on every request to fail.

Hits are counted through `waitUntil`, after the redirect has already gone out. A
redirect must not wait on a database round trip, and the Edge cannot reach Prisma
anyway.

### What it refuses

A redirect table is one of the few pieces of shop configuration that can take a
whole site down, so most of the logic is refusal:

- **The home page.** Redirecting `/` would take everything down.
- **Paths the shop itself owns** — `/checkout`, `/cart`, `/admin`, `/api`,
  `/my-account`. Checked on save *and* in the middleware, because a rule on
  `/checkout` would be a shop that cannot take money and a direct database edit
  must not be able to create one.
- **Loops.** Including the case a per-rule check misses: `A→B` exists and
  somebody adds `B→A`. Neither rule points at itself, so both pass a self-check,
  and the site bounces between two URLs forever.
- **Unusable destinations** — `javascript:`, `data:`, a bare word.
- **Anything but 301 or 302.**

Off-site destinations are allowed: an old campaign page that now lives on
Instagram is a legitimate redirect.

### Chains are flattened, not banned

An operator who renames a product twice has legitimately created `A→B→C`, and
refusing the second rename would be worse than the extra hop. So chains are
followed rather than rejected: a new rule is pointed at where its target actually
ends up, and rules that pointed at the new rule's source are re-pointed past it.
Each extra hop costs a little ranking and a round trip on a mobile connection.

### Matching is forgiving

Paths are normalised on both sides — case folded, trailing slash dropped, repeated
slashes collapsed, query removed. A shopper typing from a business card or a QR
code gets the case wrong constantly, and matching case-sensitively would turn a
working redirect into a 404 for exactly those people.

The incoming query string is carried across, because it usually holds the
campaign parameters that justify the link existing:
`/diwali-sale?utm_source=meta` reaches `/c/wedding?utm_source=meta`, so the shop
keeps the attribution for clicks it paid for. A query already on the rule's own
target wins, since that was written deliberately.

### A defect the live run found

Renaming a page and then renaming it back — the ordinary "undo that" — left the
first rule in place, pointing the now-live page at a slug nothing served any
more. A visitor to the correct URL was sent to a dead one.

Fixed: a path that a real page occupies cannot also be a redirect source. On a
rename the new path is released first — an automatic rule is deleted, since the
rename it described has been undone; a hand-written one is only switched off,
because somebody typed it for a reason and the record of what they meant is
worth more than the tidiness of removing it.

### System → Redirects

Add rules by hand, or paste a list. The importer takes commas or tabs so a
spreadsheet pastes straight in, ignores a header row, and **reports every row it
rejected with its line number** — an import of two hundred rules must not
silently drop the nine that were malformed. Rows are applied one at a time
rather than in a batch, because a file containing `A→B` and `B→A` is a loop that
only the second row reveals.

The list is ordered most-used first, and prefers switching a rule off to
deleting it: a redirect nobody understands is usually one still carrying traffic.
Deleting one with hits asks twice and names the number.

### Verified

`tsc` clean, `next build` clean, lint clean, **458 tests across 27 files** (54
new). End to end against a production build:

- `/old-ring` → 301 to the product; `/OLD-RING/` reaches it too; a `utm_source`
  survives the hop;
- `/checkout` and a loop were both refused with the reason shown;
- an import of 5 rows added 2 and listed 3 rejections by line;
- turning a rule off returned its path to a 404;
- renaming a CMS page created the 301 automatically, and renaming it back left
  no stale rule — the live page serves itself and the renamed URL redirects to
  it.

### Note

A URL with both the wrong case *and* a trailing slash takes two hops:
Next's own trailing-slash normalisation issues a 308 before the middleware runs,
then the redirect fires. It lands correctly; it is one hop longer than it needs
to be. Changing that means disabling Next's normalisation site-wide, which is a
larger trade than the case deserves.

## Phase 3 · Item 6b — Structured data, robots, sitemap and the SEO screen · 2026-08-22

The second half of item 6: the parts an operator can see and switch.

### Structured data, out of the page components

`Product`, `Organization`, `WebSite`, `LocalBusiness` and `BreadcrumbList` are
now built by tested functions in `lib/seo/jsonld.ts` rather than assembled
inline. A malformed node does not break a page — it silently stops producing
rich results, which is the kind of failure nobody notices for months, so it is
exactly the kind that needs tests.

Two rules run through all of it:

- **Never publish a claim the shop has not made.** An `aggregateRating` is
  emitted only when reviews actually exist behind it — a rating with nothing
  behind it is the most common cause of a structured-data penalty. An `offers`
  node is omitted entirely when there is no price, because "price on request" is
  a real state for jewellery and publishing a zero would be a lie. A
  `PostalAddress` containing only a country is dropped rather than published.
- **Escape for the script tag.** `JSON.stringify` escapes quotes but not `</`,
  so a product named `</script><script>…` would close the tag early and have the
  rest parsed as HTML. `serialiseJsonLd` escapes `<`, `>` and `&` to their
  unicode forms — JSON-transparent, so the parsed value is unchanged.

`LocalBusiness` returns null unless there is a real address, even when the
setting is switched on. A jeweller with a showroom wants to appear in local
results; claiming a location they do not have can get a business dropped from
local results altogether, so the switch alone is not enough.

Opening hours are validated on read — day names against the real seven, times
against `HH:MM` — and malformed rows are dropped. Google can disqualify a whole
page's rich results over one bad node.

### robots.txt and the sitemap follow the settings

`indexingEnabled` off means `Disallow: /`, an empty sitemap and `noindex` on
every page — the correct state while a shop is being set up.

Operators can add extra disallow paths; they cannot remove the built-in ones.
The bag, checkout, account and admin areas are not part of that list, because
making them editable invites somebody to delete `/checkout` from it.

The sitemap now filters on `noIndex`, so it never advertises a page whose own
meta tag tells crawlers to stay away — a contradiction Search Console reports as
an error.

### The SEO screen

**System → SEO** holds the title template, defaults, indexing switch, robots
paths, showroom listing and verification codes, plus a catalogue-wide audit:
how many pages have no description, no social image, or are hidden from search;
which pages share a title; and every page with something wrong, worst first.

Validated on save, because each of these fails quietly:

- a title template without `%s` (every page would get an identical title);
- a robots path with a space or no leading slash (written verbatim into
  robots.txt);
- one coordinate without the other (half a geo node is invalid structured data).

There is no free-text HTML field anywhere on the screen — same rule as the
marketing tags and email templates. Verification codes are stored as values and
rendered by Next into `<meta>`, never into a script.

### Verified

`tsc` clean, `next build` clean, lint clean, **404 tests across 26 files** (27
new). End to end against a production build, driving the real admin screen:

- switching the showroom listing on published `JewelryStore` with its geo
  coordinates, price range and address, alongside `Organization` and `WebSite`;
- a lone latitude was rejected;
- a template without `%s` was rejected;
- a disallow path with no leading slash was rejected, while `/preview` and
  `/internal` reached robots.txt and `/checkout` stayed disallowed;
- switching indexing off flipped robots.txt to `Disallow: /`, emptied the
  sitemap (43 → 0 URLs) and put `noindex, nofollow, nocache` on the home and
  product pages — and switching it back restored all 43;
- marking one product `noIndex` gave it a `noindex` meta tag and removed it from
  the sitemap (43 → 42).

### Note for the operator

Cached settings are invalidated by saving in the admin, not by editing the
database directly — `unstable_cache` persists to `.next/cache` and survives a
restart. Change SEO settings through the screen.

The showroom listing is left **off** so it is switched on deliberately, once the
address in Settings is confirmed correct.

## Phase 3 · Item 6a — SEO foundations · 2026-08-22

Every page already emitted a title, a description and a canonical. None of it
was editable: the wording came from code, the fallbacks named "Maya Jewellers"
in string literals, and sixteen routes each assembled their own `Metadata`
object — so the canonical, the social image fallback and the robots directive
were re-decided, and re-got-wrong, sixteen times.

### One builder, sixteen routes

`buildMetadata()` now serves every public route, and `privateMetadata()` every
private one. A route describes its page; the shared code decides what that
means. A new page cannot ship with no description by omission.

Making them private is a separate function rather than a flag, so the bag,
checkout, the account area and order pages can never accidentally inherit the
site-wide indexing switch and become crawlable.

### The inheritance chain

Page value → the entity it describes → the site default. A product uses its own
`seoDescription`, else its short description, else the site default; its social
card uses its own image, else the first product photo, else the site default —
because a product photo makes a better card than a logo.

### What the client can now control

`SeoSettings` (a singleton, like the other config rows) holds the title
template, default title and description, default social image, the indexing
master switch, extra robots disallow paths, LocalBusiness details, and Bing and
Pinterest verification. Every content model gained `ogImageUrl`, `canonicalUrl`
and `noIndex` alongside the `seoTitle` and `seoDescription` it already had.

`noIndex` defaults to false and `indexingEnabled` to true, so nothing already
published drops out of search the moment this deploys.

### Canonicals are validated, not trusted

A canonical tag tells a search engine which URL owns a piece of content, so a
free-text field pointing anywhere is a way for a shop to hand its rankings to
somebody else — and operators do it by accident, pasting from a listing they were
comparing against. `checkCanonical()` accepts a path on this site or an absolute
URL on this site's own origin, and refuses everything else: other domains,
protocol-relative `//host` URLs, non-http schemes, and hostnames that merely
start the same (`mayajewellers.in.evil.example`).

Computed canonicals drop the query string and fragment, so `?variant=22k` and
`?utm_source=meta` do not become separate URLs competing for one product's
ranking. Variant choice lives in component state rather than the URL precisely
so that stays true.

### Three defects found by looking at the rendered head

- **Titles said the brand twice.** Seeded `seoTitle` values ended in
  "— Maya Jewellers" and the template appended it again:
  `22K Gold Floral Ring — Maya Jewellers · Maya Jewellers`. Fixed in the seed,
  fixed in the dev database, and `auditSeo` now warns when a title contains the
  brand name more than once.
- **The home page had no canonical.** It inherited a title and description from
  the root layout but no `<link rel="canonical">`, leaving `/` and every
  `?utm_source=…` variant of the busiest page on the site separately indexable.
- **The site URL could not be corrected without a rebuild.** `NEXT_PUBLIC_*`
  values are inlined into the bundle at build time, so a shop that changed
  domain — or a resale deployment pointed at a new one — would keep emitting
  canonicals naming the old host. `SITE_URL` is now checked first and read at
  runtime.

Two hardcoded "Maya Jewellers" fallbacks in route code are also gone; the brand
name comes from `StoreSetting` everywhere.

### Warnings written for the operator

`auditSeo` reports what a problem costs, not what rule it breaks: *"Google will
write its own snippet from the page, and it is rarely the one you would
choose"*, *"Shared on WhatsApp or Instagram this link will appear as plain
text"*. `duplicateTitles` looks across pages for the most common self-inflicted
catalogue problem — twenty rings all called "Gold Ring", competing with each
other, invisible unless something compares pages rather than inspecting one.

### Verified

`tsc` clean, `next build` clean, lint clean, **377 tests across 26 files** (49
new). Against a production build: `/` canonicalises `?utm_source=meta` away,
product and category titles carry the brand exactly once, the bag and checkout
send `noindex, nofollow, nocache`, and a runtime `SITE_URL` changes every
canonical without a rebuild.

Still to come in 6b: Product/Organization/LocalBusiness/breadcrumb JSON-LD,
robots and sitemap driven by the settings row, and the admin screen.

## Fix · Checkout summary · 2026-08-22

### The bug

The pay button ignored the coupon. The Total row read the discounted figure and
the button label read `summary.grandTotal` unconditionally, so with a code
applied the button advertised **₹2,522** above a Total of **₹2,285**.

A shopper consents to the figure on the button and is then charged a different
one. That is not cosmetic.

The cause was two paths to one number. There is now exactly one:
`resolvePayable()` in `lib/checkout/totals.ts` returns a `PayableTotals`, and the
Total row, the button label, the cash-on-delivery wording and the analytics
`value` all read `grandTotal` from it. Nothing in the component can reach past it
to the undiscounted figure — there is no second amount in scope to get wrong.

A rendered test asserts the button and the Total row show the same amount, with
and without a coupon, and on the COD path. It is rendered rather than unit-tested
on purpose: the arithmetic was already right and the Total row was already right,
so only looking at what the shopper sees catches a gap between them.

### The GST row moved too

With a coupon the discount reduces the taxable value *before* GST, but the
summary kept showing the pre-discount GST. Same class of mistake — rows that do
not add up. The coupon preview now carries its recomputed taxable value, GST and
shipping alongside the total, and all four are displayed.

### The summary itemises

It showed `Items (1)` — no names, no prices — and no metal row, so the visible
lines did not reach the Total.

Now: thumbnail, name, variant, quantity and line total per item, then a
breakdown where every row is additive top to bottom — metal + wastage, making
charges, stones, item price, item discount, coupon discount, taxable value, GST,
shipping, total. Collapsible on mobile so the payment step stays reachable
without scrolling past a long list.

Two rows exist because verifying against the live site found money with nothing
to explain it:

- **Item price.** A flat-priced piece has no metal and no making component, so a
  gift set showed `₹0.00`, `₹0.00`, GST — and a total ₹899 larger than anything
  on screen accounted for.
- **Item discount.** A discount set on the product itself is separate from a
  coupon code and was not surfaced anywhere.

`getCart` now sums both from figures the pricing engine already produced. No
pricing logic changed.

### Paise, not rounded rupees

`formatCurrency` rounds to whole rupees by default, which is right for a product
tile and wrong in a breakdown: rounded independently, ₹1,650 + ₹364 + ₹204 −
₹237 + ₹59 lands on ₹2,040 beside a total rounded to ₹2,041. The summary shows
paise throughout so the column reconciles exactly.

### Cart and checkout are the same component

`components/storefront/OrderSummary.tsx` renders both. A shopper who sees one
breakdown in the bag and another at checkout has been given a reason to abandon,
and two implementations would drift the first time either was edited.

### Verified

`tsc` clean, `next build` clean, lint clean, **328 tests across 25 files** (28
new). Live against a production build with a mixed bag — one weight-based ring
and one flat-priced gift set:

```
Metal + wastage   ₹21,962.88     Metal + wastage   ₹21,962.88
Making charges     ₹1,612.00     Making charges     ₹1,612.00
Item price           ₹899.00     Item price           ₹899.00
                                 Discount (CODE)    − ₹806.00
                                 Taxable value     ₹23,667.88
GST                  ₹734.22     GST                  ₹710.04
Shipping                Free     Shipping                Free
Total             ₹25,208.10     Total             ₹24,377.92
Button      Pay ₹25,208.10       Button      Pay ₹24,377.92
```

Both columns reconcile to the paisa, the button matches the Total in both, the
cart agrees with checkout, and GST moved with the discount.

### Tooling

Component tests needed a DOM: `jsdom` and `@testing-library/react` are new dev
dependencies, and `vitest.config.ts` sets `esbuild.jsx` so `.tsx` tests compile
without a Vite React plugin (the current major wants a Vite newer than vitest 2
permits).

## Phase 3 · Item 5 — Enquiry capture · 2026-08-22

The WhatsApp buttons were the shop's busiest call to action and left no trace.
A shopper tapped Enquire, opened WhatsApp, and either messaged or did not — and
either way nobody at the shop knew the tap had happened.

### What is captured

A tap on **Enquire** (product page) or the **floating chat button** now raises a
CRM lead before the shopper reaches WhatsApp, carrying which piece they were
looking at. Abandoned bags raise one too, at the moment the bag is written off
rather than after the last reminder — on a ₹1,00,000 bag a phone call the same
evening beats three emails over three days, and a bag with no email address gets
no reminders at all, so the lead is its only trace.

### What is deliberately not captured

A click-to-chat link never tells the site the visitor's phone number; that
arrives when they actually send the message. So `Lead.name` and `Lead.phone` are
now nullable, and an anonymous enquiry is stored with neither. Inventing a
placeholder number would have put an uncallable row in a list of people to call.
The CRM labels these honestly — "Anonymous enquiry", "No contact details — they
have not messaged yet" — rather than rendering an empty cell that reads as a bug.

Staff-entered leads still require a name and a number. That is enforced by the
form, which is where it belongs, not by the column.

### The tap is never delayed

Logging goes out through `navigator.sendBeacon`, which the browser queues and
delivers independently of the page. An `await` before opening WhatsApp would add
a visible pause on the one button nobody waits for, and a `fetch` the unload
cancels would simply lose the enquiry. If the beacon is blocked or unsupported,
the shop misses that click and nothing else happens — the link is a plain anchor
and works with JavaScript switched off entirely.

### De-duplication is enforced by Postgres

One lead per shopper, per piece, per day — a rule the shop owner can hold in
their head. The key is a unique index on `Lead.dedupeKey`, not a check-then-
insert, because two taps in the same millisecond would both pass a check and
both write. Verified against a real database: twenty simultaneous captures
produce exactly one lead.

Repeats are counted rather than discarded. Somebody who enquired about the same
necklace four times is a warmer lead than somebody who enquired once, and that
is invisible if the extras are simply dropped.

A day is bucketed in **IST**, not UTC. Bucketing on UTC would split an evening's
browsing across two days at 5:30pm local, which is exactly when people shop.

Abandoned-cart leads are one per cart *for ever*, not per day — the reminder
campaign already runs on a schedule, and a second lead would have sales chase
one shopper twice.

### The endpoint trusts the browser for one thing

`POST /api/enquiry` accepts a product id and nothing else. Who the shopper is
comes from the server's own cookies; a payload carrying a `customerId` or a
`phone` is ignored, because a public endpoint that accepted those would let
anyone attribute enquiries to anyone.

The product id is verified against the database *before* the de-duplication key
is built, and the key uses the resolved id. Without that, a caller could mint a
fresh lead per made-up id and walk straight around the limit; unresolvable ids
now collapse into that visitor's one site-level lead for the day.

The endpoint issues the guest session cookie if the visitor does not have one —
the same first-party, httpOnly cookie the guest bag already uses, adding no new
tracking surface. Most WhatsApp enquiries come from visitors who never added
anything to a bag, so without this the first tap from every new visitor would be
unattributable and the second would look like a first.

### Marketing tags

`trackLead` reports the enquiry to whichever pixels are installed, in each
network's own vocabulary. It carries no monetary value on purpose: quoting one
would inflate ROAS with enquiries that never became sales.

### Schema

`Lead` gains `sessionToken`, `touchCount`, `dedupeKey` (unique), and indexes on
`sessionToken` and `(source, createdAt)`. `name` and `phone` become nullable.
NULLs are exempt from a unique index, so hand-entered leads are unaffected.

### Verified

`tsc` clean, `next build` clean, lint clean, **300 tests across 23 files**. End
to end against a production build with a fresh anonymous browser profile: two
taps produced one lead with `touchCount` 2 and the right product linked, the
session cookie was issued by the beacon, an unknown product id produced no
product link, a spoofed `customerId`/`phone` payload was ignored, and the link
still worked with JavaScript disabled.

## Phase 3 · Item 4 — Editable email templates · 2026-08-22

Every word the shop emails a customer was hardcoded. Birthday and anniversary
campaigns ran from `lib/campaigns/`, but the client could not change a syllable
without a code edit — and the one `MessageTemplate` row that *was* seeded for
birthdays was never read, so editing it did nothing.

### What the client can now change

Marketing → **Email Templates** lists all six emails the shop sends: order
confirmation, payment received, abandoned-cart reminder, birthday, anniversary
and appointment request. Each opens on its current wording, with a live preview,
a click-to-insert list of the variables it may use, and a send-yourself-a-test
box.

### What it deliberately does not accept

There is no "paste your script here" field, no custom `<head>` fragment, and no
way for operator-typed text to become executable.

- **Substitution is plain string replacement against a fixed per-template
  whitelist.** No expression language, no `eval`, no `new Function`. `{{1+1}}`
  is not a variable name and renders literally; `{{__proto__}}` resolves to
  nothing. A substituted value is never re-scanned, so a customer cannot name
  themselves `{{items_table}}` and pull in data the template never referenced.
- **Values are HTML-escaped** unless the registry marks them as HTML, which only
  `items_table` is — because this codebase builds it. A customer called
  `<img onerror=…>` is text in the email and text in the admin preview.
- **Bodies are sanitised on save**, not on send, so the database only ever holds
  safe markup. Formatting, links and images survive; `<script>`, `<style>`,
  `<iframe>`, `on*` handlers and `javascript:`/`data:` URLs do not. Saving
  something that gets stripped says so rather than silently swallowing it.
- **Unknown placeholders are rejected, not dropped.** An operator who types
  `{{tracking_number}}` is told it will never resolve, instead of finding a
  blank gap in a customer's inbox.
- The preview renders in a **fully sandboxed iframe** through the same sanitiser
  the save uses — a preview that shows what the save would strip is a preview
  that lies.

The old template editor on the Campaigns page has been **removed**. It accepted
an arbitrary key and arbitrary markup with no sanitisation, which is exactly the
free-form-markup vector the marketing-tag work ruled out.

### Nothing goes silent

A row is an *override* of built-in copy in `lib/templates/registry.ts`, never
the only copy. Missing row, inactive row, row saved empty, database hiccup on
lookup — all of them fall back to the built-in wording. A silent non-send on an
order confirmation is worse than an unstyled email, so it cannot happen. For the
same reason transactional emails can be reworded but not switched off.

"Reset to default" **deletes** the override rather than rewriting it with
today's default text, so a reset template tracks future improvements to the
built-in copy instead of freezing this week's version into the database.

### Two behaviour changes on deploy

- The seeded `abandoned_cart` and `birthday` rows are now actually **read**. The
  birthday email will use the seeded row's wording (no brand heading) rather
  than the hardcoded version. Reset it from the admin to go back to the
  built-in copy.
- Fresh deployments seed **no** template rows at all, for the reason above.

### Plain-text alternative

Derived from the HTML when no plain-text version is authored: block boundaries
become line breaks, table cells stay on one line separated by a space, and the
entities the stripper produced are decoded — so a shop called "Ram & Co" reads
as itself rather than as `Ram &amp; Co`.

### Still needed from the operator

`sendEmail` no-ops without SMTP. Templates can be written and previewed today,
but nothing is delivered — and the test-send button says so plainly rather than
reporting a success that did not happen — until `SMTP_HOST` and `SMTP_PORT` are
set on the deployment.

### Verified

`tsc` clean, `next build` clean, lint clean, **277 tests across 21 files**. End
to end against a production build: six templates listed, preview resolves every
sample, `{{card_number}}` rejected by name, a pasted `<script>`/`onclick` body
saved with the markup stripped and the harmless text kept, test-send refused
honestly with no mail server, and reset restoring the built-in copy byte for
byte.

## Phase 3 · Item 3 — EMI display · 2026-08-22

A ₹70,000–₹4,00,000 order is hard to pay in one UPI transfer, and Indian
jewellery shoppers expect to see a monthly figure.

### What shows

"EMI from ₹X/month" on the product page and in the bag, with the full tenure
table behind a "View plans" disclosure. The headline is the **cheapest** monthly
instalment across the configured tenures.

Everywhere it appears it carries: *"Indicative only. Final EMI, tenure and
interest are set by your bank at checkout."* Quoting a firm monthly figure the
bank then refuses is a support problem and a trust problem, so the disclaimer
lives in `lib/emi.ts` rather than being retyped per component.

### Details that matter

- **Recomputed per selected variant.** An 18K and a 22K version of the same ring
  are different money; quoting the default variant's EMI against another
  variant's price would be wrong on screen.
- **Rounded up, never down.** Quoting a rupee less than the bank will charge is
  the kind of small inaccuracy that becomes a support ticket.
- **Hidden below a configurable minimum.** Banks impose their own floor, and
  showing an EMI the shopper cannot get is worse than showing none.
- **0% no-cost EMI does not divide by zero** — a common offer, and it degrades to
  simple division.
- **Malformed configuration is dropped, not rendered.** A bad tenure row would
  otherwise produce `₹NaN/month`, which reads as a broken site.

### Razorpay

`method: { emi: true, cardless_emi: true }` on the checkout options, so the
methods the messaging advertises are actually offered at payment.

### Admin

Settings gains an EMI section: on/off, minimum order value, and a plan table
entered as `months@annualRate` per line. Left blank, it falls back to a shipped
default set rather than saving an empty table that would silently hide EMI.

### Verified

`tsc` clean · `next build` clean · **233 tests** (19 new).

Against a running production build:

- **EMI off (the default): nothing rendered** — 0 occurrences on the product page.
- **EMI on:** `EMI from ₹1,178/month` plus the disclaimer.
- The figure was cross-checked against an independent calculation: the variant's
  live price is ₹24,282.13, which over 24 months at 15% gives ₹1,177.36 exactly —
  quoted as ₹1,178, i.e. rounded up as intended.
- **Minimum raised above the item price: hidden again**, 0 occurrences.

### Operator note

EMI ships **off**. Turn it on in Settings once you have confirmed the tenures and
rates your bank actually offers — the defaults are typical figures, not promises.

## Phase 3 · Item 2 — Jewellery-aware coupons · 2026-08-22

In jewellery, discounts belong on **making charges**. Metal sells at the live
rate with effectively no margin, so "10% off the order total" on a ₹4,00,000
necklace gives away ₹40,000 that is overwhelmingly gold sold at cost.

Measured on the live site with two coupons that differ only in scope, on a
₹24,432 ring:

| Same 10% coupon | Discount |
| --- | --- |
| `MAKING_CHARGES` | **₹161** |
| `ORDER_TOTAL` | **₹2,357** |

Fourteen times the giveaway, for the same headline offer.

### Schema

`CouponScope` enum and, on `Coupon`: `appliesTo` (default `MAKING_CHARGES`),
`categoryIds`, `collectionIds`, `metalTypes`, `purities`, `minWeightGrams`,
`maxWeightGrams`, `excludeDiscounted`, `firstOrderOnly`, `stackable`. Existing
coupons default to `MAKING_CHARGES` — the conservative direction, so no code
suddenly gives away more than it used to.

### Calculation

`lib/coupons/calculate.ts` is pure and fully tested. **Computed per eligible
line, on one named component** — never as a percentage of the bag total.

- Filters narrow, never widen: an empty list means no restriction, and a line
  must match **every** list that is set.
- Weight bounds compare **per piece**: "above 10g" means a 10g piece, not two 5g
  ones that add up.
- A flat coupon spreads across eligible lines in proportion to their base and
  never exceeds it — ₹5,000 off ₹1,000 of making charges would otherwise pay the
  shopper.
- `maxDiscount` scales the per-line parts down together so they still sum to the
  capped total.
- The discount comes off the **taxable value**, so GST is charged on the reduced
  amount. Discounting after tax would have the store remitting GST on money it
  never received.

### Redemption safety

`usageCount` is claimed by a conditional `updateMany` **inside the order
transaction**, before anything else commits. Two shoppers taking the last use at
the same moment cannot both succeed; at these order values one leaked redemption
is a ₹50,000 mistake. If the claim fails the whole transaction aborts, so no
order can exist holding a discount the store refused.

Validity is re-checked at order creation, not only when the code is entered —
rates move, carts sit open for hours, and the last use may go in between. The
browser sends a **code and nothing else**; a client-supplied discount is the same
class of bug as a client-supplied price.

The applied discount is frozen into the order's price snapshot next to the rate
lock, with the per-line detail, so a later edit to the coupon cannot change what
a past order was charged.

### Admin

The coupon section was a placeholder; it is now a real list plus create and edit
screens. The scope selector carries the trade-off in plain terms, and
`ORDER_TOTAL` / `METAL_VALUE` show a warning with the actual arithmetic.
Deactivate rather than delete — orders reference the coupon they were placed
with, and refunds surface months later. `usageCount` is deliberately not
editable.

### Verified

`tsc` clean · `next build` clean · **214 tests** (32 new).

A complete checkout was driven through the browser against a running production
build, ending in a real order:

```
couponCode        LIVEMAKING
discountTotal     161.20        (10% of ₹1,612 making charges)
subtotal(taxable) 23,413.68     (reduced by the discount)
gstTotal            702.41      (3% of the DISCOUNTED base)
tax split         INTRA_STATE cgst=351.21 sgst=351.20
usageCount        0 → 1
```

Concurrency: ten simultaneous claims on a coupon with one use left produced
**exactly one** winner; forty claims on a limit of five produced exactly five.
Those tests need a real database — they run against Postgres when reachable and
skip cleanly when not.

### Operator note

Coupons default to discounting **making charges only**. If a campaign genuinely
needs to discount metal, the scope has to be changed deliberately, and the admin
will warn you.

## Phase 3 · Item 1 — HSN codes and a GST-correct invoice · 2026-08-21

An invoice missing HSN or the wrong tax split is what gets flagged in a GST
audit, and it cannot be corrected retroactively once the goods have shipped.

### Schema

`Product.hsnCode` (default `7113`, backfilled onto existing products by the
column default), `StoreSetting.sellerStateCode`, and on `Order`:
`invoiceNumber` (unique), `placeOfSupply`, `taxBreakup`. Plus `InvoiceCounter`,
one row per financial year.

### The tax split

`lib/tax/gst.ts` is pure and fully tested. Intra-state (buyer state == seller
state) splits CGST + SGST at half the rate each; inter-state charges IGST at the
full rate. Derived from the shipping address at order creation and **frozen into
the order** — rates and the seller's registered state can both change, and a
reprinted invoice must show what was actually charged.

Details that matter:

- **Tax is computed per line and summed**, not by applying a rate to the order
  total. Lines can carry different HSN codes, and the HSN summary a GST invoice
  must show is only derivable line by line.
- **CGST is rounded and SGST takes the remainder**, so the two always add up to
  the line's tax exactly. Rounding half the tax twice can differ from rounding
  the whole by a paisa, which is the kind of thing that gets an invoice queried.
- **The full GST state code table is included.** A partial list would silently
  misclassify sales to whichever state was left out.
- Addresses are free text, so state resolution accepts the code or the name, and
  the spellings shoppers actually type (`New Delhi`, `Orissa`, `Pondicherry`).
  An unresolvable state returns null rather than guessing.
- When the shipping state cannot be resolved the sale is treated as intra-state.
  That is the conservative direction: it files tax to the wrong government, which
  is a correction, rather than under-collecting.

### Invoice numbering

Sequential and gap-free per financial year, `MJ/2026-27/0001`. The prefix is
derived from the brand name, so a redeployment for another jeweller gets its own
series.

Two design points:

- **Allocated when the sale completes, not at checkout.** An abandoned payment
  would otherwise burn a number and leave a gap in a series GST requires to be
  gap-free.
- **`INSERT … ON CONFLICT DO UPDATE … RETURNING`**, called inside the order
  transaction. That takes a row lock, so a second checkout blocks until the first
  commits. Counting orders, or reading the maximum and adding one, both hand two
  concurrent checkouts the same number. `Order.invoiceNumber` also carries a
  unique index as a backstop.

The financial year is computed in **IST**: an order at 02:00 IST on 1 April is in
the new year even though it is still 31 March in UTC.

### Invoice

Now shows HSN per line, taxable value, the tax split with rates, place of supply
and supply type, seller GSTIN and state, invoice number and date, and an HSN
summary table at the foot. Orders predating this change render the GST they
recorded rather than a split that was never charged.

### Admin

HSN on the product editor (defaulted, with a note on when to change it) and the
GST state code in Settings, validated against the real code list.

### Verified

`tsc` clean · `next build` clean · **182 tests** (25 new).

Generated both invoices end to end through the authenticated route against a
running production build:

- Delhi → Delhi: `CGST @ 1.50% ₹1,500.00` + `SGST @ 1.50% ₹1,500.00`, place of
  supply `Delhi (07)`, `MJ/2026-27/0001`
- Delhi → Karnataka: `IGST @ 3.00% ₹3,000.00`, place of supply `Karnataka (29)`,
  `MJ/2026-27/0002`
- Both with HSN `7113` per line and in the summary; the summary reconciles to the
  footer total.

Concurrency: 20 simultaneous allocations produced 20 distinct numbers, 1..20 with
no gaps. That test needs a real database — it talks to Postgres when one is
reachable and skips cleanly when it is not, so `npm test` stays runnable without.

### Operator note

**Set the GST state code in Settings before the next order.** Without it no tax
split can be derived and the invoice falls back to showing the recorded GST
total. `07` for Delhi.

## Marketing tags, dynamic CSP and consent · 2026-08-21

The owner pastes tracking IDs into the admin and they work — no code edit, no
redeploy.

### No raw script paste, ever

There is no "paste your snippet here" box, no custom `<head>` field, nothing that
injects operator-supplied markup. A free-form script field in an e-commerce admin
is a card-skimming vector: any staff account, or one stolen session, could inject
a script that reads the checkout form and posts card details elsewhere, and the
site would keep working normally so nobody would notice.

Instead: **one typed, format-validated field per provider**, with every script
generated by our own code from the ID. Anything exotic goes inside GTM.

- `lib/marketing/tags.ts` — strict pattern per provider, enforced server-side and
  shown to the operator as the hint, so the format they see is the one checked.
  A bad value is **rejected with a message**, never silently stripped — quietly
  removing characters leaves a field that looks configured and does nothing.
  Empty saves as `NULL` (tag off), never as an empty string that would render a
  broken tag.
- Values are **re-validated on read**. The database is not the same trust
  boundary as the form: a value could arrive from an older build, a manual SQL
  edit or a restored backup, and anything that fails its pattern is dropped
  rather than rendered.
- `metaCapiToken` is structurally absent from `PublicTagConfig` — not merely
  omitted at one call site — so no future edit can leak it by forgetting to strip
  a field. Masked as `••••1234` in the admin, and re-entry is required to change
  it; submitting the form with the mask untouched never overwrites the real value.

### Dynamic CSP — the step that would otherwise break everything silently

The old policy allowed only `'self'` and Razorpay, so a correctly pasted GA4 ID
would have produced a page that looked perfect and tracked nothing: the browser
blocks the script without disturbing the layout.

- The CSP **moved out of `next.config.mjs` entirely** into `middleware.ts`.
  Headers declared in the config are fixed at server start *and* override what
  middleware sets, so leaving it there would have meant two policies fighting with
  the static one silently winning. One owner now; the baseline is in
  `lib/security/csp.ts`.
- `lib/marketing/csp.ts` holds the host table and the composition, pure and
  tested. It only ever **appends**, and only to a directive the base policy
  already declares — so a configuration change can widen the policy as far as the
  enabled tags' own hosts and no further. `script-src` is never widened to
  `https:`; that would remove the protection entirely and reinstate the
  raw-paste vector through the back door.
- The policy mirrors the rendering rule: under GTM the direct tags do not load,
  so their hosts are not granted either.
- Middleware runs on Edge and cannot reach Prisma, so the host list comes from
  `/api/internal/tag-csp` and is memoised per isolate for 30s. That endpoint
  returns hostnames only — no IDs, no token.

### Rendering

- `next/script` with `afterInteractive` throughout. This is a jewellery
  storefront where large images already dominate LCP; analytics must not compete
  with first paint.
- **GTM supersedes GA4 / Ads / Meta**, with a warning in the admin naming exactly
  which tags are saved but not loaded. Firing the same purchase from GTM *and* a
  direct tag doubles every conversion, which silently corrupts the ROAS the client
  uses to set ad spend.
- `googleSiteVerification` renders as a `<meta>` via Next's metadata API — never
  a script.
- Meta CAPI is server-side only. The token is read straight from the database at
  send time and used to call Meta directly.

### Events and the once-per-order guarantee

`view_item` · `add_to_cart` · `begin_checkout` · `purchase`, with real INR values.

`purchase` is claimed by a single conditional `UPDATE` on a new
`Order.purchaseTrackedAt` column — the same idempotency shape as the existing
`WebhookEvent` handling. The claim is taken *before* the event is emitted, so the
failure mode is an under-count rather than a double-count. An unpaid order never
claims: reporting a `PENDING_PAYMENT` order would count a conversion the client
never earned. The browser Pixel and the server CAPI call share the order number
as the event ID, so Meta deduplicates the pair.

### Consent

`REQUIRED` by default — India's DPDP Act requires consent for this kind of
tracking, and a Meta Pixel without it is a live risk for any EU visitor. Google
Consent Mode v2 signals denied-first, updated on accept. Brand-styled banner,
Accept / Decline only, six-month first-party cookie, re-openable from the footer.

### Verified against a running production build

- `tsc --noEmit` clean · `next build` clean · **157 tests** (36 new).
- **All tags empty → the CSP is byte-identical** to the previous header.
- Setting GA4 + Meta added exactly their hosts to the live `script-src` and
  `connect-src`, with no rebuild.
- **Zero tag network requests before Accept** under `REQUIRED`; both loaded after;
  cookie set for 6 months; banner does not return once answered.
- The CAPI token appears **nowhere** in page source, the RSC payload, or the
  internal endpoint, across four routes.
- **Five concurrent purchase claims → exactly one won**; later refreshes won
  none; a `PENDING_PAYMENT` order claimed nothing.
- `/admin/marketing/tags` → 307 when unauthenticated.

### Notes for the operator

- A saved change reaches the CSP within ~30 seconds (the middleware memo), not
  instantly. The admin screen says so.
- The tag config is cached and invalidated on save via `revalidateTag`. That is
  correct on a single container; running several would need a shared invalidation
  signal, the same caveat that already applies to the in-memory rate limiter.
- `INTERNAL_BASE_URL` can point the middleware's lookup at the container's own
  loopback address instead of back out through the proxy.

## CMS design controls + managed navigation · 2026-08-21

### Block design controls

- **`lib/cms/style.ts`** — a constrained presentation vocabulary (`background`,
  `spacing`, `align`, `width`, `mediaSide`, `columns`) stored under a `style` key
  inside the existing `CmsBlock.data` JSON. No migration.
  - **Fixed choices only.** No colour picker, no CSS field, no free spacing input.
    Every option maps to a complete literal Tailwind class — nothing is ever
    interpolated into a class string, because Tailwind's scanner cannot see
    `bg-${x}` and it would be an injection surface besides.
  - **Per-type capability map** decides which controls a block offers, so a FAQ
    never shows an image-side control. Adding a block type later is one row.
  - **A velvet background switches text to light automatically.** Headings carry
    an explicit `color: var(--ink)` from globals.css, so inheriting is not enough;
    the override is applied deliberately. Dark text on dark green is the obvious
    failure and staff would not catch it in an editor that shows blocks on white.
  - **Backwards compatible by construction.** Each type's defaults reproduce its
    original markup, seeded from the legacy content fields where one already
    existed (`RICH_TEXT.align`, `IMAGE_TEXT.imagePosition`, `BANNER.tone`), which
    `syncLegacyFields` keeps in step on save. Those three duplicate controls were
    removed from the content form rather than left to fight the new ones.
- `BlockRenderer` consumes the resolved classes for all ten types; `BlockEditor`
  gains a Design panel driven by the capability map plus a *View on storefront*
  link. `ProductRow` takes an optional `sectionClassName` so a CMS block can set
  its own rhythm without affecting the homepage.

### Managed header and footer

- **Schema**: new `NavMenu` addressed by a stable `key`; `NavItem` gains `menuId`.
  The migration adds the column **nullable, backfills existing rows to the header
  menu, then sets NOT NULL** — `prisma migrate deploy` runs against live data at
  container start, and the table already held 13 rows.
- **`lib/navigation.ts`** serves menus by key through `unstable_cache`, tagged and
  invalidated on save. Header and footer render on every page, so an uncached
  query per request was a real cost. Errors propagate out of the cached function
  on purpose: `unstable_cache` does not store a rejection, so a database blip
  cannot pin the fallback in cache.
- **Fallback**: an empty or failing menu falls back to the built-in arrays.
  Verified by emptying the header menu — the storefront still rendered all 13
  links rather than an empty bar.
- Header renders one level of dropdown, opened by hover **or keyboard focus**
  (`focus-within`), with no client component. Mobile drawer shows children inline.
- **`/admin/navigation`** behind `settings.manage`: menu picker, add/edit/delete,
  up-down reorder, link picker (published pages, categories, collections, or a
  custom URL), and *Reset to defaults*. Every mutation re-checks the permission
  server-side and writes an audit entry. Hrefs are restricted to a site-relative
  path or `https://` — `javascript:` and protocol-relative URLs are refused.
- **Broken-link warnings**: links pointing at a `/pages/<slug>` that is missing or
  unpublished are flagged per item and summarised at the top. This is the exact
  failure that was already live — the footer shipped linking to seven pages that
  had never been created.

### The seven missing pages

- `shipping-returns`, `jewellery-care`, `contact`, `hallmark`, `certifications`,
  `privacy`, `terms` created as **DRAFT** with placeholder guidance blocks.
  Publishing legal text the jeweller has not read would be a commitment made on
  their behalf — worse than a 404. The admin flags them as unpublished until
  someone fills them in.
- **`prisma/bootstrap.ts`** holds the menu and page definitions and is idempotent:
  it creates what is missing and touches nothing that exists, so it is safe to run
  against a live store (`npm run db:bootstrap`) without the destructive `seed.ts`.
  Verified by running it twice — the second run created nothing.

### Verified

- `tsc --noEmit` clean · `next build` clean · **121 tests** (14 new, covering the
  backwards-compatibility guarantee and the class-mapping rules).
- `/pages/about` still emits its original classes after the change: `bg-paper-2`,
  `py-14 lg:py-20`, `grid-cols-2 lg:grid-cols-4`, `bg-velvet`, `py-14`.
- Styling a block to velvet/roomy/centre produced `bg-velvet text-paper` with
  `py-20 lg:py-24` and light body text on the live page.
- Migration verified against the populated table: 13 rows adopted, 0 orphans.
- No horizontal overflow at 360/390/768/1280 across four pages.
- `/admin/navigation` returns 307 to the login when unauthenticated.

### Found, not fixed — pre-existing soft 404

`/pages/<unknown-slug>` returns **HTTP 200** carrying the 404 page body, instead
of a real 404. Same for `/p/<unknown-product>`. This predates these changes
(present since the Phase 6 CMS commit) and affects any `force-dynamic` route
calling `notFound()`.

No content leaks — draft pages correctly render the not-found page, and the
sitemap already excludes them. But search engines treat a 200 as a real page, so
the seven new DRAFT policy URLs would be indexable as soft 404s until published.
Left alone because the fix touches caching behaviour on product and category
routes too, which deserves its own decision.

## Deployment — Coolify + Vercel · 2026-08-19

Deployment readiness pass. No product behaviour changed; the pricing engine,
order pipeline and security model are untouched.

**Added**
- **`GET /api/health`** — readiness probe. `200 {"status":"ok","database":"up"}`
  when Postgres answers, `503 {"status":"degraded"}` when it does not. Deliberately
  reports nothing else: an unauthenticated endpoint must not become a
  reconnaissance surface, and the error text goes to the logs, never the response.
  Wired into Coolify's health check *and* a Dockerfile `HEALTHCHECK`, so a failed
  deploy rolls back instead of serving a broken site.
- **`docs/VERCEL.md`** — the serverless path, including the four things that
  actually differ there (pooled database URL, shared rate-limit store, `vercel.json`
  cron, 60s function cap) and a trade-off table against the Docker/Coolify target.
- **`vercel.json`** — cron schedule (UTC) for the four scheduled jobs.
- Optional **Upstash Redis** backend for `lib/rate-limit.ts`, over the REST API so
  it adds no dependency. Required on serverless, where in-memory counters are
  per-isolate and an attacker gets a free attempt per cold start. It **fails open**
  to the in-memory counter if Redis is unreachable — a rate limiter must never take
  checkout down with it. `checkLimit` is now async; the four call sites await it.

**Changed**
- `docs/DEPLOYMENT.md` — the Coolify section is now a real runbook: VPS
  prerequisites, database-first ordering, build-pack settings, required env vars,
  migrations as a pre-deployment command, domain/TLS/health, scheduled tasks,
  post-deploy verification and webhook wiring.
- Cron routes export **both `GET` and `POST`** (Vercel Cron sends GET with a bearer
  token; Coolify/cURL send POST). Same secret-checked handler either way, plus
  explicit `runtime = 'nodejs'` and `maxDuration = 60`.
- `next.config.mjs` — `output: 'standalone'` is now skipped on Vercel (which builds
  its own output) and kept everywhere else, so the Docker image is unaffected.
  `images.remotePatterns` is derived from `R2_PUBLIC_URL` / `R2_ENDPOINT` /
  `IMAGE_HOSTS` instead of a blanket `https://**` — on a metered host a wildcard
  turns the image optimizer into an open proxy anyone can bill to your account.
- `package.json` — `postinstall: prisma generate` so a cached `node_modules` can
  never ship a stale client.

**Verified**
- `tsc --noEmit` clean · `next build` clean · **107/107 tests** (4 new, covering the
  rate-limiter fallback and fail-open paths).
- Build succeeds with an **unreachable database** — every data-backed route is
  dynamic, so the Docker build needs no DB at image-build time.
- Standalone server booted and probed: `/api/health` → 200 with Postgres up,
  **503 with Postgres stopped**, back to 200 on recovery. Security headers present
  on the response.

**Not done**
- Nothing is deployed. This prepares the repository; provisioning the VPS, Coolify,
  the database and DNS is a manual step (`docs/DEPLOYMENT.md`).
- Automating `prisma migrate deploy` inside a Vercel build would need a `directUrl`
  in the `datasource` block. That is a Prisma schema change, so per **RULE 3** it
  was not made — documented in `docs/VERCEL.md` instead.

## Phase 7 — Production Polish · 2026-08-19

**Features added**
- **SEO**: `app/sitemap.ts` (live products, categories, collections, published CMS
  pages and blog posts — 43 URLs on seed data) and `app/robots.ts` excluding
  admin/API/transactional routes. Site-wide **Organization + WebSite JSON-LD**
  with a `SearchAction`, joining the existing Product, Breadcrumb and Article
  structured data.
- **Audit log UI** (`/admin/audit`): filterable by action and entity, showing who,
  what, before/after, IP and timestamp. **Read-only by design** — no edit or delete
  action exists, so the record stays append-only (brief §44).
- **Store settings** (`/admin/settings`): the white-label configuration surface —
  brand, contact, address/GST, and every commerce rule (free-shipping threshold,
  COD limit and token, verification-call and PAN thresholds, rate-lock minutes),
  social links and policies. Changes are audited.
- **Staff & roles** (`/admin/staff`, SUPER_ADMIN only): create accounts, change
  roles, enable/disable, reset passwords. Guards against removing the **last active
  super admin**; passwords are never written to the audit log.
- **Rate limiting** (`lib/rate-limit.ts`): fixed-window limiter applied to OTP send
  (per IP *and* per phone), OTP verify, appointment booking and review submission.
- **Security headers**: a real **Content-Security-Policy** (Razorpay + Google Fonts
  are the only third parties), HSTS, `Permissions-Policy`, plus `no-store` on
  admin/cart/checkout/account/order routes.
- **Structured logging** (`lib/logger.ts`): single-line JSON with **secret
  redaction** — passwords, OTPs, tokens, signatures, PAN and card fields can never
  reach the logs.
- **Accessibility**: skip-link as the first tab stop, `<main>` landmark, and a
  labelled pincode input (the one gap the audit found).
- **Docs**: backup/restore procedure, cron schedule table, monitoring and alerting
  guidance, and the security posture — all in `docs/DEPLOYMENT.md`.

**Tests** (Vitest, 103 total; +11)
- Rate limiter: allows to the limit then blocks, resets after the window, keys are
  independent (one caller cannot block another), buckets are pruned, and the OTP
  presets are asserted strict.
- Log redaction: secret keys redacted by substring, nested objects and arrays
  covered, PAN redacted, errors flattened without stack traces, deep-nesting guard.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (**60 routes**) · `vitest` ✓ (103/103).
- **Mobile QA sweep** at 360 / 390 / 768 / 1280 across ten pages (home, category,
  product, cart, search, appointments, blog, CMS page, track, collections):
  **zero horizontal overflow at every width**.
- **Production build console audit**: **0 CSP violations, 0 JavaScript errors**
  across seven pages. (The `unsafe-eval` violation seen under `next dev` is Next's
  hot-reloader and does not occur in the built app — checked against the real
  standalone server.)
- **Accessibility audit** (automated, all storefront pages): no missing alt text,
  no unnamed buttons/links, no unlabelled inputs, `<main>` present, exactly one
  `h1`. Skip link confirmed as the first tab stop.
- **SEO**: `robots.txt` and `sitemap.xml` verified live; Organization/WebSite
  JSON-LD present on the homepage.
- **Security**: CSP/HSTS/Permissions-Policy headers verified on responses;
  `/admin` → 307; all four cron endpoints → 401 without the secret; **ADMIN is
  redirected away from `/admin/staff`** with no staff UI leaked (SUPER_ADMIN only).
- **Image fallback**: production build renders **0 broken images** — the monogram
  placeholder replaces the seed's fictional image paths.

**Known limitations / recommended before go-live**
- **One index recommendation, not applied**: `/admin/audit` filters by `action`,
  which has no index, and AuditLog grows unboundedly. Adding
  `@@index([action, createdAt])` to `AuditLog` would keep it fast. This is a Prisma
  schema change, so per RULE 3 it awaits your approval rather than being applied.
- The rate limiter is in-memory and therefore per container — correct for a single
  instance; swap the store for Redis before scaling horizontally.
- Product imagery is placeholder (monogram fallback) until real photography is
  uploaded to R2.
- Live Razorpay / Shiprocket / SMTP / R2 credentials must be set, and
  `AUTH_SECRET` + `CRON_SECRET` rotated, before go-live.

---

## Phase 6 — CRM + CMS · 2026-08-19

**Features added**
- **CRM** (`/admin/crm`): lead pipeline with per-stage counts, create/assign leads,
  stage transitions, **scheduled follow-ups** with a "due in 24h" worklist, and
  **call logging**. Sales executives are scoped server-side to their own leads;
  managers see everything (`lib/admin/crm.ts`).
- **Customers** (`/admin/customers`): searchable list plus a detail view with
  lifetime value, paid-order count, order history, addresses, appointments and
  linked CRM leads.
- **Appointments**: storefront `/appointments` booking (showroom visit or video
  consultation, live slot availability, product of interest) which **re-checks slot
  availability server-side**, links/creates the customer, **raises a CRM lead**, and
  sends a best-effort confirmation email. `/admin/appointments` manages status and
  staff assignment.
- **Reviews**: submission restricted to **verified purchases** (re-verified
  server-side against a fulfilled order), one review per customer per product,
  admin moderation queue (`/admin/reviews`) with approve/reject, and approved
  reviews + aggregate rating on the product page.
- **CMS** (`/admin/cms`): block-based pages with **ten fixed block types** and a
  strict Zod schema per type — there is deliberately **no free-form HTML editor**,
  so content cannot inject markup or scripts. Add/edit/reorder/hide/delete blocks,
  draft / published / scheduled states, rendered at `/pages/[slug]`.
- **Blog** (`/admin/blog` + `/blog`, `/blog/[slug]`): full CRUD, categories, tags,
  excerpt, featured image, SEO fields, and **Article JSON-LD**.
- **Campaigns & abandoned cart** (`/admin/campaigns`): per-campaign on/off plus
  **configurable abandoned-cart delays** (abandon-after, three reminder stages,
  minimum gap), editable **message templates** with `{{placeholder}}` rendering, and
  cron endpoints `POST /api/cron/abandoned-cart` and `POST /api/cron/campaigns`
  (both CRON_SECRET-protected). Birthday/anniversary greetings for opted-in
  customers.
- **Seed content**: a published "Our Story" CMS page (hero, rich text, trust row,
  FAQ, CTA), two blog posts, three campaigns and two message templates.

**Tests** (Vitest, 92 total; +13)
- Abandoned-cart scheduling (`lib/campaigns/schedule.ts` is pure): abandonment
  threshold, per-stage due dates, empty/converted carts skipped, and the
  **anti-spam guarantees** — never more than the configured number of reminders,
  minimum gap respected even when a stage is due, at most one reminder per run,
  and custom delay configuration honoured.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (58 routes) · `vitest` ✓ (92/92).
- **End-to-end against the running app:**
  - Appointment booked through the real form → appointment `REQUESTED`, customer
    created, and a CRM lead auto-raised with `source=APPOINTMENT`.
  - CMS page renders every seeded block type; blog post emits `"@type":"Article"`.
  - Abandoned-cart cron: unauthorized → 401; run 1 **marks** abandoned without
    sending; run 2 **sends exactly one** reminder; run 3 immediately after
    **sends nothing** (minimum gap) — reminder count stays at 1, one Notification.
  - **RBAC**: SALES_EXECUTIVE reaches CRM/customers/appointments but is blocked
    from campaigns/CMS/blog, sees only "Your assigned leads", and a direct URL to
    an unassigned lead **leaks nothing** (not-found; admin sees it fine).
  - Reviews: anonymous PDP shows the sign-in gate with **no review form**.

**Known limitations**
- WhatsApp/SMS templates are stored and rendered but dispatch is email-only for
  now (the channel field is ready; a gateway is a drop-in).
- Back-in-stock and price-drop campaigns have configuration and wishlist flags but
  no trigger job yet.
- The CMS block editor covers all ten types; drag-and-drop reordering is
  up/down buttons rather than pointer dragging.

**Next steps** — Phase 7: SEO (sitemap, robots, structured data sweep),
performance, security & accessibility passes, audit-log UI, error pages,
monitoring and production polish.

---

## Phase 5 — Shipping (Shiprocket) · 2026-08-19

**Features added**
- **Provider abstraction** (`lib/shipping/provider.ts`): a `ShippingProvider`
  interface covering serviceability, shipment creation, AWB, pickup, label,
  manifest, tracking and cancellation, resolved via `getShippingProvider()` so the
  aggregator can be replaced without touching callers (brief §21).
- **Shiprocket implementation** (`lib/shipping/shiprocket.ts`): token auth with
  refresh, REST calls for every operation, and a **simulated dev mode** when
  credentials are absent so the whole lifecycle runs locally and in tests.
- **Pure status mapping** (`lib/shipping/status.ts`): courier status → internal
  `ShipmentStatus` + the `OrderStatus` it drives, plus terminal-state detection.
- **Shipment service** (`lib/shipping/shipments.ts`): create → AWB → pickup →
  label/manifest → tracking, with order-status sync and side effects:
  **commit reserved stock + capture COD on delivery** (recording the cash balance
  as its own `BALANCE` payment row), **release stock on RTO**, NDR reason capture.
- **Admin**: `/admin/shipments` list with status facets (NDR/RTO highlighted) and a
  **shipment panel** on the order detail with all lifecycle actions — permission-
  gated (`shipments.manage`) and audited.
- **Shiprocket webhook** (`/api/webhooks/shiprocket`): shared-token authenticated,
  idempotent via `WebhookEvent`, reprocessable on failure; handles tracking, NDR
  and RTO through the same mapping.
- **Reconciliation cron** (`/api/cron/shipment-reconciliation`, CRON_SECRET): polls
  non-terminal shipments so late/missed webhooks self-heal.
- **Customer tracking**: public `/track` (order number + phone, ownership-checked,
  no disclosure on mismatch) and a tracking block on the order page.

**Bug found and fixed by tests**
- `"UNDELIVERED"` contains the substring `"DELIVERED"`, so a **failed delivery was
  being mapped to DELIVERED** — which would have wrongly committed stock and
  captured COD. Fixed by ordering the NDR rule before DELIVERED and adding a
  `\bDELIVERED\b` word-boundary guard, plus a regression test.

**Tests** (Vitest, 79 total; +7)
- Status mapping: delivery/transit/pickup/NDR/RTO-initiated vs RTO-delivered,
  unknown fallback, terminal-state detection, and the UNDELIVERED regression.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (45 routes) · `vitest` ✓ (79/79).
- **End-to-end lifecycle** driven through the real admin UI (headless Chromium) +
  webhooks + DB assertions:
  - Prepaid order: create shipment → AWB → pickup → label → tracking →
    order `SHIPPED` / shipment `IN_TRANSIT`; then `DELIVERED` webhook →
    order `DELIVERED`, **stock committed 5→4, reserved 1→0**.
  - Webhook auth + idempotency: no token → 401; duplicate delivery → deduped
    (`duplicate:true`), both events `PROCESSED`.
  - **UNDELIVERED webhook → shipment `NDR`** (not delivered), NDR reason recorded.
  - **COD**: ₹1,000 token collected online at checkout, balance on delivery →
    payments reconcile exactly (₹1,000 `COD_TOKEN` + ₹1,052.72 `BALANCE` =
    ₹2,052.72 grand total), order `DELIVERED` / `CAPTURED`.
  - **RTO**: `RTO Initiated` webhook → order `RTO`, shipment `RTO_INITIATED`,
    **reserved inventory released 1→0**.
  - Cron: unauthorized → 401; authorized skips terminal shipments.
  - `/track`: correct order+phone shows status/AWB/timeline; **wrong phone
    discloses nothing**.

**Known limitations**
- Live Shiprocket needs real credentials; dev mode simulates AWBs and tracking.
  Courier selection uses the recommended option (no rate-shopping UI yet).
- NDR follow-up workflow (re-attempt scheduling, customer outreach) is recorded but
  not automated — that belongs with the Phase 6 CRM/campaign work.

**Next steps** — Phase 6: CRM (leads, follow-ups, call logs), CMS + blog, reviews,
appointments, campaigns and abandoned-cart automation.

---

## Phase 4 — Checkout, Payments & Orders · 2026-08-18

**Features added**
- **Phone OTP** (`lib/otp.ts`): hashed codes (HMAC), 10-min expiry, 5-attempt cap,
  resend cooldown, constant-time compare; codes never logged in production.
- **Customer session** (`lib/customer-session.ts` + pure `lib/sign.ts`):
  tamper-evident HMAC-signed cookie, separate from staff auth.
- **Order pipeline** (`lib/orders.ts`) — the server is authoritative:
  - Totals are **always recomputed from the cart/pricing engine**; no amount is
    ever accepted from the browser (RULE 1, §59).
  - **Rate lock**: snapshots the live rates + per-item price breakup onto the
    immutable order; `isRateLockValid` honours `StoreSetting.rateLockMinutes`.
  - **Inventory reserved in a transaction** for ready-to-ship lines (oversell-safe);
    released on payment failure / cancellation.
  - **Rules**: COD blocked above `codMaxOrderValue`; `VERIFICATION_HOLD` above
    `verificationCallAbove`; PAN required above `panThreshold`; made-to-order
    **advance/partial payment** via product `advancePercent`; COD token support.
- **Razorpay** (`lib/payments/*`): orders created **server-side only** from the
  server total; payment + webhook **signature verification** (pure, unit-tested);
  a simulated dev-mode so the whole flow runs without live keys.
- **Webhook** (`/api/webhooks/razorpay`): signature-verified, **idempotent**
  (WebhookEvent recorded before processing, unique per delivery), **reprocessable**
  on failure; handles payment.captured / order.paid / payment.failed / refund.processed.
- **Checkout** (`/checkout`): guest checkout with phone-OTP verification, address,
  payment method (Razorpay / COD / bank transfer), server-side place-order action,
  Razorpay Checkout (live) or simulated confirm (dev). Order confirmation / tracking
  page with timeline; **PDF invoice** (`pdf-lib`) from the frozen snapshot, access-
  controlled (owner or staff).
- **Transactional email** (`lib/email/*`, nodemailer): order + payment confirmations,
  **non-blocking** so an order never fails if email fails (§67); recorded as
  Notifications.
- **Admin orders** (`/admin/orders`): searchable list + detail with price snapshot,
  payments, timeline, internal notes, **controlled state transitions** (pure
  `lib/order-status.ts`), high-value verification recording, manual payment
  confirmation — all permission-gated + audited (DISPATCH is view-only).
- **Customer account** (`/my-account`, `/my-account/orders`): OTP login/logout,
  order history and tracking.

**Tests** (Vitest, 72 total; +13)
- Razorpay payment & webhook signatures (compute/verify, tamper + wrong-secret
  rejection); signed-session round-trip + tamper rejection; order-status state
  machine (valid/invalid transitions, terminal states).

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (42 routes) · `vitest` ✓ (72/72).
- **End-to-end financial flows** driven through the real server with headless
  Chromium + DB assertions:
  - Online order: OTP → pay (dev) → **CONFIRMED / CAPTURED**, `grandTotal` =
    `amountPaid` = server-computed ₹24,432, **inventory reserved** (1 unit), correct
    timeline, valid **PDF invoice** (401 unauthenticated, 200 for staff).
  - High-value made-to-order (₹4.02L): **COD disabled**, **PAN captured**,
    **VERIFICATION_HOLD**, **50% advance** collected (₹201,096) — partial payment.
  - Webhook: bad signature → 400; valid → processed; duplicate delivery → deduped
    (exactly one WebhookEvent).
  - Admin: order manager sees actions; DISPATCH is view-only.

**Known limitations**
- Live Razorpay/SMS/SMTP require real credentials; dev-mode simulates payment and
  logs OTP/email. Balance-payment collection for made-to-order and full refund UI
  are minimal (statuses + webhook wired; richer flows in later phases).
- Shipping/AWB is Phase 5; abandoned-cart automation and campaigns are Phase 6.

**Next steps** — Phase 5: Shiprocket (serviceability, shipment, AWB, pickup,
tracking, NDR, RTO) behind the provider interface; customer tracking.

---

## Phase 3 — Storefront · 2026-08-18

**Features added**
- **Storefront data layer** (`lib/storefront.ts`): URL-param filtering (metal, purity,
  colour, price range, availability, occasion), sorting (recommended / newest /
  price-low / price-high / best-selling), pagination, and search with logging.
  "Virtual" categories (Gold / Silver / Diamond / New Arrivals) filter by attribute
  so the nav resolves to populated pages.
- **Product card + shared UI**: `ProductCard` (badges, wishlist heart, "From ₹"
  range), `PriceLabel` (safe fallbacks), `ProductImage` (monogram fallback,
  SSR-safe onError), `ProductGrid`, `ProductRow` (mobile scroll-snap).
- **Listing pages**: `/c/[category]`, `/collection/[slug]`, `/collections`,
  `/search` with a shared `FilterSort` panel (URL-driven, shareable) + `ListingView`.
- **Product page** (`/p/[slug]`): desktop thumbnail+main / mobile swipe gallery;
  variant & size selector (client picks the engine-computed breakup per variant);
  expandable **price breakup** ("How this price is calculated" — metal, wastage,
  making, diamond, stone, GST, total, rate used, weight, purity, timestamp);
  availability + lead time; **pincode serviceability** check; Add to Bag / Buy Now;
  Wishlist; **WhatsApp enquiry** (pre-filled, number from settings); sticky mobile
  CTA; specs; related products; full SEO + Product & Breadcrumb JSON-LD.
- **Cart** (`/cart`): guest cookie session; add/update/remove server actions with
  ownership + stock checks; **server always recomputes** every line via the pricing
  engine (browser totals never trusted); order summary (metal, making, stones, GST,
  shipping, total) with free-shipping threshold from settings.
- **Wishlist** (`/wishlist`): guest cookie session; toggle heart across cards;
  move-to-bag using the first available variant. Live cart/wishlist counts in the
  header.
- **Pincode serviceability** (`lib/shipping/pincode.ts`): provider stub behind a
  24h cache (Phase 5 swaps in Shiprocket). Site-wide WhatsApp floating button.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (37 routes) · `vitest` ✓ (59/59).
- **Responsive check with headless Chromium** at 360 / 390 / 768 / 1280 across home,
  category, product and cart: **zero horizontal overflow** at every width; mobile
  gallery, sticky CTA and grids verified by screenshot.
- Storefront runtime smoke: listings render engine prices (e.g. gold category shows
  12 products ₹14,171–₹1,57,940); cart totals recomputed server-side (2×ring
  ₹48,564 line, GST ₹1,441, grand total ₹49,490; header badge = 3).

**Known limitations**
- Checkout is a placeholder showing the server-computed total; the full flow (OTP,
  address, rate-lock, Razorpay, COD, invoice) is Phase 4.
- Reviews/ratings appear once Phase 6 adds them (JSON-LD includes aggregateRating
  only when present).
- Product media uses the monogram fallback until real images are uploaded (R2).

**Next steps** — Phase 4: checkout (guest + phone OTP), rate-lock, Razorpay + COD +
bank transfer, webhooks, order creation, invoice, transactional email.

---

## Phase 2 — Pricing Engine + Catalog Admin · 2026-08-18

**Features added**
- **Pricing engine** (`lib/pricing.ts`, `calculatePrice()`): WEIGHT_BASED /
  COMPONENT_BASED / FIXED modes, wastage, making (%/per-gram/flat + minimum),
  diamonds (rate × carat × pieces, blended ₹/carat), stones (flat or rate),
  discounts (with cap), GST inclusive/exclusive, quantity, and `isRateLockValid()`.
  100% decimal.js — no floating point. Returns a full itemised breakup.
- **Making-charge resolution** (`lib/pricing/making.ts`): Variant → Category+Metal+
  Purity → Category+Metal → Metal → Global, with priority tie-break.
- **Server pricing resolver** (`lib/pricing/resolve.ts`): loads live rates, resolves
  making charges and gathers diamonds/stones from the DB, computes per-variant
  prices, and recomputes cached `priceFrom`/`priceTo`. Protected cron endpoint
  `POST /api/cron/recompute-prices` (CRON_SECRET).
- **Metal-rate admin** (`/admin/rates`): current rates, update with a live
  catalogue **impact preview** (products affected, old→new average price),
  confirm-to-apply, full rate history, atomic apply + auto price recompute,
  audit log. Diamond-rate inline updates.
- **Making-charge admin** (`/admin/making-charges`): create rules (scope/type/value/
  min/priority + scoped metal/category/purity), live sample-product preview, and
  inline value/min/priority/active edits — all recompute the catalogue.
- **Product CRUD** (`/admin/products`): searchable/filterable paginated list;
  create/edit with all fields; live engine price preview; delete (audit). A default
  variant is created automatically.
- **Variant CRUD + Inventory**: per-variant add/edit/delete, oversell-safe
  transactional stock (`lib/inventory.ts` — reserve/release/commit/set via a single
  conditional UPDATE + ledger), low-stock view (`/admin/inventory`).
- **Image manager**: add-by-URL and presigned **R2/S3 direct upload**
  (`/api/admin/upload-url`, MIME + size validation), set-primary, reorder, delete.
- **CSV bulk import** (`/admin/products/import`): Upload → Validate → **dry-run**
  report (processed/valid/invalid/duplicate/warnings + per-row issues) →
  downloadable error report → confirm → import. Server re-validates on import
  (never trusts the client). Minimal in-house CSV parser.

**Tests added** (Vitest, 59 total)
- Pricing: weight/component/fixed, GST incl/excl, wastage, making %/per-gram/flat +
  minimum, diamonds + blended carat rate, stones, discounts + cap, quantity,
  rate change, historical snapshot reproducibility, rate-lock expiry, invalid-input
  errors, and the **price-manipulation security test** (§59).
- Making-charge resolution order + priority + inactive handling.
- CSV parser (quotes, embedded commas/newlines, escaping, round-trip).
- Import validation: required columns, category/metal/purity resolution, FIXED
  rules, in-file and DB duplicate detection, component warnings.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (28 routes) · `vitest` ✓ (59/59).
- Rate change applied via admin recomputes affected products (verified through the
  cron endpoint: 20 products updated; unauthorized request → 401).
- Import pipeline verified end-to-end against the DB: dry-run flagged a duplicate,
  created products with correct variants + stock, then cleaned up.

**Known limitations**
- Storefront product cards / PDP price breakup consume the engine in Phase 3.
- R2 upload needs `R2_*` env vars; without them the image manager uses add-by-URL
  (the presign endpoint returns a clear message).
- Component pricing via CSV imports metal only; diamonds/stones are added per
  product afterwards (the dry-run warns about this).

**Next steps** — Phase 3: storefront (homepage, category/collection/search,
product page with price breakup, filters, cart, wishlist, pincode, WhatsApp).

---

## Phase 1 — Foundation · 2026-08-18

**Features added**
- Next.js 15 (App Router) + TypeScript + Tailwind + Prisma + PostgreSQL scaffold.
- Comprehensive Prisma schema covering all planned domains (store settings, staff
  & customers, catalog, metals/purities/rates, making charges, products/variants/
  diamonds/stones, inventory, cart, wishlist, orders/payments/refunds, webhooks,
  shipping, reviews, appointments, CRM, CMS, blog, campaigns, notifications,
  analytics, audit). Baseline migration `0_init`.
- Design system: brand tokens as CSS variables mapped into Tailwind; `Bodoni Moda`
  + `Jost` via `next/font`; 2px max radius. Living reference at
  `docs/maya-jewellers-prototype.html`.
- Storefront shell: premium Header (top rate ticker, desktop + mobile layouts,
  accessible mobile drawer), Footer (store-driven links/social/newsletter),
  foundation homepage (hero, shop-by-category from DB, editorial band, collections,
  trust row). Global `error.tsx`, `not-found.tsx`, storefront `loading.tsx`.
- Auth foundation: NextAuth v5 (Auth.js), JWT sessions, edge-safe middleware
  guarding `/admin`, Prisma+bcrypt staff Credentials provider, `trustHost` for
  proxy deployment.
- **Role-based access control**: central permission matrix (5 roles), server-side
  `requirePermission` / `assertPermission` guards, role-filtered admin sidebar,
  admin shell + login + dashboard (live counts) + 18 access-controlled section
  scaffolds.
- Resellable/white-label: all store-specific config in `StoreSetting`; nothing
  brand-specific hardcoded. `formatCurrency()` with Indian grouping and safe
  fallbacks (no ₹0/₹NaN/₹undefined).
- Seed: store settings, 12 categories, 3 collections, gold/silver metals &
  purities, live metal & diamond rates, 4 making-charge rules, **20 products**
  across WEIGHT_BASED (10) / COMPONENT_BASED (6) / FIXED (4) with 28 variants,
  diamonds, stones, inventory, ready-to-ship & made-to-order, and 5 staff accounts.
- Docker (standalone multi-stage) + docker-compose + Coolify notes; docs suite.

**Tests added**
- Vitest: RBAC matrix (per-role capabilities, nav filtering integrity) and
  currency/number/weight formatting. 12 tests passing.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (22 routes, middleware) · `vitest` ✓ (12/12).
- Runtime smoke: homepage 200; `/admin` → 307 login redirect; end-to-end staff
  login (CSRF → session with role → dashboard 200); server-side authorization
  proven (DISPATCH blocked from `/admin/rates`, allowed on `/admin/shipments`,
  "Metal Rates" absent from its nav); wrong-password rejected.

**Known limitations**
- Product cards/pricing display, storefront category/product pages, cart and
  checkout are Phase 2/3/4. Section pages under `/admin/*` are access-controlled
  scaffolds pending their phase.
- Customer phone-OTP login, payments, shipping, media uploads, CRM/CMS UIs land in
  later phases (data model & env contract already in place).
- The visual prototype was established from the approved token/spec brief (no prior
  HTML existed); future phases must not redesign it.

**Next steps** — Phase 2: pricing engine (`lib/pricing`) + unit tests, rate &
making-charge admin with impact preview, product/variant/image CRUD, CSV import
(dry-run), inventory.
