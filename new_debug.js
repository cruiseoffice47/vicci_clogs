/* Reliant Travel – Reservation to Package debug */

(function () {

  const el = (id) => document.getElementById(`id123-control${id}`);

  // ✅ Your actual field IDs

  const resEl = el(119086165);     // Reservation #

  const pkgEl = el(119086582);     // Package Code

  function getPackageFromRes(reservation) {

    if (!reservation) return "";

    const parts = reservation.split("-");

    return parts[parts.length - 1].toUpperCase();

  }

  function updateFromReservation() {

    if (!resEl || !pkgEl) {

      console.log("❌ Could not find Reservation or Package field");

      return;

    }

    console.log("Reservation value:", resEl.value);

    const code = getPackageFromRes(resEl.value);

    console.log("Extracted code:", code);

    pkgEl.value = code;

    console.log("✅ Package field set to:", pkgEl.value);

  }

  document.addEventListener("change", (e) => {

    if (e.target === resEl) updateFromReservation();

  });

  setTimeout(() => {

    console.log("🔎 Debug init fired");

    console.log("Fields found:", { resEl, pkgEl });

  }, 800);

})();
 