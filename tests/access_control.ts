import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AccessControl } from "../target/types/access_control";
import { expect } from "chai";

describe("access_control", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AccessControl as Program<AccessControl>;

  let accessControlAccount: anchor.web3.Keypair;
  let adminKeypair: anchor.web3.Keypair;

  before(async () => {
    accessControlAccount = anchor.web3.Keypair.generate();
    adminKeypair = anchor.web3.Keypair.generate();

    // Airdrop some SOL to the admin account for transaction fees
    const signature = await provider.connection.requestAirdrop(
      adminKeypair.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);
  });

  it("Initializes the access control account", async () => {
    await program.methods
      .initialize()
      .accounts({
        accessControl: accessControlAccount.publicKey,
        admin: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([accessControlAccount, adminKeypair])
      .rpc();

    const account = await program.account.accessControl.fetch(
      accessControlAccount.publicKey
    );
    expect(account.admin.toString()).to.equal(adminKeypair.publicKey.toString());
    expect(account.isPaused).to.be.false;
    expect(account.permissions).to.be.empty;
  });

  it("Sets permissions", async () => {
    const role = "MANAGER";
    await program.methods
      .setPermissions(role, true)
      .accounts({
        accessControl: accessControlAccount.publicKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    const account = await program.account.accessControl.fetch(
      accessControlAccount.publicKey
    );
    const permission = account.permissions.find(([r, _]) => r === role);
    expect(permission).to.not.be.undefined;
    expect(permission![1]).to.be.true;
  });

  it("Activates emergency stop", async () => {
    await program.methods
      .emergencyStop(true)
      .accounts({
        accessControl: accessControlAccount.publicKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    const account = await program.account.accessControl.fetch(
      accessControlAccount.publicKey
    );
    expect(account.isPaused).to.be.true;
  });

  it("Deactivates emergency stop", async () => {
    await program.methods
      .emergencyStop(false)
      .accounts({
        accessControl: accessControlAccount.publicKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    const account = await program.account.accessControl.fetch(
      accessControlAccount.publicKey
    );
    expect(account.isPaused).to.be.false;
  });

  it("Fails when non-admin tries to set permissions", async () => {
    const nonAdminKeypair = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .setPermissions("MANAGER", true)
        .accounts({
          accessControl: accessControlAccount.publicKey,
          admin: nonAdminKeypair.publicKey,
        })
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.error.errorMessage).to.include("Unauthorized");
    }
  });

  it("Fails when non-admin tries to activate emergency stop", async () => {
    const nonAdminKeypair = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .emergencyStop(true)
        .accounts({
          accessControl: accessControlAccount.publicKey,
          admin: nonAdminKeypair.publicKey,
        })
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.error.errorMessage).to.include("Unauthorized");
    }
  });
});