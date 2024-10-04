import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PriceOracle } from '../target/types/price_oracle';
import { assert } from 'chai';
import {
  PullFeed,
  loadLookupTables,
} from "@switchboard-xyz/on-demand";

describe('price_oracle', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PriceOracle as Program<PriceOracle>;

  let oracleAccount: anchor.web3.Keypair;
  let feedPubkey: anchor.web3.PublicKey;

  before(async () => {
    oracleAccount = anchor.web3.Keypair.generate();
    // 使用一個虛擬的 Switchboard feed 地址進行測試
    feedPubkey = new anchor.web3.PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
  });

  it('Initializes the Oracle Account', async () => {
    await program.methods.initialize()
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        authority: provider.wallet.publicKey,
        feed: feedPubkey,
      })
      .signers([oracleAccount])
      .rpc();

    const account = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    assert.ok(account.authority.equals(provider.wallet.publicKey));
    assert.ok(account.feed.equals(feedPubkey));
    assert.equal(account.lastUpdateTimestamp.toNumber(), 0);
    assert.equal(account.cachedPrice.toNumber(), 0);
  });

  it('Fetches the price and uses cache', async () => {
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;

    // Load the Switchboard Anchor Program
    const switchboardProgramId = new anchor.web3.PublicKey("SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f");
    const switchboardIdl = await Program.fetchIdl(switchboardProgramId, provider);
    if (!switchboardIdl) throw new Error("Failed to fetch Switchboard IDL");
    const switchboard = new Program(switchboardIdl, provider);

    const feedAccount = new PullFeed(switchboard, feedPubkey);

    // Get the update instruction for switchboard
    const [pullIx, responses, success] = await feedAccount.fetchUpdateIx();
    const lookupTables = await loadLookupTables([...responses.map((x) => x.oracle), feedAccount]);

    // Set priority fee for the tx
    const priorityFeeIx = anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 100_000,
    });

    // Get the latest context
    const {
      context: { slot: minContextSlot },
      value: { blockhash, lastValidBlockHeight },
    } = await connection.getLatestBlockhashAndContext();

    // Get Transaction Message 
    const message = new anchor.web3.TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [priorityFeeIx, pullIx, 
        await program.methods.getPrice("SOL")
          .accounts({
            oracleAccount: oracleAccount.publicKey,
            feed: feedPubkey,
          })
          .instruction()
      ],
    }).compileToV0Message(lookupTables);
    
    // Get Versioned Transaction
    const vtx = new anchor.web3.VersionedTransaction(message);
    const signed = await wallet.signTransaction(vtx);

    // Send the transaction via rpc 
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      maxRetries: 0,
      skipPreflight: true,
    });
    
    // Wait for confirmation
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    console.log(`Transaction sent: ${signature}`);

    // 驗證價格已更新
    const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    assert.notEqual(updatedAccount.cachedPrice.toNumber(), 0);

    // 立即再次獲取價格，應該使用緩存
    const cachedPrice = await program.methods.getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        feed: feedPubkey,
      })
      .view();

    assert.equal(cachedPrice.toString(), updatedAccount.cachedPrice.toString(), "Cached price should be the same");
  });

  it('Fails to fetch price for invalid asset', async () => {
    try {
      await program.methods.getPrice("")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          feed: feedPubkey,
        })
        .view();
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.include(error.message, 'InvalidAsset');
    }
  });

  it('Fails to fetch price from uninitialized oracle', async () => {
    const uninitializedOracleAccount = anchor.web3.Keypair.generate();
    try {
      await program.methods.getPrice("SOL")
        .accounts({
          oracleAccount: uninitializedOracleAccount.publicKey,
          feed: feedPubkey,
        })
        .view();
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.include(error.message, 'NotInitialized');
    }
  });
});