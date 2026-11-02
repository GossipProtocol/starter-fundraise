# starter-fundraise

A sponsorship board for athletes, paid by card or USDC. An athlete lists the printable positions on their race kit and bike with a number, a size and a price. A brand claims one, the position is held, the brand pays through Stripe Checkout or sends USDC from a Privy embedded wallet, and the position reads as sold the moment the payment is verified. This is Module 2 starter from the course, built from two products that ran with real money: a static campaign builder on Supabase and a single-athlete board that sold out through Stripe. The bugs that cost those products money are fixed here and named below.

It runs in two modes:

- **Demo mode** (no env at all): an in-memory store seeded with one campaign, a working builder, and free claims that run the real reserve-then-mark-paid path. Everything is clickable in under a minute.
- **Live mode**: a Supabase ledger with row-locked SQL functions, Stripe Connect checkout and a signed webhook, Privy email login with an embedded wallet, and on-chain USDC verification on Base.

## The fee, stated plainly

Every paid position pays **1% of its price** to the course. The buyer pays exactly the listed price; the athlete receives 99%. The rate and the recipient live in one file, `lib/course-fee.ts`, and both rails read it:

- **Cards.** The Stripe Checkout Session is a Connect destination charge with `application_fee_amount` set to the fee. Stripe keeps the fee on the platform account and transfers the rest to the athlete's connected account inside the same payment.
- **USDC.** The buyer's wallet sends two transfers in the same checkout: the athlete's share to the campaign's payout address and the fee to `COURSE_FEE_RECIPIENT`. The server marks the position paid only after both transfers are verified on chain.

The fee is a default, not a license condition. This code is MIT licensed, so you can change it. If you change the recipient or the rate, say so in your README.

## What is in the box

| Area | Where | What it teaches |
|------|-------|-----------------|
| Presets | `lib/presets.ts` | The items an athlete races in and the positions on each, with suggested prices. One list drives the builder and the demo seed. |
| Campaign model | `lib/campaign.ts` | Types, validation that runs in the browser and again on the server, and the normalisers every stored row passes through. |
| Builder | `components/Builder.tsx`, `app/api/campaigns` | Pick items, tick positions, price them, publish. No account; the email is the athlete's proof of ownership later. |
| Store boundary | `lib/store/` | One interface, two stores. `reserve`, `commitPayment` and `releaseHold` are the only calls that change money state. |
| Ledger | `docs/schema.sql` | Positions, reservations, the hold, the uniqueness constraints and the three row-locked functions. The invariants live next to the data. |
| Mark paid | `lib/server/payments.ts` | The only writer. Idempotent on the provider reference, one position per call. |
| Card checkout | `app/api/checkout`, `lib/server/stripe.ts` | Hold first, then a Checkout Session built from the reservation, as a Connect destination charge with the application fee. |
| Webhook | `app/api/stripe/webhook` | Raw body, signature check, 200 fast, 500 on a failed write so Stripe retries, expired sessions release their hold. |
| USDC checkout | `app/api/usdc/reserve`, `app/api/usdc/confirm`, `lib/server/usdc.ts` | The payer is the embedded wallet on the verified token. Two legs, two receipts, Transfer logs matched against the reservation. |
| Wallet client | `components/UsdcPay.tsx`, `components/PrivyClientProvider.tsx` | Privy email login, an embedded wallet, viem transfers from it, confirm with the hashes. Mounted only where a wallet is needed. |
| Athlete payouts | `app/c/[slug]/connect`, `app/api/connect` | Stripe Connect Express onboarding and a USDC payout address, behind a verified Privy email that must match the campaign's private row. |
| Back of house | `app/api/admin/mark-paid`, `app/api/admin/release` | A manual mark for money that arrived outside the site, through the same writer, and an early release of a hold. |
| Fee | `lib/course-fee.ts` | The rate, the recipient, and the split used by both rails. |

## Run it in demo mode

```bash
npm install
npm run dev          # http://localhost:3000
```

Open `/c/demo`, claim a position for free, and watch it go to sold. Open `/create` to build a campaign of your own; it lives in memory until the dev server restarts.

## Go live

1. **Supabase.** Create a project, run `docs/schema.sql` in the SQL editor, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Setting the URL is what switches the site to live mode. Set `ADMIN_PASSWORD` for the admin routes.
2. **Fee wallet.** `lib/course-fee.ts` already carries the course fee recipient. Leave it as it is.
3. **Stripe.** Enable Connect on your Stripe account (Express accounts). Set `STRIPE_SECRET_KEY`. Run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and put the `whsec_` it prints in `STRIPE_WEBHOOK_SECRET`. In production add a webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired` and use that endpoint's secret instead.
4. **Privy.** Create an app, enable Email login and Ethereum embedded wallets, add your domain to allowed origins. Set `PRIVY_APP_ID` and `PRIVY_APP_SECRET`.
5. **Chain.** Set `NEXT_PUBLIC_USDC_CHAIN` to `base-sepolia` to rehearse and `USDC_RPC_URL` to an RPC for that chain. Switch to `base` when the money is real.
6. **An athlete connects payouts.** Publish a campaign, open `/c/<slug>/connect`, sign in with the publishing email, connect Stripe and save a payout address. Card and USDC each switch on for that campaign the moment their payout is set.

Copy `.env.example` to `.env.local` and fill the groups as you go. Each rail switches on independently, so a site with Stripe and no Privy sells by card only.

Then buy one cheap position for real on each rail and refund yourself. A board that still shows a position as available after someone has paid for it is the one bug that costs you a customer twice.

## How a live claim works

```
client                              server                                    outside
  POST /api/checkout {position,
       email, brand}           ->   reserve: open -> held, 30 min (row lock)
                                    build Checkout Session from the reservation
                                    (destination charge, application fee 1%)
  <- session url
  pay at Stripe                                                        -----> Stripe
                                    POST /api/stripe/webhook  <-------------- checkout.session.completed
                                    verify signature on the raw body
                                    markPaid(reference, session.id)  (once)
                                    held -> sold, reservation paid
  GET /c/<slug>?paid=<ref>     ->   page reads the store, position shows Sold

  POST /api/usdc/reserve       ->   payer = embedded wallet on the Privy token
       {position, brand}            reserve: open -> held, 15 min
  <- two legs: athlete 99%, fee 1%
  transfer x2 from the wallet                                          -----> Base
  POST /api/usdc/confirm       ->   read receipts, match Transfer logs:
       {reference, txHashes}        from = payer, to and value per leg
                                    markPaid(reference, athlete tx hash)  (once)
  <- ok
```

## Lessons from the products this came from

Three things are enforced that the original products did not enforce on day one, and they are the reason this starter exists:

- **Numbers stored as strings.** The first board kept its sold set in a Redis-style store whose client deserialised values, so position `"11"` came back as the number `11` and a set lookup for `"11"` missed. Position 11 stayed on sale after it had been paid for. Here every row that leaves a store passes through `str()` and `int()` in `lib/campaign.ts`, ids are UUID strings end to end, money is integer cents in the ledger and integer base units on chain, and nothing compares a position by a number that might have changed type on the way back.
- **An admin row that marked every position sold.** The first board had a "whole board" pseudo-position, and marking it sold closed every other position in the same write with no sale behind any of them. A repair job had to find the phantoms afterwards. Here `markPaid()` is the only writer, it marks exactly one position per call, there is no "mark all" path, and the schema's `sold_has_reservation` constraint means a sold position always names the reservation that paid for it.
- **A spot sold twice with no hold during checkout.** Paying was what reserved a position, so two brands could open Stripe Checkout for the same spot within minutes and both pay. One of them had to be refunded and moved to a different panel by hand. Here a checkout starts with a reservation hold that lasts as long as the Stripe session, a second buyer is told the position is being paid for, the webhook releases the hold when a session expires, and the paid write is idempotent on the Stripe session id or the transaction hash so a retry cannot count a payment twice.

## What is left for you

The two stores, the three money routes, the webhook, the fee split and the athlete payout flow are complete. The first milestone of the module is to run both rails end to end on test money: a card payment through `stripe listen` with the Connect application fee visible in the Stripe dashboard, and a USDC payment on Base Sepolia with both transfer hashes in the reservation's `raw` column, each with its position going to sold and its proof in the commit message. The capstone is a board of your own on a theme that is not race kit (a boat, a van, a stage, a newsletter) with one addition to the money path: a goal with a floor and automatic refunds if the deadline passes under it, or a sponsor artwork flow where the paying wallet or email is the only one allowed to upload, implemented through the same single writer and the same hold.

## Legal note

Selling advertising space is a straightforward sale, but moving money for other people is not: a platform that holds funds between buyer and athlete can be a money transmitter, and USDC accepted on a platform's behalf can carry the same obligations. This starter avoids custody on both rails (Stripe settles to the athlete's connected account, USDC goes straight to the athlete's address) and that is a design choice to keep, not an accident. Publish the fee, keep the buyer's receipt, and talk to counsel before mainnet. The course covers this in Module 2.

## Course

Consumer Layer, the course this starter is taught in, covers it in Module 2, with the Doppler skills installed from Module 0 onward. The course plugin's `fundraise` skill coaches each milestone and the `review` skill checks your fork against the module checklist.
