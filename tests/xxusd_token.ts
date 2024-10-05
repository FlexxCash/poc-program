import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { XxusdToken } from "../target/types/xxusd_token";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount, getMint } from "@solana/spl-token";
import { expect } from "chai";

describe("xxusd_token", () => {
  // 配置 Anchor provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // 獲取程式實例
  const program = anchor.workspace.XxusdToken as Program<XxusdToken>;

  // 使用指定的錢包
  const wallet = new anchor.Wallet(anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require('fs').readFileSync('/home/dc/.config/solana/new_id.json', 'utf-8')))
  ));

  const user = wallet.publicKey;

  let mint: anchor.web3.PublicKey;
  let tokenAccount: anchor.web3.PublicKey;

  it("Initializes the xxUSD token", async () => {
    mint = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .initialize(9, null)
      .accounts({
        mint,
        authority: user,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([wallet.payer])
      .rpc();

    const mintInfo = await getMint(provider.connection, mint);
    expect(mintInfo).to.not.be.null;
    expect(mintInfo.decimals).to.equal(9);
  });

  it("Mints xxUSD tokens", async () => {
    tokenAccount = await getAssociatedTokenAddress(mint, user);

    await program.methods
      .mint(new anchor.BN(1000000000)) // 1 xxUSD
      .accounts({
        mint,
        to: tokenAccount,
        authority: user,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([wallet.payer])
      .rpc();

    const account = await getAccount(provider.connection, tokenAccount);
    expect(account.amount.toString()).to.equal("1000000000");
  });

  it("Burns xxUSD tokens", async () => {
    await program.methods
      .burn(new anchor.BN(500000000)) // 0.5 xxUSD
      .accounts({
        mint,
        from: tokenAccount,
        authority: user,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([wallet.payer])
      .rpc();

    const account = await getAccount(provider.connection, tokenAccount);
    expect(account.amount.toString()).to.equal("500000000");
  });

  it("Transfers xxUSD tokens", async () => {
    const recipient = anchor.web3.Keypair.generate();
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient.publicKey);

    await program.methods
      .transfer(new anchor.BN(250000000)) // 0.25 xxUSD
      .accounts({
        mint,
        from: tokenAccount,
        to: recipientTokenAccount,
        authority: user,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([wallet.payer])
      .rpc();

    const senderAccount = await getAccount(provider.connection, tokenAccount);
    const recipientAccount = await getAccount(provider.connection, recipientTokenAccount);
    expect(senderAccount.amount.toString()).to.equal("250000000");
    expect(recipientAccount.amount.toString()).to.equal("250000000");
  });
});