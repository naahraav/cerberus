/* Cerberus AI · chain/publish
   The publish path: connecting a wallet, switching to the selected BOT Chain
   network, and writing the pitch and scores to the published record ledger. A
   confirmation step shows exactly what becomes public before the signature.
   The record's on-chain destination is fixed by the site, so the person using
   the page only ever connects a wallet and confirms. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var getElement = dom.getElement;
  var escapeHtml = dom.escapeHtml;
  var shortAddress = dom.shortAddress;
  var explorerUrl = dom.explorerUrl;

  var config = window.CERBERUS_CONFIG || { networks: {} };
  var abi = window.CERBERUS_ABI || [];

  var liveState = {
    wallet: null,
    provider: null,
    signer: null,
    contract: null,
    account: "",
    ready: false,
    connecting: false,
    confirming: false,
    busy: false
  };

  var networkSelect = getElement("network-select");

  var refreshRecords = function () {};
  var onConfigChange = function () {};
  var announcedMetaMask = null;
  var connectionAttempt = 0;
  var connectionTimer = null;
  var pendingConnector = false;

  function injectedWallet() {
    if (announcedMetaMask) return announcedMetaMask;
    var legacy = window.ethereum;
    if (legacy && Array.isArray(legacy.providers)) {
      return legacy.providers.find(function (provider) {
        return provider.isMetaMask && !provider.isBraveWallet;
      }) || null;
    }
    return legacy && legacy.isMetaMask && !legacy.isBraveWallet ? legacy : null;
  }

  function findMetaMask() {
    if (injectedWallet()) return Promise.resolve(injectedWallet());
    return new Promise(function (resolve) {
      var timer;
      function onAnnouncement(event) {
        var detail = event.detail;
        if (detail && detail.info && detail.info.rdns === "io.metamask" && detail.provider) {
          announcedMetaMask = detail.provider;
          finish(detail.provider);
        }
      }
      function finish(provider) {
        clearTimeout(timer);
        window.removeEventListener("eip6963:announceProvider", onAnnouncement);
        resolve(provider || injectedWallet());
      }
      window.addEventListener("eip6963:announceProvider", onAnnouncement);
      timer = setTimeout(function () { finish(null); }, 700);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    });
  }

  async function isBrave() {
    try {
      return Boolean(navigator.brave && await navigator.brave.isBrave());
    } catch (_) {
      return false;
    }
  }

  function walletModule() {
    if (!window.CerberusMetaMask) {
      throw new Error("The MetaMask connector did not load. Reload the page and try again.");
    }
    return window.CerberusMetaMask;
  }

  function networkKey() {
    return networkSelect ? networkSelect.value : "testnet";
  }

  function configuredNetwork() {
    return config.networks[networkKey()] || config.networks.testnet;
  }

  function isConfiguredAddress(address) {
    return Boolean(window.ethers && address && window.ethers.isAddress(address));
  }

  // The record ledger address is fixed per network by the site. There is no
  // user-entered address: the page only needs the published record location.
  function storedAddress() {
    return "";
  }

  function effectiveAddress(network) {
    return storedAddress() || network.contractAddress;
  }

  function liveContractAddress(network) {
    var address = effectiveAddress(network);
    return isConfiguredAddress(address) ? address : "";
  }

  function isLiveConfigured() {
    return Boolean(window.ethers) && Boolean(liveContractAddress(configuredNetwork()));
  }

  /* Settings restore (network) */

  function restoreNetwork() {
    if (!networkSelect) {
      return;
    }
    var saved = window.CerberusStore.get(config.storageKey + "-network");
    if (saved === "testnet" || saved === "mainnet") {
      networkSelect.value = saved;
    } else {
      networkSelect.value = (config.activeNetwork === "mainnet" || config.activeNetwork === "testnet")
        ? config.activeNetwork
        : "testnet";
    }
  }

  // Kept as a no-op: the address field was removed from the site. The record
  // destination comes only from the configured network.
  function updateAddressField() {
    updateExplorerLink();
  }

  function updateExplorerLink() {
    var link = getElement("address-explorer-link");
    if (!link) {
      return;
    }
    var network = configuredNetwork();
    var address = liveContractAddress(network);
    if (address) {
      link.href = explorerUrl(network, "address", address);
      link.textContent = "Open the record ledger on " + network.explorerUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  }

  // Retained for compatibility with older wiring; it no longer reads a field.
  function setDeployedAddress(event) {
    if (event) {
      event.preventDefault();
    }
    updateExplorerLink();
    resetLiveState();
    refreshRecords();
    onConfigChange();
  }

  /* Wallet */

  function syncLiveUi(preserveStatus) {
    var localHelp = getElement("local-wallet-help");
    if (localHelp) localHelp.hidden = window.location.protocol !== "file:";
    var connect = getElement("connect-wallet");
    if (connect) {
      connect.disabled = liveState.connecting || liveState.ready || !window.ethers;
    }
    var qrConnect = getElement("connect-wallet-qr");
    if (qrConnect) qrConnect.disabled = liveState.connecting || liveState.ready || !window.ethers;
    var stopConnect = getElement("stop-wallet-connect");
    if (stopConnect) stopConnect.hidden = !liveState.connecting;
    var wristband = getElement("wristband");
    if (wristband) {
      wristband.hidden = !liveState.ready;
    }
    var account = getElement("live-account");
    if (account) {
      account.textContent = liveState.ready
        ? shortAddress(liveState.account) + " on " + configuredNetwork().name
        : "";
      account.title = liveState.ready ? liveState.account : "";
    }
    if (preserveStatus) {
      onConfigChange();
      return;
    }
    if (liveState.ready) {
      dom.setSetupLabel("Connected");
      dom.setStatus("Connected as " + shortAddress(liveState.account) + " on " + configuredNetwork().name + ".", "ready");
    } else {
      dom.setSetupLabel("Not connected");
      if (!window.ethers) {
        dom.setStatus("The wallet library did not load. Pitching and the verdict still work. Reload to publish.", "error");
      } else if (window.location.protocol === "file:" && !injectedWallet()) {
        dom.setStatus("This page is open as a local HTML file. Open it through http://localhost:3000 so the wallet extension can connect.", "error");
      } else if (!isLiveConfigured()) {
        dom.setStatus("Publishing is not available on " + configuredNetwork().name + " yet. Everything else works without it.", "pending");
      } else {
        dom.setStatus("Connect the MetaMask extension to publish, or choose MetaMask mobile / QR.", "pending");
      }
    }
    onConfigChange();
  }

  function resetLiveState() {
    connectionAttempt += 1;
    clearTimeout(connectionTimer);
    connectionTimer = null;
    if (pendingConnector && window.CerberusMetaMask) {
      Promise.resolve().then(function () { return window.CerberusMetaMask.disconnect(); }).catch(function () {});
    }
    pendingConnector = false;
    if (liveState.wallet && typeof liveState.wallet.removeListener === "function") {
      liveState.wallet.removeListener("accountsChanged", onAccountsChanged);
      liveState.wallet.removeListener("chainChanged", onChainChanged);
    }
    liveState.wallet = null;
    liveState.provider = null;
    liveState.signer = null;
    liveState.contract = null;
    liveState.account = "";
    liveState.ready = false;
    liveState.connecting = false;
    syncLiveUi();
  }

  function stopWalletConnect(timedOut) {
    if (!liveState.connecting) return;
    var closeConnector = pendingConnector;
    connectionAttempt += 1;
    clearTimeout(connectionTimer);
    connectionTimer = null;
    pendingConnector = false;
    liveState.connecting = false;
    if (closeConnector && window.CerberusMetaMask) {
      Promise.resolve().then(function () { return window.CerberusMetaMask.disconnect(); }).catch(function () {});
    }
    syncLiveUi(true);
    dom.setStatus(timedOut
      ? "MetaMask did not answer. Check its extension popup, then try again."
      : "Stopped waiting. Dismiss any open MetaMask request before trying again.", "pending");
  }

  function readableError(error) {
    if (!error) {
      return "Something went wrong. Check the wallet and try again.";
    }
    var message = String(error.shortMessage || error.reason || error.message || "");
    var lower = message.toLowerCase();
    if (error.code === 4001 || error.code === "ACTION_REJECTED" || lower.indexOf("user rejected") !== -1) {
      return "The wallet request was cancelled. Nothing was published.";
    }
    if (error.code === "BRAVE_METAMASK_HIDDEN") {
      return "Brave cannot see the MetaMask extension. Set Default Ethereum wallet to Extensions (no fallback) in brave://settings/web3, then reload this page. You can also use the QR option below.";
    }
    if (error.code === "LOCAL_FILE") {
      return "MetaMask is not available on this local HTML file. Run npm run dev in the project folder, then open http://localhost:3000 in Brave.";
    }
    if (error.code === -32002 || lower.indexOf("already pending") !== -1) {
      return "A MetaMask request is already open. Open the extension and approve or dismiss it, then try again.";
    }
    if (error.code === 4902 || (lower.indexOf("chain") !== -1 && lower.indexOf("not found") !== -1)) {
      return "This wallet does not have the selected BOT Chain network yet. Add it, then connect again.";
    }
    if (lower.indexOf("wrong network") !== -1) {
      return "The wallet is on a different network. Switch to " + configuredNetwork().name + " and connect again.";
    }
    if (lower.indexOf("emptytitle") !== -1) {
      return "Add an idea name before publishing.";
    }
    if (lower.indexOf("titletoolong") !== -1) {
      return "The idea name is longer than the record allows.";
    }
    if (lower.indexOf("emptydescription") !== -1) {
      return "Add a pitch before publishing.";
    }
    if (lower.indexOf("descriptiontoolong") !== -1) {
      return "The pitch is longer than the record allows.";
    }
    if (lower.indexOf("scoreoutofrange") !== -1) {
      return "A score fell outside the record range. Run the verdict again.";
    }
    if (lower.indexOf("recorddoesnotexist") !== -1) {
      return "That record does not exist on the published ledger.";
    }
    if (error.code === "CALL_EXCEPTION") {
      return "The published ledger rejected that action. Try again in a moment.";
    }
    if (error.code === "INSUFFICIENT_FUNDS") {
      return "The wallet does not have enough BOT to pay the transaction fee.";
    }
    return message || "The wallet request failed. Check the network and try again.";
  }

  async function ensureConfiguredNetwork(wallet, network) {
    var current = await wallet.request({ method: "eth_chainId" });
    if (Number(current) === network.chainId) {
      return;
    }
    try {
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: network.chainIdHex }]
      });
    } catch (switchError) {
      if (switchError.code !== 4902) {
        throw switchError;
      }
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: network.chainIdHex,
          chainName: network.name,
          nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
          rpcUrls: [network.rpcUrl],
          blockExplorerUrls: [network.explorerUrl]
        }]
      });
    }
    var updated = await wallet.request({ method: "eth_chainId" });
    if (Number(updated) !== network.chainId) {
      throw new Error("The wallet is on a different network. Switch to " + network.name + " and try again.");
    }
  }

  async function connectWallet(mode) {
    if (!window.ethers) {
      dom.setStatus("The wallet library did not load. Reload the page to connect.", "error");
      return;
    }
    if (liveState.connecting || liveState.ready) {
      return;
    }
    var network = configuredNetwork();
    liveState.connecting = true;
    pendingConnector = false;
    var attempt = ++connectionAttempt;
    connectionTimer = setTimeout(function () { stopWalletConnect(true); }, 45000);
    syncLiveUi(true);
    try {
      dom.setStatus(mode === "qr"
        ? "Opening MetaMask mobile / QR for " + network.name + "."
        : "Waiting for MetaMask extension approval on " + network.name + ".", "pending");
      var wallet = mode === "qr" ? null : await findMetaMask();
      if (attempt !== connectionAttempt) return;
      if (wallet) {
        await wallet.request({ method: "eth_requestAccounts" });
      } else {
        if (window.location.protocol === "file:") {
          var localFile = new Error("Wallet extension is unavailable on a local file.");
          localFile.code = "LOCAL_FILE";
          throw localFile;
        }
        if (mode !== "qr" && await isBrave()) {
          if (attempt !== connectionAttempt) return;
          var hidden = new Error("MetaMask is hidden by Brave.");
          hidden.code = "BRAVE_METAMASK_HIDDEN";
          throw hidden;
        }
        pendingConnector = true;
        wallet = await walletModule().connect(network.chainIdHex);
      }
      if (attempt !== connectionAttempt) return;
      await ensureConfiguredNetwork(wallet, network);
      if (attempt !== connectionAttempt) return;
      var provider = new window.ethers.BrowserProvider(wallet);
      var signer = await provider.getSigner();
      if (attempt !== connectionAttempt) return;
      liveState.wallet = wallet;
      liveState.provider = provider;
      liveState.signer = signer;
      liveState.account = await signer.getAddress();
      liveState.ready = true;
      var address = liveContractAddress(network);
      if (address) {
        liveState.contract = new window.ethers.Contract(address, abi, signer);
      }
      if (typeof wallet.on === "function") {
        wallet.on("accountsChanged", onAccountsChanged);
        wallet.on("chainChanged", onChainChanged);
      }
      syncLiveUi();
    } catch (error) {
      if (attempt !== connectionAttempt) return;
      resetLiveState();
      dom.setStatus(readableError(error), "error");
    } finally {
      if (attempt === connectionAttempt) {
        clearTimeout(connectionTimer);
        connectionTimer = null;
        pendingConnector = false;
        liveState.connecting = false;
        syncLiveUi(true);
      }
    }
  }

  function openManualAddress(event) {
    if (event) event.preventDefault();
    var input = getElement("manual-wallet-address");
    var status = getElement("manual-wallet-status");
    if (!input || !status) return;
    var raw = input.value.trim();
    if (!window.ethers || !window.ethers.isAddress(raw)) {
      status.textContent = "Enter a valid 0x wallet address (42 characters).";
      input.setAttribute("aria-invalid", "true");
      return;
    }
    input.removeAttribute("aria-invalid");
    var address = window.ethers.getAddress(raw);
    var url = explorerUrl(configuredNetwork(), "address", address);
    window.open(url, "_blank", "noopener,noreferrer");
    status.textContent = "Opened " + shortAddress(address) + " on the network explorer. Publishing still needs a wallet signature.";
  }

  async function disconnectWallet() {
    resetLiveState();
    if (window.CerberusMetaMask) {
      try { await window.CerberusMetaMask.disconnect(); } catch (_) {}
    }
    dom.setStatus("Disconnected. Connect again any time you want to publish.", "pending");
    refreshRecords();
  }

  function onAccountsChanged(accounts) {
    if (!accounts.length) {
      resetLiveState();
      dom.setStatus("Wallet disconnected. Connect again when you are ready.", "pending");
    } else if (liveState.ready && accounts[0].toLowerCase() !== liveState.account.toLowerCase()) {
      resetLiveState();
      dom.setStatus("The wallet account changed. Connect again to publish with it.", "pending");
    }
  }

  function onChainChanged() {
    resetLiveState();
    dom.setStatus("The wallet network changed. Connect again on the selected network.", "pending");
  }

  function bindWalletListeners() {
    if (window.__cerberusWalletListenersInstalled) {
      return;
    }
    window.__cerberusWalletListenersInstalled = true;
    window.addEventListener("eip6963:announceProvider", function (event) {
      var detail = event.detail;
      if (detail && detail.info && detail.info.rdns === "io.metamask" && detail.provider) {
        announcedMetaMask = detail.provider;
        syncLiveUi(liveState.connecting);
      }
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.addEventListener("ethereum#initialized", syncLiveUi, { once: true });
  }

  /* Confirmation dialog */

  function openConfirmDialog(pitch, verdict) {
    return new Promise(function (resolve) {
      var dialog = getElement("publish-confirm");
      if (!dialog) {
        resolve(false);
        return;
      }
      var body = getElement("publish-confirm-body");
      if (body) {
        body.innerHTML =
          "<p class='confirm-lead'>This writes the following to the public BOT Chain ledger on " +
            escapeHtml(configuredNetwork().name) + ". It becomes public and permanent.</p>" +
          "<dl class='confirm-list'>" +
            "<dt>Idea name</dt><dd>" + escapeHtml(pitch.title) + "</dd>" +
            "<dt>The pitch</dt><dd>" + escapeHtml(pitch.description) + "</dd>" +
            "<dt>Scores</dt><dd>Joko " + verdict.scrath.score + " · Kowi " + verdict.fervent.score +
              " · Dodo " + verdict.warden.score + " · Total " + verdict.overall + "</dd>" +
            "<dt>Wallet</dt><dd>" + escapeHtml(shortAddress(liveState.account)) + "</dd>" +
          "</dl>";
      }
      var checkbox = getElement("publish-confirm-ack");
      var confirmButton = getElement("publish-confirm-go");
      if (checkbox) {
        checkbox.checked = false;
      }
      if (confirmButton) {
        confirmButton.disabled = true;
      }

      var settled = false;
      var finish = function (approved) {
        if (settled) return;
        settled = true;
        dialog.removeEventListener("close", onClose);
        if (checkbox) {
          checkbox.removeEventListener("change", onAck);
        }
        if (confirmButton) {
          confirmButton.removeEventListener("click", onGo);
        }
        var cancel = getElement("publish-confirm-cancel");
        if (cancel) {
          cancel.removeEventListener("click", onCancel);
        }
        if (dialog.open) dialog.close();
        dialog.hidden = true;
        resolve(approved);
      };
      var onClose = function () {
        finish(false);
      };
      var onAck = function () {
        if (confirmButton) {
          confirmButton.disabled = !checkbox.checked;
        }
      };
      var onGo = function () {
        if (!checkbox || !checkbox.checked) {
          return;
        }
        finish(true);
      };
      var onCancel = function () {
        finish(false);
      };

      if (checkbox) {
        checkbox.addEventListener("change", onAck);
      }
      if (confirmButton) {
        confirmButton.addEventListener("click", onGo);
      }
      var cancel = getElement("publish-confirm-cancel");
      if (cancel) {
        cancel.addEventListener("click", onCancel);
      }
      dialog.addEventListener("close", onClose);
      dialog.hidden = false;
      try {
        if (!dialog.open) dialog.showModal();
      } catch (_) {
        finish(false);
        return;
      }
      if (checkbox) {
        checkbox.focus();
      }
    });
  }

  /* Publish */

  function renderPublishProof(hash) {
    var proof = getElement("publish-proof");
    proof.hidden = false;
    var network = configuredNetwork();
    proof.textContent = "";
    var anchor = document.createElement("a");
    anchor.className = "text-link";
    anchor.href = explorerUrl(network, "tx", hash);
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = "Open the transaction on the explorer";
    proof.appendChild(anchor);
  }

  async function doPublish(pitch, verdict) {
    if (liveState.busy) {
      return;
    }
    if (!liveState.ready) {
      dom.setPublishMessage("Connect a wallet before publishing.", "error");
      return;
    }
    var network = configuredNetwork();
    var address = liveContractAddress(network);
    if (!address) {
      dom.setPublishMessage("Publishing is not available on " + network.name + " yet.", "error");
      return;
    }
    if (!liveState.contract) {
      liveState.contract = new window.ethers.Contract(address, abi, liveState.signer);
    }
    liveState.busy = true;
    var button = getElement("publish-record");
    if (button) {
      button.disabled = true;
      button.classList.add("is-busy");
      button.textContent = "Publishing...";
    }
    try {
      dom.setPublishMessage("Waiting for you to approve the transaction in your wallet.", "");
      var transaction = await liveState.contract.recordRecord(
        pitch.title,
        pitch.description,
        verdict.scrath.score,
        verdict.fervent.score,
        verdict.warden.score,
        verdict.overall
      );
      dom.setPublishMessage("Transaction sent. Waiting for the network to confirm it.", "");
      var receipt = await transaction.wait();
      dom.setPublishMessage("Published on " + network.name + ". Anyone with the link can open it.", "success");
      renderPublishProof(receipt.hash || transaction.hash);
      refreshRecords();
    } catch (error) {
      dom.setPublishMessage(readableError(error), "error");
    } finally {
      liveState.busy = false;
      if (button) {
        button.disabled = false;
        button.classList.remove("is-busy");
        button.textContent = "Publish the record";
      }
    }
  }

  async function publishRecord(pitch, verdict) {
    if (liveState.confirming || liveState.busy) return;
    if (!pitch || !verdict) {
      dom.setPublishMessage("Run the verdict before publishing.", "error");
      return;
    }
    if (!liveState.ready) {
      dom.setPublishMessage("Connect MetaMask before publishing.", "error");
      var connectButton = getElement("connect-wallet");
      if (connectButton) connectButton.focus();
      return;
    }
    if (!liveContractAddress(configuredNetwork())) {
      dom.setPublishMessage("Publishing is not available on " + configuredNetwork().name + " yet.", "error");
      if (networkSelect) networkSelect.focus();
      return;
    }
    liveState.confirming = true;
    try {
      if (await openConfirmDialog(pitch, verdict)) await doPublish(pitch, verdict);
    } finally {
      liveState.confirming = false;
    }
  }

  // The publish toggle carries a text label and an arrow icon. Update only the
  // label so opening or closing the panel never wipes the icon markup.
  function setPublishToggleLabel(open) {
    var toggle = getElement("publish-toggle");
    if (!toggle) {
      return;
    }
    var label = toggle.querySelector("[data-publish-toggle-label]");
    var text = open ? "Hide publish setup" : "Publish this record";
    if (label) {
      label.textContent = text;
    } else {
      toggle.textContent = text;
    }
    toggle.setAttribute("aria-expanded", String(open));
  }

  function togglePublishPanel() {
    var panel = getElement("publish-panel");
    var toggle = getElement("publish-toggle");
    if (!panel || !toggle) {
      return;
    }
    var open = panel.hidden;
    panel.hidden = !open;
    setPublishToggleLabel(open);
    if (open) {
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function getContext() {
    return {
      network: configuredNetwork(),
      address: liveContractAddress(configuredNetwork()),
      account: liveState.account,
      ready: liveState.ready,
      hasEthers: Boolean(window.ethers),
      hasWallet: Boolean(injectedWallet())
    };
  }

  window.CerberusPublish = Object.freeze({
    restoreNetwork: restoreNetwork,
    updateAddressField: updateAddressField,
    updateExplorerLink: updateExplorerLink,
    setDeployedAddress: setDeployedAddress,
    connectWallet: connectWallet,
    stopWalletConnect: stopWalletConnect,
    openManualAddress: openManualAddress,
    disconnectWallet: disconnectWallet,
    bindWalletListeners: bindWalletListeners,
    publishRecord: publishRecord,
    togglePublishPanel: togglePublishPanel,
    setPublishToggleLabel: setPublishToggleLabel,
    isLiveConfigured: isLiveConfigured,
    liveContractAddress: liveContractAddress,
    configuredNetwork: configuredNetwork,
    networkKey: networkKey,
    readableError: readableError,
    syncLiveUi: syncLiveUi,
    resetLiveState: resetLiveState,
    getContext: getContext,
    setRefreshRecords: function (fn) {
      refreshRecords = fn || function () {};
    },
    setOnConfigChange: function (fn) {
      onConfigChange = fn || function () {};
    }
  });
})();
