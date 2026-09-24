import { createEVMClient } from "@metamask/connect-evm";

let clientPromise;

function client() {
  if (!clientPromise) {
    const networks = window.CERBERUS_CONFIG.networks;
    clientPromise = createEVMClient({
      dapp: {
        name: "Cerberus AI",
        url: window.location.origin,
        iconUrl: new URL("src/assets/favicon.svg", document.baseURI).href
      },
      api: {
        supportedNetworks: {
          [networks.testnet.chainIdHex]: networks.testnet.rpcUrl,
          [networks.mainnet.chainIdHex]: networks.mainnet.rpcUrl
        }
      }
    }).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function connect(chainIdHex) {
  const wallet = await client();
  await wallet.connect({ chainIds: [chainIdHex] });
  return wallet.getProvider();
}

export async function disconnect() {
  if (clientPromise) await (await clientPromise).disconnect();
}
