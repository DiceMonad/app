<p align="center">
  <img src="dmnlogo.png" width="120" alt="GameVinMon Logo"/>
</p>

<h1 align="center">DiceMonad dApp</h1>
<p align="center">Swap DMN ↔ MON • Play Dice • On Monad Network</p>

<p align="center">
  <img src="https://img.shields.io/badge/Network-Monad-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/Wallet-MetaMask-orange?style=for-the-badge">
  <img src="https://img.shields.io/badge/dApp-Web3-green?style=for-the-badge">
  <img src="https://img.shields.io/badge/Hosting-GitHub%20Pages-black?style=for-the-badge">
</p>

---

## 🚀 **Live dApp**

👉 [https://DiceMonad.github.io/app](https://DiceMonad.github.io/app)
👉 IPFS Mirror: [https://ipfs.io/ipfs/bafybeifp5oka2nqvcv24yd23pfm2pasil3mzzjk3ng472j3gpqo3uq5kva](https://ipfs.io/ipfs/bafybeifp5oka2nqvcv24yd23pfm2pasil3mzzjk3ng472j3gpqo3uq5kva)

> The DApp is fully static. Anyone can fork this repository and run their own independent version.

---

# 📌 **Overview**

**DiceMonad** is a fully on-chain, immutable gaming protocol built on the **Monad blockchain**, consisting of:

* **DMN Token** (121,000,000 total supply)
* **Fixed-rate Swap Pool (MON ↔ DMN at 1:1 while liquidity remains)**
* **Provably Fair Dice Game (Even/Odd)**

No owner.
No team.
No admin.
No upgrade keys.
No withdrawals.
Everything is permanently locked on-chain.

---

# 🧩 **Token Distribution & Liquidity Lock**

All **121,000,000 DMN** were minted once and are permanently locked:

### 🔒 **100,000,000 DMN — Swap Pool Liquidity**

* Locked forever inside the Swap Contract
* Enables swapping **MON → DMN** at **1:1 while liquidity remains**
* Neither MON nor DMN can ever be withdrawn
* Swaps automatically stop when the pool depletes
* **Not a custodial peg (unlike WBTC)**

### 🔒 **21,000,000 DMN — Dice Bank**

* Permanently locked inside the Dice Contract
* Only leaves the contract as winnings from the game
* No withdrawal function of any kind

### 🔒 **0 Tokens Held by Team**

* No presale
* No private sale
* No marketing wallet
* No developer allocation

**100% of supply is locked in Swap + Dice forever.**

---

# 🪙 **DMN Token**

| Property             | Value                                        |
| -------------------- | -------------------------------------------- |
| **Name**             | DiceMonad                                    |
| **Symbol**           | DMN                                          |
| **Decimals**         | 18                                           |
| **Total Supply**     | 121,000,000                                  |
| **Contract Address** | `0xd86d530e8A920be3b38547FC3157019acfF862F9` |

🔗 View on MonadVision:
[https://monadvision.com/token/0xd86d530e8A920be3b38547FC3157019acfF862F9](https://monadvision.com/token/0xd86d530e8A920be3b38547FC3157019acfF862F9)

---

# 🔄 **Fixed-Rate Swap (1 DMN ↔ 1 MON)**

**Ratio is guaranteed only while liquidity remains.**

### ✔ Features

* Zero fees (only MON gas)
* No owner or admin
* Liquidity cannot be withdrawn
* Immutable forever
* Stops automatically when pool is empty

### 🔗 Swap Contract

`0xcb83C2c5BFB7B6e77fffa56B22B6EA416bAC2E99`

View:
[https://monadvision.com/address/0xcb83C2c5BFB7B6e77fffa56B22B6EA416bAC2E99](https://monadvision.com/address/0xcb83C2c5BFB7B6e77fffa56B22B6EA416bAC2E99)

---

# 🎲 **On-Chain Dice Game (Even / Odd)**

Bet **DMN**, choose:

* **Even (0)**
* **Odd (1)**

If you guess correctly → **2× payout**
If not → stake remains permanently in the bank.

### 🔐 Provably Fair Randomness

```
keccak256(
  blockhash(block.number - 1),
  msg.sender,
  clientSeed
)
```

* Validators **cannot** predict outcomes
* Randomness depends on previous block (already sealed)
* No owner/admin to influence results

### 🔗 Dice Contract

`0xb2369f3083EB6D62644dF8A3c67e6888b71703e6`

View:
[https://monadvision.com/address/0xb2369f3083EB6D62644dF8A3c67e6888b71703e6](https://monadvision.com/address/0xb2369f3083EB6D62644dF8A3c67e6888b71703e6)

---

# 🛡️ **Security Model**

* Fully immutable (no upgrade keys)
* No privileged functions
* No way to withdraw DMN from contracts
* Entire supply locked
* Randomness hardened against validators
* DApp has no backend → no data collection
* Works permanently without any central control

---

# 🦊 **Wallet Support (MetaMask)**

DiceMonad works seamlessly with **MetaMask**:

* The **Monad network is already integrated**
* Just select **Monad Mainnet**
* Click **Connect Wallet** in the DApp
* You are ready to swap + play

No installation of custom RPCs required.

---

# 📁 **Minimal DApp Structure**

Only 6 files are required:

```
index.html
style.css
app.js
dmnlogo.png
logo128.png
README.md
```

Anyone can download these files and run the DApp locally or host it anywhere.

---

# 🖥️ **Run Locally**

### Option A — Open directly

Open **index.html** in your browser.

### Option B — Use a local static server

```bash
npx serve .
```

---

# 🌐 **Deploy Your Own DApp (GitHub Pages)**

1. Create a new GitHub repository
2. Upload all 6 DApp files
3. Go to **Settings → Pages**
4. Select:

   * **Branch:** main
   * **Folder:** `/` (root)
5. Save

Your DApp will appear at:

```
https://<your-username>.github.io/<your-repo>/
```

---

# 🤝 **Community**

🐦 Twitter: [https://x.com/dicemonad](https://x.com/dicemonad)
💬 Telegram: [https://t.me/dicemonadofficial](https://t.me/dicemonadofficial)
💻 GitHub: [https://github.com/dicemonad](https://github.com/dicemonad)

---

<p align="center"><b>DiceMonad — Immutable. Fair. On-Chain. Forever.</b></p>
