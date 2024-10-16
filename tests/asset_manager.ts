import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AssetManager } from "../target/types/asset_manager";
import { PriceOracle } from "../target/types/price_oracle";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

describe("asset_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AssetManager as Program<AssetManager>;
  const priceOracleProgram = anchor.workspace.PriceOracle as Program<PriceOracle>;
  const connection = provider.connection;

  const user = provider.wallet.publicKey;

  const jupsolMint = new PublicKey("7eS55f4LP5xj4jqRp24uv5aPFak4gzue8jwb5949KDzP");
  const usdcMint = new PublicKey("EneKhgmdLQgfLtqC9aE52B1bMcFtjob6qMkDc5Q3mHx7");

  let userAssetAccount: PublicKey;
  let userXxusdAccount: PublicKey;
  let vaultAssetAccount: PublicKey;
  let xxusdVaultAccount: PublicKey;
  let userDepositPda: PublicKey;
  let programState: PublicKey;
  let oracleAccount: Keypair;

  const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  const mockInterestAssetFeed = new PublicKey("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1");

  function uiToNative(amount: number, decimals: number): BN {
    return new BN(Math.floor(amount * Math.pow(10, decimals)));
  }

  async function createAndSendV0Tx(
    txInstructions: anchor.web3.TransactionInstruction[],
    signers: anchor.web3.Keypair[] = []
  ) {
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

  before(async () => {
    // Create user asset account (jupSOL)
    const userAssetAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      provider.wallet as any,
      jupsolMint,
      user
    );
    userAssetAccount = userAssetAccountInfo.address;

    // Create user USDC account
    const userXxusdAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      provider.wallet as any,
      usdcMint,
      user
    );
    userXxusdAccount = userXxusdAccountInfo.address;

    // Derive PDA for Vault asset account
    const [vaultAssetPDA, vaultAssetBump] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), jupsolMint.toBuffer()],
      program.programId
    );
    vaultAssetAccount = vaultAssetPDA;

    // Create Vault asset account as PDA
    const createVaultAccountIx = SystemProgram.createAccountWithSeed({
      fromPubkey: user,
      newAccountPubkey: vaultAssetAccount,
      basePubkey: user,
      seed: "vault",
      space: 165, // TokenAccount size (8 + 32 + 32 + 64 + 0)
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      programId: TOKEN_PROGRAM_ID,
    });

    const initializeVaultAccountIx = createInitializeAccountInstruction(
      vaultAssetAccount,
      jupsolMint,
      program.programId,
    );

    await createAndSendV0Tx([createVaultAccountIx, initializeVaultAccountIx]);

    // Derive PDA for xxusdVaultAccount
    const [xxusdVaultPDA, xxusdVaultBump] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), usdcMint.toBuffer()],
      program.programId
    );
    xxusdVaultAccount = xxusdVaultPDA;

    // Create USDC Vault account as PDA
    const createXxusdVaultAccountIx = SystemProgram.createAccountWithSeed({
      fromPubkey: user,
      newAccountPubkey: xxusdVaultAccount,
      basePubkey: user,
      seed: "vault",
      space: 165, // TokenAccount size (8 + 32 + 32 + 64 + 0)
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      programId: TOKEN_PROGRAM_ID,
    });

    const initializeXxusdVaultAccountIx = createInitializeAccountInstruction(
      xxusdVaultAccount,
      usdcMint,
      program.programId,
    );

    await createAndSendV0Tx([createXxusdVaultAccountIx, initializeXxusdVaultAccountIx]);

    // Initialize Program State PDA
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );
    programState = statePda;

    // Initialize PriceOracle
    oracleAccount = Keypair.generate();
    const initializeOracleInstruction = await priceOracleProgram.methods
      .initialize()
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        authority: provider.wallet.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeOracleInstruction], [oracleAccount]);

    // Initialize Program State
    const initializeInstruction = await program.methods
      .initialize(jupsolMint)
      .accounts({
        state: programState,
        authority: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeInstruction]);
  });

  it("Deposits asset successfully", async () => {
    const depositAmount = uiToNative(0.1, 9); // 0.1 jupSOL

    // Derive PDA for userDeposit
    const [userDepositPdaDerived, userDepositBump] = await PublicKey.findProgramAddress(
      [Buffer.from("user_deposit"), user.toBuffer()],
      program.programId
    );
    userDepositPda = userDepositPdaDerived;

    // Get price from PriceOracle
    const getPriceInstruction = await priceOracleProgram.methods
      .getPrice("InterestAsset")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
      } as any)
      .instruction();

    const depositInstruction = await program.methods
      .depositAsset(depositAmount)
      .accounts({
        user: user,
        userAssetAccount: userAssetAccount,
        assetMint: jupsolMint,
        vaultAssetAccount: vaultAssetAccount,
        userDeposit: userDepositPda,
        state: programState,
        oracle: oracleAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([getPriceInstruction, depositInstruction]);

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
    const [userDepositPdaDerived] = await PublicKey.findProgramAddressSync(
      [Buffer.from("user_deposit"), user.toBuffer()],
      program.programId
    );
    userDepositPda = userDepositPdaDerived;

    const mintAndDistributeInstruction = await program.methods
      .mintAndDistributeXxusd(assetValue, productPrice)
      .accounts({
        user: user,
        xxusdMint: usdcMint,
        xxusdVault: xxusdVaultAccount,
        userXxusdAccount: userXxusdAccount,
        userDeposit: userDepositPda,
        state: programState,
      } as any)
      .instruction();

    await createAndSendV0Tx([mintAndDistributeInstruction]);

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

    const updateApyInstruction = await program.methods
      .updateApy(newApy)
      .accounts({
        state: programState,
        authority: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([updateApyInstruction]);

    const updatedState = await program.account.programState.fetch(programState);
    expect(updatedState.currentApy.toNumber()).to.equal(800);
  });

  it("Sets product price successfully", async () => {
    const newPrice = new BN(2000); // New price: 2,000

    const setProductPriceInstruction = await program.methods
      .setProductPrice(newPrice)
      .accounts({
        state: programState,
        authority: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([setProductPriceInstruction]);

    const updatedState = await program.account.programState.fetch(programState);
    expect(updatedState.productPrice.toNumber()).to.equal(2000);
  });
});
