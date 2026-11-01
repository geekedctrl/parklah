# ParkEase — MVP 1 Master Implementation Specification

## Role and objective

You are a senior full-stack-minded frontend engineer, product designer, and QA engineer.

Build **ParkEase**, a polished, mobile-first university basement parking web app that simulates a License Plate Recognition (LPR) parking system.

This is a **frontend-only MVP**. The experience must behave like a functional real-world product using simulated events, local state, persistent browser storage, and a virtual clock.

**Your objective is to implement, run, verify, and refine the application — not merely generate UI code.**

The four primary MVP 1 experiences must work end to end:

1. Home: live capacity, availability and pricing.
2. Reserve: vehicle selection, review, wallet payment and confirmation.
3. My Parking: reservation countdown, entry, active session, checkout, expiration and refunds.
4. Demo Control Panel: simulate operational events and time changes.

Also implement the shared app shell, notification centre, wallet infrastructure, minimum supporting routes, and signboard as described below.

Do not build a real backend, payment gateway, camera integration, or plate recognition model. Every such operation must be clearly simulated.

## 1. Technical stack

Use:

- React with TypeScript and Vite.
- Tailwind CSS.
- shadcn/ui components.
- React Router.
- Recharts for dashboard charts.
- Lucide React for icons.
- Framer Motion or Motion for React for animations.
- date-fns plus date-fns-tz, or another reliable timezone-aware library.
- Zod for runtime schema validation and persisted-state validation.
- Vitest and React Testing Library for unit and interaction tests.
- Playwright for important end-to-end scenarios, if the environment supports it.

Use the compatible current versions of all packages. Inspect the installed environment before introducing dependencies.

Keep the code fully typed. Avoid `any`, unnecessary dependencies, giant components, and tightly coupled screen logic.

Use the **Asia/Kuala_Lumpur** timezone consistently for displayed dates, times, operating-hour checks and demo clock behavior.

Display money as **RM 0.00** with exactly two decimal places.

Use integer sen for internal money calculations.

## 2. Product identity and visual design

Product name: ParkEase.

Brand personality: reliable, intelligent, calm, modern and university-friendly.

Design a high-quality product interface, not a generic admin dashboard or wireframe.

### Color system

Light mode:

- Primary slate: `#0F172A`
- Primary blue: `#2563EB`
- Accent blue: `#3B82F6`
- Page background: `#F8FAFC`
- Card background: `#FFFFFF`
- Muted text: `#64748B`
- Border: `#E2E8F0`

Dark mode:

- Page background: `#020617`
- Card background: `#0F172A`
- Secondary surface: `#1E293B`
- Main text: `#F8FAFC`
- Muted text: `#94A3B8`

Semantic status colors:

- Green `#16A34A`: available, successful entry, paid, refunded.
- Amber `#F59E0B`: low availability, expiring soon, caution.
- Red `#DC2626`: full, expired, unavailable, payment error.
- Blue `#2563EB`: reservation, active processes, primary actions.

Use colors semantically, and always combine colored indicators with readable labels so that color is not the only way to understand status.

### Typography and spacing

Use a contemporary sans-serif font such as Inter or Geist.

Visual hierarchy:

- Strong display numbers for live capacity, wallet balance and countdown.
- Compact, readable labels and descriptions.
- Clear headings.
- Rounded cards, around 16–24px radius.
- Subtle card borders and shadows.
- Consistent 8px spacing system.
- High-contrast primary buttons.
- Comfortable touch targets of at least 44px.

### Responsive behavior

Mobile-first starting at 360px wide.

Mobile navigation uses a fixed or sticky bottom tab bar with five destinations:

Home, Reserve, My Parking, Activity, Profile.

Account for device safe areas.

Prevent the tab bar from obscuring screen content.

On desktop, use a centered, responsive application layout or a wider dashboard with a left navigation rail. Do not simply stretch mobile cards across a huge screen.

Use smooth page transitions, skeleton loading states, polished empty states, clear error messages and subtle micro-interactions.

Support working light and dark themes, stored persistently.

Respect `prefers-reduced-motion`.

## 3. Central business configuration

All adjustable business constants belong in one configuration module, for example:

`src/config/parkingConfig.ts`

Suggested structure:

```ts
export const PARKING_CONFIG = {
  timezone: "Asia/Kuala_Lumpur",

  capacity: {
    total: 300,
    reservable: 90,
    walkIn: 210,
  },

  pricing: {
    currency: "MYR",
    walkInEntrySen: 300,
    walkInFullDaySen: 600,
    walkInEntryCreditedToDayRate: true,
    reservationFeeSen: 400,
    reservedExitDayRateSen: 600,
  },

  reservation: {
    holdMinutes: 60,
    warningMinutes: [15, 10, 5],
    maxActivePerUser: 1,
    refundOnPreEntryCancellation: true,
    refundOnExpiry: true,
  },

  operations: {
    closedFrom: "01:00",
    reopensAt: "05:00",
  },

  refresh: {
    signboardMs: 5000,
    countdownMs: 1000,
  },

  lpr: {
    recognitionBufferMs: 9000,
  },

  wallet: {
    initialBalanceSen: 5000,
    demoTopUpSen: 2000,
  },

  availability: {
    lowThresholdPercent: 15,
    fullThreshold: 0,
  },

  demo: {
    initialAvailableBays: 147,
    demoMode: true,
  },
} as const;
```

All screens, calculations and simulation actions must reference this configuration.

Do not scatter prices, durations, capacities or thresholds throughout components.

The two capacity pools represent **logical capacity accounting, not physical assigned bays**. A student receives a guaranteed parking allocation, not a numbered stall.

## 4. Application architecture

Suggested directory structure:

```text
src/
  app/
    App.tsx
    router.tsx
    providers.tsx
  components/
    layout/
    availability/
    reservations/
    parking/
    wallet/
    notifications/
    demo/
    shared/
    ui/
  config/
    parkingConfig.ts
  domain/
    types.ts
    parkingEngine.ts
    capacity.ts
    pricing.ts
    reservations.ts
    sessions.ts
    wallet.ts
    notifications.ts
    operatingHours.ts
    plateValidation.ts
  hooks/
    useParking.ts
    useDemoClock.ts
    useCountdown.ts
    useAvailability.ts
  pages/
    HomePage.tsx
    ReservePage.tsx
    MyParkingPage.tsx
    DemoPage.tsx
    ActivityPage.tsx
    ProfilePage.tsx
    SignboardPage.tsx
  state/
    parkingStore.tsx
    parkingReducer.ts
    persistence.ts
    migrations.ts
    seedData.ts
  utils/
    dateTime.ts
    formatMoney.ts
    formatDuration.ts
    ids.ts
  tests/
    unit/
    integration/
    e2e/
```

You may improve this structure where justified, but keep the distinction between business logic, application state and presentation components.

### State-management rules

Use React state and Context with `useReducer`, or an equivalent React-state-based solution.

localStorage is the persistence layer, **not a backend or primary source for business calculations**.

All state transitions must go through a central reducer or domain action layer.

Do not let individual components independently modify wallet balances, occupancy numbers or reservation status.

Persist state changes to localStorage.

Use schema validation when loading saved state.

Provide a state schema version and a migration or safe-reset strategy for incompatible saved data.

Use pure functions wherever possible to make business rules independently testable.

Avoid double charging, double refunds and duplicate capacity decrements.

## 5. Domain entities

Implement strongly typed domain models.

### Vehicle

Fields:

- id
- plateNumber
- label
- isDefault
- createdAt

Example saved vehicles:

- WXY 1234 — My Car
- VBA 8821 — Family Car

Support Malaysian registration formats appropriate for the demo, including letters and numbers with reasonable spacing.

Normalize plate input by trimming whitespace, converting to uppercase, and maintaining a canonical comparison value.

Reject duplicates.

Do not attempt to perfectly validate every special Malaysian plate series. Keep the validation configurable and avoid excluding legitimate formats unnecessarily.

### Reservation

Fields:

- id
- vehicleId
- plateNumberSnapshot
- createdAt
- expiresAt
- status
- reservationFeeSen
- paymentTransactionId
- refundTransactionId
- linkedSessionId
- enteredAt
- cancelledAt
- expiredAt

Statuses:

- active
- entered
- cancelled
- expired
- completed

Store absolute ISO timestamps for booking and expiry.

Never persist a countdown integer as the authoritative remaining time.

### Parking session

Fields:

- id
- vehicleId
- plateNumberSnapshot
- reservationId, if applicable
- type: reserved or walkIn
- entryAt
- exitAt
- status: active or completed
- entryPaidSen
- reservationPaidSen
- exitPaidSen
- totalPaidSen

For an active reserved session, keep the RM4 booking fee associated with its reservation, while tracking the RM6 parking day rate as due at checkout.

### Wallet transaction

Fields:

- id
- createdAt
- type
- amountSen, as signed integer
- balanceAfterSen
- referenceId
- description
- metadata, where needed

Types:

- initialCredit
- topUp
- reservationPayment
- reservationRefund
- walkInEntryPayment
- parkingExitPayment

### Notification

Fields:

- id
- createdAt
- type
- title
- message
- isRead
- relatedEntityId
- deduplicationKey

Types:

- availabilityLow
- availabilityRecovered
- reservationConfirmed
- reservationWarning15
- reservationWarning10
- reservationWarning5
- reservationExpired
- reservationCancelled
- reservationRefunded
- plateRecognized
- entryConfirmed
- exitConfirmed
- closingSoon
- parkingClosed
- parkingReopened
- paymentFailed

### Demo clock

The app must use a clock abstraction.

Store a virtual time offset or virtual reference timestamp plus a real reference timestamp.

The display clock must advance normally after simulated time adjustments.

Fast-forwarding should shift the virtual time without modifying the real system clock.

All domain calculations must use the central application clock.

For example, do not use `Date.now()` directly in unrelated components.

Provide testable helpers such as:

- `getAppNow()`
- `formatMalaysiaTime()`
- `isParkingClosed()`
- `getReservationRemainingMs()`
- `advanceDemoMinutes()`

Persist demo time changes correctly across refresh.

Use actual elapsed timestamps rather than repeatedly decrementing a timer variable.

## 6. Capacity and occupancy engine

This is one of the most important parts of the application.

Track independent quantities:

- Reserved cars currently inside.
- Walk-in cars currently inside.
- Active reservations not yet entered.
- Publicly available bays.
- Remaining reservable capacity.
- Remaining walk-in capacity.

Suggested derived logic:

```ts
reservedCapacityLeft =
  reservablePool
  - activeReservationHolds
  - activeReservedSessions;

walkInCapacityLeft =
  walkInPool
  - activeWalkInSessions;

availableBays =
  reservedCapacityLeft + walkInCapacityLeft;

occupiedBays =
  activeReservedSessions + activeWalkInSessions;

heldBays = activeReservationHolds;
```

Enforce:

```text
Total capacity
= occupied bays
+ held bays
+ available bays
```

This identity must always hold in the simulation.

Do not let counts become negative or exceed their respective capacity limits.

### Important pool behavior

When a reservation is created:

- Active holds increase by 1.
- Reservable capacity decreases by 1.
- Total public availability decreases by 1.

When the reserved vehicle enters:

- Active holds decrease by 1.
- Active reserved sessions increase by 1.
- Public availability does not change because the previously held allocation becomes occupied.

When a reservation expires or is cancelled before entry:

- Active holds decrease by 1.
- Reservable availability increases by 1.
- Public availability increases by 1.

When a reserved car exits:

- Active reserved sessions decrease by 1.
- Available capacity increases by 1.

Walk-in entry decreases walk-in availability.

Walk-in exit increases walk-in availability.

Reserved users must not be allowed to consume a new unheld capacity slot accidentally when entering on an already active reservation.

### Seeded opening state

Seed the initial demo with:

- 300 total bays.
- 90 reservable capacity.
- 210 walk-in capacity.
- 30 reserved vehicles inside.
- 110 walk-in vehicles inside.
- 13 existing reservation holds belonging to simulated background users.

Result:

- 140 occupied bays.
- 13 held bays.
- 47 reservable bays left.
- 100 walk-in bays left.
- **147 publicly available bays**.

The user's own account starts without an active reservation.

Background occupancy may be represented by aggregate seed counters or synthetic entities, but it must remain internally consistent.

Use aggregate background occupancy if generating dozens of unnecessary session records would complicate the implementation.

### Capacity status

- Full: zero available capacity.
- Low: positive availability at or below the configurable low threshold.
- Available: above the low threshold.

Individual capacity cards should evaluate their own relevant pool rather than relying solely on the overall color.

A reservation must be blocked if reserved capacity is exhausted, even when walk-in availability is positive.

## 7. Home screen

Route: `/`

Purpose: Help the student immediately understand parking availability, pricing and the next action.

### Header

Display:

- ParkEase logo or brand icon.
- Greeting, such as "Good morning".
- Subtitle: "University Basement Parking".
- Notification bell with unread badge.
- Wallet balance shortcut, for example RM50.00.

The header should feel compact and premium.

### Main availability card

Create a large hero card displaying a circular progress visualization.

The center displays:

**147**

"Available bays"

Below:

"Out of 300 total bays"

Include a semantic status badge such as "Parking available".

Use Recharts RadialBarChart or a high-quality animated SVG ring.

The gauge should reflect availability and occupancy, including reserved holds.

### Live indicator

Show a small green pulsing dot and "Live availability".

Update the signboard snapshot every 5 seconds.

On each snapshot refresh:

- Subtly pulse the live dot.
- Update the visible last-refreshed label.
- Animate changed values.
- Do not invent changes if the underlying parking state has not changed.

### Capacity cards

Create two clearly differentiated cards:

**Reservable bays left**

Show count, pool capacity of 90, percentage remaining and semantic status.

**Walk-in bays left**

Show count, pool capacity of 210, percentage remaining and semantic status.

Both must update immediately following reservation, entry, expiry and exit actions in application state.

### Today's occupancy chart

Build a responsive Recharts area or line chart with hourly occupancy data.

Use plausible fake historical occupancy values.

Ensure each hourly value is within 0–300.

Label the x-axis by Malaysia local time, such as 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00.

Use an indicator for the current simulated hour.

Historical hours are seeded or simulated. The current hour should incorporate live simulated occupancy.

The chart must not claim to be a real campus data feed.

Include a small "Demo data" or "Simulated activity" label.

### Pricing comparison

Show two separate options.

Walk-in:

- RM3.00 on entry.
- RM6.00 full-day total.
- No guaranteed spot.
- Subject to capacity on arrival.

Reserved:

- RM4.00 at booking.
- RM6.00 at exit.
- RM10.00 total.
- Guaranteed capacity.
- One-hour arrival window.

Use a visual highlight for the reservation option.

Clearly explain that the system guarantees capacity, not a particular numbered bay.

### Primary CTA

Large mobile-friendly button:

**Reserve a bay**

Navigate to `/reserve`.

Disable when:

- The parking facility is in its closed reservation period.
- Reserved capacity is full.
- The user already has an active reservation or parking session that prevents a new booking.

Show explanatory text rather than merely graying out the button.

## 8. Reserve flow

Route: `/reserve`

Create a three-step flow:

1. Select vehicle.
2. Review booking.
3. Payment and confirmation.

Use an elegant progress indicator.

### Step 1: Vehicle selection

Display saved vehicles as selectable cards.

Each card includes:

- Vehicle icon.
- Plate number.
- Vehicle nickname.
- Selected-state indicator.

Default vehicles:

- WXY 1234
- VBA 8821

Provide "Add another vehicle".

Open a dialog or bottom sheet with plate input and optional nickname.

Normalize registration numbers.

Prevent duplicates and clearly display validation errors.

Store added plates in app state and localStorage.

Show a button:

**Continue**

Do not allow continuation without a selected valid vehicle.

### Step 2: Reservation review

Show selected vehicle and current availability.

Display a breakdown:

- Reservation fee: RM4.00.
- Arrival window: 60 minutes.
- Booking time.
- Exact expiry time in Malaysia local time.
- Day rate at exit: RM6.00.
- Estimated full transaction total: RM10.00.

Include a clear refund-policy panel:

"Your RM4.00 reservation fee is fully refunded to your ParkEase wallet if you cancel before entering or if your reservation expires after 60 minutes."

Include:

"No numbered bay is assigned. Your reservation guarantees a place within the reserved capacity pool."

### Critical booking expiry logic

Do not finalize a reservation expiry until the payment transaction is successfully committed.

The final `createdAt` and `expiresAt` must be determined using the same simulated timestamp.

The review page may display a provisional expiry.

If the user leaves the review screen open for several minutes, the expiry at actual booking must still be a full 60 minutes from payment confirmation.

### Step 3: Payment

Display wallet balance.

Initial wallet: RM50.00.

Charge RM4.00 from the wallet.

Use integer sen.

Payment should happen through one atomic domain action.

Validate:

- A vehicle is selected.
- The user is eligible to reserve.
- The app is open for new reservations.
- Reserved capacity is available.
- Wallet balance is sufficient.

If any condition fails, show a specific error and do not modify wallet or capacity.

If balance is insufficient, show a top-up option.

### Fake wallet top-up

Provide a "Top up" control.

For MVP 1, clicking it adds RM20.00 of fake funds.

Clearly label it as demo funds.

Create a corresponding wallet transaction.

Never integrate a real payment service.

### Payment success

After payment:

- Deduct RM4.00.
- Add one active reservation.
- Reduce reservable availability.
- Write the payment transaction.
- Add reservation-confirmed notification.
- Display a brief success animation.
- Show a confirmation receipt.
- Provide "View my parking" action.

Automatically navigate to `/my-parking` after the confirmation animation or allow the user to proceed explicitly.

Avoid allowing duplicate reservations from repeated clicks.

## 9. My Parking screen

Route: `/my-parking`

This screen has multiple states.

### State A: No active reservation or parking session

Show a polished empty state:

"No active parking"

"You don't currently have a reservation or vehicle inside the basement."

Primary button: "Reserve a bay".

Optionally show the latest completed or expired event summary.

### State B: Active reservation

Display:

- Selected vehicle plate.
- Status: "Reserved".
- Arrive-before time.
- Prominent countdown.
- Remaining time progress ring.
- Reservation fee paid.
- Reservation identifier.
- Arrival policy.

Countdown should begin at 60:00 and decrease using the simulated clock.

Format as MM:SS.

Do not allow negative countdown values.

The progress ring should gradually deplete.

Change from blue to amber during the last 15 minutes.

Change to red during the last 5 minutes.

### Reservation countdown notifications

Trigger notifications at threshold crossings:

- 15 minutes remaining.
- 10 minutes remaining.
- 5 minutes remaining.

Important: When fast-forwarding from 60 to 10 minutes remaining, trigger both the crossed 15-minute and 10-minute notifications, but only show the most urgent toast if stacking all would overwhelm the screen.

Each threshold notification must be generated only once per reservation.

Store unique deduplication keys.

Use attractive toast notifications and persist the notifications in the notification centre.

### Cancel reservation

Show an outlined destructive button:

"Cancel reservation"

Open a confirmation dialog.

Explain:

- RM4.00 refund.
- Capacity will be released.
- The reservation will no longer be valid.

If confirmed while the reservation is active and the vehicle has not entered:

- Mark reservation cancelled.
- Release held capacity.
- Refund exactly RM4.00.
- Write one wallet refund transaction.
- Generate a refund notification.
- Show success toast.

Never allow cancellation of a reservation that has already transitioned to an entered session.

### Directions

Display a "Directions to basement entrance" control.

Because no exact campus entrance address is supplied, make this a demo action displaying a bottom sheet with a simulated entrance description and a clear "Campus location not configured" label.

Do not invent a real geographic entrance or route.

Keep the entrance configuration ready for future integration with maps.

### Reservation expiry

When the simulated current time reaches or exceeds expiry:

- Change status from active to expired.
- Release held capacity.
- Refund RM4.00 once.
- Add a refund transaction.
- Generate an expiration notification.
- Generate a refund notification.
- Show a visible expiry state.

Main message:

**Reservation expired**

"Your RM4.00 reservation fee has been refunded to your ParkEase wallet."

Show the restored wallet balance.

Do not automatically remove the expired reservation display immediately. Give the user an understandable result screen with the ability to make another reservation.

Automatic expiry must also be processed after a page reload.

### Race-condition requirement

If entry and expiry occur near the same timestamp, process them deterministically.

At or after the expiry timestamp, entry is rejected and the reservation expires.

Before expiry, valid entry transitions the reservation into an active parking session and prevents expiry refunds.

## 10. Simulated LPR gate entry

A user must never be led to believe an actual number plate camera has been used.

The Demo Control Panel triggers the simulated scan.

The scan should match a vehicle against an eligible active reservation or simulate walk-in entry as appropriate.

### Reserved vehicle enters

When "Simulate gate scan: reserved car enters" is triggered:

1. Validate active reservation.
2. Verify it is not expired.
3. Verify plate and capacity state.
4. Transition reservation to entered.
5. Create active reserved parking session.
6. Convert held capacity into occupied capacity.
7. Show "Plate recognised".
8. Display recognized plate number.
9. Begin a 9-second simulated gate processing buffer.
10. Show "You've successfully entered the basement."
11. Transition UI to the active parking session.

The domain transition must occur exactly once.

Show a progress animation during gate processing.

The 9-second delay is a simulated visual confirmation buffer, not actual LPR processing.

Do not make the vehicle physically "enter" twice if the user double-clicks.

If the page reloads during the buffer, the persisted state should still have one valid active session. The UI should recover gracefully.

### Walk-in vehicle enters

For a walk-in simulation:

- Use a saved plate that does not already have an active reservation or session.
- Verify walk-in capacity.
- Verify adequate wallet balance.
- Deduct RM3.00 immediately.
- Create a walk-in entry payment transaction.
- Create a parking session.
- Reduce walk-in availability.
- Show plate recognition and entry confirmation with the same simulated visual treatment.

Do not silently convert an active reserved user to a walk-in session.

For MVP 1, prevent any single user account from maintaining multiple active parking sessions.

If this restriction makes walk-in testing awkward, allow resetting the current demo journey through a dedicated control rather than violating state consistency.

### Operating-hours interaction

LPR entry during the 01:00–05:00 closure should be blocked in MVP 1 unless explicitly permitted by a future policy setting.

Vehicle checkout remains possible during the closed period.

## 11. Active parking session

After successful gate entry, `/my-parking` should display the active parking session instead of the reservation countdown.

Elements:

- Status: "Currently parked".
- Recognized licence plate.
- Vehicle icon.
- Entry time.
- Elapsed parking duration.
- Relevant payment details.
- Checkout button.

### Reserved session payment card

Show:

- Reservation fee RM4.00 — Paid.
- Parking day rate RM6.00 — Due at exit.
- Total expected cost RM10.00.
- Currently due RM6.00.

Do not charge the RM4 reservation fee again at exit.

### Walk-in payment card

Show:

- Entry payment RM3.00 — Paid.
- Remaining day rate RM3.00 — Due at exit.
- Total day parking cost RM6.00.

Do not charge the RM3 entry payment again.

### Session timer

Elapsed time is calculated from `entryAt` to current simulated time.

It continues across navigation and reload.

For MVP 1, the pricing is flat-rate per session, not per-minute.

Therefore, "running charges" should show the correct outstanding flat charge rather than pretending the cost increases every minute.

If hourly tariffs are added later, they should be implemented in the central pricing utility.

## 12. Checkout and exit

Pressing "Check out" opens a checkout review screen or modal.

Display:

- Vehicle plate.
- Parking type.
- Entry timestamp.
- Exit timestamp preview.
- Elapsed duration.
- Itemised receipt.
- Amount already paid.
- Amount due at exit.
- Overall parking cost.

### Reserved example

Reservation fee: RM4.00 — Already paid.

Parking day rate: RM6.00 — Due now.

Total cost: RM10.00.

Amount to pay now: RM6.00.

### Walk-in example

Entry payment: RM3.00 — Already paid.

Remaining day rate: RM3.00 — Due now.

Total cost: RM6.00.

Amount to pay now: RM3.00.

### Confirm exit

Before processing:

- Verify that the session remains active.
- Calculate the due amount through the pricing utility.
- Check wallet balance.

If insufficient:

- Display a clear message.
- Offer fake top-up.
- Do not release parking occupancy until payment succeeds.

If successful:

- Deduct the outstanding amount.
- Create one exit payment transaction.
- Mark session complete.
- Record exit time.
- Release the occupied capacity.
- Generate exit confirmation.
- Show payment success and thank-you screen.

The thank-you screen should display a compact receipt and button to return Home.

Checkout must work during the 01:00–05:00 closed period.

Repeated confirmation actions must never produce duplicate charges.

## 13. Demo Control Panel

Route: `/demo`

Also add a small, visually unobtrusive floating "Demo" launcher on ordinary app screens.

Make the demo panel friendly enough for a student presentation.

Label it clearly:

"Simulation controls — no real gate, payment or LPR connection."

### Dashboard

Show:

- Current simulated Malaysia time.
- Current operating state.
- Available bays.
- Active holds.
- Reserved sessions inside.
- Walk-in sessions inside.
- Wallet balance.
- Current account reservation/session status.

### Core simulation controls

**Simulate gate scan: reserved car enters**

Trigger the reserved entry flow.

Disable when there is no eligible active reservation.

**Simulate gate scan: walk-in car enters**

Use the selected saved plate when eligible.

If needed, provide a plate selector for the walk-in scan.

Reject duplicate active vehicles.

**Fast-forward 15 minutes**

Advance virtual time by 15 minutes.

**Fast-forward 30 minutes**

Advance by 30 minutes.

**Fast-forward 45 minutes**

Advance by 45 minutes.

**Fast-forward 59 minutes**

Advance by 59 minutes.

After advancing, immediately reconcile reservation expiry, notification thresholds and operating-hour transitions.

**Simulate walk-in traffic +10**

Increase background walk-in occupancy by up to 10, subject to capacity.

Update live availability.

If only fewer than 10 bays remain, apply only the allowed amount and report the actual change.

**Simulate walk-in traffic -10**

Decrease background walk-in occupancy by up to 10.

Do not remove the user's own active parking session.

**Set time to 12:59 AM**

Set the virtual clock to 00:59 on an appropriate demo date, while keeping the clock coherent with existing timestamps.

**Reset all data**

Show a confirmation dialog.

Reset:

- Wallet to RM50.00.
- Saved demo vehicles.
- Current user reservation.
- User sessions.
- Notifications.
- Background occupancy.
- Virtual clock.
- Demo UI status.

Restore initial availability to 147 bays.

### Additional recommended controls

Implement these because they make a two-minute presentation much easier:

- Advance by 1 minute.
- Advance by 2 minutes.
- Set time to 05:00.
- Trigger reservation expiry.
- Restore seed traffic.
- Top up demo wallet.
- Open Sign Board.
- Return Home.

### Virtual clock safety

If the presenter changes the clock backwards, do not undo valid completed payments, refunds, reservations, or sessions.

Time travel should not reverse historical state transitions.

Prevent duplicated threshold notifications and repeated operating-hour notifications.

If moving to a timestamp that conflicts with an active reservation or session, handle the state safely and show explanatory demo messaging where appropriate.

### Optional guided demo

Provide a "Start guided demonstration" card that explains the suggested sequence:

1. Reset.
2. Reserve vehicle.
3. Show availability reduction.
4. Advance 45 minutes.
5. Show 15-minute warning.
6. Simulate reserved entry.
7. Show active parking.
8. Simulate exit and payment.
9. Show receipt.

Do not require the user to follow the guide.

## 14. Operating hours

The configured closure interval is:

01:00 through 04:59 Malaysia time.

Reopen at 05:00.

Use a centralized `isParkingClosed()` function with correct midnight handling.

When closed:

- Show an attractive closed-state banner or overlay on Home and Reserve.
- Display the text: "ParkEase is closed, reopens at 5:00 AM".
- Disable new reservations.
- Disable new gate entries under the MVP policy.
- Keep My Parking accessible for currently parked users.
- Allow checkout and wallet payment.
- Allow access to notifications and previous transaction history.
- Keep the demo panel accessible so the presenter can recover from closing mode.

Do not globally replace the entire application with a blocking screen that prevents existing parked users from exiting.

### Boundary scenarios

- At 00:59: reservations can still be made if other conditions allow.
- At 01:00: new bookings are disabled.
- At 04:59: new bookings remain disabled.
- At 05:00: bookings are re-enabled.
- A reservation created at 00:30 still expires at 01:30 unless its vehicle entered before closing.
- Automatic refunds and expiration processing continue during the closed period.

### Notifications

Generate:

- Closing-soon notice near 01:00.
- Parking closed notice at 01:00.
- Parking reopened notice at 05:00.

Deduplicate these notifications by logical Malaysia operating date and event type.

## 15. Notification centre

Implement a notification bell in the app header.

Show an unread badge.

Clicking the bell opens a notification panel, drawer or dedicated view.

Each notification displays:

- Icon.
- Title.
- Brief message.
- Relative or localized timestamp.
- Read/unread visual state.

Support:

- Open notification centre.
- Mark individual notification as read.
- Mark all as read.
- Persist read status.

Important events should also trigger Sonner or an equivalent toast.

Relevant notifications include:

- Reservation confirmation.
- Reservation expiry at 15, 10 and 5 minutes.
- Refund issued.
- Gate entry confirmed.
- Exit payment confirmed.
- Availability low.
- Availability recovered.
- Closing soon.
- Closed.
- Reopened.

Use threshold crossing detection for availability notifications.

Avoid producing repetitive low-capacity notifications on every five-second refresh.

## 16. Signboard route

Route: `/signboard`

Although the full Sign Board experience can be improved in MVP 2, implement a working MVP 1 version because it validates the central capacity engine.

Use an immersive full-screen dark theme.

Design for a large landscape monitor, while remaining responsive on phones.

Display:

**PARKEASE**

"UNIVERSITY BASEMENT PARKING"

Very large text:

"AVAILABLE BAYS"

"147"

Show a semantic status color.

Secondary text:

"Reserved bays held: 13"

Include:

- Last updated time.
- Live indicator.
- Operating status.
- Small simulation label.

Refresh the displayed signboard snapshot every 5 seconds.

Internally, capacity is calculated immediately on transactions. The signboard display may show the latest five-second snapshot.

If the signboard is opened in a separate browser tab, synchronize state through the browser `storage` event or BroadcastChannel so it can reflect changes from the main app.

Do not claim that it syncs across devices or computers; there is no backend.

## 17. Supporting screens for MVP 1

Create lightweight, functional supporting routes, but do not spend most of MVP 1 developing them.

### Activity route

Route: `/activity`

For MVP 1, display:

- Recent user reservations.
- Completed user parking sessions.
- Cancelled and expired reservations.
- Wallet payment and refund activity.
- Appropriate badges and empty states.

Full weekly spending analytics and advanced comparison charts can be deferred to MVP 2.

### Profile route

Route: `/profile`

For MVP 1, implement:

- Fake student profile.
- Wallet balance.
- Fake wallet top-up.
- Saved vehicle list.
- Add and remove vehicles safely.
- Light/dark mode toggle.
- Basic notification preference controls.

Detailed transaction filtering and advanced profile customization can be deferred.

All five bottom navigation destinations must work. Never leave dead navigation links.

## 18. Central pricing utility

Create a single pricing module.

Suggested functions:

- `getReservationFee()`
- `getWalkInEntryCharge()`
- `getWalkInTotalCharge()`
- `getWalkInExitDue()`
- `getReservedTotalCharge()`
- `getReservedExitDue()`
- `calculateCheckoutReceipt()`
- `formatRinggit()`

The checkout receipt builder should return itemized lines and totals, not JSX.

Example:

```ts
type Receipt = {
  lines: {
    label: string;
    amountSen: number;
    paymentStatus: "paid" | "due";
  }[];
  alreadyPaidSen: number;
  dueNowSen: number;
  grandTotalSen: number;
};
```

Use integer sen and ensure:

```text
Already paid + Due now = Grand total
```

This must hold for every checkout type.

Do not use the displayed formatted RM string for financial calculations.

## 19. Persistence and state recovery

Save authoritative app state to a namespaced localStorage key, for example:

`parkease:mvp1:v1`

Persist:

- Vehicles.
- User reservations.
- Parking sessions.
- Wallet balance and transactions.
- Notifications.
- Theme.
- Demo clock reference.
- Background occupancy.
- Demo preferences.

Use a central persistence mechanism.

Avoid writing the entire state on every countdown tick; the timer should derive its display from timestamps.

On startup:

1. Load saved data.
2. Validate the schema.
3. Apply migrations if supported.
4. Initialize defaults if missing.
5. Reconcile elapsed virtual time.
6. Expire overdue reservations.
7. Process due notifications and operating transitions.
8. Render the correct page.

### Cross-tab consistency

Use the storage event and optionally BroadcastChannel to update other open tabs.

Because localStorage lacks real transactional locking, the frontend prototype cannot offer true multi-tab financial atomicity.

For this MVP, prioritize single active writer behavior, deterministic event IDs, idempotent domain operations, and explicit handling of conflicting tabs.

Do not claim production-grade concurrency guarantees.

## 20. UX quality requirements

Every major interaction must have meaningful feedback.

Examples:

- Reserve button enters a short pending state while simulated processing occurs.
- Reservation success shows a smooth confirmation animation.
- Adding a vehicle displays a validation message or success toast.
- Gate scan shows the recognized plate and animated processing sequence.
- Entry completion appears as a clear success notification.
- Booking expiry visibly releases the reservation.
- Refund updates the wallet and notification list.
- Checkout shows a detailed receipt.
- Reset shows a confirmation warning.

Use loading skeletons for initial app initialization and simulated processing states, without introducing unnecessary delays.

No blank pages.

No dead buttons.

No lorem ipsum.

No placeholder analytics presented as authentic real-world data.

All buttons that should be disabled must explain why.

Use accessible labels, keyboard focus indicators, semantic HTML and sufficient contrast.

## 21. Demo data

Create deterministic fake seed data.

Use a fixed base Malaysia-local demo date for charts and initial sample historical records, but derive the starting operational clock from the current Malaysia time unless a deliberate seeded demo time is configured.

Opening a fresh demo during the real 01:00–05:00 closed window should follow the configured operating policy, unless the demo initialization explicitly switches into a clearly labeled simulated daytime.

Seed:

- 147 available bays.
- Two saved Malaysian plate numbers.
- RM50.00 wallet.
- Plausible hourly occupancy chart series.
- Small historical reservation and walk-in records for UI demonstration.
- Corresponding fake wallet ledger entries where historical data belongs to the user's account.
- Background occupancy and holds matching the central capacity model.

Historical demonstration records must not contradict the wallet's starting balance.

If historical wallet transactions are seeded, include a consistent opening credit or balance calculation.

## 22. Testing requirements

Write meaningful automated tests, including domain unit tests and major UI flows.

### Capacity invariants

Test:

- Reserving decreases available capacity by exactly one.
- Reserved entry converts held to occupied without double-decrement.
- Reservation cancellation restores exactly one unit.
- Reservation expiry restores exactly one unit.
- Checkout restores occupied capacity.
- Walk-in traffic cannot exceed walk-in capacity.
- Capacity never becomes negative.
- Total always equals occupied plus held plus available.

### Wallet and pricing

Test:

- Initial wallet RM50.00.
- Reservation deducts RM4.00.
- Expiry refunds RM4.00.
- Manual cancellation refunds RM4.00.
- Entry does not refund or recharge the reservation fee.
- Reserved exit deducts RM6.00.
- Reserved overall total equals RM10.00.
- Walk-in entry deducts RM3.00.
- Walk-in exit deducts RM3.00 under the configured credited-entry pricing policy.
- Duplicate event processing cannot charge or refund twice.
- Insufficient balance blocks payment without releasing occupied capacity.

### Clock and expiry

Test:

- Countdown starts close to 60:00.
- Warning thresholds are crossed correctly.
- Large fast-forward triggers the applicable notifications once.
- Expiry occurs at exactly the configured deadline.
- At expiry, entry is rejected.
- Reloading after expiry reconciles refund.
- Active parked sessions are not expired as reservations.

### Operating hours

Test:

- 00:59 allows bookings.
- 01:00 blocks bookings.
- 04:59 blocks bookings.
- 05:00 allows bookings.
- Checkout remains allowed while closed.
- 00:30 booking expires at 01:30.
- Crossing midnight does not break notification dates.

### Navigation and persistence

Test:

- Bottom navigation works.
- Refresh preserves reservations and wallet.
- Theme persists.
- Saved plates persist.
- Notification read status persists.
- Reset restores initial state.
- Signboard reflects capacity updates.
- Invalid saved state recovers gracefully.

### End-to-end test

Automate the following user journey:

1. Open Home.
2. Verify initial availability is 147.
3. Open Reserve.
4. Select WXY 1234.
5. Review RM4 reservation and RM10 total.
6. Confirm payment.
7. Verify wallet is RM46.
8. Verify available bays become 146.
9. Open My Parking.
10. Verify active countdown.
11. Fast-forward 45 minutes.
12. Verify warning.
13. Simulate reserved gate entry.
14. Verify plate recognition.
15. Complete the 9-second buffer.
16. Verify parked status.
17. Check out.
18. Confirm RM6 payment.
19. Verify wallet RM40.
20. Verify capacity returns to 147.
21. Verify final reservation/session state and receipt.

Also test a separate expiry/refund path.

## 23. MVP acceptance criteria

Do not declare MVP 1 complete until the following are true.

- The app starts successfully using the repository's documented commands.
- TypeScript checks without errors.
- Production build succeeds.
- Primary screens work at mobile widths.
- Light and dark modes function.
- All five tabs navigate successfully.
- Reservation payment works.
- Availability updates correctly.
- Countdown uses the central virtual clock.
- Time fast-forward works.
- Reservation expiration refunds the wallet.
- Reservation cancellation refunds the wallet.
- LPR simulation creates the correct session.
- The 9-second confirmation buffer works.
- Checkout charges the correct amount.
- Exiting releases capacity.
- Closing hours block new reservations but not checkout.
- Signboard is operational.
- Notifications are persisted and deduplicated.
- localStorage state survives refresh.
- Reset restores a consistent baseline.
- No obvious console errors.
- Unit and end-to-end tests pass, or any environment-related test limitations are reported.

## 24. Implementation order

Develop in this order:

### Phase A — Foundation

Set up Vite, TypeScript, Tailwind, shadcn/ui, routing, theme, app shell, navigation and basic responsiveness.

### Phase B — Domain engine

Build types, configuration, virtual clock, pricing, capacity calculations, wallet ledger, reducer, localStorage persistence and test fixtures.

Write key domain tests before connecting the UI.

### Phase C — Home

Build the live dashboard, capacity visualizations, occupancy chart, pricing comparison and navigation to Reserve.

### Phase D — Reservation

Implement vehicle selection, adding a plate, review, wallet top-up, booking and payment confirmation.

### Phase E — My Parking

Implement countdown, cancellation, expiration, notifications, entry transition, active session, checkout and thank-you state.

### Phase F — Demo Control Panel

Implement all simulation controls, accelerated clock tests, traffic adjustment, closing-hour tests and data reset.

### Phase G — Supporting UX

Implement notification centre, signboard, minimum Activity/Profile screens, light/dark polish, skeletons and responsive improvements.

### Phase H — Verification

Run the app, typecheck, lint, build, run tests, fix issues and perform the complete demo journey.

Use browser-based inspection or screenshots where the environment supports them.

## 25. Engineering and delivery requirements

First inspect the existing repository before modifying files.

If a project already exists, preserve useful code and follow its conventions where reasonable.

Do not replace working application structure unnecessarily.

Build reusable and maintainable components.

Keep domain logic independent from page components.

Keep demo actions clearly distinguished from real-world events.

Do not fabricate backend APIs.

Do not introduce authentication, databases, cloud services or real payment providers.

Do not use real user information.

Avoid overengineering infrastructure that is unnecessary for the MVP.

The result should remain easy to extend with actual APIs later.

### Final output expected from you

After implementing the app, provide:

1. Summary of completed functionality.
2. Important files and architecture.
3. Local development commands.
4. How to run the two-minute demonstration.
5. Test/build results.
6. Any unfinished functionality or known limitations.
7. Recommended next steps for MVP 2.

**Critical instruction:** Implement the working application and test it. Do not stop after creating an implementation plan, writing static screen mockups, or explaining what should be done.

The MVP should feel like a real university parking application while accurately identifying all payments, availability, gate scanning and notifications as simulated.
