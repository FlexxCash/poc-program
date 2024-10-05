import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RedemptionManager } from "../target/types/redemption_manager";
import { LockManager } from "../target/types/lock_manager";
import { XxusdToken } from "../target/types/xxusd_token";
import { startAnchor, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

describe("redemption_manager", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let redemptionManagerProgram: Program<RedemptionManager>;
  let lockManagerProgram: Program<LockManager>;
  let xxusdTokenProgram: Program<XxusdToken>;

  let xxusdMint: PublicKey;
  let userXxusdAccount: PublicKey;
  let redemptionVault: PublicKey;
  let lockRecord: PublicKey;
  let redemptionRequest: PublicKey;
  let systemState: PublicKey;
  let redemptionManager: PublicKey;
  let user: Keypair;

  const XXUSD_DECIMALS = 6;
  const MINIMUM_SLOT = 100n;
  const MINIMUM_XXUSD_BALANCE = 100_000_000_000; // 100k xxUSD

  before(async () => {
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    redemptionManagerProgram = anchor.workspace.RedemptionManager as Program<RedemptionManager>;
    lockManagerProgram = anchor.workspace.LockManager as Program<LockManager>;
    xxusdTokenProgram = anchor.workspace.XxusdToken as Program<XxusdToken>;

    xxusdMint = xxusdTokenProgram.programId;
    user = Keypair.generate();
    userXxusdAccount = getAssociatedTokenAddressSync(xxusdMint, user.publicKey);
    redemptionVault = getAssociatedTokenAddressSync(xxusdMint, redemptionManagerProgram.programId, true);

    [lockRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock_record"), user.publicKey.toBuffer()],
      lockManagerProgram.programId
    );

    [redemptionRequest] = PublicKey.findProgramAddressSync(
      [Buffer.from("redemption_request"), user.publicKey.toBuffer()],
      redemptionManagerProgram.programId
    );

    [systemState] = PublicKey.findProgramAddressSync(
      [Buffer.from("system_state")],
      redemptionManagerProgram.programId
    );

    [redemptionManager] = PublicKey.findProgramAddressSync(
      [Buffer.from("redemption_manager")],
      redemptionManagerProgram.programId
    );

    // Initialize system state
    await redemptionManagerProgram.methods
      .initializeSystemState()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Mint some xxUSD to the user
    await xxusdTokenProgram.methods
      .mint(new anchor.BN(MINIMUM_XXUSD_BALANCE))
      .accounts({
        mint: xxusdMint,
        authority: provider.wallet.publicKey,
        to: userXxusdAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Create a lock record for the user
    await lockManagerProgram.methods
      .lockXxusd(new anchor.BN(MINIMUM_XXUSD_BALANCE), new anchor.BN(30), new anchor.BN(MINIMUM_XXUSD_BALANCE / 30))
      .accounts({
        user: user.publicKey,
        userTokenAccount: userXxusdAccount,
        xxusdMint: xxusdMint,
        lockVault: redemptionVault,
        lockManager: lockManagerProgram.programId,
        lockRecord: lockRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();
  });

  describe("execute_redeem", () => {
    it("should successfully execute redemption", async () => {
      // Warp to after lock period
      context.warpToSlot(MINIMUM_SLOT + 31n * 86400n);

      // Initiate redemption first
      const redeemAmount = new anchor.BN(MINIMUM_XXUSD_BALANCE / 2);
      await redemptionManagerProgram.methods
        .initiateRedeem(redeemAmount)
        .accounts({
          user: user.publicKey,
          userTokenAccount: userXxusdAccount,
          redemptionVault: redemptionVault,
          lockRecord: lockRecord,
          redemptionRequest: redemptionRequest,
          systemState: systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Get initial balances
      const initialUserSolBalance = await provider.connection.getBalance(user.publicKey);
      const initialRedemptionVaultBalance = await provider.connection.getTokenAccountBalance(redemptionVault);

      // Execute redemption
      await redemptionManagerProgram.methods
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

      // Get final balances
      const finalUserSolBalance = await provider.connection.getBalance(user.publicKey);
      const finalRedemptionVaultBalance = await provider.connection.getTokenAccountBalance(redemptionVault);

      // Verify redemption request is processed
      const redemptionRequestAccount = await redemptionManagerProgram.account.redemptionRequest.fetch(redemptionRequest);
      expect(redemptionRequestAccount.isProcessed).to.be.true;

      // Verify xxUSD balance in redemption vault has decreased
      expect(Number(finalRedemptionVaultBalance.value.amount)).to.be.lessThan(Number(initialRedemptionVaultBalance.value.amount));

      // Verify user's SOL balance has increased
      const expectedSolIncrease = redeemAmount.toNumber() / LAMPORTS_PER_SOL;
      expect(finalUserSolBalance).to.be.greaterThan(initialUserSolBalance);
      expect(finalUserSolBalance - initialUserSolBalance).to.be.closeTo(expectedSolIncrease, 0.001 * LAMPORTS_PER_SOL); // Allow for small rounding differences
    });

    it("should fail to execute redemption when system is paused", async () => {
      // Pause the system
      await redemptionManagerProgram.methods
        .pauseSystem()
        .accounts({
          systemState: systemState,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Try to execute redemption
      try {
        await redemptionManagerProgram.methods
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

      // Unpause the system
      await redemptionManagerProgram.methods
        .unpauseSystem()
        .accounts({
          systemState: systemState,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });

    it("should fail to execute redemption for an already processed request", async () => {
      try {
        await redemptionManagerProgram.methods
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
        expect(error.toString()).to.include("Redemption request already processed");
      }
    });
  });

  describe("check_redeem_eligibility", () => {
    it("should return false when lock period has not ended", async () => {
      // Reset the lock period
      await lockManagerProgram.methods
        .lockXxusd(new anchor.BN(MINIMUM_XXUSD_BALANCE), new anchor.BN(30), new anchor.BN(MINIMUM_XXUSD_BALANCE / 30))
        .accounts({
          user: user.publicKey,
          userTokenAccount: userXxusdAccount,
          xxusdMint: xxusdMint,
          lockVault: redemptionVault,
          lockManager: lockManagerProgram.programId,
          lockRecord: lockRecord,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const eligibility = await redemptionManagerProgram.methods
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
      // Warp to after lock period
      await context.warpToSlot(MINIMUM_SLOT + 31n * 86400n);

      const eligibility = await redemptionManagerProgram.methods
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
      // Warp to after redemption window (lock period + 14 days)
      await context.warpToSlot(MINIMUM_SLOT + 45n * 86400n);

      const eligibility = await redemptionManagerProgram.methods
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
      // Warp back to within redemption window
      await context.warpToSlot(MINIMUM_SLOT + 31n * 86400n);

      // Remove user's xxUSD balance
      await xxusdTokenProgram.methods
        .burn(new anchor.BN(MINIMUM_XXUSD_BALANCE))
        .accounts({
          mint: xxusdMint,
          from: userXxusdAccount,
          authority: user.publicKey,
        })
        .signers([user])
        .rpc();

      const eligibility = await redemptionManagerProgram.methods
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