import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PriceOracle } from "../target/types/price_oracle";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, TransactionInstruction, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";

describe("PriceOracle Tests on Devnet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PriceOracle as Program<PriceOracle>;
  const user = provider.wallet.publicKey;

  const oracleAccount = Keypair.generate();

  const mockSolFeed = Keypair.generate();
  const mockInterestAssetFeed = Keypair.generate();

  // 模擬 PullFeedAccountData 結構
  const mockSolFeedData = Buffer.alloc(8 + 8); // 假設包含價格和其他必要字段
  const mockInterestAssetFeedData = Buffer.alloc(8 + 8); // 根據實際結構調整大小
  // 假設 buffer 中包含價格數據，根據需要填充
  mockSolFeedData.writeBigUInt64BE(BigInt(3000), 0); // 假設 SOL 價格為 3000
  mockInterestAssetFeedData.writeBigUInt64BE(BigInt(150), 0); // 假設 Interest Asset 價格為 150

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
      throw new Error(`   ❌ - Transaction not confirmed.\nReason: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log("🎉 Transaction confirmed successfully!");
  }

  before(async () => {
    try {
      // 創建並初始化 mockSolFeed 賬戶
      const createSolFeedIx = SystemProgram.createAccount({
        fromPubkey: user,
        newAccountPubkey: mockSolFeed.publicKey,
        space: mockSolFeedData.length,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(mockSolFeedData.length),
        programId: new PublicKey("86q3eW5qBFL5SpjpAAAckwMk5Ay4rv4wGbxNmFVQLCk6"), // 替換為 Switchboard 項目程式 ID
      });

      const initSolFeedIx = new TransactionInstruction({
        keys: [{ pubkey: mockSolFeed.publicKey, isSigner: false, isWritable: true }],
        programId: new PublicKey("86q3eW5qBFL5SpjpAAAckwMk5Ay4rv4wGbxNmFVQLCk6"), // 替換為 Switchboard 項目程式 ID
        data: mockSolFeedData, // 這裡假設程式能夠解析這個數據
      });

      // 創建並初始化 mockInterestAssetFeed 賬戶
      const createInterestAssetFeedIx = SystemProgram.createAccount({
        fromPubkey: user,
        newAccountPubkey: mockInterestAssetFeed.publicKey,
        space: mockInterestAssetFeedData.length,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(mockInterestAssetFeedData.length),
        programId: new PublicKey("86q3eW5qBFL5SpjpAAAckwMk5Ay4rv4wGbxNmFVQLCk6"), // 替換為 Switchboard 項目程式 ID
      });

      const initInterestAssetFeedIx = new TransactionInstruction({
        keys: [{ pubkey: mockInterestAssetFeed.publicKey, isSigner: false, isWritable: true }],
        programId: new PublicKey("86q3eW5qBFL5SpjpAAAckwMk5Ay4rv4wGbxNmFVQLCk6"), // 替換為 Switchboard 項目程式 ID
        data: mockInterestAssetFeedData, // 這裡假設程式能夠解析這個數據
      });

      // 發送交易初始化 Feed 賬戶
      await createAndSendV0Tx([
        createSolFeedIx,
        initSolFeedIx,
        createInterestAssetFeedIx,
        initInterestAssetFeedIx,
      ], [mockSolFeed, mockInterestAssetFeed]);

      console.log("Mock Feed accounts initialized successfully");

      // 初始化 Oracle 賬戶
      const initializeInstruction = await program.methods
        .initialize()
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          authority: provider.wallet.publicKey,
          solFeed: mockSolFeed.publicKey,
          interestAssetFeed: mockInterestAssetFeed.publicKey,
          system_program: SystemProgram.programId,
        } as any)
        .instruction();

      await createAndSendV0Tx([initializeInstruction], [oracleAccount]);
      console.log("Oracle account initialized successfully");
    } catch (error) {
      console.error("Failed to initialize accounts:", error);
      throw error;
    }
  });

  it("Initializes the oracle account", async () => {
    const account = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(account.authority.toString()).to.equal(provider.wallet.publicKey.toString());
    expect(account.solFeed.toString()).to.equal(mockSolFeed.publicKey.toString());
    expect(account.interestAssetFeed.toString()).to.equal(mockInterestAssetFeed.publicKey.toString());
    expect(account.lastUpdateTimestampSol.toNumber()).to.equal(0);
    expect(account.cachedPriceSol.toNumber()).to.equal(0);
    expect(account.lastUpdateTimestampInterestAsset.toNumber()).to.equal(0);
  });

  it("Fetches and updates the SOL price successfully", async () => {
    const getPriceInstruction = await program.methods
      .getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed.publicKey,
        interestAssetFeed: mockInterestAssetFeed.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([getPriceInstruction]);

    const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(updatedAccount.cachedPriceSol.toNumber()).to.be.greaterThan(0);
    expect(updatedAccount.lastUpdateTimestampSol.toNumber()).to.be.greaterThan(0);
  });

  it("Uses cached SOL price on subsequent fetch", async () => {
    const beforeFetch = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    const beforeTimestamp = beforeFetch.lastUpdateTimestampSol;

    const getPriceInstruction = await program.methods
      .getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed.publicKey,
        interestAssetFeed: mockInterestAssetFeed.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([getPriceInstruction]);

    const afterFetch = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(afterFetch.cachedPriceSol.toNumber()).to.be.greaterThan(0);
    expect(afterFetch.lastUpdateTimestampSol.toNumber()).to.equal(beforeTimestamp.toNumber());
  });

  it("Fetches and updates the Interest Asset data successfully", async () => {
    const getPriceInstruction = await program.methods
      .getPrice("InterestAsset")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed.publicKey,
        interestAssetFeed: mockInterestAssetFeed.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([getPriceInstruction]);

    const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    
    const assets = ["jupsol", "vsol", "bsol", "msol", "hsol", "jitosol"];
    for (const asset of assets) {
      expect((updatedAccount as any)[`${asset}Price`]).to.be.greaterThan(0);
      expect((updatedAccount as any)[`${asset}Apy`]).to.be.greaterThan(0);
    }

    expect(updatedAccount.lastUpdateTimestampInterestAsset.toNumber()).to.be.greaterThan(0);
  });

  it("Uses cached Interest Asset data on subsequent fetch within 60 seconds", async () => {
    // First fetch
    const firstFetchInstruction = await program.methods
      .getPrice("InterestAsset")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed.publicKey,
        interestAssetFeed: mockInterestAssetFeed.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([firstFetchInstruction]);

    const firstFetch = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    const firstTimestamp = firstFetch.lastUpdateTimestampInterestAsset;

    // Second fetch (should use cached data)
    const secondFetchInstruction = await program.methods
      .getPrice("InterestAsset")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed.publicKey,
        interestAssetFeed: mockInterestAssetFeed.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([secondFetchInstruction]);

    const secondFetch = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    const secondTimestamp = secondFetch.lastUpdateTimestampInterestAsset;

    expect(secondTimestamp.toNumber()).to.equal(firstTimestamp.toNumber());
  });

  it("Fails to fetch price for invalid asset", async () => {
    try {
      const getPriceInstruction = await program.methods
        .getPrice("INVALID")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          solFeed: mockSolFeed.publicKey,
          interestAssetFeed: mockInterestAssetFeed.publicKey,
        } as any)
        .instruction();

      await createAndSendV0Tx([getPriceInstruction]);
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.toString()).to.include("InvalidAsset");
    }
  });
});