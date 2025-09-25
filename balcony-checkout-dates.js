/* Reliant Travel – auto-fill package code and checkout date */

(function () {

  // Map package codes to required nights

  const NIGHTS_BY_CODE = { IMB: 4, IBA: 5, IBY: 6 };

  // Helper: add days to a date string (mm-dd-yyyy)

  function addDaysStr(dateStr, days) {

    if (!dateStr) return "";

    const parts = dateStr.split(/[-\/]/); // supports mm-dd-yyyy or mm/dd/yyyy

    let m = +parts[0] - 1;

    let d = +parts[1];

    let y = +parts[2];

    const dt = new Date(y, m, d);

    dt.setDate(dt.getDate() + days);

    const mm = String(dt.getMonth() + 1).padStart(2, "0");

    const dd = String(dt.getDate()).padStart(2, "0");

    return `${mm}-${dd}-${dt.getFullYear()}`;

  }

  // Shortcut for 123 FormBuilder field elements

  const el = (id) => document.getElementById(`id123-control${id}`);

  // ✅ Your actual field IDs

  const resEl = el(119086165);     // Reservation #

  const pkgEl = el(119086582);     // Package Code

  const inEl  = el(119086203);     // Check-in Date

  const outEl = el(119086204);     // Check-out Date

  // Extract package code from reservation number (last 3 letters after a dash)

  function getPackageFromRes(reservation) {

    if (!reservation) return "";

    const match = reservation.match(/-([A-Z]{3})$/);

    return match ? match[1] : "";

  }

  function updateFromReservation() {

    if (!resEl || !pkgEl) return;

    const code = getPackageFromRes(resEl.value);

    if (NIGHTS_BY_CODE[code]) {

      pkgEl.value = code;  // auto-fill package field

      updateCheckout();    // update checkout immediately

    }

  }

  function updateCheckout() {

    if (!pkgEl || !inEl || !outEl) return;

    const code = (pkgEl.value || "").trim().toUpperCase();

    const nights = NIGHTS_BY_CODE[code];

    if (!nights) return;

    if (!inEl.value) { outEl.value = ""; return; }

    outEl.value = addDaysStr(inEl.value, nights);

    outEl.setAttribute("readonly", "readonly");

    outEl.dispatchEvent(new Event("change", { bubbles: true }));

  }

  // Listen for changes

  document.addEventListener("change", (e) => {

    if (e.target === resEl) updateFromReservation();

    if (e.target === pkgEl || e.target === inEl) updateCheckout();

  });

  // Initialize on load

  setTimeout(() => {

    updateFromReservation();

    updateCheckout();

  }, 600);

})();
 
