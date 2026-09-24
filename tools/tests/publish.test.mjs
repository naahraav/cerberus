import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../src/js/chain/publish.js", import.meta.url), "utf8");
const pitch = { title: "A practical idea", description: "A useful pitch" };
const verdict = {
  scrath: { score: 70 }, fervent: { score: 75 }, warden: { score: 80 }, overall: 75,
};

function setup({ wallet = null, protocol = "http:", brave = false, onRecord } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        hidden: false, disabled: false, textContent: "", checked: false, open: false,
        value: id === "network-select" ? "testnet" : "",
        focusCount: 0, closeCount: 0, showCount: 0,
        classList: { add() {}, remove() {} },
        focus() { this.focusCount += 1; },
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
        fire(type) { listeners.get(type)?.(); },
        showModal() { this.open = true; this.showCount += 1; },
        close() { this.open = false; this.closeCount += 1; this.fire("close"); },
        appendChild() {},
        setAttribute() {}, removeAttribute() {},
      });
    }
    return elements.get(id);
  };
  const statuses = [];
  const publishMessages = [];
  const listeners = new Map();
  const window = {
    ethereum: wallet,
    location: { protocol },
    CerberusDom: {
      getElement: element,
      escapeHtml: String,
      shortAddress: (value) => value.slice(0, 6),
      explorerUrl: (network, type, value) => `${network.explorerUrl}/${type}/${value}`,
      setStatus: (message) => statuses.push(message),
      setSetupLabel() {},
      setPublishMessage: (message) => publishMessages.push(message),
    },
    CERBERUS_CONFIG: {
      networks: { testnet: {
        name: "BOT Chain Testnet", chainId: 968, chainIdHex: "0x3c8",
        contractAddress: "0x1111111111111111111111111111111111111111",
        rpcUrl: "https://rpc.example", explorerUrl: "https://scan.example",
      } },
    },
    CERBERUS_ABI: [],
    ethers: {
      isAddress: (value) => /^0x[0-9a-fA-F]{40}$/.test(value),
      BrowserProvider: class { async getSigner() { return { getAddress: async () => "0x2222222222222222222222222222222222222222" }; } },
      Contract: class { async recordRecord() {
        onRecord?.();
        return { hash: "0x123", wait: async () => ({ hash: "0x123" }) };
      } },
    },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); },
  };
  const navigator = brave ? { brave: { isBrave: async () => true } } : {};
  runInNewContext(source, { window, document: { getElementById: element, createElement: () => ({}) }, navigator, Event, setTimeout, clearTimeout, Number, Promise });
  return { api: window.CerberusPublish, window, element, statuses, publishMessages };
}

function provider({ pending = false } = {}) {
  let answer;
  const accountRequest = pending ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve([]);
  return {
    wallet: {
      isMetaMask: true,
      request: ({ method }) => method === "eth_requestAccounts" ? accountRequest : Promise.resolve("0x3c8"),
      on() {}, removeListener() {},
    },
    resolve: () => answer?.([]),
  };
}

test("publishing without a wallet leaves the modal closed and focuses Connect", async () => {
  const { api, element, publishMessages } = setup();
  await api.publishRecord(pitch, verdict);
  assert.equal(element("publish-confirm").showCount, 0);
  assert.equal(element("connect-wallet").focusCount, 1);
  assert.match(publishMessages.at(-1), /Connect MetaMask/);
});

test("cancel, Escape, and confirm each close the native dialog", async () => {
  let writes = 0;
  const { wallet } = provider();
  const { api, element } = setup({ wallet, onRecord: () => { writes += 1; } });
  await api.connectWallet();
  const dialog = element("publish-confirm");

  const cancelled = api.publishRecord(pitch, verdict);
  element("publish-confirm-cancel").fire("click");
  await cancelled;
  assert.equal(dialog.open, false);
  assert.equal(dialog.closeCount, 1);
  assert.equal(writes, 0);

  const escaped = api.publishRecord(pitch, verdict);
  dialog.close();
  await escaped;
  assert.equal(dialog.open, false);
  assert.equal(writes, 0);

  const confirmed = api.publishRecord(pitch, verdict);
  const duplicate = api.publishRecord(pitch, verdict);
  element("publish-confirm-ack").checked = true;
  element("publish-confirm-ack").fire("change");
  element("publish-confirm-go").fire("click");
  await Promise.all([confirmed, duplicate]);
  assert.equal(dialog.open, false);
  assert.equal(writes, 1);
});

test("stopping a pending MetaMask request ignores its late answer", async () => {
  const pending = provider({ pending: true });
  const { api, element } = setup({ wallet: pending.wallet });
  const connection = api.connectWallet();
  assert.equal(element("stop-wallet-connect").hidden, false);
  api.stopWalletConnect(false);
  assert.equal(element("stop-wallet-connect").hidden, true);
  pending.resolve();
  await connection;
  assert.equal(api.getContext().ready, false);
});

test("a network change ignores a pending connection and a rejected request is recoverable", async () => {
  const pending = provider({ pending: true });
  const first = setup({ wallet: pending.wallet });
  const connection = first.api.connectWallet();
  first.api.resetLiveState();
  pending.resolve();
  await connection;
  assert.equal(first.api.getContext().ready, false);

  const rejected = setup({ wallet: {
    isMetaMask: true,
    request: async () => { throw Object.assign(new Error("User rejected"), { code: 4001 }); },
  } });
  await rejected.api.connectWallet();
  assert.equal(rejected.api.getContext().ready, false);
  assert.equal(rejected.element("connect-wallet").disabled, false);
  assert.equal(rejected.element("stop-wallet-connect").hidden, true);
  assert.match(rejected.statuses.at(-1), /cancelled/);
});

test("a missing ledger address never opens the publish dialog", async () => {
  const { wallet } = provider();
  const { api, window, element, publishMessages } = setup({ wallet });
  await api.connectWallet();
  window.CERBERUS_CONFIG.networks.testnet.contractAddress = "";
  await api.publishRecord(pitch, verdict);
  assert.equal(element("publish-confirm").showCount, 0);
  assert.equal(element("network-select").focusCount, 1);
  assert.match(publishMessages.at(-1), /not available/);
});

test("an announced MetaMask provider is used and QR remains explicit", async () => {
  const announced = provider();
  const { api, window } = setup();
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent({ type: "eip6963:announceProvider", detail: {
      info: { rdns: "io.metamask" }, provider: announced.wallet,
    } });
  });
  await api.connectWallet();
  assert.equal(api.getContext().ready, true);

  let qrCalls = 0;
  const qr = setup();
  qr.window.CerberusMetaMask = { connect: async () => { qrCalls += 1; return provider().wallet; } };
  await qr.api.connectWallet("qr");
  assert.equal(qrCalls, 1);
  assert.equal(qr.api.getContext().ready, true);
});

test("a local file and Brave without MetaMask show guidance without opening QR", async () => {
  const local = setup({ protocol: "file:" });
  await local.api.connectWallet();
  assert.match(local.statuses.at(-1), /local HTML file/);
  assert.equal(local.element("connect-wallet").disabled, false);

  const brave = setup({ brave: true });
  let qrCalls = 0;
  brave.window.CerberusMetaMask = { connect: async () => { qrCalls += 1; } };
  await brave.api.connectWallet();
  assert.equal(qrCalls, 0);
  assert.match(brave.statuses.at(-1), /Brave cannot see/);
});

test("stopping an explicit QR connection asks the connector to disconnect", async () => {
  const qr = setup();
  let resolveConnection;
  let disconnects = 0;
  qr.window.CerberusMetaMask = {
    connect: () => new Promise((resolve) => { resolveConnection = resolve; }),
    disconnect: async () => { disconnects += 1; },
  };
  const connection = qr.api.connectWallet("qr");
  await Promise.resolve();
  qr.api.stopWalletConnect(false);
  resolveConnection(provider().wallet);
  await connection;
  await Promise.resolve();
  assert.equal(disconnects, 1);
  assert.equal(qr.api.getContext().ready, false);
});
