// app.js - VinMonDice dApp logic (Swap & Dice)
// Network: Monad (chainId 143)
// VINTokenV2: 0xfB71cbd8CB6f0fb72a9568f11e7E4454309A9cA1
// Swap V2:    0x11395DB7E0AcB7c56fE79FBAFFD48B5BeC896098
// Dice V2:    0x245Fb6ECC6B2beCaf45AC15E4fAc8C78826f0F67

(() => {
  "use strict";

  // ===== Constants =====
  const RPC_URL = "https://rpc.monad.xyz";
  const MONAD_CHAIN_ID_DEC = 143;
  const MONAD_CHAIN_ID_HEX = "0x8f"; // 143 in hex

  const VIN_TOKEN_ADDRESS = "0xfB71cbd8CB6f0fb72a9568f11e7E4454309A9cA1";
  const SWAP_CONTRACT_ADDRESS = "0x11395DB7E0AcB7c56fE79FBAFFD48B5BeC896098";
  const DICE_CONTRACT_ADDRESS = "0x245Fb6ECC6B2beCaf45AC15E4fAc8C78826f0F67";

  const MON_DECIMALS = 18; // native MON uses 18 decimals
  let VIN_DECIMALS = 18;   // will be read from VIN token on init

  // ===== ABIs (minimal) =====

  // VINTokenV2 (ERC20)
  const VIN_ABI = [
    {
      constant: true,
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" }
      ],
      name: "allowance",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: false,
      inputs: [
        {
          name: "spender",
          type: "address"
        },
        {
          name: "amount",
          type: "uint256"
        }
      ],
      name: "approve",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function"
    },
    {
      constant: true,
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: true,
      inputs: [],
      name: "decimals",
      outputs: [{ name: "", type: "uint8" }],
      stateMutability: "view",
      type: "function"
    }
  ];

  // Swap V2
  const SWAP_ABI = [
    {
      constant: true,
      inputs: [],
      name: "vinToken",
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: true,
      inputs: [],
      name: "monReserve",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: true,
      inputs: [],
      name: "vinReserve",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: true,
      inputs: [],
      name: "getRateMonToVin",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: true,
      inputs: [],
      name: "getRateVinToMon",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: true,
      inputs: [
        { name: "amountVin", type: "uint256" }
      ],
      name: "getMonOutForVinIn",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: true,
      inputs: [
        { name: "amountMon", type: "uint256" }
      ],
      name: "getVinOutForMonIn",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      constant: false,
      inputs: [
        { name: "amountVinIn", type: "uint256" }
      ],
      name: "swapVinToMon",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function"
    },
    {
      constant: false,
      inputs: [],
      name: "swapMonToVin",
      outputs: [],
      stateMutability: "payable",
      type: "function"
    }
  ];

  // Dice V2
  const DICE_ABI = [
    {
      inputs: [],
      name: "MIN_BET",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      inputs: [],
      name: "bank",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      // getMaxBet() - view recommended max bet based on bank
      inputs: [],
      name: "getMaxBet",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function"
    },
    {
      // Core: play(uint256 amount, uint8 choice, bytes32 clientSeed)
      inputs: [
        { internalType: "uint256", name: "amount", type: "uint256" },
        { internalType: "uint8", name: "choice", type: "uint8" },
        { internalType: "bytes32", name: "clientSeed", type: "bytes32" }
      ],
      name: "play",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function"
    },
    {
      // Event Played
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "player",
          type: "address"
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "amount",
          type: "uint256"
        },
        {
          indexed: false,
          internalType: "uint8",
          name: "choice",
          type: "uint8"
        },
        {
          indexed: false,
          internalType: "uint8",
          name: "result",
          type: "uint8"
        },
        {
          indexed: false,
          internalType: "bool",
          name: "won",
          type: "bool"
        }
      ],
      name: "Played",
      type: "event"
    }
  ];

  // ===== Global state =====
  let web3Provider = null;
  let ethersProvider = null;
  let signer = null;
  let currentAccount = null;

  let vinRead = null;  // ethers.Contract (read)
  let vinWrite = null; // ethers.Contract (write via signer)
  let swapRead = null;
  let swapWrite = null;
  let diceRead = null;
  let diceWrite = null;

  let swapDirection = "vinToMon"; // or "monToVin"

  let diceMinBetBN = null;
  let diceMaxBetBN = null;
  let diceBankBN = null;
  let diceAllowanceBN = null;

  let lastDiceGame = null;
  let lastDiceBetBN = null;

  let vinBalanceBN = null;
  let monBalanceBN = null;

  // ===== Utility helpers =====
  function $(id) {
    return document.getElementById(id);
  }

  function formatMonDisplay(balanceBN, decimals = 4) {
    if (!balanceBN) return "-";
    try {
      const s = ethers.utils.formatUnits(balanceBN, MON_DECIMALS);
      const num = Number(s);
      if (!isFinite(num)) return s;
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
      });
    } catch {
      return balanceBN.toString();
    }
  }

  function formatVinDisplay(balanceBN, decimals = 4) {
    if (!balanceBN) return "-";
    try {
      const s = ethers.utils.formatUnits(balanceBN, VIN_DECIMALS);
      const num = Number(s);
      if (!isFinite(num)) return s;
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
      });
    } catch {
      return balanceBN.toString();
    }
  }

  function parseVinFromInput(value) {
    if (!value) return null;
    try {
      const trimmed = value.trim();
      if (!trimmed) return null;
      return ethers.utils.parseUnits(trimmed, VIN_DECIMALS);
    } catch (err) {
      return null;
    }
  }

  function parseMonFromInput(value) {
    if (!value) return null;
    try {
      const trimmed = value.trim();
      if (!trimmed) return null;
      return ethers.utils.parseUnits(trimmed, MON_DECIMALS);
    } catch (err) {
      return null;
    }
  }

  function shortenAddress(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  function setText(id, text) {
    const el = $(id);
    if (el) {
      el.textContent = text;
    }
  }

  function setHTML(id, html) {
    const el = $(id);
    if (el) {
      el.innerHTML = html;
    }
  }

  function setElementVisible(id, visible) {
    const el = $(id);
    if (!el) return;
    el.style.display = visible ? "" : "none";
  }

  function updateWalletUI() {
    const addrEl = $("walletAddress");
    const uiConnected = $("walletConnectedSection");
    const notConnected = $("walletNotConnectedSection");
    const homeWallet = $("homeWalletAddress");

    if (!currentAccount) {
      if (addrEl) addrEl.textContent = "Not connected";
      if (homeWallet) homeWallet.textContent = "-";
      setElementVisible("walletConnectedSection", false);
      setElementVisible("walletNotConnectedSection", true);
      return;
    }

    const shortAddr = shortenAddress(currentAccount);
    if (addrEl) addrEl.textContent = shortAddr;
    if (homeWallet) homeWallet.textContent = shortAddr;
    setElementVisible("walletConnectedSection", true);
    setElementVisible("walletNotConnectedSection", false);
  }

  // ===== Network & Provider =====
  function initReadProvider() {
    if (!ethersProvider) {
      ethersProvider = new ethers.providers.JsonRpcProvider(RPC_URL);
    }
    if (!vinRead) {
      vinRead = new ethers.Contract(VIN_TOKEN_ADDRESS, VIN_ABI, ethersProvider);
    }
    if (!swapRead) {
      swapRead = new ethers.Contract(
        SWAP_CONTRACT_ADDRESS,
        SWAP_ABI,
        ethersProvider
      );
    }
    if (!diceRead) {
      diceRead = new ethers.Contract(
        DICE_CONTRACT_ADDRESS,
        DICE_ABI,
        ethersProvider
      );
    }
  }

  function initWriteContracts() {
    if (!signer) return;
    if (!vinWrite) {
      vinWrite = new ethers.Contract(VIN_TOKEN_ADDRESS, VIN_ABI, signer);
    }
    if (!swapWrite) {
      swapWrite = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, signer);
    }
    if (!diceWrite) {
      diceWrite = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, signer);
    }
  }

  async function ensureMonadNetwork() {
    if (!window.ethereum) {
      alert(
        "No injected wallet found. Please install MetaMask or a compatible wallet for Monad."
      );
      return false;
    }

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId === MONAD_CHAIN_ID_HEX) {
      return true;
    }

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MONAD_CHAIN_ID_HEX }]
      });
      return true;
    } catch (switchError) {
      if (switchError.code === 4902 || switchError.code === -32603) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: MONAD_CHAIN_ID_HEX,
                chainName: "Monad",
                rpcUrls: [RPC_URL],
                nativeCurrency: {
                  name: "Monad",
                  symbol: "MON",
                  decimals: 18
                },
                blockExplorerUrls: ["https://monadvision.com"]
              }
            ]
          });
          return true;
        } catch (addErr) {
          console.error("Failed to add Monad network:", addErr);
          return false;
        }
      } else {
        console.error("Failed to switch chain:", switchError);
        return false;
      }
    }
  }

  // ===== Wallet connection =====
  async function connectWallet() {
    try {
      if (!window.ethereum) {
        alert(
          "No injected wallet found. Please install MetaMask or a compatible wallet for Monad."
        );
        return;
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts"
      });
      if (!accounts || !accounts.length) {
        alert("No accounts returned from wallet.");
        return;
      }

      currentAccount = ethers.utils.getAddress(accounts[0]);
      web3Provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      signer = web3Provider.getSigner();

      const net = await web3Provider.getNetwork();
      if (net.chainId !== MONAD_CHAIN_ID_DEC) {
        const ok = await ensureMonadNetwork();
        if (!ok) {
          alert("Please switch to Monad network in your wallet.");
          return;
        }
        web3Provider = new ethers.providers.Web3Provider(
          window.ethereum,
          "any"
        );
        signer = web3Provider.getSigner();
      }

      initReadProvider();
      initWriteContracts();

      await readVinDecimals();
      updateWalletUI();
      await refreshBalances();
      await Promise.all([
        updateSwapRates(),
        updateDiceInfo(),
        updateDiceLimitsAndAllowance()
      ]);

      setText("connectWalletButton", "Connected");
    } catch (err) {
      console.error("connectWallet error:", err);
      alert("Failed to connect wallet. Check browser console for details.");
    }
  }

  async function readVinDecimals() {
    try {
      initReadProvider();
      const dec = await vinRead.decimals();
      VIN_DECIMALS = dec;
    } catch (err) {
      console.warn("readVinDecimals failed, using default 18:", err);
    }
  }

  // ===== Balances & Rates =====
  async function refreshBalances() {
    try {
      initReadProvider();
      const homeMonEl = $("homeMonBalance");
      const homeVinEl = $("homeVinBalance");

      if (!currentAccount) {
        setText("walletMonBalance", "-");
        setText("walletVinBalance", "-");
        if (homeMonEl) homeMonEl.textContent = "-";
        if (homeVinEl) homeVinEl.textContent = "-";
        return;
      }

      const [monBal, vinBal] = await Promise.all([
        ethersProvider.getBalance(currentAccount),
        vinRead.balanceOf(currentAccount)
      ]);

      monBalanceBN = monBal;
      vinBalanceBN = vinBal;

      const monStr = formatMonDisplay(monBal, 4);
      const vinStr = formatVinDisplay(vinBal, 4);

      setText("walletMonBalance", monStr + " MON");
      setText("walletVinBalance", vinStr + " VIN");

      if (homeMonEl) homeMonEl.textContent = monStr + " MON";
      if (homeVinEl) homeVinEl.textContent = vinStr + " VIN";

      updateSwapBalanceLabels();
    } catch (err) {
      console.error("refreshBalances error:", err);
    }
  }

  async function updateSwapRates() {
    try {
      initReadProvider();
      const [rateVinToMon, rateMonToVin, monReserve, vinReserve] =
        await Promise.all([
          swapRead.getRateVinToMon(),
          swapRead.getRateMonToVin(),
          swapRead.monReserve(),
          swapRead.vinReserve()
        ]);

      const rv2m = Number(
        ethers.utils.formatUnits(rateVinToMon, MON_DECIMALS)
      );
      const rm2v = Number(
        ethers.utils.formatUnits(rateMonToVin, VIN_DECIMALS)
      );

      const rateLabel = $("swapRateLabel");
      if (rateLabel) {
        let text = "";
        if (swapDirection === "vinToMon") {
          text = `Rate: 1 VIN ≈ ${rv2m.toFixed(4)} MON (while pool has liquidity)`;
        } else {
          text = `Rate: 1 MON ≈ ${rm2v.toFixed(4)} VIN (while pool has liquidity)`;
        }
        rateLabel.textContent = text;
      }

      const monReserveStr = formatMonDisplay(monReserve, 4);
      const vinReserveStr = formatVinDisplay(vinReserve, 4);
      setText("swapMonReserve", monReserveStr + " MON");
      setText("swapVinReserve", vinReserveStr + " VIN");
    } catch (err) {
      console.error("updateSwapRates error:", err);
    }
  }

  function updateSwapBalanceLabels() {
    try {
      const fromBalanceLabel = $("swapFromBalanceLabel");
      const toBalanceLabel = $("swapToBalanceLabel");

      if (!fromBalanceLabel || !toBalanceLabel) return;

      const fromIsVin = swapDirection === "vinToMon";
      if (!currentAccount) {
        fromBalanceLabel.textContent = "Balance: -";
        toBalanceLabel.textContent = "Balance: -";
        return;
      }

      const vinStr = formatVinDisplay(vinBalanceBN, 4);
      const monStr = formatMonDisplay(monBalanceBN, 4);

      if (fromIsVin) {
        fromBalanceLabel.textContent = `Balance: ${vinStr} VIN`;
        toBalanceLabel.textContent = `Balance: ${monStr} MON`;
      } else {
        fromBalanceLabel.textContent = `Balance: ${monStr} MON`;
        toBalanceLabel.textContent = `Balance: ${vinStr} VIN`;
      }
    } catch (err) {
      console.error("updateSwapBalanceLabels error:", err);
    }
  }

  // ===== Swap UI logic =====
  function updateSwapDirectionUI() {
    const tabVinToMon = $("tabVinToMon");
    const tabMonToVin = $("tabMonToVin");
    const fromToken = $("swapFromToken");
    const toToken = $("swapToToken");
    const rateLabel = $("swapRateLabel");

    if (tabVinToMon && tabMonToVin) {
      tabVinToMon.classList.remove("active");
      tabMonToVin.classList.remove("active");
      if (swapDirection === "vinToMon") {
        tabVinToMon.classList.add("active");
      } else {
        tabMonToVin.classList.add("active");
      }
    }

    if (fromToken && toToken) {
      if (swapDirection === "vinToMon") {
        fromToken.textContent = "VIN";
        toToken.textContent = "MON";
      } else {
        fromToken.textContent = "MON";
        toToken.textContent = "VIN";
      }
    }

    const fromInput = $("swapFromInput");
    const toInput = $("swapToInput");
    if (fromInput) fromInput.value = "";
    if (toInput) toInput.value = "";

    updateSwapBalanceLabels();
    updateSwapRates();
  }

  function setSwapDirectionVinToMon() {
    swapDirection = "vinToMon";
    updateSwapDirectionUI();
  }

  function setSwapDirectionMonToVin() {
    swapDirection = "monToVin";
    updateSwapDirectionUI();
  }

  async function onSwapFromInputChange() {
    try {
      initReadProvider();
      const fromInput = $("swapFromInput");
      const toInput = $("swapToInput");
      if (!fromInput || !toInput) return;

      const raw = fromInput.value.trim();
      if (!raw) {
        toInput.value = "";
        return;
      }

      if (swapDirection === "vinToMon") {
        const amountVin = parseVinFromInput(raw);
        if (!amountVin || amountVin.lte(0)) {
          toInput.value = "";
          return;
        }
        const monOut = await swapRead.getMonOutForVinIn(amountVin);
        toInput.value = ethers.utils.formatUnits(monOut, MON_DECIMALS);
      } else {
        const amountMon = parseMonFromInput(raw);
        if (!amountMon || amountMon.lte(0)) {
          toInput.value = "";
          return;
        }
        const vinOut = await swapRead.getVinOutForMonIn(amountMon);
        toInput.value = ethers.utils.formatUnits(vinOut, VIN_DECIMALS);
      }
    } catch (err) {
      console.error("onSwapFromInputChange error:", err);
    }
  }

  function onSwapMaxClicked() {
    const fromInput = $("swapFromInput");
    if (!fromInput) return;

    if (!currentAccount) {
      alert("Please connect your wallet first.");
      return;
    }

    if (swapDirection === "vinToMon") {
      if (!vinBalanceBN) {
        alert("VIN balance not loaded yet.");
        return;
      }
      fromInput.value = ethers.utils.formatUnits(vinBalanceBN, VIN_DECIMALS);
    } else {
      if (!monBalanceBN) {
        alert("MON balance not loaded yet.");
        return;
      }
      fromInput.value = ethers.utils.formatUnits(monBalanceBN, MON_DECIMALS);
    }

    onSwapFromInputChange();
  }

  async function handleVinToMonSwap() {
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

      const fromInput = $("swapFromInput");
      if (!fromInput) return;

      const raw = fromInput.value.trim();
      if (!raw) {
        statusEl.textContent = "Enter VIN amount to swap.";
        return;
      }

      const amountVin = parseVinFromInput(raw);
      if (!amountVin || amountVin.lte(0)) {
        statusEl.textContent = "Invalid VIN amount.";
        return;
      }

      if (!vinBalanceBN || vinBalanceBN.lt(amountVin)) {
        statusEl.textContent = "Insufficient VIN balance.";
        alert("Insufficient VIN balance.");
        return;
      }

      const allowance = await vinRead.allowance(
        currentAccount,
        SWAP_CONTRACT_ADDRESS
      );
      if (allowance.lt(amountVin)) {
        statusEl.textContent =
          "VIN allowance for Swap is too low. Please approve in your wallet or use the Approve button (if available).";
        alert(
          "VIN allowance for Swap is too low.\n" +
            "Please approve VIN for the Swap contract in your wallet first."
        );
        return;
      }

      statusEl.textContent = "Estimating gas for VIN→MON swap...";

      let gasLimit;
      try {
        const gasEstimate = await swapWrite.estimateGas.swapVinToMon(amountVin);
        gasLimit = gasEstimate.mul(120).div(100);
      } catch (err) {
        console.error("swapVinToMon estimateGas reverted:", err);
        const reason = extractRevertReason(err);
        statusEl.textContent =
          "Swap would revert on-chain. " + (reason || "");
        alert(
          "Swap would revert on-chain.\n" +
            (reason ? `Reason: ${reason}` : "")
        );
        return;
      }

      statusEl.textContent = "Sending VIN→MON swap transaction...";
      const tx = await swapWrite.swapVinToMon(amountVin, { gasLimit });
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        statusEl.textContent = "Swap transaction reverted.";
        return;
      }
      statusEl.textContent = "Swap VIN→MON successful.";

      await refreshBalances();
      await updateSwapRates();
    } catch (err) {
      console.error("handleVinToMonSwap error:", err);
      const reason = extractRevertReason(err);
      const statusEl2 = $("swapStatus");
      if (statusEl2)
        statusEl2.textContent =
          "Swap transaction failed on-chain. " + (reason || "");
      alert(
        "Swap transaction failed on-chain.\n" +
          (reason ? `Reason: ${reason}` : "")
      );
    }
  }

  async function handleMonToVinSwap() {
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

      const fromInput = $("swapFromInput");
      if (!fromInput) return;

      const raw = fromInput.value.trim();
      if (!raw) {
        statusEl.textContent = "Enter MON amount to swap.";
        return;
      }

      const amountMon = parseMonFromInput(raw);
      if (!amountMon || amountMon.lte(0)) {
        statusEl.textContent = "Invalid MON amount.";
        return;
      }

      if (!monBalanceBN || monBalanceBN.lt(amountMon)) {
        statusEl.textContent = "Insufficient MON balance.";
        alert("Insufficient MON balance.");
        return;
      }

      statusEl.textContent = "Estimating gas for MON→VIN swap...";

      let gasLimit;
      try {
        const gasEstimate = await swapWrite.estimateGas.swapMonToVin({
          value: amountMon
        });
        gasLimit = gasEstimate.mul(120).div(100);
      } catch (err) {
        console.error("swapMonToVin estimateGas reverted:", err);
        const reason = extractRevertReason(err);
        statusEl.textContent =
          "Swap would revert on-chain. " + (reason || "");
        alert(
          "Swap would revert on-chain.\n" +
            (reason ? `Reason: ${reason}` : "")
        );
        return;
      }

      statusEl.textContent = "Sending MON→VIN swap transaction...";
      const tx = await swapWrite.swapMonToVin({ value: amountMon, gasLimit });
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        statusEl.textContent = "Swap transaction reverted.";
        return;
      }

      statusEl.textContent = "Swap MON→VIN successful.";
      await refreshBalances();
      await updateSwapRates();
    } catch (err) {
      console.error("handleMonToVinSwap error:", err);
      const reason = extractRevertReason(err);
      const statusEl2 = $("swapStatus");
      if (statusEl2)
        statusEl2.textContent =
          "Swap transaction failed on-chain. " + (reason || "");
      alert(
        "Swap transaction failed on-chain.\n" +
          (reason ? `Reason: ${reason}` : "")
      );
    }
  }

  async function handleSwap() {
    if (swapDirection === "vinToMon") {
      await handleVinToMonSwap();
    } else {
      await handleMonToVinSwap();
    }
  }

  // ===== Dice helpers =====
  function getCurrentDiceChoice() {
    const evenBtn = $("guessEvenButton");
    if (!evenBtn) return 0;
    return evenBtn.classList.contains("active") ? 0 : 1;
  }

  function setDiceChoice(isEven) {
    const evenBtn = $("guessEvenButton");
    const oddBtn = $("guessOddButton");
    if (!evenBtn || !oddBtn) return;

    if (isEven) {
      evenBtn.classList.add("active");
      oddBtn.classList.remove("active");
    } else {
      oddBtn.classList.add("active");
      evenBtn.classList.remove("active");
    }
  }

  function updateDiceChoiceUI() {
    const choice = getCurrentDiceChoice();
    const evenBtn = $("guessEvenButton");
    const oddBtn = $("guessOddButton");
    if (!evenBtn || !oddBtn) return;
    if (choice === 0) {
      evenBtn.classList.add("active");
      oddBtn.classList.remove("active");
    } else {
      oddBtn.classList.add("active");
      evenBtn.classList.remove("active");
    }
  }

  function setDiceShaking(isShaking) {
    const visual = $("diceVisual");
    if (!visual) return;
    if (isShaking) {
      visual.classList.add("dice-shaking");
    } else {
      visual.classList.remove("dice-shaking");
    }
  }

  function setDiceVisual(resultEven) {
    const visual = $("diceVisual");
    if (!visual) return;

    // Stop shaking when we show a final result
    visual.classList.remove("dice-shaking");

    const coinsContainer = visual.querySelector(".dice-coins");
    const coinEls = coinsContainer
      ? coinsContainer.querySelectorAll(".dice-coin")
      : null;

    if (!coinEls || coinEls.length !== 4) return;

    // Reset colors
    coinEls.forEach((coin) => {
      coin.classList.remove("dice-coin-white", "dice-coin-red");
    });

    // No result yet: show neutral 2 white, 2 red
    if (resultEven === null || resultEven === undefined) {
      coinEls[0].classList.add("dice-coin-white");
      coinEls[1].classList.add("dice-coin-red");
      coinEls[2].classList.add("dice-coin-white");
      coinEls[3].classList.add("dice-coin-red");
      return;
    }

    // Helper: random pattern with "redCount" red coins
    function buildPattern(redCount) {
      const indices = [0, 1, 2, 3];
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const pattern = [0, 0, 0, 0]; // 0 = white, 1 = red
      for (let k = 0; k < redCount; k++) {
        pattern[indices[k]] = 1;
      }
      return pattern;
    }

    let pattern;

    if (resultEven) {
      // EVEN: 3 patterns: 4 white, 4 red, or 2 red / 2 white
      const r = Math.floor(Math.random() * 3);
      if (r === 0) {
        pattern = [0, 0, 0, 0]; // 4 white
      } else if (r === 1) {
        pattern = [1, 1, 1, 1]; // 4 red
      } else {
        pattern = buildPattern(2); // 2 red, 2 white (positions random)
      }
    } else {
      // ODD: 2 patterns: 1 red or 3 red
      const redCount = Math.random() < 0.5 ? 1 : 3;
      pattern = buildPattern(redCount);
    }

    coinEls.forEach((coin, idx) => {
      const isRed = pattern[idx] === 1;
      coin.classList.add(isRed ? "dice-coin-red" : "dice-coin-white");
    });
  }

  function updateDiceLastResultUI() {
    const resEl = $("diceLastResult");
    const txLinkEl = $("diceLastResultTxLink");
    if (!resEl) return;

    if (!lastDiceGame) {
      resEl.textContent = "No game played yet.";
      if (txLinkEl) {
        txLinkEl.href = "#";
        txLinkEl.style.display = "none";
      }
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

    const choiceText = choiceEven ? "EVEN" : "ODD";
    const resultText = resultEven ? "EVEN" : "ODD";
    const wonText = won ? "WIN" : "LOSE";

    resEl.textContent = `Last result: You bet ${amountVin} on ${choiceText}, result: ${resultText}. You ${wonText}. Payout: ${payoutVin}.`;

    if (txLinkEl && txHash) {
      txLinkEl.href = `https://monadvision.com/tx/${txHash}`;
      txLinkEl.style.display = "inline-block";
    }

    setDiceVisual(resultEven);
  }

  function setDiceBetAmountFromBN(bn) {
    const input = $("diceBetAmount");
    if (!input || !bn) return;
    input.value = ethers.utils.formatUnits(bn, VIN_DECIMALS);
  }

  function getDiceBetAmountBN() {
    const input = $("diceBetAmount");
    if (!input) return null;
    const raw = input.value.trim();
    if (!raw) return null;
    return parseVinFromInput(raw);
  }

  async function updateDiceLimitsAndAllowance() {
    try {
      initReadProvider();
      const [minBet, maxBet] = await Promise.all([
        diceRead.MIN_BET(),
        diceRead.getMaxBet()
      ]);

      diceMinBetBN = minBet;
      diceMaxBetBN = maxBet;

      const minBetStr = formatVinDisplay(minBet);
      const maxBetStr = formatVinDisplay(maxBet, 4);

      setText(
        "diceMinInfo",
        `Min bet: ${minBetStr} VIN (2x payout on win)`
      );
      setText(
        "diceMinimumText",
        `Minimum bet: ${minBetStr} VIN. There is no hard maximum; for safety we recommend keeping each bet ≤ ${maxBetStr} VIN based on the current bank.`
      );

      if (currentAccount) {
        const allowance = await vinRead.allowance(
          currentAccount,
          DICE_CONTRACT_ADDRESS
        );
        diceAllowanceBN = allowance;
        updateDiceAllowanceDisplay();
      } else {
        diceAllowanceBN = null;
        updateDiceAllowanceDisplay();
      }
    } catch (err) {
      console.error("updateDiceLimitsAndAllowance error:", err);
    }
  }

  function updateDiceAllowanceDisplay() {
    const el = $("diceAllowanceInfo");
    if (!el) return;
    if (!diceAllowanceBN) {
      el.textContent = "Dice Allowance: -";
      return;
    }
    const val = formatVinDisplay(diceAllowanceBN, 4);
    el.textContent = `Dice Allowance: ${val} VIN`;
  }

  async function updateDiceInfo() {
    try {
      initReadProvider();

      const [bank, minBet] = await Promise.all([
        diceRead.bank(),
        diceRead.MIN_BET()
      ]);

      diceBankBN = bank;
      diceMinBetBN = minBet;

      const bankStr = formatVinDisplay(bank, 4);
      setText("diceBankroll", bankStr + " VIN");

      const minBetStr = formatVinDisplay(minBet, 6);
      setText("diceMinInfo", `Min bet: ${minBetStr} VIN (2x payout on win)`);

      if (!lastDiceGame) {
        setDiceVisual(null);
      }

      await updateDiceLimitsAndAllowance();
    } catch (err) {
      console.error("updateDiceInfo error:", err);
    }
  }

  async function handleDiceApprove() {
    try {
      if (!currentAccount || !web3Provider || !signer) {
        alert("Please connect your wallet first.");
        return;
      }
      if (!(await ensureMonadNetwork())) return;

      initWriteContracts();

      const statusEl = $("diceStatus");
      if (statusEl) statusEl.textContent = "Sending approve transaction...";

      const maxAmount = ethers.utils.parseUnits("100000000", VIN_DECIMALS); // 100,000,000 VIN
      const tx = await vinWrite.approve(DICE_CONTRACT_ADDRESS, maxAmount);
      const receipt = await tx.wait();

      if (receipt.status !== 1) {
        if (statusEl)
          statusEl.textContent = "Approve transaction reverted.";
        return;
      }

      diceAllowanceBN = maxAmount;
      updateDiceAllowanceDisplay();

      if (statusEl)
        statusEl.textContent =
          "Approve successful. You can now play Dice without re-approving.";
    } catch (err) {
      console.error("handleDiceApprove error:", err);
      const statusEl = $("diceStatus");
      const reason = extractRevertReason(err);
      if (statusEl)
        statusEl.textContent =
          "Approve transaction failed on-chain. " +
          (reason ? `Reason: ${reason}` : "");
      alert(
        "Approve transaction failed on-chain.\n" +
          (reason ? `Reason: ${reason}` : "")
      );
    }
  }

  function getRandomClientSeed() {
    const arr = new Uint8Array(32);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
    }
    return ethers.utils.hexlify(arr);
  }

  function extractRevertReason(err) {
    try {
      if (
        err &&
        err.error &&
        err.error.message &&
        typeof err.error.message === "string"
      ) {
        return err.error.message;
      }
      if (err && err.data && typeof err.data.message === "string") {
        return err.data.message;
      }
      if (err && typeof err.message === "string") {
        return err.message;
      }
      return "";
    } catch {
      return "";
    }
  }

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
        if (
          !window.confirm(
            `This bet is higher than the recommended maximum (${maxStr} VIN). Continue anyway?`
          )
        ) {
          return;
        }
      }

      const vinBal = await vinRead.balanceOf(currentAccount);
      if (vinBal.lt(amountBN)) {
        statusEl.textContent = "Insufficient VIN balance.";
        alert("Insufficient VIN balance.");
        return;
      }

      const allowance = await vinRead.allowance(
        currentAccount,
        DICE_CONTRACT_ADDRESS
      );
      diceAllowanceBN = allowance;
      if (allowance.lt(amountBN)) {
        const needStr = formatVinDisplay(amountBN);
        const allowStr = formatVinDisplay(allowance);
        statusEl.textContent = "Dice allowance is too low.";
        alert(
          `Dice allowance is too low (${allowStr} VIN).\n` +
            `Required allowance: at least ${needStr} VIN.\n` +
            `Please click "Approve VIN for Dice" first.`
        );
        return;
      }

      lastDiceBetBN = amountBN;
      const choice = getCurrentDiceChoice();
      const clientSeed = getRandomClientSeed();

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

      setDiceShaking(true);
      statusEl.textContent = "Sending Dice transaction...";
      const tx = await diceWrite.play(amountBN, choice, clientSeed, {
        gasLimit
      });
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        statusEl.textContent = "Dice transaction reverted.";
        setDiceShaking(false);
        return;
      }

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
        updateDiceLastResultUI();
      } else {
        statusEl.textContent =
          "Dice transaction confirmed, but event not found.";
      }

      setDiceShaking(false);
      await Promise.all([refreshBalances(), updateDicePool()]);
    } catch (err) {
      console.error("handleDicePlay error:", err);
      const statusEl = $("diceStatus");
      const reason = extractRevertReason(err);
      if (statusEl)
        statusEl.textContent =
          "Dice transaction failed on-chain. " +
          (reason ? `Reason: ${reason}` : "");
      setDiceShaking(false);
      alert(
        "Dice transaction failed on-chain.\n" +
          (reason ? `Reason: ${reason}` : "")
      );
    }
  }

  async function updateDicePool() {
    try {
      initReadProvider();
      const bank = await diceRead.bank();
      diceBankBN = bank;
      setText("diceBankroll", formatVinDisplay(bank, 4) + " VIN");
    } catch (err) {
      console.error("updateDicePool error:", err);
    }
  }

  // ===== UI Initialization =====
  function initDiceEvents() {
    const evenBtn = $("guessEvenButton");
    const oddBtn = $("guessOddButton");
    const approveBtn = $("diceApproveButton");
    const playBtn = $("dicePlayButton");
    const maxBtn = $("diceMaxButton");
    const repeatBtn = $("diceRepeatButton");
    const halfBtn = $("diceHalfButton");
    const doubleBtn = $("diceDoubleButton");

    if (evenBtn) {
      evenBtn.addEventListener("click", () => {
        setDiceChoice(true);
      });
    }

    if (oddBtn) {
      oddBtn.addEventListener("click", () => {
        setDiceChoice(false);
      });
    }

    if (approveBtn) {
      approveBtn.addEventListener("click", () => {
        handleDiceApprove();
      });
    }

    if (playBtn) {
      playBtn.addEventListener("click", () => {
        handleDicePlay();
      });
    }

    if (maxBtn) {
      maxBtn.addEventListener("click", () => {
        if (!vinBalanceBN) {
          alert("VIN balance not loaded yet.");
          return;
        }
        setDiceBetAmountFromBN(vinBalanceBN);
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
        const dbl = bn.mul(2);
        setDiceBetAmountFromBN(dbl);
      });
    }

    setDiceChoice(true);
    updateDiceChoiceUI();
  }

  function initSwapEvents() {
    const vinToMonTab = $("tabVinToMon");
    const monToVinTab = $("tabMonToVin");
    const fromInput = $("swapFromInput");
    const swapMaxBtn = $("swapMaxButton");
    const swapBtn = $("swapButton");

    if (vinToMonTab) {
      vinToMonTab.addEventListener("click", () => {
        setSwapDirectionVinToMon();
      });
    }

    if (monToVinTab) {
      monToVinTab.addEventListener("click", () => {
        setSwapDirectionMonToVin();
      });
    }

    if (fromInput) {
      fromInput.addEventListener("input", () => {
        onSwapFromInputChange();
      });
    }

    if (swapMaxBtn) {
      swapMaxBtn.addEventListener("click", () => {
        onSwapMaxClicked();
      });
    }

    if (swapBtn) {
      swapBtn.addEventListener("click", () => {
        handleSwap();
      });
    }

    updateSwapDirectionUI();
  }

  function initNavEvents() {
    const connectBtn = $("connectWalletButton");
    const homeConnectBtn = $("homeConnectButton");
    const refreshBtn = $("refreshBalancesButton");

    const homeTab = $("navHomeTab");
    const swapTab = $("navSwapTab");
    const diceTab = $("navDiceTab");

    const homeSection = $("homeSection");
    const swapSection = $("swapSection");
    const diceSection = $("diceSection");

    function showSection(section) {
      if (!homeSection || !swapSection || !diceSection) return;

      homeSection.style.display = section === "home" ? "" : "none";
      swapSection.style.display = section === "swap" ? "" : "none";
      diceSection.style.display = section === "dice" ? "" : "none";

      if (homeTab) homeTab.classList.toggle("active", section === "home");
      if (swapTab) swapTab.classList.toggle("active", section === "swap");
      if (diceTab) diceTab.classList.toggle("active", section === "dice");
    }

    if (homeTab) {
      homeTab.addEventListener("click", () => showSection("home"));
    }
    if (swapTab) {
      swapTab.addEventListener("click", () => showSection("swap"));
    }
    if (diceTab) {
      diceTab.addEventListener("click", () => showSection("dice"));
    }

    showSection("home");

    if (connectBtn) {
      connectBtn.addEventListener("click", () => {
        connectWallet();
      });
    }
    if (homeConnectBtn) {
      homeConnectBtn.addEventListener("click", () => {
        connectWallet();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        refreshBalances();
        updateSwapRates();
        updateDiceInfo();
      });
    }
  }

  async function initVinPriceDisplay() {
    const el = $("vinPriceUsd");
    if (!el) return;

    el.textContent = "Loading VIN price...";

    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd"
      );
      if (!res.ok) {
        throw new Error("Failed to fetch MON price from CoinGecko");
      }
      const data = await res.json();
      const monPriceUsd = data?.monad?.usd;
      if (!monPriceUsd || !isFinite(monPriceUsd)) {
        throw new Error("Invalid MON price from API");
      }

      const vinPriceUsd = monPriceUsd;
      el.textContent = `1 VIN ≈ ${vinPriceUsd.toFixed(4)} USD`;
    } catch (err) {
      console.error("initVinPriceDisplay error:", err);
      el.textContent = "VIN price: N/A";
    }
  }

  async function init() {
    try {
      initReadProvider();
      initNavEvents();
      initSwapEvents();
      initDiceEvents();

      await readVinDecimals();
      await Promise.all([
        refreshBalances(),
        updateSwapRates(),
        updateDiceInfo()
      ]);

      updateWalletUI();
      await initVinPriceDisplay();

      if (window.ethereum) {
        window.ethereum.on("accountsChanged", (accounts) => {
          if (!accounts || !accounts.length) {
            currentAccount = null;
            vinWrite = null;
            swapWrite = null;
            diceWrite = null;
          } else {
            currentAccount = ethers.utils.getAddress(accounts[0]);
            if (web3Provider) {
              signer = web3Provider.getSigner();
            }
          }
          updateWalletUI();
          refreshBalances();
          updateDiceInfo();
        });

        window.ethereum.on("chainChanged", (chainId) => {
          if (chainId !== MONAD_CHAIN_ID_HEX) {
            if ($("connectWalletButton"))
              $("connectWalletButton").textContent = "Connect Wallet";
          } else {
            connectWallet();
          }
        });
      }
    } catch (err) {
      console.error("init error:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
