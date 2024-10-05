import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FlexxcashPoc } from "../target/types/flexxcash_poc";
import { PriceOracle } from "../target/types/price_oracle";
import { expect } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

describe("flexxcash-poc", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FlexxcashPoc as Program<FlexxcashPoc>;
  const priceOracleProgram = anchor.workspace.PriceOracle as Program<PriceOracle>;

  // 生成 Oracle 帳戶
  const oracleAccount = Keypair.generate();

  // 模擬 Switchboard feed 公鑰
  const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  const mockInterestAssetFeed = new PublicKey("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1");

  before(async () => {
    // 初始化 PriceOracle
    try {
      const initializeInstruction = await priceOracleProgram.methods
        .initialize()
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          authority: provider.wallet.publicKey,
          solFeed: mockSolFeed,
          interestAssetFeed: mockInterestAssetFeed,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .instruction();

      await createAndSendV0Tx([initializeInstruction], [oracleAccount]);

      console.log("PriceOracle initialized successfully");
    } catch (error) {
      console.error("Failed to initialize PriceOracle:", error);
      throw error;
    }
  });

  it("Initializes FlexxcashPoc and interacts with PriceOracle", async () => {
    try {
      // 初始化 FlexxcashPoc
      const initializeInstruction = await program.methods
        .initialize()
        .instruction();

      await createAndSendV0Tx([initializeInstruction]);
      console.log("FlexxcashPoc initialized successfully");

      // 使用 PriceOracle 獲取 SOL 價格
      const getPriceSolInstruction = await priceOracleProgram.methods
        .getPrice("SOL")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          solFeed: mockSolFeed,
          interestAssetFeed: mockInterestAssetFeed,
        } as any)
        .instruction();

      await createAndSendV0Tx([getPriceSolInstruction]);

      const solPriceAccount = await priceOracleProgram.account.oracleAccount.fetch(oracleAccount.publicKey);
      expect(solPriceAccount.cachedPriceSol.toNumber()).to.be.greaterThan(0);

      // TODO: 添加 FlexxcashPoc 使用 SOL 價格的邏輯
      // 例如：使用獲取的 SOL 價格來執行某些操作
      console.log("Current SOL price:", solPriceAccount.cachedPriceSol.toString());

      // 使用 PriceOracle 獲取 InterestAsset 數據
      const getPriceInterestAssetInstruction = await priceOracleProgram.methods
        .getPrice("InterestAsset")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          solFeed: mockSolFeed,
          interestAssetFeed: mockInterestAssetFeed,
        } as any)
        .instruction();

      await createAndSendV0Tx([getPriceInterestAssetInstruction]);

      const interestAssetAccount = await priceOracleProgram.account.oracleAccount.fetch(oracleAccount.publicKey);
      expect(interestAssetAccount.jupsolPrice).to.be.greaterThan(0);
      expect(interestAssetAccount.jupsolApy).to.be.greaterThan(0);

      // TODO: 添加 FlexxcashPoc 使用 InterestAsset 數據的邏輯
      // 例如：使用獲取的 InterestAsset 數據來執行某些操作
      console.log("Current JupSOL price:", interestAssetAccount.jupsolPrice.toString());
      console.log("Current JupSOL APY:", interestAssetAccount.jupsolApy.toString());
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
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
