import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LockManager } from "../target/types/lock_manager";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

describe("lock_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LockManager as Program<LockManager>;
  const user = Keypair.generate();
  const authority = new PublicKey("EJ5XgoBodvu2Ts6EasT3umoSL1zSWoDTGiQKKg8naWJe");

  let xxusdMint: PublicKey;
  let userTokenAccount: PublicKey;
  let lockVault: PublicKey;
  let lockManager: PublicKey;
  let lockRecord: PublicKey;

  before(async () => {
    // 空投 SOL 給 user
    const airdropSignature = await provider.connection.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSignature);

    // 創建 xxUSD mint
    xxusdMint = await createMint(
      provider.connection,
      user,
      authority,
      null,
      6 // 6 decimals for xxUSD
    );

    // 創建使用者的 xxUSD 帳戶
    userTokenAccount = await getAssociatedTokenAddress(xxusdMint, user.publicKey);
    await mintTo(
      provider.connection,
      user,
      xxusdMint,
      userTokenAccount,
      authority,
      1_000_000_000 // Mint 1000 xxUSD to user
    );

    // 推導 LockManager PDA
    [lockManager] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock_manager")],
      program.programId
    );

    // 創建 lock vault
    lockVault = await getAssociatedTokenAddress(xxusdMint, lockManager, true);

    // 推導 LockRecord PDA
    [lockRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("lock_record"), user.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Locks xxUSD tokens successfully", async () => {
    const amount = new anchor.BN(100_000_000); // 100 xxUSD
    const lockPeriod = new anchor.BN(30); // 30 days
    const dailyRelease = new anchor.BN(3_333_333); // ~3.33 xxUSD per day

    await program.methods
      .lockXxusd(amount, lockPeriod, dailyRelease)
      .accounts({
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        xxusdMint: xxusdMint,
        lockVault: lockVault,
        lockManager: lockManager,
        lockRecord: lockRecord,
        assetManager: new PublicKey("91hM5ZdHVbH7tH1a21QHRmPEFkHWS532DfcpGPBUkdAF"),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    // 驗證 lock record
    const lockRecordAccount = await program.account.lockRecord.fetch(lockRecord);
    expect(lockRecordAccount.owner.toString()).to.equal(user.publicKey.toString());
    expect(lockRecordAccount.amount.toNumber()).to.equal(100_000_000);
    expect(lockRecordAccount.lockPeriod.toNumber()).to.equal(30);
    expect(lockRecordAccount.dailyRelease.toNumber()).to.equal(3_333_333);

    // 驗證 token balances
    const userBalance = await getAccount(provider.connection, userTokenAccount);
    const vaultBalance = await getAccount(provider.connection, lockVault);
    expect(Number(userBalance.amount)).to.equal(900_000_000); // 900 xxUSD left
    expect(Number(vaultBalance.amount)).to.equal(100_000_000); // 100 xxUSD locked
  });

  it("Releases daily xxUSD tokens successfully", async () => {
    // 等待一天
    await new Promise(resolve => setTimeout(resolve, 1000));

    await program.methods
      .releaseDailyXxusd()
      .accounts({
        user: user.publicKey,
        userTokenAccount: userTokenAccount,
        xxusdMint: xxusdMint,
        lockVault: lockVault,
        lockManager: lockManager,
        lockRecord: lockRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // 驗證更新後的 lock record
    const lockRecordAccount = await program.account.lockRecord.fetch(lockRecord);
    expect(lockRecordAccount.amount.toNumber()).to.be.below(100_000_000);

    // 驗證 token balances
    const userBalance = await getAccount(provider.connection, userTokenAccount);
    const vaultBalance = await getAccount(provider.connection, lockVault);
    expect(Number(userBalance.amount)).to.be.above(900_000_000); // 使用者應收到一些 xxUSD
    expect(Number(vaultBalance.amount)).to.be.below(100_000_000); // Vault 的 xxUSD 減少
  });

  it("Checks lock status successfully", async () => {
    const lockStatus = await program.methods
      .checkLockStatus()
      .accounts({
        user: user.publicKey,
        lockRecord: lockRecord,
      })
      .view();

    expect(lockStatus.isLocked).to.be.true;
    expect(lockStatus.remainingLockTime.toNumber()).to.be.above(0);
    expect(lockStatus.redeemableAmount.toNumber()).to.be.above(0);
    expect(lockStatus.redemptionDeadline.toNumber()).to.be.above(0);
  });

  it("Checks if within redemption window", async () => {
    const isWithinWindow = await program.methods
      .isWithinRedemptionWindow()
      .accounts({
        user: user.publicKey,
        lockRecord: lockRecord,
      })
      .view();

    expect(isWithinWindow).to.be.false;
  });

  it("Fails to release twice in the same day", async () => {
    try {
      await program.methods
        .releaseDailyXxusd()
        .accounts({
          user: user.publicKey,
          userTokenAccount: userTokenAccount,
          xxusdMint: xxusdMint,
          lockVault: lockVault,
          lockManager: lockManager,
          lockRecord: lockRecord,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.message).to.include("Already released today");
    }
  });

  it("Fails to release with invalid owner", async () => {
    const invalidUser = Keypair.generate();
    await provider.connection.requestAirdrop(invalidUser.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

    const invalidUserTokenAccount = await getAssociatedTokenAddress(xxusdMint, invalidUser.publicKey);

    try {
      await program.methods
        .releaseDailyXxusd()
        .accounts({
          user: invalidUser.publicKey,
          userTokenAccount: invalidUserTokenAccount,
          xxusdMint: xxusdMint,
          lockVault: lockVault,
          lockManager: lockManager,
          lockRecord: lockRecord,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([invalidUser])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.message).to.include("Invalid owner");
    }
  });

  it("Fails to check redemption window with invalid owner", async () => {
    const invalidUser = Keypair.generate();
    await provider.connection.requestAirdrop(invalidUser.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

    try {
      await program.methods
        .isWithinRedemptionWindow()
        .accounts({
          user: invalidUser.publicKey,
          lockRecord: lockRecord,
        })
        .view();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.message).to.include("Invalid owner");
    }
  });
});