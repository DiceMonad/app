// app.js - DiceMonad dApp logic (Swap & Dice)
// Network: Monad (chainId 143)
// DMN token: 0xd86d530e8A920be3b38547FC3157019acfF862F9
// Swap:      0xcb83C2c5BFB7B6e77fffa56B22B6EA416bAC2E99
// Dice:      0xb2369f3083EB6D62644dF8A3c67e6888b71703e6

(() => {
  "use strict";

  // ===== Constants =====
  const RPC_URL = "https://rpc.monad.xyz";
  const MONAD_CHAIN_ID_DEC = 143;
  const MONAD_CHAIN_ID_HEX = "0x8f"; // 143 in hex

  const DMN_TOKEN_ADDRESS = "0xd86d530e8A920be3b38547FC3157019acfF862F9";
  const SWAP_CONTRACT_ADDRESS = "0xcb83C2c5BFB7B6e77fffa56B22B6EA416bAC2E99";
  const DICE_CONTRACT_ADDRESS = "0xb2369f3083EB6D62644dF8A3c67e6888b71703e6";

  const DMN_DECIMALS = 18;
  const MON_DECIMALS = 18;

  // One-time Dice approval: 10,000,000 DMN
  const DICE_APPROVE_AMOUNT = ethers.utils.parseUnits("10000000", DMN_DECIMALS);

  // UI-only suggested minimum bet (not enforced by the contract)
  const UI_MIN_BET_DMN = ethers.utils.parseUnits("1", DMN_DECIMALS); // 1 DMN

  // ===== Minimal ABIs =====

  // ERC20 (DMN)
  const DMN_ABI = [
    {
      constant: true,
      inputs: [{ name: "owner", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      constant: true,
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "allowance",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      constant: false,
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      name: "approve",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      constant: true,
      inputs: [],
      name: "decimals",
      outputs: [{ name: "", type: "uint8" }],
      stateMutability: "view",
      type: "function",
    },
  ];

  // Fixed-rate Swap 1 DMN = 1 MON (DMNMonSwap)
  const SWAP_ABI = [
    {
      inputs: [],
      name: "swapMonForDMN",
      outputs: [],
      stateMutability: "payable",
      type: "function",
    },
    {
      inputs: [{ internalType: "uint256", name: "dmnAmount", type: "uint256" }],
      name: "swapDMNForMon",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ];

  // Dice (DMNDice)
  const DICE_ABI = [
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "player",
          type: "address",
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "amount",
          type: "uint256",
        },
        {
          indexed: false,
          internalType: "enum DMNDice.Choice",
          name: "choice",
          type: "uint8",
        },
        {
          indexed: false,
          internalType: "uint8",
          name: "result",
          type: "uint8",
        },
        {
          indexed: false,
          internalType: "bool",
          name: "won",
          type: "bool",
        },
      ],
      name: "Played",
      type: "event",
    },
    {
      inputs: [],
      name: "DMN_TOKEN",
      outputs: [{ internalType: "address", name: "", type: "address" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [],
      name: "getBankBalance",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        { internalType: "uint8", name: "choice", type: "uint8" }, // 0 = Even, 1 = Odd
        { internalType: "uint256", name: "amount", type: "uint256" },
        { internalType: "uint256", name: "clientSeed", type: "uint256" },
      ],
      name: "play",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ];

  // ===== Global State =====
  let rpcProvider = null;
  let web3Provider = null;
  let signer = null;
  let currentAccount = null;

  let dmnRead = null;
  let dmnWrite = null;
  let swapWrite = null;
  let diceRead = null;
  let diceWrite = null;

  let dmnBalanceBN = ethers.BigNumber.from(0);
  let monBalanceBN = ethers.BigNumber.from(0);

  let diceBankrollBN = ethers.BigNumber.from(0);
  let diceAllowanceBN = ethers.BigNumber.from(0);

  let swapDirection = "dmnToMon"; // or "monToDmn"

  let diceGuessEven = true; // true = Even, false = Odd
  let diceInFlight = false;
  let lastDiceBetBN = null;
  let lastDiceGame = null;

  // ===== DOM helpers =====
  const $ = (id) => document.getElementById(id);
  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }
  function shortenAddress(addr) {
    if (!addr) return "-";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  // ===== Format helpers =====
  function formatUnitsSafe(value, decimals = 18, precision = 4, grouping = true) {
    try {
      const num = Number(ethers.utils.formatUnits(value || 0, decimals));
      if (!Number.isFinite(num)) return "0";
      if (grouping) {
        return num.toLocaleString("en-US", {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision,
        });
      } else {
        return num.toFixed(precision);
      }
    } catch {
      return "0";
    }
  }

  function formatDmnDisplay(bn, precision = 4) {
    return formatUnitsSafe(bn, DMN_DECIMALS, precision, true);
  }
  function formatDmnPlain(bn, precision = 4) {
    return formatUnitsSafe(bn, DMN_DECIMALS, precision, false);
  }
  function formatMonDisplay(bn, precision = 4) {
    return formatUnitsSafe(bn, MON_DECIMALS, precision, true);
  }
  function formatMonPlain(bn, precision = 4) {
    return formatUnitsSafe(bn, MON_DECIMALS, precision, false);
  }

  function parseDmnInput(str) {
    const s = (str || "").trim().replace(/,/g, "");
    if (!s) return null;
    try {
      return ethers.utils.parseUnits(s, DMN_DECIMALS);
    } catch {
      return null;
    }
  }
  function parseMonInput(str) {
    const s = (str || "").trim().replace(/,/g, "");
    if (!s) return null;
    try {
      return ethers.utils.parseUnits(s, MON_DECIMALS);
    } catch {
      return null;
    }
  }

  function extractRevertReason(err) {
    if (!err) return "";
    if (err.reason) return err.reason;
    if (err.error && err.error.message) return err.error.message;
    if (err.data && typeof err.data === "string") return err.data;
    if (err.message) return err.message;
    return "";
  }

  // ===== Network helpers =====
  function setNetworkStatus(connected, name) {
    const dot = $("networkDot");
    const label = $("networkName");
    const labelHome = $("networkNameHome");

    if (dot) {
      dot.classList.remove("dot-connected", "dot-disconnected");
      dot.classList.add(connected ? "dot-connected" : "dot-disconnected");
    }
    if (label) {
      label.textContent = connected ? name || "Connected" : "Not connected";
    }
    if (labelHome) {
      labelHome.textContent = connected ? name || "Connected" : "Not connected";
    }
  }

  async function ensureMonadNetwork() {
    if (!window.ethereum) return false;
    try {
      const chainIdHex = await window.ethereum.request({
        method: "eth_chainId",
      });
      if (chainIdHex === MONAD_CHAIN_ID_HEX) return true;

      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_CHAIN_ID_HEX }],
      });
      return true;
    } catch (err) {
      console.error("ensureMonadNetwork error:", err);
      alert(
        "Please select Monad Mainnet (chainId 143) in MetaMask before using this dApp."
      );
      return false;
    }
  }

  function showScreen(screenId) {
    const screens = ["home-screen", "swap-screen", "dice-screen"];
    screens.forEach((id) => {
      const el = $(id);
      if (!el) return;
      if (id === screenId) el.classList.add("screen-active");
      else el.classList.remove("screen-active");
    });

    const navHome = $("navHome");
    const navSwap = $("navSwap");
    const navDice = $("navDice");
    [navHome, navSwap, navDice].forEach((el) => {
      if (!el) return;
      el.classList.remove("active");
    });
    if (screenId === "home-screen" && navHome) navHome.classList.add("active");
    if (screenId === "swap-screen" && navSwap) navSwap.classList.add("active");
    if (screenId === "dice-screen" && navDice) navDice.classList.add("active");
  }

  // ===== Providers & Contracts =====
  function initReadProvider() {
    if (!rpcProvider) {
      rpcProvider = new ethers.providers.JsonRpcProvider(RPC_URL);
    }
    if (!dmnRead) {
      dmnRead = new ethers.Contract(DMN_TOKEN_ADDRESS, DMN_ABI, rpcProvider);
    }
    if (!diceRead) {
      diceRead = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, rpcProvider);
    }
  }

  function initWriteContracts() {
    if (!web3Provider || !signer) return;
    dmnWrite = new ethers.Contract(DMN_TOKEN_ADDRESS, DMN_ABI, signer);
    swapWrite = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, signer);
    diceWrite = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, signer);
  }

  // ===== Balances & Pool =====
  async function refreshBalances() {
    try {
      initReadProvider();
      const homeDmnLabel = $("dmnBalance"); 
      const homeMonLabel = $("monBalance");
      const diceDmnLabel = $("diceDmnBalance");
      const diceMonLabel = $("diceMonBalance");

      if (!currentAccount || !web3Provider) {
        dmnBalanceBN = ethers.BigNumber.from(0);
        monBalanceBN = ethers.BigNumber.from(0);
        if (homeDmnLabel) homeDmnLabel.textContent = "- DMN";
        if (homeMonLabel) homeMonLabel.textContent = "- MON";
        if (diceDmnLabel) diceDmnLabel.textContent = "- DMN";
        if (diceMonLabel) diceMonLabel.textContent = "- MON";
        updateSwapBalanceLabels();
        return;
      }

      const [dmnBal, monBal] = await Promise.all([
        dmnRead.balanceOf(currentAccount),
        web3Provider.getBalance(currentAccount),
      ]);

      dmnBalanceBN = dmnBal;
      monBalanceBN = monBal;

      const dmnStr = formatDmnDisplay(dmnBal);
      const monStr = formatMonDisplay(monBal);

      if (homeDmnLabel) homeDmnLabel.textContent = `${dmnStr} DMN`;
      if (homeMonLabel) homeMonLabel.textContent = `${monStr} MON`;
      if (diceDmnLabel) diceDmnLabel.textContent = `${dmnStr} DMN`;
      if (diceMonLabel) diceMonLabel.textContent = `${monStr} MON`;

      updateSwapBalanceLabels();
    } catch (err) {
      console.error("refreshBalances error:", err);
    }
  }

  async function updateDicePool() {
    try {
      initReadProvider();
      const bankroll = await diceRead.getBankBalance();
      diceBankrollBN = bankroll;

      const poolStr = formatDmnDisplay(bankroll);
      setText("globalDicePoolDmn", `${poolStr} DMN`);
      setText("dicePoolDmnTop", `${poolStr} DMN`);
      setText("dicePoolDmn", `${poolStr} DMN`);
    } catch (err) {
      console.error("updateDicePool error:", err);
      setText("globalDicePoolDmn", "N/A");
      setText("dicePoolDmnTop", "N/A");
      setText("dicePoolDmn", "N/A");
    }
  }

  // ===== Swap Logic =====
  function updateSwapDirectionUI() {
    const tabDmnToMon = $("tabDmnToMon");
    const tabMonToDmn = $("tabMonToDmn");

    if (tabDmnToMon && tabMonToDmn) {
      tabDmnToMon.classList.remove("active");
      tabMonToDmn.classList.remove("active");
      if (swapDirection === "dmnToMon") tabDmnToMon.classList.add("active");
      else tabMonToDmn.classList.add("active");
    }

    const fromToken = $("swapFromToken");
    const toToken = $("swapToToken");
    const rateLabel = $("swapRateLabel");

    if (swapDirection === "dmnToMon") {
      if (fromToken) fromToken.textContent = "DMN";
      if (toToken) toToken.textContent = "MON";
    } else {
      if (fromToken) fromToken.textContent = "MON";
      if (toToken) toToken.textContent = "DMN";
    }
    if (rateLabel) {
      rateLabel.textContent =
        "Rate: 1 DMN = 1 MON (fixed while pool has liquidity)";
    }

    updateSwapBalanceLabels();
    updateSwapToAmount();
  }

  function setSwapDirection(dir) {
    swapDirection = dir;
    updateSwapDirectionUI();
  }

  function updateSwapBalanceLabels() {
    if (!currentAccount) {
      setText("fromBalanceLabel", "Balance: -");
      setText("toBalanceLabel", "Balance: -");
      return;
    }

    const dmnStr = formatDmnDisplay(dmnBalanceBN);
    const monStr = formatMonDisplay(monBalanceBN);

    if (swapDirection === "dmnToMon") {
      setText("fromBalanceLabel", `Balance: ${dmnStr} DMN`);
      setText("toBalanceLabel", `Balance: ${monStr} MON`);
    } else {
      setText("fromBalanceLabel", `Balance: ${monStr} MON`);
      setText("toBalanceLabel", `Balance: ${dmnStr} DMN`);
    }
  }

  function updateSwapToAmount() {
    const fromInput = $("swapFromAmount");
    const toInput = $("swapToAmount");
    if (!fromInput || !toInput) return;

    const raw = fromInput.value.trim();
    if (!raw) {
      toInput.value = "";
      return;
    }
    // 1:1 rate
    toInput.value = raw;
  }

  function setSwapMax() {
    const fromInput = $("swapFromAmount");
    if (!fromInput || !currentAccount) return;

    if (swapDirection === "dmnToMon") {
      fromInput.value = formatDmnPlain(dmnBalanceBN, 6);
    } else {
      // keep a small MON reserve for gas
      const gasReserve = ethers.utils.parseUnits("0.002", MON_DECIMALS);
      let usable = monBalanceBN.sub(gasReserve);
      if (usable.lt(0)) usable = ethers.BigNumber.from(0);
      fromInput.value = formatMonPlain(usable, 6);
    }
    updateSwapToAmount();
  }

  async function onSwapAction() {
  if (!window.ethereum) {
    alert("Please install MetaMask to use this dApp.");
    return;
  }
  const ok = await ensureMonadNetwork();
  if (!ok) return;

  if (!currentAccount || !web3Provider || !signer) {
    alert("Please connect your wallet first.");
    return;
  }

  const statusEl = $("swapStatus");
  const fromInput = $("swapFromAmount");
  if (!fromInput) return;

  const raw = fromInput.value.trim();
  if (!raw) {
    if (statusEl) statusEl.textContent = "Please enter amount.";
    return;
  }

  try {
    initReadProvider();
    initWriteContracts();

    if (swapDirection === "dmnToMon") {
      // ===== DMN -> MON =====
      const amountBN = parseDmnInput(raw);
      if (!amountBN || amountBN.lte(0)) {
        if (statusEl) statusEl.textContent = "Invalid DMN amount.";
        return;
      }

      if (dmnBalanceBN.lt(amountBN)) {
        if (statusEl) statusEl.textContent = "Insufficient DMN balance.";
        alert("Not enough DMN in your wallet.");
        return;
      }

      const allowanceBN = await dmnRead.allowance(
        currentAccount,
        SWAP_CONTRACT_ADDRESS
      );
      if (allowanceBN.lt(amountBN)) {
        if (statusEl)
          statusEl.textContent =
            "Approving DMN for Swap (please confirm in MetaMask)...";

        // Approve không set gasPrice, để MetaMask tự tính
        const txApprove = await dmnWrite.approve(
          SWAP_CONTRACT_ADDRESS,
          amountBN
        );
        await txApprove.wait();
      }

      // ƯỚC LƯỢNG GAS CHO swapDMNForMon
      if (statusEl)
        statusEl.textContent = "Estimating gas for DMN→MON swap...";
      let gasLimit;
      try {
        const gasEstimate = await swapWrite.estimateGas.swapDMNForMon(amountBN);
        gasLimit = gasEstimate.mul(120).div(100); // +20% buffer
      } catch (err) {
        console.error("estimateGas swapDMNForMon failed:", err);
        const reason = extractRevertReason(err);
        if (statusEl)
          statusEl.textContent =
            "Swap would revert on-chain. " + (reason || "");
        alert(
          "Swap DMN→MON would revert, so it is not sent.\n" +
            (reason || "")
        );
        return;
      }

      if (statusEl)
        statusEl.textContent = "Sending swap DMN→MON transaction...";
      const tx = await swapWrite.swapDMNForMon(amountBN, { gasLimit });
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        if (statusEl) statusEl.textContent = "Swap transaction reverted.";
        return;
      }
      if (statusEl) statusEl.textContent = "Swap DMN→MON successful!";
    } else {
      // ===== MON -> DMN =====
      const amountBN = parseMonInput(raw);
      if (!amountBN || amountBN.lte(0)) {
        if (statusEl) statusEl.textContent = "Invalid MON amount.";
        return;
      }
      if (monBalanceBN.lt(amountBN)) {
        if (statusEl) statusEl.textContent = "Insufficient MON balance.";
        alert("Not enough MON in your wallet.");
        return;
      }

      // ƯỚC LƯỢNG GAS CHO swapMonForDMN
      if (statusEl)
        statusEl.textContent = "Estimating gas for MON→DMN swap...";
      let gasLimit;
      try {
        const gasEstimate = await swapWrite.estimateGas.swapMonForDMN({
          value: amountBN,
        });
        gasLimit = gasEstimate.mul(120).div(100); // +20% buffer
      } catch (err) {
        console.error("estimateGas swapMonForDMN failed:", err);
        const reason = extractRevertReason(err);
        if (statusEl)
          statusEl.textContent =
            "Swap would revert on-chain. " + (reason || "");
        alert(
          "Swap MON→DMN would revert, so it is not sent.\n" +
            (reason || "")
        );
        return;
      }

      if (statusEl)
        statusEl.textContent = "Sending swap MON→DMN transaction...";
      const tx = await swapWrite.swapMonForDMN({
        value: amountBN,
        gasLimit,
      });
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        if (statusEl) statusEl.textContent = "Swap transaction reverted.";
        return;
      }
      if (statusEl) statusEl.textContent = "Swap MON→DMN successful!";
    }

    await refreshBalances();
    await updateDicePool();
  } catch (err) {
    console.error("Swap error:", err);
    const statusEl2 = $("swapStatus");
    if (statusEl2) {
      statusEl2.textContent =
        (err && err.message) || "Swap failed. See console for details.";
    }
    alert(
      "Swap failed.\n" +
        (err && err.message ? err.message : "Check console (F12).")
    );
  }
}

  // ===== Dice Visual =====
  function setDiceShaking(shaking) {
    const visual = $("diceVisual");
    if (!visual) return;
    if (shaking) visual.classList.add("dice-shaking");
    else visual.classList.remove("dice-shaking");
  }

  function setDiceCoinsPattern(resultEven) {
    const visual = $("diceVisual");
    if (!visual) return;
    const coins = visual.querySelectorAll(".dice-coin");
    if (!coins || coins.length < 4) return;

    // 3 EVEN patterns: 4 white; 4 red; 2 white + 2 red
    const evenPatterns = [
      ["white", "white", "white", "white"],
      ["red", "red", "red", "red"],
      ["white", "white", "red", "red"],
    ];
    // 2 ODD patterns: 1 red / 3 white; 3 red / 1 white
    const oddPatterns = [
      ["red", "white", "white", "white"],
      ["red", "red", "red", "white"],
    ];

    const patterns = resultEven ? evenPatterns : oddPatterns;
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];

    for (let i = 0; i < 4; i++) {
      const c = coins[i];
      c.classList.remove("dice-coin-white", "dice-coin-red");
      if (pattern[i] === "red") c.classList.add("dice-coin-red");
      else c.classList.add("dice-coin-white");
    }
  }

  // ===== Dice Logic =====
  function getCurrentDiceGuessEven() {
    return diceGuessEven;
  }

  function onGuessButtonClick(isEven) {
    diceGuessEven = isEven;
    const evenBtn = $("guessEvenButton");
    const oddBtn = $("guessOddButton");
    if (evenBtn && oddBtn) {
      if (isEven) {
        evenBtn.classList.add("active");
        oddBtn.classList.remove("active");
      } else {
        oddBtn.classList.add("active");
        evenBtn.classList.remove("active");
      }
    }
  }

  function updateDiceLastResultUI() {
    const resEl = $("diceLastResult");
    const outcomeEl = $("diceLastOutcome");
    const winLossEl = $("diceLastWinLoss");
    const payoutEl = $("diceLastPayout");
    const txEl = $("diceLastTx");

    if (!lastDiceGame) {
      if (resEl) resEl.textContent = "Last roll: -";
      if (outcomeEl) outcomeEl.textContent = "Outcome: -";
      if (winLossEl) winLossEl.textContent = "You: -";
      if (payoutEl) payoutEl.textContent = "Payout: -";
      if (txEl) txEl.textContent = "Tx Hash: -";
      return;
    }

    const { amountDmn, choiceEven, resultEven, win, payoutDmn, txHash } =
      lastDiceGame;

    const betStr = choiceEven ? "Even" : "Odd";
    const outcomeStr = resultEven ? "Even" : "Odd";

    if (resEl)
      resEl.textContent = `Last roll: Bet: ${betStr}, Amount: ${amountDmn}`;
    if (outcomeEl) outcomeEl.textContent = `Outcome: ${outcomeStr}`;
    if (winLossEl) winLossEl.textContent = win ? "You: WON" : "You: lost";
    if (payoutEl) payoutEl.textContent = `Payout: ${payoutDmn}`;
    if (txEl) {
      const shortTx = txHash
        ? txHash.slice(0, 10) + "..." + txHash.slice(-6)
        : "-";
      txEl.textContent = `Tx Hash: ${shortTx}`;
    }

    setDiceCoinsPattern(resultEven);
  }

  async function updateDiceLimitsAndAllowance() {
    try {
      initReadProvider();

      const bankBalance = await diceRead.getBankBalance();
      diceBankrollBN = bankBalance;

      const poolStr = formatDmnDisplay(bankBalance);
      setText("globalDicePoolDmn", `${poolStr} DMN`);
      setText("dicePoolDmnTop", `${poolStr} DMN`);
      setText("dicePoolDmn", `${poolStr} DMN`);

      if (currentAccount) {
        const allowance = await dmnRead.allowance(
          currentAccount,
          DICE_CONTRACT_ADDRESS
        );
        diceAllowanceBN = allowance;
        const allowanceStr = formatDmnDisplay(allowance);
        setText("diceAllowance", `${allowanceStr} DMN`);
      } else {
        diceAllowanceBN = ethers.BigNumber.from(0);
        setText("diceAllowance", "- DMN");
      }

      const minBetStr = formatDmnDisplay(UI_MIN_BET_DMN);
      const minText = $("diceMinimumText");
      if (minText)
        minText.textContent = `Suggested minimum: ${minBetStr} DMN`;
      const minInfo = $("diceMinInfo");
      if (minInfo)
        minInfo.textContent = `No protocol-enforced minimum; suggested ≥ ${minBetStr} DMN (2× payout on win).`;
    } catch (err) {
      console.error("updateDiceLimitsAndAllowance error:", err);
    }
  }

  async function onDiceApprove() {
    if (!window.ethereum) {
      alert("Please install MetaMask to use Dice.");
      return;
    }
    const ok = await ensureMonadNetwork();
    if (!ok) return;

    if (!currentAccount || !web3Provider || !signer) {
      alert("Please connect your wallet first.");
      return;
    }

    try {
      initWriteContracts();
      const statusEl = $("diceStatus");
      if (statusEl)
        statusEl.textContent =
          "Approving DMN for Dice (please confirm in MetaMask)...";

      const tx = await dmnWrite.approve(DICE_CONTRACT_ADDRESS, DICE_APPROVE_AMOUNT);
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        if (statusEl) statusEl.textContent = "Approve transaction reverted.";
        return;
      }

      if (statusEl) statusEl.textContent = "Approve successful.";
      await updateDiceLimitsAndAllowance();
    } catch (err) {
      console.error("Dice approve error:", err);
      const statusEl = $("diceStatus");
      if (statusEl)
        statusEl.textContent =
          (err && err.message) ||
          "Approve failed. See console for details.";
      alert(
        "Approve failed.\n" +
          (err && err.message ? err.message : "Check console (F12).")
      );
    }
  }

  function onDiceQuickButtons(action) {
    const input = $("diceBetAmount");
    if (!input) return;

    if (action === "clear") {
      input.value = "";
      return;
    }

    let currentBN = lastDiceBetBN;
    if (!currentBN || currentBN.lte(0)) {
      const raw = input.value.trim();
      const parsed = parseDmnInput(raw);
      if (!parsed || parsed.lte(0)) return;
      currentBN = parsed;
    }

    if (action === "repeat") {
      // keep same
    } else if (action === "half") {
      currentBN = currentBN.div(2);
    } else if (action === "double") {
      currentBN = currentBN.mul(2);
    }

    lastDiceBetBN = currentBN;
    input.value = formatDmnPlain(currentBN, 6);
  }

  async function onDiceRefreshLast() {
    updateDiceLastResultUI();
  }

  async function onDicePlay() {
    if (!window.ethereum) {
      alert("Please install MetaMask to use Dice.");
      return;
    }
    const ok = await ensureMonadNetwork();
    if (!ok) return;

    if (!currentAccount || !web3Provider || !signer) {
      alert("Please connect your wallet first.");
      return;
    }
    if (diceInFlight) return;

    const input = $("diceBetAmount");
    const statusEl = $("diceStatus");
    if (!input) return;

    const raw = input.value.trim();
    const amountBN = parseDmnInput(raw);
    if (!amountBN || amountBN.lte(0)) {
      if (statusEl) statusEl.textContent = "Invalid bet amount.";
      return;
    }

    try {
      diceInFlight = true;
      setDiceShaking(true);
      initReadProvider();
      initWriteContracts();

      // Refresh bank balance, allowance and DMN balance before playing
      const [bankBalance, allowanceBN, playerDmnBN] = await Promise.all([
        diceRead.getBankBalance(),
        dmnRead.allowance(currentAccount, DICE_CONTRACT_ADDRESS),
        dmnRead.balanceOf(currentAccount),
      ]);

      diceBankrollBN = bankBalance;
      diceAllowanceBN = allowanceBN;
      dmnBalanceBN = playerDmnBN;
      setText("diceDmnBalance", formatDmnDisplay(playerDmnBN) + " DMN");

      // 1) UI suggested minimum bet
      if (amountBN.lt(UI_MIN_BET_DMN)) {
        const minStr = formatDmnDisplay(UI_MIN_BET_DMN);
        if (statusEl)
          statusEl.textContent = `Bet is quite small. Suggested minimum is ${minStr} DMN.`;
        alert(`Bet is quite small. Suggested minimum: ${minStr} DMN.`);
        // still allow to continue
      }

      // 2) Check DMN balance
      if (playerDmnBN.lt(amountBN)) {
        if (statusEl) statusEl.textContent = "Insufficient DMN balance.";
        alert("Not enough DMN in your wallet.");
        return;
      }

      // 3) Check bankroll: must be at least 2x bet
      const neededPayout = amountBN.mul(2);
      if (bankBalance.lt(neededPayout)) {
        const poolStr = formatDmnDisplay(bankBalance);
        if (statusEl)
          statusEl.textContent =
            "Reward pool is too small for this bet. Try lower amount.";
        alert(
          `Bankroll is not enough to pay 2× for this bet.\n` +
            `Current bank balance: ${poolStr} DMN.`
        );
        return;
      }

      // 4) Check allowance
      if (allowanceBN.lt(amountBN)) {
        const allowStr = formatDmnDisplay(allowanceBN);
        const needStr = formatDmnDisplay(amountBN);
        if (statusEl)
          statusEl.textContent =
            `Allowance too low (${allowStr} DMN). Please click "Approve DMN for Dice" first.`;
        alert(
          `Allowance for Dice is too low (${allowStr} DMN).\n` +
            `Required ≥ ${needStr} DMN. Please click "Approve DMN for Dice" first.`
        );
        return;
      }

      lastDiceBetBN = amountBN;
      const guessEven = getCurrentDiceGuessEven();
      const choiceValue = guessEven ? 0 : 1; // 0 = Even, 1 = Odd
      const clientSeed = ethers.BigNumber.from(
        ethers.utils.randomBytes(32)
      ).toString();

      // estimateGas before sending the transaction
      let gasLimit;
      try {
        const gasEstimate = await diceWrite.estimateGas.play(
          choiceValue,
          amountBN,
          clientSeed
        );
        gasLimit = gasEstimate.mul(120).div(100); // +20% buffer
      } catch (err) {
        console.error("Dice estimateGas reverted:", err);
        const reason = extractRevertReason(err);
        if (statusEl)
          statusEl.textContent =
            "This bet would revert on-chain (estimateGas). " + (reason || "");
        alert(
          "Dice transaction would revert, so it will not be sent.\n" +
            (reason || "")
        );
        return;
      }

      if (statusEl)
        statusEl.textContent =
          "Sending Dice transaction... (MetaMask may ask you to confirm)";

      const tx = await diceWrite.play(choiceValue, amountBN, clientSeed, {
        gasLimit,
      });

      if (statusEl)
        statusEl.textContent =
          "Waiting for on-chain confirmation... (please wait)";
      const receipt = await tx.wait();

      if (receipt.status !== 1) {
        if (statusEl) {
          statusEl.textContent =
            "Dice transaction reverted on-chain. Check explorer.";
        }
        console.warn("Dice tx status != 1", receipt);
        return;
      }

      // Parse Played event
      let parsedEvent = null;
      const iface = new ethers.utils.Interface(DICE_ABI);
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== DICE_CONTRACT_ADDRESS.toLowerCase()) {
          continue;
        }
        try {
          const parsed = iface.parseLog(log);
          if (parsed.name === "Played") {
            parsedEvent = parsed;
            break;
          }
        } catch {
          // ignore parse errors
        }
      }

      if (parsedEvent) {
        const { player, amount, choice, result, won } = parsedEvent.args;
        const amountStr = formatDmnDisplay(amount, 4);
        const payoutBN = amount.mul(2);
        const payoutStr = won ? formatDmnDisplay(payoutBN, 4) + " DMN" : "0 DMN";

        const choiceEvenFlag = Number(choice) === 0;
        const resultEvenFlag = Number(result) === 0;

        lastDiceGame = {
          player,
          amountDmn: `${amountStr} DMN`,
          choiceEven: choiceEvenFlag,
          resultEven: resultEvenFlag,
          win: won,
          payoutDmn: payoutStr,
          txHash: receipt.transactionHash,
        };

        if (statusEl) {
          statusEl.textContent = won
            ? `You WON! Bet ${amountStr} DMN, received ${payoutStr}.`
            : `You lost this round. Bet ${amountStr} DMN.`;
        }

        updateDiceLastResultUI();
      } else {
        console.warn("No Played event found in Dice transaction logs.");
        if (statusEl)
          statusEl.textContent =
            "Dice transaction confirmed but event not parsed (check explorer).";
      }

      await refreshBalances();
      await updateDiceLimitsAndAllowance();
    } catch (err) {
      console.error("Dice play error:", err);
      const statusEl = $("diceStatus");
      if (statusEl) {
        const msg =
          (err && err.message) || "Dice play failed. See console for details.";
        statusEl.textContent = msg;
      }
      alert(
        "Dice play failed.\n" +
          (err && err.message ? err.message : "Check console (F12).")
      );
    } finally {
      diceInFlight = false;
      setDiceShaking(false);
    }
  }

  // ===== Wallet connect =====
  async function connectWallet() {
    if (!window.ethereum) {
      alert("Please install MetaMask to use this dApp.");
      return;
    }

    const ok = await ensureMonadNetwork();
    if (!ok) return;

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (!accounts || accounts.length === 0) {
        return;
      }
      currentAccount = ethers.utils.getAddress(accounts[0]);

      web3Provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = web3Provider.getSigner();
      initReadProvider();
      initWriteContracts();

      const short = shortenAddress(currentAccount);
      setText("walletAddressShort", short);
      setText("diceWalletAddressShort", short);

      setNetworkStatus(true, "Monad");

      await refreshBalances();
      await updateDiceLimitsAndAllowance();
      await updateDicePool();
    } catch (err) {
      console.error("connectWallet error:", err);
      alert(
        "Unable to connect wallet.\n" +
          (err && err.message ? err.message : "Check console (F12).")
      );
    }
  }

  // ===== Init & Events =====
  function initNav() {
    const navHome = $("navHome");
    const navSwap = $("navSwap");
    const navDice = $("navDice");
    const goToSwap = $("goToSwap");
    const goToDice = $("goToDice");

    if (navHome) navHome.addEventListener("click", () => showScreen("home-screen"));
    if (navSwap) navSwap.addEventListener("click", () => showScreen("swap-screen"));
    if (navDice) navDice.addEventListener("click", () => showScreen("dice-screen"));

    if (goToSwap) goToSwap.addEventListener("click", () => showScreen("swap-screen"));
    if (goToDice) goToDice.addEventListener("click", () => showScreen("dice-screen"));
  }

  function initSwapEvents() {
    const tabDmnToMon = $("tabDmnToMon");
    const tabMonToDmn = $("tabMonToDmn");
    const fromInput = $("swapFromAmount");
    const maxBtn = $("swapMaxButton");
    const actionBtn = $("swapActionButton");

    if (tabDmnToMon)
      tabDmnToMon.addEventListener("click", () => setSwapDirection("dmnToMon"));
    if (tabMonToDmn)
      tabMonToDmn.addEventListener("click", () => setSwapDirection("monToDmn"));
    if (fromInput) fromInput.addEventListener("input", () => updateSwapToAmount());
    if (maxBtn) maxBtn.addEventListener("click", setSwapMax);
    if (actionBtn) actionBtn.addEventListener("click", onSwapAction);

    setSwapDirection("dmnToMon");
  }

  function initDiceEvents() {
    const approveBtn = $("diceApproveButton");
    const maxBtn = $("diceMaxButton");
    const repeatBtn = $("diceRepeatButton");
    const halfBtn = $("diceHalfButton");
    const doubleBtn = $("diceDoubleButton");
    const clearBtn = $("diceClearButton");
    const evenBtn = $("guessEvenButton");
    const oddBtn = $("guessOddButton");
    const playBtn = $("dicePlayButton");
    const refreshLastBtn = $("diceRefreshLast");

    if (approveBtn) approveBtn.addEventListener("click", onDiceApprove);
    if (maxBtn)
      maxBtn.addEventListener("click", () => {
        const maxByBalance = dmnBalanceBN;
        const maxByBankroll = diceBankrollBN.div(2);
        const maxBN =
          maxByBalance.lt(maxByBankroll) ? maxByBalance : maxByBankroll;
        const input = $("diceBetAmount");
        if (input) input.value = formatDmnPlain(maxBN, 6);
      });
    if (repeatBtn)
      repeatBtn.addEventListener("click", () => onDiceQuickButtons("repeat"));
    if (halfBtn)
      halfBtn.addEventListener("click", () => onDiceQuickButtons("half"));
    if (doubleBtn)
      doubleBtn.addEventListener("click", () => onDiceQuickButtons("double"));
    if (clearBtn)
      clearBtn.addEventListener("click", () => onDiceQuickButtons("clear"));

    if (evenBtn) evenBtn.addEventListener("click", () => onGuessButtonClick(true));
    if (oddBtn) oddBtn.addEventListener("click", () => onGuessButtonClick(false));

    if (playBtn) playBtn.addEventListener("click", onDicePlay);
    if (refreshLastBtn) refreshLastBtn.addEventListener("click", onDiceRefreshLast);

    onGuessButtonClick(true); // default = Even
    setDiceCoinsPattern(true);
  }

  function initWalletEvents() {
    const connectBtn = $("connectButton");
    if (connectBtn) connectBtn.addEventListener("click", connectWallet);

    const refreshBtn = $("refreshBalances");
    if (refreshBtn)
      refreshBtn.addEventListener("click", async () => {
        await refreshBalances();
        await updateDicePool();
      });

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (!accounts || accounts.length === 0) {
          currentAccount = null;
          signer = null;
          web3Provider = null;
          setText("walletAddressShort", "-");
          setText("diceWalletAddressShort", "-");
          setNetworkStatus(false, "Not connected");
          refreshBalances();
        } else {
          currentAccount = ethers.utils.getAddress(accounts[0]);
          web3Provider = new ethers.providers.Web3Provider(window.ethereum);
          signer = web3Provider.getSigner();
          initWriteContracts();
          const short = shortenAddress(currentAccount);
          setText("walletAddressShort", short);
          setText("diceWalletAddressShort", short);
          setNetworkStatus(true, "Monad");
          refreshBalances();
          updateDiceLimitsAndAllowance();
        }
      });

      window.ethereum.on("chainChanged", (chainId) => {
        if (chainId !== MONAD_CHAIN_ID_HEX) {
          setNetworkStatus(false, "Wrong network");
        } else {
          setNetworkStatus(true, "Monad");
        }
        window.location.reload();
      });
    }
  }

  async function initApp() {
    try {
      initReadProvider();
      setNetworkStatus(false, "Not connected");
      showScreen("home-screen");

      initNav();
      initSwapEvents();
      initDiceEvents();
      initWalletEvents();

      await updateDicePool();
      updateDiceLastResultUI();
    } catch (err) {
      console.error("initApp error:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", initApp);
})();
