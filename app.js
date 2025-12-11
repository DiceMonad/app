/* app.js - replacement version for VinMonDice
   - Robust parsing for VIN and MON amounts (accepts '.' or ',' decimal separators)
   - Integrates common dApp features: swap, dice, wallet connect, balances
   - Keep addresses/ABIs configurable near the top
   - BEFORE replacing: backup your current app.js => app.js.bak
*/

/* eslint-disable no-console */
(() => {
  "use strict";

  // ===================== CONFIG (edit if your environment differs) =====================
  const RPC_URL = "https://rpc.monad.xyz";
  const MONAD_CHAIN_ID_DEC = 143;
  const MONAD_CHAIN_ID_HEX = "0x8f"; // hex for 143

  // Default addresses — replace with your contract addresses if different
  const VIN_TOKEN_ADDRESS = "0xfB71cbd8CB6f0fb72a9568f11e7E4454309A9cA1";
  const SWAP_CONTRACT_ADDRESS = "0x11395DB7E0AcB7c56fE79FBAFFD48B5BeC896098";
  const DICE_CONTRACT_ADDRESS = "0x245Fb6ECC6B2beCaf45AC15E4fAc8C78826f0F67";

  // Token decimals default (will try to read VIN decimals on connect)
  const MON_DECIMALS = 18;
  let VIN_DECIMALS = 18;

  // ===================== ABIs (minimal, edit if your contract differs) =====================
  const VIN_ABI = [
    { constant: true, inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
    { constant: true, inputs: [], name: "decimals", outputs: [{ name: "", type: "uint8" }], stateMutability: "view", type: "function" },
    { constant: true, inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
    { constant: false, inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" }
  ];

  const SWAP_ABI = [
    { inputs: [], name: "getMonReserve", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
    { inputs: [], name: "getVinReserve", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
    { inputs: [], name: "swapMonForVin", outputs: [], stateMutability: "payable", type: "function" },
    { inputs: [{ internalType: "uint256", name: "vinAmount", type: "uint256" }], name: "swapVinForMon", outputs: [], stateMutability: "nonpayable", type: "function" }
  ];

  const DICE_ABI = [
    { inputs: [], name: "MIN_BET", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
    { inputs: [], name: "VIN_TOKEN", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
    { inputs: [], name: "getBankBalance", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
    { inputs: [], name: "getMaxBet", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
    { inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }, { internalType: "uint8", name: "choice", type: "uint8" }, { internalType: "uint256", name: "clientSeed", type: "uint256" }], name: "play", outputs: [], stateMutability: "nonpayable", type: "function" },
    { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "player", type: "address" }, { indexed: false, internalType: "uint256", name: "amount", type: "uint256" }, { indexed: false, internalType: "uint8", name: "choice", type: "uint8" }, { indexed: false, internalType: "uint8", name: "result", type: "uint8" }, { indexed: false, internalType: "bool", name: "won", type: "bool" }], name: "Played", type: "event" }
  ];

  // ===================== State =====================
  let rpcProvider = null;
  let web3Provider = null;
  let signer = null;
  let currentAccount = null;

  let vinRead = null;
  let vinWrite = null;
  let swapRead = null;
  let swapWrite = null;
  let diceRead = null;
  let diceWrite = null;

  let diceMinBetBN = null;
  let diceMaxBetBN = null;
  let diceAllowanceBN = null;
  let lastDiceBetBN = null;
  let lastDiceGame = null;
  let diceGuessEven = true; // true -> EVEN

  let swapDirection = "vinToMon";

  // ===================== Helpers =====================
  function $(id) { return document.getElementById(id); }
  function shortenAddress(addr) { if (!addr) return "-"; return addr.slice(0, 6) + "..." + addr.slice(-4); }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  const hasEthers = (typeof window !== "undefined" && window.ethers && window.ethers.utils);
  if (!hasEthers) console.warn("ethers.js missing on window. Core features need ethers.");

  const ethers = window.ethers || null;

  function formatUnitsSafe(bn, decimals, precision = 4, withGrouping = false) {
    try {
      if (!bn) return "0";
      const str = ethers.utils.formatUnits(bn, decimals);
      const num = Number(str);
      if (!Number.isFinite(num)) return "0";
      if (withGrouping) {
        return num.toLocaleString(undefined, { maximumFractionDigits: precision });
      } else {
        return num.toFixed(precision);
      }
    } catch { return "0"; }
  }

  function formatVinDisplay(bn, precision = 4) { return formatUnitsSafe(bn, VIN_DECIMALS, precision, true); }
  function formatVinPlain(bn, precision = 6) { return formatUnitsSafe(bn, VIN_DECIMALS, precision, false); }
  function formatMonDisplay(bn, precision = 4) { return formatUnitsSafe(bn, MON_DECIMALS, precision, true); }
  function formatMonPlain(bn, precision = 6) { return formatUnitsSafe(bn, MON_DECIMALS, precision, false); }

  // ===================== Robust Parsers =====================
  function _normalizeNumberStringToDot(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (s === "") return null;
    // replace comma with dot, remove non-digit/dot
    s = s.replace(/,/g, ".").replace(/[^\d.]/g, "");
    if (!s || s === ".") return null;
    const parts = s.split(".");
    if (parts.length > 1) {
      const intPart = parts.shift();
      const fracPart = parts.join("");
      s = intPart + "." + fracPart;
    }
    return s;
  }

  function parseVinInput(str) {
    if (!hasEthers) return null;
    const norm = _normalizeNumberStringToDot(str);
    if (!norm) return null;
    try { return ethers.utils.parseUnits(norm, VIN_DECIMALS); }
    catch { return null; }
  }

  function parseMonInput(str) {
    if (!hasEthers) return null;
    const norm = _normalizeNumberStringToDot(str);
    if (!norm) return null;
    try { return ethers.utils.parseUnits(norm, MON_DECIMALS); }
    catch { return null; }
  }

  // Expose parsers globally (compat)
  window.parseVinInput = parseVinInput;
  window.parseMonInput = parseMonInput;
  window.formatVinPlain = formatVinPlain;
  window.formatMonPlain = formatMonPlain;

  // ===================== Provider & Contracts =====================
  function initReadProvider() {
    if (!rpcProvider) {
      rpcProvider = new ethers.providers.JsonRpcProvider(RPC_URL, { name: "monad", chainId: MONAD_CHAIN_ID_DEC });
    }
    if (!vinRead) vinRead = new ethers.Contract(VIN_TOKEN_ADDRESS, VIN_ABI, rpcProvider);
    if (!swapRead) swapRead = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, rpcProvider);
    if (!diceRead) diceRead = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, rpcProvider);
  }

  function initWriteContracts() {
    if (!web3Provider || !signer) return;
    vinWrite = new ethers.Contract(VIN_TOKEN_ADDRESS, VIN_ABI, signer);
    swapWrite = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, signer);
    diceWrite = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, signer);
  }

  // ===================== Network Helpers =====================
  async function ensureMonadNetwork() {
    if (!window.ethereum) { alert("MetaMask (or compatible) required."); return false; }
    try {
      const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
      if (chainIdHex === MONAD_CHAIN_ID_HEX) return true;
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_CHAIN_ID_HEX }] });
      return true;
    } catch (err) {
      console.error("ensureMonadNetwork error:", err);
      alert("Please switch wallet to Monad (chainId 143).");
      return false;
    }
  }

  function setNetworkStatus(connected) {
    const dot = $("networkDot");
    const label = $("networkName");
    const labelHome = $("networkNameHome");
    if (dot) { dot.classList.toggle("dot-connected", connected); dot.classList.toggle("dot-disconnected", !connected); }
    if (label) label.textContent = connected ? "Monad" : "Not connected";
    if (labelHome) labelHome.textContent = connected ? "Monad" : "Not connected";
  }

  // ===================== Balances & Dice Limits =====================
  async function refreshBalances() {
    try {
      initReadProvider();
      if (!currentAccount) {
        setText("walletAddressShort", "Not connected");
        setText("diceWalletAddressShort", "Not connected");
        setText("vinBalance", "-");
        setText("monBalance", "-");
        setText("diceVinBalance", "-");
        setText("diceMonBalance", "-");
        return;
      }
      const [vinBal, monBal, bankBal] = await Promise.all([vinRead.balanceOf(currentAccount), rpcProvider.getBalance(currentAccount), diceRead.getBankBalance()]);
      const addrShort = shortenAddress(currentAccount);
      setText("walletAddressShort", addrShort);
      setText("diceWalletAddressShort", addrShort);
      setText("vinBalance", `${formatVinDisplay(vinBal,4)} VIN`);
      setText("monBalance", `${formatMonDisplay(monBal,4)} MON`);
      const bankStr = formatVinDisplay(bankBal,4);
      setText("globalDicePoolVin", `${bankStr} VIN`);
      setText("dicePoolVin", `${bankStr} VIN`);
      setText("dicePoolVinTop", `${bankStr} VIN`);
    } catch (err) {
      console.error("refreshBalances error:", err);
    }
  }

  async function updateDicePool() {
    try {
      initReadProvider();
      const bankBal = await diceRead.getBankBalance();
      const bankStr = formatVinDisplay(bankBal,4);
      setText("globalDicePoolVin", `${bankStr} VIN`);
      setText("dicePoolVin", `${bankStr} VIN`);
      setText("dicePoolVinTop", `${bankStr} VIN`);
    } catch (err) { console.error("updateDicePool error:", err); }
  }

  async function updateDiceLimitsAndAllowance() {
    try {
      initReadProvider();
      const [minBet, maxBet] = await Promise.all([diceRead.MIN_BET(), diceRead.getMaxBet()]);
      diceMinBetBN = minBet;
      diceMaxBetBN = maxBet;
      if (currentAccount) {
        const allowance = await vinRead.allowance(currentAccount, DICE_CONTRACT_ADDRESS);
        diceAllowanceBN = allowance;
        setText("diceAllowance", `${formatVinDisplay(allowance,4)} VIN`);
      }
    } catch (err) {
      console.error("updateDiceLimitsAndAllowance error:", err);
    }
  }

  // ===================== Swap Logic =====================
  function getSwapInputElements() {
    return { fromAmountEl: $("swapFromAmount"), toAmountEl: $("swapToAmount"), statusEl: $("swapStatus") };
  }

  function recalcSwapOutput() {
    const { fromAmountEl, toAmountEl, statusEl } = getSwapInputElements();
    if (!fromAmountEl || !toAmountEl) return;
    const raw = (fromAmountEl.value || "").trim();
    if (!raw) { toAmountEl.value = ""; if (statusEl) statusEl.textContent = ""; return; }
    let fromBn;
    if (swapDirection === "vinToMon") fromBn = parseVinInput(raw); else fromBn = parseMonInput(raw);
    if (!fromBn || fromBn.lte(0)) { toAmountEl.value = ""; if (statusEl) statusEl.textContent = "Invalid amount."; return; }
    const toBn = fromBn;
    if (swapDirection === "vinToMon") toAmountEl.value = formatMonPlain(toBn,6); else toAmountEl.value = formatVinPlain(toBn,6);
    if (statusEl) statusEl.textContent = "Ready to swap.";
  }

  async function handleSwapMax() {
    try {
      if (!currentAccount) { alert("Please connect wallet."); return; }
      initReadProvider();
      const { fromAmountEl } = getSwapInputElements();
      if (!fromAmountEl) return;
      const [vinBal, monBal] = await Promise.all([vinRead.balanceOf(currentAccount), rpcProvider.getBalance(currentAccount)]);
      if (swapDirection === "vinToMon") fromAmountEl.value = formatVinPlain(vinBal,6); else fromAmountEl.value = formatMonPlain(monBal,6);
      recalcSwapOutput();
    } catch (err) { console.error("handleSwapMax error:", err); }
  }

  async function handleSwapAction() {
    const { fromAmountEl, statusEl } = getSwapInputElements();
    if (!fromAmountEl || !statusEl) return;
    if (!currentAccount || !web3Provider || !signer) { alert("Please connect wallet."); return; }
    if (!(await ensureMonadNetwork())) return;
    initReadProvider(); initWriteContracts();
    const raw = (fromAmountEl.value || "").trim();
    if (!raw) { statusEl.textContent = "Please enter an amount."; return; }
    try {
      const [vinBal, monBal] = await Promise.all([vinRead.balanceOf(currentAccount), rpcProvider.getBalance(currentAccount)]);
      if (swapDirection === "vinToMon") {
        const amountBN = parseVinInput(raw);
        if (!amountBN || amountBN.lte(0)) { statusEl.textContent = "Invalid VIN amount."; return; }
        if (vinBal.lt(amountBN)) { statusEl.textContent = "Insufficient VIN balance."; return; }
        const allowance = await vinRead.allowance(currentAccount, SWAP_CONTRACT_ADDRESS);
        if (allowance.lt(amountBN)) {
          statusEl.textContent = "Approving VIN for the swap contract...";
          const approveTx = await vinWrite.approve(SWAP_CONTRACT_ADDRESS, ethers.constants.MaxUint256);
          await approveTx.wait();
        }
        statusEl.textContent = "Sending VIN→MON swap transaction...";
        const gasEstimate = await swapWrite.estimateGas.swapVinForMon(amountBN);
        const gasLimit = gasEstimate.mul(120).div(100);
        const tx = await swapWrite.swapVinForMon(amountBN, { gasLimit });
        const receipt = await tx.wait();
        if (receipt.status !== 1) { statusEl.textContent = "Swap transaction reverted."; return; }
        statusEl.textContent = "Swap VIN→MON successful!";
      } else {
        const amountBN = parseMonInput(raw);
        if (!amountBN || amountBN.lte(0)) { statusEl.textContent = "Invalid MON amount."; return; }
        if (monBal.lt(amountBN)) { statusEl.textContent = "Insufficient MON balance."; return; }
        statusEl.textContent = "Sending MON→VIN swap transaction...";
        const gasEstimate = await swapWrite.estimateGas.swapMonForVin({ value: amountBN });
        const gasLimit = gasEstimate.mul(120).div(100);
        const tx = await swapWrite.swapMonForVin({ value: amountBN, gasLimit });
        const receipt = await tx.wait();
        if (receipt.status !== 1) { statusEl.textContent = "Swap transaction reverted."; return; }
        statusEl.textContent = "Swap MON→VIN successful!";
      }
      await Promise.all([refreshBalances(), refreshSwapBalancesLabels(), updateDicePool()]);
      recalcSwapOutput();
    } catch (err) {
      console.error("handleSwapAction error:", err);
      const reason = (err && err.message) ? err.message : "";
      const { statusEl: st } = getSwapInputElements();
      if (st) st.textContent = "Swap failed on-chain. " + (reason || "");
      alert("Swap failed on-chain. " + (reason || ""));
    }
  }

  function refreshSwapBalancesLabels() {
    (async () => {
      try {
        initReadProvider();
        const fromLabel = $("fromBalanceLabel");
        const toLabel = $("toBalanceLabel");
        if (!currentAccount || !fromLabel || !toLabel) return;
        const [vinBal, monBal] = await Promise.all([vinRead.balanceOf(currentAccount), rpcProvider.getBalance(currentAccount)]);
        const vinStr = formatVinDisplay(vinBal,4);
        const monStr = formatMonDisplay(monBal,4);
        if (swapDirection === "vinToMon") { fromLabel.textContent = `Balance: ${vinStr} VIN`; toLabel.textContent = `Balance: ${monStr} MON`; }
        else { fromLabel.textContent = `Balance: ${monStr} MON`; toLabel.textContent = `Balance: ${vinStr} VIN`; }
      } catch (err) { console.error("refreshSwapBalancesLabels error:", err); }
    })();
  }

  function updateSwapDirectionUI() {
    const tabVinToMon = $("tabVinToMon");
    const tabMonToVin = $("tabMonToVin");
    const fromToken = $("swapFromToken");
    const toToken = $("swapToToken");
    const rateLabel = $("swapRateLabel");
    if (tabVinToMon && tabMonToVin) {
      tabVinToMon.classList.remove("active"); tabMonToVin.classList.remove("active");
      if (swapDirection === "vinToMon") tabVinToMon.classList.add("active"); else tabMonToVin.classList.add("active");
    }
    if (fromToken && toToken) {
      if (swapDirection === "vinToMon") { fromToken.textContent = "VIN"; toToken.textContent = "MON"; }
      else { fromToken.textContent = "MON"; toToken.textContent = "VIN"; }
    }
    if (rateLabel) rateLabel.textContent = "Rate: 1 VIN = 1 MON (no fee)";
  }

  // ===================== Dice Logic =====================
  function getCurrentDiceChoice() { return diceGuessEven ? 0 : 1; }

  function onGuessButtonClick(isEven) {
    diceGuessEven = isEven;
    const evenBtn = $("guessEvenButton"), oddBtn = $("guessOddButton");
    if (evenBtn && oddBtn) {
      if (isEven) { evenBtn.classList.add("active"); oddBtn.classList.remove("active"); }
      else { oddBtn.classList.add("active"); evenBtn.classList.remove("active"); }
    }
  }

  function setDiceVisual(resultEven) {
    const visual = $("diceVisual");
    if (!visual) return;
    visual.classList.remove("dice-even","dice-odd");
    const coins = visual.querySelectorAll(".dice-coin");
    if (!coins || coins.length !== 4) return;
    if (resultEven === null || resultEven === undefined) return;
    function shuffleArray(arr){ const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const tmp=a[i]; a[i]=a[j]; a[j]=tmp; } return a; }
    let patternBits;
    if (resultEven) {
      const t = Math.floor(Math.random()*3);
      if (t===0) patternBits=[0,0,0,0];
      else if (t===1) patternBits=[1,1,1,1];
      else patternBits = shuffleArray([1,1,0,0]);
      visual.classList.add("dice-even");
    } else {
      const t = Math.floor(Math.random()*2);
      if (t===0) patternBits = shuffleArray([1,0,0,0]);
      else patternBits = shuffleArray([1,1,1,0]);
      visual.classList.add("dice-odd");
    }
    coins.forEach((coin, idx) => {
      coin.classList.remove("dice-coin-red","dice-coin-white");
      if (patternBits[idx]===1) coin.classList.add("dice-coin-red"); else coin.classList.add("dice-coin-white");
    });
  }

  function updateDiceLastResultUI() {
    const resEl = $("diceLastResult"), outcomeEl = $("diceLastOutcome"), winLossEl = $("diceLastWinLoss"), payoutEl = $("diceLastPayout"), txEl = $("diceLastTx");
    if (!lastDiceGame) {
      if (resEl) resEl.textContent="-";
      if (outcomeEl) outcomeEl.textContent="-";
      if (winLossEl) winLossEl.textContent="-";
      if (payoutEl) payoutEl.textContent="-";
      if (txEl) txEl.textContent="-";
      setDiceVisual(null);
      return;
    }
    const { amountVin, choiceEven, resultEven, won, payoutVin, txHash } = lastDiceGame;
    if (resEl) resEl.textContent = `Last roll - Bet: ${choiceEven ? "Even" : "Odd"}, Amount: ${amountVin}`;
    if (outcomeEl) outcomeEl.textContent = `Outcome: ${resultEven ? "Even" : "Odd"}`;
    if (winLossEl) winLossEl.textContent = won ? "You: WON" : "You: lost";
    if (payoutEl) payoutEl.textContent = `Payout: ${payoutVin}`;
    if (txEl) txEl.textContent = txHash ? (txHash.slice(0,10) + "..." + txHash.slice(-6)) : "-";
    setDiceVisual(resultEven);
  }

  // Approve handler
  async function handleDiceApprove() {
    try {
      if (!currentAccount || !web3Provider || !signer) { alert("Please connect wallet."); return; }
      if (!(await ensureMonadNetwork())) return;
      initWriteContracts();
      const statusEl = $("diceStatus"); if (statusEl) statusEl.textContent = "Sending approve transaction...";
      const maxAmount = ethers.utils.parseUnits("100000000", VIN_DECIMALS);
      const tx = await vinWrite.approve(DICE_CONTRACT_ADDRESS, maxAmount);
      const receipt = await tx.wait();
      if (receipt.status !== 1) { if (statusEl) statusEl.textContent = "Approve transaction reverted."; return; }
      if (statusEl) statusEl.textContent = "Approve successful.";
      await updateDiceLimitsAndAllowance(); await refreshBalances();
    } catch (err) {
      console.error("handleDiceApprove error:", err);
      const statusEl = $("diceStatus"); if (statusEl) statusEl.textContent = "Approve failed on-chain.";
      alert("Approve failed on-chain. " + (err && err.message ? err.message : ""));
    }
  }

  function getDiceBetAmountBN() {
    const input = $("diceBetAmount"); if (!input) return null; const raw = (input.value||"").trim(); if (!raw) return null; return parseVinInput(raw);
  }

  function setDiceBetAmountFromBN(bn) { const input = $("diceBetAmount"); if (!input || !bn) return; input.value = formatVinPlain(bn,6); }

  async function handleDicePlay() {
    const statusEl = $("diceStatus"); const visual = $("diceVisual");
    try {
      if (!currentAccount || !web3Provider || !signer) { alert("Please connect wallet."); return; }
      if (!(await ensureMonadNetwork())) return;
      initReadProvider(); initWriteContracts();
      const amountBN = getDiceBetAmountBN(); if (!amountBN || amountBN.lte(0)) { if (statusEl) statusEl.textContent = "Invalid bet amount."; return; }
      if (diceMinBetBN && amountBN.lt(diceMinBetBN)) { const minStr = formatVinDisplay(diceMinBetBN); if (statusEl) statusEl.textContent = `Bet is below minimum: ${minStr} VIN.`; alert(`Bet is below minimum: ${minStr} VIN.`); return; }
      if (diceMaxBetBN && amountBN.gt(diceMaxBetBN)) { const maxStr = formatVinDisplay(diceMaxBetBN); if (statusEl) statusEl.textContent = `Bet is above recommended maximum: ${maxStr} VIN.`; if (!window.confirm(`This bet is higher than the recommended maximum (${maxStr} VIN). Continue anyway?`)) return; }
      const vinBal = await vinRead.balanceOf(currentAccount);
      if (vinBal.lt(amountBN)) { if (statusEl) statusEl.textContent = "Insufficient VIN balance."; alert("Insufficient VIN balance."); return; }
      const allowance = await vinRead.allowance(currentAccount, DICE_CONTRACT_ADDRESS); diceAllowanceBN = allowance;
      if (allowance.lt(amountBN)) { if (statusEl) statusEl.textContent = "Dice allowance is too low."; alert("Dice allowance is too low. Please Approve VIN for Dice."); return; }
      if (visual) visual.classList.add("dice-shaking");
      lastDiceBetBN = amountBN;
      const choice = getCurrentDiceChoice();
      const clientSeed = (window.crypto && window.crypto.getRandomValues) ? (function(){ const arr=new Uint32Array(2); window.crypto.getRandomValues(arr); const high=BigInt(arr[0]); const low=BigInt(arr[1]); return high*(1n<<32n)+low; })() : BigInt(Date.now());
      let gasLimit;
      try {
        const gasEstimate = await diceWrite.estimateGas.play(amountBN, choice, clientSeed);
        gasLimit = gasEstimate.mul(120).div(100);
      } catch (err) {
        console.error("Dice estimateGas error:", err);
        const reason = (err && err.message) ? err.message : "";
        if (statusEl) statusEl.textContent = "This bet would revert on-chain. " + (reason || "");
        alert("This bet would revert on-chain. " + (reason || ""));
        return;
      }
      if (statusEl) statusEl.textContent = "Sending Dice transaction...";
      const tx = await diceWrite.play(amountBN, choice, clientSeed, { gasLimit });
      const receipt = await tx.wait();
      if (receipt.status !== 1) { if (statusEl) statusEl.textContent = "Dice transaction reverted."; return; }
      // parse Played event
      const iface = new ethers.utils.Interface(DICE_ABI);
      let parsedEvent = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed.name === "Played") { parsedEvent = parsed; break; }
        } catch { /* ignore */ }
      }
      if (parsedEvent) {
        const { player, amount, choice, result, won } = parsedEvent.args;
        const amountStr = formatVinDisplay(amount,4);
        const payoutBN = amount.mul(2);
        const payoutStr = won ? `${formatVinDisplay(payoutBN,4)} VIN` : "0 VIN";
        lastDiceGame = { player, amountVin: `${amountStr} VIN`, choiceEven: choice===0, resultEven: result===0, won, payoutVin: payoutStr, txHash: receipt.transactionHash };
        if (statusEl) statusEl.textContent = won ? `You WON! Payout: ${payoutStr}` : "You lost this round.";
        updateDiceLastResultUI();
      } else {
        if (statusEl) statusEl.textContent = "Dice transaction confirmed, but event not found.";
      }
      await Promise.all([refreshBalances(), updateDicePool()]);
    } catch (err) {
      console.error("handleDicePlay error:", err);
      const reason = (err && err.message) ? err.message : "";
      const st = $("diceStatus");
      if (st) st.textContent = "Dice transaction failed on-chain. " + (reason || "");
      alert("Dice transaction failed on-chain. " + (reason || ""));
    } finally {
      if (visual) visual.classList.remove("dice-shaking");
    }
  }

  function initDiceEvents() {
    const evenBtn = $("guessEvenButton"), oddBtn = $("guessOddButton"), approveBtn = $("diceApproveButton"), playBtn = $("dicePlayButton"), maxBtn = $("diceMaxButton"), repeatBtn = $("diceRepeatButton"), halfBtn = $("diceHalfButton"), doubleBtn = $("diceDoubleButton"), clearBtn = $("diceClearButton"), refreshLastBtn = $("diceRefreshLast");
    if (evenBtn) evenBtn.addEventListener("click", () => onGuessButtonClick(true));
    if (oddBtn) oddBtn.addEventListener("click", () => onGuessButtonClick(false));
    if (approveBtn) approveBtn.addEventListener("click", () => handleDiceApprove());
    if (playBtn) playBtn.addEventListener("click", () => handleDicePlay());
    if (maxBtn) maxBtn.addEventListener("click", async () => { try { if (!currentAccount) { alert("Please connect wallet."); return; } initReadProvider(); const vinBal = await vinRead.balanceOf(currentAccount); setDiceBetAmountFromBN(vinBal); } catch (err) { console.error("diceMaxButton error:", err); } });
    if (repeatBtn) repeatBtn.addEventListener("click", () => { if (lastDiceBetBN) setDiceBetAmountFromBN(lastDiceBetBN); });
    if (halfBtn) halfBtn.addEventListener("click", () => { const bn = getDiceBetAmountBN(); if (!bn) return; const half = bn.div(2); if (half.gt(0)) setDiceBetAmountFromBN(half); });
    if (doubleBtn) doubleBtn.addEventListener("click", () => { const bn = getDiceBetAmountBN(); if (!bn) return; const doubled = bn.mul(2); setDiceBetAmountFromBN(doubled); });
    if (clearBtn) clearBtn.addEventListener("click", () => { const input = $("diceBetAmount"); if (input) input.value = ""; });
    if (refreshLastBtn) refreshLastBtn.addEventListener("click", () => { updateDiceLastResultUI(); updateDicePool(); });
    onGuessButtonClick(true);
  }

  // ===================== Wallet =====================
  async function connectWallet() {
    try {
      if (!window.ethereum) { alert("MetaMask (or compatible) required."); return; }
      const ok = await ensureMonadNetwork(); if (!ok) return;
      web3Provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      if (!accounts || accounts.length === 0) { alert("No accounts found"); return; }
      currentAccount = ethers.utils.getAddress(accounts[0]);
      signer = web3Provider.getSigner();
      initWriteContracts();
      const connectBtn = $("connectButton");
      if (connectBtn) { connectBtn.textContent = shortenAddress(currentAccount); connectBtn.classList.add("btn-connected"); }
      setNetworkStatus(true);
      await Promise.all([
        (async () => { try { initReadProvider(); const dec = await vinRead.decimals(); VIN_DECIMALS = Number(dec); } catch (e) { console.error("Failed to read VIN decimals, defaulting to 18.", e); VIN_DECIMALS = 18; } })(),
        refreshBalances(), refreshSwapBalancesLabels(), updateDicePool(), updateDiceLimitsAndAllowance()
      ]);
      updateDiceLastResultUI();
    } catch (err) {
      console.error("connectWallet error:", err);
      alert("Failed to connect wallet. Please try again.");
    }
  }

  function initWalletEvents() {
    const connectBtn = $("connectButton"), refreshBtn = $("refreshBalances");
    if (connectBtn) connectBtn.addEventListener("click", connectWallet);
    if (refreshBtn) refreshBtn.addEventListener("click", async () => { await refreshBalances(); await updateDicePool(); });
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (!accounts || accounts.length === 0) {
          currentAccount = null; signer = null; web3Provider = null; setText("walletAddressShort", "Not connected"); setText("diceWalletAddressShort", "Not connected"); setNetworkStatus(false);
          const cb = $("connectButton"); if (cb) { cb.textContent = "Connect Wallet"; cb.classList.remove("btn-connected"); }
        } else {
          currentAccount = ethers.utils.getAddress(accounts[0]);
          if (web3Provider) { signer = web3Provider.getSigner(); initWriteContracts(); }
          setText("walletAddressShort", shortenAddress(currentAccount)); setText("diceWalletAddressShort", shortenAddress(currentAccount)); setNetworkStatus(true);
          refreshBalances(); refreshSwapBalancesLabels(); updateDicePool(); updateDiceLimitsAndAllowance();
        }
      });

      window.ethereum.on("chainChanged", (chainId) => {
        if (chainId !== MONAD_CHAIN_ID_HEX) setNetworkStatus(false); else { setNetworkStatus(true); refreshBalances(); refreshSwapBalancesLabels(); updateDicePool(); updateDiceLimitsAndAllowance(); }
      });
    }
  }

  // ===================== Init UI wiring =====================
  function initNav() {
    const navHome = $("navHome"), navSwap = $("navSwap"), navDice = $("navDice"), goToSwap = $("goToSwap"), goToDice = $("goToDice");
    if (navHome) navHome.addEventListener("click", () => showScreen("home-screen"));
    if (navSwap) navSwap.addEventListener("click", () => showScreen("swap-screen"));
    if (navDice) navDice.addEventListener("click", () => showScreen("dice-screen"));
    if (goToSwap) goToSwap.addEventListener("click", () => showScreen("swap-screen"));
    if (goToDice) goToDice.addEventListener("click", () => showScreen("dice-screen"));
  }

  function initSwapEvents() {
    const tabVinToMon = $("tabVinToMon"), tabMonToVin = $("tabMonToVin"), fromAmountEl = $("swapFromAmount"), maxBtn = $("swapMaxButton"), actionBtn = $("swapActionButton");
    if (tabVinToMon) tabVinToMon.addEventListener("click", () => { swapDirection = "vinToMon"; updateSwapDirectionUI(); refreshSwapBalancesLabels(); recalcSwapOutput(); });
    if (tabMonToVin) tabMonToVin.addEventListener("click", () => { swapDirection = "monToVin"; updateSwapDirectionUI(); refreshSwapBalancesLabels(); recalcSwapOutput(); });
    if (fromAmountEl) fromAmountEl.addEventListener("input", recalcSwapOutput);
    if (maxBtn) maxBtn.addEventListener("click", handleSwapMax);
    if (actionBtn) actionBtn.addEventListener("click", handleSwapAction);
    updateSwapDirectionUI();
  }

  // ===================== Init App =====================
  async function initApp() {
    try {
      initReadProvider();
      setNetworkStatus(false);
      initNav();
      initSwapEvents();
      initDiceEvents();
      initWalletEvents();
      await updateDicePool();
      updateDiceLastResultUI();
    } catch (err) { console.error("initApp error:", err); }
  }

  document.addEventListener("DOMContentLoaded", initApp);

  // Expose some globals (compat)
  window.getDiceBetAmountBN = getDiceBetAmountBN;
  window.setDiceBetAmountFromBN = setDiceBetAmountFromBN;
  window.parseVinInput = parseVinInput;
  window.parseMonInput = parseMonInput;
  window.formatVinPlain = formatVinPlain;
  window.formatMonPlain = formatMonPlain;

  console.log("app.js replacement loaded. VIN_DECIMALS:", VIN_DECIMALS);
})();
