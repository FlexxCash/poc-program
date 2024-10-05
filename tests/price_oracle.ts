import { Program } from "@coral-xyz/anchor";
import { PriceOracle } from "../target/types/price_oracle";
import { expect } from "chai";
import {
  startAnchor,
  ProgramTestContext,
  BanksClient,
  BanksTransactionResultWithMeta,
} from "solana-bankrun";
import { PublicKey, Transaction, Keypair, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { assert } from "chai";
import { BankrunProvider } from "anchor-bankrun";

describe("PriceOracle Tests with Bankrun", () => {
  const PRICE_ORACLE_PROGRAM_ID = new PublicKey("YourPriceOracleProgramID"); // 替換為你的 PriceOracle 程序 ID
  let context: ProgramTestContext;
  let client: BanksClient;
  let payer: Keypair;
  let provider: BankrunProvider;
  let program: Program<PriceOracle>;
  let oracleAccount: Keypair;

  before(async () => {
    // 啟動 Bankrun 測試環境並部署 PriceOracle 程序
    context = await startAnchor("/home/dc/flexxcash_xxUSD/flexxcash-poc", [], []);
    client = context.banksClient;
    payer = context.payer;
    provider = new BankrunProvider(context);

    // 設定 Anchor 的提供者
    // @ts-ignore
    (Program as any).defaults.provider = provider;

    program = new Program<PriceOracle>(
      require("../target/idl/price_oracle.json"),
      PRICE_ORACLE_PROGRAM_ID,
      provider
    );

    // 生成 Oracle 帳戶
    oracleAccount = Keypair.generate();

    // 初始化 Oracle 帳戶
    const initializeIx = await program.methods
      .initialize()
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        authority: payer.publicKey,
        feed: new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR"), // 替換為實際的 feed 公鑰
      })
      .signers([oracleAccount])
      .instruction();

    const initializeTx = new Transaction().add(initializeIx);
    initializeTx.recentBlockhash = context.lastBlockhash;
    initializeTx.feePayer = payer.publicKey;
    initializeTx.sign(payer, oracleAccount);

    const initializeResult: BanksTransactionResultWithMeta = await client.tryProcessTransaction(initializeTx);
    expect(initializeResult.result).to.be.null;

    // 檢查 Oracle 帳戶是否正確初始化
    const account = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    assert.ok(account.authority.equals(payer.publicKey));
    assert.ok(account.feed.equals(new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR")));
    assert.equal(account.lastUpdateTimestamp.toNumber(), 0);
    assert.equal(account.cachedPrice.toNumber(), 0);
  });

  describe("Get Price Functionality", () => {
    it("Fetches and updates the price successfully", async () => {
      // 模擬獲取價格
      const getPriceIx = await program.methods
        .getPrice("SOL")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          feed: new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR"),
        })
        .instruction();

      const tx = new Transaction().add(getPriceIx);
      tx.recentBlockhash = context.lastBlockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer);

      const result: BanksTransactionResultWithMeta = await client.tryProcessTransaction(tx);
      expect(result.result).to.be.null;

      // 檢查價格是否已更新
      const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
      expect(updatedAccount.cachedPrice.toNumber()).to.be.greaterThan(0);
    });

    it("Uses cached price on subsequent fetch", async () => {
      // 再次獲取價格，應該使用緩存
      const cachedPrice = await program.methods
        .getPrice("SOL")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          feed: new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR"),
        })
        .view();

      const account = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
      expect(cachedPrice.toString()).to.equal(account.cachedPrice.toString());
    });

    it("Fails to fetch price for invalid asset", async () => {
      try {
        await program.methods
          .getPrice("")
          .accounts({
            oracleAccount: oracleAccount.publicKey,
            feed: new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR"),
          })
          .view();
        assert.fail('應該拋出錯誤');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).to.include('InvalidAsset');
        } else {
          throw error;
        }
      }
    });

    it("Fails to fetch price from uninitialized oracle", async () => {
      const uninitializedOracle = Keypair.generate();
      try {
        await program.methods
          .getPrice("SOL")
          .accounts({
            oracleAccount: uninitializedOracle.publicKey,
            feed: new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR"),
          })
          .view();
        assert.fail('應該拋出錯誤');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).to.include('NotInitialized');
        } else {
          throw error;
        }
      }
    });
  });
});