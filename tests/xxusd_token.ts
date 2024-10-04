import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { XxusdToken } from "../target/types/xxusd_token";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { expect } from "chai";

describe("xxusd_token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.XxusdToken as Program<XxusdToken>;

  let mint: anchor.web3.PublicKey;
  let tokenAccount: anchor.web3.PublicKey;
  let authority: anchor.web3.Keypair;

  before(async () => {
    authority = anchor.web3.Keypair.generate();
    await provider.connection.requestAirdrop(authority.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  });

  it("Initializes the xxUSD token", async () => {
    mint = await createMint(
      provider.connection,
      authority,
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

    const mintInfo = await provider.connection.getParsedAccountInfo(mint);
    expect(mintInfo.value).to.not.be.null;
    expect((mintInfo.value!.data as any).parsed.info.decimals).to.equal(9);
    expect((mintInfo.value!.data as any).parsed.info.mintAuthority).to.equal(authority.publicKey.toString());
    expect((mintInfo.value!.data as any).parsed.info.freezeAuthority).to.equal(authority.publicKey.toString());
  });

  it("Mints xxUSD tokens", async () => {
    tokenAccount = await getAssociatedTokenAddress(mint, authority.publicKey);

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

    const account = await getAccount(provider.connection, tokenAccount);
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
        authority: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const senderAccount = await getAccount(provider.connection, tokenAccount);
    const recipientAccount = await getAccount(provider.connection, recipientTokenAccount);
    expect(senderAccount.amount.toString()).to.equal("250000000");
    expect(recipientAccount.amount.toString()).to.equal("250000000");
  });
});