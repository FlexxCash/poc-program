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
  // 創建 devnet Anchor 提供者
  const provider = anchor.AnchorProvider.env();

  // 設置 Anchor 使用 devnet 集群
  anchor.setProvider(provider);

  // 獲取程式實例
  const program = anchor.workspace.AccessControl as Program<AccessControl>;

  // 獲取用戶的公鑰
  const user = new PublicKey("EJ5XgoBodvu2Ts6EasT3umoSL1zSWoDTGiQKKg8naWJe");

  // 使用程式 ID 和用戶公鑰生成 PDA（程式派生地址）
  const [accessControlPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("access-control"), user.toBuffer()],
    program.programId
  );

  const ADMIN_ROLE = "ADMIN";
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

  before(async () => {
    // 在所有測試開始前初始化帳戶
    try {
      await program.methods
        .initialize()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();
    } catch (error) {
      console.error("Initializes Failed:", error);
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
    await program.methods
      .setPermissions(MANAGER_ROLE, true)
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    const accountData = await getAccessControlAccount();
    expect(accountData).to.not.be.null;
    expect(accountData!.permissions[MANAGER_ROLE]).to.be.true;
  });

  it("Activates emergency stop as admin", async () => {
    await program.methods
      .emergencyStop()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    const accountData = await getAccessControlAccount();
    expect(accountData).to.not.be.null;
    expect(accountData!.isPaused).to.be.true;
  });

  it("Resumes after emergency stop as admin", async () => {
    await program.methods
      .resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    const accountData = await getAccessControlAccount();
    expect(accountData).to.not.be.null;
    expect(accountData!.isPaused).to.be.false;
  });

  it("Fails when non-admin tries to set permissions", async () => {
    const nonAdminKeypair = Keypair.generate();

    try {
      await program.methods
        .setPermissions(MANAGER_ROLE, true)
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        })
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error) {
      expect(error).to.be.instanceOf(AnchorError);
      const anchorError = error as AnchorError;
      expect(anchorError.error.errorCode.code).to.equal("Unauthorized");
    }
  });

  it("Fails when non-admin tries to activate emergency stop", async () => {
    const nonAdminKeypair = Keypair.generate();

    try {
      await program.methods
        .emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        })
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error) {
      expect(error).to.be.instanceOf(AnchorError);
      const anchorError = error as AnchorError;
      expect(anchorError.error.errorCode.code).to.equal("Unauthorized");
    }
  });

  it("Fails to set invalid permissions", async () => {
    try {
      await program.methods
        .setPermissions("INVALID_ROLE", true)
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error) {
      expect(error).to.be.instanceOf(AnchorError);
      const anchorError = error as AnchorError;
      expect(anchorError.error.errorCode.code).to.equal("InvalidPermission");
    }
  });

  it("Fails to activate emergency stop when already paused", async () => {
    // First, activate emergency stop
    await program.methods
      .emergencyStop()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();

    // Then try to activate it again
    try {
      await program.methods
        .emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error) {
      expect(error).to.be.instanceOf(AnchorError);
      const anchorError = error as AnchorError;
      expect(anchorError.error.errorCode.code).to.equal("AlreadyPaused");
    }

    // Resume for other tests
    await program.methods
      .resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: user,
      })
      .rpc();
  });

  it("Fails to resume when not paused", async () => {
    try {
      await program.methods
        .resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: user,
        })
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error) {
      expect(error).to.be.instanceOf(AnchorError);
      const anchorError = error as AnchorError;
      expect(anchorError.error.errorCode.code).to.equal("NotPaused");
    }
  });
});