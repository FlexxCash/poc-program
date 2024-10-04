import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { PriceOracle } from '../target/types/price_oracle';
import { assert } from 'chai';
import * as sb from "@switchboard-xyz/on-demand";
import {
  AnchorUtils,
  InstructionUtils,
  loadLookupTables,
  PullFeed,
  asV0Tx,
  Queue,
  sleep,
} from "@switchboard-xyz/on-demand";

describe('price_oracle', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PriceOracle as Program<PriceOracle>;

  let oracleAccount: anchor.web3.Keypair;
  let feedAccount: anchor.web3.PublicKey;

  before(async () => {
    oracleAccount = anchor.web3.Keypair.generate();
    // 這裡需要設置實際的 Switchboard feed 地址
    feedAccount = new anchor.web3.PublicKey("YOUR_SWITCHBOARD_FEED_ADDRESS");
  });

  it('Initializes the Oracle Account', async () => {
    await program.methods.initialize()
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        authority: provider.wallet.publicKey,
        feed: feedAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([oracleAccount])
      .rpc();

    const account = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    assert.ok(account.authority.equals(provider.wallet.publicKey));
    assert.ok(account.feed.equals(feedAccount));
    assert.equal(account.lastUpdateTimestamp.toNumber(), 0);
    assert.equal(account.cachedPrice.toNumber(), 0);
  });

  it('Fetches the price and uses cache', async () => {
    const connection = provider.connection;
    const payer = (provider.wallet as anchor.Wallet).payer;

    const pullFeed = await PullFeed.load(connection, feedAccount);
    const [pullIx, responses, _, luts] = await pullFeed.fetchUpdateIx();

    const tx = await asV0Tx({
      connection,
      ixs: [pullIx, 
        await program.methods.getPrice("SOL")
          .accounts({
            oracleAccount: oracleAccount.publicKey,
            feed: feedAccount,
          })
          .instruction()
      ],
      signers: [payer],
      computeUnitPrice: 200_000,
      computeUnitLimitMultiple: 1.3,
      lookupTables: luts,
    });

    const sim = await connection.simulateTransaction(tx, {
      commitment: "processed",
    });
    const sig = await connection.sendTransaction(tx, {
      preflightCommitment: "processed",
      skipPreflight: true,
    });

    const simPrice = sim.value.logs.join().match(/price: (.*)/)[1];
    console.log(`Price update: ${simPrice}\n\tTransaction sent: ${sig}`);

    // 驗證價格已更新
    const updatedAccount = await program.account.oracleAccount.fetch(oracleAccount.publicKey);
    assert.notEqual(updatedAccount.cachedPrice.toNumber(), 0);

    // 立即再次獲取價格，應該使用緩存
    const cachedPrice = await program.methods.getPrice("SOL")
      .accounts({
        oracleAccount: oracleAccount.publicKey,
        feed: feedAccount,
      })
      .view();

    assert.equal(cachedPrice.toString(), updatedAccount.cachedPrice.toString(), "Cached price should be the same");
  });

  it('Fails to fetch price for invalid asset', async () => {
    try {
      await program.methods.getPrice("")
        .accounts({
          oracleAccount: oracleAccount.publicKey,
          feed: feedAccount,
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
          feed: feedAccount,
        })
        .view();
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.include(error.message, 'NotInitialized');
    }
  });
});