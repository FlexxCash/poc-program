import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Signer, Transaction, VersionedTransaction } from "@solana/web3.js";
import { expect } from "chai";
import { AccessControl } from "../target/types/access_control";
import * as fs from "fs";
import * as path from "path";

// 定義 AccessControl 帳戶結構
interface AccessControlAccount {
  admin: PublicKey;
  isPaused: boolean;
  permissions: Array<[string, boolean]>;
}

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
  const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
  anchor.setProvider(provider);

  const program = anchor.workspace.AccessControl as Program<AccessControl>;

  let accessControlPDA: PublicKey;
  let bump: number;

  const closeAccountIfExists = async (pubkey: PublicKey) => {
    const accountInfo = await provider.connection.getAccountInfo(pubkey);
    if (accountInfo !== null) {
      console.log(`Closing existing account: ${pubkey.toBase58()}`);
      try {
        await program.methods.closeAccount()
          .accounts({
            accessControl: pubkey,
            admin: adminKeypair.publicKey,
          })
          .signers([adminKeypair])
          .rpc();
        console.log("Account closed successfully");
      } catch (error) {
        console.error("Error closing account:", error);
        throw error;
      }
    }
  };

  const getAccessControlAccount = async (pubkey: PublicKey): Promise<AccessControlAccount> => {
    const accountInfo = await provider.connection.getAccountInfo(pubkey);
    if (accountInfo === null) {
      throw new Error(`AccessControl account not found at ${pubkey.toBase58()}. Please check initialization.`);
    }
    return program.coder.accounts.decode("AccessControl", accountInfo.data);
  };

  before(async () => {
    [accessControlPDA, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("access_control"), adminKeypair.publicKey.toBuffer()],
      program.programId
    );
    console.log("Expected AccessControl PDA:", accessControlPDA.toBase58());
    console.log("PDA bump:", bump);
    console.log("Admin:", adminKeypair.publicKey.toBase58());
    console.log("Program ID:", program.programId.toBase58());

    await closeAccountIfExists(accessControlPDA);
  });

  it("Initializes the access control account", async () => {
    try {
      console.log("Initializing AccessControl account...");
      const tx = await program.methods.initialize()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([adminKeypair])
        .rpc();
      console.log("AccessControl account initialized. Transaction signature:", tx);
      
      await provider.connection.confirmTransaction(tx, "confirmed");
      console.log("Transaction confirmed");

      // 立即檢查帳戶是否存在
      const accountInfo = await provider.connection.getAccountInfo(accessControlPDA);
      if (accountInfo === null) {
        throw new Error("Failed to create AccessControl account");
      }
      console.log("AccessControl account created successfully");

      console.log("Fetching account info...");
      console.log("Account info:", accountInfo);
      console.log("Raw account data:", accountInfo.data.toString('hex'));
      
      console.log("Decoding account data...");
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      console.log("Decoded AccessControl account:", accessControlAccount);
      
      console.log("Actual AccessControl PDA:", accessControlPDA.toBase58());
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
        })
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
        })
        .signers([adminKeypair])
        .rpc();
      
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      expect(accessControlAccount.isPaused).to.be.true;
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
        })
        .signers([adminKeypair])
        .rpc();
      expect.fail("Transaction should have failed");
    } catch (error: any) {
      console.log("Error message:", error.message);
      console.log("Error logs:", error.logs);
      expect(error.message).to.include("System is already paused");
    }
  });

  it("Resumes successfully", async () => {
    try {
      await program.methods.resume()
        .accounts({
          accessControl: accessControlPDA,
          admin: adminKeypair.publicKey,
        })
        .signers([adminKeypair])
        .rpc();
      
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      expect(accessControlAccount.isPaused).to.be.false;
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
        })
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
