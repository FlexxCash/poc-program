import { startAnchor } from "solana-bankrun";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { XxusdToken } from "../target/types/xxusd_token";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { expect } from "chai";

describe("xxusd_token", () => {
  // 使用 startAnchor 初始化 Bankrun 測試環境
  let context: ProgramTestContext;
  let client: BanksClient;
  let payer: anchor.web3.Keypair;
  let program: Program<XxusdToken>;

  before(async () => {
    // 假設 flexxcash-poc 是 Anchor 工作區的根目錄
    context = await startAnchor("flexxcash-poc", [], []);
    client = context.banksClient;
    payer = context.payer;

    // 設置 Anchor 提供者
    const provider = new anchor.AnchorProvider(
      new anchor.web3.Connection("http://localhost:8899", "confirmed"),
      new anchor.Wallet(payer),
      {}
    );
    anchor.setProvider(provider);

    // 獲取 Anchor workspace 中的程式
    program = anchor.workspace.XxusdToken as Program<XxusdToken>;
  });

  let mint: anchor.web3.PublicKey;
  let tokenAccount: anchor.web3.PublicKey;
  let authority: anchor.web3.Keypair;

  it("Initializes the xxUSD token", async () => {
    authority = anchor.web3.Keypair.generate();
    await client.processTransaction(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: authority.publicKey,
          space: 82, // 8 + 74 (DataAccount::INIT_SPACE) 視實際情況調整
          lamports: await client.getRent().minimumBalance(82),
          programId: TOKEN_PROGRAM_ID,
        })
      )
    );

    mint = await createMint(
      client.connection,
      payer,
      authority.publicKey,
      authority.publicKey,
      9 // 9 decimals
    );

    await program.methods
      .initialize(9, authority.publicKey)
      .accounts({
        mint,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authority])
      .rpc();

    const mintInfo = await client.getAccount(mint);
    expect(mintInfo).to.not.be.null;
    // 解碼 mint 資訊
    const parsedMint = (await program.account.mint.fetch(mint)).decimals;
    expect(parsedMint).to.equal(9);
  });

  it("Mints xxUSD tokens", async () => {
    tokenAccount = await getAssociatedTokenAddress(mint, authority.publicKey);

    // 創建接收者的 ATA
    await client.processTransaction(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: authority.publicKey,
          space: 165, // SPL Token Account Size
          lamports: await client.getRent().minimumBalance(165),
          programId: TOKEN_PROGRAM_ID,
        })
      )
    );

    await program.methods
      .mint(new anchor.BN(1000000000)) // 1 xxUSD
      .accounts({
        mint,
        to: tokenAccount,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const account = await getAccount(client.connection, tokenAccount);
    expect(account.amount.toString()).to.equal("1000000000");
  });

  it("Burns xxUSD tokens", async () => {
    await program.methods
      .burn(new anchor.BN(500000000)) // 0.5 xxUSD
      .accounts({
        mint,
        from: tokenAccount,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const account = await getAccount(client.connection, tokenAccount);
    expect(account.amount.toString()).to.equal("500000000");
  });

  it("Transfers xxUSD tokens", async () => {
    const recipient = anchor.web3.Keypair.generate();
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient.publicKey);

    // 創建接收者的 ATA
    await client.processTransaction(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: recipient.publicKey,
          space: 165, // SPL Token Account Size
          lamports: await client.getRent().minimumBalance(165),
          programId: TOKEN_PROGRAM_ID,
        })
      )
    );

    await program.methods
      .transfer(new anchor.BN(250000000)) // 0.25 xxUSD
      .accounts({
        mint,
        from: tokenAccount,
        to: recipientTokenAccount,
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const senderAccount = await getAccount(client.connection, tokenAccount);
    const recipientAccount = await getAccount(client.connection, recipientTokenAccount);
    expect(senderAccount.amount.toString()).to.equal("250000000");
    expect(recipientAccount.amount.toString()).to.equal("250000000");
  });
});