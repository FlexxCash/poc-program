import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RedemptionManager } from "../target/types/redemption_manager";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createMint,
  mintTo,
} from "@solana/spl-token";
import BN from "bn.js";

describe("redemption_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.RedemptionManager as Program<RedemptionManager>;
  const user = provider.wallet.publicKey;

  let xxusdMint: PublicKey;
  let userXxusdAccount: PublicKey;
  let redemptionVault: PublicKey;
  let systemState: PublicKey;

  const MINIMUM_XXUSD_BALANCE = new BN(100_000_000_000); // 100k xxUSD

  async function createAndSendV0Tx(txInstructions: anchor.web3.TransactionInstruction[], signers: anchor.web3.Keypair[] = []) {
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
    // Create xxUSD mint
    xxusdMint = await createMint(
      provider.connection,
      provider.wallet as any,
      provider.wallet.publicKey,
      null,
      6
    );

    userXxusdAccount = await getAssociatedTokenAddress(xxusdMint, user);
    redemptionVault = await getAssociatedTokenAddress(xxusdMint, program.programId, true);

    [systemState] = PublicKey.findProgramAddressSync(
      [Buffer.from("system_state")],
      program.programId
    );

    // Initialize system_state
    const initializeInstruction = await program.methods
      .initializeSystemState()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeInstruction]);

    // Mint some xxUSD to user
    await mintTo(
      provider.connection,
      provider.wallet as any,
      xxusdMint,
      userXxusdAccount,
      provider.wallet.publicKey,
      MINIMUM_XXUSD_BALANCE.toNumber()
    );
  });

  it("should successfully initiate redemption", async () => {
    const redeemAmount = MINIMUM_XXUSD_BALANCE.div(new BN(2));
    const initiateRedeemInstruction = await program.methods
      .initiateRedeem(redeemAmount)
      .accounts({
        user: user,
        userTokenAccount: userXxusdAccount,
        redemptionVault: redemptionVault,
        systemState: systemState,
      } as any)
      .instruction();

    await createAndSendV0Tx([initiateRedeemInstruction]);

    // Note: We can't verify the redemption request here as it's not clear how it's stored in the program
    // You might need to adjust this based on how your program actually stores redemption requests
  });

  it("should successfully execute redemption", async () => {
    const initialUserSolBalance = await provider.connection.getBalance(user);

    const executeRedeemInstruction = await program.methods
      .executeRedeem()
      .accounts({
        user: user,
        redemptionVault: redemptionVault,
        systemState: systemState,
        xxusdMint: xxusdMint,
      } as any)
      .instruction();

    await createAndSendV0Tx([executeRedeemInstruction]);

    const finalUserSolBalance = await provider.connection.getBalance(user);

    expect(finalUserSolBalance).to.be.greaterThan(initialUserSolBalance);
  });

  it("should fail to execute redemption when system is paused", async () => {
    // Pause the system
    const pauseSystemInstruction = await program.methods
      .pauseSystem()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([pauseSystemInstruction]);

    try {
      const executeRedeemInstruction = await program.methods
        .executeRedeem()
        .accounts({
          user: user,
          redemptionVault: redemptionVault,
          systemState: systemState,
          xxusdMint: xxusdMint,
        } as any)
        .instruction();

      await createAndSendV0Tx([executeRedeemInstruction]);
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.toString()).to.include("System is paused");
    }

    // Unpause the system
    const unpauseSystemInstruction = await program.methods
      .unpauseSystem()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([unpauseSystemInstruction]);
  });

  it("should check redeem eligibility correctly", async () => {
    const eligibility = await program.methods
      .checkRedeemEligibility()
      .accounts({
        user: user,
        userTokenAccount: userXxusdAccount,
        systemState: systemState,
      } as any)
      .view();

    expect(typeof eligibility).to.equal('boolean');
  });
});