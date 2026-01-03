document.addEventListener("DOMContentLoaded", function () {
 var field = document.getElementById("control118588287");
 if (!field) return;
 var toCaps = function () {
   this.value = (this.value || "").toUpperCase();
 };
 field.addEventListener("input", toCaps);
 field.addEventListener("change", toCaps);
 field.addEventListener("blur", toCaps);
 // If the field is prefilled by URL, force caps on load too:
 toCaps.call(field);
});