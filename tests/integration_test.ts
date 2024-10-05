import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PriceOracle } from "../target/types/price_oracle";
import { HedgingStrategy } from "../target/types/hedging_strategy";
import { AccessControl } from "../target/types/access_control";
import { LockManager } from "../target/types/lock_manager";
import { AssetManager } from "../target/types/asset_manager";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("FlexxCash Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const priceOracleProgram = anchor.workspace.PriceOracle as Program<PriceOracle>;
  const hedgingStrategyProgram = anchor.workspace.HedgingStrategy as Program<HedgingStrategy>;
  const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
  const lockManagerProgram = anchor.workspace.LockManager as Program<LockManager>;
  const assetManagerProgram = anchor.workspace.AssetManager as Program<AssetManager>;

  const oracleAccount = Keypair.generate();
  const user = provider.wallet.publicKey;

  const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  const mockInterestAssetFeed = new PublicKey("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1");

  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let hedgingVault: PublicKey;
  let systemState: PublicKey;
  let hedgingRecord: PublicKey;
  let accessControlPDA: PublicKey;
  let lockRecord: PublicKey;
  let assetManagerState: PublicKey;

  const HEDGING_AMOUNT = 1000000000; // 1 token, 9 decimals
  const LOCK_AMOUNT = 500000000; // 0.5 token, 9 decimals
  const LOCK_PERIOD = 7 * 24 * 60 * 60; // 1 week in seconds
  const DAILY_RELEASE = 71428571; // ~0.071 token per day, 9 decimals

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
    // Initialize Oracle account
    try {
      const initializeOracleInstruction = await priceOracleProgram.methods
        .initialize()
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          authority: provider.wallet.publicKey,
          solFeed: mockSolFeed,
          interestAssetFeed: mockInterestAssetFeed,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      await createAndSendV0Tx([initializeOracleInstruction], [oracleAccount]);
      console.log("Oracle account initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Oracle account:", error);
      throw error;
    }

    // Create mint
    mint = await createMint(
      provider.connection,
      provider.wallet as any,
      user,
      null,
      9
    );

    // Create user token account
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet as any,
      mint,
      user
    );

    // Create hedging vault
    hedgingVault = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet as any,
      mint,
      hedgingStrategyProgram.programId
    );

    // Mint tokens to user
    await mintTo(
      provider.connection,
      provider.wallet as any,
      mint,
      userTokenAccount,
      user,
      HEDGING_AMOUNT
    );

    // Initialize system state for HedgingStrategy
    [systemState] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("system_state")],
      hedgingStrategyProgram.programId
    );

    [hedgingRecord] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("hedging_record"), user.toBuffer()],
      hedgingStrategyProgram.programId
    );

    const initializeHedgingStateInstruction = await hedgingStrategyProgram.methods
      .initializeSystemState()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeHedgingStateInstruction]);

    // Initialize AccessControl
    [accessControlPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("access-control"), user.toBuffer()],
      accessControlProgram.programId
    );

    const initializeAccessControlInstruction = await accessControlProgram.methods
      .initialize()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeAccessControlInstruction]);

    // Initialize LockManager
    [lockRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock_record"), user.toBuffer()],
      lockManagerProgram.programId
    );

    // Initialize AssetManager
    [assetManagerState] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      assetManagerProgram.programId
    );

    const initializeAssetManagerInstruction = await assetManagerProgram.methods
      .initialize(mint)
      .accounts({
        state: assetManagerState,
        authority: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeAssetManagerInstruction]);
  });

  it("Integrates PriceOracle with HedgingStrategy", async () => {
    // Get SOL price
    const getPriceInstruction = await priceOracleProgram.methods
      .getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
      } as any)
      .instruction();

    // Execute hedging strategy
    const manageHedgingInstruction = await hedgingStrategyProgram.methods
      .manageHedging(new anchor.BN(HEDGING_AMOUNT))
      .accounts({
        user: user,
        userTokenAccount,
        hedgingVault,
        hedgingRecord,
        systemState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    const instructions = [getPriceInstruction, manageHedgingInstruction];

    await createAndSendV0Tx(instructions);

    // Verify hedging record
    const hedgingRecordAccount = await hedgingStrategyProgram.account.hedgingRecord.fetch(hedgingRecord);
    expect(hedgingRecordAccount.amount.toNumber()).to.equal(HEDGING_AMOUNT);

    // Verify token balance
    const userTokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
    const hedgingVaultInfo = await getAccount(provider.connection, hedgingVault);
    expect(Number(userTokenAccountInfo.amount)).to.equal(0);
    expect(Number(hedgingVaultInfo.amount)).to.equal(HEDGING_AMOUNT);
  });

  it("Integrates AccessControl with LockManager", async () => {
    // Set permissions
    const setPermissionsInstruction = await accessControlProgram.methods
      .setPermissions("LOCK_MANAGER", true)
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      } as any)
      .instruction();

    // Lock tokens
    const lockTokensInstruction = await lockManagerProgram.methods
      .lockXxusd(new anchor.BN(LOCK_AMOUNT), new anchor.BN(LOCK_PERIOD), new anchor.BN(DAILY_RELEASE))
      .accounts({
        user: user,
        userTokenAccount: userTokenAccount,
        xxusdMint: mint,
        lockVault: hedgingVault,
        lockManager: lockManagerProgram.programId,
        lockRecord: lockRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();

    await createAndSendV0Tx([setPermissionsInstruction, lockTokensInstruction]);

    // Verify lock record
    const lockRecordAccount = await lockManagerProgram.account.lockRecord.fetch(lockRecord);
    expect(lockRecordAccount.amount.toNumber()).to.equal(LOCK_AMOUNT);
    expect(lockRecordAccount.lockPeriod.toNumber()).to.equal(LOCK_PERIOD);
  });

  it("Integrates AssetManager with PriceOracle", async () => {
    // Get InterestAsset data
    const getPriceInstruction = await priceOracleProgram.methods
      .getPrice("InterestAsset")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
      } as any)
      .instruction();

    // Deposit asset
    const depositAmount = new anchor.BN(100000000); // 0.1 token
    const depositAssetInstruction = await assetManagerProgram.methods
      .depositAsset(depositAmount)
      .accounts({
        user: user,
        userAssetAccount: userTokenAccount,
        assetMint: mint,
        vaultAssetAccount: hedgingVault,
        state: assetManagerState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([getPriceInstruction, depositAssetInstruction]);

    // Verify deposit
    const assetManagerStateAccount = await assetManagerProgram.account.programState.fetch(assetManagerState);
    // Note: Adjust this verification based on the actual structure of your AssetManager state
    expect(assetManagerStateAccount.isInitialized).to.be.true;
    // Add more specific checks based on your AssetManager implementation
  });
});
