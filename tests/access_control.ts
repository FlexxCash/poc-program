import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { AccessControl } from "../target/types/access_control";

interface AccessControlAccount {
  admin: PublicKey;
  isPaused: boolean;
  permissions: { [key: string]: boolean };
}

describe("AccessControl Tests on Devnet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AccessControl as Program<AccessControl>;
  const user = provider.wallet.publicKey;

  const [accessControlPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("access-control"), user.toBuffer()],
    program.programId
  );

  const MANAGER_ROLE = "MANAGER";

  async function getAccessControlAccount(): Promise<AccessControlAccount | null> {
    try {
      const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
      if (accountInfo === null) {
        return null;
      }
      return program.coder.accounts.decode("AccessControl", accountInfo.data) as AccessControlAccount;
    } catch (error) {
      console.error("Failed to fetch account:", error);
      return null;
    }
  }

  async function createAndSendV0Tx(txInstructions: anchor.web3.TransactionInstruction[], signers: Keypair[] = []) {
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
    try {
      const initializeInstruction = await program.methods
        .initialize()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        } as any)
        .instruction();

      await createAndSendV0Tx([initializeInstruction]);
      console.log("Access Control account initialized successfully");
    } catch (error: unknown) {
      console.error("Initialization Failed:", error);
      throw error;
    }
  });

  it("Initializes the access control account", async () => {
    const accountData = await getAccessControlAccount();
    expect(accountData).to.not.be.null;
    expect(accountData!.admin.toString()).to.equal(user.toString());
    expect(accountData!.isPaused).to.be.false;
    expect(Object.keys(accountData!.permissions)).to.have.lengthOf(0);
  });

  it("Sets permissions as admin", async () => {
    const setPermissionsInstruction = await program.methods
      .setPermissions(MANAGER_ROLE, true)
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([setPermissionsInstruction]);

    const accountData = await getAccessControlAccount();
    expect(accountData).to.not.be.null;
    expect(accountData!.permissions[MANAGER_ROLE]).to.be.true;
  });

  it("Activates emergency stop as admin", async () => {
    const emergencyStopInstruction = await program.methods
      .emergencyStop()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([emergencyStopInstruction]);

    const accountData = await getAccessControlAccount();
    expect(accountData).to.not.be.null;
    expect(accountData!.isPaused).to.be.true;
  });

  it("Resumes after emergency stop as admin", async () => {
    const resumeInstruction = await program.methods
      .resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([resumeInstruction]);

    const accountData = await getAccessControlAccount();
    expect(accountData).to.not.be.null;
    expect(accountData!.isPaused).to.be.false;
  });

  it("Fails when non-admin tries to set permissions", async () => {
    const nonAdminKeypair = Keypair.generate();

    try {
      const setPermissionsInstruction = await program.methods
        .setPermissions(MANAGER_ROLE, true)
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        } as any)
        .instruction();

      await createAndSendV0Tx([setPermissionsInstruction], [nonAdminKeypair]);
      expect.fail("Transaction should have failed");
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).to.include("Unauthorized");
      }
    }
  });

  it("Fails when non-admin tries to activate emergency stop", async () => {
    const nonAdminKeypair = Keypair.generate();

    try {
      const emergencyStopInstruction = await program.methods
        .emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        } as any)
        .instruction();

      await createAndSendV0Tx([emergencyStopInstruction], [nonAdminKeypair]);
      expect.fail("Transaction should have failed");
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).to.include("Unauthorized");
      }
    }
  });

  it("Fails to set invalid permissions", async () => {
    try {
      const setPermissionsInstruction = await program.methods
        .setPermissions("INVALID_ROLE", true)
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        } as any)
        .instruction();

      await createAndSendV0Tx([setPermissionsInstruction]);
      expect.fail("Transaction should have failed");
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).to.include("InvalidPermission");
      }
    }
  });

  it("Fails to activate emergency stop when already paused", async () => {
    // First, activate emergency stop
    const emergencyStopInstruction = await program.methods
      .emergencyStop()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([emergencyStopInstruction]);

    // Then try to activate it again
    try {
      await createAndSendV0Tx([emergencyStopInstruction]);
      expect.fail("Transaction should have failed");
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).to.include("AlreadyPaused");
      }
    }

    // Resume for other tests
    const resumeInstruction = await program.methods
      .resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      } as any)
      .instruction();

    await createAndSendV0Tx([resumeInstruction]);
  });

  it("Fails to resume when not paused", async () => {
    try {
      const resumeInstruction = await program.methods
        .resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        } as any)
        .instruction();

      await createAndSendV0Tx([resumeInstruction]);
      expect.fail("Transaction should have failed");
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).to.include("NotPaused");
      }
    }
  });
});