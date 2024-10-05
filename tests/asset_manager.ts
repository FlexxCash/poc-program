import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AssetManager } from "../target/types/asset_manager";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import BN from "bn.js";
import * as fs from 'fs';

describe("asset_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AssetManager as Program<AssetManager>;
  const connection = provider.connection;

  // 使用指定的錢包
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync('/home/dc/.config/solana/new_id.json', 'utf-8')))
  );
  const user = payer;

  const jupsolMint = new PublicKey("7eS55f4LP5xj4jqRp24uv5aPFak4gzue8jwb5949KDzP");
  const usdcMint = new PublicKey("EneKhgmdLQgfLtqC9aE52B1bMcFtjob6qMkDc5Q3mHx7");

  let userAssetAccount: PublicKey;
  let userXxusdAccount: PublicKey;
  let vaultAssetAccount: PublicKey;
  let xxusdVaultAccount: PublicKey;
  let userDepositPda: PublicKey;
  let programState: PublicKey;
  let oracle: Keypair;

  function uiToNative(amount: number, decimals: number): BN {
    return new BN(Math.floor(amount * Math.pow(10, decimals)));
  }

  before(async () => {
    // Airdrop SOL to payer if needed
    const balance = await connection.getBalance(payer.publicKey);
    if (balance < 1 * anchor.web3.LAMPORTS_PER_SOL) {
      const airdropSignature = await connection.requestAirdrop(payer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(airdropSignature);
    }

    // Create user asset account (jupSOL)
    const userAssetAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      jupsolMint,
      user.publicKey
    );
    userAssetAccount = userAssetAccountInfo.address;

    // Create user USDC account
    const userXxusdAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      usdcMint,
      user.publicKey
    );
    userXxusdAccount = userXxusdAccountInfo.address;

    // Create Vault asset account
    const vaultAssetAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      jupsolMint,
      program.programId,
      true
    );
    vaultAssetAccount = vaultAssetAccountInfo.address;

    // Create USDC Vault account
    const xxusdVaultAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      usdcMint,
      program.programId,
      true
    );
    xxusdVaultAccount = xxusdVaultAccountInfo.address;

    // Initialize Program State PDA
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );
    programState = statePda;

    // Create mock Oracle
    oracle = Keypair.generate();

    // Initialize Program State
    await program.methods
      .initialize(jupsolMint)
      .accounts({
        state: programState,
        authority: payer.publicKey,
      })
      .signers([payer])
      .rpc();
  });

  it("Deposits asset successfully", async () => {
    const depositAmount = uiToNative(0.1, 9); // 0.1 jupSOL
    const [userDepositPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_deposit"), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .depositAsset(depositAmount)
      .accounts({
        user: user.publicKey,
        userAssetAccount: userAssetAccount,
        assetMint: jupsolMint,
        vaultAssetAccount: vaultAssetAccount,
        state: programState,
        oracle: oracle.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([payer])
      .rpc();

    // Verify deposit
    const userDepositAccount = await program.account.userDeposit.fetch(
      userDepositPda
    );
    expect(userDepositAccount.amount.toNumber()).to.be.above(0);

    const vaultBalance = await connection.getTokenAccountBalance(vaultAssetAccount);
    expect(vaultBalance.value.uiAmount).to.equal(0.1);
  });

  it("Mints and distributes xxUSD successfully", async () => {
    const assetValue = new BN(1000000); // 1,000,000
    const productPrice = new BN(500000); // 500,000
    const [userDepositPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_deposit"), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .mintAndDistributeXxusd(assetValue, productPrice)
      .accounts({
        user: user.publicKey,
        xxusdMint: usdcMint,
        xxusdVault: xxusdVaultAccount,
        userXxusdAccount: userXxusdAccount,
        userDeposit: userDepositPda,
        state: programState,
      } as any)
      .signers([payer])
      .rpc();

    // Verify minting and distribution
    const userXxusdBalance = await connection.getTokenAccountBalance(userXxusdAccount);
    expect(userXxusdBalance.value.uiAmount).to.equal(0.5);

    const vaultXxusdBalance = await connection.getTokenAccountBalance(xxusdVaultAccount);
    expect(vaultXxusdBalance.value.uiAmount).to.equal(0.5);

    const userDepositAccount = await program.account.userDeposit.fetch(userDepositPda);
    expect(userDepositAccount.xxusdAmount.toNumber()).to.equal(500000);
  });

  it("Updates APY successfully", async () => {
    const newApy = new BN(800); // 8%

    await program.methods
      .updateApy(newApy)
      .accounts({
        state: programState,
        authority: payer.publicKey,
      })
      .signers([payer])
      .rpc();

    const updatedState = await program.account.programState.fetch(programState);
    expect(updatedState.currentApy.toNumber()).to.equal(800);
  });

  it("Sets product price successfully", async () => {
    const newPrice = new BN(2000); // New price: 2,000

    await program.methods
      .setProductPrice(newPrice)
      .accounts({
        state: programState,
        authority: payer.publicKey,
      })
      .signers([payer])
      .rpc();

    const updatedState = await program.account.programState.fetch(programState);
    expect(updatedState.productPrice.toNumber()).to.equal(2000);
  });
});