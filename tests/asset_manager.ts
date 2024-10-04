import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AssetManager } from "../target/types/asset_manager";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createTransferInstruction,
} from "@solana/spl-token";
import { expect } from "chai";

describe("asset_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AssetManager as Program<AssetManager>;

  let assetMint: anchor.web3.PublicKey;
  let userAssetAccount: anchor.web3.PublicKey;
  let vaultAssetAccount: anchor.web3.PublicKey;
  let userDepositPda: anchor.web3.PublicKey;
  let programState: anchor.web3.PublicKey;
  let oracle: anchor.web3.Keypair;

  const user = anchor.web3.Keypair.generate();

  async function transferTokens(
    amountUi: number,
    mint: anchor.web3.PublicKey,
    decimals: number,
    from: anchor.web3.Keypair,
    to: anchor.web3.PublicKey
  ): Promise<string> {
    const sender = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      from,
      mint,
      from.publicKey
    );
    const receiver = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      from,
      mint,
      to
    );
    const transferTokensIx = createTransferInstruction(
      sender.address,
      receiver.address,
      from.publicKey,
      uiToNative(amountUi, decimals)
    );
    const transaction = new anchor.web3.Transaction().add(transferTokensIx);
    return await anchor.web3.sendAndConfirmTransaction(provider.connection, transaction, [from]);
  }

  function uiToNative(amount: number, decimals: number): number {
    return Math.floor(amount * Math.pow(10, decimals));
  }

  before(async () => {
    try {
      console.log("Starting test setup...");

      // Airdrop SOL to user
      const airdropSignature = await provider.connection.requestAirdrop(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(airdropSignature);
      console.log("Airdrop completed");

      // Create asset mint (jupSOL)
      assetMint = await createMint(
        provider.connection,
        user,
        user.publicKey,
        null,
        9
      );
      console.log("Asset mint created:", assetMint.toBase58());

      // Create user asset account
      const userAssetAccountInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        assetMint,
        user.publicKey
      );
      userAssetAccount = userAssetAccountInfo.address;
      console.log("User asset account created:", userAssetAccount.toBase58());

      // Mint some assets to user
      await mintTo(
        provider.connection,
        user,
        assetMint,
        userAssetAccount,
        user,
        1000000000 // 1 jupSOL
      );
      console.log("Assets minted to user");

      // Create vault asset account
      const [vaultPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), assetMint.toBuffer()],
        program.programId
      );
      const vaultAssetAccountInfo = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        assetMint,
        vaultPda,
        true
      );
      vaultAssetAccount = vaultAssetAccountInfo.address;
      console.log("Vault asset account created:", vaultAssetAccount.toBase58());

      // Create user deposit account
      const [userDepositAddress] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user_deposit"), user.publicKey.toBuffer()],
        program.programId
      );
      userDepositPda = userDepositAddress;
      console.log("User deposit PDA created:", userDepositPda.toBase58());

      // Create program state account
      const [statePda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
      );
      programState = statePda;
      console.log("Program state PDA created:", programState.toBase58());

      // Create mock oracle
      oracle = anchor.web3.Keypair.generate();
      console.log("Mock oracle created:", oracle.publicKey.toBase58());

      // Initialize program state
      await program.methods
        .initialize(assetMint)
        .accounts({
          state: programState,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("Program state initialized");

      console.log("Test setup completed successfully");
    } catch (error) {
      console.error("Error during test setup:", error);
      throw error;
    }
  });

  it("Deposits asset successfully", async () => {
    const depositAmount = new anchor.BN(100000000); // 0.1 jupSOL

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
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify deposit
      const userDepositAccount = await program.account.userDeposit.fetch(userDepositPda);
      expect(userDepositAccount.amount.toNumber()).to.be.above(0);

      const vaultBalance = await provider.connection.getTokenAccountBalance(vaultAssetAccount);
      expect(vaultBalance.value.uiAmount).to.equal(0.1);

      console.log("Deposit test passed successfully");
    } catch (error) {
      console.error("Error during deposit test:", error);
      throw error;
    }
  });

  it("Fails to deposit when system is paused", async () => {
    try {
      // Pause the system
      await program.methods
        .pauseSystem()
        .accounts({
          state: programState,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      console.log("System paused");

      const depositAmount = new anchor.BN(100000000); // 0.1 jupSOL

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
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.message).to.include("System is paused");
      console.log("Paused system test passed successfully");
    }

    // Unpause the system for further tests
    await program.methods
      .unpauseSystem()
      .accounts({
        state: programState,
        authority: provider.wallet.publicKey,
      })
      .rpc();
    console.log("System unpaused");
  });

  it("Fails to deposit with invalid amount", async () => {
    const depositAmount = new anchor.BN(0);

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
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      expect.fail("Expected transaction to fail");
    } catch (error) {
      expect(error.message).to.include("Invalid amount");
      console.log("Invalid amount test passed successfully");
    }
  });

  // Add more test cases as needed
});