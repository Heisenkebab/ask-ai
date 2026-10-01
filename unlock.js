import { unlockVault } from "./vault.js";

const $ = (id) => document.getElementById(id);

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error").textContent = "Unlocking…";
  try {
    await unlockVault($("password").value);
    window.close();
  } catch (err) {
    $("error").textContent = err.message;
    $("password").select();
  }
});
