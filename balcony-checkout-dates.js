/* Reliant Travel – auto-fill checkout date based on package */
(function () {
 // Map your package codes to required nights
 const NIGHTS_BY_CODE = { IMB: 4, IBA: 5, IBY: 6 };
 // Helper: add days to a date string (yyyy-mm-dd)
 function addDaysStr(dateStr, days) {
   if (!dateStr) return "";
   const parts = dateStr.split(/[-\/]/);
   let y, m, d;
   if (parts[0].length === 4) { y = +parts[0]; m = +parts[1] - 1; d = +parts[2]; }
   else { m = +parts[0] - 1; d = +parts[1]; y = +parts[2]; }
   const dt = new Date(y, m, d);
   dt.setDate(dt.getDate() + days);
   const mm = String(dt.getMonth() + 1).padStart(2, "0");
   const dd = String(dt.getDate()).padStart(2, "0");
   return `${dt.getFullYear()}-${mm}-${dd}`;
 }
 // 123FormBuilder inputs use ids like id123-control<FIELDID>
 const el = (id) => document.getElementById(`id123-control${id}`);
 // ✅ Your actual field IDs
 const pkgEl = el(119086582);   // Package Code
 const inEl  = el(119086203);   // Check-in Date
 const outEl = el(119086204);   // Check-out Date
 function updateCheckout() {
   if (!pkgEl || !inEl || !outEl) return;
   const code = (pkgEl.value || "").trim().toUpperCase();
   const nights = NIGHTS_BY_CODE[code];
   if (!nights) return;
   if (!inEl.value) { outEl.value = ""; return; }
   outEl.value = addDaysStr(inEl.value, nights);
   outEl.setAttribute("readonly", "readonly"); // lock user edits
   outEl.dispatchEvent(new Event("change", { bubbles: true }));
 }
 document.addEventListener("change", (e) => {
   if (e.target === pkgEl || e.target === inEl) updateCheckout();
 });
 // Initialize once on load
 setTimeout(updateCheckout, 600);
})();