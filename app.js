// app.js - VinMonDice dApp logic (Swap & Dice)

// ===== Basic helpers =====
function $(id) {
  return document.getElementById(id);
}

function shortenAddress(addr) {
  if (!addr) return "-";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatNumber(num, decimals = 4) {
  if (num === null || num === undefined || isNaN(num)) return "-";
  return Number(num).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function safeParseFloat(str) {
  if (!str) return NaN;
  const cleaned = str.replace(/,/g, "");
  const val = parseFloat(cleaned);
  return isNaN(val) ? NaN : val;
}

// ===== Global state =====
let web3Provider = null;
let signer = null;
let currentAccount = null;
let readProvider = null;

let VIN_DECIMALS = 18;
let vinRead = null;
let vinWrite = null;
let swapRead = null;
let swapWrite = null;
let diceRead = null;
let diceWrite = null;

let swapDirection = "vinToMon"; // "vinToMon" or "monToVin"
let lastDiceGame = null;
let lastDiceBetBN = null;
let diceMinBetBN = null;
let diceMaxBetBN = null;
let diceAllowanceBN = null;
let currentDiceGuessEven = true; // true = EVEN, false = ODD

// ===== Constants (Monad mainnet) =====
const MONAD_CHAIN_ID = 143;

const VIN_TOKEN_ADDRESS = "0xfB71cbd8CB6f0fb72a9568f11e7E4454309A9cA1";
const SWAP_CONTRACT_ADDRESS = "0xCdce3485752E7a7D4323f899FEe152D9F27e890B"; // VinMonSwapV2
const DICE_CONTRACT_ADDRESS = "0xE9Ed2c2987da0289233A1a1AE24438A314Ad6B2f"; // VinMonDiceV2

// VINTokenV2 ABI (from VINTokenV2_ContractABI.json)
const VIN_ABI = [
  {
    "inputs": [
      { "internalType": "string", "name": "_name", "type": "string" },
      { "internalType": "string", "name": "_symbol", "type": "string" },
      { "internalType": "uint8", "name": "_decimals", "type": "uint8" },
      { "internalType": "uint256", "name": "_initialSupply", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "anonymous": false, "inputs": [
      { "indexed": true, "internalType": "address", "name": "owner", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "spender", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }
    ], "name": "Approval", "type": "event"
  },
  { "anonymous": false, "inputs": [
      { "indexed": true, "internalType": "address", "name": "from", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "to", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "issuer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }
    ], "name": "Fee", "type": "event"
  },
  { "anonymous": false, "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "fee", "type": "uint256" }
    ], "name": "FeeUpdated", "type": "event"
  },
  { "anonymous": false, "inputs": [
      { "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }
    ], "name": "OwnershipTransferred", "type": "event"
  },
  { "anonymous": false, "inputs": [
      { "indexed": true, "internalType": "address", "name": "from", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "to", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "value", "type": "uint256" }
    ], "name": "Transfer", "type": "event"
  },
  { "inputs": [], "name": "DOMAIN_SEPARATOR", "outputs": [
      { "internalType": "bytes32", "name": "", "type": "bytes32" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "acceptOwnership", "outputs": [],
    "stateMutability": "nonpayable", "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      { "internalType": "address", "name": "spender", "type": "address" }
    ],
    "name": "allowance",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "spender", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [
      { "internalType": "bool", "name": "", "type": "bool" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" }
    ],
    "name": "balanceOf",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "burn",
    "outputs": [
      { "internalType": "bool", "name": "", "type": "bool" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [], "name": "decimals", "outputs": [
      { "internalType": "uint8", "name": "", "type": "uint8" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "value", "type": "uint256" }
    ],
    "name": "estimateFee",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [], "name": "issuer", "outputs": [
      { "internalType": "address", "name": "", "type": "address" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "minFee", "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "name", "outputs": [
      { "internalType": "string", "name": "", "type": "string" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" }
    ],
    "name": "nonces",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [], "name": "owner", "outputs": [
      { "internalType": "address", "name": "", "type": "address" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      { "internalType": "address", "name": "spender", "type": "address" },
      { "internalType": "uint256", "name": "value", "type": "uint256" },
      { "internalType": "uint256", "name": "deadline", "type": "uint256" },
      { "internalType": "uint8", "name": "v", "type": "uint8" },
      { "internalType": "bytes32", "name": "r", "type": "bytes32" },
      { "internalType": "bytes32", "name": "s", "type": "bytes32" }
    ],
    "name": "permit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "fee", "type": "uint256" }
    ],
    "name": "setFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "bytes4", "name": "interfaceId", "type": "bytes4" }
    ],
    "name": "supportsInterface",
    "outputs": [
      { "internalType": "bool", "name": "", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [], "name": "symbol", "outputs": [
      { "internalType": "string", "name": "", "type": "string" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "totalSupply", "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "recipient", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "transfer",
    "outputs": [
      { "internalType": "bool", "name": "", "type": "bool" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "sender", "type": "address" },
      { "internalType": "address", "name": "recipient", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "transferFrom",
    "outputs": [
      { "internalType": "bool", "name": "", "type": "bool" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "address", "name": "newOwner", "type": "address" }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// VinMonSwapV2 ABI (from VinMonSwapV2_ContractABI.json)
const SWAP_ABI = [
  {
    "inputs": [
      { "internalType": "contract IERC20", "name": "_vinToken", "type": "address" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "anonymous": false, "inputs": [
      { "indexed": true, "internalType": "address", "name": "from", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "monIn", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "vinOut", "type": "uint256" }
    ], "name": "MonForVin", "type": "event"
  },
  { "anonymous": false, "inputs": [
      { "indexed": true, "internalType": "address", "name": "from", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "vinIn", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "monOut", "type": "uint256" }
    ], "name": "VinForMon", "type": "event"
  },
  { "inputs": [], "name": "FEE", "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "RATE", "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "vinToken", "outputs": [
      { "internalType": "contract IERC20", "name": "", "type": "address" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "withdrawMon", "outputs": [],
    "stateMutability": "nonpayable", "type": "function"
  },
  { "inputs": [], "name": "withdrawVin", "outputs": [],
    "stateMutability": "nonpayable", "type": "function"
  },
  { "inputs": [], "name": "getReserves", "outputs": [
      { "internalType": "uint256", "name": "monReserve", "type": "uint256" },
      { "internalType": "uint256", "name": "vinReserve", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "vinAmountIn", "type": "uint256" }
    ],
    "name": "getMonOut",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "monAmountIn", "type": "uint256" }
    ],
    "name": "getVinOut",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "vinAmountIn", "type": "uint256" }
    ],
    "name": "swapVinForMon",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "monAmountIn", "type": "uint256" }
    ],
    "name": "swapMonForVin",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// VinMonDiceV2 ABI (from VinMonDiceV2_ContractABI.json)
const DICE_ABI = [
  {
    "inputs": [
      { "internalType": "contract IERC20", "name": "_vinToken", "type": "address" },
      { "internalType": "uint256", "name": "_minBet", "type": "uint256" },
      { "internalType": "uint256", "name": "_maxBetMultiplier", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "anonymous": false, "inputs": [
      { "indexed": true, "internalType": "address", "name": "player", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "indexed": false, "internalType": "uint8", "name": "choice", "type": "uint8" },
      { "indexed": false, "internalType": "uint8", "name": "result", "type": "uint8" },
      { "indexed": false, "internalType": "bool", "name": "won", "type": "bool" }
    ], "name": "Played", "type": "event"
  },
  { "inputs": [], "name": "MIN_BET", "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "bankroll", "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "maxBetMultiplier", "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [], "name": "vinToken", "outputs": [
      { "internalType": "contract IERC20", "name": "", "type": "address" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "depositBankroll",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "withdrawBankroll",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  { "inputs": [], "name": "owner", "outputs": [
      { "internalType": "address", "name": "", "type": "address" }
    ], "stateMutability": "view", "type": "function"
  },
  { "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "uint8", "name": "choice", "type": "uint8" },
      { "internalType": "uint256", "name": "clientSeed", "type": "uint256" }
    ],
    "name": "play",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// ===== Ethers helpers =====
function getEthereum() {
  if (typeof window !== "undefined" && window.ethereum) {
    return window.ethereum;
  }
  return null;
}

async function ensureMonadNetwork() {
  const eth = getEthereum();
  if (!eth) {
    alert("Please install MetaMask or a compatible wallet first.");
    return false;
  }

  const chainIdHex = await eth.request({ method: "eth_chainId" });
  const currentChainId = parseInt(chainIdHex, 16);
  if (currentChainId === MONAD_CHAIN_ID) return true;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x8f" }] // 143 decimal
    });
    return true;
  } catch (switchError) {
    alert(
      "Please switch your wallet network to Monad mainnet (chainId 143) and try again."
    );
    console.error("Network switch failed:", switchError);
    return false;
  }
}

function initReadProvider() {
  if (!readProvider) {
    readProvider = new ethers.providers.JsonRpcProvider("https://rpc.monad.xyz");
  }
  if (!vinRead) vinRead = new ethers.Contract(VIN_TOKEN_ADDRESS, VIN_ABI, readProvider);
  if (!swapRead) swapRead = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, readProvider);
  if (!diceRead) diceRead = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, readProvider);
}

function initWriteContracts() {
  if (!signer) return;
  vinWrite = new ethers.Contract(VIN_TOKEN_ADDRESS, VIN_ABI, signer);
  swapWrite = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, signer);
  diceWrite = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, signer);
}

// ===== VIN number helpers =====
function setVinDecimals(dec) {
  VIN_DECIMALS = dec;
}

function formatVinDisplay(bn, maxDecimals = 4) {
  if (!bn) return "-";
  const factor = ethers.BigNumber.from(10).pow(VIN_DECIMALS);
  const integer = bn.div(factor).toString();
  const fractionBN = bn.mod(factor);
  let fractionStr = fractionBN.toString().padStart(VIN_DECIMALS, "0");
  if (maxDecimals < VIN_DECIMALS) {
    const cut = fractionStr.slice(0, maxDecimals);
    fractionStr = cut.replace(/0+$/, "");
  } else {
    fractionStr = fractionStr.replace(/0+$/, "");
  }

  if (!fractionStr) return integer;
  return `${integer}.${fractionStr}`;
}

function parseVinInputToBN(str) {
  const val = safeParseFloat(str);
  if (isNaN(val) || val <= 0) return null;
  const s = String(val);
  const parts = s.split(".");
  let intPart = parts[0];
  let fracPart = parts[1] || "";
  if (fracPart.length > VIN_DECIMALS) {
    fracPart = fracPart.slice(0, VIN_DECIMALS);
  }
  while (fracPart.length < VIN_DECIMALS) {
    fracPart += "0";
  }
  const full = intPart + fracPart;
  return ethers.BigNumber.from(full);
}

// ===== Swap UI logic =====
function updateSwapDirectionUI() {
  const vinTab = $("tabVinToMon");
  const monTab = $("tabMonToVin");
  const rateLabel = $("swapRateLabel");

  if (vinTab && monTab) {
    vinTab.classList.remove("swap-tab-active");
    monTab.classList.remove("swap-tab-active");
    if (swapDirection === "vinToMon") {
      vinTab.classList.add("swap-tab-active");
    } else {
      monTab.classList.add("swap-tab-active");
    }
  }

  if (rateLabel) {
    if (swapDirection === "vinToMon") {
      rateLabel.textContent = "Rate: 1 VIN = 1 MON (fixed while pool has liquidity).";
    } else {
      rateLabel.textContent = "Rate: 1 MON = 1 VIN (fixed while pool has liquidity).";
    }
  }

  const fromTokenLabel = $("swapFromTokenLabel");
  const toTokenLabel = $("swapToTokenLabel");
  const fromBalanceLabel = $("swapFromBalanceLabel");
  const toBalanceLabel = $("swapToBalanceLabel");

  if (swapDirection === "vinToMon") {
    if (fromTokenLabel) fromTokenLabel.textContent = "VIN";
    if (toTokenLabel) toTokenLabel.textContent = "MON";
    if (fromBalanceLabel) fromBalanceLabel.textContent = "Balance: -- VIN";
    if (toBalanceLabel) toBalanceLabel.textContent = "Balance: -- MON";
  } else {
    if (fromTokenLabel) fromTokenLabel.textContent = "MON";
    if (toTokenLabel) toTokenLabel.textContent = "VIN";
    if (fromBalanceLabel) fromBalanceLabel.textContent = "Balance: -- MON";
    if (toBalanceLabel) toBalanceLabel.textContent = "Balance: -- VIN";
  }
}

function getSwapFromInput() {
  const el = $("swapFromInput");
  if (!el) return NaN;
  return safeParseFloat(el.value);
}

function setSwapToOutput(val) {
  const el = $("swapToOutput");
  if (!el) return;
  if (isNaN(val)) {
    el.value = "";
  } else {
    el.value = val.toFixed(4);
  }
}

async function updateSwapAmountPreview() {
  const amount = getSwapFromInput();
  if (isNaN(amount) || amount <= 0) {
    setSwapToOutput(NaN);
    return;
  }

  try {
    initReadProvider();
    const amountBN =
      swapDirection === "vinToMon"
        ? parseVinInputToBN(String(amount))
        : ethers.utils.parseEther(String(amount));

    if (!amountBN) {
      setSwapToOutput(NaN);
      return;
    }

    let outBN;
    if (swapDirection === "vinToMon") {
      outBN = await swapRead.getMonOut(amountBN);
      const out = parseFloat(ethers.utils.formatEther(outBN));
      setSwapToOutput(out);
    } else {
      outBN = await swapRead.getVinOut(amountBN);
      const outFloat = parseFloat(
        formatVinDisplay(outBN, 4).replace(/,/g, ".")
      );
      setSwapToOutput(outFloat);
    }
  } catch (err) {
    console.error("updateSwapAmountPreview error:", err);
    setSwapToOutput(NaN);
  }
}

// ===== Swap actions =====
async function handleSwap() {
  const statusEl = $("swapStatus");
  if (!statusEl) return;

  try {
    if (!currentAccount || !web3Provider || !signer) {
      alert("Please connect your wallet first.");
      return;
    }
    if (!(await ensureMonadNetwork())) return;

    initReadProvider();
    initWriteContracts();

    const amount = getSwapFromInput();
    if (isNaN(amount) || amount <= 0) {
      statusEl.textContent = "Invalid amount.";
      return;
    }

    let amountBN;
    if (swapDirection === "vinToMon") {
      amountBN = parseVinInputToBN(String(amount));
    } else {
      amountBN = ethers.utils.parseEther(String(amount));
    }

    if (!amountBN || amountBN.lte(0)) {
      statusEl.textContent = "Invalid amount.";
      return;
    }

    if (swapDirection === "vinToMon") {
      const bal = await vinRead.balanceOf(currentAccount);
      if (bal.lt(amountBN)) {
        statusEl.textContent = "Insufficient VIN balance.";
        alert("Insufficient VIN balance for this swap.");
        return;
      }

      const allowance = await vinRead.allowance(
        currentAccount,
        SWAP_CONTRACT_ADDRESS
      );
      if (allowance.lt(amountBN)) {
        statusEl.textContent =
          "Not enough VIN allowance for Swap. Please approve VIN for Swap first.";
        alert(
          "Your VIN allowance for the Swap contract is too low.\n" +
            "Please click \"Approve VIN for Swap\" first."
        );
        return;
      }
    }

    statusEl.textContent = "Estimating gas for swap...";
    let gasLimit;
    try {
      if (swapDirection === "vinToMon") {
        const gasEstimate = await swapWrite.estimateGas.swapVinForMon(amountBN);
        gasLimit = gasEstimate.mul(120).div(100);
      } else {
        const gasEstimate = await swapWrite.estimateGas.swapMonForVin(amountBN);
        gasLimit = gasEstimate.mul(120).div(100);
      }
    } catch (err) {
      console.error("Swap estimateGas reverted:", err);
      statusEl.textContent = "Swap would revert on-chain.";
      alert("Swap transaction would revert on-chain.");
      return;
    }

    statusEl.textContent = "Sending swap transaction...";
    let tx;
    if (swapDirection === "vinToMon") {
      tx = await swapWrite.swapVinForMon(amountBN, { gasLimit });
    } else {
      tx = await swapWrite.swapMonForVin(amountBN, { gasLimit, value: 0 });
    }
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      statusEl.textContent = "Swap transaction reverted.";
      return;
    }

    statusEl.textContent = "Swap completed.";
    await refreshBalances();
    await updateSwapReserves();
    await updateSwapAmountPreview();
  } catch (err) {
    console.error("handleSwap error:", err);
    const statusEl = $("swapStatus");
    if (statusEl) statusEl.textContent = "Swap transaction failed.";
    alert("Swap transaction failed on-chain.");
  }
}

// ===== Swap approvals =====
async function handleApproveSwapVin() {
  const statusEl = $("swapStatus");
  if (!statusEl) return;

  try {
    if (!currentAccount || !web3Provider || !signer) {
      alert("Please connect your wallet first.");
      return;
    }
    if (!(await ensureMonadNetwork())) return;

    initReadProvider();
    initWriteContracts();

    // Approve a large amount so user doesn't need to re-approve often
    const maxAmount = ethers.utils.parseUnits("100000000", VIN_DECIMALS); // 100,000,000 VIN

    statusEl.textContent = "Sending VIN approval for Swap...";
    const tx = await vinWrite.approve(SWAP_CONTRACT_ADDRESS, maxAmount);
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      statusEl.textContent = "VIN approval for Swap reverted.";
      return;
    }

    statusEl.textContent = "VIN approval for Swap confirmed.";
  } catch (err) {
    console.error("handleApproveSwapVin error:", err);
    if (statusEl) statusEl.textContent = "VIN approval for Swap failed.";
    alert("VIN approval for Swap failed on-chain.");
  }
}

// ===== Swap UI events =====
function initSwapEvents() {
  const vinTab = $("tabVinToMon");
  const monTab = $("tabMonToVin");
  const swapBtn = $("swapButton");
  const fromInput = $("swapFromInput");
  const maxBtn = $("swapMaxButton");
  const approveSwapVinBtn = $("approveSwapVinButton");

  if (vinTab) {
    vinTab.addEventListener("click", () => {
      swapDirection = "vinToMon";
      updateSwapDirectionUI();
      updateSwapAmountPreview();
    });
  }

  if (monTab) {
    monTab.addEventListener("click", () => {
      swapDirection = "monToVin";
      updateSwapDirectionUI();
      updateSwapAmountPreview();
    });
  }

  if (swapBtn) {
    swapBtn.addEventListener("click", () => {
      handleSwap();
    });
  }

  if (fromInput) {
    fromInput.addEventListener("input", () => {
      updateSwapAmountPreview();
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener("click", async () => {
      try {
        if (!currentAccount) return;
        initReadProvider();
        if (swapDirection === "vinToMon") {
          const bal = await vinRead.balanceOf(currentAccount);
          const balStr = formatVinDisplay(bal, 4);
          const input = $("swapFromInput");
          if (input) {
            input.value = balStr;
            updateSwapAmountPreview();
          }
        } else {
          const eth = getEthereum();
          if (!eth) return;
          const balWei = await eth.request({
            method: "eth_getBalance",
            params: [currentAccount, "latest"]
          });
          const bal = ethers.BigNumber.from(balWei);
          const balMon = parseFloat(ethers.utils.formatEther(bal));

          const safeBal = Math.max(balMon - 0.001, 0); // leave some MON for gas
          const input = $("swapFromInput");
          if (input) {
            input.value = safeBal.toFixed(4);
            updateSwapAmountPreview();
          }
        }
      } catch (err) {
        console.error("swapMaxButton error:", err);
      }
    });
  }

  if (approveSwapVinBtn) {
    approveSwapVinBtn.addEventListener("click", () => {
      handleApproveSwapVin();
    });
  }
}

// ===== Dice helpers (bet amount) =====
function getDiceBetAmountBN() {
  const input = $("diceBetAmount");
  if (!input) return null;
  return parseVinInputToBN(input.value);
}

function setDiceBetAmountFromBN(bn) {
  const input = $("diceBetAmount");
  if (!input || !bn) return;
  input.value = formatVinDisplay(bn, 6);
}

// ===== Dice visual (4 coins & shaking) =====
function setDiceShaking(isShaking) {
  const visual = $("diceVisual");
  if (!visual) return;
  if (isShaking) {
    visual.classList.add("dice-shaking");
  } else {
    visual.classList.remove("dice-shaking");
  }
}

function applyDicePattern(pattern) {
  const visual = $("diceVisual");
  if (!visual) return;
  const coins = visual.querySelectorAll(".dice-coin");
  if (!coins || coins.length !== 4) return;

  coins.forEach((coin, idx) => {
    coin.classList.remove("dice-coin-white", "dice-coin-red");
    const color = pattern[idx] === "red" ? "red" : "white";
    coin.classList.add(color === "red" ? "dice-coin-red" : "dice-coin-white");
    coin.style.transform = `translate(${(-2 + Math.random() * 4).toFixed(
      1
    )}px, ${(-2 + Math.random() * 4).toFixed(1)}px) rotate(${(
      -6 +
      Math.random() * 12
    ).toFixed(1)}deg)`;
  });
}

function setDiceCoinsPattern(isEven) {
  const evenPatterns = [
    ["white", "white", "white", "white"], // 4 white
    ["red", "red", "red", "red"], // 4 red
    ["white", "white", "red", "red"],
    ["red", "red", "white", "white"],
    ["white", "red", "white", "red"],
    ["red", "white", "red", "white"]
  ];

  const oddPatterns = [
    // 1 red, 3 white
    ["red", "white", "white", "white"],
    ["white", "red", "white", "white"],
    ["white", "white", "red", "white"],
    ["white", "white", "white", "red"],
    // 3 red, 1 white
    ["red", "red", "red", "white"],
    ["red", "red", "white", "red"],
    ["red", "white", "red", "red"],
    ["white", "red", "red", "red"]
  ];

  const patterns = isEven ? evenPatterns : oddPatterns;
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  applyDicePattern(pattern);
}

function setDiceVisual(resultEven) {
  const visual = $("diceVisual");
  if (!visual) return;
  visual.classList.remove("dice-even", "dice-odd");

  if (resultEven === null || resultEven === undefined) {
    // Neutral pattern: 2 red, 2 white
    applyDicePattern(["white", "red", "white", "red"]);
    return;
  }

  if (resultEven) {
    visual.classList.add("dice-even");
    setDiceCoinsPattern(true);
  } else {
    visual.classList.add("dice-odd");
    setDiceCoinsPattern(false);
  }
}

function updateDiceLastResultUI() {
  const statusEl = $("diceLastResult");
  const resEl = $("diceLastResultLine");
  const outcomeEl = $("diceOutcomeLine");
  const winLossEl = $("diceWinLossLine");
  const payoutEl = $("dicePayoutLine");
  const txEl = $("diceTxHashLine");

  if (!lastDiceGame) {
    if (statusEl) statusEl.textContent = "No completed Dice round yet.";
    if (resEl) resEl.textContent = "";
    if (outcomeEl) outcomeEl.textContent = "";
    if (winLossEl) winLossEl.textContent = "";
    if (payoutEl) payoutEl.textContent = "";
    if (txEl) txEl.textContent = "";
    setDiceVisual(null);
    return;
  }

  const {
    player,
    amountVin,
    choiceEven,
    resultEven,
    won,
    payoutVin,
    txHash
  } = lastDiceGame;

  if (statusEl) statusEl.textContent = `Player: ${shortenAddress(player)}`;
  const betStr = choiceEven ? "EVEN" : "ODD";
  const outcomeStr = resultEven ? "EVEN" : "ODD";
  if (resEl)
    resEl.textContent = `Last roll - Bet: ${betStr}, Amount: ${amountVin}`;
  if (outcomeEl) outcomeEl.textContent = `Outcome: ${outcomeStr}`;
  if (winLossEl) winLossEl.textContent = won ? "You: WON" : "You: lost";
  if (payoutEl) payoutEl.textContent = `Payout: ${payoutVin}`;
  if (txEl) {
    const shortTx = txHash
      ? txHash.slice(0, 10) + "..." + txHash.slice(-8)
      : "";
    txEl.innerHTML = txHash
      ? `Tx: <a href="https://monadvision.com/tx/${txHash}" target="_blank" rel="noopener noreferrer">${shortTx}</a>`
      : "";
  }

  setDiceVisual(resultEven);
}

// ===== Dice pool & limits =====
async function updateDicePool() {
  try {
    initReadProvider();
    const bankroll = await diceRead.bankroll();
    const maxBetMult = await diceRead.maxBetMultiplier();

    const bankrollStr = formatVinDisplay(bankroll, 4);
    setText("diceBankrollVin", `${bankrollStr} VIN`);

    if (bankroll.gt(0)) {
      const maxBet = bankroll.div(ethers.BigNumber.from(2)); // 1/2 bankroll
      diceMaxBetBN = maxBet;
      const maxBetStr = formatVinDisplay(maxBet, 4);
      setText("diceMaxBetHint", `Recommended max bet: ${maxBetStr} VIN.`);
    } else {
      diceMaxBetBN = null;
      setText(
        "diceMaxBetHint",
        "Recommended max bet: N/A (bankroll is empty)."
      );
    }
  } catch (err) {
    console.error("updateDicePool error:", err);
    setText("diceBankrollVin", "N/A");
    setText("diceMaxBetHint", "Recommended max bet: N/A");
  }
}

async function updateDiceLimitsAndAllowance() {
  try {
    initReadProvider();
    const [minBet, maxBet] = await Promise.all([
      diceRead.MIN_BET(),
      diceRead.bankroll()
    ]);

    diceMinBetBN = minBet;
    // We keep diceMaxBetBN as set in updateDicePool based on bankroll
    const minBetStr = formatVinDisplay(minBet);

    setText("diceMinInfo", `Min bet: ${minBetStr} VIN (2x payout on win)`);

    setText(
      "diceMinimumText",
      `Minimum bet: ${minBetStr} VIN. No maximum bet is enforced by the contract; please bet responsibly.`
    );

    if (currentAccount) {
      const allowance = await vinRead.allowance(
        currentAccount,
        DICE_CONTRACT_ADDRESS
      );
      diceAllowanceBN = allowance;
      const allowanceStr = formatVinDisplay(allowance, 4);
      setText("diceAllowance", `${allowanceStr} VIN`);
    }
  } catch (err) {
    console.error("updateDiceLimitsAndAllowance error:", err);
    setText("diceMinInfo", "Minimum bet: N/A");
    setText("diceMinimumText", "Minimum bet: N/A");
  }
}

// ===== Dice Approve =====
async function handleApproveDice() {
  const statusEl = $("diceStatus");
  if (!statusEl) return;

  try {
    if (!currentAccount || !web3Provider || !signer) {
      alert("Please connect your wallet first.");
      return;
    }
    if (!(await ensureMonadNetwork())) return;

    initReadProvider();
    initWriteContracts();

    // Approve 100,000,000 VIN so user only needs to approve once
    const maxAmount = ethers.utils.parseUnits("100000000", VIN_DECIMALS); // 100,000,000 VIN

    statusEl.textContent = "Sending VIN approval for Dice...";
    const tx = await vinWrite.approve(DICE_CONTRACT_ADDRESS, maxAmount);
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      statusEl.textContent = "VIN approval for Dice reverted.";
      return;
    }

    statusEl.textContent = "VIN approval for Dice confirmed.";
    const allowance = await vinRead.allowance(
      currentAccount,
      DICE_CONTRACT_ADDRESS
    );
    diceAllowanceBN = allowance;
    const allowanceStr = formatVinDisplay(allowance, 4);
    setText("diceAllowance", `${allowanceStr} VIN`);
  } catch (err) {
    console.error("handleApproveDice error:", err);
    if (statusEl) statusEl.textContent = "VIN approval for Dice failed.";
    alert("VIN approval for Dice failed on-chain.");
  }
}

// ===== Dice Guess buttons =====
function onGuessButtonClick(isEven) {
  currentDiceGuessEven = isEven;

  const evenBtn = $("guessEvenButton");
  const oddBtn = $("guessOddButton");

  if (evenBtn) {
    evenBtn.classList.remove("dice-guess-active");
    if (isEven) evenBtn.classList.add("dice-guess-active");
  }

  if (oddBtn) {
    oddBtn.classList.remove("dice-guess-active");
    if (!isEven) oddBtn.classList.add("dice-guess-active");
  }
}

// ===== Dice play (main action) =====
async function handleDicePlay() {
  const statusEl = $("diceStatus");
  if (!statusEl) return;

  try {
    if (!currentAccount || !web3Provider || !signer) {
      alert("Please connect your wallet first.");
      return;
    }
    if (!(await ensureMonadNetwork())) return;

    initReadProvider();
    initWriteContracts();

    const amountBN = getDiceBetAmountBN();
    if (!amountBN || amountBN.lte(0)) {
      statusEl.textContent = "Invalid bet amount.";
      return;
    }

    if (diceMinBetBN && amountBN.lt(diceMinBetBN)) {
      const minStr = formatVinDisplay(diceMinBetBN);
      statusEl.textContent = `Bet is below minimum: ${minStr} VIN.`;
      alert(`Bet is below minimum: ${minStr} VIN.`);
      return;
    }

    if (diceMaxBetBN && amountBN.gt(diceMaxBetBN)) {
      const maxStr = formatVinDisplay(diceMaxBetBN);
      statusEl.textContent = `Bet is above recommended maximum: ${maxStr} VIN.`;
      alert(
        "This bet is above the recommended maximum based on the current bankroll.\n" +
          `Recommended max: ${maxStr} VIN.`
      );
      return;
    }

    if (!currentDiceGuessEven) {
      statusEl.textContent = "Please select Even or Odd first.";
      alert("Please select Even or Odd first.");
      return;
    }

    if (!diceAllowanceBN || diceAllowanceBN.lt(amountBN)) {
      statusEl.textContent =
        "Not enough allowance for Dice. Please approve VIN for Dice first.";
      alert(
        "Your VIN allowance for the Dice contract is too low.\n" +
          'Please click "Approve VIN for Dice" first.'
      );
      return;
    }

    const vinBal = await vinRead.balanceOf(currentAccount);
    if (vinBal.lt(amountBN)) {
      const balStr = formatVinDisplay(vinBal);
      const amtStr = formatVinDisplay(amountBN);
      statusEl.textContent = `Insufficient VIN balance (have ${balStr}, need ${amtStr}).`;
      alert(
        "Insufficient VIN balance for this bet.\n" +
          `You have ${balStr} VIN, but tried to bet ${amtStr} VIN.`
      );
      return;
    }

    // Start shaking & reset visual to a neutral state
    setDiceShaking(true);
    setDiceVisual(null);
    statusEl.textContent = "Estimating gas for Dice transaction...";

    const choice = currentDiceGuessEven ? 0 : 1; // 0 = Even, 1 = Odd
    const clientSeed = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).toString();

    let gasLimit;
    try {
      const gasEstimate = await diceWrite.estimateGas.play(
        amountBN,
        choice,
        clientSeed
      );
      gasLimit = gasEstimate.mul(120).div(100);
    } catch (err) {
      console.error("Dice estimateGas reverted:", err);
      const reason = extractRevertReason(err);
      statusEl.textContent =
        "This bet would revert on-chain. " + (reason || "");
      alert(
        "Dice transaction would revert on-chain.\n" +
          (reason ? `Reason: ${reason}` : "")
      );
      return;
    }

    statusEl.textContent = "Sending Dice transaction...";
    const tx = await diceWrite.play(amountBN, choice, clientSeed, {
      gasLimit
    });
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      statusEl.textContent = "Dice transaction reverted.";
      return;
    }

    // Decode Played event
    const iface = new ethers.utils.Interface(DICE_ABI);
    let parsedEvent = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === "Played") {
          parsedEvent = parsed;
          break;
        }
      } catch {
        // ignore non-matching logs
      }
    }

    if (parsedEvent) {
      const { player, amount, choice, result, won } = parsedEvent.args;
      const amountStr = formatVinDisplay(amount, 4);
      const payoutBN = amount.mul(2);
      const payoutStr = won
        ? `${formatVinDisplay(payoutBN, 4)} VIN`
        : "0 VIN";

      lastDiceGame = {
        player,
        amountVin: `${amountStr} VIN`,
        choiceEven: choice === 0,
        resultEven: result === 0,
        won,
        payoutVin: payoutStr,
        txHash: receipt.transactionHash
      };

      statusEl.textContent = won
        ? `You WON! Payout: ${payoutStr}`
        : "You lost this round.";

      // Update UI + coins according to the on-chain result
      updateDiceLastResultUI();
      lastDiceBetBN = amountBN;
    } else {
      statusEl.textContent =
        "Dice transaction confirmed, but event not found.";
    }

    await Promise.all([refreshBalances(), updateDicePool()]);
  } catch (err) {
    console.error("handleDicePlay error:", err);
    const statusEl = $("diceStatus");
    const reason = extractRevertReason(err);
    if (statusEl)
      statusEl.textContent =
        "Dice transaction failed on-chain. " +
        (reason ? `Reason: ${reason}` : "");
    alert(
      "Dice transaction failed on-chain.\n" +
        (reason ? `Reason: ${reason}` : "")
    );
  } finally {
    // Always stop shaking once we have either a result or an error
    setDiceShaking(false);
  }
}

// ===== Dice events wiring =====
function initDiceEvents() {
  const evenBtn = $("guessEvenButton");
  const oddBtn = $("guessOddButton");
  const approveBtn = $("diceApproveButton");
  const playBtn = $("dicePlayButton");
  const maxBtn = $("diceMaxButton");
  const repeatBtn = $("diceRepeatButton");
  const halfBtn = $("diceHalfButton");
  const doubleBtn = $("diceDoubleButton");
  const clearBtn = $("diceClearButton");
  const refreshLastBtn = $("diceRefreshLast");

  if (evenBtn)
    evenBtn.addEventListener("click", () => onGuessButtonClick(true));
  if (oddBtn)
    oddBtn.addEventListener("click", () => onGuessButtonClick(false));

  if (approveBtn) {
    approveBtn.addEventListener("click", () => {
      handleApproveDice();
    });
  }

  if (playBtn) {
    playBtn.addEventListener("click", () => {
      handleDicePlay();
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener("click", async () => {
      try {
        if (!currentAccount) {
          alert("Please connect your wallet first.");
          return;
        }
        initReadProvider();
        const vinBal = await vinRead.balanceOf(currentAccount);
        setDiceBetAmountFromBN(vinBal);
      } catch (err) {
        console.error("diceMaxButton error:", err);
      }
    });
  }

  if (repeatBtn) {
    repeatBtn.addEventListener("click", () => {
      if (lastDiceBetBN) setDiceBetAmountFromBN(lastDiceBetBN);
    });
  }

  if (halfBtn) {
    halfBtn.addEventListener("click", () => {
      const bn = getDiceBetAmountBN();
      if (!bn) return;
      const half = bn.div(2);
      if (half.gt(0)) setDiceBetAmountFromBN(half);
    });
  }

  if (doubleBtn) {
    doubleBtn.addEventListener("click", () => {
      const bn = getDiceBetAmountBN();
      if (!bn) return;
      const doubled = bn.mul(2);
      setDiceBetAmountFromBN(doubled);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const input = $("diceBetAmount");
      if (input) input.value = "";
    });
  }

  if (refreshLastBtn) {
    refreshLastBtn.addEventListener("click", () => {
      updateDiceLastResultUI();
      updateDicePool();
    });
  }

  // Default bet amount: 0.000001 VIN (contract min bet)
  const betInput = $("diceBetAmount");
  if (betInput) {
    betInput.value = "0.000001";
  }

  // Default guess = EVEN
  onGuessButtonClick(true);
}

// ===== Wallet & balances =====
async function connectWallet() {
  try {
    const eth = getEthereum();
    if (!eth) {
      alert("Please install MetaMask or a compatible wallet.");
      return;
    }

    const accounts = await eth.request({
      method: "eth_requestAccounts"
    });
    if (!accounts || !accounts[0]) return;

    currentAccount = ethers.utils.getAddress(accounts[0]);
    web3Provider = new ethers.providers.Web3Provider(eth);
    signer = web3Provider.getSigner();

    setText("walletAddress", shortenAddress(currentAccount));

    initReadProvider();
    initWriteContracts();

    const dec = await vinRead.decimals();
    setVinDecimals(dec);

    await Promise.all([
      refreshBalances(),
      updateSwapReserves(),
      updateDicePool(),
      updateDiceLimitsAndAllowance()
    ]);

    const connectBtn = $("connectWalletButton");
    if (connectBtn) connectBtn.textContent = "Wallet Connected";
  } catch (err) {
    console.error("connectWallet error:", err);
    alert("Failed to connect wallet.");
  }
}

async function refreshBalances() {
  try {
    if (!currentAccount) {
      setText("vinBalance", "-");
      setText("monBalance", "-");
      return;
    }

    initReadProvider();

    const [vinBal, eth] = await Promise.all([
      vinRead.balanceOf(currentAccount),
      Promise.resolve(getEthereum())
    ]);

    const vinStr = formatVinDisplay(vinBal, 4);
    setText("vinBalance", `${vinStr} VIN`);

    if (eth) {
      const monWei = await eth.request({
        method: "eth_getBalance",
        params: [currentAccount, "latest"]
      });
      const monBal = ethers.BigNumber.from(monWei);
      const monStr = parseFloat(ethers.utils.formatEther(monBal));
      setText("monBalance", `${formatNumber(monStr, 4)} MON`);
    } else {
      setText("monBalance", "-");
    }
  } catch (err) {
    console.error("refreshBalances error:", err);
    setText("vinBalance", "-");
    setText("monBalance", "-");
  }
}

async function updateSwapReserves() {
  try {
    initReadProvider();
    const [balVin, eth] = await Promise.all([
      vinRead.balanceOf(SWAP_CONTRACT_ADDRESS),
      Promise.resolve(getEthereum())
    ]);

    const vinStr = formatVinDisplay(balVin, 4);
    setText("swapPoolVin", `${vinStr} VIN`);

    if (eth) {
      const monWei = await eth.request({
        method: "eth_getBalance",
        params: [SWAP_CONTRACT_ADDRESS, "latest"]
      });
      const monBal = ethers.BigNumber.from(monWei);
      const monFloat = parseFloat(ethers.utils.formatEther(monBal));
      setText("swapPoolMon", `${formatNumber(monFloat, 4)} MON`);
    } else {
      setText("swapPoolMon", "-");
    }
  } catch (err) {
    console.error("updateSwapReserves error:", err);
    setText("swapPoolVin", "-");
    setText("swapPoolMon", "-");
  }
}

// ===== Price (VIN / USD via MON / USD from CoinGecko) =====
async function fetchMonPriceUSD() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd",
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error("Failed to fetch price");
    const data = await res.json();
    if (!data.monad || typeof data.monad.usd !== "number") {
      throw new Error("Invalid Coingecko response");
    }
    return data.monad.usd;
  } catch (err) {
    console.error("fetchMonPriceUSD error:", err);
    return null;
  }
}

async function updateVinPriceUSD() {
  try {
    setText("vinPriceUsd", "Loading...");

    const monPrice = await fetchMonPriceUSD();
    if (!monPrice) {
      setText("vinPriceUsd", "Price: N/A");
      return;
    }

    // 1 VIN = 1 MON (while pool has liquidity)
    const vinPriceUsd = monPrice;
    setText(
      "vinPriceUsd",
      `Price: 1 VIN ≈ $${vinPriceUsd.toFixed(4)} USD (via MON)`
    );
  } catch (err) {
    console.error("updateVinPriceUSD error:", err);
    setText("vinPriceUsd", "Price: N/A");
  }
}

// ===== Extract revert reason helper =====
function extractRevertReason(err) {
  if (!err) return "";
  if (err.reason) return err.reason;
  if (err.data && err.data.message) return err.data.message;
  if (err.error && err.error.message) return err.error.message;
  if (err.message) return err.message;
  return "";
}

// ===== Init =====
function initApp() {
  const connectBtn = $("connectWalletButton");
  if (connectBtn) {
    connectBtn.addEventListener("click", () => {
      connectWallet();
    });
  }

  initSwapEvents();
  initDiceEvents();
  updateSwapDirectionUI();
  updateVinPriceUSD();

  setDiceVisual(null);
  setText("walletAddress", "Not connected");
}

window.addEventListener("DOMContentLoaded", () => {
  initApp();
});
