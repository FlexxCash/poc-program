import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Signer, Transaction, VersionedTransaction } from "@solana/web3.js";
import { expect } from "chai";
import { AccessControl } from "../target/types/access_control";
import * as fs from "fs";
import * as path from "path";

/**
 * 輔助函數：從指定路徑加載 Keypair
 * @param filePath Keypair JSON 檔案的絕對路徑
 * @returns Keypair
 */
const loadKeypair = (filePath: string): Keypair => {
  const absolutePath = path.resolve(filePath);
  const secretKeyString = fs.readFileSync(absolutePath, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
};

/**
 * 自訂 Wallet 類別，實現 anchor.Wallet 接口
 */
class KeypairWallet implements anchor.Wallet {
  publicKey: PublicKey;
  payer: Keypair;

  constructor(payer: Keypair) {
    this.payer = payer;
    this.publicKey = payer.publicKey;
  }

  /**
   * 簽名一個交易
   * @param tx 要簽名的交易
   * @returns 簽名後的交易
   */
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.sign(this.payer);
      return tx as T;
    } else {
      throw new Error("VersionedTransaction signing not implemented");
    }
  }

  /**
   * 簽名多個交易
   * @param txs 要簽名的交易數組
   * @returns 簽名後的交易數組
   */
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map(tx => this.signTransaction(tx)));
  }
}

// 從指定的路徑加載 admin 和 nonAdmin 的 Keypair
const adminKeypair: Keypair = loadKeypair("/home/dc/.config/solana/new_id.json");
const nonAdminKeypair: Keypair = loadKeypair("/home/dc/.config/solana/nonAdmin.json");

describe("AccessControl Tests on Devnet", () => {
  // 創建一個 Wallet 使用 admin Keypair
  const wallet = new KeypairWallet(adminKeypair);

  // 創建一個連接到 Devnet 的 AnchorProvider
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());

  // 設置全局的 AnchorProvider 為剛剛創建的 provider
  anchor.setProvider(provider);

  const program = anchor.workspace.AccessControl as Program<AccessControl>;

  let accessControlPDA: PublicKey;
  let bump: number;

  const MANAGER_ROLE = "MANAGER";

  before(async () => {
    [accessControlPDA, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("access-control"), adminKeypair.publicKey.toBuffer()],
      program.programId
    );
    console.log("AccessControl PDA:", accessControlPDA.toBase58());
    console.log("PDA bump:", bump);
    console.log("Admin:", adminKeypair.publicKey.toBase58());
  });

  it("Initializes the access control account", async () => {
    await program.methods.initialize()
      .accounts({
        accessControl: accessControlPDA,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc({
        skipPreflight: false,
        commitment: "confirmed",
      });

    const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
    const accessControlAccount = program.coder.accounts.decode("AccessControl", accountInfo!.data);
    expect(accessControlAccount.admin.toString()).to.equal(adminKeypair.publicKey.toString());
    expect(accessControlAccount.isPaused).to.be.false;
    expect(accessControlAccount.permissions.length).to.equal(0);
  });

  it("Fails when non-admin tries to set permissions", async () => {
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
          admin: adminKeypair.publicKey,
        })
        .signers([adminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("InvalidPermission");
    }
  });

  it("Fails to activate emergency stop when already paused", async () => {
    // 首先，啟動緊急停止
    await program.methods.emergencyStop()
      .accounts({
        accessControl: accessControlPDA,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    // 然後嘗試再次啟動緊急停止
    try {
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        })
        .signers([adminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("AlreadyPaused");
    }

    // 恢復系統供其他測試使用
    await program.methods.resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();
  });

  it("Fails to resume when not paused", async () => {
    try {
      await program.methods.resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        })
        .signers([adminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("NotPaused");
    }
  });
});
