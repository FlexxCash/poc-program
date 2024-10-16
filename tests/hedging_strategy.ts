import * as anchor from "@coral-xyz/anchor";
     import { Program } from "@coral-xyz/anchor";
     import { HedgingStrategy } from "../target/types/hedging_strategy";
     import { PriceOracle } from "../target/types/price_oracle";
     import { expect } from "chai";
     import {
       PublicKey,
       Keypair,
       SystemProgram,
     } from "@solana/web3.js";
     import {
       TOKEN_PROGRAM_ID,
       createMint,
       createAssociatedTokenAccount,
       mintTo,
       getAccount,
     } from "@solana/spl-token";
     import * as fs from 'fs';
     
     describe("hedging_strategy", () => {
       const HEDGING_AMOUNT = 1000000000; // 1 token，9 個小數位
       // Load the non-admin wallet
       const secretKeyString = fs.readFileSync('/home/dc/.config/solana/nonAdmin.json', 'utf-8');
       const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
       const wallet = Keypair.fromSecretKey(secretKey);
     
       // Set up the provider with the loaded wallet
       const provider = anchor.AnchorProvider.env();
       const walletPubkey = provider.wallet.publicKey;
       anchor.setProvider(provider);
     
       const program = anchor.workspace.HedgingStrategy as Program<HedgingStrategy>;
       const priceOracleProgram = anchor.workspace.PriceOracle as Program<PriceOracle>;
       const user = wallet; // Use the loaded wallet as the user
       const authority = walletPubkey;
     
       let mint: PublicKey;
       let userTokenAccount: PublicKey;
       let hedgingVault: PublicKey;
       let systemState: PublicKey;
       let oracleAccount: Keypair;
     
       // 模擬 Switchboard feed 公鑰
       const mockSolFeed = new PublicKey("GvDMxPzN1sCj7L26YDK2HnMRXEQmQ2aemov8YBtPS7vR");
       const mockInterestAssetFeed = new PublicKey("4NiWaTuje7SVe9DN1vfnX7m1qBC7DnUxwRxbdgEDUGX1");
     
       before(async () => {
         // 初始化 PriceOracle
         oracleAccount = Keypair.generate();
         try {
           const initializeInstruction = await priceOracleProgram.methods
             .initialize()
             .accounts({
               oracleAccount: oracleAccount.publicKey,
               authority: provider.wallet.publicKey,
               solFeed: mockSolFeed,
               interestAssetFeed: mockInterestAssetFeed,
               systemProgram: SystemProgram.programId,
             } as any)
             .instruction();
     
           await createAndSendV0Tx([initializeInstruction], [oracleAccount]);
     
           console.log("PriceOracle initialized successfully");
         } catch (error) {
           console.error("Failed to initialize PriceOracle:", error);
           throw error;
         }
     
         // 創建 mint
         mint = await createMint(
           provider.connection,
           wallet,
           wallet.publicKey,
           null,
           9
         );
     
         // 創建 user token account
         userTokenAccount = await createAssociatedTokenAccount(
           provider.connection,
           wallet,
           mint,
           wallet.publicKey
         );
     
         // 創建 hedging vault
         hedgingVault = await createAssociatedTokenAccount(
           provider.connection,
           wallet,
           mint,
           program.programId
         );
     
         // Mint tokens 給 user
         await mintTo(
           provider.connection,
           wallet,
           mint,
           userTokenAccount,
           wallet.publicKey,
           HEDGING_AMOUNT
         );
     
         // 初始化 system state
         const [systemStatePda] = await PublicKey.findProgramAddress(
           [Buffer.from("system_state")],
           program.programId
         );
         systemState = systemStatePda;
     
         const initializeSystemStateInstruction = await program.methods
           .initializeSystemState()
           .accounts({
             systemState: systemState,
             authority: authority,
             systemProgram: SystemProgram.programId,
           } as any)
           .instruction();
     
         await createAndSendV0Tx([initializeSystemStateInstruction]);
       });
     
       // ...其餘測試代碼保持不變
       
       async function createAndSendV0Tx(txInstructions: anchor.web3.TransactionInstruction[], signers: Keypair[] = []) {
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
     });
