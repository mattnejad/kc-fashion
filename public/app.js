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
    // authDomain matches the hosting domain so sign-in redirects are
    // same-origin (required for reliable auth on iOS Safari/PWA).
    authDomain: "kc-fashion-511b7.web.app",
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
    paymentMethods: [], // [{id, name, cashbackPercent}]
  });

  const defaultData = () => ({
    contacts: [],
    purchases: [],
    hours: [],
    settings: defaultSettings(),
  });

  // In-memory mirror of the user's Firestore data; render code reads this.
  let db = defaultData();
  let userId = null; // signed-in Firebase uid
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
    purchases: { filter: "outstanding" },
    hours: { filter: "outstanding" },
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
  function renderPurchases() {
    const filter = ui.purchases.filter;
    let list = db.purchases.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt||0)-(a.createdAt||0));
    if (filter === "outstanding") list = list.filter((p) => !p.reimbursed);
    if (filter === "reimbursed") list = list.filter((p) => p.reimbursed);

    const owed = db.purchases.filter((p) => !p.reimbursed)
      .reduce((s, p) => s + (Number(p.cost) || 0), 0);

    viewEl.innerHTML = `
      <h2 class="view-title">Purchases</h2>
      <div class="stat full" style="margin-bottom:14px;">
        <div class="stat-label">Currently awaiting reimbursement</div>
        <div class="stat-value amber">${money(owed)}</div>
      </div>
      <div class="segment">
        <button data-f="outstanding" class="${filter==="outstanding"?"active":""}">Awaiting</button>
        <button data-f="reimbursed" class="${filter==="reimbursed"?"active":""}">Reimbursed</button>
        <button data-f="all" class="${filter==="all"?"active":""}">All</button>
      </div>
      <div id="purchase-list">
        ${list.length ? list.map(purchaseCard).join("")
          : emptyState("&#128717;", filter==="outstanding" ? "Nothing outstanding — all caught up." : "No purchases here yet.")}
      </div>
    `;

    viewEl.querySelectorAll(".segment button").forEach((b) =>
      b.addEventListener("click", () => { ui.purchases.filter = b.dataset.f; renderPurchases(); })
    );
    bindPurchaseCards();
  }

  function purchaseCard(p) {
    const contact = p.contactId ? db.contacts.find((c) => c.id === p.contactId) : null;
    const sub = [fmtDate(p.date), contact ? contact.name : null].filter(Boolean).join(" · ");
    const cashbackAmt = (Number(p.cost) || 0) * ((Number(p.cashbackPercent) || 0) / 100);
    return `
      <div class="card" data-id="${p.id}">
        <div class="card-row">
          ${p.photo ? `<img class="thumb" src="${esc(p.photo)}" alt="${esc(p.product)}" />` : ""}
          <div class="card-main">
            <div class="card-title">${esc(p.product)}</div>
            <div class="card-sub">
              ${p.store ? `<span class="chip">${esc(p.store)}</span> ` : ""}
              ${esc(sub)}
            </div>
            ${p.notes ? `<div class="card-notes">${esc(p.notes)}</div>` : ""}
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              ${p.reimbursed
                ? `<span class="chip green">Reimbursed${p.reimbursedDate ? " · " + esc(fmtDate(p.reimbursedDate)) : ""}</span>`
                : `<span class="chip amber">Awaiting</span>`}
              ${p.paymentMethod ? `<span class="chip">${esc(p.paymentMethod)}</span>` : ""}
              ${cashbackAmt > 0 ? `<span class="chip green">+${money(cashbackAmt)} cashback</span>` : ""}
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
    viewEl.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      const p = db.purchases.find((x) => x.id === id);
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

  function openPurchaseForm(existing) {
    const p = existing || {};
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
          <label>Store</label>
          <select id="f-store">${storeSelectOptions(p.store || "")}</select>
        </div>
        <div class="field">
          <label>Sales Associate</label>
          <select id="f-contact">${contactOptions}</select>
        </div>
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
      <div class="field">
        <label>Photo</label>
        <div id="photo-drop" class="photo-drop">
          <div id="photo-preview-wrap" class="photo-preview-wrap" style="${p.photo ? "" : "display:none;"}">
            <img id="photo-preview" src="${p.photo || ""}" alt="Product photo" />
            <button type="button" class="mini-btn photo-remove" id="photo-remove">Remove</button>
          </div>
          <div id="photo-placeholder" class="photo-placeholder" style="${p.photo ? "display:none;" : ""}">
            <div class="photo-placeholder-ico">&#128247;</div>
            <p>Drag &amp; drop a photo here, or tap to choose</p>
          </div>
        </div>
        <input id="f-photo-input" type="file" accept="image/*" hidden />
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="f-notes" placeholder="Client, order #, anything to remember…">${esc(p.notes || "")}</textarea>
      </div>
      <div class="check-field">
        <input id="f-reimbursed" type="checkbox" ${p.reimbursed ? "checked" : ""} />
        <label for="f-reimbursed">Already reimbursed</label>
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
          store: $("#f-store").value || "",
          contactId: $("#f-contact").value || "",
          paymentMethod: paymentName || "",
          cashbackPercent: pm ? pm.cashbackPercent : 0,
          photo: photoDataUrl,
          notes: $("#f-notes").value.trim(),
          reimbursed,
          reimbursedDate: reimbursed ? (p.reimbursedDate || todayISO()) : "",
          createdAt: p.createdAt || Date.now(),
        };
        upsert("purchases", rec);
        toast(existing ? "Purchase updated" : "Purchase added");
        renderPurchases();
        return true;
      },
      onDelete: existing ? () => { remove("purchases", p.id); toast("Purchase deleted"); renderPurchases(); } : null,
    });

    const updateCashbackPreview = () => {
      const cost = Number($("#f-cost").value) || 0;
      const pm = db.settings.paymentMethods.find((m) => m.name === $("#f-payment").value);
      const pct = pm ? pm.cashbackPercent : 0;
      $("#f-cashback-preview").value = pct > 0 ? `${money((cost * pct) / 100)} (${pct}%)` : "—";
    };

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

    let photoDataUrl = p.photo || "";
    const dropZone = $("#photo-drop");
    const fileInput = $("#f-photo-input");
    const preview = $("#photo-preview");
    const previewWrap = $("#photo-preview-wrap");
    const placeholder = $("#photo-placeholder");

    function showPhoto(dataUrl) {
      photoDataUrl = dataUrl;
      if (dataUrl) {
        preview.src = dataUrl;
        previewWrap.style.display = "";
        placeholder.style.display = "none";
      } else {
        preview.src = "";
        previewWrap.style.display = "none";
        placeholder.style.display = "";
      }
    }

    async function handlePhotoFile(file) {
      if (!file) return;
      if (!file.type.startsWith("image/")) { toast("Please choose an image file"); return; }
      try {
        showPhoto(await compressImage(file));
      } catch (err) {
        console.error(err);
        toast("Couldn't read that photo");
      }
    }

    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => handlePhotoFile(fileInput.files[0]));
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      handlePhotoFile(e.dataTransfer.files[0]);
    });
    $("#photo-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      showPhoto("");
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
    if (!userId) return;
    col(coll)
      .doc(id)
      .delete()
      .catch((e) => console.error("Sync error", e));
  }

  /* ============================================================
     Managed option lists — stores &amp; payment methods
     ============================================================ */
  function storeSelectOptions(selected) {
    const opts = db.settings.stores
      .map((s) => `<option value="${esc(s)}" ${s === selected ? "selected" : ""}>${esc(s)}</option>`)
      .join("");
    return `<option value="">— select store —</option>${opts}<option value="__add__">+ Add new store…</option>`;
  }

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

  function handleStoreSelectChange(selectEl) {
    if (selectEl.value !== "__add__") return;
    const name = prompt("Add a new store:");
    if (!name || !name.trim()) { selectEl.value = ""; return; }
    const clean = name.trim();
    if (!db.settings.stores.some((s) => s.toLowerCase() === clean.toLowerCase())) {
      db.settings.stores.push(clean);
      save();
    }
    addOptionAndSelect(selectEl, clean);
  }

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

  function openStoreManager() {
    const listHTML = db.settings.stores.length
      ? db.settings.stores.map((s) => `
        <div class="mini-row">
          <div class="mini-row-title">${esc(s)}</div>
          <button type="button" class="mini-btn" data-store="${esc(s)}">Remove</button>
        </div>`).join("")
      : `<p class="hint">No stores yet.</p>`;

    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-grip"></div>
          <h2>Stores</h2>
          <div id="store-list">${listHTML}</div>
          <div class="field" style="margin-top:14px;">
            <label>Add a store</label>
            <div style="display:flex; gap:8px;">
              <input id="new-store" type="text" placeholder="e.g. Fendi" style="flex:1;" />
              <button type="button" class="btn btn-primary" id="add-store" style="flex:0 0 auto; padding:12px 18px;">Add</button>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="store-close">Close</button>
          </div>
        </div>
      </div>`;

    const close = () => (root.innerHTML = "");
    $(".modal-backdrop", root).addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) close();
    });
    $("#store-close", root).addEventListener("click", close);
    $("#add-store", root).addEventListener("click", () => {
      const val = $("#new-store", root).value.trim();
      if (!val) return;
      if (!db.settings.stores.some((s) => s.toLowerCase() === val.toLowerCase())) {
        db.settings.stores.push(val);
        save();
      }
      openStoreManager();
    });
    root.querySelectorAll("[data-store]").forEach((btn) => {
      btn.addEventListener("click", () => {
        db.settings.stores = db.settings.stores.filter((s) => s !== btn.dataset.store);
        save();
        openStoreManager();
      });
    });
  }

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
  function openModal(title, bodyHTML, { onSave, onDelete } = {}) {
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
              <button type="submit" class="btn btn-primary">Save</button>
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
        <button type="button" class="btn btn-ghost" id="m-stores">Manage stores</button>
        <button type="button" class="btn btn-ghost" id="m-payments">Manage payment methods</button>
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
    $("#m-stores", root).addEventListener("click", openStoreManager);
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
    else if (currentTab === "purchases") openPurchaseForm();
    else if (currentTab === "hours") openHoursForm();
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
    ["contacts", "purchases", "hours"].forEach((name) => {
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
