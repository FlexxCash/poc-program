import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { XxusdToken } from "../target/types/xxusd_token";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount, getMint } from "@solana/spl-token";
import { expect } from "chai";

describe("xxusd_token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.XxusdToken as Program<XxusdToken>;
  const user = provider.wallet.publicKey;

  let mint: anchor.web3.PublicKey;
  let tokenAccount: anchor.web3.PublicKey;

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

  it("Initializes the xxUSD token", async () => {
    mint = anchor.web3.Keypair.generate().publicKey;

    const initializeInstruction = await program.methods
      .initialize(9, null)
      .accounts({
        mint,
        authority: user,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      } as any)
      .instruction();

    await createAndSendV0Tx([initializeInstruction]);

    const mintInfo = await getMint(provider.connection, mint);
    expect(mintInfo).to.not.be.null;
    expect(mintInfo.decimals).to.equal(9);
  });

  it("Mints xxUSD tokens", async () => {
    tokenAccount = await getAssociatedTokenAddress(mint, user);

    const mintInstruction = await program.methods
      .mint(new anchor.BN(1000000000)) // 1 xxUSD
      .accounts({
        mint,
        to: tokenAccount,
        authority: user,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .instruction();

    await createAndSendV0Tx([mintInstruction]);

    const account = await getAccount(provider.connection, tokenAccount);
    expect(account.amount.toString()).to.equal("1000000000");
  });

  it("Burns xxUSD tokens", async () => {
    const burnInstruction = await program.methods
      .burn(new anchor.BN(500000000)) // 0.5 xxUSD
      .accounts({
        mint,
        from: tokenAccount,
        authority: user,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();

    await createAndSendV0Tx([burnInstruction]);

    const account = await getAccount(provider.connection, tokenAccount);
    expect(account.amount.toString()).to.equal("500000000");
  });

  it("Transfers xxUSD tokens", async () => {
    const recipient = anchor.web3.Keypair.generate();
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient.publicKey);

    const transferInstruction = await program.methods
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
      .instruction();

    await createAndSendV0Tx([transferInstruction]);

    const senderAccount = await getAccount(provider.connection, tokenAccount);
    const recipientAccount = await getAccount(provider.connection, recipientTokenAccount);
    expect(senderAccount.amount.toString()).to.equal("250000000");
    expect(recipientAccount.amount.toString()).to.equal("250000000");
  });
});