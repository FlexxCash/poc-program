import { Program } from "@coral-xyz/anchor";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { HedgingStrategy } from "../target/types/hedging_strategy";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("hedging_strategy with Bankrun", () => {
  const PROJECT_DIRECTORY = ""; // 使用預設的 Anchor 專案目錄
  const HEDGING_AMOUNT = 1000000000; // 1 token，9 個小數位
  let context: any;
  let provider: BankrunProvider;
  let program: Program<HedgingStrategy>;
  let mint: PublicKey;
  let user: Keypair;
  let authority: Keypair;
  let userTokenAccount: PublicKey;
  let hedgingVault: PublicKey;
  let systemState: PublicKey;

  before(async () => {
    context = await startAnchor(PROJECT_DIRECTORY, [], []);
    provider = new BankrunProvider(context);
    // 不使用 setProvider，直接從 provider 獲取 program
    program = provider.programs["hedging_strategy"] as Program<HedgingStrategy>;

    user = Keypair.generate();
    authority = Keypair.generate();

    // 空投 SOL 給 user 和 authority
    await provider.banksClient.processTransaction(
      await provider.banksClient.simulateTransaction(
        new PublicKey(user.publicKey)
      )
    );
    await provider.banksClient.processTransaction(
      await provider.banksClient.simulateTransaction(
        new PublicKey(authority.publicKey)
      )
    );

    // 創建 mint
    mint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      9
    );

    // 創建 user token account
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );

    // 創建 hedging vault
    hedgingVault = await createAccount(
      provider.connection,
      user,
      mint,
      program.programId
    );

    // Mint tokens 給 user
    await mintTo(
      provider.connection,
      user,
      mint,
      userTokenAccount,
      user.publicKey,
      HEDGING_AMOUNT
    );

    // 初始化 system state
    const [systemStatePda] = await PublicKey.findProgramAddress(
      [Buffer.from("system_state")],
      program.programId
    );
    systemState = systemStatePda;

    await program.methods
      .initializeSystemState()
      .accounts({
        systemState: systemState,
        authority: authority.publicKey,
        systemProgram: TOKEN_PROGRAM_ID, // 確認 systemProgram 的正確性
      })
      .signers([authority])
      .rpc();
  });

  it("Manages hedging successfully", async () => {
    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .manageHedging(new anchor.BN(HEDGING_AMOUNT))
      .accounts({
        user: user.publicKey,
        userTokenAccount,
        hedgingVault,
        hedgingRecord,
        systemState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: TOKEN_PROGRAM_ID, // 確認 systemProgram 的正確性
      })
      .signers([user])
      .rpc();

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

  it("Fails when system is paused", async () => {
    // 暫停系統
    await program.methods
      .pauseSystem()
      .accounts({
        systemState,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .manageHedging(new anchor.BN(HEDGING_AMOUNT))
        .accounts({
          user: user.publicKey,
          userTokenAccount,
          hedgingVault,
          hedgingRecord,
          systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: TOKEN_PROGRAM_ID, // 確認 systemProgram 的正確性
        })
        .signers([user])
        .rpc();
      expect.fail("預期會拋出錯誤");
    } catch (error: any) {
      expect(error.toString()).to.include("System is paused");
    }

    // 取消暫停系統
    await program.methods
      .unpause_system()
      .accounts({
        systemState,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  });

  it("Fails when trying to hedge with zero amount", async () => {
    const [hedgingRecord] = await PublicKey.findProgramAddress(
      [Buffer.from("hedging_record"), user.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .manageHedging(new anchor.BN(0))
        .accounts({
          user: user.publicKey,
          userTokenAccount,
          hedgingVault,
          hedgingRecord,
          systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: TOKEN_PROGRAM_ID, // 確認 systemProgram 的正確性
        })
        .signers([user])
        .rpc();
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
      await program.methods
        .manageHedging(new anchor.BN(excessiveAmount))
        .accounts({
          user: user.publicKey,
          userTokenAccount,
          hedgingVault,
          hedgingRecord,
          systemState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: TOKEN_PROGRAM_ID, // 確認 systemProgram 的正確性
        })
        .signers([user])
        .rpc();
      expect.fail("預期會拋出錯誤");
    } catch (error: any) {
      expect(error.toString()).to.include("Insufficient balance");
    }
  });
});