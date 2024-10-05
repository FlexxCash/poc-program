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

  async function processTransaction(
    instruction: TransactionInstruction,
    signers: Keypair[] = []
  ) {
    const tx = new Transaction().add(instruction);
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = provider.wallet.publicKey;
    tx.sign(...signers);
    return await context.banksClient.processTransaction(tx);
  }

  describe("Time Travel Tests", () => {
    const testCases = [
      { desc: "(too early)", slot: MINIMUM_SLOT - 1n, shouldSucceed: false },
      { desc: "(at or above threshold)", slot: MINIMUM_SLOT, shouldSucceed: true },
    ];

    testCases.forEach(({ desc, slot, shouldSucceed }) => {
      it(`Initiates redemption when slot is ${slot} ${desc}`, async () => {
        context.warpToSlot(slot);

        const ix = await redemptionManagerProgram.methods
          .initiateRedeem(new anchor.BN(MINIMUM_XXUSD_BALANCE))
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
          .instruction();

        if (shouldSucceed) {
          await processTransaction(ix, [user]);
          const redemptionRequestAccount = await redemptionManagerProgram.account.redemptionRequest.fetch(redemptionRequest);
          expect(redemptionRequestAccount.user.toString()).to.equal(user.publicKey.toString());
          expect(redemptionRequestAccount.amount.toNumber()).to.equal(MINIMUM_XXUSD_BALANCE);
          expect(redemptionRequestAccount.isProcessed).to.be.false;
        } else {
          try {
            await processTransaction(ix, [user]);
            expect.fail("Expected an error to be thrown");
          } catch (error: any) {
            expect(error.toString()).to.include("LockPeriodNotEnded");
          }
        }
      });
    });
  });

  // Add more tests here as needed
});