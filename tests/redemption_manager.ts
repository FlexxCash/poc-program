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
  const user = Keypair.generate();

  let xxusdMint: PublicKey;
  let userXxusdAccount: PublicKey;
  let redemptionVault: PublicKey;
  let systemState: PublicKey;

  const MINIMUM_XXUSD_BALANCE = new BN(100_000_000_000); // 100k xxUSD

  before(async () => {
    // Create xxUSD mint
    xxusdMint = await createMint(
      provider.connection,
      user,
      provider.wallet.publicKey,
      null,
      6
    );

    userXxusdAccount = await getAssociatedTokenAddress(xxusdMint, user.publicKey);
    redemptionVault = await getAssociatedTokenAddress(xxusdMint, program.programId, true);

    [systemState] = PublicKey.findProgramAddressSync(
      [Buffer.from("system_state")],
      program.programId
    );

    // Initialize system_state
    await program.methods
      .initializeSystemState()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // Mint some xxUSD to user
    await mintTo(
      provider.connection,
      user,
      xxusdMint,
      userXxusdAccount,
      provider.wallet.publicKey,
      MINIMUM_XXUSD_BALANCE.toNumber()
    );
  });

  it("should successfully initiate redemption", async () => {
    const redeemAmount = MINIMUM_XXUSD_BALANCE.div(new BN(2));
    await program.methods
      .initiateRedeem(redeemAmount)
      .accounts({
        user: user.publicKey,
        userTokenAccount: userXxusdAccount,
        redemptionVault: redemptionVault,
        systemState: systemState,
      })
      .signers([user])
      .rpc();

    // Note: We can't verify the redemption request here as it's not clear how it's stored in the program
    // You might need to adjust this based on how your program actually stores redemption requests
  });

  it("should successfully execute redemption", async () => {
    const initialUserSolBalance = await provider.connection.getBalance(user.publicKey);

    await program.methods
      .executeRedeem()
      .accounts({
        user: user.publicKey,
        redemptionVault: redemptionVault,
        systemState: systemState,
        xxusdMint: xxusdMint,
      })
      .signers([user])
      .rpc();

    const finalUserSolBalance = await provider.connection.getBalance(user.publicKey);

    expect(finalUserSolBalance).to.be.greaterThan(initialUserSolBalance);
  });

  it("should fail to execute redemption when system is paused", async () => {
    // Pause the system
    await program.methods
      .pauseSystem()
      .accounts({
        systemState: systemState,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    try {
      await program.methods
        .executeRedeem()
        .accounts({
          user: user.publicKey,
          redemptionVault: redemptionVault,
          systemState: systemState,
          xxusdMint: xxusdMint,
        })
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
        systemState: systemState,
        authority: provider.wallet.publicKey,
      })
      .rpc();
  });

  it("should check redeem eligibility correctly", async () => {
    const eligibility = await program.methods
      .checkRedeemEligibility()
      .accounts({
        user: user.publicKey,
        userTokenAccount: userXxusdAccount,
        systemState: systemState,
      })
      .view();

    expect(typeof eligibility).to.equal('boolean');
  });
});