/* Cerberus AI · chain/records
   The read-only records wall: reads the contract with a public provider, shows
   honest empty, loading, and error states, and builds the share links. It opens
   without a wallet and never asks for approval. */

(function () {
  "use strict";

  var dom = window.CerberusDom;
  var getElement = dom.getElement;
  var escapeHtml = dom.escapeHtml;
  var shortAddress = dom.shortAddress;
  var explorerUrl = dom.explorerUrl;
  var formatDate = dom.formatDate;

  var config = window.CERBERUS_CONFIG || { networks: {} };
  var abi = window.CERBERUS_ABI || [];
  var RENDER_LIMIT = 30;

  var publish = window.CerberusPublish;
  var networkSelect = getElement("network-select");
  var sharedRecord = null;

  function configuredNetwork() {
    return publish.configuredNetwork();
  }

  function readOnlyProvider(network) {
    if (!window.ethers) {
      return null;
    }
    try {
      return new window.ethers.JsonRpcProvider(network.rpcUrl, network.chainId);
    } catch (error) {
      return null;
    }
  }

  function recordFromDetail(id, detail) {
    return {
      id: id,
      proposer: String(detail[0]),
      title: String(detail[1]),
      description: String(detail[2]),
      scrath: Number(detail[3]),
      fervent: Number(detail[4]),
      warden: Number(detail[5]),
      overall: Number(detail[6]),
      recordedAt: Number(detail[7])
    };
  }

  function recordShareUrl(networkKeyValue, id) {
    return window.location.origin + window.location.pathname + "?record=" + id + "&network=" + networkKeyValue;
  }

  function recordCard(record, network, isShared) {
    var shareHint = isShared
      ? "<span>Read-only shared record</span>"
      : "<button class='button button--quiet' type='button' data-action='copy-record' data-id='" + record.id + "' data-network='" + network.key + "'>Copy link</button>";
    var ledger = publish.liveContractAddress(network);
    var ledgerLink = ledger
      ? "<a href='" + explorerUrl(network, "address", ledger) + "' target='_blank' rel='noreferrer'>Open the ledger</a>"
      : "";
    return (
      "<article class='record-card'>" +
        "<div class='record-card__top'>" +
          "<div>" +
            "<span class='detail-label'>Record #" + record.id + " on " + escapeHtml(network.name) + "</span>" +
            "<h3>" + escapeHtml(record.title) + "</h3>" +
          "</div>" +
          "<span class='record-card__overall'>" + record.overall + "<span> /100</span></span>" +
        "</div>" +
        "<p class='record-card__description'>" + escapeHtml(record.description) + "</p>" +
        "<div class='record-card__scores'>" +
          "<span class='record-score' style='--head:var(--ember)'><strong>Joko</strong> " + record.scrath + "</span>" +
          "<span class='record-score' style='--head:var(--flame)'><strong>Kowi</strong> " + record.fervent + "</span>" +
          "<span class='record-score' style='--head:var(--moss)'><strong>Dodo</strong> " + record.warden + "</span>" +
        "</div>" +
        "<div class='record-card__meta'>" +
          "<span>By " + shortAddress(record.proposer) + "</span>" +
          "<span>Recorded " + formatDate(record.recordedAt) + "</span>" +
          ledgerLink +
          shareHint +
        "</div>" +
      "</article>"
    );
  }

  function recordsEmptyState(title, message) {
    return "<div class='empty-state'><strong>" + escapeHtml(title) + "</strong><p>" + escapeHtml(message) + "</p></div>";
  }

  // The empty state shown when publishing is not configured. It stays a calm
  // signpost: nothing is wrong, the wall is just waiting for its first record.
  function recordsNoContractState() {
    return (
      "<div class='empty-state'>" +
        "<strong>Nothing published yet.</strong>" +
        "<p>Published pitches and scores will appear here.</p>" +
      "</div>"
    );
  }

  function renderRecords(records, network, mode) {
    var list = getElement("records-list");
    if (!list) {
      return;
    }
    if (!records.length) {
      list.innerHTML = recordsEmptyState(
        "No records yet.",
        "Published pitches and scores on " + network.name + " will appear here."
      );
      dom.setRecordsStatus("No records published on " + network.name + " yet.");
      return;
    }
    var isShared = mode === "shared";
    if (isShared) {
      dom.setRecordsStatus("Showing the shared record #" + records[0].id + " on " + network.name + ".");
    } else {
      dom.setRecordsStatus("Showing the " + records.length + " most recent record" + (records.length === 1 ? "" : "s") + " on " + network.name + ".");
    }
    list.innerHTML = records.map(function (record) {
      return recordCard(record, network, isShared);
    }).join("");
  }

  async function loadRecords(specificId) {
    var list = getElement("records-list");
    if (!list) {
      return;
    }
    var network = configuredNetwork();
    var address = publish.liveContractAddress(network);
    if (!window.ethers || !address) {
      list.innerHTML = recordsNoContractState();
      dom.setRecordsStatus("Read-only. Nothing published on " + network.name + " to show yet.");
      return;
    }
    var provider = readOnlyProvider(network);
    if (!provider) {
      list.innerHTML = recordsEmptyState("Could not connect.", "A read-only connection to the network could not be created. Check the network and refresh.");
      dom.setRecordsStatus("Read failed. Check the network and refresh.");
      return;
    }
    var contract = new window.ethers.Contract(address, abi, provider);
    list.innerHTML = recordsEmptyState("Loading records.", "Reading the published records. This never asks for wallet approval.");
    dom.setRecordsStatus("Reading the published records.");
    try {
      var count = Number(await contract.recordCount());
      var records = [];
      if (specificId !== undefined && specificId !== null) {
        var detail = await contract.getRecord(specificId);
        records.push(recordFromDetail(specificId, detail));
      } else {
        var start = Math.max(0, count - RENDER_LIMIT);
        for (var id = count - 1; id >= start; id -= 1) {
          var item = await contract.getRecord(id);
          records.push(recordFromDetail(id, item));
        }
      }
      renderRecords(records, network, specificId !== undefined && specificId !== null ? "shared" : "fresh");
    } catch (error) {
      var message = publish.readableError(error);
      list.innerHTML = recordsEmptyState("Could not read the wall.", message);
      dom.setRecordsStatus("Read failed. " + message);
    }
  }

  function refresh() {
    loadRecords(sharedRecord ? sharedRecord.id : undefined);
  }

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (error) {
      dom.setRecordsStatus("Copy is blocked here. Select the link text and copy it manually.");
    }
    document.body.removeChild(textarea);
  }

  function copyText(text, successMessage) {
    var done = function () {
      dom.setRecordsStatus(successMessage);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function handleRecordsAction(event) {
    var deploy = event.target.closest("button[data-action='open-deploy-guide']");
    if (deploy) {
      if (window.CerberusGuide) {
        window.CerberusGuide.open();
      }
      return;
    }
    var button = event.target.closest("button[data-action='copy-record']");
    if (!button) {
      return;
    }
    copyText(recordShareUrl(button.dataset.network, button.dataset.id), "Link copied. Anyone who opens it sees this record.");
  }

  function handleSharedRecord() {
    var params = new URLSearchParams(window.location.search);
    var rawId = params.get("record");
    if (rawId === null || rawId === "") {
      return false;
    }
    var id = Number(rawId);
    if (!Number.isFinite(id) || id < 0) {
      return false;
    }
    var requested = params.get("network");
    var key = (requested === "testnet" || requested === "mainnet")
      ? requested
      : (config.activeNetwork === "mainnet" ? "mainnet" : "testnet");
    if (networkSelect) {
      networkSelect.value = key;
    }
    sharedRecord = { id: id, networkKey: key };
    publish.updateExplorerLink();
    var section = getElement("records");
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    loadRecords(id);
    return true;
  }

  window.CerberusRecords = Object.freeze({
    loadRecords: loadRecords,
    refresh: refresh,
    bindAction: handleRecordsAction,
    handleSharedRecord: handleSharedRecord,
    isShared: function () {
      return Boolean(sharedRecord);
    }
  });
})();
