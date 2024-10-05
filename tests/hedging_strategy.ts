import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HedgingStrategy } from "../target/types/hedging_strategy";
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

describe("hedging_strategy", () => {
  const HEDGING_AMOUNT = 1000000000; // 1 token，9 個小數位
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HedgingStrategy as Program<HedgingStrategy>;
  const user = Keypair.generate();
  const authority = new PublicKey("EJ5XgoBodvu2Ts6EasT3umoSL1zSWoDTGiQKKg8naWJe");

  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let hedgingVault: PublicKey;
  let systemState: PublicKey;

  before(async () => {

    // 創建 mint
    mint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      9
    );

    // 創建 user token account
    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );

    // 創建 hedging vault
    hedgingVault = await createAssociatedTokenAccount(
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
      user,
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
        authority: authority,
        systemProgram: SystemProgram.programId,
      })
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
        systemProgram: SystemProgram.programId,
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
        authority: authority,
      })
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
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("預期會拋出錯誤");
    } catch (error: any) {
      expect(error.toString()).to.include("System is paused");
    }

    // 取消暫停系統
    await program.methods
      .unpauseSystem()
      .accounts({
        systemState,
        authority: authority,
      })
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
          systemProgram: SystemProgram.programId,
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
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("預期會拋出錯誤");
    } catch (error: any) {
      expect(error.toString()).to.include("Insufficient balance");
    }
  });
});