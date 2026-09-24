/* Cerberus AI · core/guide
   The publish explainer: what goes on-chain, what stays off, and how simple
   publishing is for the person using the site. It never mentions how the site
   is built, deployed, or compiled; publishing is only ever "connect a wallet
   and confirm". No fabricated addresses or hashes. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var getElement = dom.getElement;

  // Three plain steps a visitor actually performs. No tools, no setup.
  var PUBLISH_STEPS = [
    "Pick the network: BOT Chain testnet or mainnet.",
    "Connect your wallet. Your wallet pays the network fee.",
    "Confirm the record. It is written to the public BOT Chain ledger, stamped with your wallet as the proposer."
  ];

  function renderSteps() {
    var list = getElement("deploy-guide-steps");
    if (!list) {
      return;
    }
    list.innerHTML = PUBLISH_STEPS.map(function (step, index) {
      return "<li><span class='deploy-step__num' aria-hidden='true'>" + (index + 1) + "</span><span>" + step + "</span></li>";
    }).join("");
  }

  function open() {
    var dialog = getElement("deploy-guide");
    if (!dialog) {
      return;
    }
    var header = document.querySelector(".site-header");
    if (header && header.classList.contains("is-menu-open")) {
      header.classList.remove("is-menu-open");
      var menuToggle = document.querySelector(".menu-toggle");
      if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
    }
    renderSteps();
    dialog.hidden = false;
    if (typeof dialog.showModal === "function" && !dialog.open) {
      dialog.showModal();
    }
    var close = getElement("deploy-guide-close");
    if (close) {
      close.focus();
    }
  }

  function close() {
    var dialog = getElement("deploy-guide");
    if (dialog) {
      dialog.hidden = true;
      if (typeof dialog.close === "function" && dialog.open) {
        dialog.close();
      }
    }
  }

  function bind() {
    var openers = document.querySelectorAll("[data-action='open-deploy-guide']");
    openers.forEach(function (opener) {
      opener.addEventListener("click", function (event) {
        event.preventDefault();
        open();
      });
    });
    var closeButton = getElement("deploy-guide-close");
    if (closeButton) {
      closeButton.addEventListener("click", close);
    }
    var dialog = getElement("deploy-guide");
    if (dialog) {
      dialog.addEventListener("close", function () {
        dialog.hidden = true;
      });
      // A click on the backdrop (outside the inner panel) closes the drawer.
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) {
          close();
        }
      });
    }
  }

  window.CerberusGuide = Object.freeze({
    open: open,
    close: close,
    bind: bind
  });
})();
