import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HedgingStrategy } from "../target/types/hedging_strategy";
import { expect } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

describe("hedging_strategy", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HedgingStrategy as Program<HedgingStrategy>;

  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let hedgingVault: PublicKey;
  let user: Keypair;
  let systemState: PublicKey;
  let authority: Keypair;

  const HEDGING_AMOUNT = 1000000000; // 1 token with 9 decimals

  before(async () => {
    user = Keypair.generate();
    authority = Keypair.generate();

    // Airdrop SOL to user and authority
    await provider.connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(authority.publicKey, LAMPORTS_PER_SOL);

    // Create mint
    mint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      9
    );

    // Create user token account
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );

    // Create hedging vault
    hedgingVault = await createAccount(
      provider.connection,
      user,
      mint,
      program.programId
    );

    // Mint tokens to user
    await mintTo(
      provider.connection,
      user,
      mint,
      userTokenAccount,
      user.publicKey,
      HEDGING_AMOUNT
    );

    // Initialize system state
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
        systemProgram: SystemProgram.programId,
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
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([user])
      .rpc();

    // Verify hedging record
    const hedgingRecordAccount = await program.account.hedgingRecord.fetch(hedgingRecord);
    expect(hedgingRecordAccount.user.toString()).to.equal(user.publicKey.toString());
    expect(hedgingRecordAccount.amount.toNumber()).to.equal(HEDGING_AMOUNT);
    expect(hedgingRecordAccount.isProcessing).to.be.false;

    // Verify token balances
    const userTokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
    const hedgingVaultInfo = await getAccount(provider.connection, hedgingVault);
    expect(Number(userTokenAccountInfo.amount)).to.equal(0);
    expect(Number(hedgingVaultInfo.amount)).to.equal(HEDGING_AMOUNT);
  });

  it("Fails when system is paused", async () => {
    // Pause the system
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
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([user])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.toString()).to.include("System is paused");
    }

    // Unpause the system
    await program.methods
      .unpauseSystem()
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
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([user])
        .rpc();
      expect.fail("Expected an error to be thrown");
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
        } as any)
        .signers([user])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.toString()).to.include("Insufficient balance");
    }
  });
});