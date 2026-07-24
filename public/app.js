/* ============================================================
   Kinsey Cathers Fashion
   Cloud-synced client/purchase/hours tracker.
   Data lives in Firestore, private to the signed-in user, with
   full offline support (reads/writes queue and sync on reconnect).
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Firebase setup ---------- */
  const firebaseConfig = {
    apiKey: "AIzaSyCVp0D1jYR_brsGR2_aoBE6bLb2IVSz_Os",
    // Use the .firebaseapp.com domain: its /__/auth/handler redirect URI is
    // pre-authorized on the auto-created OAuth client, and serving the app from
    // the same domain keeps sign-in same-origin (reliable on iOS Safari/PWA).
    authDomain: "kc-fashion-511b7.firebaseapp.com",
    projectId: "kc-fashion-511b7",
    storageBucket: "kc-fashion-511b7.firebasestorage.app",
    messagingSenderId: "468203753796",
    appId: "1:468203753796:web:d878f4f7dd142ad0494711",
  };
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const firestore = firebase.firestore();
  // Offline persistence: cache all data on-device; writes queue offline.
  firestore.enablePersistence({ synchronizeTabs: true }).catch((e) => {
    console.warn("Offline persistence unavailable", e && e.code);
  });

  const LEGACY_DB_KEY = "kinsey_cathers_fashion_v1"; // pre-cloud localStorage data
  const ALLOWED_EMAIL = "kinseycathers@gmail.com"; // only this account may use the app

  const defaultSettings = () => ({
    commissionRate: "", // percent, kept as string; details TBD
    hourlyWage: "", // dollars per hour, kept as string
    stores: ["Chanel", "Louis Vuitton", "Hermès", "Gucci", "Dior", "Saint Laurent", "Bottega Veneta"],
    brands: ["Chanel", "Louis Vuitton", "Hermès", "Gucci", "Dior", "Saint Laurent", "Bottega Veneta", "Prada", "Celine", "Loro Piana"],
    paymentMethods: [], // [{id, name, cashbackPercent}]
    // Public "Finds" portfolio on the sourcing website. Purchases publish by
    // default; `enabled` is the master switch and `minCost` is a private filter
    // (never shown publicly — only decides which finds appear).
    portfolio: { enabled: true, minCost: 0 },
    // Optional Google Sheets mirror (redundancy). `url` is an Apps Script web
    // app bound to Kinsey's sheet; `token` authorises writes. Never public.
    sheetsBackup: { enabled: false, url: "", token: "", lastSyncAt: 0, lastError: "" },
  });

  const defaultData = () => ({
    contacts: [],
    purchases: [],
    hours: [],
    clients: [],   // people/entities on the paying side (employer + clients)
    payments: [],  // money received, each allocated across outstanding items
    shipments: [], // packages sent, each covering one or more purchases
    settings: defaultSettings(),
  });

  // In-memory mirror of the user's Firestore data; render code reads this.
  let db = defaultData();
  let userId = null; // signed-in Firebase uid

  // Self-contained styles for the printable statement document (opened in a new
  // tab on iOS standalone). Colors are literal — no CSS variables — so the doc
  // needs nothing external and prints correctly offline.
  const STATEMENT_PRINT_CSS = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #1a1a1a;
      max-width: 720px; margin: 0 auto; padding: 28px 22px 48px; font-size: 15px; line-height: 1.6; }
    .st-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 26px; }
    .st-brand { display: flex; align-items: center; gap: 10px; }
    .st-mark { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; border: 1.5px solid #b8975a;
      color: #b8975a; display: flex; align-items: center; justify-content: center; font-size: 13px; letter-spacing: .5px; }
    .st-brand-name { font-size: 17px; letter-spacing: 1.5px; text-transform: uppercase; white-space: nowrap; }
    .st-brand-sub { font-size: 9.5px; letter-spacing: 3px; text-transform: uppercase; color: #b8975a; }
    .st-issued { font-size: 12.5px; color: #6b6660; font-family: sans-serif; white-space: nowrap; }
    h1 { font-size: 23px; margin: 0 0 4px; font-weight: 400; }
    .st-sub { color: #6b6660; margin: 0 0 20px; font-size: 14px; font-family: sans-serif; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e7e3dd; vertical-align: top; }
    th { font-family: sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
      color: #6b6660; border-bottom: 2px solid #1a1a1a; }
    td.amt, th.amt { text-align: right; white-space: nowrap; }
    .st-date { white-space: nowrap; color: #6b6660; font-size: 14px; }
    .st-prod { font-weight: 400; }
    .st-brand-col { color: #6b6660; }
    .st-prod-sub { font-size: 12.5px; color: #6b6660; margin-top: 2px; font-family: sans-serif; }
    tfoot td { font-weight: 700; font-size: 16.5px; border-top: 2px solid #1a1a1a; border-bottom: none; padding-top: 12px; }
    .st-total-sub { font-weight: 400; font-size: 12px; color: #6b6660; font-family: sans-serif; margin-top: 2px; }
    .st-foot-note { margin-top: 24px; font-size: 12.5px; color: #6b6660; font-family: sans-serif; }
    .st-receipts { margin-top: 34px; border-top: 2px solid #1a1a1a; padding-top: 18px; }
    .st-receipts-title { font-size: 18px; font-weight: 400; margin: 0 0 12px; }
    .st-missing-note { font-family: sans-serif; font-size: 12.5px; color: #b26a1e;
      background: #f7ecdc; border-radius: 8px; padding: 10px 12px; margin: 0 0 16px; }
    .st-receipt { margin: 0 0 22px; break-inside: avoid; page-break-inside: avoid; }
    .st-receipt img { width: 100%; max-width: 460px; display: block; border: 1px solid #e7e3dd; border-radius: 8px; }
    .st-receipt figcaption { font-family: sans-serif; font-size: 12px; color: #6b6660; margin-top: 6px; }
    .print-hint { margin-top: 30px; font-family: sans-serif; font-size: 13px; color: #6b6660;
      background: #faf9f7; border: 1px solid #e7e3dd; border-radius: 8px; padding: 12px 14px; }
    @media print {
      body { padding: 10px 20px 0; line-height: 1.4; }
      h1 { margin-bottom: 2px; }
      .st-head { margin-bottom: 12px; }
      .st-sub { margin-bottom: 12px; }
      th, td { padding: 4px 8px; }
      tfoot td { padding-top: 8px; }
      .st-foot-note { margin-top: 10px; break-inside: avoid; page-break-inside: avoid; }
      .print-hint { display: none; }
      .st-receipts { break-before: page; page-break-before: always; border-top: 0; }
      .st-receipt { break-inside: avoid; page-break-inside: avoid; }
    }
  `;
  let unsubscribers = [];

  const userDoc = () => firestore.collection("users").doc(userId);
  const col = (name) => userDoc().collection(name);
  const settingsRef = () => userDoc().collection("meta").doc("settings");

  // Persist the settings object (collections persist per-record in upsert/remove).
  function save() {
    if (!userId) return;
    settingsRef()
      .set(JSON.parse(JSON.stringify(db.settings)))
      .catch((e) => console.error("Settings sync error", e));
  }

  /* ---------- Helpers ---------- */
  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const $ = (sel, root = document) => root.querySelector(sel);

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const money = (n) =>
    "$" +
    (Number(n) || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  const todayISO = () => {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
  }

  // Firestore caps a document at 1 MiB and each purchase can now carry both a
  // product photo and a receipt, so shrink until the data URL fits its budget.
  // Receipts get a bigger budget//dimension because the text must stay readable.
  async function compressToBudget(file, maxDim, budget) {
    let dim = maxDim;
    let quality = 0.75;
    let out = await compressImage(file, dim, quality);
    for (let i = 0; i < 8 && out.length > budget; i++) {
      if (quality > 0.45) quality -= 0.1;
      else if (dim > 600) { dim = Math.round(dim * 0.8); quality = 0.6; }
      else break;
      out = await compressImage(file, dim, quality);
    }
    return out;
  }

  function compressImage(file, maxDim = 900, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Couldn't read file"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Not a valid image"));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
            else { width = Math.round(width * (maxDim / height)); height = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  /* ---------- App state ---------- */
  let currentTab = "dashboard";
  const ui = {
    contacts: { q: "", sort: "name" },
    purchases: { filter: "outstanding", q: "", sort: "recent", view: "items" },
    shipments: { sort: "recent" },
    hours: { filter: "outstanding" },
    clients: { q: "", sort: "name", filter: "all" },
    payments: { sort: "recent" },
  };

  const viewEl = $("#view");

  /* ============================================================
     DASHBOARD
     ============================================================ */
  function computeCompensation() {
    const totalPurchaseCost = db.purchases.reduce((s, p) => s + (Number(p.cost) || 0), 0);
    const totalCashback = db.purchases.reduce(
      (s, p) => s + (Number(p.cost) || 0) * ((Number(p.cashbackPercent) || 0) / 100),
      0
    );
    const totalHours = db.hours.reduce((s, h) => s + (Number(h.hours) || 0), 0);
    const hourlyWage = Number(db.settings.hourlyWage) || 0;
    const hoursValue = hourlyWage > 0 ? totalHours * hourlyWage : 0;

    const rate = Number(db.settings.commissionRate) || 0;
    const commissionEstimate = rate > 0 ? totalPurchaseCost * (rate / 100) : 0;

    return {
      totalHours,
      totalCashback,
      hoursValue,
      commissionEstimate,
      compensation: totalCashback + hoursValue + commissionEstimate,
    };
  }

  function renderDashboard() {
    const outstandingP = db.purchases.filter((p) => !p.reimbursed);
    const owedPurchases = outstandingP.reduce((s, p) => s + (Number(p.cost) || 0), 0);
    const reimbursedP = db.purchases
      .filter((p) => p.reimbursed)
      .reduce((s, p) => s + (Number(p.cost) || 0), 0);

    const outstandingH = db.hours.filter((h) => !h.reimbursed);
    const owedHours = outstandingH.reduce((s, h) => s + (Number(h.hours) || 0), 0);

    const { totalHours, totalCashback, hoursValue, commissionEstimate, compensation } = computeCompensation();

    viewEl.innerHTML = `
      <h2 class="view-title">Overview</h2>

      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Awaiting reimbursement</div>
          <div class="stat-value amber">${money(owedPurchases)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Unpaid hours</div>
          <div class="stat-value amber">${owedHours.toLocaleString()}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Reimbursed to date</div>
          <div class="stat-value green">${money(reimbursedP)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Compensation to date</div>
          <div class="stat-value green">${money(compensation)}</div>
        </div>
      </div>

      ${db.payments.length ? `<div class="stat full" style="margin-top:12px;">
        <div class="stat-label">Unallocated funds</div>
        <div class="stat-value ${totalUnallocated() > 0.001 ? "amber" : "green"}">${money(totalUnallocated())}</div>
        <p class="hint" style="margin-top:4px;">Received but not yet matched to an item. See the Payments tab.</p>
      </div>` : ""}

      <div class="section-label">Compensation breakdown</div>
      <div class="stat full">
        <div class="stat-label">Cashback earned (from payment methods)</div>
        <div class="stat-value green">${money(totalCashback)}</div>
        <p class="hint" style="margin-top:6px;">
          Based on the cashback % set on each payment method, applied to every purchase
          logged with that method. Manage methods from the ☰ menu.
        </p>
      </div>
      <div class="stat full" style="margin-top:10px;">
        ${
          hoursValue > 0
            ? `<div class="stat-label">Hours worked at ${money(db.settings.hourlyWage)}/hr</div>
               <div class="stat-value green">${money(hoursValue)}</div>`
            : `<div class="stat-label">Set an hourly wage to include hours worked</div>`
        }
        <p class="hint" style="margin-top:8px;">
          Based on ${totalHours.toLocaleString()} hours logged so far, regardless of
          reimbursement status.
        </p>
        <div class="field-row" style="margin-top:4px;">
          <div class="field" style="margin-bottom:0;">
            <label>Hourly wage ($)</label>
            <input id="hourly-wage" type="number" inputmode="decimal" step="0.5"
              placeholder="e.g. 25" value="${esc(db.settings.hourlyWage)}" />
          </div>
        </div>
      </div>
      <div class="stat full" style="margin-top:10px;">
        ${
          commissionEstimate > 0
            ? `<div class="stat-label">Estimated commission at ${esc(db.settings.commissionRate)}% of purchases</div>
               <div class="stat-value green">${money(commissionEstimate)}</div>`
            : `<div class="stat-label">Set a commission rate to include an estimate</div>`
        }
        <p class="hint" style="margin-top:8px;">
          Commission rules aren't finalized yet. Set a rough % here and refine the
          formula later — this is a placeholder estimate, not a payout figure.
        </p>
        <div class="field-row" style="margin-top:4px;">
          <div class="field" style="margin-bottom:0;">
            <label>Commission rate (%)</label>
            <input id="commission-rate" type="number" inputmode="decimal" step="0.5"
              placeholder="e.g. 10" value="${esc(db.settings.commissionRate)}" />
          </div>
        </div>
      </div>

      <div class="section-label">Totals</div>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Purchases logged</div>
          <div class="stat-value">${db.purchases.length}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Hours logged</div>
          <div class="stat-value">${totalHours.toLocaleString()}</div>
        </div>
      </div>
    `;

    const rateInput = $("#commission-rate");
    rateInput.addEventListener("change", () => {
      db.settings.commissionRate = rateInput.value.trim();
      save();
      renderDashboard();
    });

    const wageInput = $("#hourly-wage");
    wageInput.addEventListener("change", () => {
      db.settings.hourlyWage = wageInput.value.trim();
      save();
      renderDashboard();
    });
  }

  /* ============================================================
     CONTACTS
     ============================================================ */
  function renderContacts() {
    const { q, sort } = ui.contacts;
    let list = db.contacts.slice();

    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.store, c.location, c.title, c.notes, c.phone, c.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      );
    }

    list.sort((a, b) => {
      if (sort === "store")
        return (a.store || "").localeCompare(b.store || "") ||
          (a.name || "").localeCompare(b.name || "");
      if (sort === "recent") return (b.createdAt || 0) - (a.createdAt || 0);
      return (a.name || "").localeCompare(b.name || "");
    });

    viewEl.innerHTML = `
      <h2 class="view-title">Sales Associates</h2>
      <div class="toolbar">
        <div class="search">
          <span>&#9906;</span>
          <input id="contact-search" type="search" placeholder="Search name, store, notes…"
            value="${esc(q)}" />
        </div>
        <select id="contact-sort" class="select" aria-label="Sort">
          <option value="name" ${sort === "name" ? "selected" : ""}>Name</option>
          <option value="store" ${sort === "store" ? "selected" : ""}>Store</option>
          <option value="recent" ${sort === "recent" ? "selected" : ""}>Newest</option>
        </select>
      </div>
      <div id="contact-list">
        ${
          list.length
            ? list.map(contactCard).join("")
            : emptyState("&#128100;", db.contacts.length ? "No matches." : "No sales associates yet. Tap + to add one.")
        }
      </div>
    `;

    const search = $("#contact-search");
    search.addEventListener("input", () => {
      ui.contacts.q = search.value;
      const listEl = $("#contact-list");
      const filtered = filterContacts();
      listEl.innerHTML = filtered.length
        ? filtered.map(contactCard).join("")
        : emptyState("&#128100;", "No matches.");
      bindContactCards();
    });
    $("#contact-sort").addEventListener("change", (e) => {
      ui.contacts.sort = e.target.value;
      renderContacts();
    });
    bindContactCards();
  }

  function filterContacts() {
    const { q, sort } = ui.contacts;
    let list = db.contacts.slice();
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.store, c.location, c.title, c.notes, c.phone, c.email]
          .filter(Boolean).join(" ").toLowerCase().includes(needle)
      );
    }
    list.sort((a, b) => {
      if (sort === "store")
        return (a.store || "").localeCompare(b.store || "") || (a.name || "").localeCompare(b.name || "");
      if (sort === "recent") return (b.createdAt || 0) - (a.createdAt || 0);
      return (a.name || "").localeCompare(b.name || "");
    });
    return list;
  }

  function contactCard(c) {
    const links = [];
    if (c.phone) {
      links.push(`<a class="link-btn" href="tel:${esc(c.phone)}">Call</a>`);
      links.push(`<a class="link-btn" href="sms:${esc(c.phone)}">Text</a>`);
    }
    if (c.email) links.push(`<a class="link-btn" href="mailto:${esc(c.email)}">Email</a>`);

    const meta = [c.location, c.title].filter(Boolean).join(" · ");

    return `
      <div class="card card-clickable" data-id="${c.id}">
        <div class="card-row">
          <div class="avatar">${esc(initials(c.name))}</div>
          <div class="card-main">
            <div class="card-title">${esc(c.name)}</div>
            <div class="card-sub">
              ${c.store ? `<span class="chip">${esc(c.store)}</span> ` : ""}
              ${esc(meta)}
            </div>
            ${c.notes ? `<div class="card-notes">${esc(c.notes)}</div>` : ""}
            ${links.length ? `<div class="contact-links">${links.join("")}</div>` : ""}
          </div>
          <div class="card-actions">
            <button class="mini-btn" data-act="edit">Edit</button>
          </div>
        </div>
      </div>`;
  }

  function bindContactCards() {
    viewEl.querySelectorAll(".card[data-id]").forEach((card) => {
      const id = card.dataset.id;
      const c = db.contacts.find((x) => x.id === id);
      if (!c) return;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".mini-btn, .link-btn")) return;
        openContactView(c);
      });
      card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openContactForm(c));
    });
  }

  function openContactForm(existing) {
    const c = existing || {};
    openModal(existing ? "Edit sales associate" : "New sales associate", `
      <div class="field">
        <label>Name *</label>
        <input id="f-name" type="text" value="${esc(c.name || "")}" placeholder="Jane Doe" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Store</label>
          <select id="f-store">${storeSelectOptions(c.store || "")}</select>
        </div>
        <div class="field">
          <label>Location</label>
          <input id="f-location" type="text" value="${esc(c.location || "")}" placeholder="Beverly Hills, CA" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Title / role</label>
          <input id="f-title" type="text" value="${esc(c.title || "")}" placeholder="SA, Manager…" />
        </div>
        <div class="field">
          <label>Phone</label>
          <input id="f-phone" type="tel" value="${esc(c.phone || "")}" placeholder="(555) 123-4567" />
        </div>
      </div>
      <div class="field">
        <label>Email</label>
        <input id="f-email" type="email" value="${esc(c.email || "")}" placeholder="name@store.com" />
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="f-notes" placeholder="Preferences, what they can source, best time to reach…">${esc(c.notes || "")}</textarea>
      </div>
    `, {
      onSave: () => {
        const name = $("#f-name").value.trim();
        if (!name) { toast("Name is required"); return false; }
        const rec = {
          id: c.id || uid(),
          name,
          store: $("#f-store").value || "",
          location: $("#f-location").value.trim(),
          title: $("#f-title").value.trim(),
          phone: $("#f-phone").value.trim(),
          email: $("#f-email").value.trim(),
          notes: $("#f-notes").value.trim(),
          createdAt: c.createdAt || Date.now(),
        };
        upsert("contacts", rec);
        toast(existing ? "Sales associate updated" : "Sales associate added");
        renderContacts();
        return true;
      },
      onDelete: existing ? () => {
        remove("contacts", c.id);
        toast("Sales associate deleted");
        renderContacts();
      } : null,
    });

    $("#f-store").addEventListener("change", (e) => handleStoreSelectChange(e.target));
  }

  function openContactView(c) {
    const purchases = db.purchases
      .filter((p) => p.contactId === c.id)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const totalSpend = purchases.reduce((s, p) => s + (Number(p.cost) || 0), 0);

    const links = [];
    if (c.phone) {
      links.push(`<a class="link-btn" href="tel:${esc(c.phone)}">Call</a>`);
      links.push(`<a class="link-btn" href="sms:${esc(c.phone)}">Text</a>`);
    }
    if (c.email) links.push(`<a class="link-btn" href="mailto:${esc(c.email)}">Email</a>`);

    const meta = [c.location, c.title].filter(Boolean).join(" · ");

    const purchaseRows = purchases.length
      ? purchases.map((p) => `
        <div class="mini-row">
          <div style="display:flex; align-items:center; gap:10px;">
            ${p.photo ? `<img class="thumb thumb-sm" src="${esc(p.photo)}" alt="${esc(p.product)}" />` : ""}
            <div>
              <div class="mini-row-title">${esc(p.product)}</div>
              <div class="mini-row-sub">${esc(fmtDate(p.date))}</div>
            </div>
          </div>
          <div class="mini-row-right">
            <div class="amount">${money(p.cost)}</div>
            <span class="chip ${p.reimbursed ? "green" : "amber"}">${p.reimbursed ? "Reimbursed" : "Awaiting"}</span>
          </div>
        </div>`).join("")
      : `<p class="hint">No purchases logged for this sales associate yet.</p>`;

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-grip"></div>
          <h2>${esc(c.name)}</h2>
          <div class="card-sub" style="margin-bottom:10px;">
            ${c.store ? `<span class="chip">${esc(c.store)}</span> ` : ""}
            ${esc(meta)}
          </div>
          ${c.notes ? `<div class="card-notes" style="margin-bottom:12px;">${esc(c.notes)}</div>` : ""}
          ${links.length ? `<div class="contact-links" style="margin-bottom:18px;">${links.join("")}</div>` : ""}
          <div class="section-label" style="margin:0 2px 8px;">Purchase history</div>
          ${purchaseRows}
          <div class="stat full" style="margin-top:14px;">
            <div class="stat-label">Total spend</div>
            <div class="stat-value">${money(totalSpend)}</div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="view-close">Close</button>
            <button type="button" class="btn btn-primary" id="view-edit">Edit</button>
          </div>
        </div>
      </div>`;

    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) close();
    });
    $("#view-close", root).addEventListener("click", close);
    $("#view-edit", root).addEventListener("click", () => { close(); openContactForm(c); });
  }

  /* ============================================================
     PURCHASES
     ============================================================ */
  function filterPurchases() {
    const { filter, q, sort } = ui.purchases;
    let list = db.purchases.slice();

    if (filter === "outstanding") list = list.filter((p) => !p.reimbursed);
    if (filter === "reimbursed") list = list.filter((p) => p.reimbursed);

    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((p) => {
        const contact = p.contactId ? db.contacts.find((c) => c.id === p.contactId) : null;
        return [p.product, p.brand, p.store, p.paymentMethod, p.notes, contact ? contact.name : ""]
          .filter(Boolean).join(" ").toLowerCase().includes(needle);
      });
    }

    list.sort((a, b) => {
      if (sort === "product") return (a.product || "").localeCompare(b.product || "");
      if (sort === "cost-high") return (Number(b.cost) || 0) - (Number(a.cost) || 0);
      if (sort === "cost-low") return (Number(a.cost) || 0) - (Number(b.cost) || 0);
      if (sort === "oldest") return (a.date || "").localeCompare(b.date || "") || (a.createdAt||0)-(b.createdAt||0);
      // recent (default)
      return (b.date || "").localeCompare(a.date || "") || (b.createdAt||0)-(a.createdAt||0);
    });
    return list;
  }

  function renderPurchases() {
    if (ui.purchases.view === "shipments") return renderShipments();
    const { filter, q, sort } = ui.purchases;
    const list = filterPurchases();

    const owed = db.purchases.filter((p) => !p.reimbursed)
      .reduce((s, p) => s + (Number(p.cost) || 0), 0);

    const listEmpty = () => q.trim()
      ? emptyState("&#128717;", "No matches.")
      : emptyState("&#128717;", filter==="outstanding" ? "Nothing outstanding — all caught up." : "No purchases here yet.");

    viewEl.innerHTML = `
      <h2 class="view-title">Purchases</h2>
      ${viewSwitcherHtml("items")}
      <div class="stat full" style="margin-bottom:10px;">
        <div class="stat-label">Currently awaiting reimbursement</div>
        <div class="stat-value amber">${money(owed)}</div>
      </div>
      <button type="button" class="btn btn-ghost" id="btn-statement"
        style="width:100%; margin-bottom:14px;">Generate statement</button>
      <div class="toolbar">
        <div class="search">
          <span>&#9906;</span>
          <input id="purchase-search" type="search" placeholder="Search product, brand, store…"
            value="${esc(q)}" />
        </div>
        <select id="purchase-sort" class="select" aria-label="Sort">
          <option value="recent" ${sort==="recent"?"selected":""}>Newest</option>
          <option value="oldest" ${sort==="oldest"?"selected":""}>Oldest</option>
          <option value="product" ${sort==="product"?"selected":""}>Product</option>
          <option value="cost-high" ${sort==="cost-high"?"selected":""}>Cost: high</option>
          <option value="cost-low" ${sort==="cost-low"?"selected":""}>Cost: low</option>
        </select>
      </div>
      <div class="segment">
        <button data-f="outstanding" class="${filter==="outstanding"?"active":""}">Awaiting</button>
        <button data-f="reimbursed" class="${filter==="reimbursed"?"active":""}">Reimbursed</button>
        <button data-f="all" class="${filter==="all"?"active":""}">All</button>
      </div>
      <div id="purchase-list">
        ${list.length ? list.map(purchaseCard).join("") : listEmpty()}
      </div>
    `;

    const search = $("#purchase-search");
    search.addEventListener("input", () => {
      ui.purchases.q = search.value;
      const filtered = filterPurchases();
      $("#purchase-list").innerHTML = filtered.length ? filtered.map(purchaseCard).join("") : listEmpty();
      bindPurchaseCards();
    });
    $("#purchase-sort").addEventListener("change", (e) => {
      ui.purchases.sort = e.target.value;
      renderPurchases();
    });
    $("#btn-statement").addEventListener("click", openStatementBuilder);
    viewEl.querySelectorAll(".segment button").forEach((b) =>
      b.addEventListener("click", () => { ui.purchases.filter = b.dataset.f; renderPurchases(); })
    );
    bindViewSwitcher();
    bindPurchaseCards();
  }

  // Items / Shipments switcher shown at the top of the Purchases tab.
  function viewSwitcherHtml(active) {
    return `
      <div class="view-switch">
        <button data-v="items" class="${active === "items" ? "active" : ""}">Items</button>
        <button data-v="shipments" class="${active === "shipments" ? "active" : ""}">Shipments</button>
      </div>`;
  }
  function bindViewSwitcher() {
    viewEl.querySelectorAll(".view-switch button").forEach((b) =>
      b.addEventListener("click", () => { ui.purchases.view = b.dataset.v; renderPurchases(); })
    );
  }

  function purchaseCard(p) {
    const contact = p.contactId ? db.contacts.find((c) => c.id === p.contactId) : null;
    const sub = [fmtDate(p.date), contact ? contact.name : null].filter(Boolean).join(" · ");
    const cashbackAmt = (Number(p.cost) || 0) * ((Number(p.cashbackPercent) || 0) / 100);
    return `
      <div class="card card-clickable" data-id="${p.id}">
        <div class="card-row">
          ${p.photo ? `<img class="thumb" src="${esc(p.photo)}" alt="${esc(p.product)}" />` : ""}
          <div class="card-main">
            <div class="card-title">${esc(p.product)}</div>
            <div class="card-sub">
              ${p.brand ? `<span class="chip">${esc(p.brand)}</span> ` : ""}
              ${p.store && p.store !== p.brand ? `<span class="chip">${esc(p.store)}</span> ` : ""}
              ${esc(sub)}
            </div>
            ${p.notes ? `<div class="card-notes">${esc(p.notes)}</div>` : ""}
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              ${p.reimbursed
                ? `<span class="chip green">Reimbursed${p.reimbursedDate ? " · " + esc(fmtDate(p.reimbursedDate)) : ""}</span>`
                : `<span class="chip amber">Awaiting</span>`}
              ${p.paymentMethod ? `<span class="chip">${esc(p.paymentMethod)}</span>` : ""}
              ${cashbackAmt > 0 ? `<span class="chip green">+${money(cashbackAmt)} cashback</span>` : ""}
              ${p.shipped ? `<span class="chip">&#128230; Shipped</span>` : ""}
            </div>
          </div>
          <div class="card-actions" style="flex-direction:column; align-items:flex-end;">
            <div class="amount big">${money(p.cost)}</div>
            <button class="mini-btn" data-act="toggle">${p.reimbursed ? "Undo" : "Mark paid"}</button>
            <button class="mini-btn" data-act="edit">Edit</button>
          </div>
        </div>
      </div>`;
  }

  function bindPurchaseCards() {
    viewEl.querySelectorAll(".card[data-id]").forEach((card) => {
      const id = card.dataset.id;
      const p = db.purchases.find((x) => x.id === id);
      if (!p) return;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".mini-btn")) return;
        openPurchaseView(p);
      });
      card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openPurchaseForm(p));
      card.querySelector('[data-act="toggle"]')?.addEventListener("click", () => {
        p.reimbursed = !p.reimbursed;
        p.reimbursedDate = p.reimbursed ? todayISO() : "";
        upsert("purchases", p);
        toast(p.reimbursed ? "Marked reimbursed" : "Moved back to awaiting");
        renderPurchases();
      });
    });
  }

  // Full-screen photo viewer (lightbox). Supports the phone's back gesture:
  // opening pushes a history entry, so a back-swipe closes the photo instead
  // of leaving the app. A visible Back button and backdrop tap also close it.
  function openPhotoViewer(dataUrl) {
    if (!dataUrl) return;
    const overlay = document.createElement("div");
    overlay.className = "photo-viewer";
    overlay.innerHTML = `
      <button type="button" class="photo-viewer-back" aria-label="Back">&#8592; Back</button>
      <img class="photo-viewer-img" src="${esc(dataUrl)}" alt="" />
    `;
    document.body.appendChild(overlay);
    document.body.classList.add("no-scroll");

    let done = false;
    let pushed = false;

    function teardown() {
      if (done) return;
      done = true;
      overlay.remove();
      document.body.classList.remove("no-scroll");
      window.removeEventListener("popstate", onPop);
    }
    // Browser / OS back button pressed while the viewer is open.
    function onPop() { teardown(); }
    // Back button or backdrop tap: unwind the history entry we added.
    function closeAndUnwind() {
      if (done) return;
      window.removeEventListener("popstate", onPop);
      teardown();
      if (pushed) history.back();
    }

    try { history.pushState({ kcPhotoViewer: true }, ""); pushed = true; } catch (e) { /* ignore */ }
    window.addEventListener("popstate", onPop);

    overlay.querySelector(".photo-viewer-back").addEventListener("click", closeAndUnwind);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeAndUnwind(); // tap outside the image
    });
  }

  function openPurchaseView(p) {
    const contact = p.contactId ? db.contacts.find((c) => c.id === p.contactId) : null;
    const cashbackAmt = (Number(p.cost) || 0) * ((Number(p.cashbackPercent) || 0) / 100);
    const meta = [fmtDate(p.date), contact ? contact.name : null].filter(Boolean).join(" · ");

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-grip"></div>
          ${p.photo ? `<button type="button" class="view-photo-wrap" id="view-photo-btn" aria-label="View photo full screen">
            <img class="view-photo" src="${esc(p.photo)}" alt="${esc(p.product)}" />
            <span class="view-photo-zoom" aria-hidden="true">&#10530;</span>
          </button>` : ""}
          <h2>${esc(p.product)}</h2>
          <div class="amount big" style="margin-bottom:10px;">${money(p.cost)}</div>
          <div class="card-sub" style="margin-bottom:12px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            ${p.brand ? `<span class="chip">${esc(p.brand)}</span>` : ""}
            ${p.store && p.store !== p.brand ? `<span class="chip">${esc(p.store)}</span>` : ""}
            ${meta ? `<span>${esc(meta)}</span>` : ""}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px;">
            ${p.reimbursed
              ? `<span class="chip green">Reimbursed${p.reimbursedDate ? " · " + esc(fmtDate(p.reimbursedDate)) : ""}</span>`
              : `<span class="chip amber">Awaiting reimbursement</span>`}
            ${p.paymentMethod ? `<span class="chip">${esc(p.paymentMethod)}</span>` : ""}
            ${cashbackAmt > 0 ? `<span class="chip green">+${money(cashbackAmt)} cashback</span>` : ""}
          </div>
          ${p.notes ? `<div class="card-notes" style="margin-bottom:12px;">${esc(p.notes)}</div>` : ""}
          <div class="receipt-line">
            ${p.receipt
              ? `<button type="button" class="receipt-chip" id="view-receipt-btn">
                   <img src="${esc(p.receipt)}" alt="" />
                   <span>View receipt</span>
                 </button>`
              : `<span class="chip amber">No receipt attached</span>`}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="view-close">Close</button>
            <button type="button" class="btn btn-ghost" id="view-toggle">${p.reimbursed ? "Mark unpaid" : "Mark paid"}</button>
            <button type="button" class="btn btn-primary" id="view-edit">Edit</button>
          </div>
        </div>
      </div>`;

    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) close();
    });
    $("#view-photo-btn", root)?.addEventListener("click", () => openPhotoViewer(p.photo));
    $("#view-receipt-btn", root)?.addEventListener("click", () => openPhotoViewer(p.receipt));
    $("#view-close", root).addEventListener("click", close);
    $("#view-edit", root).addEventListener("click", () => { close(); openPurchaseForm(p); });
    $("#view-toggle", root).addEventListener("click", () => {
      p.reimbursed = !p.reimbursed;
      p.reimbursedDate = p.reimbursed ? todayISO() : "";
      upsert("purchases", p);
      toast(p.reimbursed ? "Marked reimbursed" : "Moved back to awaiting");
      close();
      renderPurchases();
    });
  }

  function openPurchaseForm(existing) {
    const p = existing || {};
    let photoField, receiptField; // set once the modal markup exists (below)
    const contactOptions = ['<option value="">— none —</option>']
      .concat(db.contacts.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""))
        .map((c) => `<option value="${c.id}" data-store="${esc(c.store || "")}" ${p.contactId===c.id?"selected":""}>${esc(c.name)}${c.store?` (${esc(c.store)})`:""}</option>`))
      .join("");

    openModal(existing ? "Edit purchase" : "New purchase", `
      <div class="field">
        <label>Product *</label>
        <input id="f-product" type="text" value="${esc(p.product || "")}" placeholder="Classic Flap Bag" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Cost *</label>
          <input id="f-cost" type="number" inputmode="decimal" step="0.01" value="${esc(p.cost ?? "")}" placeholder="0.00" />
        </div>
        <div class="field">
          <label>Date</label>
          <input id="f-date" type="date" value="${esc(p.date || todayISO())}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Brand</label>
          <select id="f-brand">${brandSelectOptions(p.brand || "")}</select>
        </div>
        <div class="field">
          <label>Store</label>
          <select id="f-store">${storeSelectOptions(p.store || "")}</select>
        </div>
      </div>
      <div class="field">
        <label>Sales Associate</label>
        <select id="f-contact">${contactOptions}</select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Payment method</label>
          <select id="f-payment">${paymentSelectOptions(p.paymentMethod || "")}</select>
        </div>
        <div class="field">
          <label>Cashback</label>
          <input id="f-cashback-preview" type="text" value="—" disabled />
        </div>
      </div>
      ${imageDropHtml("photo", "Photo", p.photo, "&#128247;", "Drag &amp; drop a photo here, or tap to choose")}
      ${imageDropHtml("receipt", "Receipt", p.receipt, "&#129534;", "Add the receipt — drop it here, or tap to choose", true)}
      <div class="field">
        <label>Notes</label>
        <textarea id="f-notes" placeholder="Client, order #, anything to remember…">${esc(p.notes || "")}</textarea>
      </div>
      <div class="check-field">
        <input id="f-reimbursed" type="checkbox" ${p.reimbursed ? "checked" : ""} />
        <label for="f-reimbursed">Already reimbursed</label>
      </div>
      <div class="portfolio-block" style="margin-top:14px; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-2);">
        <div class="check-field" style="margin:0;">
          <input id="f-portfolio" type="checkbox" ${p.portfolioHidden ? "" : "checked"} />
          <label for="f-portfolio">Show on my public <strong>Finds</strong> portfolio</label>
        </div>
        <p class="hint" style="margin:6px 0 0;">Publishes only the photo, brand, item name${""}
          &amp; date to the website — never the cost, client, or receipt.</p>
        <div id="f-portfolio-opts" style="margin-top:10px; ${p.portfolioHidden ? "display:none;" : ""}">
          <div class="field" style="margin-bottom:10px;">
            <label>Display name on site <span class="hint" style="text-transform:none; letter-spacing:0;">(optional — defaults to Product)</span></label>
            <input id="f-portfolio-name" type="text" value="${esc(p.portfolioName || "")}" placeholder="${esc(p.product || "e.g. Classic Flap Bag")}" />
          </div>
          <div class="check-field" style="margin:0;">
            <input id="f-portfolio-hidedate" type="checkbox" ${p.portfolioHideDate ? "checked" : ""} />
            <label for="f-portfolio-hidedate">Hide the date on the site</label>
          </div>
        </div>
      </div>
    `, {
      onSave: () => {
        const product = $("#f-product").value.trim();
        const cost = $("#f-cost").value;
        if (!product) { toast("Product is required"); return false; }
        if (cost === "" || isNaN(Number(cost))) { toast("Enter a valid cost"); return false; }
        const reimbursed = $("#f-reimbursed").checked;
        const paymentName = $("#f-payment").value;
        const pm = db.settings.paymentMethods.find((m) => m.name === paymentName);
        const rec = {
          id: p.id || uid(),
          product,
          cost: Number(cost),
          date: $("#f-date").value || todayISO(),
          brand: $("#f-brand").value || "",
          store: $("#f-store").value || "",
          contactId: $("#f-contact").value || "",
          paymentMethod: paymentName || "",
          cashbackPercent: pm ? pm.cashbackPercent : 0,
          photo: photoField.value(),
          receipt: receiptField.value(),
          notes: $("#f-notes").value.trim(),
          reimbursed,
          reimbursedDate: reimbursed ? (p.reimbursedDate || todayISO()) : "",
          createdAt: p.createdAt || Date.now(),
          // Public "Finds" portfolio controls (see syncPortfolio).
          portfolioHidden: !$("#f-portfolio").checked,
          portfolioHideDate: $("#f-portfolio-hidedate").checked,
          portfolioName: $("#f-portfolio-name").value.trim(),
        };
        // Firestore rejects documents over 1 MiB; fail loudly rather than
        // silently losing the purchase.
        if (JSON.stringify(rec).length > 1000000) {
          toast("Photo + receipt are too large — remove or retake one");
          return false;
        }
        upsert("purchases", rec);
        syncPortfolio(rec); // publish/unpublish on the public site
        toast(existing ? "Purchase updated" : "Purchase added");
        renderPurchases();
        return true;
      },
      onDelete: existing ? () => { remove("purchases", p.id); removePortfolio(p.id); toast("Purchase deleted"); renderPurchases(); } : null,
    });

    const updateCashbackPreview = () => {
      const cost = Number($("#f-cost").value) || 0;
      const pm = db.settings.paymentMethods.find((m) => m.name === $("#f-payment").value);
      const pct = pm ? pm.cashbackPercent : 0;
      $("#f-cashback-preview").value = pct > 0 ? `${money((cost * pct) / 100)} (${pct}%)` : "—";
    };

    $("#f-brand").addEventListener("change", (e) => handleBrandSelectChange(e.target));
    $("#f-store").addEventListener("change", (e) => handleStoreSelectChange(e.target));
    $("#f-payment").addEventListener("change", (e) => { handlePaymentSelectChange(e.target); updateCashbackPreview(); });
    $("#f-cost").addEventListener("input", updateCashbackPreview);
    $("#f-contact").addEventListener("change", (e) => {
      const opt = e.target.selectedOptions[0];
      const contactStore = opt ? opt.dataset.store : "";
      const storeSel = $("#f-store");
      if (contactStore && !storeSel.value) addOptionAndSelect(storeSel, contactStore);
    });
    updateCashbackPreview();

    // Show the per-item portfolio options only when it's set to appear on the site.
    $("#f-portfolio").addEventListener("change", (e) => {
      $("#f-portfolio-opts").style.display = e.target.checked ? "" : "none";
    });

    photoField = setupImageDrop("photo", p.photo, { maxDim: 900, budget: 320000 });
    receiptField = setupImageDrop("receipt", p.receipt, { maxDim: 1600, budget: 480000, redactable: true });
  }

  // Markup for one drag-and-drop / tap-to-choose image field.
  function imageDropHtml(key, label, value, icon, hint, redactable) {
    return `
      <div class="field">
        <label>${esc(label)}</label>
        <div id="${key}-drop" class="photo-drop">
          <div id="${key}-preview-wrap" class="photo-preview-wrap" style="${value ? "" : "display:none;"}">
            <img id="${key}-preview" src="${esc(value || "")}" alt="${esc(label)}" />
            <div class="photo-preview-actions">
              ${redactable ? `<button type="button" class="mini-btn" id="${key}-redact">Hide details</button>` : ""}
              <button type="button" class="mini-btn photo-remove" id="${key}-remove">Remove</button>
            </div>
          </div>
          <div id="${key}-placeholder" class="photo-placeholder" style="${value ? "display:none;" : ""}">
            <div class="photo-placeholder-ico">${icon}</div>
            <p>${hint}</p>
          </div>
        </div>
        <input id="${key}-input" type="file" accept="image/*" hidden />
      </div>`;
  }

  // Wires up an image drop field; returns { value() } for reading it back.
  function setupImageDrop(key, initial, { maxDim, budget, redactable } = {}) {
    let dataUrl = initial || "";
    const dropZone = $(`#${key}-drop`);
    const fileInput = $(`#${key}-input`);
    const preview = $(`#${key}-preview`);
    const previewWrap = $(`#${key}-preview-wrap`);
    const placeholder = $(`#${key}-placeholder`);

    function show(url) {
      dataUrl = url;
      preview.src = url || "";
      previewWrap.style.display = url ? "" : "none";
      placeholder.style.display = url ? "none" : "";
    }

    async function handleFile(file) {
      if (!file) return;
      if (!file.type.startsWith("image/")) { toast("Please choose an image file"); return; }
      dropZone.classList.add("busy");
      try {
        show(await compressToBudget(file, maxDim, budget));
      } catch (err) {
        console.error(err);
        toast("Couldn't read that image");
      } finally {
        dropZone.classList.remove("busy");
      }
    }

    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      handleFile(e.dataTransfer.files[0]);
    });
    $(`#${key}-remove`).addEventListener("click", (e) => { e.stopPropagation(); show(""); });
    if (redactable) {
      $(`#${key}-redact`)?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!dataUrl) { toast("Add a receipt first"); return; }
        openRedactor(dataUrl, budget, (redacted) => show(redacted));
      });
    }

    return { value: () => dataUrl };
  }

  // Re-encode a canvas to a JPEG data URL that fits the byte budget. Because
  // the redaction boxes are painted onto the pixels before this runs, the
  // covered content is destroyed — there is no hidden layer to recover, and
  // JPEG re-encoding also strips any original EXIF/GPS metadata.
  function canvasToJpegBudget(srcCanvas, budget) {
    let canvas = srcCanvas;
    let quality = 0.8;
    let out = canvas.toDataURL("image/jpeg", quality);
    for (let i = 0; i < 8 && out.length > budget; i++) {
      if (quality > 0.45) {
        quality -= 0.1;
      } else if (Math.max(canvas.width, canvas.height) > 700) {
        const c2 = document.createElement("canvas");
        c2.width = Math.round(canvas.width * 0.8);
        c2.height = Math.round(canvas.height * 0.8);
        c2.getContext("2d").drawImage(canvas, 0, 0, c2.width, c2.height);
        canvas = c2;
        quality = 0.6;
      } else break;
      out = canvas.toDataURL("image/jpeg", quality);
    }
    return out;
  }

  // Manual redaction: the user drags opaque boxes over anything to hide, sees
  // exactly what is covered, then Apply bakes the boxes into the pixels at full
  // resolution. Certainty comes from her own eyes; permanence from destroying
  // the pixels and re-encoding (see canvasToJpegBudget).
  function openRedactor(dataUrl, budget, onApply) {
    if (!dataUrl) return;
    const img = new Image();
    img.onerror = () => toast("Couldn't open that image");
    img.onload = () => buildRedactor(img, budget, onApply);
    img.src = dataUrl;
  }

  function buildRedactor(img, budget, onApply) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) { toast("Couldn't open that image"); return; }

    const overlay = document.createElement("div");
    overlay.className = "redactor";
    overlay.innerHTML = `
      <div class="redactor-bar">
        <button type="button" class="btn btn-ghost redactor-cancel">Cancel</button>
        <span class="redactor-hint">Drag over anything to hide</span>
        <button type="button" class="btn btn-primary redactor-apply">Apply</button>
      </div>
      <div class="redactor-stage"><canvas class="redactor-canvas"></canvas></div>
      <div class="redactor-tools">
        <button type="button" class="btn btn-ghost redactor-undo">Undo</button>
        <button type="button" class="btn btn-ghost redactor-clear">Clear</button>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("no-scroll");

    const canvas = overlay.querySelector(".redactor-canvas");
    const ctx = canvas.getContext("2d");
    const stage = overlay.querySelector(".redactor-stage");
    const boxes = [];   // {x,y,w,h} in image coordinates
    let drag = null;    // {x0,y0,x1,y1} in image coordinates
    let scale = 1;

    const normRect = (d) => ({
      x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
      w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0),
    });

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      boxes.forEach((b) => ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale));
      if (drag) {
        const r = normRect(drag);
        ctx.fillStyle = "rgba(0,0,0,0.82)";
        ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
        ctx.strokeRect(r.x * scale + 0.5, r.y * scale + 0.5, r.w * scale, r.h * scale);
      }
    }

    function layout() {
      const pad = 16;
      const maxW = stage.clientWidth - pad * 2;
      const maxH = stage.clientHeight - pad * 2;
      scale = Math.min(maxW / iw, maxH / ih);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      canvas.width = Math.max(1, Math.round(iw * scale));
      canvas.height = Math.max(1, Math.round(ih * scale));
      render();
    }

    function toImg(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(iw, (e.clientX - rect.left) / scale)),
        y: Math.max(0, Math.min(ih, (e.clientY - rect.top) / scale)),
      };
    }

    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not critical */ }
      const p = toImg(e);
      drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = toImg(e);
      drag.x1 = p.x; drag.y1 = p.y;
      render();
    });
    function endDrag() {
      if (!drag) return;
      const r = normRect(drag);
      drag = null;
      if (r.w > 3 && r.h > 3) boxes.push(r);
      render();
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    const close = () => {
      overlay.remove();
      document.body.classList.remove("no-scroll");
      window.removeEventListener("resize", layout);
    };

    overlay.querySelector(".redactor-undo").addEventListener("click", () => { boxes.pop(); render(); });
    overlay.querySelector(".redactor-clear").addEventListener("click", () => { boxes.length = 0; render(); });
    overlay.querySelector(".redactor-cancel").addEventListener("click", close);
    overlay.querySelector(".redactor-apply").addEventListener("click", () => {
      if (!boxes.length) { close(); return; } // nothing drawn — leave original untouched
      const out = document.createElement("canvas");
      out.width = iw; out.height = ih;
      const octx = out.getContext("2d");
      octx.drawImage(img, 0, 0, iw, ih);
      octx.fillStyle = "#000";
      boxes.forEach((b) => octx.fillRect(b.x, b.y, b.w, b.h));
      const redacted = canvasToJpegBudget(out, budget || 480000);
      close();
      onApply(redacted);
      toast("Details hidden and baked into the image");
    });

    window.addEventListener("resize", layout);
    layout();
  }

  /* ============================================================
     STATEMENT
     Printable statement of purchases. Defaults to everything still
     awaiting reimbursement; can also be scoped to a month or hand-picked.
     ============================================================ */
  function monthsWithPurchases() {
    const keys = new Set();
    db.purchases.forEach((p) => { if (p.date) keys.add(p.date.slice(0, 7)); });
    return [...keys].sort().reverse();
  }

  function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const byDateAsc = (a, b) =>
    (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0);

  function openStatementBuilder() {
    if (!db.purchases.length) { toast("No purchases to put on a statement yet"); return; }
    const months = monthsWithPurchases();

    const pickRows = db.purchases.slice().sort((a, b) => -byDateAsc(a, b)).map((p) => `
      <label class="pick-row">
        <input type="checkbox" value="${esc(p.id)}" ${p.reimbursed ? "" : "checked"} />
        <span class="pick-main">
          <span class="pick-title">${esc(p.product)}</span>
          <span class="pick-sub">${esc([fmtDate(p.date), p.store].filter(Boolean).join(" · "))}${p.reimbursed ? " · reimbursed" : ""}</span>
        </span>
        <span class="pick-amt">${money(p.cost)}</span>
      </label>`).join("");

    openModal("Generate statement", `
      <div class="field">
        <label>Include</label>
        <select id="st-scope">
          <option value="outstanding">All outstanding (not reimbursed)</option>
          <option value="month">By month</option>
          <option value="pick">Choose items myself</option>
        </select>
      </div>
      <div class="field" id="st-month-field" style="display:none;">
        <label>Month</label>
        <select id="st-month">
          ${months.map((m) => `<option value="${esc(m)}">${esc(monthLabel(m))}</option>`).join("")}
        </select>
        <div class="check-field" style="margin-top:10px;">
          <input id="st-with-reimbursed" type="checkbox" />
          <label for="st-with-reimbursed">Include items already reimbursed</label>
        </div>
      </div>
      <div class="field" id="st-pick-field" style="display:none;">
        <label>Items</label>
        <div class="pick-list">${pickRows}</div>
      </div>
      <div class="check-field">
        <input id="st-receipts" type="checkbox" />
        <label for="st-receipts">Attach receipts to the statement</label>
      </div>
      <p class="hint" id="st-preview"></p>
      <p class="hint warn" id="st-missing" style="display:none;"></p>
    `, {
      saveLabel: "Generate",
      onSave: () => {
        const items = statementSelection();
        if (!items.length) { toast("Nothing selected for the statement"); return false; }
        openStatementDoc(items, statementSubtitle(), {
          includeReceipts: $("#st-receipts").checked,
        });
        return true;
      },
    });

    const scopeEl = $("#st-scope");
    const syncFields = () => {
      const s = scopeEl.value;
      $("#st-month-field").style.display = s === "month" ? "" : "none";
      $("#st-pick-field").style.display = s === "pick" ? "" : "none";
      const items = statementSelection();
      const total = items.reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
      $("#st-preview").textContent =
        `${items.length} item${items.length === 1 ? "" : "s"} · ${money(total)} total`;

      // Only warn about missing receipts when receipts are actually being
      // attached — otherwise it is noise.
      const missing = $("#st-receipts").checked ? items.filter((p) => !p.receipt) : [];
      const warn = $("#st-missing");
      if (missing.length) {
        const names = missing.map((p) => p.product).join(", ");
        warn.textContent = `${missing.length} item${missing.length === 1 ? " has" : "s have"} no receipt: ${names}`;
        warn.style.display = "";
      } else {
        warn.style.display = "none";
      }
    };
    $("#modal-form").addEventListener("change", syncFields);
    syncFields();
  }

  // Reads the builder's current controls and returns the chosen purchases.
  function statementSelection() {
    const scope = $("#st-scope")?.value || "outstanding";
    if (scope === "pick") {
      const ids = [...document.querySelectorAll(".pick-row input:checked")].map((i) => i.value);
      return db.purchases.filter((p) => ids.includes(p.id)).sort(byDateAsc);
    }
    if (scope === "month") {
      const m = $("#st-month")?.value || "";
      const withReimbursed = $("#st-with-reimbursed")?.checked;
      return db.purchases
        .filter((p) => (p.date || "").startsWith(m) && (withReimbursed || !p.reimbursed))
        .sort(byDateAsc);
    }
    return db.purchases.filter((p) => !p.reimbursed).sort(byDateAsc);
  }

  function statementSubtitle() {
    const scope = $("#st-scope")?.value || "outstanding";
    if (scope === "month") {
      const m = $("#st-month")?.value || "";
      const withReimbursed = $("#st-with-reimbursed")?.checked;
      return `${monthLabel(m)}${withReimbursed ? "" : " · awaiting reimbursement"}`;
    }
    if (scope === "pick") return "Selected items";
    return "All items awaiting reimbursement";
  }

  // Full-screen printable statement. Back button + phone back gesture return
  // to the app; Print opens the OS print/save-as-PDF sheet.
  function openStatementDoc(items, subtitle, { includeReceipts = false } = {}) {
    const total = items.reduce((s, p) => s + (Number(p.cost) || 0), 0);
    const withReceipt = items.filter((p) => p.receipt);
    const missingReceipt = items.filter((p) => !p.receipt);

    const receiptsSection = !includeReceipts ? "" : `
      <div class="st-receipts">
        <h2 class="st-receipts-title">Receipts</h2>
        ${missingReceipt.length ? `
          <p class="st-missing-note">
            No receipt on file for:
            ${esc(missingReceipt.map((p) => `${p.product} (${fmtDate(p.date)})`).join(", "))}
          </p>` : ""}
        ${withReceipt.map((p) => `
          <figure class="st-receipt">
            <img src="${esc(p.receipt)}" alt="Receipt for ${esc(p.product)}" />
            <figcaption>${esc(fmtDate(p.date))} &middot; ${esc(p.product)} &middot; ${money(p.cost)}</figcaption>
          </figure>`).join("")}
      </div>`;

    // The statement deliberately omits store and sales associate — only the
    // brand is disclosed, in its own column.
    const rows = items.map((p) => `
        <tr>
          <td class="st-date">${esc(fmtDate(p.date))}</td>
          <td>
            <div class="st-prod">${esc(p.product)}</div>
            ${p.reimbursed ? `<div class="st-prod-sub">Reimbursed ${esc(fmtDate(p.reimbursedDate))}</div>` : ""}
          </td>
          <td class="st-brand-col">${esc(p.brand || "")}</td>
          <td class="amt">${money(p.cost)}</td>
        </tr>`).join("");

    const docInner = `
      <div class="statement-doc">
        <div class="st-head">
          <div class="st-brand">
            <div class="st-mark">KC</div>
            <div>
              <div class="st-brand-name">Kinsey Cathers</div>
              <div class="st-brand-sub">Fashion</div>
            </div>
          </div>
          <div class="st-issued">Issued ${esc(fmtDate(todayISO()))}</div>
        </div>
        <h1>Statement of Purchases</h1>
        <p class="st-sub">${esc(subtitle)}</p>
        <table>
          <thead>
            <tr><th>Date</th><th>Product</th><th>Brand</th><th class="amt">Amount</th></tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td></td>
              <td>Total<div class="st-total-sub">${items.length} item${items.length === 1 ? "" : "s"}</div></td>
              <td></td>
              <td class="amt">${money(total)}</td>
            </tr>
          </tfoot>
        </table>
        <p class="st-foot-note">Amounts paid out of pocket and submitted for reimbursement.</p>
        ${receiptsSection}
      </div>`;

    const overlay = document.createElement("div");
    overlay.className = "statement-overlay";
    overlay.innerHTML = `
      <div class="statement-bar">
        <button type="button" class="st-back">&#8592; Back</button>
        <button type="button" class="st-print">Print or save as PDF</button>
      </div>
      ${docInner}`;

    document.body.appendChild(overlay);
    document.body.classList.add("no-scroll");

    let done = false;
    let pushed = false;
    function teardown() {
      if (done) return;
      done = true;
      overlay.remove();
      document.body.classList.remove("no-scroll");
      window.removeEventListener("popstate", onPop);
    }
    function onPop() { teardown(); }
    function closeAndUnwind() {
      if (done) return;
      window.removeEventListener("popstate", onPop);
      teardown();
      if (pushed) history.back();
    }
    try { history.pushState({ kcStatement: true }, ""); pushed = true; } catch (e) { /* ignore */ }
    window.addEventListener("popstate", onPop);

    overlay.querySelector(".st-back").addEventListener("click", closeAndUnwind);
    overlay.querySelector(".st-print").addEventListener("click", () => printStatement(docInner));
  }

  // iOS home-screen (standalone) apps can't use window.print() — it silently
  // does nothing. There, open the statement as its own self-contained document
  // in a normal browser tab, where the share sheet's Print / Save to Files works.
  // Everywhere else, print the in-app overlay directly.
  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function printStatement(docInner) {
    if (!isStandalone()) { window.print(); return; }
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Statement of Purchases</title>
<style>${STATEMENT_PRINT_CSS}</style></head>
<body>${docInner}
<p class="print-hint">Use the share button, then <b>Print</b> or <b>Save to Files</b> to keep a PDF.</p>
<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},450);});<\/script>
</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) window.location.href = url; // popup blocked → same tab (Back returns)
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ============================================================
     CLIENTS & PAYMENTS
     A "client" is anyone on the paying side — the employer (who pays via
     reimbursements) or a real client (who buys, where you'd profit). A client
     is "potential" until money has come in from them. A "payment" is money
     received, allocated across outstanding purchases; whatever isn't matched to
     an item stays as unallocated funds (a record, not lost).
     ============================================================ */
  const paymentAllocated = (pmt) =>
    (pmt.allocations || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const paymentUnallocated = (pmt) => (Number(pmt.amount) || 0) - paymentAllocated(pmt);
  const totalUnallocated = () => db.payments.reduce((s, p) => s + paymentUnallocated(p), 0);
  const totalReceived = () => db.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const clientName = (id) => { const c = db.clients.find((x) => x.id === id); return c ? c.name : ""; };
  const clientHasActivity = (c) => db.payments.some((p) => p.clientId === c.id);
  const clientStatus = (c) => (clientHasActivity(c) || c.status === "active") ? "active" : "potential";
  const clientReceived = (c) =>
    db.payments.filter((p) => p.clientId === c.id).reduce((s, p) => s + (Number(p.amount) || 0), 0);

  /* ---------- Clients ---------- */
  function filterClients() {
    const { q, sort, filter } = ui.clients;
    let list = db.clients.slice();
    if (filter === "potential") list = list.filter((c) => clientStatus(c) === "potential");
    if (filter === "active") list = list.filter((c) => clientStatus(c) === "active");
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.email, c.phone, c.notes].filter(Boolean).join(" ").toLowerCase().includes(needle));
    }
    list.sort((a, b) => sort === "recent"
      ? (b.createdAt || 0) - (a.createdAt || 0)
      : (a.name || "").localeCompare(b.name || ""));
    return list;
  }

  function renderClients() {
    const { q, sort, filter } = ui.clients;
    const list = filterClients();
    viewEl.innerHTML = `
      <h2 class="view-title">Clients</h2>
      <p class="hint" style="margin:-4px 0 12px;">Everyone who pays you — your employer and any clients. A client is <strong>potential</strong> until money has come in.</p>
      <div class="toolbar">
        <div class="search"><span>&#9906;</span>
          <input id="client-search" type="search" placeholder="Search clients…" value="${esc(q)}" /></div>
        <select id="client-sort" class="select" aria-label="Sort">
          <option value="name" ${sort === "name" ? "selected" : ""}>Name</option>
          <option value="recent" ${sort === "recent" ? "selected" : ""}>Newest</option>
        </select>
      </div>
      <div class="segment">
        <button data-f="all" class="${filter === "all" ? "active" : ""}">All</button>
        <button data-f="active" class="${filter === "active" ? "active" : ""}">Clients</button>
        <button data-f="potential" class="${filter === "potential" ? "active" : ""}">Potential</button>
      </div>
      <div id="client-list">
        ${list.length ? list.map(clientCard).join("")
          : emptyState("&#128101;", db.clients.length ? "No matches." : "No clients yet. Tap + to add one (like your employer).")}
      </div>`;
    const s = $("#client-search");
    s.addEventListener("input", () => {
      ui.clients.q = s.value;
      const f = filterClients();
      $("#client-list").innerHTML = f.length ? f.map(clientCard).join("") : emptyState("&#128101;", "No matches.");
      bindClientCards();
    });
    $("#client-sort").addEventListener("change", (e) => { ui.clients.sort = e.target.value; renderClients(); });
    viewEl.querySelectorAll(".segment button").forEach((b) =>
      b.addEventListener("click", () => { ui.clients.filter = b.dataset.f; renderClients(); }));
    bindClientCards();
  }

  function clientCard(c) {
    const status = clientStatus(c);
    const received = clientReceived(c);
    const links = [];
    if (c.phone) {
      links.push(`<a class="link-btn" href="tel:${esc(c.phone)}">Call</a>`);
      links.push(`<a class="link-btn" href="sms:${esc(c.phone)}">Text</a>`);
    }
    if (c.email) links.push(`<a class="link-btn" href="mailto:${esc(c.email)}">Email</a>`);
    return `
      <div class="card card-clickable" data-id="${c.id}">
        <div class="card-row">
          <div class="avatar">${esc(initials(c.name))}</div>
          <div class="card-main">
            <div class="card-title">${esc(c.name)}</div>
            <div class="card-sub" style="margin-top:3px;">
              <span class="chip ${status === "active" ? "green" : "amber"}">${status === "active" ? "Client" : "Potential"}</span>
              ${received > 0 ? ` <span>${money(received)} received</span>` : ""}
            </div>
            ${c.notes ? `<div class="card-notes">${esc(c.notes)}</div>` : ""}
            ${links.length ? `<div class="contact-links">${links.join("")}</div>` : ""}
          </div>
          <div class="card-actions"><button class="mini-btn" data-act="edit">Edit</button></div>
        </div>
      </div>`;
  }

  function bindClientCards() {
    viewEl.querySelectorAll(".card[data-id]").forEach((card) => {
      const c = db.clients.find((x) => x.id === card.dataset.id);
      if (!c) return;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".mini-btn, .link-btn")) return;
        openClientView(c);
      });
      card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openClientForm(c));
    });
  }

  function openClientForm(existing) {
    const c = existing || {};
    const locked = existing && clientHasActivity(c); // active because payments exist
    openModal(existing ? "Edit client" : "New client", `
      <div class="field"><label>Name *</label>
        <input id="f-cname" type="text" value="${esc(c.name || "")}" placeholder="e.g. Acme Boutique (employer)" /></div>
      <div class="field"><label>Status</label>
        <select id="f-cstatus" ${locked ? "disabled" : ""}>
          <option value="potential" ${clientStatus(c) !== "active" ? "selected" : ""}>Potential</option>
          <option value="active" ${clientStatus(c) === "active" ? "selected" : ""}>Client (has transacted)</option>
        </select>
        ${locked ? `<p class="hint" style="margin-top:6px;">Automatically a client — you've recorded a payment from them.</p>` : ""}
      </div>
      <div class="field-row">
        <div class="field"><label>Phone</label>
          <input id="f-cphone" type="tel" value="${esc(c.phone || "")}" placeholder="(555) 123-4567" /></div>
        <div class="field"><label>Email</label>
          <input id="f-cemail" type="email" value="${esc(c.email || "")}" placeholder="name@email.com" /></div>
      </div>
      <div class="field"><label>Notes</label>
        <textarea id="f-cnotes" placeholder="What they're looking for, how you know them…">${esc(c.notes || "")}</textarea></div>
    `, {
      onSave: () => {
        const name = $("#f-cname").value.trim();
        if (!name) { toast("Name is required"); return false; }
        const rec = {
          id: c.id || uid(),
          name,
          status: $("#f-cstatus").value === "active" ? "active" : "potential",
          phone: $("#f-cphone").value.trim(),
          email: $("#f-cemail").value.trim(),
          notes: $("#f-cnotes").value.trim(),
          createdAt: c.createdAt || Date.now(),
        };
        upsert("clients", rec);
        toast(existing ? "Client updated" : "Client added");
        renderClients();
        return true;
      },
      onDelete: (existing && !clientHasActivity(c))
        ? () => { remove("clients", c.id); toast("Client deleted"); renderClients(); }
        : null,
    });
  }

  function openClientView(c) {
    const pmts = db.payments.filter((p) => p.clientId === c.id)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const received = pmts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const status = clientStatus(c);
    const links = [];
    if (c.phone) {
      links.push(`<a class="link-btn" href="tel:${esc(c.phone)}">Call</a>`);
      links.push(`<a class="link-btn" href="sms:${esc(c.phone)}">Text</a>`);
    }
    if (c.email) links.push(`<a class="link-btn" href="mailto:${esc(c.email)}">Email</a>`);

    const rows = pmts.length ? pmts.map((p) => `
      <div class="mini-row">
        <div>
          <div class="mini-row-title">${money(p.amount)}</div>
          <div class="mini-row-sub">${esc(fmtDate(p.date))} · ${(p.allocations || []).length} item${(p.allocations || []).length === 1 ? "" : "s"}</div>
        </div>
        <div class="mini-row-right">
          ${paymentUnallocated(p) > 0.001 ? `<span class="chip amber">${money(paymentUnallocated(p))} unallocated</span>` : `<span class="chip green">Allocated</span>`}
        </div>
      </div>`).join("") : `<p class="hint">No payments recorded from this client yet.</p>`;

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
        <div class="modal-grip"></div>
        <h2>${esc(c.name)}</h2>
        <div class="card-sub" style="margin-bottom:10px;">
          <span class="chip ${status === "active" ? "green" : "amber"}">${status === "active" ? "Client" : "Potential"}</span>
        </div>
        ${c.notes ? `<div class="card-notes" style="margin-bottom:12px;">${esc(c.notes)}</div>` : ""}
        ${links.length ? `<div class="contact-links" style="margin-bottom:18px;">${links.join("")}</div>` : ""}
        <div class="section-label" style="margin:0 2px 8px;">Payments received</div>
        ${rows}
        <div class="stat full" style="margin-top:14px;">
          <div class="stat-label">Total received</div>
          <div class="stat-value">${money(received)}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="view-close">Close</button>
          <button type="button" class="btn btn-primary" id="view-edit">Edit</button>
        </div>
      </div></div>`;
    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) close(); });
    $("#view-close", root).addEventListener("click", close);
    $("#view-edit", root).addEventListener("click", () => { close(); openClientForm(c); });
  }

  // Payer picklist (clients) with inline "add new".
  function clientSelectOptions(selectedId) {
    const opts = db.clients.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    return `<option value="">— select —</option>${opts}<option value="__add__">+ Add new client…</option>`;
  }
  function handleClientSelectChange(selectEl) {
    if (selectEl.value !== "__add__") return;
    const name = prompt("Add a new client (e.g. your employer):");
    if (!name || !name.trim()) { selectEl.value = ""; return; }
    const clean = name.trim();
    let match = db.clients.find((c) => c.name.toLowerCase() === clean.toLowerCase());
    if (!match) {
      match = { id: uid(), name: clean, status: "potential", phone: "", email: "", notes: "", createdAt: Date.now() };
      upsert("clients", match);
    }
    const addOpt = selectEl.querySelector('option[value="__add__"]');
    let opt = [...selectEl.options].find((o) => o.value === match.id);
    if (!opt) { opt = document.createElement("option"); opt.value = match.id; opt.textContent = match.name; selectEl.insertBefore(opt, addOpt); }
    selectEl.value = match.id;
  }

  /* ---------- Payments ---------- */
  function renderPayments() {
    const list = db.payments.slice().sort((a, b) => ui.payments.sort === "amount"
      ? (Number(b.amount) || 0) - (Number(a.amount) || 0)
      : ((b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)));
    const un = totalUnallocated();
    viewEl.innerHTML = `
      <h2 class="view-title">Payments</h2>
      <div class="stat-grid" style="margin-bottom:8px;">
        <div class="stat">
          <div class="stat-label">Received to date</div>
          <div class="stat-value green">${money(totalReceived())}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Unallocated funds</div>
          <div class="stat-value ${un > 0.001 ? "amber" : ""}">${money(un)}</div>
        </div>
      </div>
      <p class="hint" style="margin:0 2px 12px;">Unallocated = money received that you haven't matched to a specific item yet.</p>
      ${db.payments.length ? `<div class="toolbar" style="justify-content:flex-end;">
        <select id="payment-sort" class="select" aria-label="Sort">
          <option value="recent" ${ui.payments.sort === "recent" ? "selected" : ""}>Newest</option>
          <option value="amount" ${ui.payments.sort === "amount" ? "selected" : ""}>Largest</option>
        </select></div>` : ""}
      <div id="payment-list">
        ${list.length ? list.map(paymentCard).join("")
          : emptyState("&#128181;", "No payments yet. Tap + to record one from your employer.")}
      </div>`;
    $("#payment-sort")?.addEventListener("change", (e) => { ui.payments.sort = e.target.value; renderPayments(); });
    bindPaymentCards();
  }

  function paymentCard(p) {
    const un = paymentUnallocated(p);
    const n = (p.allocations || []).length;
    const tag = un > 0.001 ? `<span class="chip amber">${money(un)} unallocated</span>`
      : (un < -0.001 ? `<span class="chip amber">over by ${money(-un)}</span>`
        : `<span class="chip green">Fully allocated</span>`);
    return `
      <div class="card card-clickable" data-id="${p.id}">
        <div class="card-row">
          <div class="card-main">
            <div class="card-title">${money(p.amount)}</div>
            <div class="card-sub">${esc([fmtDate(p.date), clientName(p.clientId)].filter(Boolean).join(" · "))}</div>
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              <span class="chip">${n} item${n === 1 ? "" : "s"}</span>
              ${tag}
            </div>
            ${p.note ? `<div class="card-notes">${esc(p.note)}</div>` : ""}
          </div>
          <div class="card-actions"><button class="mini-btn" data-act="edit">Edit</button></div>
        </div>
      </div>`;
  }

  function bindPaymentCards() {
    viewEl.querySelectorAll(".card[data-id]").forEach((card) => {
      const p = db.payments.find((x) => x.id === card.dataset.id);
      if (!p) return;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".mini-btn")) return;
        openPaymentView(p);
      });
      card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openPaymentForm(p));
    });
  }

  function openPaymentForm(existing) {
    const p = existing || {};
    const allocatedIds = new Set((p.allocations || []).map((a) => a.purchaseId));

    // Candidates: outstanding purchases, plus any already on THIS payment.
    const candidates = db.purchases
      .filter((x) => !x.reimbursed || (existing && x.paymentId === p.id))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const pickRows = candidates.map((x) => `
      <label class="pick-row">
        <input type="checkbox" data-cost="${Number(x.cost) || 0}" value="${esc(x.id)}" ${allocatedIds.has(x.id) ? "checked" : ""} />
        <span class="pick-main">
          <span class="pick-title">${esc(x.product)}</span>
          <span class="pick-sub">${esc([fmtDate(x.date), x.brand || x.store].filter(Boolean).join(" · "))}</span>
        </span>
        <span class="pick-amt">${money(x.cost)}</span>
      </label>`).join("");

    openModal(existing ? "Edit payment" : "Record payment", `
      <div class="field-row">
        <div class="field"><label>Amount *</label>
          <input id="f-pamount" type="number" inputmode="decimal" step="0.01" value="${esc(p.amount ?? "")}" placeholder="0.00" /></div>
        <div class="field"><label>Date</label>
          <input id="f-pdate" type="date" value="${esc(p.date || todayISO())}" /></div>
      </div>
      <div class="field"><label>From</label>
        <select id="f-pclient">${clientSelectOptions(p.clientId || "")}</select></div>
      <div class="field"><label>What this payment covers</label>
        ${candidates.length
          ? `<div class="pick-list">${pickRows}</div>`
          : `<p class="hint">No outstanding items to match. You can still record the payment — it'll show as unallocated.</p>`}
      </div>
      <div class="alloc-summary" id="alloc-summary"></div>
      <div class="field"><label>Note (optional)</label>
        <textarea id="f-pnote" placeholder="Reference #, or anything to remember…">${esc(p.note || "")}</textarea></div>
    `, {
      saveLabel: existing ? "Save" : "Record payment",
      onSave: () => {
        const raw = $("#f-pamount").value;
        const amount = Number(raw);
        if (raw === "" || isNaN(amount) || amount <= 0) { toast("Enter a valid amount"); return false; }
        const allocations = [...document.querySelectorAll(".pick-row input:checked")]
          .map((i) => ({ purchaseId: i.value, amount: Number(i.dataset.cost) || 0 }));
        const rec = {
          id: p.id || uid(),
          amount,
          date: $("#f-pdate").value || todayISO(),
          clientId: $("#f-pclient").value || "",
          note: $("#f-pnote").value.trim(),
          allocations,
          createdAt: p.createdAt || Date.now(),
        };
        savePayment(rec, existing ? p : null);
        toast(existing ? "Payment updated" : "Payment recorded");
        renderPayments();
        return true;
      },
      onDelete: existing ? () => { deletePayment(p); toast("Payment deleted"); renderPayments(); } : null,
    });

    $("#f-pclient").addEventListener("change", (e) => handleClientSelectChange(e.target));
    const updateSummary = () => {
      const amount = Number($("#f-pamount").value) || 0;
      const allocated = [...document.querySelectorAll(".pick-row input:checked")]
        .reduce((s, i) => s + (Number(i.dataset.cost) || 0), 0);
      const un = amount - allocated;
      let cls, msg;
      if (un > 0.001) { cls = "warn-amber"; msg = `${money(un)} unallocated`; }
      else if (un < -0.001) { cls = "warn-red"; msg = `Over by ${money(-un)}`; }
      else { cls = "ok-green"; msg = "Fully allocated"; }
      $("#alloc-summary").innerHTML =
        `<div class="alloc-line"><span>Allocated ${money(allocated)} of ${money(amount)}</span><span class="alloc-tag ${cls}">${msg}</span></div>`;
    };
    $("#f-pamount").addEventListener("input", updateSummary);
    document.querySelectorAll(".pick-row input").forEach((i) => i.addEventListener("change", updateSummary));
    updateSummary();
  }

  // Apply a payment: reimburse the purchases it covers and link them to it.
  function savePayment(rec, prev) {
    const nowIds = new Set(rec.allocations.map((a) => a.purchaseId));
    rec.allocations.forEach((a) => {
      const pur = db.purchases.find((x) => x.id === a.purchaseId);
      if (pur) {
        pur.reimbursed = true;
        pur.reimbursedDate = rec.date || todayISO();
        pur.paymentId = rec.id;
        upsert("purchases", pur);
      }
    });
    // On edit: items removed from this payment go back to outstanding.
    if (prev) {
      (prev.allocations || []).forEach((a) => {
        if (!nowIds.has(a.purchaseId)) {
          const pur = db.purchases.find((x) => x.id === a.purchaseId);
          if (pur && pur.paymentId === rec.id) {
            pur.reimbursed = false; pur.reimbursedDate = ""; pur.paymentId = "";
            upsert("purchases", pur);
          }
        }
      });
    }
    upsert("payments", rec);
  }

  function deletePayment(p) {
    (p.allocations || []).forEach((a) => {
      const pur = db.purchases.find((x) => x.id === a.purchaseId);
      if (pur && pur.paymentId === p.id) {
        pur.reimbursed = false; pur.reimbursedDate = ""; pur.paymentId = "";
        upsert("purchases", pur);
      }
    });
    remove("payments", p.id);
  }

  // Read-only payment detail — the record to reference or send the employer.
  function openPaymentView(p) {
    const un = paymentUnallocated(p);
    const rows = (p.allocations || []).map((a) => {
      const pur = db.purchases.find((x) => x.id === a.purchaseId);
      const title = pur ? pur.product : "(deleted item)";
      const sub = pur ? [fmtDate(pur.date), pur.brand || ""].filter(Boolean).join(" · ") : "";
      return `
        <div class="mini-row">
          <div>
            <div class="mini-row-title">${esc(title)}</div>
            ${sub ? `<div class="mini-row-sub">${esc(sub)}</div>` : ""}
          </div>
          <div class="mini-row-right"><div class="amount">${money(a.amount)}</div></div>
        </div>`;
    }).join("") || `<p class="hint">Nothing matched to this payment yet — it's all unallocated.</p>`;

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
        <div class="modal-grip"></div>
        <h2>${money(p.amount)}</h2>
        <div class="card-sub" style="margin-bottom:14px;">${esc([fmtDate(p.date), clientName(p.clientId)].filter(Boolean).join(" · "))}</div>
        ${p.note ? `<div class="card-notes" style="margin-bottom:14px;">${esc(p.note)}</div>` : ""}
        <div class="section-label" style="margin:0 2px 8px;">Allocated to</div>
        ${rows}
        <div class="alloc-summary" style="margin-top:14px;">
          <div class="alloc-line"><span>Allocated ${money(paymentAllocated(p))} of ${money(p.amount)}</span>
            <span class="alloc-tag ${un > 0.001 ? "warn-amber" : (un < -0.001 ? "warn-red" : "ok-green")}">${un > 0.001 ? money(un) + " unallocated" : (un < -0.001 ? "over by " + money(-un) : "Fully allocated")}</span></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="view-close">Close</button>
          <button type="button" class="btn btn-primary" id="view-edit">Edit</button>
        </div>
      </div></div>`;
    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) close(); });
    $("#view-close", root).addEventListener("click", close);
    $("#view-edit", root).addEventListener("click", () => { close(); openPaymentForm(p); });
  }

  /* ============================================================
     GOOGLE SHEETS BACKUP
     Mirrors the app's tabular data into a Google Sheet via an Apps Script
     web app the user deploys on their own account (see tools/sheets-backup.gs).
     Images are deliberately excluded — a Sheets cell caps at 50k characters.
     Failures are non-fatal: this is redundancy, never the source of truth.
     ============================================================ */
  const sheetsCfg = () => Object.assign(
    { enabled: false, url: "", token: "", lastSyncAt: 0, lastError: "" },
    db.settings.sheetsBackup || {}
  );

  function buildSheetsPayload() {
    const assoc = (id) => { const c = db.contacts.find((x) => x.id === id); return c ? c.name : ""; };
    const yn = (v) => (v ? "Yes" : "");

    return {
      "Purchases": {
        headers: ["Date", "Product", "Brand", "Store", "Sales associate", "Cost",
          "Payment method", "Cashback %", "Reimbursed", "Reimbursed date", "Shipped",
          "Photo", "Receipt", "Notes"],
        rows: db.purchases.slice()
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
          .map((p) => [p.date || "", p.product || "", p.brand || "", p.store || "",
            assoc(p.contactId), Number(p.cost) || 0, p.paymentMethod || "",
            Number(p.cashbackPercent) || 0, yn(p.reimbursed), p.reimbursedDate || "",
            yn(p.shipped), yn(p.photo), yn(p.receipt), p.notes || ""]),
      },
      "Payments": {
        headers: ["Date", "Amount", "From", "Allocated", "Unallocated", "Items", "Note"],
        rows: db.payments.slice()
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
          .map((p) => [p.date || "", Number(p.amount) || 0, clientName(p.clientId),
            paymentAllocated(p), paymentUnallocated(p),
            (p.allocations || []).map((a) => {
              const pur = db.purchases.find((x) => x.id === a.purchaseId);
              return pur ? pur.product : "(deleted)";
            }).join(", "),
            p.note || ""]),
      },
      "Hours": {
        headers: ["Date", "Hours", "Reimbursed", "Reimbursed date", "Notes"],
        rows: db.hours.slice()
          .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
          .map((h) => [h.date || "", Number(h.hours) || 0, yn(h.reimbursed),
            h.reimbursedDate || "", h.notes || ""]),
      },
      "Clients": {
        headers: ["Name", "Status", "Phone", "Email", "Received to date", "Notes"],
        rows: db.clients.slice()
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
          .map((c) => [c.name || "", clientStatus(c) === "active" ? "Client" : "Potential",
            c.phone || "", c.email || "", clientReceived(c), c.notes || ""]),
      },
      "Sales Associates": {
        headers: ["Name", "Store", "Location", "Title", "Phone", "Email", "Notes"],
        rows: db.contacts.slice()
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
          .map((c) => [c.name || "", c.store || "", c.location || "", c.title || "",
            c.phone || "", c.email || "", c.notes || ""]),
      },
      "Shipments": {
        headers: ["Ship date", "Carrier", "Tracking number", "Status", "To", "Items", "Note"],
        rows: db.shipments.slice()
          .sort((a, b) => (a.shippedDate || "").localeCompare(b.shippedDate || ""))
          .map((s) => [s.shippedDate || "", carrierById(s.carrier).name, s.trackingNumber || "",
            shipStatusName(s.status), clientName(s.toClientId),
            (s.items || []).map((id) => {
              const pur = db.purchases.find((x) => x.id === id);
              return pur ? pur.product : "(deleted)";
            }).join(", "),
            s.note || ""]),
      },
    };
  }

  // Posts as text/plain so the browser skips the CORS preflight Apps Script
  // doesn't answer. Returns {ok, error}.
  async function pushSheetsBackup({ silent = true } = {}) {
    const cfg = sheetsCfg();
    if (!cfg.url || !cfg.token) return { ok: false, error: "Not configured" };
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: cfg.token, sheets: buildSheetsPayload() }),
      });
      const out = await res.json().catch(() => ({ ok: res.ok }));
      if (!out.ok) throw new Error(out.error || "Sheet rejected the update");
      db.settings.sheetsBackup = Object.assign(cfg, { lastSyncAt: Date.now(), lastError: "" });
      save();
      if (!silent) toast("Backed up to Google Sheets");
      return { ok: true };
    } catch (err) {
      console.error("Sheets backup failed", err);
      db.settings.sheetsBackup = Object.assign(cfg, { lastError: String(err.message || err) });
      save();
      if (!silent) toast("Backup failed — check the URL and token");
      return { ok: false, error: String(err.message || err) };
    }
  }

  let sheetsTimer = null;
  function scheduleSheetsBackup() {
    const cfg = sheetsCfg();
    if (!cfg.enabled || !cfg.url || !cfg.token) return;
    clearTimeout(sheetsTimer);
    sheetsTimer = setTimeout(() => pushSheetsBackup({ silent: true }), 8000);
  }

  function openSheetsBackup() {
    const cfg = sheetsCfg();
    const token = cfg.token || uid() + uid();
    const last = cfg.lastSyncAt
      ? new Date(cfg.lastSyncAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : "Never";

    openModal("Google Sheets backup", `
      <p class="hint">Keeps a Google Sheet mirroring your data as a second copy.
      Set it up once with the script in <code>tools/sheets-backup.gs</code>.</p>
      <div class="check-field">
        <input id="f-sb-enabled" type="checkbox" ${cfg.enabled ? "checked" : ""} />
        <label for="f-sb-enabled">Back up automatically after changes</label>
      </div>
      <div class="field"><label>Token (paste into the script)</label>
        <input id="f-sb-token" type="text" value="${esc(token)}" readonly /></div>
      <div class="field"><label>Web app URL (from the script deployment)</label>
        <input id="f-sb-url" type="url" value="${esc(cfg.url)}" placeholder="https://script.google.com/macros/s/…/exec" /></div>
      <p class="hint">Last backup: <strong>${esc(last)}</strong>${cfg.lastError ? ` · <span style="color:var(--danger);">${esc(cfg.lastError)}</span>` : ""}</p>
      <p class="hint warn">Photos and receipts aren't included — a spreadsheet cell
      can't hold an image. Use Export backup (.json) for those.</p>
      <div class="modal-actions" style="flex-direction:column; gap:10px; margin-top:6px;">
        <button type="button" class="btn btn-ghost" id="sb-now">Back up now</button>
      </div>
    `, {
      saveLabel: "Save",
      onSave: () => {
        const url = $("#f-sb-url").value.trim();
        if (url && !/^https:\/\/script\.google\.com\//.test(url)) {
          toast("That doesn't look like an Apps Script URL"); return false;
        }
        db.settings.sheetsBackup = Object.assign(sheetsCfg(), {
          enabled: $("#f-sb-enabled").checked, url, token,
        });
        save();
        toast("Backup settings saved");
        return true;
      },
    });

    $("#sb-now").addEventListener("click", async () => {
      const url = $("#f-sb-url").value.trim();
      if (!url) { toast("Add the Web app URL first"); return; }
      db.settings.sheetsBackup = Object.assign(sheetsCfg(), { url, token });
      save();
      $("#sb-now").textContent = "Backing up…";
      await pushSheetsBackup({ silent: false });
      $("#sb-now").textContent = "Back up now";
    });
  }

  /* ============================================================
     SHIPMENTS
     A shipment is one package covering one or more purchases. Items in a
     shipment are marked shipped and linked to it (same pattern as payments).
     Tracking is stored per shipment; `events` is reserved for automatic
     carrier updates if a tracking API is wired up later.
     ============================================================ */
  const CARRIERS = [
    { id: "ups", name: "UPS", url: (t) => `https://www.ups.com/track?loc=en_US&tracknum=${encodeURIComponent(t)}` },
    { id: "fedex", name: "FedEx", url: (t) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(t)}` },
    { id: "usps", name: "USPS", url: (t) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(t)}` },
    { id: "dhl", name: "DHL", url: (t) => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(t)}` },
    { id: "other", name: "Other", url: (t) => `https://www.google.com/search?q=${encodeURIComponent(t + " tracking")}` },
  ];
  const carrierById = (id) => CARRIERS.find((c) => c.id === id) || CARRIERS[CARRIERS.length - 1];
  const trackingUrl = (s) => (s.trackingNumber ? carrierById(s.carrier).url(s.trackingNumber) : "");

  const SHIP_STATUSES = [
    { id: "ready", name: "Ready to ship" },
    { id: "transit", name: "In transit" },
    { id: "delivered", name: "Delivered" },
    { id: "issue", name: "Problem" },
  ];
  const shipStatusName = (id) => (SHIP_STATUSES.find((s) => s.id === id) || SHIP_STATUSES[0]).name;
  const shipStatusChip = (id) =>
    id === "delivered" ? "green" : (id === "issue" ? "amber" : (id === "transit" ? "" : ""));

  function renderShipments() {
    const list = db.shipments.slice().sort((a, b) =>
      (b.shippedDate || "").localeCompare(a.shippedDate || "") || (b.createdAt || 0) - (a.createdAt || 0));
    const inTransit = db.shipments.filter((s) => s.status === "transit").length;

    viewEl.innerHTML = `
      <h2 class="view-title">Purchases</h2>
      ${viewSwitcherHtml("shipments")}
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat">
          <div class="stat-label">Shipments</div>
          <div class="stat-value">${db.shipments.length}</div>
        </div>
        <div class="stat">
          <div class="stat-label">In transit</div>
          <div class="stat-value ${inTransit ? "amber" : ""}">${inTransit}</div>
        </div>
      </div>
      <div id="shipment-list">
        ${list.length ? list.map(shipmentCard).join("")
          : emptyState("&#128230;", "No shipments yet. Tap + to add one.")}
      </div>`;
    bindViewSwitcher();
    bindShipmentCards();
  }

  function shipmentCard(s) {
    const n = (s.items || []).length;
    const url = trackingUrl(s);
    return `
      <div class="card card-clickable" data-id="${s.id}">
        <div class="card-row">
          <div class="card-main">
            <div class="card-title">${esc(carrierById(s.carrier).name)}${s.trackingNumber ? ` · ${esc(s.trackingNumber)}` : ""}</div>
            <div class="card-sub">${esc([fmtDate(s.shippedDate), `${n} item${n === 1 ? "" : "s"}`].filter(Boolean).join(" · "))}</div>
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              <span class="chip ${shipStatusChip(s.status)}">${esc(shipStatusName(s.status))}</span>
              ${s.toClientId ? `<span class="chip">${esc(clientName(s.toClientId))}</span>` : ""}
            </div>
            ${s.note ? `<div class="card-notes">${esc(s.note)}</div>` : ""}
            ${url ? `<div class="contact-links"><a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener">Track package</a></div>` : ""}
          </div>
          <div class="card-actions"><button class="mini-btn" data-act="edit">Edit</button></div>
        </div>
      </div>`;
  }

  function bindShipmentCards() {
    viewEl.querySelectorAll(".card[data-id]").forEach((card) => {
      const s = db.shipments.find((x) => x.id === card.dataset.id);
      if (!s) return;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".mini-btn, .link-btn")) return;
        openShipmentView(s);
      });
      card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openShipmentForm(s));
    });
  }

  function openShipmentForm(existing) {
    const s = existing || {};
    const chosen = new Set(s.items || []);

    // Candidates: anything not already shipped, plus items already on THIS shipment.
    const candidates = db.purchases
      .filter((x) => !x.shipped || (existing && x.shipmentId === s.id))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const pickRows = candidates.map((x) => `
      <label class="pick-row">
        <input type="checkbox" data-paid="${x.reimbursed ? "1" : "0"}" value="${esc(x.id)}" ${chosen.has(x.id) ? "checked" : ""} />
        <span class="pick-main">
          <span class="pick-title">${esc(x.product)}</span>
          <span class="pick-sub">${esc([fmtDate(x.date), x.brand || x.store].filter(Boolean).join(" · "))}${x.reimbursed ? "" : " · not reimbursed"}</span>
        </span>
        <span class="pick-amt">${money(x.cost)}</span>
      </label>`).join("");

    openModal(existing ? "Edit shipment" : "New shipment", `
      <div class="field-row">
        <div class="field"><label>Carrier</label>
          <select id="f-scarrier">
            ${CARRIERS.map((c) => `<option value="${c.id}" ${s.carrier === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select></div>
        <div class="field"><label>Ship date</label>
          <input id="f-sdate" type="date" value="${esc(s.shippedDate || todayISO())}" /></div>
      </div>
      <div class="field"><label>Tracking number</label>
        <input id="f-stracking" type="text" inputmode="latin" value="${esc(s.trackingNumber || "")}" placeholder="e.g. 1Z999AA10123456784" /></div>
      <div class="field-row">
        <div class="field"><label>Status</label>
          <select id="f-sstatus">
            ${SHIP_STATUSES.map((st) => `<option value="${st.id}" ${(s.status || "ready") === st.id ? "selected" : ""}>${esc(st.name)}</option>`).join("")}
          </select></div>
        <div class="field"><label>To (optional)</label>
          <select id="f-sclient">${clientSelectOptions(s.toClientId || "")}</select></div>
      </div>
      <div class="field"><label>Items in this shipment</label>
        ${candidates.length
          ? `<div class="pick-list">${pickRows}</div>`
          : `<p class="hint">Everything's already in a shipment. Add a purchase first.</p>`}
      </div>
      <p class="hint warn" id="ship-warn" style="display:none;"></p>
      <div class="field"><label>Note (optional)</label>
        <textarea id="f-snote" placeholder="Contents, recipient address, anything to remember…">${esc(s.note || "")}</textarea></div>
    `, {
      saveLabel: existing ? "Save" : "Add shipment",
      onSave: () => {
        const items = [...document.querySelectorAll(".pick-row input:checked")].map((i) => i.value);
        if (!items.length) { toast("Pick at least one item for this shipment"); return false; }
        const rec = {
          id: s.id || uid(),
          carrier: $("#f-scarrier").value,
          trackingNumber: $("#f-stracking").value.trim(),
          shippedDate: $("#f-sdate").value || todayISO(),
          status: $("#f-sstatus").value,
          toClientId: $("#f-sclient").value || "",
          note: $("#f-snote").value.trim(),
          items,
          events: s.events || [], // reserved for automatic carrier updates
          createdAt: s.createdAt || Date.now(),
        };
        saveShipment(rec, existing ? s : null);
        toast(existing ? "Shipment updated" : "Shipment added");
        renderShipments();
        return true;
      },
      onDelete: existing ? () => { deleteShipment(s); toast("Shipment deleted"); renderShipments(); } : null,
    });

    $("#f-sclient").addEventListener("change", (e) => handleClientSelectChange(e.target));
    // Warn about items that haven't been reimbursed/paid yet.
    const updateWarn = () => {
      const unpaid = [...document.querySelectorAll(".pick-row input:checked")]
        .filter((i) => i.dataset.paid === "0")
        .map((i) => i.closest(".pick-row").querySelector(".pick-title").textContent);
      const w = $("#ship-warn");
      if (unpaid.length) {
        w.textContent = `Heads up: ${unpaid.length} item${unpaid.length === 1 ? " hasn't" : "s haven't"} been reimbursed yet — ${unpaid.join(", ")}`;
        w.style.display = "";
      } else { w.style.display = "none"; }
    };
    document.querySelectorAll(".pick-row input").forEach((i) => i.addEventListener("change", updateWarn));
    updateWarn();
  }

  function saveShipment(rec, prev) {
    const nowIds = new Set(rec.items);
    rec.items.forEach((id) => {
      const pur = db.purchases.find((x) => x.id === id);
      if (pur) { pur.shipped = true; pur.shipmentId = rec.id; upsert("purchases", pur); }
    });
    if (prev) {
      (prev.items || []).forEach((id) => {
        if (!nowIds.has(id)) {
          const pur = db.purchases.find((x) => x.id === id);
          if (pur && pur.shipmentId === rec.id) {
            pur.shipped = false; pur.shipmentId = ""; upsert("purchases", pur);
          }
        }
      });
    }
    upsert("shipments", rec);
  }

  function deleteShipment(s) {
    (s.items || []).forEach((id) => {
      const pur = db.purchases.find((x) => x.id === id);
      if (pur && pur.shipmentId === s.id) {
        pur.shipped = false; pur.shipmentId = ""; upsert("purchases", pur);
      }
    });
    remove("shipments", s.id);
  }

  function openShipmentView(s) {
    const url = trackingUrl(s);
    const rows = (s.items || []).map((id) => {
      const pur = db.purchases.find((x) => x.id === id);
      const title = pur ? pur.product : "(deleted item)";
      const sub = pur ? [fmtDate(pur.date), pur.brand || ""].filter(Boolean).join(" · ") : "";
      const unpaid = pur && !pur.reimbursed;
      return `
        <div class="mini-row">
          <div>
            <div class="mini-row-title">${esc(title)}</div>
            ${sub ? `<div class="mini-row-sub">${esc(sub)}</div>` : ""}
          </div>
          <div class="mini-row-right">
            ${pur ? `<div class="amount">${money(pur.cost)}</div>` : ""}
            ${unpaid ? `<span class="chip amber">Not reimbursed</span>` : ""}
          </div>
        </div>`;
    }).join("") || `<p class="hint">No items on this shipment.</p>`;

    const events = (s.events || []);
    const eventsHtml = events.length ? `
      <div class="section-label" style="margin:18px 2px 8px;">Tracking updates</div>
      ${events.map((e) => `
        <div class="mini-row">
          <div>
            <div class="mini-row-title">${esc(e.status || "")}</div>
            <div class="mini-row-sub">${esc([e.date, e.location].filter(Boolean).join(" · "))}</div>
          </div>
        </div>`).join("")}` : "";

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
        <div class="modal-grip"></div>
        <h2>${esc(carrierById(s.carrier).name)} shipment</h2>
        <div class="card-sub" style="margin-bottom:10px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <span class="chip ${shipStatusChip(s.status)}">${esc(shipStatusName(s.status))}</span>
          ${s.shippedDate ? `<span>Shipped ${esc(fmtDate(s.shippedDate))}</span>` : ""}
          ${s.toClientId ? `<span class="chip">${esc(clientName(s.toClientId))}</span>` : ""}
        </div>
        ${s.trackingNumber ? `<div class="track-box">
          <div class="track-label">Tracking number</div>
          <div class="track-num">${esc(s.trackingNumber)}</div>
          <div class="contact-links" style="margin-top:10px;">
            <a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener">Track package</a>
            <button type="button" class="link-btn" id="copy-track">Copy number</button>
          </div>
        </div>` : `<p class="hint">No tracking number on this shipment.</p>`}
        ${s.note ? `<div class="card-notes" style="margin:12px 0;">${esc(s.note)}</div>` : ""}
        <div class="section-label" style="margin:18px 2px 8px;">Items</div>
        ${rows}
        ${eventsHtml}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="view-close">Close</button>
          <button type="button" class="btn btn-primary" id="view-edit">Edit</button>
        </div>
      </div></div>`;
    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) close(); });
    $("#view-close", root).addEventListener("click", close);
    $("#view-edit", root).addEventListener("click", () => { close(); openShipmentForm(s); });
    $("#copy-track", root)?.addEventListener("click", () => {
      navigator.clipboard?.writeText(s.trackingNumber).then(() => toast("Tracking number copied"),
        () => toast("Couldn't copy"));
    });
  }

  /* ============================================================
     HOURS
     ============================================================ */
  function renderHours() {
    const filter = ui.hours.filter;
    let list = db.hours.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt||0)-(a.createdAt||0));
    if (filter === "outstanding") list = list.filter((h) => !h.reimbursed);
    if (filter === "reimbursed") list = list.filter((h) => h.reimbursed);

    const owedHours = db.hours.filter((h) => !h.reimbursed).reduce((s, h) => s + (Number(h.hours) || 0), 0);

    viewEl.innerHTML = `
      <h2 class="view-title">Hours</h2>
      <div class="stat full" style="margin-bottom:14px;">
        <div class="stat-label">Hours awaiting reimbursement</div>
        <div class="stat-value amber">${owedHours.toLocaleString()}</div>
      </div>
      <div class="segment">
        <button data-f="outstanding" class="${filter==="outstanding"?"active":""}">Unpaid</button>
        <button data-f="reimbursed" class="${filter==="reimbursed"?"active":""}">Paid</button>
        <button data-f="all" class="${filter==="all"?"active":""}">All</button>
      </div>
      <div id="hours-list">
        ${list.length ? list.map(hoursCard).join("")
          : emptyState("&#128337;", filter==="outstanding" ? "No unpaid hours logged." : "No hours here yet.")}
      </div>
    `;

    viewEl.querySelectorAll(".segment button").forEach((b) =>
      b.addEventListener("click", () => { ui.hours.filter = b.dataset.f; renderHours(); })
    );
    bindHoursCards();
  }

  function hoursCard(h) {
    return `
      <div class="card" data-id="${h.id}">
        <div class="card-row">
          <div class="card-main">
            <div class="card-title">${esc(h.hours)} hrs · ${esc(fmtDate(h.date))}</div>
            ${h.notes ? `<div class="card-notes">${esc(h.notes)}</div>` : ""}
            <div style="margin-top:8px;">
              ${h.reimbursed
                ? `<span class="chip green">Paid${h.reimbursedDate ? " · " + esc(fmtDate(h.reimbursedDate)) : ""}</span>`
                : `<span class="chip amber">Unpaid</span>`}
            </div>
          </div>
          <div class="card-actions" style="flex-direction:column; align-items:flex-end;">
            <button class="mini-btn" data-act="toggle">${h.reimbursed ? "Undo" : "Mark paid"}</button>
            <button class="mini-btn" data-act="edit">Edit</button>
          </div>
        </div>
      </div>`;
  }

  function bindHoursCards() {
    viewEl.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      const h = db.hours.find((x) => x.id === id);
      card.querySelector('[data-act="edit"]')?.addEventListener("click", () => openHoursForm(h));
      card.querySelector('[data-act="toggle"]')?.addEventListener("click", () => {
        h.reimbursed = !h.reimbursed;
        h.reimbursedDate = h.reimbursed ? todayISO() : "";
        upsert("hours", h);
        toast(h.reimbursed ? "Marked paid" : "Moved back to unpaid");
        renderHours();
      });
    });
  }

  function openHoursForm(existing) {
    const h = existing || {};
    openModal(existing ? "Edit hours" : "Log hours", `
      <div class="field-row">
        <div class="field">
          <label>Hours *</label>
          <input id="f-hours" type="number" inputmode="decimal" step="0.25" value="${esc(h.hours ?? "")}" placeholder="0" />
        </div>
        <div class="field">
          <label>Date</label>
          <input id="f-date" type="date" value="${esc(h.date || todayISO())}" />
        </div>
      </div>
      <div class="field">
        <label>Notes / details</label>
        <textarea id="f-notes" placeholder="What the time was for…">${esc(h.notes || "")}</textarea>
      </div>
      <div class="check-field">
        <input id="f-reimbursed" type="checkbox" ${h.reimbursed ? "checked" : ""} />
        <label for="f-reimbursed">Already reimbursed</label>
      </div>
    `, {
      onSave: () => {
        const hours = $("#f-hours").value;
        if (hours === "" || isNaN(Number(hours))) { toast("Enter valid hours"); return false; }
        const reimbursed = $("#f-reimbursed").checked;
        const rec = {
          id: h.id || uid(),
          hours: Number(hours),
          date: $("#f-date").value || todayISO(),
          notes: $("#f-notes").value.trim(),
          reimbursed,
          reimbursedDate: reimbursed ? (h.reimbursedDate || todayISO()) : "",
          createdAt: h.createdAt || Date.now(),
        };
        upsert("hours", rec);
        toast(existing ? "Hours updated" : "Hours logged");
        renderHours();
        return true;
      },
      onDelete: existing ? () => { remove("hours", h.id); toast("Entry deleted"); renderHours(); } : null,
    });
  }

  /* ============================================================
     Shared CRUD
     ============================================================ */
  function upsert(coll, rec) {
    const arr = db[coll];
    const i = arr.findIndex((x) => x.id === rec.id);
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    scheduleSheetsBackup();
    if (!userId) return;
    col(coll)
      .doc(rec.id)
      .set(JSON.parse(JSON.stringify(rec)))
      .catch((e) => {
        console.error("Sync error", e);
        toast("Couldn't sync that change — check your connection.");
      });
  }
  function remove(coll, id) {
    db[coll] = db[coll].filter((x) => x.id !== id);
    scheduleSheetsBackup();
    if (!userId) return;
    col(coll)
      .doc(id)
      .delete()
      .catch((e) => console.error("Sync error", e));
  }

  /* ============================================================
     Public portfolio ("Finds" on the sourcing website)
     ------------------------------------------------------------
     A curated, PUBLIC-READABLE mirror of chosen purchases. Only the
     display-safe fields ever leave the app — image, brand, item name, and
     (optionally) the date. Cost, client, receipt, payment and notes are never
     written here. Lives in a top-level `portfolio` collection so the website
     can read it without authentication, while private data under
     `users/{uid}/…` stays locked to this account.
     ============================================================ */
  const portfolioCol = () => firestore.collection("portfolio");

  // A purchase appears on the site when the portfolio is enabled, the item
  // isn't individually hidden, it has a photo to show, and it clears the
  // private minimum-cost filter.
  function portfolioQualifies(p) {
    const s = db.settings.portfolio || {};
    if (s.enabled === false) return false;
    if (p.portfolioHidden) return false;
    if (!p.photo) return false;
    if ((Number(p.cost) || 0) < (Number(s.minCost) || 0)) return false;
    return true;
  }

  // The exact, minimal shape published to the public feed.
  function portfolioEntry(p) {
    return {
      id: p.id,
      name: (p.portfolioName && p.portfolioName.trim()) || p.product || "",
      brand: p.brand || "",
      // Empty string means "don't show a date" (hidden per-item). We never
      // publish the real date when it's hidden, so it can't leak via the feed.
      date: p.portfolioHideDate ? "" : (p.date || ""),
      photo: p.photo || "",
      sort: p.createdAt || 0, // opaque ordering key (log time, not the buy date)
      updatedAt: Date.now(),
    };
  }

  // Publish or unpublish a single purchase based on whether it qualifies.
  function syncPortfolio(p) {
    if (!userId || !p || !p.id) return;
    if (portfolioQualifies(p)) {
      portfolioCol()
        .doc(p.id)
        .set(portfolioEntry(p))
        .catch((e) => console.error("Portfolio sync error", e));
    } else {
      portfolioCol().doc(p.id).delete().catch(() => {});
    }
  }

  function removePortfolio(id) {
    if (!userId || !id) return;
    portfolioCol().doc(id).delete().catch(() => {});
  }

  // Re-evaluate every purchase — used after the portfolio settings change.
  function resyncPortfolio() {
    if (!userId) return;
    db.purchases.forEach(syncPortfolio);
  }

  function portfolioLiveCount() {
    return db.purchases.filter(portfolioQualifies).length;
  }

  /* ============================================================
     Managed option lists — stores &amp; payment methods
     ============================================================ */
  // Simple string lists (stores, brands) share one picklist implementation.
  // `key` is the settings array name; `noun` is used in the UI copy.
  function listSelectOptions(key, selected, noun) {
    const opts = (db.settings[key] || [])
      .map((s) => `<option value="${esc(s)}" ${s === selected ? "selected" : ""}>${esc(s)}</option>`)
      .join("");
    return `<option value="">— select ${esc(noun)} —</option>${opts}<option value="__add__">+ Add new ${esc(noun)}…</option>`;
  }

  function handleListSelectChange(selectEl, key, noun) {
    if (selectEl.value !== "__add__") return;
    const name = prompt(`Add a new ${noun}:`);
    if (!name || !name.trim()) { selectEl.value = ""; return; }
    const clean = name.trim();
    if (!(db.settings[key] || []).some((s) => s.toLowerCase() === clean.toLowerCase())) {
      db.settings[key] = (db.settings[key] || []).concat(clean);
      save();
    }
    addOptionAndSelect(selectEl, clean);
  }

  const storeSelectOptions = (selected) => listSelectOptions("stores", selected, "store");
  const brandSelectOptions = (selected) => listSelectOptions("brands", selected, "brand");

  function paymentSelectOptions(selected) {
    const opts = db.settings.paymentMethods
      .map((m) => `<option value="${esc(m.name)}" ${m.name === selected ? "selected" : ""}>${esc(m.name)}${m.cashbackPercent > 0 ? ` (${m.cashbackPercent}% back)` : ""}</option>`)
      .join("");
    return `<option value="">— select payment —</option>${opts}<option value="__add__">+ Add new payment method…</option>`;
  }

  function addOptionAndSelect(selectEl, value) {
    const addOpt = selectEl.querySelector('option[value="__add__"]');
    let opt = [...selectEl.options].find((o) => o.value === value);
    if (!opt) {
      opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      if (addOpt) selectEl.insertBefore(opt, addOpt);
      else selectEl.appendChild(opt);
    }
    selectEl.value = value;
  }

  const handleStoreSelectChange = (el) => handleListSelectChange(el, "stores", "store");
  const handleBrandSelectChange = (el) => handleListSelectChange(el, "brands", "brand");

  function handlePaymentSelectChange(selectEl) {
    if (selectEl.value !== "__add__") return;
    const name = prompt("Add a new payment method (e.g. Amex Platinum):");
    if (!name || !name.trim()) { selectEl.value = ""; return; }
    const clean = name.trim();
    const cbRaw = prompt("Cashback % for this method? (enter 0 if none)", "0");
    const cashbackPercent = Math.max(0, Number(cbRaw) || 0);
    let match = db.settings.paymentMethods.find((m) => m.name.toLowerCase() === clean.toLowerCase());
    if (!match) {
      match = { id: uid(), name: clean, cashbackPercent };
      db.settings.paymentMethods.push(match);
      save();
    }
    addOptionAndSelect(selectEl, match.name);
  }

  // Add/remove screen for a simple string list (stores, brands).
  function openListManager(key, title, noun, placeholder) {
    const list = db.settings[key] || [];
    const listHTML = list.length
      ? list.map((s) => `
        <div class="mini-row">
          <div class="mini-row-title">${esc(s)}</div>
          <button type="button" class="mini-btn" data-item="${esc(s)}">Remove</button>
        </div>`).join("")
      : `<p class="hint">No ${esc(noun)}s yet.</p>`;

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-grip"></div>
          <h2>${esc(title)}</h2>
          <div id="list-items">${listHTML}</div>
          <div class="field" style="margin-top:14px;">
            <label>Add a ${esc(noun)}</label>
            <div style="display:flex; gap:8px;">
              <input id="new-item" type="text" placeholder="${esc(placeholder)}" style="flex:1;" />
              <button type="button" class="btn btn-primary" id="add-item" style="flex:0 0 auto; padding:12px 18px;">Add</button>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="list-close">Close</button>
          </div>
        </div>
      </div>`;

    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) close();
    });
    $("#list-close", root).addEventListener("click", close);
    $("#add-item", root).addEventListener("click", () => {
      const val = $("#new-item", root).value.trim();
      if (!val) return;
      if (!(db.settings[key] || []).some((s) => s.toLowerCase() === val.toLowerCase())) {
        db.settings[key] = (db.settings[key] || []).concat(val);
        save();
      }
      openListManager(key, title, noun, placeholder);
    });
    root.querySelectorAll("[data-item]").forEach((btn) => {
      btn.addEventListener("click", () => {
        db.settings[key] = (db.settings[key] || []).filter((s) => s !== btn.dataset.item);
        save();
        openListManager(key, title, noun, placeholder);
      });
    });
  }

  const openStoreManager = () => openListManager("stores", "Stores", "store", "e.g. Fendi");
  const openBrandManager = () => openListManager("brands", "Brands", "brand", "e.g. Fendi");

  function openPaymentManager() {
    const listHTML = db.settings.paymentMethods.length
      ? db.settings.paymentMethods.map((m) => `
        <div class="mini-row">
          <div>
            <div class="mini-row-title">${esc(m.name)}</div>
            <div class="mini-row-sub">${m.cashbackPercent > 0 ? `${m.cashbackPercent}% cashback` : "No cashback"}</div>
          </div>
          <button type="button" class="mini-btn" data-pm="${esc(m.id)}">Remove</button>
        </div>`).join("")
      : `<p class="hint">No payment methods yet.</p>`;

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-grip"></div>
          <h2>Payment methods</h2>
          <div id="pm-list">${listHTML}</div>
          <div class="field-row" style="margin-top:14px;">
            <div class="field">
              <label>Name</label>
              <input id="new-pm-name" type="text" placeholder="e.g. Amex Platinum" />
            </div>
            <div class="field">
              <label>Cashback %</label>
              <input id="new-pm-cashback" type="number" inputmode="decimal" step="0.1" placeholder="0" />
            </div>
          </div>
          <button type="button" class="btn btn-primary" id="add-pm" style="width:100%; margin-bottom:14px;">Add payment method</button>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="pm-close">Close</button>
          </div>
        </div>
      </div>`;

    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) close();
    });
    $("#pm-close", root).addEventListener("click", close);
    $("#add-pm", root).addEventListener("click", () => {
      const name = $("#new-pm-name", root).value.trim();
      if (!name) { toast("Enter a name"); return; }
      const cashbackPercent = Math.max(0, Number($("#new-pm-cashback", root).value) || 0);
      db.settings.paymentMethods.push({ id: uid(), name, cashbackPercent });
      save();
      openPaymentManager();
    });
    root.querySelectorAll("[data-pm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        db.settings.paymentMethods = db.settings.paymentMethods.filter((m) => m.id !== btn.dataset.pm);
        save();
        openPaymentManager();
      });
    });
  }

  /* ============================================================
     Modal
     ============================================================ */
  function openModal(title, bodyHTML, { onSave, onDelete, saveLabel } = {}) {
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-grip"></div>
          <h2>${esc(title)}</h2>
          <form id="modal-form">
            ${bodyHTML}
            <div class="modal-actions">
              ${onDelete ? `<button type="button" class="btn btn-danger-text" id="modal-delete">Delete</button>` : ""}
              <button type="button" class="btn btn-ghost" id="modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">${esc(saveLabel || "Save")}</button>
            </div>
          </form>
        </div>
      </div>`;

    const close = () => (root.innerHTML = "");
    const backdrop = $(".modal-backdrop", root);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    $("#modal-cancel", root).addEventListener("click", close);
    $("#modal-form", root).addEventListener("submit", (e) => {
      e.preventDefault();
      if (!onSave || onSave() !== false) close();
    });
    if (onDelete) {
      $("#modal-delete", root).addEventListener("click", () => {
        if (confirm("Delete this? This can't be undone.")) { onDelete(); close(); }
      });
    }
    setTimeout(() => $(".modal input, .modal textarea", root)?.focus(), 60);
  }

  /* ============================================================
     Menu — backup / restore
     ============================================================ */
  function openMenu() {
    const email = auth.currentUser ? auth.currentUser.email : "";
    openModal("Account & data", `
      <p class="hint">Signed in as <strong>${esc(email)}</strong>. Your data is private
      to this account, stored securely in the cloud, and syncs across your devices.
      It also works offline and catches up when you reconnect.</p>
      <div class="modal-actions" style="flex-direction:column; gap:10px;">
        <button type="button" class="btn btn-ghost" id="m-portfolio">Public portfolio (Finds)</button>
        <button type="button" class="btn btn-ghost" id="m-stores">Manage stores</button>
        <button type="button" class="btn btn-ghost" id="m-brands">Manage brands</button>
        <button type="button" class="btn btn-ghost" id="m-payments">Manage payment methods</button>
        <button type="button" class="btn btn-ghost" id="m-sheets">Google Sheets backup</button>
        <button type="button" class="btn btn-primary" id="m-export">Export backup (.json)</button>
        <button type="button" class="btn btn-ghost" id="m-import">Import backup</button>
        <button type="button" class="btn btn-ghost" id="m-signout" style="color:var(--danger);">Sign out</button>
      </div>
      <input id="m-file" type="file" accept="application/json,.json" hidden />
      <p class="hint" style="margin-top:16px;">
        ${db.contacts.length} sales associates · ${db.purchases.length} purchases · ${db.hours.length} hours entries
      </p>
    `, { onSave: null });
    // Replace default actions area is complex; just wire buttons and hide save row.
    const root = $("#modal-root");
    $(".modal-actions:last-of-type", root)?.remove(); // remove the default save/cancel row
    // Add a close button
    const closeRow = document.createElement("div");
    closeRow.className = "modal-actions";
    closeRow.innerHTML = `<button type="button" class="btn btn-ghost" id="m-close">Close</button>`;
    $("#modal-form", root).appendChild(closeRow);

    const close = () => (root.innerHTML = "");
    $("#m-close", root).addEventListener("click", close);
    $("#m-portfolio", root).addEventListener("click", openPortfolioManager);
    $("#m-sheets", root).addEventListener("click", openSheetsBackup);
    $("#m-stores", root).addEventListener("click", openStoreManager);
    $("#m-brands", root).addEventListener("click", openBrandManager);
    $("#m-payments", root).addEventListener("click", openPaymentManager);
    $("#m-export", root).addEventListener("click", exportData);
    $("#m-import", root).addEventListener("click", () => $("#m-file", root).click());
    $("#m-file", root).addEventListener("change", (e) => importData(e.target.files[0], close));
    $("#m-signout", root).addEventListener("click", () => {
      if (confirm("Sign out? Your data stays safely in your account.")) {
        close();
        auth.signOut();
      }
    });
  }

  function openPortfolioManager() {
    const s = db.settings.portfolio || (db.settings.portfolio = { enabled: true, minCost: 0 });
    openModal("Public portfolio (Finds)", `
      <p class="hint">Chosen purchases appear as <strong>Finds</strong> on your sourcing
      website. Only the photo, brand, item name &amp; date are published — never the
      cost, client, or receipt. Each purchase publishes by default; uncheck
      &ldquo;Show on my public Finds portfolio&rdquo; on any item to hide it.</p>
      <div class="check-field" style="margin-top:12px;">
        <input id="pf-enabled" type="checkbox" ${s.enabled === false ? "" : "checked"} />
        <label for="pf-enabled">Show my Finds portfolio on the website</label>
      </div>
      <div class="field" style="margin-top:14px;">
        <label>Only publish finds costing at least</label>
        <input id="pf-mincost" type="number" inputmode="decimal" step="1" min="0"
          value="${esc(s.minCost || "")}" placeholder="0 (no minimum)" />
        <p class="hint" style="margin-top:6px;">A private filter, just for you — the price
          is never shown on the site. Leave at 0 to publish everything.</p>
      </div>
      <p class="hint" id="pf-count" style="margin-top:14px;">${portfolioLiveCount()} find(s) currently live.</p>
    `, {
      saveLabel: "Save & sync",
      onSave: () => {
        s.enabled = $("#pf-enabled").checked;
        const min = Number($("#pf-mincost").value);
        s.minCost = isNaN(min) || min < 0 ? 0 : min;
        save();
        resyncPortfolio();
        toast("Portfolio updated");
        return true;
      },
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kinsey-cathers-fashion-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup exported");
  }

  function importData(file, done) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.contacts))
          throw new Error("Not a valid backup file");
        if (!confirm("This will replace all current data with the backup. Continue?")) return;
        toast("Importing…");
        // Remove docs not present in the backup, then write everything.
        const incoming = Object.assign(defaultData(), parsed);
        incoming.settings = Object.assign(defaultSettings(), parsed.settings || {});
        for (const name of ["contacts", "purchases", "hours"]) {
          const incomingIds = new Set((incoming[name] || []).map((r) => r.id));
          const existing = await col(name).get();
          await Promise.all(
            existing.docs.filter((d) => !incomingIds.has(d.id)).map((d) => d.ref.delete())
          );
          await Promise.all(
            (incoming[name] || []).map((r) =>
              col(name).doc(r.id).set(JSON.parse(JSON.stringify(r)))
            )
          );
        }
        db = incoming;
        save();
        resyncPortfolio(); // keep the public feed in step with imported purchases
        done && done();
        route(currentTab);
        toast("Backup imported");
      } catch (err) {
        toast("Couldn't import that file");
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  /* ============================================================
     Shared bits + routing
     ============================================================ */
  function emptyState(ico, msg) {
    return `<div class="empty"><div class="empty-ico">${ico}</div><p>${esc(msg)}</p></div>`;
  }

  const routes = {
    dashboard: renderDashboard,
    contacts: renderContacts,
    purchases: renderPurchases,
    hours: renderHours,
    clients: renderClients,
    payments: renderPayments,
  };

  function route(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === tab)
    );
    // FAB only makes sense on collections
    $("#fab").style.display = tab === "dashboard" ? "none" : "flex";
    viewEl.scrollTop = 0;
    window.scrollTo(0, 0);
    (routes[tab] || renderDashboard)();
  }

  function fabAction() {
    if (currentTab === "contacts") openContactForm();
    else if (currentTab === "purchases") {
      if (ui.purchases.view === "shipments") openShipmentForm(); else openPurchaseForm();
    }
    else if (currentTab === "hours") openHoursForm();
    else if (currentTab === "clients") openClientForm();
    else if (currentTab === "payments") openPaymentForm();
  }

  /* ============================================================
     Cloud sync — listeners, migration, auth boot
     ============================================================ */
  let renderTimer = null;
  function scheduleRender() {
    // Debounce: multiple snapshots can land at once (initial load).
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => route(currentTab), 40);
  }

  function updateSyncDot(fromCache, hasPending) {
    const dot = $("#sync-dot");
    if (!dot) return;
    const pending = fromCache || hasPending;
    dot.classList.toggle("pending", pending);
    dot.title = pending ? "Waiting to sync (offline changes are saved)" : "Synced";
  }

  function attachListeners() {
    unsubscribers.push(
      settingsRef().onSnapshot((snap) => {
        if (snap.exists) {
          db.settings = Object.assign(defaultSettings(), snap.data());
        }
        scheduleRender();
      })
    );
    ["contacts", "purchases", "hours", "clients", "payments", "shipments"].forEach((name) => {
      unsubscribers.push(
        col(name).onSnapshot({ includeMetadataChanges: true }, (snap) => {
          db[name] = snap.docs.map((d) => d.data());
          updateSyncDot(snap.metadata.fromCache, snap.metadata.hasPendingWrites);
          scheduleRender();
        })
      );
    });
  }

  function detachListeners() {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
  }

  // One-time: move pre-cloud localStorage data into the user's empty account.
  async function migrateLocalIfNeeded() {
    try {
      const raw = localStorage.getItem(LEGACY_DB_KEY);
      if (!raw) return;
      const old = JSON.parse(raw);
      const probes = await Promise.all(
        ["contacts", "purchases", "hours"].map((n) => col(n).limit(1).get())
      );
      if (probes.some((p) => !p.empty)) return; // account already has data
      const writes = [];
      for (const name of ["contacts", "purchases", "hours"]) {
        (old[name] || []).forEach((r) => {
          if (r && r.id) writes.push(col(name).doc(r.id).set(JSON.parse(JSON.stringify(r))));
        });
      }
      writes.push(
        settingsRef().set(Object.assign(defaultSettings(), old.settings || {}))
      );
      await Promise.all(writes);
      // Keep a safety copy locally, then retire the old key.
      localStorage.setItem(LEGACY_DB_KEY + "_migrated", raw);
      localStorage.removeItem(LEGACY_DB_KEY);
      toast("Moved your existing data into your account");
    } catch (e) {
      console.error("Migration failed", e);
    }
  }

  function show(el, visible) {
    document.getElementById(el).style.display = visible ? "" : "none";
  }

  /* ---------- Wire up ---------- */
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => route(t.dataset.tab))
  );
  $("#fab").addEventListener("click", fabAction);
  $("#btn-menu").addEventListener("click", openMenu);

  $("#btn-signin").addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithRedirect(provider);
  });

  auth.getRedirectResult().catch((err) => {
    console.error("Sign-in error", err);
    const box = $("#auth-error");
    box.textContent = "Sign-in didn't complete — please try again.";
    box.style.display = "";
  });

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      // Private app: only Kinsey's account is allowed. Anyone else is
      // signed straight back out (the server rules also block their data).
      if ((user.email || "").toLowerCase() !== ALLOWED_EMAIL) {
        await auth.signOut();
        show("splash", false);
        show("app", false);
        show("auth-screen", true);
        const box = $("#auth-error");
        box.textContent = "This app is private. Please sign in with the Kinsey Cathers account.";
        box.style.display = "";
        return;
      }
      userId = user.uid;
      show("splash", false);
      show("auth-screen", false);
      show("app", true);
      await migrateLocalIfNeeded();
      detachListeners();
      attachListeners();
      route(currentTab);
    } else {
      userId = null;
      db = defaultData();
      detachListeners();
      show("splash", false);
      show("app", false);
      show("auth-screen", true);
    }
  });

  // Offline-capable app shell
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
