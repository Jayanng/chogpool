// The wallet chain fix: viem refuses to sign a write on a wallet client with
// no chain ("No chain was provided"), which killed every claim, swap,
// approve, deposit and mint before the wallet ever saw a request. The client
// must carry the wallet's real chain, built from the generated registry.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAIN } from "../generated/addresses.gen";
import { connectWallet, pickRestoreAccount, restoreSession } from "./wallet";

type FakeRequest = { method: string };

// Built at runtime on purpose: the address-registry check forbids 0x{40-hex}
// literals in source, and this test account is not a chain value anyway.
const FAKE_ACCOUNT = `0x${"11".repeat(20)}`;

function fakeProvider(chainIdHex: string) {
  return {
    isMetaMask: true,
    async request({ method }: FakeRequest): Promise<unknown> {
      if (method === "eth_chainId") return chainIdHex;
      if (method === "eth_requestAccounts") return [FAKE_ACCOUNT];
      throw new Error(`unexpected method ${method}`);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the wallet client carries the wallet's real chain", () => {
  it("builds the client on the wallet's chain id so viem can sign writes", async () => {
    vi.stubGlobal("window", { ethereum: fakeProvider("0x279f") }); // 10143, Monad testnet
    const state = await connectWallet();
    expect(state.chainId).toBe(CHAIN.monadTestnet.id);
    // The regression: a chainless client, so this used to be undefined.
    expect(state.walletClient.chain?.id).toBe(CHAIN.monadTestnet.id);
    expect(state.walletClient.chain?.name).toBe(CHAIN.monadTestnet.name);
    expect(state.walletClient.chain?.rpcUrls.default.http).toEqual([CHAIN.monadTestnet.rpc]);
    expect(state.address).toBe(FAKE_ACCOUNT);
  });

  it("recognizes the mainnet chain from the generated registry too", async () => {
    vi.stubGlobal("window", { ethereum: fakeProvider("0x8f") }); // 143, Monad mainnet
    const state = await connectWallet();
    expect(state.walletClient.chain?.id).toBe(CHAIN.monad.id);
    expect(state.walletClient.chain?.name).toBe(CHAIN.monad.name);
    expect(state.walletClient.chain?.rpcUrls.default.http).toEqual([CHAIN.monad.rpc]);
  });

  it("still carries a chain on an unsupported network, labeled honestly", async () => {
    vi.stubGlobal("window", { ethereum: fakeProvider("0x3e7") }); // 999
    const state = await connectWallet();
    expect(state.walletClient.chain?.id).toBe(999);
    expect(state.walletClient.chain?.name).toBe("Unsupported network (chainId 999)");
  });
});

// A restore must never pop the wallet UI: eth_accounts answers for an
// already-authorized wallet, eth_requestAccounts asks. This provider throws on
// the asking method, so a regression here fails the test loudly.
function silentProvider(chainIdHex: string, accounts: unknown) {
  return {
    isMetaMask: true,
    async request({ method }: FakeRequest): Promise<unknown> {
      if (method === "eth_accounts") return accounts;
      if (method === "eth_chainId") return chainIdHex;
      if (method === "eth_requestAccounts") throw new Error("a silent restore must never request accounts");
      throw new Error(`unexpected method ${method}`);
    },
  };
}

describe("the silent restore decides from the eth_accounts answer alone", () => {
  it("restores only for a real address", () => {
    expect(pickRestoreAccount([FAKE_ACCOUNT])).toBe(FAKE_ACCOUNT);
    expect(pickRestoreAccount([FAKE_ACCOUNT, `0x${"22".repeat(20)}`])).toBe(FAKE_ACCOUNT);
  });

  it("restores nothing on an empty or malformed answer", () => {
    expect(pickRestoreAccount([])).toBeNull();
    expect(pickRestoreAccount(undefined)).toBeNull();
    expect(pickRestoreAccount(null)).toBeNull();
    expect(pickRestoreAccount("not a list")).toBeNull();
    expect(pickRestoreAccount([42])).toBeNull();
    expect(pickRestoreAccount(["not-an-address"])).toBeNull();
    expect(pickRestoreAccount([`0x${"11".repeat(19)}`])).toBeNull(); // one hex digit short
  });

  it("picks up an authorized wallet without ever asking for one", async () => {
    vi.stubGlobal("window", { ethereum: silentProvider("0x279f", [FAKE_ACCOUNT]) });
    const restored = await restoreSession();
    expect(restored?.address).toBe(FAKE_ACCOUNT);
    expect(restored?.chainId).toBe(CHAIN.monadTestnet.id);
    expect(restored?.walletClient.chain?.id).toBe(CHAIN.monadTestnet.id);
  });

  it("stays disconnected when nothing is authorized", async () => {
    vi.stubGlobal("window", { ethereum: silentProvider("0x279f", []) });
    expect(await restoreSession()).toBeNull();
  });

  it("stays disconnected when the answer holds no usable account", async () => {
    vi.stubGlobal("window", { ethereum: silentProvider("0x279f", ["nope"]) });
    expect(await restoreSession()).toBeNull();
  });

  it("stays disconnected with no wallet at all", async () => {
    vi.stubGlobal("window", {});
    expect(await restoreSession()).toBeNull();
  });
});
