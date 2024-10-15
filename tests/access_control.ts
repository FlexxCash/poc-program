import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Signer, Transaction, VersionedTransaction } from "@solana/web3.js";
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

class KeypairWallet implements anchor.Wallet {
  publicKey: PublicKey;
  payer: Keypair;

  constructor(payer: Keypair) {
    this.payer = payer;
    this.publicKey = payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.sign(this.payer);
      return tx as T;
    } else {
      throw new Error("VersionedTransaction signing not implemented");
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map(tx => this.signTransaction(tx)));
  }
}

const adminKeypair: Keypair = loadKeypair("/home/dc/.config/solana/new_id.json");
const nonAdminKeypair: Keypair = loadKeypair("/home/dc/.config/solana/nonAdmin.json");

describe("AccessControl Tests on Devnet", () => {
  const wallet = new KeypairWallet(adminKeypair);
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());
  anchor.setProvider(provider);

  const program = anchor.workspace.AccessControl as Program<AccessControl>;

  let accessControlPDA: PublicKey;
  let bump: number;

  before(async () => {
    [accessControlPDA, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("access_control"), adminKeypair.publicKey.toBuffer()],
      program.programId
    );
    console.log("AccessControl PDA:", accessControlPDA.toBase58());
    console.log("PDA bump:", bump);
    console.log("Admin:", adminKeypair.publicKey.toBase58());
    console.log("Program ID:", program.programId.toBase58());
  });

  it("Initializes the access control account", async () => {
    try {
      await program.methods.initialize()
      .accounts({
        accessControl: accessControlPDA,
        admin: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
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
    } catch (error) {
      console.error("Initialization error:", error);
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
      expect(error.message).to.include("Unauthorized");
    }
  });

  it("Fails to activate emergency stop when already paused", async () => {
    try {
      // 首先，啟動緊急停止
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        } as any)
        .signers([adminKeypair])
        .rpc();

      // 然後嘗試再次啟動緊急停止
      await program.methods.emergencyStop()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        } as any)
        .signers([adminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      expect(error.message).to.include("AlreadyPaused");
    } finally {
      // 恢復系統供其他測試使用
      await program.methods.resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        } as any)
        .signers([adminKeypair])
        .rpc();
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
      expect(error.message).to.include("NotPaused");
    }
  });
});
