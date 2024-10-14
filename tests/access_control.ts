import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { AccessControl } from "../target/types/access_control";

describe("AccessControl Tests on Devnet", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.AccessControl as Program<AccessControl>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const user = provider.wallet.publicKey;

  let accessControlPDA: PublicKey;
  let bump: number;

  const MANAGER_ROLE = "MANAGER";

  before(async () => {
    [accessControlPDA, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("access-control"), user.toBuffer()],
      program.programId
    );
    console.log("AccessControl PDA:", accessControlPDA.toBase58());
    console.log("PDA bump:", bump);
  });

  it("Initializes the access control account", async () => {
    try {
      await program.methods.initialize()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();

      const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
      const accessControlAccount = program.coder.accounts.decode("AccessControl", accountInfo!.data);
      expect(accessControlAccount.admin.toString()).to.equal(user.toString());
      expect(accessControlAccount.isPaused).to.be.false;
      expect(accessControlAccount.permissions.length).to.equal(0);
    } catch (error) {
      console.error("Initialization Failed:", error);
      throw error;
    }
  });

  it("Sets permissions as admin", async () => {
    await program.methods.setPermissions(MANAGER_ROLE, true)
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
    const accessControlAccount = program.coder.accounts.decode("AccessControl", accountInfo!.data);
    const managerPermission = accessControlAccount.permissions.find(
      (permission: [string, boolean]) => permission[0] === MANAGER_ROLE
    );
    expect(managerPermission).to.not.be.undefined;
    expect(managerPermission![1]).to.be.true;
  });

  it("Activates emergency stop as admin", async () => {
    await program.methods.emergencyStop()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
    const accessControlAccount = program.coder.accounts.decode("AccessControl", accountInfo!.data);
    expect(accessControlAccount.isPaused).to.be.true;
  });

  it("Resumes after emergency stop as admin", async () => {
    await program.methods.resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
    const accessControlAccount = program.coder.accounts.decode("AccessControl", accountInfo!.data);
    expect(accessControlAccount.isPaused).to.be.false;
  });

  it("Fails when non-admin tries to set permissions", async () => {
    const nonAdminKeypair = Keypair.generate();

    try {
      await program.methods.setPermissions(MANAGER_ROLE, true)
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        })
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("Unauthorized");
    }
  });

  it("Fails when non-admin tries to activate emergency stop", async () => {
    const nonAdminKeypair = Keypair.generate();

    try {
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        })
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("Unauthorized");
    }
  });

  it("Fails to set invalid permissions", async () => {
    try {
      await program.methods.setPermissions("INVALID_ROLE", true)
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("InvalidPermission");
    }
  });

  it("Fails to activate emergency stop when already paused", async () => {
    // First, activate emergency stop
    await program.methods.emergencyStop()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    // Then try to activate it again
    try {
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("AlreadyPaused");
    }

    // Resume for other tests
    await program.methods.resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();
  });

  it("Fails to resume when not paused", async () => {
    try {
      await program.methods.resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("NotPaused");
    }
  });
});
