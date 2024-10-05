import { startAnchor } from "solana-bankrun";
import { Program, Provider, Wallet } from "@coral-xyz/anchor";
import { AssetManager } from "../target/types/asset_manager";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import BN from "bn.js";

describe("asset_manager", () => {
  let provider: Provider;
  let program: Program<AssetManager>;
  let context: any;
  let client: any;
  let payer: Keypair;
  let assetMint: PublicKey;
  let xxusdMint: PublicKey;
  let userAssetAccount: PublicKey;
  let userXxusdAccount: PublicKey;
  let vaultAssetAccount: PublicKey;
  let xxusdVaultAccount: PublicKey;
  let userDepositPda: PublicKey;
  let programState: PublicKey;
  let oracle: Keypair;
  let mintAuthority: PublicKey;
  let vaultAuthority: PublicKey;

  const user = Keypair.generate();

  async function createAndProcessTransaction(
    client: Connection,
    payer: Keypair,
    instruction: TransactionInstruction,
    additionalSigners: Keypair[] = []
  ): Promise<any> {
    const tx = new Transaction();
    const { blockhash } = await client.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.add(instruction);
    tx.sign(payer, ...additionalSigners);
    return await client.sendTransaction(tx, additionalSigners, { skipPreflight: true });
  }

  function uiToNative(amount: number, decimals: number): BN {
    return new BN(Math.floor(amount * Math.pow(10, decimals)));
  }

  async function setupATA(
    context: any,
    usdcMint: PublicKey,
    owner: PublicKey,
    amount: number
  ): Promise<PublicKey> {
    const ata = await getOrCreateAssociatedTokenAccount(
      context.banksClient.connection,
      payer,
      usdcMint,
      owner
    );
    // Assume the account balance is set via mintTo or other means
    return ata.address;
  }

  before(async () => {
    context = await startAnchor("/home/dc/flexxcash_xxUSD", [], []);
    client = context.banksClient.connection;
    payer = context.payer;
    provider = new Provider(client, new Wallet(payer), {});
    program = new Program<AssetManager>(
      require("../target/idl/asset_manager.json"),
      context.programId,
      provider
    );

    // Airdrop SOL to payer
    const airdropSignature = await createAndProcessTransaction(
      client,
      payer,
      SystemProgram.requestAirdrop({
        to: payer.publicKey,
        lamports: 10 * 1e9, // 10 SOL
      })
    );
    await client.confirmTransaction(airdropSignature, "confirmed");

    // Create Asset Mint (jupSOL)
    assetMint = await createMint(
      client,
      payer,
      payer.publicKey,
      null,
      9
    );

    // Create xxUSD Mint
    xxusdMint = await createMint(
      client,
      payer,
      payer.publicKey,
      null,
      6
    );

    // Create user asset account
    const userAssetAccountInfo = await getOrCreateAssociatedTokenAccount(
      client,
      payer,
      assetMint,
      user.publicKey
    );
    userAssetAccount = userAssetAccountInfo.address;

    // Create user xxUSD account
    const userXxusdAccountInfo = await getOrCreateAssociatedTokenAccount(
      client,
      payer,
      xxusdMint,
      user.publicKey
    );
    userXxusdAccount = userXxusdAccountInfo.address;

    // Create Vault asset account
    const vaultAssetAccountInfo = await getOrCreateAssociatedTokenAccount(
      client,
      payer,
      assetMint,
      program.programId
    );
    vaultAssetAccount = vaultAssetAccountInfo.address;

    // Create xxUSD Vault account
    const xxusdVaultAccountInfo = await getOrCreateAssociatedTokenAccount(
      client,
      payer,
      xxusdMint,
      program.programId
    );
    xxusdVaultAccount = xxusdVaultAccountInfo.address;

    // Mint assets to user
    await mintTo(
      client,
      payer,
      assetMint,
      userAssetAccount,
      payer,
      1000000000 // 1 jupSOL
    );

    // Initialize Program State PDA
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );
    programState = statePda;

    // Create mock Oracle
    oracle = Keypair.generate();

    // Create Mint and Vault Authority PDA
    const [mintAuthPda] = PublicKey.findProgramAddressSync(
      [programState.toBuffer()],
      program.programId
    );
    mintAuthority = mintAuthPda;
    vaultAuthority = mintAuthPda;

    // Initialize Program State
    await program.methods
      .initialize(assetMint)
      .accounts({
        state: programState,
        authority: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("Deposits asset successfully", async () => {
    const depositAmount = uiToNative(0.1, 9); // 0.1 jupSOL

    await program.methods
      .depositAsset(depositAmount)
      .accounts({
        user: user.publicKey,
        userAssetAccount: userAssetAccount,
        assetMint: assetMint,
        vaultAssetAccount: vaultAssetAccount,
        userDeposit: userDepositPda,
        state: programState,
        oracle: oracle.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Verify deposit
    const userDepositAccount = await program.account.userDeposit.fetch(
      userDepositPda
    );
    expect(userDepositAccount.amount.toNumber()).to.be.above(0);

    const vaultBalance = await getOrCreateAssociatedTokenAccount(
      client,
      payer,
      assetMint,
      program.programId
    ).then(acc => acc.amount.toNumber() / Math.pow(10, 9));
    expect(vaultBalance).to.equal(0.1);
  });

  it("Mints and distributes xxUSD successfully", async () => {
    const assetValue = new BN(1000000); // 1,000,000
    const productPrice = new BN(500000); // 500,000

    await program.methods
      .mintAndDistributeXxusd(assetValue, productPrice)
      .accounts({
        user: user.publicKey,
        xxusdMint: xxusdMint,
        xxusdVault: xxusdVaultAccount,
        userXxusdAccount: userXxusdAccount,
        mintAuthority: mintAuthority,
        vaultAuthority: vaultAuthority,
        userDeposit: userDepositPda,
        state: programState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Verify minting and distribution
    const userXxusdBalance = await getOrCreateAssociatedTokenAccount(
      client,
      payer,
      xxusdMint,
      userXxusdAccount
    ).then(acc => acc.amount.toNumber() / Math.pow(10, 6));
    expect(userXxusdBalance).to.equal(0.5);

    const vaultXxusdBalance = await getOrCreateAssociatedTokenAccount(
      client,
      payer,
      xxusdMint,
      program.programId
    ).then(acc => acc.amount.toNumber() / Math.pow(10, 6));
    expect(vaultXxusdBalance).to.equal(0.5);

    const userDepositAccount = await program.account.userDeposit.fetch(userDepositPda);
    expect(userDepositAccount.xxusdAmount.toNumber()).to.equal(500000);
  });

  it("Fails to mint xxUSD when exceeding minting limit", async () => {
    const assetValue = new BN(1000000000); // 1,000,000,000
    const productPrice = new BN(500000000); // 500,000,000

    try {
      await program.methods
        .mintAndDistributeXxusd(assetValue, productPrice)
        .accounts({
          user: user.publicKey,
          xxusdMint: xxusdMint,
          xxusdVault: xxusdVaultAccount,
          userXxusdAccount: userXxusdAccount,
          mintAuthority: mintAuthority,
          vaultAuthority: vaultAuthority,
          userDeposit: userDepositPda,
          state: programState,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      expect(error.message).to.include("Minting limit exceeded");
    }
  });

  it("Fails to deposit when system is paused", async () => {
    // Pause the system
    await program.methods
      .pauseSystem()
      .accounts({
        state: programState,
        authority: payer.publicKey,
      })
      .rpc();

    const depositAmount = uiToNative(0.1, 9); // 0.1 jupSOL

    try {
      await program.methods
        .depositAsset(depositAmount)
        .accounts({
          user: user.publicKey,
          userAssetAccount: userAssetAccount,
          assetMint: assetMint,
          vaultAssetAccount: vaultAssetAccount,
          userDeposit: userDepositPda,
          state: programState,
          oracle: oracle.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      expect(error.message).to.include("System is paused");
    }

    // Unpause the system
    await program.methods
      .unpauseSystem()
      .accounts({
        state: programState,
        authority: payer.publicKey,
      })
      .rpc();
  });

  it("Fails to deposit with invalid amount", async () => {
    const depositAmount = new BN(0); // Invalid amount

    try {
      await program.methods
        .depositAsset(depositAmount)
        .accounts({
          user: user.publicKey,
          userAssetAccount: userAssetAccount,
          assetMint: assetMint,
          vaultAssetAccount: vaultAssetAccount,
          userDeposit: userDepositPda,
          state: programState,
          oracle: oracle.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      expect(error.message).to.include("Invalid amount");
    }
  });

  it("Calculates lock period correctly", async () => {
    const productPrice = new BN(1000000); // 1,000,000
    const assetValue = new BN(2000000); // 2,000,000

    const lockPeriod = await program.methods
      .calculateLockPeriod(productPrice, assetValue)
      .accounts({
        state: programState,
      })
      .view();

    expect(lockPeriod.toNumber()).to.be.within(1, 365);
  });

  it("Updates APY successfully", async () => {
    const newApy = new BN(800); // 8%

    await program.methods
      .updateApy(newApy)
      .accounts({
        state: programState,
        authority: payer.publicKey,
      })
      .rpc();

    const updatedState = await program.account.programState.fetch(programState);
    expect(updatedState.currentApy.toNumber()).to.equal(800);
  });

  it("Fails to update APY with unauthorized account", async () => {
    const newApy = new BN(900); // 9%

    try {
      await program.methods
        .updateApy(newApy)
        .accounts({
          state: programState,
          authority: user.publicKey, // Unauthorized user
        })
        .signers([user])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.message).to.include("UnauthorizedAccount");
    }
  });

  it("Sets product price successfully", async () => {
    const newPrice = new BN(2000); // New price: 2,000

    await program.methods
      .setProductPrice(newPrice)
      .accounts({
        state: programState,
        authority: payer.publicKey,
      })
      .rpc();

    const updatedState = await program.account.programState.fetch(programState);
    expect(updatedState.productPrice.toNumber()).to.equal(2000);
  });

  it("Fails to set product price with unauthorized account", async () => {
    const newPrice = new BN(2500); // 2,500

    try {
      await program.methods
        .setProductPrice(newPrice)
        .accounts({
          state: programState,
          authority: user.publicKey, // Unauthorized user
        })
        .signers([user])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.message).to.include("UnauthorizedAccount");
    }
  });

  it("Fails to set invalid product price", async () => {
    const invalidPrice = new BN(5); // Below minimum allowed price

    try {
      await program.methods
        .setProductPrice(invalidPrice)
        .accounts({
          state: programState,
          authority: payer.publicKey,
        })
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.message).to.include("InvalidPrice");
    }
  });
});