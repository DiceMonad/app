// botvinmondice.js
// Bot chơi VinMonDice theo luật bạn đặt ra.
// - Luật cược: 1, 2, 4, 8, rồi 8 đến khi tổng lỗ < 39, sau đó cố định 40 VIN/ván.
// - Chọn EVEN ván đầu tiên, các ván sau cược theo kết quả ván liền trước.
// - Kết thúc chu kỳ khi số dư VIN lập đỉnh mới hoặc không đủ VIN theo luật.
// - Dừng hẳn bot khi số dư VIN < MIN_GLOBAL_VIN (mặc định 40 VIN).
//
// Gas cho lệnh play: estimateGas * 120% (giống app.js dApp).

require("dotenv").config();
const { ethers } = require("ethers");
const crypto = require("crypto");

// ===== Đọc cấu hình từ .env =====
const RPC_URL = process.env.RPC_URL || "https://rpc.monad.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const VIN_TOKEN_ADDRESS =
  process.env.VIN_TOKEN_ADDRESS ||
  "0xfB71cbd8CB6f0fb72a9568f11e7E4454309A9cA1";

const DICE_CONTRACT_ADDRESS =
  process.env.DICE_CONTRACT_ADDRESS ||
  "0x245Fb6ECC6B2beCaf45AC15E4fAc8C78826f0F67";

// Số VIN tối thiểu để tiếp tục chạy bot (theo luật dừng khi < 40 VIN)
const MIN_GLOBAL_VIN = Number(process.env.MIN_GLOBAL_VIN || "40");

// Thời gian nghỉ giữa 2 ván (ms)
const BET_INTERVAL_MS = Number(process.env.BET_INTERVAL_MS || "30000");

// Lượng VIN sẽ approve cho Dice (để không phải approve lại nhiều lần)
const APPROVE_VIN_AMOUNT = process.env.APPROVE_VIN_AMOUNT || "100000000";

// ===== Kiểm tra cấu hình cơ bản =====
if (!PRIVATE_KEY) {
  console.error("❌ Thiếu PRIVATE_KEY trong file .env");
  process.exit(1);
}

// ===== ABI rút gọn (giống app.js) =====
const VIN_ABI = [
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
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
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

const DICE_ABI = [
  {
    inputs: [],
    name: "MIN_BET",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "VIN_TOKEN",
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
    inputs: [],
    name: "getMaxBet",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint8", name: "choice", type: "uint8" },
      { internalType: "uint256", name: "clientSeed", type: "uint256" },
    ],
    name: "play",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
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
        internalType: "uint8",
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
];

// ===== Helper =====
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatVin(bn, decimals) {
  if (!bn) return "0";
  return Number(ethers.utils.formatUnits(bn, decimals)).toLocaleString(
    undefined,
    {
      maximumFractionDigits: 6,
    }
  );
}

function randomClientSeedBN() {
  const buf = crypto.randomBytes(32);
  return ethers.BigNumber.from(buf);
}

// ===== Main =====
async function main() {
  console.log("🚀 Khởi động bot VinMonDice...");

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log("👛 Ví bot:", wallet.address);

  // Khởi tạo contract
  const vin = new ethers.Contract(VIN_TOKEN_ADDRESS, VIN_ABI, wallet);
  const dice = new ethers.Contract(DICE_CONTRACT_ADDRESS, DICE_ABI, wallet);

  // Đọc decimals của VIN
  const vinDecimals = await vin.decimals();
  const ONE_VIN = ethers.BigNumber.from(10).pow(vinDecimals);

  const BET_1 = ONE_VIN.mul(1); // 1 VIN
  const BET_2 = ONE_VIN.mul(2); // 2 VIN
  const BET_4 = ONE_VIN.mul(4); // 4 VIN
  const BET_8 = ONE_VIN.mul(8); // 8 VIN
  const BET_40 = ONE_VIN.mul(40); // 40 VIN

  const MIN_GLOBAL_BALANCE = ONE_VIN.mul(MIN_GLOBAL_VIN);

  // Đỉnh cũ: lấy VIN hiện tại làm mốc ban đầu
  let currentVinBalance = await vin.balanceOf(wallet.address);
  let oldPeak = currentVinBalance;
  console.log(
    `📈 Đỉnh cũ khởi tạo = ${formatVin(oldPeak, vinDecimals)} VIN`
  );

  // Lần đầu tiên: chưa có kết quả ván trước
  let lastResultEven = null; // null = ván đầu, true = EVEN, false = ODD

  // Đếm chu kỳ và ván
  let cycleIndex = 0;
  let globalGameIndex = 0;

  // Chuẩn bị Interface để decode event Played
  const diceInterface = new ethers.utils.Interface(DICE_ABI);

  // Vòng lặp ca làm việc: chạy cho đến khi VIN < MIN_GLOBAL_BALANCE
  while (true) {
    currentVinBalance = await vin.balanceOf(wallet.address);
    const monBalance = await provider.getBalance(wallet.address);

    console.log(
      `\n💰 Số dư hiện tại: ${formatVin(
        currentVinBalance,
        vinDecimals
      )} VIN | gas: ${ethers.utils.formatEther(monBalance)} MON`
    );

    if (currentVinBalance.lt(MIN_GLOBAL_BALANCE)) {
      console.log(
        `⛔ Số dư VIN < ${MIN_GLOBAL_VIN} VIN. Dừng bot theo luật quản lý vốn.`
      );
      break;
    }

    cycleIndex += 1;
    let cycleLoss = ethers.BigNumber.from(0); // tổng VIN thua trong chu kỳ
    let gameInCycle = 0;

    console.log(`\n==============================`);
    console.log(`🎯 BẮT ĐẦU CHU KỲ #${cycleIndex}`);
    console.log(`==============================`);

    // Vòng lặp trong 1 chu kỳ
    while (true) {
      gameInCycle += 1;
      globalGameIndex += 1;

      // Xác định tiền cược theo luật
      let betAmount;
      if (gameInCycle === 1) {
        betAmount = BET_1;
      } else if (gameInCycle === 2) {
        betAmount = BET_2;
      } else if (gameInCycle === 3) {
        betAmount = BET_4;
      } else if (gameInCycle === 4) {
        betAmount = BET_8;
      } else {
        // Từ ván thứ 5 trở đi
        // Nếu tổng lỗ < 39 VIN → cược 8 VIN, còn lại → 40 VIN
        const lossInVin = Number(
          ethers.utils.formatUnits(cycleLoss, vinDecimals)
        );
        if (lossInVin < 39) {
          betAmount = BET_8;
        } else {
          betAmount = BET_40;
        }
      }

      // Kiểm tra lại số dư VIN
      currentVinBalance = await vin.balanceOf(wallet.address);
      if (currentVinBalance.lt(betAmount)) {
        console.log(
          `⚠️ Không đủ VIN cho ván tiếp theo trong chu kỳ (cần ${formatVin(
            betAmount,
            vinDecimals
          )} VIN). Kết thúc bot.`
        );
        return;
      }

      // Kiểm tra MIN_BET và getMaxBet trên contract Dice
      const [minBetOnChain, maxBetOnChain] = await Promise.all([
        dice.MIN_BET(),
        dice.getMaxBet(),
      ]);

      if (betAmount.lt(minBetOnChain)) {
        console.log(
          `⚠️ BetAmount < MIN_BET on-chain. Điều này không xảy ra với luật 1 VIN, nhưng vẫn kiểm tra cho chắc.`
        );
        betAmount = minBetOnChain;
      }

      if (betAmount.gt(maxBetOnChain)) {
        console.log(
          `⚠️ BetAmount (${formatVin(
            betAmount,
            vinDecimals
          )}) > getMaxBet (${formatVin(
            maxBetOnChain,
            vinDecimals
          )}). Bank quá nhỏ cho luật này. Dừng bot để tránh revert.`
        );
        return;
      }

      // Chọn EVEN/ODD theo luật:
      // - Ván đầu tiên của ca làm việc: luôn chọn EVEN
      // - Các ván sau: chọn theo kết quả ván liền trước
      let choiceEven;
      if (lastResultEven === null) {
        choiceEven = true; // ván đầu tiên
      } else {
        choiceEven = lastResultEven;
      }
      const choiceValue = choiceEven ? 0 : 1; // 0 = EVEN, 1 = ODD

      console.log(
        `\n🎲 Chu kỳ #${cycleIndex} | Ván #${gameInCycle} (Global #${globalGameIndex})`
      );
      console.log(
        `   ➤ Cược: ${formatVin(betAmount, vinDecimals)} VIN | Cửa: ${
          choiceEven ? "EVEN" : "ODD"
        }`
      );

      // Đảm bảo allowance đủ
      const currentAllowance = await vin.allowance(
        wallet.address,
        DICE_CONTRACT_ADDRESS
      );
      if (currentAllowance.lt(betAmount)) {
        console.log(
          `   🔑 Allowance hiện tại: ${formatVin(
            currentAllowance,
            vinDecimals
          )} VIN < mức cược. Tiến hành approve...`
        );
        const approveAmount = ethers.utils.parseUnits(
          APPROVE_VIN_AMOUNT,
          vinDecimals
        );
        const approveTx = await vin.approve(
          DICE_CONTRACT_ADDRESS,
          approveAmount
        );
        console.log(`   ⏳ Gửi tx approve: ${approveTx.hash}`);
        await approveTx.wait();
        console.log(
          `   ✅ Approve thành công ${APPROVE_VIN_AMOUNT} VIN cho Dice.`
        );
      }

      // Chuẩn bị clientSeed
      const clientSeed = randomClientSeedBN();

      // Ước lượng gas và đặt gasLimit = estimate * 120% (giống app.js)
      let gasLimit;
      try {
        const gasEstimate = await dice.estimateGas.play(
          betAmount,
          choiceValue,
          clientSeed
        );
        gasLimit = gasEstimate.mul(120).div(100);
      } catch (err) {
        console.error("   ❌ estimateGas.play bị revert:", err.message || err);
        console.log("   ⛔ Dừng bot để tránh tốn phí.");
        return;
      }

      // Gửi giao dịch play
      let txReceipt;
      try {
        const tx = await dice.play(betAmount, choiceValue, clientSeed, {
          gasLimit,
        });
        console.log(`   ⏳ Gửi tx play: ${tx.hash}`);
        txReceipt = await tx.wait();
        if (txReceipt.status !== 1) {
          console.log("   ❌ Giao dịch play bị revert trên chain.");
          return;
        }
      } catch (err) {
        console.error(
          "   ❌ Lỗi khi gửi giao dịch play:",
          err.message || err
        );
        return;
      }

      // Decode event Played để lấy kết quả
      let playedEvent = null;
      try {
        for (const log of txReceipt.logs) {
          try {
            const parsed = diceInterface.parseLog(log);
            if (parsed && parsed.name === "Played") {
              playedEvent = parsed;
              break;
            }
          } catch (_) {
            // bỏ qua log không khớp
          }
        }
      } catch (err) {
        console.error("   ⚠️ Lỗi khi parse log:", err.message || err);
      }

      if (!playedEvent) {
        console.log(
          "   ⚠️ Không tìm thấy event Played trong receipt (nhưng tx đã thành công)."
        );
      } else {
        const { player, amount, choice, result, won } = playedEvent.args;
        const amountStr = formatVin(amount, vinDecimals);
        const resultEven = result === 0;
        lastResultEven = resultEven;

        console.log(
          `   📜 Event Played: player=${player}, stake=${amountStr} VIN, choice=${
            choice === 0 ? "EVEN" : "ODD"
          }, result=${resultEven ? "EVEN" : "ODD"}, won=${won}`
        );

        if (!won) {
          cycleLoss = cycleLoss.add(betAmount);
          console.log(
            `   💸 Thua ván này. Tổng lỗ chu kỳ hiện tại: ${formatVin(
              cycleLoss,
              vinDecimals
            )} VIN`
          );
        } else {
          const payoutVin = betAmount.mul(2);
          console.log(
            `   🟢 THẮNG! Payout ~ ${formatVin(payoutVin, vinDecimals)} VIN`
          );
        }
      }

      // Sau mỗi ván, kiểm tra đỉnh mới
      const newBalance = await vin.balanceOf(wallet.address);
      console.log(
        `   📊 Số dư sau ván: ${formatVin(
          newBalance,
          vinDecimals
        )} VIN (đỉnh cũ: ${formatVin(oldPeak, vinDecimals)} VIN)`
      );

      if (newBalance.gt(oldPeak)) {
        oldPeak = newBalance;
        console.log(
          `   🎉 LẬP ĐỈNH MỚI: ${formatVin(
            oldPeak,
            vinDecimals
          )} VIN → KẾT THÚC CHU KỲ #${cycleIndex}`
        );
        break; // kết thúc chu kỳ, quay lại vòng while ngoài để bắt đầu chu kỳ mới
      }

      // Nếu chưa lập đỉnh mới, tiếp tục chu kỳ sau 30 giây
      console.log(
        `   🔁 Chưa lập đỉnh mới. Chờ ${BET_INTERVAL_MS / 1000} giây rồi đánh ván tiếp theo...`
      );
      await sleep(BET_INTERVAL_MS);
    }

    // Hết một chu kỳ, while ngoài sẽ loop để bắt đầu chu kỳ mới
  }

  console.log("\n🛑 Bot đã dừng.");
}

main().catch((err) => {
  console.error("❌ Lỗi không mong muốn:", err);
  process.exit(1);
});
