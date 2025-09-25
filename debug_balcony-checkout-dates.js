/* Reliant Travel – debug version */

(function () {

  const NIGHTS_BY_CODE = { IMB: 4, IBA: 5, IBY: 6 };

  // Helper: add days to a date string (mm-dd-yyyy or mm/dd/yyyy)

  function addDaysStr(dateStr, days) {

    if (!dateStr) return "";

    const parts = dateStr.split(/[-\/]/);

    const m = +parts[0] - 1;

    const d = +parts[1];

    const y = +parts[2];

    const dt = new Date(y, m, d);

    dt.setDate(dt.getDate() + days);

    const mm = String(dt.getMonth() + 1).padStart(2, "0");

    const dd = String(dt.getDate()).padStart(2, "0");

    return `${mm}-${dd}-${dt.getFullYear()}`;

  }

  const el = (id) => document.getElementById(`id123-control${id}`);

  // ✅ Your IDs

  const resEl = el(119086165);     // Reservation #

  const pkgEl = el(119086582);     // Package Code

  const inEl  = el(119086203);     // Check-in Date

  const outEl = el(119086204);     // Check-out Date

  function getPackageFromRes(reservation) {

    if (!reservation) return "";

    const parts = reservation.split("-");

    return parts[parts.length - 1].toUpperCase();

  }

  function updateFromReservation() {

    if (!resEl || !pkgEl) return;

    const code = getPackageFromRes(resEl.value);

    console.log("Reservation input:", resEl.value, "→ extracted code:", code);

    if (NIGHTS_BY_CODE[code]) {

      pkgEl.value = code;

      console.log("Package field set to:", code);

      updateCheckout();

    } else {

      console.log("Code not recognized:", code);

    }

  }

  function updateCheckout() {

    if (!pkgEl || !inEl || !outEl) return;

    const code = (pkgEl.value || "").trim().toUpperCase();

    const nights = NIGHTS_BY_CODE[code];

    console.log("Updating checkout → package:", code, "nights:", nights, "check-in value:", inEl.value);

    if (!nights) return;

    if (!inEl.value) { outEl.value = ""; return; }

    outEl.value = addDaysStr(inEl.value, nights);

    outEl.setAttribute("readonly", "readonly");

    console.log("Checkout field set to:", outEl.value);

  }

  document.addEventListener("change", (e) => {

    if (e.target === resEl) updateFromReservation();

    if (e.target === pkgEl || e.target === inEl) updateCheckout();

  });

  setTimeout(() => {

    console.log("Debug init fired");

    console.log("Fields found:", { resEl, pkgEl, inEl, outEl });

    updateFromReservation();

    updateCheckout();

  }, 1000);

})();
 