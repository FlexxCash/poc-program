import { setProvider, Program } from "@coral-xyz/anchor";
import { LockManager } from "../target/types/lock_manager";
import { AssetManager } from "../target/types/asset_manager";
import { XxusdToken } from "../target/types/xxusd_token";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  AccountInfoBytes,
  AddedAccount,
  BanksClient,
  BanksTransactionResultWithMeta,
  ProgramTestContext,
  startAnchor,
} from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Transaction, Keypair } from "@solana/web3.js";

describe("lock_manager with Bankrun", () => {
  const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const MINIMUM_SLOT = 100;
  const MINIMUM_USDC_BALANCE = 100_000_000_000; // 100k USDC

  let context: ProgramTestContext;
  let client: BanksClient;
  let payer: Keypair;
  let provider: BankrunProvider;
  let lockManagerProgram: Program<LockManager>;
  let assetManagerProgram: Program<AssetManager>;
  let xxusdTokenProgram: Program<XxusdToken>;

  let xxusdMint: PublicKey;
  let userXxusdAccount: PublicKey;
  let lockVault: PublicKey;
  let lockManager: PublicKey;
  let lockRecord: PublicKey;
  let user: Keypair;

  before(async () => {
    // 初始化 Bankrun 環境
    const usdcMint = new PublicKey(USDC_MINT_ADDRESS);
    const connection = new anchor.web3.Connection("https://api.mainnet-beta.solana.com");
    const usdcAccountInfo = await connection.getAccountInfo(usdcMint);

    const addedAccounts: AddedAccount[] = [
      {
        address: usdcMint,
        info: {
          lamports: usdcAccountInfo?.lamports || 0,
          data: usdcAccountInfo?.data || Buffer.alloc(0),
          owner: usdcAccountInfo?.owner || TOKEN_PROGRAM_ID,
          executable: usdcAccountInfo?.executable || false,
        },
      },
    ];

    context = await startAnchor("/home/dc/flexxcash_xxUSD", [], addedAccounts);
    client = context.banksClient;
    payer = context.payer;
    provider = new BankrunProvider(context);

    setProvider(provider);

    // 手動加載程序
    // 請確保您已經將實際的 Program ID 替換為以下字符串
    const LOCK_MANAGER_PROGRAM_ID = new PublicKey("YOUR_LOCK_MANAGER_PROGRAM_ID"); // 替換為實際的 Program ID
    const ASSET_MANAGER_PROGRAM_ID = new PublicKey("YOUR_ASSET_MANAGER_PROGRAM_ID"); // 替換為實際的 Program ID
    const XXUSD_TOKEN_PROGRAM_ID = new PublicKey("YOUR_XXUSD_TOKEN_PROGRAM_ID"); // 替換為實際的 Program ID

    lockManagerProgram = new Program<LockManager>(
      require("../target/idl/lock_manager.json"),
      LOCK_MANAGER_PROGRAM_ID,
      provider as any
    ) as Program<LockManager>;

    assetManagerProgram = new Program<AssetManager>(
      require("../target/idl/asset_manager.json"),
      ASSET_MANAGER_PROGRAM_ID,
      provider as any
    ) as Program<AssetManager>;

    xxusdTokenProgram = new Program<XxusdToken>(
      require("../target/idl/xxusd_token.json"),
      XXUSD_TOKEN_PROGRAM_ID,
      provider as any
    ) as Program<XxusdToken>;

    user = Keypair.generate();
    await provider.connection.requestAirdrop(user.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

    // 創建 xxUSD mint
    xxusdMint = await createMint(
      provider.connection,
      user,
      provider.wallet.publicKey,
      null,
      6 // 6 decimals for xxUSD
    );

    // 創建使用者的 xxUSD 帳戶
    userXxusdAccount = await getAssociatedTokenAddress(xxusdMint, user.publicKey);
    await mintTo(
      provider.connection,
      user,
      xxusdMint,
      userXxusdAccount,
      provider.wallet.publicKey,
      1_000_000_000 // Mint 1000 xxUSD to user
    );

    // 推導 LockManager PDA
    [lockManager] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lock_manager")],
      lockManagerProgram.programId
    );

    // 創建 lock vault
    lockVault = await getAssociatedTokenAddress(xxusdMint, lockManager, true);

    // 推導 LockRecord PDA
    [lockRecord] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lock_record"), user.publicKey.toBuffer()],
      lockManagerProgram.programId
    );
  });

  // 工具函數：創建並處理交易
  async function createAndProcessTransaction(
    client: BanksClient,
    payer: Keypair,
    instruction: any,
    additionalSigners: Keypair[] = []
  ): Promise<BanksTransactionResultWithMeta> {
    const tx = new Transaction();
    const latestBlockhashResult = await client.getLatestBlockhash();
    if (!latestBlockhashResult) {
      throw new Error("Failed to fetch latest blockhash");
    }
    const [latestBlockhash, _lastValidBlockHeight] = latestBlockhashResult;
    tx.recentBlockhash = latestBlockhash;
    tx.add(instruction);
    tx.feePayer = payer.publicKey;
    tx.sign(payer, ...additionalSigners);
    return await client.tryProcessTransaction(tx);
  }

  // 工具函數：設置 ATA
  async function setupATA(
    context: ProgramTestContext,
    usdcMint: PublicKey,
    owner: PublicKey,
    amount: number
  ): Promise<PublicKey> {
    const ata = await getAssociatedTokenAddress(usdcMint, owner, true);
    const tokenAccData = Buffer.alloc(165); // SPL Token Account size

    // 編碼帳戶數據
    const accountInfo = {
      mint: usdcMint,
      owner: owner,
      amount: BigInt(amount),
      delegateOption: 0,
      delegate: new PublicKey(0),
      delegatedAmount: BigInt(0),
      state: 1,
      isNativeOption: 0,
      isNative: BigInt(0),
      closeAuthorityOption: 0,
      closeAuthority: new PublicKey(0),
    };

    // 使用 SPL Token Layout 編碼
    const { AccountLayout } = require("@solana/spl-token");
    AccountLayout.encode(accountInfo, tokenAccData);

    const ataAccountInfo: AccountInfoBytes = {
      lamports: 1_000_000_000,
      data: tokenAccData,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    };

    context.setAccount(ata, ataAccountInfo);
    return ata;
  }

  describe("Bankrun Tests", () => {
    describe("Locks xxUSD tokens", () => {
      it("Locks xxUSD tokens successfully", async () => {
        const amount = new anchor.BN(100_000_000); // 100 xxUSD
        const lockPeriod = new anchor.BN(30); // 30 days
        const dailyRelease = new anchor.BN(3_333_333); // ~3.33 xxUSD per day

        const txResult = await lockManagerProgram.methods
          .lockXxusd(amount, lockPeriod, dailyRelease)
          .accounts({
            user: user.publicKey,
            userTokenAccount: userXxusdAccount,
            xxusdMint: xxusdMint,
            lockVault: lockVault,
            lockManager: lockManager,
            lockRecord: lockRecord,
            assetManager: assetManagerProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([user])
          .rpc();

        // 驗證 lock record
        const lockRecordAccount = await lockManagerProgram.account.lockRecord.fetch(lockRecord);
        expect(lockRecordAccount.owner.toString()).to.equal(user.publicKey.toString());
        expect(lockRecordAccount.amount.toNumber()).to.equal(100_000_000);
        expect(lockRecordAccount.lockPeriod.toNumber()).to.equal(30);
        expect(lockRecordAccount.dailyRelease.toNumber()).to.equal(3_333_333);

        // 驗證 token balances
        const userBalance = await getAccount(provider.connection, userXxusdAccount);
        const vaultBalance = await getAccount(provider.connection, lockVault);
        expect(Number(userBalance.amount)).to.equal(900_000_000); // 900 xxUSD left
        expect(Number(vaultBalance.amount)).to.equal(100_000_000); // 100 xxUSD locked
      });
    });

    describe("Releases daily xxUSD tokens", () => {
      it("Releases daily xxUSD tokens successfully", async () => {
        // 快轉一日
        const currentClock = await client.getClock();
        context.setClock({
          slot: currentClock.slot + 1n,
          epochStartTimestamp: currentClock.epochStartTimestamp,
          epoch: currentClock.epoch,
          leaderScheduleEpoch: currentClock.leaderScheduleEpoch,
          unixTimestamp: currentClock.unixTimestamp + 86_400n, // +1 day
        });

        const txResult = await lockManagerProgram.methods
          .releaseDailyXxusd()
          .accounts({
            user: user.publicKey,
            userTokenAccount: userXxusdAccount,
            xxusdMint: xxusdMint,
            lockVault: lockVault,
            lockManager: lockManager,
            lockRecord: lockRecord,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();

        // 驗證更新後的 lock record
        const lockRecordAccount = await lockManagerProgram.account.lockRecord.fetch(lockRecord);
        expect(lockRecordAccount.amount.toNumber()).to.be.below(100_000_000);

        // 驗證 token balances
        const userBalance = await getAccount(provider.connection, userXxusdAccount);
        const vaultBalance = await getAccount(provider.connection, lockVault);
        expect(Number(userBalance.amount)).to.be.above(900_000_000); // 使用者應收到一些 xxUSD
        expect(Number(vaultBalance.amount)).to.be.below(100_000_000); // Vault 的 xxUSD 減少
      });
    });

    describe("Checks lock status", () => {
      it("Checks lock status successfully", async () => {
        const lockStatus = await lockManagerProgram.methods
          .checkLockStatus()
          .accounts({
            user: user.publicKey,
            lockRecord: lockRecord,
          })
          .view();

        expect(lockStatus.isLocked).to.be.true;
        expect(lockStatus.remainingLockTime.toNumber()).to.be.above(0);
        expect(lockStatus.redeemableAmount.toNumber()).to.be.above(0);
        expect(lockStatus.redemptionDeadline.toNumber()).to.be.above(0);
      });
    });

    describe("Checks if within redemption window", () => {
      it("Checks redemption window transitions correctly", async () => {
        // 初始應為 false
        const isWithinWindowInitial = await lockManagerProgram.methods
          .isWithinRedemptionWindow()
          .accounts({
            user: user.publicKey,
            lockRecord: lockRecord,
          })
          .view();

        expect(isWithinWindowInitial).to.be.false;

        // 快轉至鎖定期結束後
        const lockRecordAccount = await lockManagerProgram.account.lockRecord.fetch(lockRecord);
        const lockEndTime = lockRecordAccount.startTime.toNumber() + Number(lockRecordAccount.lockPeriod) * 86_400;
        context.setClock({
          slot: currentClock.slot, // 確保沒有改變 slot
          epochStartTimestamp: currentClock.epochStartTimestamp,
          epoch: currentClock.epoch,
          leaderScheduleEpoch: currentClock.leaderScheduleEpoch,
          unixTimestamp: BigInt(lockEndTime) + 1n,
        });

        const isWithinWindowAfterLock = await lockManagerProgram.methods
          .isWithinRedemptionWindow()
          .accounts({
            user: user.publicKey,
            lockRecord: lockRecord,
          })
          .view();

        expect(isWithinWindowAfterLock).to.be.true;

        // 快轉至贖回窗口結束後
        context.setClock({
          slot: currentClock.slot, // 確保沒有改變 slot
          epochStartTimestamp: currentClock.epochStartTimestamp,
          epoch: currentClock.epoch,
          leaderScheduleEpoch: currentClock.leaderScheduleEpoch,
          unixTimestamp: BigInt(lockEndTime) + 14n * 86_400n + 1n, // 14天後
        });

        const isWithinWindowAfterRedemption = await lockManagerProgram.methods
          .isWithinRedemptionWindow()
          .accounts({
            user: user.publicKey,
            lockRecord: lockRecord,
          })
          .view();

        expect(isWithinWindowAfterRedemption).to.be.false;
      });
    });

    describe("Fails to release twice in the same day", () => {
      it("Should fail on second release attempt within the same day", async () => {
        try {
          await lockManagerProgram.methods
            .releaseDailyXxusd()
            .accounts({
              user: user.publicKey,
              userTokenAccount: userXxusdAccount,
              xxusdMint: xxusdMint,
              lockVault: lockVault,
              lockManager: lockManager,
              lockRecord: lockRecord,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user])
            .rpc();
          expect.fail("Expected an error to be thrown");
        } catch (error: any) {
          expect(error.message).to.include("Already released today");
        }
      });
    });

    describe("Fails to release with invalid owner", () => {
      it("Should fail when releasing with an invalid owner", async () => {
        const invalidUser = Keypair.generate();
        await provider.connection.requestAirdrop(invalidUser.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

        const invalidUserXxusdAccount = await getAssociatedTokenAddress(xxusdMint, invalidUser.publicKey);

        try {
          await lockManagerProgram.methods
            .releaseDailyXxusd()
            .accounts({
              user: invalidUser.publicKey,
              userTokenAccount: invalidUserXxusdAccount,
              xxusdMint: xxusdMint,
              lockVault: lockVault,
              lockManager: lockManager,
              lockRecord: lockRecord,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([invalidUser])
            .rpc();
          expect.fail("Expected an error to be thrown");
        } catch (error: any) {
          expect(error.message).to.include("Invalid owner");
        }
      });
    });

    describe("Fails to check redemption window with invalid owner", () => {
      it("Should fail when checking redemption window with an invalid owner", async () => {
        const invalidUser = Keypair.generate();
        await provider.connection.requestAirdrop(invalidUser.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

        try {
          await lockManagerProgram.methods
            .isWithinRedemptionWindow()
            .accounts({
              user: invalidUser.publicKey,
              lockRecord: lockRecord,
            })
            .view();
          expect.fail("Expected an error to be thrown");
        } catch (error: any) {
          expect(error.message).to.include("Invalid owner");
        }
      });
    });
  });
});