import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { AccessControl } from "../target/types/access_control";
import * as fs from "fs";
import * as path from "path";

const loadKeypair = (filePath: string): Keypair => {
  const absolutePath = path.resolve(filePath);
  const secretKeyString = fs.readFileSync(absolutePath, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
};

// 使用環境變數或配置文件來獲取管理員密鑰路徑
const adminKeypairPath = process.env.ADMIN_KEYPAIR_PATH || "/home/dc/.config/solana/new_id.json";
const adminKeypair: Keypair = loadKeypair(adminKeypairPath);
const nonAdminKeypair: Keypair = loadKeypair("/home/dc/.config/solana/nonAdmin.json");

describe("AccessControl Tests on Devnet", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AccessControl as Program<AccessControl>;

  let accessControlPDA: PublicKey;
  let bump: number;

  // 獲取 AccessControl 帳戶資訊
  const getAccessControlAccount = async (pubkey: PublicKey): Promise<any> => {
    try {
      console.log("Fetching AccessControl account...");
      console.log("Program account keys:", Object.keys(program.account));
      if (!(program.account as any).accessControl) {
        throw new Error("AccessControl account is not defined in the program");
      }
      const account = await (program.account as any).accessControl.fetch(pubkey);
      console.log("AccessControl account fetched successfully:", account);
      return account;
    } catch (error) {
      console.error("Error fetching AccessControl account:", error);
      if (error instanceof anchor.AnchorError) {
        console.error("Error code:", error.error.errorCode.code);
        console.error("Error message:", error.error.errorMessage);
      }
      throw error;
    }
  };

  // 初始化 AccessControl 帳戶
  const initializeAccessControl = async () => {
    console.log("Initializing AccessControl account...");
    try {
      const tx = await program.methods.initialize(bump)
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([adminKeypair])
        .rpc();
      console.log("AccessControl account initialized. Transaction signature:", tx);

      await provider.connection.confirmTransaction(tx, "confirmed");

      const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
      if (accountInfo === null) {
        throw new Error("Failed to create AccessControl account");
      }
      console.log("AccessControl account created successfully");
      
      // 新增：獲取並輸出帳戶數據
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      console.log("Initialized AccessControl account data:", accessControlAccount);
    } catch (error) {
      console.error("Error initializing AccessControl account:", error);
      if (error instanceof anchor.AnchorError) {
        console.error("Error code:", error.error.errorCode.code);
        console.error("Error message:", error.error.errorMessage);
      }
      throw error;
    }
  };

  // 確保 AccessControl 帳戶已初始化
  const ensureAccessControlInitialized = async () => {
    const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
    if (accountInfo === null) {
      console.log("AccessControl account not found. Initializing...");
      await initializeAccessControl();
    } else {
      console.log("AccessControl account already exists");
      // 新增：獲取並輸出現有帳戶數據
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      console.log("Existing AccessControl account data:", accessControlAccount);
    }
  };

  // 如果帳戶存在，則關閉它
  const closeAccountIfExists = async (pubkey: PublicKey) => {
    const accountInfo = await provider.connection.getAccountInfo(pubkey);
    if (accountInfo !== null) {
      console.log(`Closing existing account: ${pubkey.toBase58()}`);
      try {
        const tx = await program.methods.closeAccount()
          .accounts({
            accessControl: pubkey,
            admin: adminKeypair.publicKey,
          } as any)
          .signers([adminKeypair])
          .rpc();
        console.log("Account closed successfully. Transaction signature:", tx);
      } catch (error) {
        console.error("Error closing account:", error);
        if (error instanceof anchor.AnchorError) {
          console.error("Error code:", error.error.errorCode.code);
          console.error("Error message:", error.error.errorMessage);
        }
        throw error;
      }
    }
  };

  before(async () => {
    [accessControlPDA, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("access_control"), adminKeypair.publicKey.toBuffer()],
      program.programId
    );
    console.log("Expected AccessControl PDA:", accessControlPDA.toBase58());
    console.log("PDA bump:", bump);
    console.log("Admin:", adminKeypair.publicKey.toBase58());
    console.log("Non-Admin:", nonAdminKeypair.publicKey.toBase58());
    console.log("Program ID:", program.programId.toBase58());

    // 新增：檢查程序 ID 是否正確
    const expectedProgramId = "5G3YjJ8PNAhPeDSZY1kbdPpYG21C8FRMwN1VuSFtR7Qe";
    if (program.programId.toBase58() !== expectedProgramId) {
      throw new Error(`Program ID mismatch. Expected: ${expectedProgramId}, Actual: ${program.programId.toBase58()}`);
    }
    console.log("Program ID verified successfully");

    await closeAccountIfExists(accessControlPDA);
    await ensureAccessControlInitialized();
  });

  it("Verifies the correct PDA is generated", async () => {
    const [expectedPDA, expectedBump] = await PublicKey.findProgramAddress(
      [Buffer.from("access_control"), adminKeypair.publicKey.toBuffer()],
      program.programId
    );
    expect(accessControlPDA.toString()).to.equal(expectedPDA.toString());
    expect(bump).to.equal(expectedBump);
  });

  it("Initializes the access control account", async () => {
    try {
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      console.log("Decoded AccessControl account:", accessControlAccount);
      console.log("Actual AccessControl PDA:", accessControlPDA.toBase58());

      expect(accessControlAccount.admin.toString()).to.equal(adminKeypair.publicKey.toString());
      expect(accessControlAccount.is_paused).to.be.false;
      expect(accessControlAccount.permissions.length).to.equal(0);
    } catch (error) {
      console.error("Initialization error:", error);
      if (error instanceof anchor.AnchorError) {
        console.error("Error code:", error.error.errorCode.code);
        console.error("Error message:", error.error.errorMessage);
        console.error("Error origin:", error.error.origin);
        console.error("Compared values:", error.error.comparedValues);
      }
      throw error;
    }
  });

  it("Fails when non-admin tries to activate emergency stop", async () => {
    try {
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        } as any)
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      console.log("Error message:", error.message);
      console.log("Error logs:", error.logs);
      expect(error.message).to.include("Unauthorized");
    }
  });

  it("Activates emergency stop successfully", async () => {
    try {
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        } as any)
        .signers([adminKeypair])
        .rpc();
      
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      console.log("AccessControl account after emergency stop:", accessControlAccount);
      expect(accessControlAccount.is_paused).to.be.true;
    } catch (error) {
      console.error("Emergency stop error:", error);
      throw error;
    }
  });

  it("Fails to activate emergency stop when already paused", async () => {
    try {
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        } as any)
        .signers([adminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      console.log("Error message:", error.message);
      console.log("Error logs:", error.logs);
      expect(error.message).to.include("System is already paused");
    }
  });

  it("Fails when non-admin tries to resume", async () => {
    try {
      await program.methods.resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: nonAdminKeypair.publicKey,
        } as any)
        .signers([nonAdminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      console.log("Error message:", error.message);
      console.log("Error logs:", error.logs);
      expect(error.message).to.include("Unauthorized");
    }
  });

  it("Resumes successfully", async () => {
    try {
      await program.methods.resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        } as any)
        .signers([adminKeypair])
        .rpc();
      
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      console.log("AccessControl account after resume:", accessControlAccount);
      expect(accessControlAccount.is_paused).to.be.false;
    } catch (error) {
      console.error("Resume error:", error);
      throw error;
    }
  });

  it("Fails to resume when not paused", async () => {
    try {
      await program.methods.resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        } as any)
        .signers([adminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      console.log("Error message:", error.message);
      console.log("Error logs:", error.logs);
      expect(error.message).to.include("System is not paused");
    }
  });

  after(async () => {
    await closeAccountIfExists(accessControlPDA);
  });
});
