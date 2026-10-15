// GENERATED from infra/verified.json + infra/deployments.json — do not edit by hand.
// Source of truth: infra/verified.json (verified live 2026-10-14).
// DEPLOYED is our own testnet deployment; null when nothing is deployed yet.
export const CHAIN = {
  monad: { id: 143, name: "Monad Mainnet", rpc: "https://rpc.monad.xyz" },
  monadTestnet: { id: 10143, name: "Monad Testnet", rpc: "https://testnet-rpc.monad.xyz" },
} as const;

export const MAINNET = {
  chogGenesisNFT: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763",
  chogToken: "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777",
  usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  aavePool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
  aMonUSDC: "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042",
} as const;

export const TESTNET = {
  usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  usdt: "0x1314b22df27BDcD4F8D11a0f4185943e55748917",
  faucetUsdc: "0xc152fe819323913e478cab556be9e24a81790eaf",
  wmon: "0x97B3070F9Da6C002343862b35E68Bd8e22608943",
  stableFaucet: "0x50959dd2a4ef310f9aa2df9498cE9aC0aB956276",
  v2Factory: "0xd498f5beBD0C9f1FE0135a0Cf942dA67Ee6e8A9B",
  v2Router: "0x430c23895c8D44883526e3E0B09327dAD8766660",
  pairUSDCUSDT: "0xea236abc4fa54bf5a7a690d0cc2190f3b2c138f9",
  pairUSDCWMON: "0x1fbc7b6b54726d735ff1b47df75535b4b9021902",
  pairUSDTWMON: "0x0002b40b245efcd99a41fd0fb11f2ed90123933d",
} as const;

export const IPFS = {
  metadataBase: "bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu",
  gateway: "https://gateway.pinata.cloud/ipfs/",
} as const;

export const DEPLOYED = {
  chainId: 10143,
  mirror: "0xaAeD1e2Cc0c301943c0f70d43E6Ee5ad4bbF1bbb",
  pool: "0xD53CC85Aa338E9B083af59Bc82edFe3027e5Df6C",
  yieldAdapter: "0x6900B342ad42354B71566D38970f07B17bD6c15B",
  drawEngine: "0x4d7B34e1811655b3647C0F113cF48693010E5A7B",
  careerStore: "0x6aD908b72EB48eF4f7f03B9e5DB8e364403605CF",
  testChogToken: "0xd418015163413288399c71581562eF9C63C438c3",
  deployedAt: 1792057865,
} as const;
