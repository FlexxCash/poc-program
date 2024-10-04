import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LockManager } from "../target/types/lock_manager";
import { AssetManager } from "../target/types/asset_manager";
import { XxusdToken } from "../target/types/xxusd_token";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddress, getAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";

describe("lock_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const lockManagerProgram = anchor.workspace.LockManager as Program<LockManager>;
  const assetManagerProgram = anchor.workspace.AssetManager as Program<AssetManager>;
  const xxusdTokenProgram = anchor.workspace.XxusdToken as Program<XxusdToken>;

  let xxusdMint: anchor.web3.PublicKey;
  let userXxusdAccount: anchor.web3.PublicKey;
  let lockVault: anchor.web3.PublicKey;
  let lockManager: anchor.web3.PublicKey;
  let lockRecord: anchor.web3.PublicKey;
  let user: anchor.web3.Keypair;

  before(async () => {
    user = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

    // Create xxUSD mint
    xxusdMint = await createMint(
      provider.connection,
      user,
      provider.wallet.publicKey,
      null,
      6 // 6 decimals for xxUSD
    );

    // Create user's xxUSD account
    userXxusdAccount = await getAssociatedTokenAddress(xxusdMint, user.publicKey);
    await mintTo(
      provider.connection,
      user,
      xxusdMint,
      userXxusdAccount,
      provider.wallet.publicKey,
      1000000000 // Mint 1000 xxUSD to user
    );

    // Derive LockManager PDA
    [lockManager] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lock_manager")],
      lockManagerProgram.programId
    );

    // Create lock vault
    lockVault = await getAssociatedTokenAddress(xxusdMint, lockManager, true);

    // Derive LockRecord PDA
    [lockRecord] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lock_record"), user.publicKey.toBuffer()],
      lockManagerProgram.programId
    );
  });

  it("Locks xxUSD tokens", async () => {
    const amount = new anchor.BN(100000000); // 100 xxUSD
    const lockPeriod = new anchor.BN(30); // 30 days
    const dailyRelease = new anchor.BN(3333333); // ~3.33 xxUSD per day

    await lockManagerProgram.methods
      .lockXxusd(amount, lockPeriod, dailyRelease)
      .accounts({
        user: user.publicKey,
        userTokenAccount: userXxusdAccount,
        xxusdMint: xxusdMint,
        lockVault: lockVault,
        lockManager: lockManager,
        lockRecord: lockRecord,
        assetManager: assetManagerProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    // Verify lock record
    const lockRecordAccount = await lockManagerProgram.account.lockRecord.fetch(lockRecord);
    expect(lockRecordAccount.owner.toString()).to.equal(user.publicKey.toString());
    expect(lockRecordAccount.amount.toNumber()).to.equal(100000000);
    expect(lockRecordAccount.lockPeriod.toNumber()).to.equal(30);
    expect(lockRecordAccount.dailyRelease.toNumber()).to.equal(3333333);

    // Verify token balances
    const userBalance = await getAccount(provider.connection, userXxusdAccount);
    const vaultBalance = await getAccount(provider.connection, lockVault);
    expect(Number(userBalance.amount)).to.equal(900000000); // 900 xxUSD left
    expect(Number(vaultBalance.amount)).to.equal(100000000); // 100 xxUSD locked
  });

  it("Releases daily xxUSD tokens", async () => {
    // Fast forward time by 1 day
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 1),
      "confirmed"
    );

    await lockManagerProgram.methods
      .releaseDailyXxusd()
      .accounts({
        user: user.publicKey,
        userTokenAccount: userXxusdAccount,
        xxusdMint: xxusdMint,
        lockVault: lockVault,
        lockManager: lockManager,
        lockRecord: lockRecord,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify updated lock record
    const lockRecordAccount = await lockManagerProgram.account.lockRecord.fetch(lockRecord);
    expect(lockRecordAccount.amount.toNumber()).to.be.below(100000000);

    // Verify token balances
    const userBalance = await getAccount(provider.connection, userXxusdAccount);
    const vaultBalance = await getAccount(provider.connection, lockVault);
    expect(Number(userBalance.amount)).to.be.above(900000000); // User should have received some xxUSD
    expect(Number(vaultBalance.amount)).to.be.below(100000000); // Vault should have less xxUSD
  });

  it("Checks lock status", async () => {
    const lockStatus = await lockManagerProgram.methods
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

  it("Fails to release twice in the same day", async () => {
    try {
      await lockManagerProgram.methods
        .releaseDailyXxusd()
        .accounts({
          user: user.publicKey,
          userTokenAccount: userXxusdAccount,
          xxusdMint: xxusdMint,
          lockVault: lockVault,
          lockManager: lockManager,
          lockRecord: lockRecord,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error) {
      expect(error.message).to.include("Already released today");
    }
  });

  it("Fails to release with invalid owner", async () => {
    const invalidUser = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(invalidUser.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

    const invalidUserXxusdAccount = await getAssociatedTokenAddress(xxusdMint, invalidUser.publicKey);

    try {
      await lockManagerProgram.methods
        .releaseDailyXxusd()
        .accounts({
          user: invalidUser.publicKey,
          userTokenAccount: invalidUserXxusdAccount,
          xxusdMint: xxusdMint,
          lockVault: lockVault,
          lockManager: lockManager,
          lockRecord: lockRecord,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([invalidUser])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error) {
      expect(error.message).to.include("Invalid owner");
    }
  });

  it("Fails to check lock status with invalid owner", async () => {
    const invalidUser = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(invalidUser.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

    try {
      await lockManagerProgram.methods
        .checkLockStatus()
        .accounts({
          user: invalidUser.publicKey,
          lockRecord: lockRecord,
        })
        .view();
      expect.fail("Expected an error to be thrown");
    } catch (error) {
      expect(error.message).to.include("Invalid owner");
    }
  });
});