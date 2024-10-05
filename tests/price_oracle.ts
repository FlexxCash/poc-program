import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PriceOracle } from "../target/types/price_oracle";
import { expect } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

describe("PriceOracle Tests on Devnet", () => {
  // 配置 Anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // 獲取程式實例
  const program = anchor.workspace.PriceOracle as Program<PriceOracle>;

  // 生成 Oracle 帳戶 
  const oracleAccount = Keypair.generate();

  // 模擬 Switchboard feed 公鑰
  const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  const mockJupsolPriceFeed = new PublicKey("FeedPubkeyForJupSOLPrice");
  const mockJupsolApyFeed = new PublicKey("FeedPubkeyForJupSOLAPY");
  const mockVsolPriceFeed = new PublicKey("FeedPubkeyForvSOLPrice");
  const mockVsolApyFeed = new PublicKey("FeedPubkeyForvSOLAPY");
  const mockBsolPriceFeed = new PublicKey("FeedPubkeyForbSOLPrice");
  const mockBsolApyFeed = new PublicKey("FeedPubkeyForbSOLAPY");
  const mockMsolPriceFeed = new PublicKey("FeedPubkeyFormSOLPrice");
  const mockMsolApyFeed = new PublicKey("FeedPubkeyFormSOLAPY");
  const mockHsolPriceFeed = new PublicKey("FeedPubkeyForHSOLPrice");
  const mockHsolApyFeed = new PublicKey("FeedPubkeyForHSOLAPY");
  const mockJitosolPriceFeed = new PublicKey("FeedPubkeyForJitoSOLPrice");
  const mockJitosolApyFeed = new PublicKey("FeedPubkeyForJitoSOLAPY");

  before(async () => {
    // 初始化 Oracle 帳戶
    try {
      await program.methods
        .initialize()
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          authority: provider.wallet.publicKey,
          solFeed: mockSolFeed,
          jupsolPriceFeed: mockJupsolPriceFeed,
          jupsolApyFeed: mockJupsolApyFeed,
          vsolPriceFeed: mockVsolPriceFeed,
          vsolApyFeed: mockVsolApyFeed,
          bsolPriceFeed: mockBsolPriceFeed,
          bsolApyFeed: mockBsolApyFeed,
          msolPriceFeed: mockMsolPriceFeed,
          msolApyFeed: mockMsolApyFeed,
          hsolPriceFeed: mockHsolPriceFeed,
          hsolApyFeed: mockHsolApyFeed,
          jitosolPriceFeed: mockJitosolPriceFeed,
          jitosolApyFeed: mockJitosolApyFeed,
        })
        .signers([oracleAccount])
        .rpc();

      console.log("Oracle account initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Oracle account:", error);
      throw error;
    }
  });

  it("Initializes the oracle account", async () => {
    const account = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(account.authority.toString()).to.equal(provider.wallet.publicKey.toString());
    expect(account.solFeed.toString()).to.equal(mockSolFeed.toString());
    expect(account.lastUpdateTimestampSol.toNumber()).to.equal(0);
    expect(account.cachedPriceSol.toNumber()).to.equal(0);
  });

  it("Fetches and updates the SOL price successfully", async () => {
    await program.methods
      .getPrice("SOL", "price")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        jupsolPriceFeed: mockJupsolPriceFeed,
        jupsolApyFeed: mockJupsolApyFeed,
        vsolPriceFeed: mockVsolPriceFeed,
        vsolApyFeed: mockVsolApyFeed,
        bsolPriceFeed: mockBsolPriceFeed,
        bsolApyFeed: mockBsolApyFeed,
        msolPriceFeed: mockMsolPriceFeed,
        msolApyFeed: mockMsolApyFeed,
        hsolPriceFeed: mockHsolPriceFeed,
        hsolApyFeed: mockHsolApyFeed,
        jitosolPriceFeed: mockJitosolPriceFeed,
        jitosolApyFeed: mockJitosolApyFeed,
      })
      .rpc();

    const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(updatedAccount.cachedPriceSol.toNumber()).to.be.greaterThan(0);
  });

  it("Uses cached SOL price on subsequent fetch", async () => {
    const result = await program.methods
      .getPrice("SOL", "price")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        jupsolPriceFeed: mockJupsolPriceFeed,
        jupsolApyFeed: mockJupsolApyFeed,
        vsolPriceFeed: mockVsolPriceFeed,
        vsolApyFeed: mockVsolApyFeed,
        bsolPriceFeed: mockBsolPriceFeed,
        bsolApyFeed: mockBsolApyFeed,
        msolPriceFeed: mockMsolPriceFeed,
        msolApyFeed: mockMsolApyFeed,
        hsolPriceFeed: mockHsolPriceFeed,
        hsolApyFeed: mockHsolApyFeed,
        jitosolPriceFeed: mockJitosolPriceFeed,
        jitosolApyFeed: mockJitosolApyFeed,
      })
      .view();

    const account = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(result[0].toString()).to.equal(account.cachedPriceSol.toString());
  });

  it("Fetches and updates the JupSOL price successfully", async () => {
    const result = await program.methods
      .getPrice("JupSOL", "price")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        jupsolPriceFeed: mockJupsolPriceFeed,
        jupsolApyFeed: mockJupsolApyFeed,
        vsolPriceFeed: mockVsolPriceFeed,
        vsolApyFeed: mockVsolApyFeed,
        bsolPriceFeed: mockBsolPriceFeed,
        bsolApyFeed: mockBsolApyFeed,
        msolPriceFeed: mockMsolPriceFeed,
        msolApyFeed: mockMsolApyFeed,
        hsolPriceFeed: mockHsolPriceFeed,
        hsolApyFeed: mockHsolApyFeed,
        jitosolPriceFeed: mockJitosolPriceFeed,
        jitosolApyFeed: mockJitosolApyFeed,
      })
      .rpc();

    const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(updatedAccount.cachedPriceJupsol.toNumber()).to.be.greaterThan(0);
  });

  it("Fetches and updates the JupSOL APY successfully", async () => {
    const result = await program.methods
      .getPrice("JupSOL", "apy")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        jupsolPriceFeed: mockJupsolPriceFeed,
        jupsolApyFeed: mockJupsolApyFeed,
        vsolPriceFeed: mockVsolPriceFeed,
        vsolApyFeed: mockVsolApyFeed,
        bsolPriceFeed: mockBsolPriceFeed,
        bsolApyFeed: mockBsolApyFeed,
        msolPriceFeed: mockMsolPriceFeed,
        msolApyFeed: mockMsolApyFeed,
        hsolPriceFeed: mockHsolPriceFeed,
        hsolApyFeed: mockHsolApyFeed,
        jitosolPriceFeed: mockJitosolPriceFeed,
        jitosolApyFeed: mockJitosolApyFeed,
      })
      .rpc();

    const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    expect(updatedAccount.cachedApyJupsol).to.be.greaterThan(0);
  });

  it("Fails to fetch price for invalid asset", async () => {
    try {
      await program.methods
        .getPrice("INVALID", "price")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          solFeed: mockSolFeed,
          jupsolPriceFeed: mockJupsolPriceFeed,
          jupsolApyFeed: mockJupsolApyFeed,
          vsolPriceFeed: mockVsolPriceFeed,
          vsolApyFeed: mockVsolApyFeed,
          bsolPriceFeed: mockBsolPriceFeed,
          bsolApyFeed: mockBsolApyFeed,
          msolPriceFeed: mockMsolPriceFeed,
          msolApyFeed: mockMsolApyFeed,
          hsolPriceFeed: mockHsolPriceFeed,
          hsolApyFeed: mockHsolApyFeed,
          jitosolPriceFeed: mockJitosolPriceFeed,
          jitosolApyFeed: mockJitosolApyFeed,
        })
        .rpc();
      expect.fail('應該拋出錯誤');
    } catch (error: any) {
      expect(error.error.errorCode.code).to.equal("InvalidAsset");
    }
  });

  it("Fails to fetch data for invalid data type", async () => {
    try {
      await program.methods
        .getPrice("SOL", "invalid")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          solFeed: mockSolFeed,
          jupsolPriceFeed: mockJupsolPriceFeed,
          jupsolApyFeed: mockJupsolApyFeed,
          vsolPriceFeed: mockVsolPriceFeed,
          vsolApyFeed: mockVsolApyFeed,
          bsolPriceFeed: mockBsolPriceFeed,
          bsolApyFeed: mockBsolApyFeed,
          msolPriceFeed: mockMsolPriceFeed,
          msolApyFeed: mockMsolApyFeed,
          hsolPriceFeed: mockHsolPriceFeed,
          hsolApyFeed: mockHsolApyFeed,
          jitosolPriceFeed: mockJitosolPriceFeed,
          jitosolApyFeed: mockJitosolApyFeed,
        })
        .rpc();
      expect.fail('應該拋出錯誤');
    } catch (error: any) {
      expect(error.error.errorCode.code).to.equal("InvalidAsset");
    }
  });
});