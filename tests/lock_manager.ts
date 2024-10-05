import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LockManager } from "../target/types/lock_manager";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createMint,
  mintTo,
} from "@solana/spl-token";
import BN from "bn.js";

describe("lock_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LockManager as Program<LockManager>;
  const user = provider.wallet.publicKey;

  let xxusdMint: PublicKey;
  let userXxusdAccount: PublicKey;
  let lockVault: PublicKey;
  let lockManager: PublicKey;
  let lockRecord: PublicKey;
  let assetManager: PublicKey;

  const LOCK_AMOUNT = new BN(100_000_000); // 100 xxUSD
  const LOCK_PERIOD = new BN(7 * 24 * 60 * 60); // 1 week in seconds
  const DAILY_RELEASE = new BN(14_285_714); // ~14.28 xxUSD per day

  async function createAndSendV0Tx(txInstructions: anchor.web3.TransactionInstruction[], signers: anchor.web3.Keypair[] = []) {
    let latestBlockhash = await provider.connection.getLatestBlockhash("confirmed");
    console.log("   ✅ - Fetched latest blockhash. Last valid block height:", latestBlockhash.lastValidBlockHeight);

    const messageV0 = new anchor.web3.TransactionMessage({
      payerKey: provider.wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: txInstructions,
    }).compileToV0Message();
    console.log("   ✅ - Compiled transaction message");
    const transaction = new anchor.web3.VersionedTransaction(messageV0);

    if (signers.length > 0) {
      transaction.sign(signers);
    }
    await provider.wallet.signTransaction(transaction);
    console.log("   ✅ - Transaction signed");

    const txid = await provider.connection.sendTransaction(transaction, {
      maxRetries: 5,
    });
    console.log("   ✅ - Transaction sent to network");

    const confirmation = await provider.connection.confirmTransaction({
      signature: txid,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });
    if (confirmation.value.err) {
      throw new Error(`   ❌ - Transaction not confirmed.\nReason: ${confirmation.value.err}`);
    }

    console.log("🎉 Transaction confirmed successfully!");
  }

  before(async () => {
    // Create xxUSD mint
    xxusdMint = await createMint(
      provider.connection,
      (provider.wallet as any).payer,
      provider.wallet.publicKey,
      null,
      6
    );

    userXxusdAccount = await getAssociatedTokenAddress(xxusdMint, user);
    [lockManager] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock_manager")],
      program.programId
    );
    lockVault = await getAssociatedTokenAddress(xxusdMint, lockManager, true);
    [lockRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock_record"), user.toBuffer()],
      program.programId
    );
    assetManager = new PublicKey("91hM5ZdHVbH7tH1a21QHRmPEFkHWS532DfcpGPBUkdAF");

    // Mint some xxUSD to user
    await mintTo(
      provider.connection,
      (provider.wallet as any).payer,
      xxusdMint,
      userXxusdAccount,
      provider.wallet.publicKey,
      LOCK_AMOUNT.toNumber() * 2
    );
  });

  it("should successfully lock xxUSD tokens", async () => {
    const lockInstruction = await program.methods
      .lockXxusd(LOCK_AMOUNT, LOCK_PERIOD, DAILY_RELEASE)
      .accounts({
        user: user,
        userTokenAccount: userXxusdAccount,
        xxusdMint: xxusdMint,
        lockVault: lockVault,
        lockManager: lockManager,
        lockRecord: lockRecord,
        assetManager: assetManager,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();

    await createAndSendV0Tx([lockInstruction]);

    // Verify lock
    const lockRecordAccount = await program.account.lockRecord.fetch(lockRecord);
    expect(lockRecordAccount.amount.eq(LOCK_AMOUNT)).to.be.true;
    expect(lockRecordAccount.lockPeriod.eq(LOCK_PERIOD)).to.be.true;
    expect(lockRecordAccount.dailyRelease.eq(DAILY_RELEASE)).to.be.true;
  });

  it("should successfully release daily xxUSD", async () => {
    // Fast forward time (this is just for testing purposes)
    await new Promise(resolve => setTimeout(resolve, 1000));

    const releaseInstruction = await program.methods
      .releaseDailyXxusd()
      .accounts({
        user: user,
        userTokenAccount: userXxusdAccount,
        xxusdMint: xxusdMint,
        lockVault: lockVault,
        lockManager: lockManager,
        lockRecord: lockRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    await createAndSendV0Tx([releaseInstruction]);

    // Verify release
    const lockRecordAccount = await program.account.lockRecord.fetch(lockRecord);
    expect(lockRecordAccount.amount.lt(LOCK_AMOUNT)).to.be.true;
  });

  it("should check lock status correctly", async () => {
    const lockStatus = await program.methods
      .checkLockStatus()
      .accounts({
        user: user,
        lockRecord: lockRecord,
      } as any)
      .view();

    expect(lockStatus.isLocked).to.be.a('boolean');
    expect(lockStatus.remainingLockTime.toNumber()).to.be.a('number');
    expect(lockStatus.redeemableAmount.toNumber()).to.be.a('number');
    expect(lockStatus.redemptionDeadline.toNumber()).to.be.a('number');
  });

  it("should check redemption window correctly", async () => {
    const isWithinWindow = await program.methods
      .isWithinRedemptionWindow()
      .accounts({
        user: user,
        lockRecord: lockRecord,
      } as any)
      .view();

    expect(isWithinWindow).to.be.a('boolean');
  });
});