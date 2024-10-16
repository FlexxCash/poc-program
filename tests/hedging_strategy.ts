import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HedgingStrategy } from "../target/types/hedging_strategy";
import { PriceOracle } from "../target/types/price_oracle";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from 'fs';

describe("hedging_strategy", () => {
  const HEDGING_AMOUNT = 1000000000; // 1 token，9 個小數位
  // Load the non-admin wallet
  const secretKeyString = fs.readFileSync('/home/dc/.config/solana/nonAdmin.json', 'utf-8');
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  const wallet = Keypair.fromSecretKey(secretKey);

  // Set up the provider with the loaded wallet
  const provider = new anchor.AnchorProvider(provider.connection, new anchor.Wallet(wallet), provider.opts);
  anchor.setProvider(provider);

  const program = anchor.workspace.HedgingStrategy as Program<HedgingStrategy>;
  const priceOracleProgram = anchor.workspace.PriceOracle as Program<PriceOracle>;
  const user = wallet; // Use the loaded wallet as the user
  const authority = provider.wallet.publicKey;

  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let hedgingVault: PublicKey;
  let systemState: PublicKey;
  let oracleAccount: Keypair;

  // 模擬 Switchboard feed 公鑰
  const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  const mockInterestAssetFeed = new PublicKey("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1");

  before(async () => {
    // 初始化 PriceOracle
    oracleAccount = Keypair.generate();
    try {
      const initializeInstruction = await priceOracleProgram.methods
        .initialize()
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          authority: provider.wallet.publicKey,
          solFeed: mockSolFeed,
          interestAssetFeed: mockInterestAssetFeed,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      await createAndSendV0Tx([initializeInstruction], [oracleAccount]);

      console.log("PriceOracle initialized successfully");
    } catch (error) {
      console.error("Failed to initialize PriceOracle:", error);
      throw error;
    }

    // 創建 mint
    mint = await createMint(
      provider.connection,
      wallet,
      wallet.publicKey,
      null,
      9
    );

    // 創建 user token account
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet,
      mint,
      wallet.publicKey
    );

    // 創建 hedging vault
    hedgingVault = await createAssociatedTokenAccount(
      provider.connection,
      wallet,
      mint,
      program.programId
    );

    // Mint tokens 給 user
    await mintTo(
      provider.connection,
      wallet,
      mint,
      userTokenAccount,
      wallet.publicKey,
      HEDGING_AMOUNT
    );

    // 初始化 system state
    const [systemStatePda] = await PublicKey.findProgramAddress(
      [Buffer.from("system_state")],
      program.programId
    );
    systemState = systemStatePda;

    const initializeSystemStateInstruction = await program.methods
      .initializeSystemState()
      .accounts({
        systemState: systemState,
        authority: authority,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeSystemStateInstruction]);
  });

  it("Manages hedging successfully", async () => {
    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    const manageHedgingInstruction = await program.methods
      .manageHedging(new anchor.BN(HEDGING_AMOUNT))
      .accounts({
        user: user.publicKey,
        userTokenAccount,
        hedgingVault,
        hedgingRecord,
        systemState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([manageHedgingInstruction], [user]);

    // 驗證 hedging record
    const hedgingRecordAccount = await program.account.hedgingRecord.fetch(hedgingRecord);
    expect(hedgingRecordAccount.user.toString()).to.equal(user.publicKey.toString());
    expect(hedgingRecordAccount.amount.toNumber()).to.equal(HEDGING_AMOUNT);
    expect(hedgingRecordAccount.isProcessing).to.be.false;

    // 驗證 token balance
    const userTokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
    const hedgingVaultInfo = await getAccount(provider.connection, hedgingVault);
    expect(Number(userTokenAccountInfo.amount)).to.equal(0);
    expect(Number(hedgingVaultInfo.amount)).to.equal(HEDGING_AMOUNT);
  });

  it("Uses PriceOracle data for hedging calculations", async () => {
    // 獲取 SOL 價格
    const getPriceInstruction = await priceOracleProgram.methods
      .getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
      } as any)
      .instruction();

    await createAndSendV0Tx([getPriceInstruction]);

    const solPriceAccount = await priceOracleProgram.account.oracleAccount.fetch(oracleAccount.publicKey);
    const solPrice = solPriceAccount.cachedPriceSol.toNumber();

    // 假設我們的對沖策略是基於 SOL 價格的，例如對沖金額 = 基礎金額 * SOL 價格
    const baseAmount = 1000000; // 1 SOL
    const calculatedHedgingAmount = baseAmount * solPrice;

    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    const manageHedgingInstruction = await program.methods
      .manageHedging(new anchor.BN(calculatedHedgingAmount))
      .accounts({
        user: user.publicKey,
        userTokenAccount,
        hedgingVault,
        hedgingRecord,
        systemState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([manageHedgingInstruction], [user]);

    // 驗證 hedging record
    const hedgingRecordAccount = await program.account.hedgingRecord.fetch(hedgingRecord);
    expect(hedgingRecordAccount.amount.toNumber()).to.equal(calculatedHedgingAmount);
  });

  it("Fails when system is paused", async () => {
    // 暫停系統
    const pauseSystemInstruction = await program.methods
      .pauseSystem()
      .accounts({
        systemState,
        authority: authority,
      } as any)
      .instruction();

    await createAndSendV0Tx([pauseSystemInstruction]);

    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    try {
      const manageHedgingInstruction = await program.methods
        .manageHedging(new anchor.BN(HEDGING_AMOUNT))
        .accounts({
          user: user.publicKey,
          userTokenAccount,
          hedgingVault,
          hedgingRecord,
          systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      await createAndSendV0Tx([manageHedgingInstruction], [user]);
      expect.fail("預期會拋出錯誤");
    } catch (error: any) {
      expect(error.toString()).to.include("System is paused");
    }

    // 取消暫停系統
    const unpauseSystemInstruction = await program.methods
      .unpauseSystem()
      .accounts({
        systemState,
        authority: authority,
      } as any)
      .instruction();

    await createAndSendV0Tx([unpauseSystemInstruction]);
  });

  it("Fails when trying to hedge with zero amount", async () => {
    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    try {
      const manageHedgingInstruction = await program.methods
        .manageHedging(new anchor.BN(0))
        .accounts({
          user: user.publicKey,
          userTokenAccount,
          hedgingVault,
          hedgingRecord,
          systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      await createAndSendV0Tx([manageHedgingInstruction], [user]);
      expect.fail("預期會拋出錯誤");
    } catch (error: any) {
      expect(error.toString()).to.include("Invalid amount");
    }
  });

  it("Fails when user has insufficient balance", async () => {
    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    const excessiveAmount = HEDGING_AMOUNT + 1;

    try {
      const manageHedgingInstruction = await program.methods
        .manageHedging(new anchor.BN(excessiveAmount))
        .accounts({
          user: user.publicKey,
          userTokenAccount,
          hedgingVault,
          hedgingRecord,
          systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .instruction();

      await createAndSendV0Tx([manageHedgingInstruction], [user]);
      expect.fail("預期會拋出錯誤");
    } catch (error: any) {
      expect(error.toString()).to.include("Insufficient balance");
    }
  });

  async function createAndSendV0Tx(txInstructions: anchor.web3.TransactionInstruction[], signers: Keypair[] = []) {
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
});
