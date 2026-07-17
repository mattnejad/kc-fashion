# Kinsey Cathers Fashion

A private, cloud-synced web app for tracking sales associate contacts, purchases
awaiting reimbursement, hours worked, and compensation.

**Live app:** https://kc-fashion-511b7.firebaseapp.com

## What it does

- **Overview** — Awaiting Reimbursement, Unpaid Hours, Reimbursed to Date, and
  Compensation to Date, plus a breakdown of compensation by type: cashback earned
  (from payment methods), hours worked (at your hourly wage), and an estimated
  commission (rate is a placeholder until the real rules are known).
- **Sales Associates** — a searchable, sortable directory of store contacts (name,
  store, location, role, phone, email, notes). Tap-to-call / text / email, and
  tap a card to see everything bought through that person plus total spend.
- **Purchases** — log a product + cost + store + sales associate + payment method,
  keep it on the "Awaiting" list, then mark it reimbursed when paid back. Cashback
  is computed automatically from the payment method's rate. Attach a product photo
  and a receipt by dragging one in, dropping it, or tapping to choose from your
  device — the photo shows as a thumbnail in the purchases list and in that sales
  associate's purchase history. Tap a purchase to see its full detail, tap its
  photo or receipt to view full screen. Search and sort the list.
- **Statement** — "Generate statement" on the Purchases tab builds a printable
  statement (date, product description, amount, grand total). Defaults to all
  items awaiting reimbursement; can also be scoped to a month or hand-picked.
  Optionally attaches each item's receipt and flags any item missing one.
- **Hours** — log hours + notes and mark them reimbursed when paid.
- **Stores & payment methods** — managed lists (☰ menu → Manage stores / Manage
  payment methods) so those fields stay picklists instead of free text; you can
  also add a new one on the fly from within the forms.

## Architecture

- **Frontend:** static HTML/CSS/JS in `public/`, no build step.
- **Auth:** Firebase Authentication, Google sign-in only. The `authDomain` is set
  to the hosting domain (`kc-fashion-511b7.web.app`) so the redirect sign-in flow
  is same-origin — required for reliable auth on iOS Safari / home-screen PWAs.
- **Data:** Cloud Firestore, one subtree per user:
  - `users/{uid}/meta/settings` — settings (stores, payment methods, rates)
  - `users/{uid}/contacts/{id}` · `users/{uid}/purchases/{id}` · `users/{uid}/hours/{id}`
  - Security rules (`firestore.rules`): each user can only read/write their own
    subtree. Photos are stored as compressed base64 JPEGs inside purchase docs.
- **Offline:** Firestore IndexedDB persistence (data reads/writes work offline and
  sync on reconnect) plus a service worker (`public/sw.js`) that caches the app
  shell so the app opens with no connection.
- **Hosting:** Firebase Hosting (`firebase deploy --only hosting`).
- **Migration:** on first sign-in, any data from the old localStorage-only version
  is automatically moved into the user's cloud account.

## Using it on a phone

1. Open https://kc-fashion-511b7.firebaseapp.com in Safari
2. Sign in with Google (one time per device)
3. Tap **Share → Add to Home Screen** for a full-screen app icon

## Deploying updates

```bash
firebase deploy --only hosting            # app changes
firebase deploy --only firestore:rules    # security rule changes
```

The Firebase project is `kc-fashion-511b7` (owner: kinseycathers@gmail.com).

## Backups

Data lives in the user's private Firestore account, but the ☰ menu still offers
**Export backup** (downloads all data as `.json`) and **Import backup** (replaces
account data with a backup file).
