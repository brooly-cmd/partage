/* =========================================================
   Partage éphémère — installer le site comme une app
   (l'encart iPhone, lui, est géré dans ecrans.js)
   ========================================================= */

// Le « portier » : demandé par Chrome et Edge pour proposer l'installation
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

// Bouton « Installer l'app » (PC) : il apparaît seulement si le navigateur le permet
let demandeInstallation = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // on garde la proposition pour notre bouton
  demandeInstallation = e;
  $("btn-installer").hidden = false;
});

$("btn-installer").addEventListener("click", async () => {
  if (!demandeInstallation) return;
  demandeInstallation.prompt();
  await demandeInstallation.userChoice;
  demandeInstallation = null; // une proposition ne sert qu'une fois
  $("btn-installer").hidden = true;
});

window.addEventListener("appinstalled", () => ($("btn-installer").hidden = true));
