import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { RedemptionManager } from "../target/types/redemption_manager";
import { PriceOracle } from "../target/types/price_oracle";
import { AccessControl } from "../target/types/access_control";
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
import * as fs from "fs";
import * as path from "path";

// 載入 Keypair 的函數
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

describe("redemption_manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const redemptionManagerProgram = anchor.workspace.RedemptionManager as Program<RedemptionManager>;
  const priceOracleProgram = anchor.workspace.PriceOracle as Program<PriceOracle>;
  const accessControlProgram = anchor.workspace.AccessControl as Program<AccessControl>;
  const user = provider.wallet.publicKey;

  // PDA 變數宣告
  let xxusdMint: PublicKey;
  let userXxusdAccount: PublicKey;
  let redemptionVault: PublicKey;
  let systemState: PublicKey;
  let oracleAccount: Keypair;
  let lockRecordPDA: PublicKey;
  let lockRecordBump: number;
  let accessControlPDA: PublicKey;
  let accessControlBump: number;
  let redemptionRequestPDA: PublicKey;
  let redemptionRequestBump: number;
  let redemptionManagerPDA: PublicKey;
  let redemptionManagerBump: number;

  const MINIMUM_XXUSD_BALANCE = 100_000_000_000; // 使用 number 類型
  const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  const mockInterestAssetFeed = new PublicKey("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1");

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

  // 定義關閉帳戶的函數
  const closeAccountIfExists = async (pubkey: PublicKey) => {
    const accountInfo = await provider.connection.getAccountInfo(pubkey);
    if (accountInfo !== null) {
      console.log(`Closing existing account: ${pubkey.toBase58()}`);
      try {
        const tx = await accessControlProgram.methods.closeAccount()
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

  // 定義獲取 AccessControl 帳戶資訊的函數
  const getAccessControlAccount = async (pubkey: PublicKey): Promise<any> => {
    try {
      console.log("Fetching AccessControl account...");
      console.log("Program account keys:", Object.keys(accessControlProgram.account));
      if (!(accessControlProgram.account as any).access_control) {
        throw new Error("AccessControl account is not defined in the program");
      }
      const account = await (accessControlProgram.account as any).access_control.fetch(pubkey);
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

  // 定義初始化 AccessControl 帳戶的函數
  const initializeAccessControl = async () => {
    console.log("Initializing AccessControl account...");
    try {
      [accessControlPDA, accessControlBump] = await PublicKey.findProgramAddress(
        [Buffer.from("access_control"), adminKeypair.publicKey.toBuffer()],
        accessControlProgram.programId
      );
      console.log("AccessControl PDA:", accessControlPDA.toBase58());
      console.log("AccessControl Bump:", accessControlBump);

      const tx = await accessControlProgram.methods.initialize(accessControlBump)
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

      // 獲取並輸出帳戶數據
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
      // 獲取並輸出現有帳戶數據
      const accessControlAccount = await getAccessControlAccount(accessControlPDA);
      console.log("Existing AccessControl account data:", accessControlAccount);
    }
  };

  // 定義 RedemptionRequest 和 RedemptionManager PDA

  // 定義獲取 RedemptionRequest 帳戶資訊的函數
  const getRedemptionRequestAccount = async (pubkey: PublicKey): Promise<any> => {
    try {
      console.log("Fetching RedemptionRequest account...");
      const account = await (redemptionManagerProgram.account as any).redemptionRequest.fetch(pubkey);
      console.log("RedemptionRequest account fetched successfully:", account);
      return account;
    } catch (error) {
      console.error("Error fetching RedemptionRequest account:", error);
      throw error;
    }
  };

  // 初始化 RedemptionRequest PDA
  const initializeRedemptionRequest = async () => {
    console.log("Initializing RedemptionRequest PDA...");
    [redemptionRequestPDA, redemptionRequestBump] = await PublicKey.findProgramAddress(
      [Buffer.from("redemption_request"), user.toBuffer()],
      redemptionManagerProgram.programId
    );
    console.log("RedemptionRequest PDA:", redemptionRequestPDA.toBase58());
    console.log("RedemptionRequest Bump:", redemptionRequestBump);

    // Initialize RedemptionRequest account if necessary
    try {
      const accountInfo = await provider.connection.getAccountInfo(redemptionRequestPDA);
      if (accountInfo === null) {
        console.log("Creating RedemptionRequest account...");
        const tx = await redemptionManagerProgram.methods
          .initiateRedeem(new BN(0)) // 使用 BN 類型
          .accounts({
            user: user,
            userTokenAccount: userXxusdAccount,
            redemptionVault: redemptionVault,
            lockRecord: lockRecordPDA,
            redemptionRequest: redemptionRequestPDA,
            systemState: systemState,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([adminKeypair])
          .rpc();
        console.log("RedemptionRequest account initialized. Transaction signature:", tx);

        await provider.connection.confirmTransaction(tx, "confirmed");

        const createdAccountInfo = await provider.connection.getAccountInfo(redemptionRequestPDA);
        if (createdAccountInfo === null) {
          throw new Error("Failed to create RedemptionRequest account");
        }
        console.log("RedemptionRequest account created successfully");

        const redemptionRequestAccount = await getRedemptionRequestAccount(redemptionRequestPDA);
        console.log("Initialized RedemptionRequest account data:", redemptionRequestAccount);
      } else {
        console.log("RedemptionRequest account already exists");
      }
    } catch (error) {
      console.error("Error initializing RedemptionRequest account:", error);
      throw error;
    }
  };

  // 初始化 RedemptionManager PDA
  const initializeRedemptionManager = async () => {
    console.log("Initializing RedemptionManager PDA...");
    [redemptionManagerPDA, redemptionManagerBump] = await PublicKey.findProgramAddress(
      [Buffer.from("redemption_manager")],
      redemptionManagerProgram.programId
    );
    console.log("RedemptionManager PDA:", redemptionManagerPDA.toBase58());
    console.log("RedemptionManager Bump:", redemptionManagerBump);

    // Initialize RedemptionManager account if necessary
    try {
      const accountInfo = await provider.connection.getAccountInfo(redemptionManagerPDA);
      if (accountInfo === null) {
        console.log("Creating RedemptionManager account...");
        const tx = await redemptionManagerProgram.methods
          .initializeSystemState()
          .accounts({
            systemState: systemState,
            authority: adminKeypair.publicKey,
          } as any)
          .signers([adminKeypair])
          .rpc();
        console.log("RedemptionManager account initialized. Transaction signature:", tx);

        await provider.connection.confirmTransaction(tx, "confirmed");

        const createdAccountInfo = await provider.connection.getAccountInfo(redemptionManagerPDA);
        if (createdAccountInfo === null) {
          throw new Error("Failed to create RedemptionManager account");
        }
        console.log("RedemptionManager account created successfully");
      } else {
        console.log("RedemptionManager account already exists");
      }
    } catch (error) {
      console.error("Error initializing RedemptionManager account:", error);
      throw error;
    }
  };

  before(async () => {
    // 初始化 AccessControl PDA 和帳戶
    await closeAccountIfExists(accessControlPDA);
    await ensureAccessControlInitialized();

    // 創建並初始化 LockRecord
    await createAndInitializeLockRecord();

    // 初始化 RedemptionRequest 和 RedemptionManager PDA
    await initializeRedemptionRequest();
    await initializeRedemptionManager();
  });

  it("Verifies the correct PDA is generated", async () => {
    const [expectedAccessControlPDA, expectedAccessControlBump] = await PublicKey.findProgramAddress(
      [Buffer.from("access_control"), adminKeypair.publicKey.toBuffer()],
      accessControlProgram.programId
    );
    expect(accessControlPDA.toString()).to.equal(expectedAccessControlPDA.toString());
    expect(accessControlBump).to.equal(expectedAccessControlBump);

    const [expectedLockRecordPDA, expectedLockRecordBump] = await PublicKey.findProgramAddress(
      [Buffer.from("lock_record"), user.toBuffer()],
      redemptionManagerProgram.programId
    );
    expect(lockRecordPDA.toString()).to.equal(expectedLockRecordPDA.toString());
    expect(lockRecordBump).to.equal(expectedLockRecordBump);

    const [expectedRedemptionRequestPDA, expectedRedemptionRequestBump] = await PublicKey.findProgramAddress(
      [Buffer.from("redemption_request"), user.toBuffer()],
      redemptionManagerProgram.programId
    );
    expect(redemptionRequestPDA.toString()).to.equal(expectedRedemptionRequestPDA.toString());
    expect(redemptionRequestBump).to.equal(expectedRedemptionRequestBump);

    const [expectedRedemptionManagerPDA, expectedRedemptionManagerBump] = await PublicKey.findProgramAddress(
      [Buffer.from("redemption_manager")],
      redemptionManagerProgram.programId
    );
    expect(redemptionManagerPDA.toString()).to.equal(expectedRedemptionManagerPDA.toString());
    expect(redemptionManagerBump).to.equal(expectedRedemptionManagerBump);
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

  it("should successfully initiate redemption", async () => {
    // Ensure user has enough xxUSD
    const userBalance = await provider.connection.getTokenAccountBalance(userXxusdAccount);
    expect(parseInt(userBalance.value.amount)).to.be.greaterThanOrEqual(MINIMUM_XXUSD_BALANCE / 2);

    const redeemAmount = MINIMUM_XXUSD_BALANCE / 2;
    const initiateRedeemInstruction = await redemptionManagerProgram.methods
      .initiateRedeem(new BN(redeemAmount)) // 使用 BN 類型
      .accounts({
        user: user,
        userTokenAccount: userXxusdAccount,
        redemptionVault: redemptionVault,
        lockRecord: lockRecordPDA,
        redemptionRequest: redemptionRequestPDA,
        systemState: systemState,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([initiateRedeemInstruction]);

    // Note: We can't verify the redemption request here as it's not clear how it's stored in the program
    // You might need to adjust this based on how your program actually stores redemption requests
  });

  it("should successfully execute redemption", async () => {
    const initialUserSolBalance = await provider.connection.getBalance(user);

    // Get SOL price before redemption
    const getPriceInstruction = await priceOracleProgram.methods
      .getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        solFeed: mockSolFeed,
        interestAssetFeed: mockInterestAssetFeed,
      } as any)
      .instruction();

    const executeRedeemInstruction = await redemptionManagerProgram.methods
      .executeRedeem()
      .accounts({
        user: user,
        redemptionVault: redemptionVault,
        lockRecord: lockRecordPDA,
        redemptionRequest: redemptionRequestPDA,
        systemState: systemState,
        xxusdMint: xxusdMint,
        redemptionManager: redemptionManagerPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    await createAndSendV0Tx([getPriceInstruction, executeRedeemInstruction]);

    const finalUserSolBalance = await provider.connection.getBalance(user);

    expect(finalUserSolBalance).to.be.greaterThan(initialUserSolBalance);

    // You could add additional checks here based on the SOL price if needed
  });

  it("should fail to execute redemption when system is paused", async () => {
    // Pause the system using AccessControl program
    const pauseSystemInstruction = await accessControlProgram.methods
      .emergencyStop() // 修正方法名稱
      .accounts({
        accessControl: accessControlPDA,
        admin: adminKeypair.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([pauseSystemInstruction]);

    try {
      const executeRedeemInstruction = await redemptionManagerProgram.methods
        .executeRedeem()
        .accounts({
          user: user,
          redemptionVault: redemptionVault,
          lockRecord: lockRecordPDA,
          redemptionRequest: redemptionRequestPDA,
          systemState: systemState,
          xxusdMint: xxusdMint,
          redemptionManager: redemptionManagerPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .instruction();

      await createAndSendV0Tx([executeRedeemInstruction]);
      expect.fail("Expected an error to be thrown");
    } catch (error: any) {
      expect(error.toString()).to.include("System is paused");
    }

    // Unpause the system using AccessControl program
    const unpauseSystemInstruction = await accessControlProgram.methods
      .resume()
      .accounts({
        accessControl: accessControlPDA,
        admin: adminKeypair.publicKey,
      } as any)
      .instruction();

    await createAndSendV0Tx([unpauseSystemInstruction]);
  });

  it("should check redeem eligibility correctly", async () => {
    const eligibility = await redemptionManagerProgram.methods
      .checkRedeemEligibility()
      .accounts({
        user: user,
        userTokenAccount: userXxusdAccount,
        lockRecord: lockRecordPDA,
        systemState: systemState,
      } as any)
      .view();

    expect(typeof eligibility).to.equal('boolean');
  });

  it("Activates emergency stop successfully", async () => {
    try {
      await accessControlProgram.methods
        .emergencyStop()
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

  it("Fails when non-admin tries to activate emergency stop", async () => {
    try {
      await accessControlProgram.methods
        .emergencyStop()
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

  it("Fails to activate emergency stop when already paused", async () => {
    try {
      await accessControlProgram.methods
        .emergencyStop()
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
      expect(error.message).to.include("AlreadyPaused");
    }
  });

  it("Fails when non-admin tries to resume", async () => {
    try {
      await accessControlProgram.methods
        .resume()
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
      await accessControlProgram.methods
        .resume()
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
      await accessControlProgram.methods
        .resume()
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
      expect(error.message).to.include("NotPaused");
    }
  });

  after(async () => {
    await closeAccountIfExists(accessControlPDA);
    await closeAccountIfExists(lockRecordPDA);
    await closeAccountIfExists(redemptionRequestPDA);
    await closeAccountIfExists(redemptionManagerPDA);
  });

  // 定義帳戶初始化和獲取函數
  const createAndInitializeLockRecord = async () => {
    console.log("Creating and initializing LockRecord PDA...");
    [lockRecordPDA, lockRecordBump] = await PublicKey.findProgramAddress(
      [Buffer.from("lock_record"), user.toBuffer()],
      redemptionManagerProgram.programId
    );
    console.log("LockRecord PDA:", lockRecordPDA.toBase58());
    console.log("LockRecord Bump:", lockRecordBump);

    // Initialize LockRecord account
    try {
      const accountInfo = await provider.connection.getAccountInfo(lockRecordPDA);
      if (accountInfo === null) {
        console.log("Creating LockRecord account...");
        const tx = await redemptionManagerProgram.methods
          .initiateRedeem(new BN(0)) // 使用 BN 類型
          .accounts({
            user: user,
            userTokenAccount: userXxusdAccount,
            redemptionVault: redemptionVault,
            lockRecord: lockRecordPDA,
            redemptionRequest: redemptionRequestPDA,
            systemState: systemState,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([adminKeypair])
          .rpc();
        console.log("LockRecord account initialized. Transaction signature:", tx);

        await provider.connection.confirmTransaction(tx, "confirmed");

        const createdAccountInfo = await provider.connection.getAccountInfo(lockRecordPDA);
        if (createdAccountInfo === null) {
          throw new Error("Failed to create LockRecord account");
        }
        console.log("LockRecord account created successfully");

        const lockRecordAccount = await redemptionManagerProgram.account.lockRecord.fetch(lockRecordPDA);
        console.log("Initialized LockRecord account data:", lockRecordAccount);
      } else {
        console.log("LockRecord account already exists");
      }
    } catch (error) {
      console.error("Error initializing LockRecord account:", error);
      throw error;
    }
  };
});
