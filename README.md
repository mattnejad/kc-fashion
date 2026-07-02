# Kinsey Cathers Fashion

A private, local web app for tracking sales associate contacts, purchases
awaiting reimbursement, and hours worked. Built to run on a laptop or phone browser.

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
  is computed automatically from the payment method's rate. Attach a photo by
  dragging one in, dropping it, or tapping to choose from your device — it shows
  as a thumbnail in the purchases list and in that sales associate's purchase
  history.
- **Hours** — log hours + notes and mark them reimbursed when paid.
- **Stores & payment methods** — managed lists (☰ menu → Manage stores / Manage
  payment methods) so those fields stay picklists instead of free text; you can
  also add a new one on the fly from within the Contact/Purchase forms.

## How to run it

It's just static files — no install needed.

**Easiest:** double-click `index.html` to open it in your browser.

**On your phone (recommended for real use):** run a tiny local server so the phone
can reach it over Wi-Fi, or later deploy it (see below). From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` on the computer, or
`http://<computer-ip>:8000` on a phone on the same Wi-Fi.

On iPhone Safari you can tap **Share → Add to Home Screen** to get an app icon.

## Your data

Data is stored **on the device**, in the browser (localStorage). It is private and
never leaves the device. Because of that:

- Use the **☰ menu (top-right) → Export backup** regularly to save a `.json` copy.
- Use **Import backup** to restore or move data to another device.
- Photos are compressed automatically when added, but localStorage still has a
  size ceiling (typically a few MB). If storage ever fills up you'll get a
  warning — export a backup and remove a few older photos to free up space.

## Coming later (not in v1)

- Cloud sync / login so the same data shows up on every device.
- Commission calculation once the rules are known (there's a placeholder rate now).
- Texting multiple sales associates a photo to source a product.

## Files

- `index.html` — page shell + navigation
- `styles.css` — styling
- `app.js` — all app logic and storage
