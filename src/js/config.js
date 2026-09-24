(function () {
  "use strict";

  window.CERBERUS_CONFIG = Object.freeze({
    storageKey: "cerberus-browser-sandbox-v1",
    addressStorageKey: "cerberus-deployed-address-v1",
    chatStorageKey: "cerberus-pitch-room-v1",
    draftStorageKey: "cerberus-draft-v1",
    draftEditKey: "cerberus-draft-edits-v1",
    activeNetwork: "testnet",

    // The deployed Tusk AI proxy (a Cloudflare Worker; see
    // tools/tusk-proxy/worker.mjs). The page connects to it by itself on load,
    // so live AI works however this static folder is opened. Leave blank ("")
    // to use a same-origin server that serves /api/* (for example `node
    // server.js`, or a host that proxies the API under one domain) instead. A
    // deployment can override this with
    // <meta name="cerberus-proxy" content="https://...">; visitors cannot change
    // it in the UI.
    aiProxyUrl: "https://cerberus-tusk-proxy.cerberus-tusk-proxy.workers.dev",

    networks: {
      testnet: {
        key: "testnet",
        name: "BOT Chain Testnet",
        chainId: 968,
        chainIdHex: "0x3c8",
        rpcUrl: "https://rpc.bohr.life",
        explorerUrl: "https://scan.bohr.life",
        // The deployed record ledger on BOT Chain Testnet. Set this to the
        // address you deployed. Visitors never see or edit it; publishing just
        // uses it. Leave blank to hide publishing on this network.
        contractAddress: "0xD7462a6848E619Fc7fb4892e30D9E4F8FC66Fd89"
      },
      mainnet: {
        key: "mainnet",
        name: "BOT Chain Mainnet",
        chainId: 677,
        chainIdHex: "0x2a5",
        rpcUrl: "https://rpc.botchain.ai",
        explorerUrl: "https://scan.botchain.ai",
        // The deployed record ledger on BOT Chain Mainnet. Same idea: set this
        // to your deployed address, and publishing uses it silently.
        contractAddress: "0x39B09B8098627e3eFf4dBeEE37d493C5199E2FA0"
      }
    }
  });
})();
