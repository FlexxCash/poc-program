import {
  PublicKey,
  Keypair,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { AnchorProvider, setProvider, Program } from "@coral-xyz/anchor";
import { RedemptionManager } from "../target/types/redemption_manager";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js"; // 確保已安裝 bn.js，執行 `yarn add bn.js`

describe("redemption_manager", () => {
  let context: ProgramTestContext;
  let provider: AnchorProvider;
  let program: Program<RedemptionManager>;

  let xxusdMint: PublicKey;
  let user: Keypair;
  let userXxusdAccount: PublicKey;
  let redemptionVault: PublicKey;
  let lockRecord: PublicKey;
  let redemptionRequest: PublicKey;
  let systemState: PublicKey;
  let redemptionManager: PublicKey;

  const MINIMUM_SLOT = 100n;
  const MINIMUM_XXUSD_BALANCE = 100_000_000_000; // 100k xxUSD

  before(async () => {
    // 初始化 Bankrun 環境
    context = await startAnchor("/home/dc/flexxcash_xxUSD/flexxcash-poc", [], []);
    provider = new AnchorProvider(
      context.banksClient,
      context.payer,
      AnchorProvider.defaultOptions()
    );
    setProvider(provider);
    program = new Program<RedemptionManager>(
      context.programs.redemption_manager.idl,
      context.programs.redemption_manager.programId,
      provider
    );

    xxusdMint = program.programId;
    user = Keypair.generate();
    userXxusdAccount = getAssociatedTokenAddressSync(xxusdMint, user.publicKey);
    redemptionVault = getAssociatedTokenAddressSync(
      xxusdMint,
      program.programId,
      true
    );

    [lockRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock_record"), user.publicKey.toBuffer()],
      program.programId
    );

    [redemptionRequest] = PublicKey.findProgramAddressSync(
      [Buffer.from("redemption_request"), user.publicKey.toBuffer()],
      program.programId
    );

    [systemState] = PublicKey.findProgramAddressSync(
      [Buffer.from("system_state")],
      program.programId
    );

    [redemptionManager] = PublicKey.findProgramAddressSync(
      [Buffer.from("redemption_manager")],
      program.programId
    );

    // 初始化 system_state
    await program.methods
      .initializeSystemState()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
        systemProgram: "11111111111111111111111111111111", // 系統程序的 PublicKey (SOL 系統程序)
      })
      .rpc();

    // 鑄造一些 xxUSD 給用戶
    await program.methods
      .initiateRedeem(new BN(MINIMUM_XXUSD_BALANCE))
      .accounts({
        mint: xxusdMint,
        authority: provider.wallet.publicKey,
        to: userXxusdAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // 為用戶創建鎖定記錄
    await program.methods
      .lockXxusd(new BN(MINIMUM_XXUSD_BALANCE), new BN(30), new BN(Math.floor(MINIMUM_XXUSD_BALANCE / 30)))
      .accounts({
        user: user.publicKey,
        userTokenAccount: userXxusdAccount,
        xxusdMint: xxusdMint,
        lockVault: redemptionVault,
        lockRecord: lockRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: "11111111111111111111111111111111", // 系統程序的 PublicKey (SOL 系統程序)
      })
      .signers([user])
      .rpc();
  });

  describe("execute_redeem", () => {
    it("should successfully execute redemption", async () => {
      // Warp 到鎖定期結束後
      context.banksClient.warpToSlot(MINIMUM_SLOT + 31n * 86400n);

      // 首先發起贖回
      const redeemAmount = MINIMUM_XXUSD_BALANCE / 2;
      await program.methods
        .initiateRedeem(new BN(redeemAmount))
        .accounts({
          user: user.publicKey,
          userTokenAccount: userXxusdAccount,
          redemptionVault: redemptionVault,
          lockRecord: lockRecord,
          redemptionRequest: redemptionRequest,
          systemState: systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: "11111111111111111111111111111111", // 系統程序的 PublicKey (SOL 系統程序)
        })
        .signers([user])
        .rpc();

      // 獲取初始餘額
      const initialUserSolBalance = await provider.connection.getBalance(
        user.publicKey
      );
      const initialRedemptionVaultBalance = await provider.banksClient.getBalance(
        redemptionVault
      );

      // 執行贖回
      await program.methods
        .executeRedeem()
        .accounts({
          user: user.publicKey,
          redemptionVault: redemptionVault,
          redemptionRequest: redemptionRequest,
          systemState: systemState,
          xxusdMint: xxusdMint,
          redemptionManager: redemptionManager,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      // 獲取最終餘額
      const finalUserSolBalance = await provider.connection.getBalance(
        user.publicKey
      );
      const finalRedemptionVaultBalance = await provider.banksClient.getBalance(
        redemptionVault
      );

      // 驗證贖回請求已處理
      const redemptionRequestAccount = await program.account.redemptionRequest.fetch(
        redemptionRequest
      );
      expect(redemptionRequestAccount.isProcessed).to.be.true;

      // 驗證 redemption_vault 中的 xxUSD 餘額已減少
      expect(finalRedemptionVaultBalance).to.be.lessThan(
        initialRedemptionVaultBalance
      );

      // 驗證用戶的 SOL 餘額已增加
      const expectedSolIncrease =
        redeemAmount / LAMPORTS_PER_SOL;
      expect(finalUserSolBalance).to.be.greaterThan(initialUserSolBalance);
      expect(finalUserSolBalance - initialUserSolBalance).to.be.closeTo(
        expectedSolIncrease,
        0.001 * LAMPORTS_PER_SOL
      ); // 允許小的四捨五入差異
    });

    it("should fail to execute redemption when system is paused", async () => {
      // 暫停系統
      await program.methods
        .pauseSystem()
        .accounts({
          systemState: systemState,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // 嘗試執行贖回
      try {
        await program.methods
          .executeRedeem()
          .accounts({
            user: user.publicKey,
            redemptionVault: redemptionVault,
            redemptionRequest: redemptionRequest,
            systemState: systemState,
            xxusdMint: xxusdMint,
            redemptionManager: redemptionManager,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Expected an error to be thrown");
      } catch (error: any) {
        expect(error.toString()).to.include("System is paused");
      }

      // 取消暫停系統
      await program.methods
        .unpauseSystem()
        .accounts({
          systemState: systemState,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });

    it("should fail to execute redemption for an already processed request", async () => {
      try {
        await program.methods
          .executeRedeem()
          .accounts({
            user: user.publicKey,
            redemptionVault: redemptionVault,
            redemptionRequest: redemptionRequest,
            systemState: systemState,
            xxusdMint: xxusdMint,
            redemptionManager: redemptionManager,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Expected an error to be thrown");
      } catch (error: any) {
        expect(error.toString()).to.include(
          "Redemption request already processed"
        );
      }
    });
  });

  describe("check_redeem_eligibility", () => {
    it("should return false when lock period has not ended", async () => {
      // 重置鎖定期
      await program.methods
        .lockXxusd(new BN(MINIMUM_XXUSD_BALANCE), new BN(30), new BN(Math.floor(MINIMUM_XXUSD_BALANCE / 30)))
        .accounts({
          user: user.publicKey,
          userTokenAccount: userXxusdAccount,
          xxusdMint: xxusdMint,
          lockVault: redemptionVault,
          lockRecord: lockRecord,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: "11111111111111111111111111111111", // 系統程序的 PublicKey (SOL 系統程序)
        })
        .signers([user])
        .rpc();

      const eligibility = await program.methods
        .checkRedeemEligibility()
        .accounts({
          user: user.publicKey,
          lockRecord: lockRecord,
          userTokenAccount: userXxusdAccount,
          systemState: systemState,
        })
        .view();

      expect(eligibility).to.be.false;
    });

    it("should return true when lock period has ended and within redemption window", async () => {
      // Warp 到鎖定期結束後
      context.banksClient.warpToSlot(MINIMUM_SLOT + 31n * 86400n);

      const eligibility = await program.methods
        .checkRedeemEligibility()
        .accounts({
          user: user.publicKey,
          lockRecord: lockRecord,
          userTokenAccount: userXxusdAccount,
          systemState: systemState,
        })
        .view();

      expect(eligibility).to.be.true;
    });

    it("should return false when redemption window has passed", async () => {
      // Warp 到 redemption window 結束後 (鎖定期 + 14 天)
      context.banksClient.warpToSlot(MINIMUM_SLOT + 45n * 86400n);

      const eligibility = await program.methods
        .checkRedeemEligibility()
        .accounts({
          user: user.publicKey,
          lockRecord: lockRecord,
          userTokenAccount: userXxusdAccount,
          systemState: systemState,
        })
        .view();

      expect(eligibility).to.be.false;
    });

    it("should return false when user has no xxUSD balance", async () => {
      // Warp 回 redemption window 內
      context.banksClient.warpToSlot(MINIMUM_SLOT + 31n * 86400n);

      // 移除用戶的 xxUSD 餘額
      await program.methods
        .executeRedeem()
        .accounts({
          user: user.publicKey,
          redemptionVault: redemptionVault,
          redemptionRequest: redemptionRequest,
          systemState: systemState,
          xxusdMint: xxusdMint,
          redemptionManager: redemptionManager,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const eligibility = await program.methods
        .checkRedeemEligibility()
        .accounts({
          user: user.publicKey,
          lockRecord: lockRecord,
          userTokenAccount: userXxusdAccount,
          systemState: systemState,
        })
        .view();

      expect(eligibility).to.be.false;
    });
  });
});