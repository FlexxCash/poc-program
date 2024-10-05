import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, TransactionInstruction, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { AccessControl } from "../target/types/access_control";
import {
  AddedAccount,
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
} from "solana-bankrun";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Constants
const ADMIN_ROLE = "ADMIN";
const MANAGER_ROLE = "MANAGER";

// Helper Functions
async function createAndProcessTransaction(
  client: BanksClient,
  payer: Keypair,
  instruction: TransactionInstruction,
  additionalSigners: Keypair[] = []
): Promise<BanksTransactionResultWithMeta> {
  const tx = new Transaction();
  const latestBlockhashTuple = await client.getLatestBlockhash();
  if (!latestBlockhashTuple) {
    throw new Error("Failed to get latest blockhash");
  }
  const [latestBlockhash] = latestBlockhashTuple;
  tx.recentBlockhash = latestBlockhash;
  tx.feePayer = payer.publicKey;
  tx.add(instruction);
  if (additionalSigners.length > 0) {
    tx.sign(...additionalSigners);
  }
  return await client.tryProcessTransaction(tx);
}

describe("AccessControl Tests with Bankrun", () => {
  let context: ProgramTestContext;
  let client: BanksClient;
  let payer: Keypair;
  let provider: BankrunProvider;
  let program: Program<AccessControl>;
  let accessControlAccount: PublicKey;
  let adminKeypair: Keypair;

  before(async () => {
    adminKeypair = Keypair.generate();
    // Airdrop some SOL to the admin account for transaction fees
    context = await startAnchor("", [], [
      {
        address: adminKeypair.publicKey,
        info: {
          lamports: 2 * 1_000_000_000,
          data: Buffer.alloc(0),
          owner: PublicKey.default,
          executable: false,
        },
      },
    ]);
    client = context.banksClient;
    payer = context.payer;
    provider = new BankrunProvider(context);
    program = new Program<AccessControl>(
      require("../target/idl/access_control.json"),
      new PublicKey("7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv"), // 替換為實際的程序 ID
      provider
    );

    // 生成一個獨立的 AccessControl 賬戶公鑰
    accessControlAccount = Keypair.generate().publicKey;

    // 初始化 Access Control Account
    const initializeIx = await program.methods
      .initialize()
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();

    // 初始化 AccessControl 賬戶，僅由 adminKeypair 簽名
    await createAndProcessTransaction(client, payer, initializeIx, [adminKeypair]);
  });

  it("Initializes the access control account correctly", async () => {
    const accountData = await program.account.accessControl.fetch(accessControlAccount);
    expect(accountData).to.exist;
    expect(accountData.admin.toString()).to.equal(adminKeypair.publicKey.toString());
    expect(accountData.isPaused).to.be.false;
    expect(accountData.permissions.size).to.equal(0);
  });

  it("Sets permissions as admin", async () => {
    const setPermissionsIx = await program.methods
      .setPermissions(MANAGER_ROLE, true)
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    const txResult = await createAndProcessTransaction(client, payer, setPermissionsIx, [adminKeypair]);

    expect(txResult.result).to.be.null;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      `Program log: Set permissions for role ${MANAGER_ROLE} to true`,
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv success",
    ]);
  });

  it("Activates emergency stop as admin", async () => {
    const emergencyStopIx = await program.methods
      .emergencyStop()
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    const txResult = await createAndProcessTransaction(client, payer, emergencyStopIx, [adminKeypair]);

    expect(txResult.result).to.be.null;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      "Program log: Emergency stop activated",
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv success",
    ]);
  });

  it("Resumes after emergency stop as admin", async () => {
    const resumeIx = await program.methods
      .resume()
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    const txResult = await createAndProcessTransaction(client, payer, resumeIx, [adminKeypair]);

    expect(txResult.result).to.be.null;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      "Program log: System resumed",
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv success",
    ]);
  });

  it("Fails when non-admin tries to set permissions", async () => {
    const nonAdminKeypair = Keypair.generate();
    // Airdrop some SOL 到 non-admin 賬戶以支付交易費用
    context.setAccount(nonAdminKeypair.publicKey, {
      lamports: 1 * 1_000_000_000,
      data: Buffer.alloc(0),
      owner: PublicKey.default,
      executable: false,
    });

    const setPermissionsIx = await program.methods
      .setPermissions(MANAGER_ROLE, true)
      .accounts({
        accessControl: accessControlAccount,
        admin: nonAdminKeypair.publicKey,
      })
      .instruction();

    const txResult = await createAndProcessTransaction(client, payer, setPermissionsIx, [nonAdminKeypair]);

    expect(txResult.result).to.exist;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      "Program log: Unauthorized",
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv failed",
    ]);
  });

  it("Fails when non-admin tries to activate emergency stop", async () => {
    const nonAdminKeypair = Keypair.generate();
    // Airdrop some SOL 到 non-admin 賬戶以支付交易費用
    context.setAccount(nonAdminKeypair.publicKey, {
      lamports: 1 * 1_000_000_000,
      data: Buffer.alloc(0),
      owner: PublicKey.default,
      executable: false,
    });

    const emergencyStopIx = await program.methods
      .emergencyStop()
      .accounts({
        accessControl: accessControlAccount,
        admin: nonAdminKeypair.publicKey,
      })
      .instruction();

    const txResult = await createAndProcessTransaction(client, payer, emergencyStopIx, [nonAdminKeypair]);

    expect(txResult.result).to.exist;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      "Program log: Unauthorized",
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv failed",
    ]);
  });

  it("Fails to set invalid permissions", async () => {
    const setPermissionsIx = await program.methods
      .setPermissions("INVALID_ROLE", true) // 假設第二個參數為布林值；如果不是，請根據實際情況調整
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    const txResult = await createAndProcessTransaction(client, payer, setPermissionsIx, [adminKeypair]);

    expect(txResult.result).to.exist;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      "Program log: InvalidPermission",
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv failed",
    ]);
  });

  it("Fails to activate emergency stop when already paused", async () => {
    // 首先，啟動緊急停止
    const emergencyStopIx = await program.methods
      .emergencyStop()
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    await createAndProcessTransaction(client, payer, emergencyStopIx, [adminKeypair]);

    // 再次嘗試啟動緊急停止
    const txResult = await createAndProcessTransaction(client, payer, emergencyStopIx, [adminKeypair]);

    expect(txResult.result).to.exist;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      "Program log: AlreadyPaused",
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv failed",
    ]);

    // 恢復系統以便進行其他測試
    const resumeIx = await program.methods
      .resume()
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    await createAndProcessTransaction(client, payer, resumeIx, [adminKeypair]);
  });

  it("Fails to resume when not paused", async () => {
    const resumeIx = await program.methods
      .resume()
      .accounts({
        accessControl: accessControlAccount,
        admin: adminKeypair.publicKey,
      })
      .instruction();

    const txResult = await createAndProcessTransaction(client, payer, resumeIx, [adminKeypair]);

    expect(txResult.result).to.exist;
    expect(txResult.meta!.logMessages).to.deep.include.members([
      "Program log: NotPaused",
      "Program 7XqCdxDjk9QheBci6JQBzH8x6Y3Ny5TKPpcp8VvfgsYv failed",
    ]);
  });
});