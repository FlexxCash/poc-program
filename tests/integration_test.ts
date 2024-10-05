import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PriceOracle } from "../target/types/price_oracle";
import { expect } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

describe("FlexxCash Integration Tests", () => {
  // 配置 Anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // 獲取 PriceOracle 程式實例
  const priceOracleProgram = anchor.workspace.PriceOracle as Program<PriceOracle>;

  // 生成 Oracle 帳戶 
  const oracleAccount = Keypair.generate();

  // 模擬 Switchboard feed 公鑰
  const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  const mockInterestAssetFeed = new PublicKey("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1");

  before(async () => {
    // 初始化 Oracle 帳戶
    try {
      await priceOracleProgram.methods
        .initialize()
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          authority: provider.wallet.publicKey,
          solFeed: mockSolFeed,
          interestAssetFeed: mockInterestAssetFeed,
        })
        .signers([oracleAccount])
        .rpc();

      console.log("Oracle account initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Oracle account:", error);
      throw error;
    }
  });

  it("Integrates PriceOracle with other components", async () => {
    // 獲取 SOL 價格
    await priceOracleProgram.methods
      .getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
      })
      .rpc();

    const solPriceAccount = await priceOracleProgram.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(solPriceAccount.cachedPriceSol.toNumber()).to.be.greaterThan(0);

    // 獲取 InterestAsset 數據
    await priceOracleProgram.methods
      .getPrice("InterestAsset")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
      })
      .rpc();

    const interestAssetAccount = await priceOracleProgram.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(interestAssetAccount.jupsolPrice).to.be.greaterThan(0);
    expect(interestAssetAccount.jupsolApy).to.be.greaterThan(0);

    // TODO: 添加與其他模組的集成測試
    // 例如：使用獲取的價格數據來執行資產管理、對沖策略等操作
  });

  // 可以添加更多的集成測試...
});